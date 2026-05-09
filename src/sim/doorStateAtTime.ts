/**
 * Door lit/dark lookup keyed by current-time hour (REQ-013 / REQ-014 / REQ-023).
 *
 * The Act 1 spawn pose at 5:00 needs an explicit answer to "for the time
 * the room is currently rendering, which doors are lit and which are dark?"
 * The canonical answer per the GDD (`docs/gdd/03-story-acts-1-3.md`):
 *
 *   - At 5:00: South lit, East lit, North dark, West dark.
 *   - At 6:00: West lit; all other doors dark (REQ-015).
 *   - At 12:00: North lit (escape door); all other doors dark (REQ-023).
 *     The North door's lit/dark state is then DARKENED by the
 *     `BlockedByArrivals` rule in `litStateForTimeline` while the cinematic
 *     scripted-actor ghosts have not yet completed their recordings, so
 *     the seeded `north: true` reads as the post-cinematic escape state.
 *
 * The 12:00 entry's South / East / West are sealed dark per the GDD: 12:00
 * is the escape timeline, the player has only one place to go (out the
 * North door), and the cinematic does not hand off to a non-North portal.
 *
 * REQ-011 already replaced direct callers in the runtime traversal gate
 * with the `litStateForTimeline` derivation. The visual paint path
 * (`repaintDoorsForHour`, `room.ts`) still calls this table directly; the
 * F-006 unification slice will route the paint through `litStateForTimeline`
 * so the cinematic darkens the painted North door at 12:00 too.
 */

import type { DoorDirection } from "../scene/door.ts";

/** A snapshot of which cardinal doors are lit at a particular hour. */
export type DoorLitByDirection = Readonly<Record<DoorDirection, boolean>>;

/**
 * The canonical lit/dark table, keyed by integer hour-of-day. Hours that
 * are not present have no authored state and `doorLitStateAtHour` will
 * throw rather than silently returning a default.
 */
export const DOOR_STATE_BY_HOUR: Readonly<Record<number, DoorLitByDirection>> =
  Object.freeze({
    5: Object.freeze({
      north: false,
      south: true,
      east: true,
      west: false,
    }),
    6: Object.freeze({
      north: false,
      south: false,
      east: false,
      west: true,
    }),
    12: Object.freeze({
      north: true,
      south: false,
      east: false,
      west: false,
    }),
  });

/**
 * Look up the lit/dark state of every cardinal door at the given hour.
 *
 * Throws if the hour is not authored. Tests and the room builder are
 * expected to call this with a known-good hour (today: 5 or 6).
 */
export function doorLitStateAtHour(hours: number): DoorLitByDirection {
  if (!Number.isFinite(hours) || !Number.isInteger(hours)) {
    throw new Error(
      `doorLitStateAtHour requires an integer hour, got ${hours}`,
    );
  }
  const state = DOOR_STATE_BY_HOUR[hours];
  if (!state) {
    throw new Error(
      `doorLitStateAtHour has no authored state for hour ${hours}`,
    );
  }
  return state;
}
