/**
 * Per-timeline room state (REQ-015 / REQ-011).
 *
 * On a lit-portal traversal the player arrives in a new timeline. The room's
 * VISIBLE state must update to match: the door lit/dark stamping flips to
 * the destination hour's table, and the time-of-day clock snaps so the
 * background tint reads as the destination's hue. Both are pure projections
 * of the destination hour, so this module exposes them as small, testable
 * functions and the host wires them into `wireTraversal`'s
 * `onTimelineEnter` callback.
 *
 * Single source of truth: `litStateForTimeline(hour, { ghosts })`. The
 * painted doors and the runtime traversal predicate
 * (`isLitForCurrentTimeline` in `portalTraversal.ts`) both read from this
 * same function, so the visual and the behavior cannot drift even when
 * arrivals-derived rules darken seed-lit doors (e.g. the Act 3 cinematic
 * blocking the North door at 12:00 until every actor completes). When the
 * caller has no ghosts available (e.g. boot-time initial paint before any
 * registry exists), the default empty array yields the seed answer, which
 * is correct because there are no recorded arrivals yet by definition.
 *
 * NOT in scope this slice:
 *   - Per-timeline lighting beyond the warm-to-cool tint (e.g. window light
 *     direction, props). The room geometry is fixed by spec (single room).
 */

import { applyDoorLitState } from "../scene/door.ts";
import { doorLitStateAtHour } from "./doorStateAtTime.ts";
import { hourToNormalized } from "./actOneAnchor.ts";
import { litStateForTimeline } from "./litStateForTimeline.ts";
import type { Portal } from "./portal.ts";
import type { TimeOfDay } from "./timeOfDay.ts";
import type { GhostInstance } from "./ghostInstance.ts";

/**
 * Repaint every portal's door mesh to match the lit/dark state for
 * `hour`, taking into account any arrivals-derived rules (REQ-011)
 * driven by `ghosts`.
 *
 * Mutates each door's MeshStandardMaterial in place via
 * `applyDoorLitState`. Iteration order matches the input's order so the
 * function is deterministic for tests.
 *
 * `ghosts` defaults to `[]` so boot-time callers without a registry get
 * the seed answer; runtime callers (per-traversal repaint, hard reset)
 * pass `registry.ghostsFor(hour)` so the paint reflects the arrivals
 * body in the same call.
 */
export function repaintDoorsForHour(
  portals: readonly Portal[],
  hour: number,
  ghosts: readonly GhostInstance[] = [],
): void {
  // `litStateForTimeline` returns `null` for unauthored hours; fall
  // back to the seed lookup in that case (its own error path raises
  // a clear `doorLitStateAtHour has no authored state for hour ...`
  // message, preserving the prior behavior).
  const litByDirection =
    litStateForTimeline(hour, { ghosts }) ?? doorLitStateAtHour(hour);
  for (const portal of portals) {
    applyDoorLitState(portal.door, litByDirection[portal.direction]);
  }
}

/**
 * Snap a `TimeOfDay` clock so its `normalized()` reads the start of `hour`.
 *
 * The clock's tick storage is integer-modulo, so the snap is exact for
 * authored hours (5, 6, 12) at the prototype's 60s/60Hz cycle. Any future
 * `advanceTicks` calls continue from the snapped tick without drift.
 */
export function snapClockToHour(timeOfDay: TimeOfDay, hour: number): void {
  timeOfDay.setNormalized(hourToNormalized(hour));
}
