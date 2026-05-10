import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import {
  portalDestinationNormalized,
  type Portal,
} from "./portal.ts";
import { InputRecorder } from "./inputRecorder.ts";
import { MilestoneRecorder, DOOR_TRAVERSAL_WEIGHT } from "./milestone.ts";
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
import { litStateForTimeline } from "./litStateForTimeline.ts";
import { isLit as portalAuthoredLit } from "./portal.ts";
import { nextInstanceId, type InstanceId } from "./instanceId.ts";
import type { Consciousness } from "./knockoutState.ts";
import type { CarryState } from "./carryState.ts";

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
  /**
   * Absolute tick within the lifetime's home timeline at which this
   * lifetime started recording (F-014). The host sets this from the
   * source timeline's tick clock when the lifetime opens (initial
   * spawn or arrival through a portal). Any ghost filed from this
   * lifetime inherits the value as its `startTick`.
   */
  startTick: number;
  /** Recorder for this lifetime's input. Reset on every traversal. */
  recorder: InputRecorder;
  /**
   * Recorder for this lifetime's milestones (F-013 PR3a: wall_bump and
   * door_traversal events). Reset on every traversal alongside `recorder`.
   * Snapshotted onto the spawned ghost so future replay slices (PR3b) can
   * steer toward the same milestones.
   */
  milestones: MilestoneRecorder;
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
  /**
   * Needed so `setActiveTimeline` can despawn ghosts whose
   * `door_traversal` milestone fired before the arrival tick (F-014).
   * Mirrors `RegistryWorldHandle.removeRigidBody`.
   */
  removeRigidBody: RAPIER.World["removeRigidBody"];
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
  /**
   * Two-state consciousness flag (REQ-033 partial). Mutated by the per-tick
   * punch resolver in `src/app.ts`; reset to `'conscious'` by `hardReset`.
   * Traversal does NOT branch on this flag in the current slice; the
   * dossier permits a knocked-out instance to be carried through a portal
   * by a future pickup-and-throw slice, but in this slice the player simply
   * cannot move while unconscious so a portal traversal is mechanically
   * unreachable.
   */
  consciousness: Consciousness;
  /**
   * Pickup-and-carry state (REQ-034). Mutated by the host's per-tick
   * carry resolver in `src/app.ts`; reset to `'idle'` by `hardReset`.
   * Traversal does not branch on this flag in the current slice (the
   * carried body comes along with the carrier through a lit portal per
   * the dossier section 5 edge case 2; the next slice's throw mechanic
   * is the only path that DETACHES a body during traversal).
   */
  carry: CarryState;
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
    // Lit/dark gate (REQ-009 / REQ-010 / REQ-011 / REQ-015):
    //   - For timelines authored in the seed (`DOOR_STATE_BY_HOUR`, today
    //     hours 5 and 6), `litStateForTimeline` returns
    //     `seed[cardinal] && !blockedByArrivals(ghosts, cardinal)`. The
    //     arrivals body is a stub returning `false` (REQ-011 MVP); future
    //     Act 2 / Act 3 slices will populate the rule. The same call drives
    //     `repaintDoorsForHour` so visual and behavior cannot drift.
    //   - For timelines NOT in the seed (e.g. the test harness keys hour 0
    //     to exercise leaving-timeline semantics), `litStateForTimeline`
    //     returns `null` and we fall back to the portal's frozen `isLit`
    //     field. The runtime path in `src/app.ts` only ever sits at
    //     authored hours, so this fallback only fires from test fixtures.
    const state = litStateForTimeline(registry.activeTimeline, {
      ghosts: registry.ghostsFor(registry.activeTimeline),
    });
    if (state) return state[portal.direction];
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
    // 0. Record the door_traversal milestone on the LEAVING lifetime BEFORE
    //    snapshotting. The recording-tick at the moment of traversal is the
    //    recorder's current length (the next tick that would have been
    //    written), and the door's milestone position is the player's
    //    translation at the door (used by PR3b's path-follower to steer
    //    toward the door). This is the load-bearing high-weight milestone:
    //    PR3b makes it unskippable.
    const playerPos = player.body.translation();
    lifetime.milestones.record({
      kind: "door_traversal",
      tick: lifetime.recorder.length,
      position: { x: playerPos.x, z: playerPos.z },
      weight: DOOR_TRAVERSAL_WEIGHT,
      door: portal.direction,
    });

    // 1. Snapshot the LEAVING lifetime's recording. The recording is frozen
    //    at this point so the ghost cannot accidentally pick up frames the
    //    fresh recorder records after this traversal.
    const recording = lifetime.recorder.snapshot();
    const milestones = lifetime.milestones.snapshot();

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
      // F-014: the ghost's recording covers ticks
      // `[lifetime.startTick, lifetime.startTick + recording.length)`
      // of the source timeline. The lifetime's startTick is the source
      // timeline's tick clock at the moment the lifetime opened (when
      // the player previously arrived at this timeline). Stored on the
      // ghost so re-entry can compute its position-at-arrival-tick.
      const sourceTimeline = timelineIdFromNormalized(lifetime.originNormalized);
      const ghost = createGhost({
        recording,
        milestones,
        startTick: lifetime.startTick,
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
    //    The milestone recorder is reset alongside the input recorder so
    //    the fresh lifetime starts with an empty milestone log.
    lifetime.recorder = new InputRecorder();
    lifetime.milestones = new MilestoneRecorder();
    lifetime.startPosition = { x: destination.x, z: destination.z };
    lifetime.originNormalized = destinationNormalized;
    lifetime.instanceId = incomingInstanceId;
    // F-014: the fresh lifetime starts at the destination's tick. The
    // destination timeline's tick clock is set to `portal.destinationTick`
    // by `setActiveTimeline` below, and any future filing of THIS
    // lifetime as a ghost (next traversal) will use this value as the
    // ghost's startTick.
    lifetime.startTick = portal.destinationTick;

    // 7. Switch the registry's active timeline to the destination. This
    //    hides every ghost in the timeline just left behind (including the
    //    one spawned in step 2 if it was filed into a non-active bucket),
    //    and resets every ghost in the entering timeline to tick 0 with its
    //    spawn pose, then makes it visible. Each timeline visit is a fresh
    //    playback (REQ-001 / REQ-003).
    const destinationHour = timelineIdFromNormalized(destinationNormalized);
    // F-014: hand the destination's authored tick to the registry. The
    // registry stamps the entering timeline's tick clock and either
    // fast-forwards each ghost or despawns it if its `door_traversal`
    // milestone fires before the arrival tick. Pass scene + world so
    // stale ghosts can be cleaned up.
    registry.setActiveTimeline(destinationHour, portal.destinationTick, {
      scene,
      world,
    });

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
