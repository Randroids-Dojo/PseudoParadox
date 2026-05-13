/**
 * Host-side projection helpers that build the `ActStateSnapshot` the
 * `ActStateObserver` consumes once per fixed step (F-019 wiring).
 *
 * The patterns here mirror the one-off `projectGhost` and
 * `buildActStateSnapshot` helpers that tests/sim/endToEndCompletability.test.ts
 * grew inline. Promoting them to a real module lets the host
 * (`src/app.ts`) and any future end-to-end test share one path so
 * the observer's input shape is single-source.
 *
 * NOT in scope this module:
 *   - Tracking the recent-West-entries ring buffer. That is the
 *     observer's own state, written by the host's portal-overlap
 *     callback via `observer.recordWestEntry(...)`.
 *   - Tracking `activePlayerCrossedNorthAt12`. That is a host-owned
 *     boolean toggled by the same portal-overlap callback; the host
 *     passes its current value through the `options` argument.
 */

import type {
  ActStateSnapshot,
  BucketGhostSnapshot,
  WestEntry,
} from "./actState.ts";
import type { GhostInstance } from "./ghostInstance.ts";
import type { ActivePlayerHandle } from "./portalTraversal.ts";
import type { TimelineRegistry } from "./timelineRegistry.ts";

/**
 * Pure projection: read the fields the observer needs from a live
 * `GhostInstance`. Exposed for reuse by tests and by the host's
 * snapshot builder.
 */
export function projectGhost(g: GhostInstance): BucketGhostSnapshot {
  const t = g.body.translation();
  return {
    id: g.instanceId,
    position: { x: t.x, z: t.z },
    consciousness: g.consciousness,
    originNormalized: g.originNormalized,
    tickIndex: g.tickIndex,
    recordingLength: g.recording.length,
  };
}

export interface BuildActStateSnapshotOptions {
  /** Pass `observer.recentWestEntries()`; defaults to an empty array. */
  readonly recentWestEntries?: readonly WestEntry[];
  /**
   * Host-tracked boolean: did the active player cross the North
   * trigger volume at 12:00 since the watermark last advanced?
   * Defaults to `false`.
   */
  readonly activePlayerCrossedNorthAt12?: boolean;
}

/**
 * Build the snapshot the observer's `update(snapshot)` consumes.
 * Caller threads in:
 *
 *   - the live `TimelineRegistry` (the observer reads buckets by
 *     timeline via the `ghostsFor` projection).
 *   - the live `ActivePlayerHandle` (the observer reads the active
 *     player's planar position, instanceId, consciousness, and
 *     carry state).
 *   - the West-entries ring buffer (`observer.recentWestEntries()`).
 *   - the boolean toggle for the North-12 cross (host-owned).
 *
 * Returns a fresh snapshot object every call. The contained
 * `ghostsFor` closure captures `registry` so each predicate
 * evaluation reads the live bucket; this matches the test
 * harness's behavior and lets `evaluateActState` walk the chain
 * without further host hooks.
 */
export function buildActStateSnapshot(
  registry: TimelineRegistry,
  player: ActivePlayerHandle,
  options: BuildActStateSnapshotOptions = {},
): ActStateSnapshot {
  const t = player.body.translation();
  return {
    registry: {
      activeTimeline: registry.activeTimeline,
      ghostsFor: (timeline) => registry.ghostsFor(timeline).map(projectGhost),
    },
    instances: [],
    currentTimeline: registry.activeTimeline,
    activePlayer: {
      instanceId: player.instanceId,
      position: { x: t.x, z: t.z },
      consciousness: player.consciousness,
      carry: player.carry,
    },
    recentWestEntries: options.recentWestEntries ?? [],
    activePlayerCrossedNorthAt12:
      options.activePlayerCrossedNorthAt12 ?? false,
  };
}
