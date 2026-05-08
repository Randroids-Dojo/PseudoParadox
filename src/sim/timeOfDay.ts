/**
 * Virtual time-of-day clock for the prototype.
 *
 * Exposes a normalized scalar `t in [0, 1]` representing position within a
 * full day cycle. A value of 0 is the start of the cycle (warm anchor), 0.5
 * is the midpoint (mixed), and 1 wraps back to 0.
 *
 * For the prototype the cycle is driven off real time at a configurable
 * cycle length. A future slice (REQ-001 dependency) will replace `advance`
 * with a deterministic simulation tick so timeline recording stays
 * frame-exact across replays. See `docs/FOLLOWUPS.md` and the dot queue.
 *
 * Default cycle length: 60 seconds of real time per full day. Picked so the
 * warm-to-cool tint is visible during a single ~10s playtest without
 * making the room change so fast that it distracts from the puzzle.
 */
export const DEFAULT_CYCLE_SECONDS = 60;

export interface TimeOfDayOptions {
  /** Length of one full day cycle in seconds. Must be > 0. */
  cycleSeconds?: number;
  /** Initial normalized position in [0, 1). Defaults to 0. */
  initialNormalized?: number;
}

/**
 * A small mutable clock. Keep state minimal: only the elapsed seconds within
 * the current cycle. The normalized output is derived; this avoids drift
 * from accumulating fractional position values directly.
 */
export class TimeOfDay {
  private elapsedSeconds: number;
  readonly cycleSeconds: number;

  constructor(options: TimeOfDayOptions = {}) {
    const cycleSeconds = options.cycleSeconds ?? DEFAULT_CYCLE_SECONDS;
    if (!Number.isFinite(cycleSeconds) || cycleSeconds <= 0) {
      throw new Error(
        `TimeOfDay cycleSeconds must be a positive finite number, got ${cycleSeconds}`,
      );
    }
    this.cycleSeconds = cycleSeconds;
    const initial = options.initialNormalized ?? 0;
    this.elapsedSeconds = wrapNonNegative(initial, 1) * cycleSeconds;
  }

  /**
   * Advance the clock by `dtSeconds`. Negative deltas are clamped to zero;
   * the prototype's render loop only ever feeds positive frame deltas, and
   * letting time run backward here would invite confusion when later wired
   * to a deterministic sim tick.
   */
  advance(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }
    this.elapsedSeconds = wrapNonNegative(
      this.elapsedSeconds + dtSeconds,
      this.cycleSeconds,
    );
  }

  /** Return the current normalized position in [0, 1). */
  normalized(): number {
    return this.elapsedSeconds / this.cycleSeconds;
  }

  /**
   * Force the clock to a specific normalized position. Inputs outside
   * [0, 1) are wrapped, so `setNormalized(1.25)` is equivalent to
   * `setNormalized(0.25)`.
   */
  setNormalized(n: number): void {
    if (!Number.isFinite(n)) {
      throw new Error(`TimeOfDay.setNormalized requires a finite number, got ${n}`);
    }
    this.elapsedSeconds = wrapNonNegative(n, 1) * this.cycleSeconds;
  }
}

/**
 * Wrap a value into the half-open interval [0, modulus). Handles negative
 * inputs the way games tend to want: `-0.25` modulo `1` returns `0.75`,
 * not `-0.25`. JavaScript's `%` operator returns a signed remainder.
 */
function wrapNonNegative(value: number, modulus: number): number {
  const r = value % modulus;
  return r < 0 ? r + modulus : r;
}
