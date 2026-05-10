import { describe, expect, it } from "vitest";
import {
  JOYSTICK_DEADZONE,
  JOYSTICK_RADIUS,
  beginJoystick,
  createJoystick,
  endJoystick,
  moveJoystick,
  readJoystick,
} from "../../src/input/joystick.ts";
import { applyJoystickToKeys } from "../../src/input/touch.ts";
import type { KeyState } from "../../src/input/keyboard.ts";

const NEUTRAL: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
};

const fresh = (): KeyState => ({ ...NEUTRAL });

describe("readJoystick", () => {
  it("returns zero deflection for an inactive stick", () => {
    expect(readJoystick(createJoystick())).toEqual({ x: 0, y: 0 });
  });

  it("returns linear deflection inside the ring radius", () => {
    const js = createJoystick();
    beginJoystick(js, 1, 100, 100);
    moveJoystick(js, 100 + JOYSTICK_RADIUS / 2, 100);
    expect(readJoystick(js)).toEqual({ x: 0.5, y: 0 });
  });

  it("clamps deflection to the unit circle outside the ring radius", () => {
    const js = createJoystick();
    beginJoystick(js, 1, 0, 0);
    moveJoystick(js, JOYSTICK_RADIUS * 4, 0);
    expect(readJoystick(js)).toEqual({ x: 1, y: 0 });
  });

  it("preserves direction when clamped diagonally", () => {
    const js = createJoystick();
    beginJoystick(js, 1, 0, 0);
    moveJoystick(js, JOYSTICK_RADIUS * 4, JOYSTICK_RADIUS * 4);
    const v = readJoystick(js);
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(v.y).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("returns zero again after endJoystick", () => {
    const js = createJoystick();
    beginJoystick(js, 1, 0, 0);
    moveJoystick(js, JOYSTICK_RADIUS, JOYSTICK_RADIUS);
    endJoystick(js);
    expect(readJoystick(js)).toEqual({ x: 0, y: 0 });
  });
});

describe("applyJoystickToKeys", () => {
  it("leaves directions clear inside the deadzone", () => {
    const js = createJoystick();
    beginJoystick(js, 1, 0, 0);
    moveJoystick(js, JOYSTICK_RADIUS * (JOYSTICK_DEADZONE * 0.5), 0);
    const keys = fresh();
    applyJoystickToKeys(keys, js);
    expect(keys.left).toBe(false);
    expect(keys.right).toBe(false);
    expect(keys.forward).toBe(false);
    expect(keys.back).toBe(false);
  });

  it("maps thumb-up to forward and thumb-down to back", () => {
    const up = createJoystick();
    beginJoystick(up, 1, 0, 0);
    moveJoystick(up, 0, -JOYSTICK_RADIUS);
    const keysUp = fresh();
    applyJoystickToKeys(keysUp, up);
    expect(keysUp.forward).toBe(true);
    expect(keysUp.back).toBe(false);

    const down = createJoystick();
    beginJoystick(down, 1, 0, 0);
    moveJoystick(down, 0, JOYSTICK_RADIUS);
    const keysDown = fresh();
    applyJoystickToKeys(keysDown, down);
    expect(keysDown.forward).toBe(false);
    expect(keysDown.back).toBe(true);
  });

  it("maps thumb-left to left and thumb-right to right", () => {
    const left = createJoystick();
    beginJoystick(left, 1, 0, 0);
    moveJoystick(left, -JOYSTICK_RADIUS, 0);
    const keysLeft = fresh();
    applyJoystickToKeys(keysLeft, left);
    expect(keysLeft.left).toBe(true);
    expect(keysLeft.right).toBe(false);

    const right = createJoystick();
    beginJoystick(right, 1, 0, 0);
    moveJoystick(right, JOYSTICK_RADIUS, 0);
    const keysRight = fresh();
    applyJoystickToKeys(keysRight, right);
    expect(keysRight.left).toBe(false);
    expect(keysRight.right).toBe(true);
  });

  it("does not touch punch / pickup / throw flags", () => {
    const js = createJoystick();
    beginJoystick(js, 1, 0, 0);
    moveJoystick(js, JOYSTICK_RADIUS, JOYSTICK_RADIUS);
    const keys: KeyState = {
      ...NEUTRAL,
      punch: true,
      pickup: true,
      throw: true,
    };
    applyJoystickToKeys(keys, js);
    expect(keys.punch).toBe(true);
    expect(keys.pickup).toBe(true);
    expect(keys.throw).toBe(true);
  });
});
