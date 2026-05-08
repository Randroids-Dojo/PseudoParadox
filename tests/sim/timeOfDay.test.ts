import { describe, expect, it } from "vitest";
import {
  DEFAULT_CYCLE_SECONDS,
  DEFAULT_TICKS_PER_SECOND,
  TimeOfDay,
} from "../../src/sim/timeOfDay.ts";

describe("TimeOfDay", () => {
  it("wraps and floors initialNormalized at construction time", () => {
    // Locks the startup determinism contract: the constructor uses the same
    // wrap-and-floor path setNormalized does, so seeking with an out-of-range
    // initial value lands on the same tick as a constructor-built clock.
    const clock = new TimeOfDay({ cycleSeconds: 10, initialNormalized: 1.251 });
    expect(clock.tick()).toBe(150);
    expect(clock.normalized()).toBeCloseTo(0.25, 12);
  });

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

  it("rejects non-positive cycle lengths", () => {
    expect(() => new TimeOfDay({ cycleSeconds: 0 })).toThrow();
    expect(() => new TimeOfDay({ cycleSeconds: -1 })).toThrow();
  });

  it("rejects non-tick-aligned cycle configurations", () => {
    // 0.5s cycle at 60Hz = 30 ticks (aligned, allowed).
    expect(() => new TimeOfDay({ cycleSeconds: 0.5 })).not.toThrow();
    // 0.51s cycle at 60Hz = 30.6 ticks (not aligned, rejected).
    expect(() => new TimeOfDay({ cycleSeconds: 0.51 })).toThrow();
  });

  it("accepts mathematically aligned configurations despite IEEE-754 noise", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE-754, but multiplied by 10 it
    // is mathematically 3, which is integer-aligned at 10 ticks per second.
    // The constructor should tolerate this within epsilon rather than
    // rejecting a configuration the caller clearly intended.
    const cycleSeconds = 0.1 + 0.2;
    const clock = new TimeOfDay({ cycleSeconds, ticksPerSecond: 10 });
    expect(clock.ticksPerCycle).toBe(3);
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
