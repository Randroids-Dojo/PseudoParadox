/**
 * Virtual time-of-day clock for the prototype.
 *
 * Exposes a normalized scalar `t in [0, 1]` representing position within a
 * full day cycle. A value of 0 is the start of the cycle (warm anchor), 0.5
 * is the midpoint (mixed), and 1 wraps back to 0.
 *
 * The clock is locked to the deterministic simulation tick. Progression is
 * driven by integer ticks, not wall-clock seconds, so the same sequence of
 * `advanceTicks` calls always produces the same `normalized()` output
 * regardless of frame rate. This is a precondition for REQ-001 timeline
 * recording playback being deterministic, and for REQ-030 instance tinting
 * being reproducible.
 *
 * Default cycle length: 60 seconds of simulation time per full day at the
 * default 60 ticks per second. Picked so the warm-to-cool tint is visible
 * during a single ~10s playtest without making the room change so fast that
 * it distracts from the puzzle.
 */
export const DEFAULT_CYCLE_SECONDS = 60;
export const DEFAULT_TICKS_PER_SECOND = 60;

export interface TimeOfDayOptions {
  /** Length of one full day cycle in simulation seconds. Must be > 0. */
  cycleSeconds?: number;
  /** Simulation ticks per second. Must be a positive integer. Defaults to 60. */
  ticksPerSecond?: number;
  /** Initial normalized position in [0, 1). Defaults to 0. */
  initialNormalized?: number;
}

/**
 * A small mutable clock. State is an integer tick count modulo the cycle
 * length in ticks. Storing an integer rather than accumulated seconds means
 * advancing N ticks in a single call and advancing one tick N times produce
 * bit-identical results, with no floating-point drift across long sessions.
 */
export class TimeOfDay {
  private tickIndex: number;
  readonly cycleSeconds: number;
  readonly ticksPerSecond: number;
  readonly ticksPerCycle: number;

  constructor(options: TimeOfDayOptions = {}) {
    const cycleSeconds = options.cycleSeconds ?? DEFAULT_CYCLE_SECONDS;
    if (!Number.isFinite(cycleSeconds) || cycleSeconds <= 0) {
      throw new Error(
        `TimeOfDay cycleSeconds must be a positive finite number, got ${cycleSeconds}`,
      );
    }
    const ticksPerSecond = options.ticksPerSecond ?? DEFAULT_TICKS_PER_SECOND;
    if (
      !Number.isFinite(ticksPerSecond) ||
      ticksPerSecond <= 0 ||
      !Number.isInteger(ticksPerSecond)
    ) {
      throw new Error(
        `TimeOfDay ticksPerSecond must be a positive integer, got ${ticksPerSecond}`,
      );
    }
    // Reject non-tick-aligned cycles. Storing a quantized variant of
    // `cycleSeconds` would make the public field disagree with what the
    // caller passed in; the prototype configuration is 60s * 60Hz = 3600
    // ticks exactly, so this constraint costs nothing. An epsilon tolerance
    // accepts mathematically aligned values that an IEEE-754 multiply
    // perturbs slightly (e.g. `0.1 * 10` yields `1.0000000000000002`).
    const product = cycleSeconds * ticksPerSecond;
    const rounded = Math.round(product);
    if (rounded <= 0 || Math.abs(product - rounded) > 1e-9) {
      throw new Error(
        `TimeOfDay cycleSeconds * ticksPerSecond must be a positive integer, got ${product}`,
      );
    }
    const ticksPerCycle = rounded;
    this.cycleSeconds = cycleSeconds;
    this.ticksPerSecond = ticksPerSecond;
    this.ticksPerCycle = ticksPerCycle;
    const initial = options.initialNormalized ?? 0;
    if (!Number.isFinite(initial)) {
      throw new Error(
        `TimeOfDay initialNormalized must be a finite number, got ${initial}`,
      );
    }
    // Floor here rather than round so `setNormalized` is the exact left
    // inverse of `normalized` for tick-aligned values, and so seek-to-start
    // (initial = 0) lands at tick 0.
    this.tickIndex = wrapNonNegative(
      Math.floor(wrapNonNegative(initial, 1) * ticksPerCycle),
      ticksPerCycle,
    );
  }

  /**
   * Advance the clock by `n` integer simulation ticks. Negative or
   * zero values are no-ops; the prototype's fixed-step loop only ever feeds
   * `advanceTicks(1)`, and letting time run backward would invite confusion
   * when wired into the recording timeline.
   *
   * Non-integer or non-finite inputs throw: the contract is that ticks are
   * the discrete unit of progress, and silently rounding here would mask
   * caller bugs.
   */
  advanceTicks(n: number): void {
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`TimeOfDay.advanceTicks requires an integer, got ${n}`);
    }
    if (n <= 0) {
      return;
    }
    this.tickIndex = wrapNonNegative(this.tickIndex + n, this.ticksPerCycle);
  }

  /** Current monotonic tick index modulo the cycle length. */
  tick(): number {
    return this.tickIndex;
  }

  /** Return the current normalized position in [0, 1). */
  normalized(): number {
    return this.tickIndex / this.ticksPerCycle;
  }

  /**
   * Force the clock to a specific normalized position. Inputs outside
   * [0, 1) are wrapped, so `setNormalized(1.25)` is equivalent to
   * `setNormalized(0.25)`. The position is wrapped into [0, 1) and floored
   * to a whole tick so subsequent `advanceTicks` calls stay drift-free.
   */
  setNormalized(n: number): void {
    if (!Number.isFinite(n)) {
      throw new Error(`TimeOfDay.setNormalized requires a finite number, got ${n}`);
    }
    this.tickIndex = wrapNonNegative(
      Math.floor(wrapNonNegative(n, 1) * this.ticksPerCycle),
      this.ticksPerCycle,
    );
  }
}

/**
 * Wrap a value into the half-open interval [0, modulus). JavaScript's `%`
 * operator returns a signed remainder, so a naive `value % modulus` would
 * leave negative inputs negative; this helper folds them back into range.
 * Used for both float (normalized seek) and integer (tick) arithmetic;
 * the operator behaves identically for both.
 */
function wrapNonNegative(value: number, modulus: number): number {
  const r = value % modulus;
  return r < 0 ? r + modulus : r;
}
