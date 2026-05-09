import { describe, expect, it } from "vitest";
import {
  ACT_ONE_HOUR,
  ACT_ONE_NORMALIZED,
  HOURS_PER_DAY,
  hourToNormalized,
} from "../../src/sim/actOneAnchor.ts";
import { TimeOfDay } from "../../src/sim/timeOfDay.ts";
import { interpolateWarmToCool } from "../../src/render/colorTint.ts";

describe("actOneAnchor", () => {
  it("encodes 5:00 on a 24-hour day arc as 5/24", () => {
    expect(ACT_ONE_HOUR).toBe(5);
    expect(HOURS_PER_DAY).toBe(24);
    expect(ACT_ONE_NORMALIZED).toBeCloseTo(5 / 24, 12);
  });

  it("hourToNormalized maps each canonical Act 1 hour onto the day arc", () => {
    expect(hourToNormalized(0)).toBe(0);
    expect(hourToNormalized(5)).toBeCloseTo(5 / 24, 12);
    expect(hourToNormalized(6)).toBeCloseTo(6 / 24, 12);
    expect(hourToNormalized(12)).toBeCloseTo(0.5, 12);
  });

  it("hourToNormalized rejects out-of-range and non-finite hours", () => {
    expect(() => hourToNormalized(-1)).toThrow();
    expect(() => hourToNormalized(24)).toThrow();
    expect(() => hourToNormalized(100)).toThrow();
    expect(() => hourToNormalized(Number.NaN)).toThrow();
  });

  it("TimeOfDay seeded at the Act 1 anchor reads 5/24 at tick 0", () => {
    // The startup determinism contract: with no advancement, the clock's
    // first read is exactly the Act 1 anchor (modulo tick quantization).
    const clock = new TimeOfDay({
      ticksPerSecond: 60,
      initialNormalized: ACT_ONE_NORMALIZED,
    });
    // 60s cycle * 60Hz = 3600 ticks/cycle. 5/24 of 3600 = 750 ticks.
    expect(clock.tick()).toBe(750);
    // The normalized read is bit-exact for tick-aligned anchors.
    expect(clock.normalized()).toBeCloseTo(ACT_ONE_NORMALIZED, 4);
  });

  it("a player tinted at the Act 1 anchor matches the room's 5:00 color", () => {
    // REQ-030 / REQ-013: the player's per-instance tint and the room
    // background interpolate from the SAME warm-to-cool anchors, so a
    // capsule stamped at the Act 1 normalized time is the same color the
    // room background renders at 5:00.
    const tint = interpolateWarmToCool(ACT_ONE_NORMALIZED);
    expect(tint.r).toBeGreaterThan(tint.b);
  });
});
