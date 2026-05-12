/**
 * Per-timeline ghost bookkeeping (REQ-001 deepening / REQ-003 done /
 * REQ-006 partial).
 *
 * The simulation's active state is keyed by a `TimelineId` (the
 * destination hour of the timeline the active player is currently in).
 * Every ghost spawned by a portal traversal is filed against the
 * timeline it was RECORDED IN (the timeline being LEFT BEHIND), not
 * the destination. When the active player traverses to a new
 * timeline, the registry:
 *
 *   1. Hides every ghost in the leaving timeline (mesh.visible =
 *      false; body velocity zeroed so the inactive ghost does not
 *      coast under residual momentum).
 *   2. Stamps the entering timeline's tick clock to `arrivalTick`
 *      (F-014 / Reading C per Q-026). The entering ghosts are
 *      EITHER:
 *        - Despawned, if their `door_traversal` milestone fires at
 *          or before `arrivalTick` (the ghost already left this
 *          timeline before the player arrives back).
 *        - Fast-forwarded to `position(arrivalTick - startTick)`,
 *          if their alive interval covers `arrivalTick`.
 *      The legacy `arrivalTick === 0` path resets every entering
 *      ghost to its tick-0 spawn pose (the pre-F-014 reset
 *      semantic, kept for backwards compatibility with tests and
 *      scripts that do not pass a tick).
 *
 * Each timeline carries its own continuous absolute tick clock that
 * advances via `advanceActiveTick()` while the timeline is active.
 * Door destinations are pinned to (timelineId, tick) pairs via
 * `Portal.destinationTick`. See `docs/OPEN_QUESTIONS.md` Q-026.
 *
 * The host's per-fixed-step loop drives `activeGhosts()` rather than
 * every spawned ghost, so inactive ghosts neither tick nor render.
 * An unvisited timeline returns an empty list (REQ-006: a time
 * period only contains events once an instance has entered it).
 *
 * Only three timelines are reachable in the prototype scope (Acts
 * 1-3 use 5:00, 6:00, and 12:00), so a `Map<number, Bucket>` keyed
 * by integer hour is sufficient.
 */

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { HOURS_PER_DAY } from "./actOneAnchor.ts";
import type { GhostInstance } from "./ghostInstance.ts";

/**
 * Minimal subset of `RAPIER.World` the registry needs for `clearAllGhosts`.
 * Defined as a structural interface so tests can pass either a real world
 * or a stub (mirrors `GhostWorldHandle` in `ghostInstance.ts`).
 */
export interface RegistryWorldHandle {
  removeRigidBody: RAPIER.World["removeRigidBody"];
}

/**
 * Identifier for a single timeline. The prototype keys on the integer hour
 * of day, which is the same scalar `portalDestinationNormalized` and the
 * GDD's Act 1-3 anchors use. `0 <= TimelineId < HOURS_PER_DAY`.
 */
export type TimelineId = number;

/**
 * Convert a normalized time-of-day in `[0, 1)` to its integer hour key. The
 * portal layer produces normalized values via `portalDestinationNormalized`;
 * the registry keys on hours so a reader can match a `TimelineId` directly
 * against the GDD ("at 5:00", "at 6:00", "at 12:00"). Rounds to handle
 * floating-point representations of exact hours like `5/24`.
 */
export function timelineIdFromNormalized(normalized: number): TimelineId {
  if (!Number.isFinite(normalized)) {
    throw new Error(
      `timelineIdFromNormalized requires a finite number, got ${normalized}`,
    );
  }
  const hours = Math.round(normalized * HOURS_PER_DAY);
  // Wrap so `1.0` collapses to `0` (midnight). The portal layer validates
  // its inputs at the source so this is defensive.
  return ((hours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}

interface TimelineBucket {
  /** Ghosts recorded in this timeline. Live for the registry's lifetime. */
  ghosts: GhostInstance[];
}

export interface TimelineRegistry {
  /** The timeline the active player is currently inside. Mutated by
   * `setActiveTimeline`. */
  readonly activeTimeline: TimelineId;
  /**
   * Read-only view of the ghosts recorded in `timeline`. Returns an empty
   * array for unvisited timelines (REQ-006). The returned array is a
   * defensive snapshot, not a live reference into the bucket.
   */
  ghostsFor: (timeline: TimelineId) => readonly GhostInstance[];
  /**
   * File a freshly spawned ghost into `timeline`. The ghost is left in its
   * current visibility / tick state; if `timeline` is the active timeline,
   * it stays visible and ticks from the host's loop. If `timeline` is NOT
   * the active timeline (e.g. spawn-into-source-on-traversal where the
   * source is the timeline being left behind), the registry hides it so it
   * does not bleed across timelines.
   */
  add: (timeline: TimelineId, ghost: GhostInstance) => void;
  /**
   * Switch the active timeline (F-014 Reading C). Hides every ghost in
   * the leaving bucket (their bodies are also stilled so they do not
   * coast under residual velocity); sets the entering bucket's tick
   * clock to `arrivalTick`; for each ghost in the entering bucket:
   * (a) despawns the ghost (via `disposeOptions.scene` and `.world`,
   * if supplied) when its recording contained a `door_traversal`
   * milestone whose absolute tick is at or before `arrivalTick` (the
   * ghost already walked through its door before the player arrived);
   * (b) otherwise fast-forwards the ghost to `arrivalTick` so its body
   * sits at the position the recording would produce at the moment of
   * arrival. `arrivalTick` defaults to `0` so existing callers that
   * pre-date F-014 continue to land at the start of the destination
   * timeline. `disposeOptions` is optional: when omitted, stale ghosts
   * are kept in the bucket but hidden (the host's F-012 lit-portal
   * despawn pass cleans them up on the next tick if they overlap a
   * trigger). Tests that do not exercise stale-door despawn can omit
   * it. Idempotent on a no-op switch (next === current and
   * arrivalTick === current tick clock).
   */
  setActiveTimeline: (
    next: TimelineId,
    arrivalTick?: number,
    disposeOptions?: { scene: THREE.Scene; world: RegistryWorldHandle },
  ) => void;
  /**
   * Current tick clock value for a timeline (F-014). Starts at `0` for
   * any timeline that has not yet been visited; updated on
   * `setActiveTimeline` and `advanceActiveTick`. Returns `0` for an
   * unvisited timeline.
   */
  tickFor: (timeline: TimelineId) => number;
  /**
   * Advance the active timeline's tick clock by one. The host's
   * fixed-step loop calls this once per simulation step alongside
   * `world.step()` so the active timeline's clock tracks elapsed
   * playback. No-op semantics on unvisited timelines (which cannot be
   * active by construction).
   */
  advanceActiveTick: () => void;
  /**
   * Ghosts that should tick and render this frame. Equivalent to
   * `ghostsFor(activeTimeline)` but exposed as a separate method so a
   * future slice can fold per-timeline state (e.g. a frozen-on-pause set)
   * into the loop without touching every call site.
   */
  activeGhosts: () => readonly GhostInstance[];
  /**
   * Tear down every ghost in every timeline bucket: remove each ghost's
   * mesh from `scene`, remove its rigid body (and its colliders) from
   * `world`, and clear every bucket so subsequent `ghostsFor` /
   * `activeGhosts` calls return empty lists. Resets the registry's active
   * timeline to `nextActiveTimeline` (typically the Act 1 anchor) without
   * firing the leaving / entering visibility passes that
   * `setActiveTimeline` runs (there are no ghosts left to hide or reset).
   * Used by REQ-025 hard reset; safe to call when the registry is empty.
   */
  clearAllGhosts: (
    scene: THREE.Scene,
    world: RegistryWorldHandle,
    nextActiveTimeline: TimelineId,
  ) => void;
  /**
   * Despawn a single ghost from whichever bucket it sits in: remove its
   * mesh from `scene`, dispose its thought bubble, remove its rigid body
   * (and colliders) from `world`, and drop it from its bucket. Returns
   * `true` if the ghost was found and removed, `false` if it was not
   * registered (in which case nothing was disposed). Used by F-012:
   * when a ghost's recorded path crosses a lit portal trigger, the host
   * despawns the ghost so its body does not stand "stuck at the door"
   * after the recording ends.
   */
  removeGhost: (
    ghost: GhostInstance,
    scene: THREE.Scene,
    world: RegistryWorldHandle,
  ) => boolean;
  /**
   * F-007: move a ghost from its current bucket to `destinationTimeline`
   * WITHOUT touching the underlying Rapier body or mesh. Used by the
   * in-flight registry's portal-crossing callback to rehome a thrown
   * body's bookkeeping on lit-portal traversal so the destination
   * timeline owns the settled body. Returns `true` if the ghost was
   * found and moved, `false` if it was not in any bucket. Idempotent:
   * if the ghost is already in `destinationTimeline`, returns `true`
   * without further work. Visibility IS reconciled: moving out of the
   * active timeline hides the mesh; moving into the active timeline
   * shows it.
   */
  rehomeGhost: (
    ghost: GhostInstance,
    destinationTimeline: TimelineId,
  ) => boolean;
  /**
   * F-007: locate a ghost by its `instanceId` across every timeline
   * bucket. Returns `undefined` if no bucket holds a ghost with that
   * id. Used by the host's in-flight portal-crossing callback to
   * resolve a body id (recorded on the carrier's lifetime) to a
   * `GhostInstance` for `rehomeGhost`. The body could live in any
   * bucket because it may have been rehomed by an earlier crossing.
   */
  findGhostByInstanceId: (instanceId: number) => GhostInstance | undefined;
}

export interface CreateTimelineRegistryOptions {
  /** Timeline the active player starts in. Required so the first traversal
   * has a "leaving" timeline to file the spawned ghost against. */
  initialTimeline: TimelineId;
}

/**
 * Build a fresh `TimelineRegistry` with no recorded ghosts in any bucket.
 * The active timeline is set to `initialTimeline` (no ghosts yet, so no
 * visibility work runs).
 */
export function createTimelineRegistry(
  options: CreateTimelineRegistryOptions,
): TimelineRegistry {
  const { initialTimeline } = options;
  if (!Number.isInteger(initialTimeline)) {
    throw new Error(
      `createTimelineRegistry: initialTimeline must be an integer, got ${initialTimeline}`,
    );
  }
  if (initialTimeline < 0 || initialTimeline >= HOURS_PER_DAY) {
    throw new Error(
      `createTimelineRegistry: initialTimeline must be in [0, ${HOURS_PER_DAY}), got ${initialTimeline}`,
    );
  }

  const buckets = new Map<TimelineId, TimelineBucket>();
  // F-014: per-timeline absolute tick clock. A timeline that has not
  // been visited has no entry (treated as `0`). On `setActiveTimeline`
  // the entering timeline's clock is set to `arrivalTick`. During play
  // the host calls `advanceActiveTick` once per fixed step to push the
  // active timeline's clock forward.
  const tickClocks = new Map<TimelineId, number>();
  let activeTimeline: TimelineId = initialTimeline;

  const bucketFor = (timeline: TimelineId): TimelineBucket => {
    let bucket = buckets.get(timeline);
    if (!bucket) {
      bucket = { ghosts: [] };
      buckets.set(timeline, bucket);
    }
    return bucket;
  };

  const hideGhost = (ghost: GhostInstance): void => {
    ghost.mesh.visible = false;
    // Still the body: an inactive ghost should not keep coasting through the
    // room under residual velocity. Keep its translation: on re-entry the
    // ghost is either reset to tick 0 (arrivalTick=0 legacy path) or
    // fast-forwarded to `position(arrivalTick - startTick)` (F-014), both
    // of which overwrite the translation, so the hidden value does not
    // need to be load-bearing.
    ghost.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    // REQ-032: hide the thought bubble alongside the ghost. An inactive
    // ghost has no preview; the bubble re-shows the next render frame
    // after re-entry resolves a fresh lookahead.
    ghost.thoughtBubble.setIcon(null);
  };

  const showAndResetGhost = (ghost: GhostInstance): void => {
    ghost.reset();
    ghost.mesh.visible = true;
  };

  /**
   * F-014: does the ghost's recording contain a `door_traversal`
   * milestone whose absolute tick is at or before `arrivalTick`? If so
   * the ghost already left before the player arrived and should
   * despawn. Returns false for ghosts whose recording has no
   * door_traversal milestone (they stay alive at end-of-recording
   * position once their relative tick exceeds the recording length).
   */
  const ghostLeftBefore = (
    ghost: GhostInstance,
    arrivalTick: number,
  ): boolean => {
    for (const m of ghost.milestones.milestones) {
      if (m.kind === "door_traversal") {
        const abs = ghost.startTick + m.tick;
        if (abs <= arrivalTick) return true;
      }
    }
    return false;
  };

  const add: TimelineRegistry["add"] = (timeline, ghost) => {
    const bucket = bucketFor(timeline);
    bucket.ghosts.push(ghost);
    if (timeline !== activeTimeline) {
      // Filed into a non-active bucket (e.g. the timeline being LEFT BEHIND
      // by a traversal): hide it so it does not render or tick in the
      // current view.
      hideGhost(ghost);
    }
  };

  const setActiveTimeline: TimelineRegistry["setActiveTimeline"] = (
    next,
    arrivalTick,
    disposeOptions,
  ) => {
    const currentTick = tickClocks.get(activeTimeline) ?? 0;
    const targetTick = arrivalTick ?? 0;
    if (next === activeTimeline && targetTick === currentTick) return;
    const leaving = bucketFor(activeTimeline);
    for (const ghost of leaving.ghosts) {
      hideGhost(ghost);
    }
    // F-014: stamp the entering timeline's tick clock to the arrival
    // tick. If the player traversed to (timeline, tick) the destination
    // clock reads `tick`; subsequent `advanceActiveTick` calls push it
    // forward during play.
    tickClocks.set(next, targetTick);
    const entering = bucketFor(next);
    if (targetTick === 0) {
      // Backwards-compatible path: arrivalTick=0 means start-of-timeline,
      // so every ghost is at its tick-0 spawn pose. Matches the
      // pre-F-014 reset semantics. No despawn check needed (a
      // door_traversal at tick 0 with startTick 0 would only fire
      // before arrival if both are 0; that recording would have length
      // 0 which the traversal handler refuses to file).
      for (const ghost of entering.ghosts) {
        showAndResetGhost(ghost);
      }
    } else {
      // F-014 mid-timeline arrival: each ghost either despawns (its
      // door_traversal already fired before arrivalTick) or
      // fast-forwards to its position-at-arrivalTick.
      const survivors: GhostInstance[] = [];
      for (const ghost of entering.ghosts) {
        if (ghostLeftBefore(ghost, targetTick)) {
          // The ghost's door_traversal milestone fires at or before
          // arrival, so it has already left this timeline. Never
          // fast-forward or re-show it. With disposeOptions present
          // we tear down its mesh / body / bubble immediately and
          // drop it from the bucket. Without disposeOptions (legacy
          // callers that did not pass scene + world) we hide the
          // mesh but keep the ghost in the bucket so a later
          // `clearAllGhosts(scene, world)` can still find it and
          // tear down its body and mesh, avoiding a Rapier-body
          // leak.
          if (disposeOptions) {
            disposeOptions.scene.remove(ghost.mesh);
            disposeOptions.world.removeRigidBody(ghost.body);
            ghost.thoughtBubble.dispose();
            continue;
          }
          ghost.mesh.visible = false;
          survivors.push(ghost);
          continue;
        }
        ghost.fastForwardTo(targetTick);
        ghost.mesh.visible = true;
        survivors.push(ghost);
      }
      entering.ghosts.length = 0;
      entering.ghosts.push(...survivors);
    }
    activeTimeline = next;
  };

  const tickFor: TimelineRegistry["tickFor"] = (timeline) =>
    tickClocks.get(timeline) ?? 0;

  const advanceActiveTick: TimelineRegistry["advanceActiveTick"] = () => {
    const current = tickClocks.get(activeTimeline) ?? 0;
    tickClocks.set(activeTimeline, current + 1);
  };

  const ghostsFor: TimelineRegistry["ghostsFor"] = (timeline) => {
    const bucket = buckets.get(timeline);
    if (!bucket) return [];
    return bucket.ghosts.slice();
  };

  const activeGhosts: TimelineRegistry["activeGhosts"] = () => {
    const bucket = buckets.get(activeTimeline);
    if (!bucket) return [];
    return bucket.ghosts;
  };

  const clearAllGhosts: TimelineRegistry["clearAllGhosts"] = (
    scene,
    world,
    nextActiveTimeline,
  ) => {
    if (!Number.isInteger(nextActiveTimeline)) {
      throw new Error(
        `clearAllGhosts: nextActiveTimeline must be an integer, got ${nextActiveTimeline}`,
      );
    }
    if (
      nextActiveTimeline < 0 ||
      nextActiveTimeline >= HOURS_PER_DAY
    ) {
      throw new Error(
        `clearAllGhosts: nextActiveTimeline must be in [0, ${HOURS_PER_DAY}), got ${nextActiveTimeline}`,
      );
    }
    for (const bucket of buckets.values()) {
      for (const ghost of bucket.ghosts) {
        scene.remove(ghost.mesh);
        // Rapier removes the body's colliders alongside the body itself,
        // so an explicit `removeCollider` per ghost is unnecessary.
        world.removeRigidBody(ghost.body);
        // REQ-032: dispose the ghost's thought bubble. Removes its group
        // from the scene and frees every glyph's geometry / material so a
        // hard reset does not leak meshes across reset cycles.
        ghost.thoughtBubble.dispose();
      }
      bucket.ghosts.length = 0;
    }
    // F-014: clear all per-timeline tick clocks alongside the ghost
    // wipe so a fresh game session does not inherit the previous run's
    // clock state.
    tickClocks.clear();
    activeTimeline = nextActiveTimeline;
  };

  const removeGhost: TimelineRegistry["removeGhost"] = (
    ghost,
    scene,
    world,
  ) => {
    for (const bucket of buckets.values()) {
      const idx = bucket.ghosts.indexOf(ghost);
      if (idx === -1) continue;
      bucket.ghosts.splice(idx, 1);
      scene.remove(ghost.mesh);
      world.removeRigidBody(ghost.body);
      ghost.thoughtBubble.dispose();
      return true;
    }
    return false;
  };

  const rehomeGhost: TimelineRegistry["rehomeGhost"] = (
    ghost,
    destinationTimeline,
  ) => {
    for (const [timeline, bucket] of buckets.entries()) {
      const idx = bucket.ghosts.indexOf(ghost);
      if (idx === -1) continue;
      if (timeline === destinationTimeline) return true;
      bucket.ghosts.splice(idx, 1);
      bucketFor(destinationTimeline).ghosts.push(ghost);
      // Reconcile visibility: if the rehome moved the ghost OUT of the
      // active timeline, hide it; if INTO the active timeline, show it.
      // Without this, a ghost rehomed from the active bucket (e.g. a
      // thrown body that crosses a portal while the player is still in
      // the source timeline) would stay visible in the source even
      // though it now belongs elsewhere. Rapier body remains untouched
      // either way (rehome is bookkeeping-only).
      if (destinationTimeline === activeTimeline) {
        ghost.mesh.visible = true;
      } else if (timeline === activeTimeline) {
        ghost.mesh.visible = false;
      }
      return true;
    }
    return false;
  };

  const findGhostByInstanceId: TimelineRegistry["findGhostByInstanceId"] = (
    instanceId,
  ) => {
    for (const bucket of buckets.values()) {
      const found = bucket.ghosts.find((g) => g.instanceId === instanceId);
      if (found) return found;
    }
    return undefined;
  };

  return {
    get activeTimeline(): TimelineId {
      return activeTimeline;
    },
    ghostsFor,
    add,
    setActiveTimeline,
    activeGhosts,
    clearAllGhosts,
    removeGhost,
    rehomeGhost,
    findGhostByInstanceId,
    tickFor,
    advanceActiveTick,
  };
}
