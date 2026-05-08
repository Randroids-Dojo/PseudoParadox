import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import {
  isLit,
  portalDestinationNormalized,
  type Portal,
} from "./portal.ts";
import { InputRecorder } from "./inputRecorder.ts";
import { createGhost, type GhostInstance } from "./ghostInstance.ts";
import type {
  OverlapEvent,
  PortalTriggerSet,
} from "./portalTrigger.ts";
import { applyInstanceTint } from "../render/instanceTint.ts";

/**
 * Portal traversal teleport (REQ-009 runtime half / REQ-013 / REQ-014 partial).
 *
 * When the active player walks into a LIT portal trigger volume, the traversal
 * handler:
 *
 *   1. Snapshots the active player's CURRENT input recording, so the path the
 *      player just walked is preserved as a permanent past instance in the
 *      timeline that is being LEFT BEHIND (REQ-001 / REQ-002 / REQ-003).
 *   2. Spawns a ghost replaying that snapshot from the active player's current
 *      lifetime's start position, tinted at the lifetime's origin normalized
 *      time so the ghost reads as belonging to the timeline it was recorded in.
 *   3. Teleports the active player to the destination time's spawn pose. The
 *      destination spawn pose for this slice is the room center (REQ-013 will
 *      author per-time spawn poses in the next slice).
 *   4. Re-stamps the active player's body color tint and `originNormalized` to
 *      the destination's time-of-day (REQ-030).
 *   5. Resets the active player's lifetime: a fresh InputRecorder keyed at
 *      tick 0 of the destination timeline, and a fresh start position equal
 *      to the destination spawn pose. Subsequent recording is for the new
 *      lifetime; the previous lifetime's recording was already snapshotted.
 *
 * Dark portals (REQ-010) MUST NOT teleport the player. The handler filters
 * `enter` events on `isLit(portal)` and ignores the rest.
 *
 * NOT in scope this slice:
 *   - Per-timeline ghost bookkeeping. The current slice spawns a ghost on
 *     every lit-portal entry but does not track which ghost belongs to which
 *     timeline. A later slice will key recordings by destination time so a
 *     ghost is only visible in the timeline it was recorded in.
 *   - Act 1 specific spawn pose at 5:00. The destination spawn pose is the
 *     room center for now; the next slice authors per-time spawn poses.
 *   - REQ-007 instance generation numbering.
 */

/**
 * Handle to the active player's current lifetime. A "lifetime" is one
 * uninterrupted run of recording: from the moment the active player either
 * started the game or arrived through a portal, until the next portal
 * traversal. Each traversal closes the current lifetime (its recording is
 * snapshotted and replayed on a ghost) and opens a fresh lifetime at the
 * destination time.
 */
export interface ActiveLifetime {
  /** World-space position the lifetime started at. Ghosts spawned to replay
   * THIS lifetime's recording start at this position. */
  startPosition: { x: number; z: number };
  /** Recorder for this lifetime's input. Reset on every traversal. */
  recorder: InputRecorder;
  /** Normalized time-of-day of the timeline this lifetime is recording in.
   * Used as the tint stamp on any ghost spawned from this lifetime. */
  originNormalized: number;
}

/** Minimal subset of `RAPIER.World` the traversal handler needs to spawn
 * ghosts. Mirrors `GhostWorldHandle` so tests can pass a stub. */
export interface TraversalWorldHandle {
  createRigidBody: RAPIER.World["createRigidBody"];
  createCollider: RAPIER.World["createCollider"];
}

/**
 * Active player handle the traversal handler reads and writes. The traversal
 * needs to read the body's translation (for the destination teleport, in case
 * future slices base the destination on the entry direction) and write the
 * destination spawn pose. The mesh is needed so the active player's tint can
 * be re-stamped on traversal (REQ-030).
 */
export interface ActivePlayerHandle {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  /** Mutable: re-stamped to the destination's normalized time on traversal. */
  originNormalized: number;
}

/**
 * Pluggable spawn-pose resolver. Given a destination normalized time, returns
 * the world-space spawn position for that timeline. The default resolver
 * always returns the room center; the next slice will author per-time spawn
 * poses (REQ-013).
 */
export type SpawnPoseResolver = (destinationNormalized: number) => {
  x: number;
  z: number;
};

const DEFAULT_SPAWN_POSE: SpawnPoseResolver = () => ({ x: 0, z: 0 });

export interface WireTraversalOptions {
  /** Edge-triggered overlap detector from `createPortalTriggerSet`. */
  detector: PortalTriggerSet;
  /** Active player handle. Mutated on every lit-portal entry. */
  player: ActivePlayerHandle;
  /** Mutable lifetime state. Read at snapshot time, reset on traversal. */
  lifetime: ActiveLifetime;
  /** Three.js scene for spawned ghost meshes. */
  scene: THREE.Scene;
  /** Rapier world for spawned ghost rigid bodies. */
  world: TraversalWorldHandle;
  /** Pushed to whenever a ghost is spawned. The host's fixed-step loop is
   * responsible for calling `advanceTick()` on each entry per simulation step. */
  ghosts: GhostInstance[];
  /** Resolves destination spawn pose. Defaults to the room center. */
  resolveSpawnPose?: SpawnPoseResolver;
}

export interface TraversalHandle {
  /** Unsubscribe from the detector. The handle is otherwise idempotent: after
   * disposal, no further events trigger traversal. */
  dispose: () => void;
}

/**
 * Wires the traversal handler to a portal-trigger detector. Returns a handle
 * with a `dispose` cleanup.
 *
 * Dark-portal entries are silently ignored (REQ-010): the player cannot enter
 * a dark door. `exit` events are ignored too; only `enter` triggers traversal.
 *
 * Multiple lit-portal `enter` events in the same tick (e.g. if two triggers
 * overlap) are processed in detector order. Each traversal closes the current
 * lifetime; the second event in the same tick would see the lifetime that
 * was just opened by the first, which is harmless but unusual. The detector
 * volumes are authored not to overlap, so this is a paper concern.
 */
export function wireTraversal(options: WireTraversalOptions): TraversalHandle {
  const {
    detector,
    player,
    lifetime,
    scene,
    world,
    ghosts,
    resolveSpawnPose = DEFAULT_SPAWN_POSE,
  } = options;

  const handleEvent = (event: OverlapEvent): void => {
    if (event.kind !== "enter") return;
    // REQ-010: dark portals are spawn-only; the player cannot enter them.
    if (!isLit(event.portal)) return;
    traverseLitPortal(event.portal);
  };

  const traverseLitPortal = (portal: Portal): void => {
    // 1. Snapshot the LEAVING lifetime's recording. The recording is frozen
    //    at this point so the ghost cannot accidentally pick up frames the
    //    fresh recorder records after this traversal.
    const recording = lifetime.recorder.snapshot();

    // 2. Spawn the ghost ONLY if there is a recording to play back. A zero-
    //    length recording would produce a stationary ghost at the start
    //    position; harmless but visual noise.
    if (recording.length > 0) {
      const ghost = createGhost({
        recording,
        // The ghost belongs to the timeline being LEFT BEHIND; tint on its
        // origin normalized.
        originNormalized: lifetime.originNormalized,
        scene,
        world,
        startPosition: { ...lifetime.startPosition },
      });
      ghosts.push(ghost);
    }

    // 3. Teleport the active player to the destination spawn pose. The
    //    spawn pose resolver returns the room center by default; per-time
    //    spawn poses (REQ-013) land in the next slice. The y is recomputed
    //    by the body's existing height; we only override x and z.
    const destination = resolveSpawnPose(portalDestinationNormalized(portal));
    const currentY = player.body.translation().y;
    player.body.setTranslation(
      { x: destination.x, y: currentY, z: destination.z },
      true,
    );
    // Zero out velocity so the player does not arrive moving from the
    // entry-side momentum. This avoids a subtle bug where the player
    // re-enters the destination's portal trigger because they were moving
    // toward that wall when they crossed the originating trigger.
    player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    // 4. Re-stamp the active player's tint and origin normalized to the
    //    destination's time-of-day (REQ-030).
    const destinationNormalized = portalDestinationNormalized(portal);
    player.originNormalized = destinationNormalized;
    applyInstanceTint(player.mesh, destinationNormalized);

    // 5. Open a fresh lifetime at the destination. The previous lifetime's
    //    recording was snapshotted in step 1 and is already feeding the
    //    spawned ghost; resetting the recorder to a new instance does not
    //    affect the ghost's playback (the snapshot is a defensive copy).
    lifetime.recorder = new InputRecorder();
    lifetime.startPosition = { x: destination.x, z: destination.z };
    lifetime.originNormalized = destinationNormalized;
  };

  const off = detector.onPortalOverlap(handleEvent);

  return {
    dispose(): void {
      off();
    },
  };
}
