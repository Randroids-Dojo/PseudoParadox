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
    const ticksPerCycle = Math.round(cycleSeconds * ticksPerSecond);
    if (ticksPerCycle <= 0) {
      throw new Error(
        `TimeOfDay cycleSeconds * ticksPerSecond must round to a positive integer, got ${ticksPerCycle}`,
      );
    }
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
    this.tickIndex = wrapNonNegativeInt(
      Math.floor(wrapNonNegativeFloat(initial, 1) * ticksPerCycle),
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
    this.tickIndex = wrapNonNegativeInt(this.tickIndex + n, this.ticksPerCycle);
  }

  /**
   * Advance the clock by `dtSeconds` of simulation time, expressed as a
   * whole number of ticks. `dtSeconds` is converted to ticks by rounding,
   * so callers passing the renderer's frame delta do not need to know
   * about tick granularity. Use `advanceTicks` directly from inside the
   * fixed-step loop where exactness matters.
   *
   * Negative or non-finite deltas are clamped to zero.
   */
  advanceSeconds(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }
    const ticks = Math.round(dtSeconds * this.ticksPerSecond);
    if (ticks <= 0) {
      return;
    }
    this.tickIndex = wrapNonNegativeInt(this.tickIndex + ticks, this.ticksPerCycle);
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
   * `setNormalized(0.25)`. The position is snapped to the nearest whole
   * tick so subsequent `advanceTicks` calls stay drift-free.
   */
  setNormalized(n: number): void {
    if (!Number.isFinite(n)) {
      throw new Error(`TimeOfDay.setNormalized requires a finite number, got ${n}`);
    }
    this.tickIndex = wrapNonNegativeInt(
      Math.floor(wrapNonNegativeFloat(n, 1) * this.ticksPerCycle),
      this.ticksPerCycle,
    );
  }
}

/**
 * Wrap a non-negative-modulus float into [0, modulus). JavaScript's `%`
 * operator returns a signed remainder, so a naive `value % modulus` would
 * leave negative inputs negative.
 */
function wrapNonNegativeFloat(value: number, modulus: number): number {
  const r = value % modulus;
  return r < 0 ? r + modulus : r;
}

/**
 * Integer variant of the wrap above. Kept separate so the tick-arithmetic
 * path never goes through float modulus, which would silently truncate at
 * Number.MAX_SAFE_INTEGER scale.
 */
function wrapNonNegativeInt(value: number, modulus: number): number {
  const r = value % modulus;
  return r < 0 ? r + modulus : r;
}
