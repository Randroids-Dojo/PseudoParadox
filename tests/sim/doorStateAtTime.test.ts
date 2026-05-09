import { describe, expect, it } from "vitest";
import {
  DOOR_STATE_BY_HOUR,
  doorLitStateAtHour,
} from "../../src/sim/doorStateAtTime.ts";

describe("doorStateAtTime", () => {
  it("lights South and East and darkens North and West at 5:00 (REQ-013/REQ-014)", () => {
    const state = doorLitStateAtHour(5);
    expect(state.south).toBe(true);
    expect(state.east).toBe(true);
    expect(state.north).toBe(false);
    expect(state.west).toBe(false);
  });

  it("lights only the West door at 6:00 (REQ-015 forward-author)", () => {
    const state = doorLitStateAtHour(6);
    expect(state.west).toBe(true);
    expect(state.south).toBe(false);
    expect(state.east).toBe(false);
    expect(state.north).toBe(false);
  });

  it("DOOR_STATE_BY_HOUR is the source-of-truth table", () => {
    // Regression guard: the table object IS the inputs to
    // `doorLitStateAtHour`, so a future slice cannot accidentally fork the
    // two without this test catching it.
    expect(doorLitStateAtHour(5)).toBe(DOOR_STATE_BY_HOUR[5]);
    expect(doorLitStateAtHour(6)).toBe(DOOR_STATE_BY_HOUR[6]);
  });

  it("throws for hours that are not authored", () => {
    expect(() => doorLitStateAtHour(0)).toThrow(/0/);
    expect(() => doorLitStateAtHour(12)).toThrow(/12/);
    expect(() => doorLitStateAtHour(23)).toThrow(/23/);
  });

  it("rejects non-integer hours", () => {
    expect(() => doorLitStateAtHour(5.5)).toThrow();
    expect(() => doorLitStateAtHour(Number.NaN)).toThrow();
  });
});
