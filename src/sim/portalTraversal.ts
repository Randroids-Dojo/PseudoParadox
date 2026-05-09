import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import {
  portalDestinationNormalized,
  type Portal,
} from "./portal.ts";
import { InputRecorder } from "./inputRecorder.ts";
import { createGhost } from "./ghostInstance.ts";
import type {
  OverlapEvent,
  PortalTriggerSet,
} from "./portalTrigger.ts";
import { applyInstanceTint } from "../render/instanceTint.ts";
import {
  timelineIdFromNormalized,
  type TimelineRegistry,
} from "./timelineRegistry.ts";
import { DOOR_STATE_BY_HOUR } from "./doorStateAtTime.ts";
import { isLit as portalAuthoredLit } from "./portal.ts";
import { nextInstanceId, type InstanceId } from "./instanceId.ts";

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
 * Per-timeline ghost bookkeeping is wired through `TimelineRegistry`: the
 * spawned ghost is filed into the SOURCE timeline (taken from
 * `lifetime.originNormalized`) and the registry's active timeline is
 * switched to the destination. The host's loop drives `registry.activeGhosts()`
 * rather than every spawned ghost, so a ghost recorded at 5:00 is hidden
 * while the player is at 6:00 and visible again on return to 5:00.
 *
 * Instance generation numbering (REQ-007 / REQ-008): on every lit-portal
 * traversal the OUTGOING active player's `instanceId` is handed off to the
 * spawned ghost (which IS that closed-out instance, replayed), and the
 * INCOMING active instance gets a FRESH generation: `nextInstanceId(previous)`.
 * The active player always controls the most recently spawned instance.
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
  /**
   * Generation index of the active instance this lifetime is recording for
   * (REQ-007). Mirrors the active player's `instanceId` at the moment the
   * lifetime opened. On traversal the ghost spawned from this lifetime takes
   * THIS value (the closed-out instance keeps its identity), and the next
   * lifetime opens at `nextInstanceId(instanceId)`.
   */
  instanceId: InstanceId;
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
  /**
   * Generation index of the active instance (REQ-007 / REQ-008). Mutated on
   * every lit-portal traversal: the OUTGOING value is handed off to the
   * spawned ghost (which IS that closed-out instance, replayed), and this
   * field is then advanced to `nextInstanceId(previous)` so "the player
   * always controls the most recently spawned active instance."
   */
  instanceId: InstanceId;
}

/**
 * Pluggable spawn-pose resolver. Given a destination normalized time, returns
 * the world-space spawn position for that timeline. The default resolver
 * always returns the room center; the next slice will author per-time spawn
 * poses (REQ-013).
 *
 * CONTRACT: the returned pose MUST sit outside every portal trigger volume
 * in the room. Otherwise the next `PortalTriggerSet.step()` call after the
 * teleport will see the player as "newly inside" the trigger the player
 * spawned in and emit a fresh `enter` event, kicking off a re-traversal
 * loop. The default room-center pose `(0, 0)` is safely outside all four
 * Act 1 trigger volumes (which sit ~4.7m from center on a 10x10 room).
 * The next slice authoring per-time spawn poses must hold this invariant
 * (or extend the detector with a "skip-one-tick" priming hook).
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
  /**
   * Per-timeline ghost bookkeeping. Each lit-portal entry files the spawned
   * ghost into the SOURCE timeline (the timeline being LEFT BEHIND, taken
   * from `lifetime.originNormalized`) and switches the registry's active
   * timeline to the destination. The host's loop calls `activeGhosts()` to
   * decide which ghosts tick and render this frame (REQ-001 / REQ-003).
   *
   * The lit/dark filter that gates traversal is also derived from the
   * registry's current `activeTimeline`: a portal is enterable iff
   * `doorLitStateAtHour(activeTimeline)[portal.direction]` is true. This
   * makes the SAME `doorLitStateAtHour` table that paints the doors drive
   * the runtime entry predicate, so the two cannot drift across timelines
   * (REQ-015: at 6:00 only the West door is enterable, regardless of how
   * the portals were authored at 5:00).
   */
  registry: TimelineRegistry;
  /** Resolves destination spawn pose. Defaults to the room center. */
  resolveSpawnPose?: SpawnPoseResolver;
  /**
   * Fired once per LIT traversal AFTER the registry's active timeline has
   * been switched to the destination. Receives the destination hour as an
   * integer so the host can repaint doors and snap the time-of-day clock
   * to the new timeline (REQ-015). Optional; if omitted, the traversal
   * still completes mechanically.
   */
  onTimelineEnter?: (destinationHour: number) => void;
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
    registry,
    resolveSpawnPose = DEFAULT_SPAWN_POSE,
    onTimelineEnter,
  } = options;

  const isLitForCurrentTimeline = (portal: Portal): boolean => {
    // Lit/dark gate (REQ-009 / REQ-010 / REQ-015):
    //   - When the current timeline is AUTHORED in `DOOR_STATE_BY_HOUR`
    //     (hours 5 and 6 today), read from that table. The same table that
    //     paints the doors gates the entry predicate, so the visual and
    //     behavior cannot drift across timelines (REQ-015: at 6:00 only
    //     West is enterable, regardless of how the portals were authored
    //     at 5:00).
    //   - When the current timeline is UNAUTHORED (e.g. the test harness
    //     keys hour 0 to exercise leaving-timeline semantics), fall back
    //     to the portal's frozen `isLit` field. The runtime path in
    //     `src/app.ts` only ever sits at authored hours (Acts 1-3 use 5,
    //     6, and 12), so this fallback only fires from test fixtures.
    //     REQ-011 will collapse the table+field pair into a single
    //     timeline-derived computation.
    const table = DOOR_STATE_BY_HOUR[registry.activeTimeline];
    if (table) return table[portal.direction];
    return portalAuthoredLit(portal);
  };

  const handleEvent = (event: OverlapEvent): void => {
    if (event.kind !== "enter") return;
    // REQ-010 / REQ-015: dark portals are spawn-only; the player cannot
    // enter them. "Dark" is derived from the current timeline's table so a
    // door's lit state can change as the player moves between timelines.
    if (!isLitForCurrentTimeline(event.portal)) return;
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
    //
    //    File the ghost into the SOURCE timeline (the timeline being LEFT
    //    BEHIND, derived from the lifetime's origin). The registry hides it
    //    immediately because the active timeline is about to switch to the
    //    destination on step 6 below; the next time the player returns to
    //    the source timeline, the registry resets the ghost to tick 0 and
    //    makes it visible again (REQ-001 / REQ-003).
    if (recording.length > 0) {
      const ghost = createGhost({
        recording,
        // The ghost belongs to the timeline being LEFT BEHIND; tint on its
        // origin normalized.
        originNormalized: lifetime.originNormalized,
        // The ghost IS the OUTGOING active instance, recorded. It keeps its
        // generation index so a returning player still sees the same You-1 /
        // You-2 in the source timeline (REQ-007).
        instanceId: lifetime.instanceId,
        scene,
        world,
        startPosition: { ...lifetime.startPosition },
      });
      const sourceTimeline = timelineIdFromNormalized(lifetime.originNormalized);
      registry.add(sourceTimeline, ghost);
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

    // 5. Advance the active instance generation. The OUTGOING `instanceId`
    //    has just been handed to the spawned ghost above (which IS the
    //    closed-out instance, replayed). The INCOMING active instance is a
    //    FRESH generation: `previousId + 1`. This is REQ-007 / REQ-008: the
    //    player always controls the most recently spawned active instance,
    //    and the generation index advances by one on every traversal.
    const incomingInstanceId = nextInstanceId(player.instanceId);
    player.instanceId = incomingInstanceId;

    // 6. Open a fresh lifetime at the destination. The previous lifetime's
    //    recording was snapshotted in step 1 and is already feeding the
    //    spawned ghost; resetting the recorder to a new instance does not
    //    affect the ghost's playback (the snapshot is a defensive copy).
    lifetime.recorder = new InputRecorder();
    lifetime.startPosition = { x: destination.x, z: destination.z };
    lifetime.originNormalized = destinationNormalized;
    lifetime.instanceId = incomingInstanceId;

    // 7. Switch the registry's active timeline to the destination. This
    //    hides every ghost in the timeline just left behind (including the
    //    one spawned in step 2 if it was filed into a non-active bucket),
    //    and resets every ghost in the entering timeline to tick 0 with its
    //    spawn pose, then makes it visible. Each timeline visit is a fresh
    //    playback (REQ-001 / REQ-003).
    const destinationHour = timelineIdFromNormalized(destinationNormalized);
    registry.setActiveTimeline(destinationHour);

    // 8. Fire the timeline-enter hook so the host can repaint doors and
    //    snap the time-of-day clock to the destination hour (REQ-015). The
    //    hook fires AFTER the registry has switched, so any caller reading
    //    `registry.activeTimeline` from inside the hook sees the new value.
    if (onTimelineEnter) {
      onTimelineEnter(destinationHour);
    }
  };

  const off = detector.onPortalOverlap(handleEvent);

  return {
    dispose(): void {
      off();
    },
  };
}
