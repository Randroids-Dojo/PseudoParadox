import { describe, expect, it } from "vitest";
import {
  DEFAULT_CYCLE_SECONDS,
  DEFAULT_TICKS_PER_SECOND,
  TimeOfDay,
} from "../../src/sim/timeOfDay.ts";

describe("TimeOfDay", () => {
  it("starts at normalized 0 and tick 0 by default", () => {
    const clock = new TimeOfDay();
    expect(clock.normalized()).toBe(0);
    expect(clock.tick()).toBe(0);
    expect(clock.cycleSeconds).toBe(DEFAULT_CYCLE_SECONDS);
    expect(clock.ticksPerSecond).toBe(DEFAULT_TICKS_PER_SECOND);
    expect(clock.ticksPerCycle).toBe(
      DEFAULT_CYCLE_SECONDS * DEFAULT_TICKS_PER_SECOND,
    );
  });

  it("advanceTicks increases the normalized position by exactly n / ticksPerCycle", () => {
    // 10 second cycle at 60Hz means 600 ticks per cycle. 150 ticks lands at 0.25.
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    clock.advanceTicks(150);
    expect(clock.normalized()).toBeCloseTo(0.25, 12);
    expect(clock.tick()).toBe(150);
  });

  it("advanceTicks(N) and N x advanceTicks(1) produce identical state", () => {
    // The deterministic-replay contract: stepping the same tick count
    // through the same seed always produces the same normalized output,
    // regardless of whether the loop fired in big or small chunks.
    const bulk = new TimeOfDay({ cycleSeconds: 10 });
    const onesy = new TimeOfDay({ cycleSeconds: 10 });
    bulk.advanceTicks(523);
    for (let i = 0; i < 523; i += 1) {
      onesy.advanceTicks(1);
    }
    expect(bulk.tick()).toBe(onesy.tick());
    expect(bulk.normalized()).toBe(onesy.normalized());
  });

  it("advanceTicks does not drift across many cycles", () => {
    // A pathological frame-delta-driven implementation would accumulate
    // float error after a million updates. The integer-tick implementation
    // returns to bit-exact zero after exactly ticksPerCycle ticks.
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    const cycles = 1000;
    clock.advanceTicks(clock.ticksPerCycle * cycles);
    expect(clock.tick()).toBe(0);
    expect(clock.normalized()).toBe(0);
  });

  it("wraps normalized position back to 0 when the full cycle elapses", () => {
    const clock = new TimeOfDay({ cycleSeconds: 4 });
    clock.advanceTicks(clock.ticksPerCycle);
    expect(clock.normalized()).toBe(0);
    expect(clock.tick()).toBe(0);
  });

  it("wraps mid-cycle when advanceTicks overshoots the cycle length", () => {
    // 10s cycle at 60Hz = 600 ticks. 720 ticks should land at 120 ticks = t = 0.2.
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    clock.advanceTicks(720);
    expect(clock.tick()).toBe(120);
    expect(clock.normalized()).toBeCloseTo(0.2, 12);
  });

  it("setNormalized clamps inputs into [0, 1) by wrapping and snaps to ticks", () => {
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    clock.setNormalized(1.25);
    expect(clock.normalized()).toBeCloseTo(0.25, 12);
    clock.setNormalized(-0.25);
    expect(clock.normalized()).toBeCloseTo(0.75, 12);
  });

  it("ignores zero or negative tick deltas", () => {
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    clock.setNormalized(0.4);
    const before = clock.tick();
    clock.advanceTicks(0);
    clock.advanceTicks(-3);
    expect(clock.tick()).toBe(before);
  });

  it("rejects non-integer tick deltas", () => {
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    expect(() => clock.advanceTicks(2.5)).toThrow();
    expect(() => clock.advanceTicks(NaN)).toThrow();
    expect(() => clock.advanceTicks(Infinity)).toThrow();
  });

  it("advanceSeconds rounds to the nearest whole tick", () => {
    // Convenience API for callers outside the fixed-step loop. 2.5 simulation
    // seconds at 60Hz rounds to 150 ticks regardless of float precision.
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    clock.advanceSeconds(2.5);
    expect(clock.tick()).toBe(150);
    expect(clock.normalized()).toBeCloseTo(0.25, 12);
  });

  it("advanceSeconds ignores zero or negative dt", () => {
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    clock.setNormalized(0.4);
    const before = clock.tick();
    clock.advanceSeconds(0);
    clock.advanceSeconds(-3);
    expect(clock.tick()).toBe(before);
  });

  it("rejects non-positive cycle lengths", () => {
    expect(() => new TimeOfDay({ cycleSeconds: 0 })).toThrow();
    expect(() => new TimeOfDay({ cycleSeconds: -1 })).toThrow();
  });

  it("rejects non-integer or non-positive ticksPerSecond", () => {
    expect(() => new TimeOfDay({ ticksPerSecond: 0 })).toThrow();
    expect(() => new TimeOfDay({ ticksPerSecond: -60 })).toThrow();
    expect(() => new TimeOfDay({ ticksPerSecond: 59.5 })).toThrow();
  });

  it("rejects non-finite initialNormalized", () => {
    expect(() => new TimeOfDay({ initialNormalized: NaN })).toThrow();
    expect(() => new TimeOfDay({ initialNormalized: Infinity })).toThrow();
  });
});
