/**
 * Per-timeline ghost bookkeeping (REQ-001 deepening / REQ-003 done /
 * REQ-006 partial).
 *
 * The simulation's active state is now keyed by a `TimelineId` (the
 * destination hour of the timeline the active player is currently in). Every
 * ghost spawned by a portal traversal is filed against the timeline it was
 * RECORDED IN (the timeline being LEFT BEHIND), not the destination. When the
 * active player traverses to a new timeline, the registry:
 *
 *   1. Hides every ghost in the leaving timeline (mesh.visible = false; body
 *      velocity zeroed so the inactive ghost does not coast through the room
 *      under residual momentum).
 *   2. Resets every ghost in the entering timeline back to its tick-0 spawn
 *      pose and makes it visible. Each timeline visit is a fresh playback
 *      (REQ-001's "they replay" reading); the cleaner mental model is that
 *      the timeline records WHAT happened, and re-entering replays it from
 *      the start.
 *
 * The host's per-fixed-step loop drives `activeGhosts()` rather than every
 * spawned ghost, so inactive ghosts neither tick nor render. An unvisited
 * timeline returns an empty list (REQ-006: a time period only contains
 * events once an instance has entered it).
 *
 * Only three timelines are reachable in the prototype scope (Acts 1-3 use
 * 5:00, 6:00, and 12:00), so a `Map<number, Bucket>` keyed by integer hour
 * is sufficient. A full normalized-position key would be more general but
 * over-engineered here; if the GDD ever introduces sub-hour resolution, the
 * key becomes the existing normalized scalar without changing this module's
 * public shape.
 *
 * NOT in scope this slice:
 *   - REQ-007 instance generation numbering (separate dot).
 *   - REQ-011 lit/dark derived from arrivals (still reads from the static
 *     table). The registry exposes the per-timeline ghost count that REQ-011
 *     will eventually consume.
 *   - Despawning ghosts (they live forever; the prototype scope has bounded
 *     ghost counts because the puzzle resolves in Acts 2 / 3).
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
   * Switch the active timeline. Hides every ghost in the leaving bucket
   * (their bodies are also stilled so they do not coast under residual
   * velocity) and resets every ghost in the entering bucket back to its
   * tick-0 spawn pose and makes it visible. Idempotent on a no-op switch
   * (next === current).
   */
  setActiveTimeline: (next: TimelineId) => void;
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
    // room under residual velocity. Keep its translation (so re-entering
    // does not rely on tracking a separate "last-known position"; on
    // re-entry the ghost is reset to tick 0 anyway).
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

  const setActiveTimeline: TimelineRegistry["setActiveTimeline"] = (next) => {
    if (next === activeTimeline) return;
    const leaving = bucketFor(activeTimeline);
    for (const ghost of leaving.ghosts) {
      hideGhost(ghost);
    }
    const entering = bucketFor(next);
    for (const ghost of entering.ghosts) {
      showAndResetGhost(ghost);
    }
    activeTimeline = next;
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
    activeTimeline = nextActiveTimeline;
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
  };
}
