import { describe, expect, it } from "vitest";
import {
  DEFAULT_CYCLE_SECONDS,
  TimeOfDay,
} from "../../src/sim/timeOfDay.ts";

describe("TimeOfDay", () => {
  it("starts at normalized 0 by default", () => {
    const clock = new TimeOfDay();
    expect(clock.normalized()).toBe(0);
    expect(clock.cycleSeconds).toBe(DEFAULT_CYCLE_SECONDS);
  });

  it("advance(dt) increases normalized position proportionally", () => {
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    clock.advance(2.5);
    expect(clock.normalized()).toBeCloseTo(0.25, 6);
  });

  it("wraps normalized position back to 0 when the full cycle elapses", () => {
    const clock = new TimeOfDay({ cycleSeconds: 4 });
    clock.advance(4);
    expect(clock.normalized()).toBeCloseTo(0, 6);
  });

  it("wraps mid-cycle when advance overshoots the cycle length", () => {
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    // 12s into a 10s cycle should land at t = 0.2.
    clock.advance(12);
    expect(clock.normalized()).toBeCloseTo(0.2, 6);
  });

  it("setNormalized clamps inputs into [0, 1) by wrapping", () => {
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    clock.setNormalized(1.25);
    expect(clock.normalized()).toBeCloseTo(0.25, 6);
    clock.setNormalized(-0.25);
    expect(clock.normalized()).toBeCloseTo(0.75, 6);
  });

  it("ignores zero or negative dt", () => {
    const clock = new TimeOfDay({ cycleSeconds: 10 });
    clock.setNormalized(0.4);
    clock.advance(0);
    clock.advance(-3);
    expect(clock.normalized()).toBeCloseTo(0.4, 6);
  });

  it("rejects non-positive cycle lengths", () => {
    expect(() => new TimeOfDay({ cycleSeconds: 0 })).toThrow();
    expect(() => new TimeOfDay({ cycleSeconds: -1 })).toThrow();
  });

  it("rejects non-finite initialNormalized", () => {
    expect(() => new TimeOfDay({ initialNormalized: NaN })).toThrow();
    expect(() => new TimeOfDay({ initialNormalized: Infinity })).toThrow();
  });
});
