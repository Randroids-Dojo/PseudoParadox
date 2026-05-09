/**
 * Door lit/dark state derived from a timeline's recorded arrivals (REQ-011).
 *
 * The GDD frames a door's lit/dark state as a function of where instances
 * are arriving from in the recorded timeline, not as a discoverable static
 * variable (`docs/gdd/02-time-travel-rules.md` portal-types section).
 *
 * This module wires the data path. The lit-state computation is:
 *
 *   litFor(timeline, cardinal) = seed[timeline][cardinal]
 *                                 && !blockedByArrivals(ghosts, cardinal)
 *
 * where:
 *
 *   - `seed` is the canonical Acts 1-3 starting state authored by the GDD,
 *     supplied by `DOOR_STATE_BY_HOUR` from `doorStateAtTime.ts`. The seed
 *     captures the lit/dark state of each timeline before any instance has
 *     been recorded into it. PR #16 / PR #18 authored the 5:00 and 6:00
 *     entries; future slices can extend the seed for additional timelines.
 *   - `blockedByArrivals(ghosts, cardinal)` is the arrivals-derived rule.
 *     Today the body returns `false` for all inputs (no Acts 1-3 narrative
 *     beat blocks a door via arrivals yet). The hook is the data path that
 *     future slices implementing Acts 2-3 narrative beats will populate.
 *
 * For timelines not authored in the seed, `litStateForTimeline` returns
 * `null` and the caller is expected to fall back to the portal's frozen
 * `isLit` flag. The runtime path in `src/app.ts` only ever sits at authored
 * hours (Acts 1-3 use 5, 6, and 12; the seed authors 5 and 6), so this
 * fallback behavior matches what `wireTraversal` did pre-REQ-011 and lets
 * test fixtures that exercise unauthored hours continue to work.
 *
 * NOT in scope this slice:
 *   - The actual Act 2 / Act 3 arrival rules that would make
 *     `blockedByArrivals` return `true` for some `(ghosts, cardinal)` pair.
 *     The body is a stub; the seam lets a future slice swap the body in
 *     without touching every call site.
 *   - REQ-010 dark-door spawn-only enforcement (separate row, still partial).
 *   - The visual transition animation when a door changes lit state during
 *     play. The current consumers (`repaintDoorsForHour`, the traversal lit
 *     gate) re-read the state on every timeline switch; an animated
 *     interpolation is a render concern outside this module.
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
 * door. The MVP body is `() => false` (`DEFAULT_BLOCKED_BY_ARRIVALS`); tests
 * inject an alternate body to exercise the seam.
 *
 * `ghosts` is the per-timeline ghost list from `TimelineRegistry.ghostsFor`,
 * passed here as a `readonly` view so the predicate cannot mutate the
 * registry's internal arrays.
 */
export type BlockedByArrivals = (
  ghosts: readonly GhostInstance[],
  cardinal: DoorDirection,
) => boolean;

/**
 * The MVP arrivals-derived rule. Acts 1-3 do not yet have a narrative beat
 * that blocks a door via arrivals (the canonical seeded states already hold
 * the GDD's intent). Future slices will replace this body.
 */
export const DEFAULT_BLOCKED_BY_ARRIVALS: BlockedByArrivals = () => false;

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
    if (seed[cardinal] && blockedByArrivals(ghosts, cardinal)) {
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
