/**
 * Door lit/dark state derived from a timeline's recorded arrivals (REQ-011 / REQ-023).
 *
 * The GDD frames a door's lit/dark state as a function of where instances
 * are arriving from in the recorded timeline, not as a discoverable static
 * variable (`docs/gdd/02-time-travel-rules.md` portal-types section).
 *
 * This module wires the data path. The lit-state computation is:
 *
 *   litFor(timeline, cardinal) = seed[timeline][cardinal]
 *                                 && !blockedByArrivals(ghosts, cardinal, timeline)
 *
 * where:
 *
 *   - `seed` is the canonical Acts 1-3 starting state authored by the GDD,
 *     supplied by `DOOR_STATE_BY_HOUR` from `doorStateAtTime.ts`. The seed
 *     captures the lit/dark state of each timeline before any instance has
 *     been recorded into it. PR #16 / PR #18 / this slice authored the
 *     5:00, 6:00, and 12:00 entries.
 *   - `blockedByArrivals(ghosts, cardinal, timeline)` is the arrivals-derived
 *     rule. The Acts 1-3 body (`DEFAULT_BLOCKED_BY_ARRIVALS`) blocks the
 *     North door at 12:00 while ANY scripted-actor ghost in the bucket
 *     still has frames left in its recording (the cinematic actors are
 *     "staffing" the North door). Once every recording-bearing ghost has
 *     reached `tickIndex >= recording.length`, the seed lights through and
 *     the player can escape (REQ-023).
 *
 * For timelines not authored in the seed, `litStateForTimeline` returns
 * `null` and the caller is expected to fall back to the portal's frozen
 * `isLit` flag. The runtime path in `src/app.ts` only ever sits at authored
 * hours (Acts 1-3 use 5, 6, and 12), so this fallback behavior matches what
 * `wireTraversal` did pre-REQ-011 and lets test fixtures that exercise
 * unauthored hours continue to work.
 *
 * NOT in scope this slice:
 *   - REQ-010 dark-door spawn-only enforcement (separate row, still partial).
 *   - The visual transition animation when a door changes lit state during
 *     play. The current consumers (`repaintDoorsForHour`, the traversal lit
 *     gate) re-read the state on every timeline switch; an animated
 *     interpolation is a render concern outside this module.
 *   - F-006 unification of the visual paint path through `litStateForTimeline`.
 *     The painted door at 12:00 reads `north: true` from the seed
 *     unconditionally; the F-006 slice routes the paint through this
 *     function so the cinematic darkens the painted North door too.
 */

import type { DoorDirection } from "../scene/door.ts";
import type { GhostInstance } from "./ghostInstance.ts";
import {
  DOOR_STATE_BY_HOUR,
  type DoorLitByDirection,
} from "./doorStateAtTime.ts";
import type { TimelineId } from "./timelineRegistry.ts";

/**
 * Predicate that decides whether a cardinal door is BLOCKED by the recorded
 * arrivals in a timeline. Returning `true` darkens an otherwise-seeded-lit
 * door. Tests inject an alternate body to exercise the seam in isolation.
 *
 * `ghosts` is the per-timeline ghost list from `TimelineRegistry.ghostsFor`,
 * passed here as a `readonly` view so the predicate cannot mutate the
 * registry's internal arrays. `timeline` is the integer hour the predicate
 * is evaluating; the Acts 1-3 body uses it to scope the cinematic-actor
 * arrivals rule to the 12:00 bucket only.
 */
export type BlockedByArrivals = (
  ghosts: readonly GhostInstance[],
  cardinal: DoorDirection,
  timeline?: number,
) => boolean;

/**
 * Acts 1-3 arrivals-derived rule (REQ-023):
 *
 *   - At 12:00 (the escape timeline), the North door is BLOCKED while any
 *     scripted-actor ghost in the bucket still has frames left in its
 *     recording (`tickIndex < recording.length`). The cinematic actors are
 *     "staffing" the door while in flight; once every recording-bearing
 *     ghost has completed, the seed lights through and the player can
 *     escape.
 *   - Every other (timeline, cardinal) pair is unblocked. Acts 1-3 do not
 *     have any other narrative beat that blocks a door via arrivals.
 *
 * The arrivals rule can ONLY DARKEN a seed-lit door; a seed-dark door stays
 * dark regardless (the rule is `seed && !blocked`). This matches the GDD
 * intent that the seeded state is the ground truth for "this door has
 * nothing arriving here" and arrivals can only subtract from that.
 */
export const DEFAULT_BLOCKED_BY_ARRIVALS: BlockedByArrivals = (
  ghosts,
  cardinal,
  timeline,
) => {
  // Only the North door at 12:00 has an arrivals-driven block today.
  if (timeline !== 12) return false;
  if (cardinal !== "north") return false;
  // Any ghost mid-recording counts as a cinematic actor in flight. The
  // 1-frame body ghost from `mountAct1Cinematic` finishes after one
  // `advanceTick`; the dragger ghosts finish after `ACT1_CINEMATIC_DURATION_TICKS`.
  // Once every ghost has `tickIndex >= recording.length`, the door lights.
  return ghosts.some((g) => g.tickIndex < g.recording.length);
};

export interface LitStateForTimelineOptions {
  /**
   * Per-timeline ghost list. Pass `registry.ghostsFor(timeline)` from the
   * caller; the function does not look up the registry itself so the data
   * dependency is explicit and tests can drive the function with a literal
   * array.
   */
  ghosts: readonly GhostInstance[];
  /**
   * Optional override for the arrivals predicate. Tests inject an alternate
   * body to exercise the blocked-by-arrivals branch; the runtime uses the
   * default (which returns `false`).
   */
  blockedByArrivals?: BlockedByArrivals;
}

/**
 * Compute the lit/dark state of every cardinal door in `timeline`.
 *
 * Returns `null` for timelines that are not authored in the seed; callers
 * fall back to the portal's frozen `isLit` flag in that case. Returns a
 * fresh `DoorLitByDirection` object (NOT the seed object itself) when at
 * least one cardinal is overridden by arrivals; otherwise returns the seed
 * object directly so reference-equality regression tests can still match.
 */
export function litStateForTimeline(
  timeline: TimelineId,
  options: LitStateForTimelineOptions,
): DoorLitByDirection | null {
  const seed = DOOR_STATE_BY_HOUR[timeline];
  if (!seed) return null;
  const { ghosts, blockedByArrivals = DEFAULT_BLOCKED_BY_ARRIVALS } = options;

  const cardinals: readonly DoorDirection[] = [
    "north",
    "south",
    "east",
    "west",
  ];

  let overridden = false;
  const result: Record<DoorDirection, boolean> = {
    north: seed.north,
    south: seed.south,
    east: seed.east,
    west: seed.west,
  };
  for (const cardinal of cardinals) {
    if (seed[cardinal] && blockedByArrivals(ghosts, cardinal, timeline)) {
      result[cardinal] = false;
      overridden = true;
    }
  }
  return overridden ? result : seed;
}

/**
 * Convenience: read a single cardinal's lit state for `timeline`. Returns
 * `null` when the timeline is unauthored.
 */
export function litStateForCardinal(
  timeline: TimelineId,
  cardinal: DoorDirection,
  options: LitStateForTimelineOptions,
): boolean | null {
  const state = litStateForTimeline(timeline, options);
  if (state === null) return null;
  return state[cardinal];
}
