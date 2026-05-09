/**
 * Door lit/dark lookup keyed by current-time hour (REQ-013 / REQ-014).
 *
 * The Act 1 spawn pose at 5:00 needs an explicit answer to "for the time
 * the room is currently rendering, which doors are lit and which are dark?"
 * The canonical answer per the GDD (`docs/gdd/03-story-acts-1-3.md`):
 *
 *   - At 5:00: South lit, East lit, North dark, West dark.
 *   - At 6:00: West lit; all other doors dark (REQ-015).
 *
 * Other timelines (12:00 cinematic, Act 3 escape) are not authored yet and
 * will land in their own slices. The 12:00 timeline's North-door-open
 * escape state (REQ-023) is a beat-conditional rather than a flat lookup,
 * so it does not belong here.
 *
 * The 6:00 entry is documented even though only 5:00 is reachable at the
 * current point in the build; locking it in now so the next slice (REQ-015
 * "6:00 timeline state") drops in cleanly without a second author pass.
 *
 * REQ-011 will replace this static table with a derivation over the
 * recorded timeline. Until then, the table is the source of truth and the
 * runtime trusts it.
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
