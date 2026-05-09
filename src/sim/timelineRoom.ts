/**
 * Per-timeline room state (REQ-015).
 *
 * On a lit-portal traversal the player arrives in a new timeline. The room's
 * VISIBLE state must update to match: the door lit/dark stamping flips to
 * the destination hour's table, and the time-of-day clock snaps so the
 * background tint reads as the destination's hue. Both are pure projections
 * of the destination hour, so this module exposes them as small, testable
 * functions and the host wires them into `wireTraversal`'s
 * `onTimelineEnter` callback.
 *
 * Single source of truth: `doorLitStateAtHour(hour)`. The painted doors and
 * the runtime traversal predicate (which gates entry on the lit half) both
 * read from this same table, so the visual and the behavior cannot drift.
 *
 * NOT in scope this slice:
 *   - REQ-011: deriving lit/dark from arrivals in the recorded timeline.
 *     The static table is still the source of truth here.
 *   - Per-timeline lighting beyond the warm-to-cool tint (e.g. window light
 *     direction, props). The room geometry is fixed by spec (single room).
 */

import { applyDoorLitState } from "../scene/door.ts";
import { doorLitStateAtHour } from "./doorStateAtTime.ts";
import { hourToNormalized } from "./actOneAnchor.ts";
import type { Portal } from "./portal.ts";
import type { TimeOfDay } from "./timeOfDay.ts";

/**
 * Repaint every portal's door mesh to match the lit/dark table for `hour`.
 *
 * Mutates each door's MeshStandardMaterial in place via `applyDoorLitState`.
 * Iteration order matches the input's order so the function is deterministic
 * for tests.
 */
export function repaintDoorsForHour(
  portals: readonly Portal[],
  hour: number,
): void {
  const litByDirection = doorLitStateAtHour(hour);
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
