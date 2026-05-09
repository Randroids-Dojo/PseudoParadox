import { describe, expect, it } from "vitest";
import {
  PLAYER_SPEED_MPS,
  inputToVelocity,
  type KeyState,
} from "../../src/input/keyboard.ts";

const NEUTRAL: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
};

const state = (overrides: Partial<KeyState>): KeyState => ({
  ...NEUTRAL,
  ...overrides,
});

describe("inputToVelocity", () => {
  it("returns zero velocity when no keys are pressed", () => {
    expect(inputToVelocity(NEUTRAL)).toEqual({ x: 0, z: 0 });
  });

  it("maps forward to negative Z and back to positive Z at full speed", () => {
    expect(inputToVelocity(state({ forward: true }))).toEqual({
      x: 0,
      z: -PLAYER_SPEED_MPS,
    });
    expect(inputToVelocity(state({ back: true }))).toEqual({
      x: 0,
      z: PLAYER_SPEED_MPS,
    });
  });

  it("maps left to negative X and right to positive X at full speed", () => {
    expect(inputToVelocity(state({ left: true }))).toEqual({
      x: -PLAYER_SPEED_MPS,
      z: 0,
    });
    expect(inputToVelocity(state({ right: true }))).toEqual({
      x: PLAYER_SPEED_MPS,
      z: 0,
    });
  });

  it("normalizes diagonal input so two keys do not exceed speed", () => {
    const v = inputToVelocity(state({ forward: true, right: true }));
    const magnitude = Math.hypot(v.x, v.z);
    expect(magnitude).toBeCloseTo(PLAYER_SPEED_MPS, 6);
    // Forward = -Z, right = +X. Diagonals split evenly across the two axes.
    expect(v.x).toBeCloseTo(PLAYER_SPEED_MPS / Math.SQRT2, 6);
    expect(v.z).toBeCloseTo(-PLAYER_SPEED_MPS / Math.SQRT2, 6);
  });

  it("cancels opposing keys to zero on the same axis", () => {
    expect(inputToVelocity(state({ forward: true, back: true }))).toEqual({
      x: 0,
      z: 0,
    });
    expect(inputToVelocity(state({ left: true, right: true }))).toEqual({
      x: 0,
      z: 0,
    });
  });

  it("respects a custom speed argument", () => {
    expect(inputToVelocity(state({ right: true }), 10)).toEqual({
      x: 10,
      z: 0,
    });
  });
});
