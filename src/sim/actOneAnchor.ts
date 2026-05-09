/**
 * Act 1 spawn-pose anchors (REQ-013 / REQ-014).
 *
 * The prototype's day arc is a 24-hour clock: `t = 0.0` is midnight and
 * `t = 1.0` wraps back to midnight. Hours map linearly with
 * `t = hours / 24`. This is the convention used everywhere a normalized
 * time is paired with a wall-clock hour (portal destinations in
 * `src/sim/portal.ts`, the warm-to-cool tint inputs, and the spawn anchor
 * here). Picked over a tighter [4:00, 8:00] mapping because the GDD calls
 * out 5:00, 6:00, and 12:00 explicitly and a 24-hour arc lets all three
 * sit on the same scalar without remapping.
 *
 * Act 1 opens at 5:00, so the canonical opening normalized time is 5/24.
 * Both the `TimeOfDay` clock and the active player's `originNormalized`
 * tint stamp anchor here so the room's background, the player capsule's
 * color, and any door state derived from the current time all agree at
 * frame zero.
 */
export const ACT_ONE_HOUR = 5;
export const HOURS_PER_DAY = 24;
export const ACT_ONE_NORMALIZED = ACT_ONE_HOUR / HOURS_PER_DAY;

/**
 * Convert an hour-of-day in `[0, 24)` to its normalized `[0, 1)` position
 * on the canonical day arc. Single source of truth so callers cannot pick
 * a different mapping from the portal module's `portalDestinationNormalized`.
 *
 * Validates the input range so a typo (e.g. `25`) throws at the boundary
 * rather than silently producing a normalized value greater than 1.
 */
export function hourToNormalized(hours: number): number {
  if (!Number.isFinite(hours)) {
    throw new Error(`hourToNormalized requires a finite number, got ${hours}`);
  }
  if (hours < 0 || hours >= HOURS_PER_DAY) {
    throw new Error(
      `hourToNormalized requires hours in [0, ${HOURS_PER_DAY}), got ${hours}`,
    );
  }
  return hours / HOURS_PER_DAY;
}
