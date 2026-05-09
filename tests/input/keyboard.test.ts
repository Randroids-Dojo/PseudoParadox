import { describe, expect, it } from "vitest";
import {
  PLAYER_SPEED_MPS,
  createKeyboardState,
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

/**
 * REQ-026 regression (dossier section 11). The keyboard binding layer maps
 * both WASD and the arrow keys onto the same `KeyState` booleans, so the
 * downstream `inputToVelocity` call produces an identical planar velocity
 * regardless of which input device the player used. The test drives both
 * binding sets through `createKeyboardState` and asserts each produces a
 * non-zero velocity matching the WASD reference.
 */
interface FakeWindow {
  addEventListener: Pick<
    Window,
    "addEventListener" | "removeEventListener"
  >["addEventListener"];
  removeEventListener: Pick<
    Window,
    "addEventListener" | "removeEventListener"
  >["removeEventListener"];
  dispatch: (type: string, code: string) => void;
}

const buildFakeWindow = (): FakeWindow => {
  const listeners: Record<string, EventListenerOrEventListenerObject[]> = {
    keydown: [],
    keyup: [],
  };
  const callListener = (
    listener: EventListenerOrEventListenerObject,
    event: Event,
  ): void => {
    if (typeof listener === "function") {
      listener(event);
    } else {
      listener.handleEvent(event);
    }
  };
  return {
    addEventListener: ((type: string, listener: EventListenerOrEventListenerObject) => {
      (listeners[type] ??= []).push(listener);
    }) as Window["addEventListener"],
    removeEventListener: ((
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      const arr = listeners[type] ?? [];
      const idx = arr.indexOf(listener);
      if (idx >= 0) arr.splice(idx, 1);
    }) as Window["removeEventListener"],
    dispatch: (type, code) => {
      const event = { code } as KeyboardEvent;
      for (const fn of listeners[type] ?? []) callListener(fn, event);
    },
  };
};

describe("REQ-026 keyboard binding regression", () => {
  it("WASD and arrow keys both produce velocity through inputToVelocity", () => {
    const wasdCases: ReadonlyArray<{
      down: string;
      expected: { x: number; z: number };
    }> = [
      { down: "KeyW", expected: { x: 0, z: -PLAYER_SPEED_MPS } },
      { down: "KeyS", expected: { x: 0, z: PLAYER_SPEED_MPS } },
      { down: "KeyA", expected: { x: -PLAYER_SPEED_MPS, z: 0 } },
      { down: "KeyD", expected: { x: PLAYER_SPEED_MPS, z: 0 } },
    ];
    const arrowCases: ReadonlyArray<{
      down: string;
      expected: { x: number; z: number };
    }> = [
      { down: "ArrowUp", expected: { x: 0, z: -PLAYER_SPEED_MPS } },
      { down: "ArrowDown", expected: { x: 0, z: PLAYER_SPEED_MPS } },
      { down: "ArrowLeft", expected: { x: -PLAYER_SPEED_MPS, z: 0 } },
      { down: "ArrowRight", expected: { x: PLAYER_SPEED_MPS, z: 0 } },
    ];

    for (const set of [wasdCases, arrowCases]) {
      for (const { down, expected } of set) {
        const fake = buildFakeWindow();
        const handle = createKeyboardState(fake);
        fake.dispatch("keydown", down);
        const v = inputToVelocity(handle.state);
        expect(v.x).toBeCloseTo(expected.x, 6);
        expect(v.z).toBeCloseTo(expected.z, 6);
        fake.dispatch("keyup", down);
        const after = inputToVelocity(handle.state);
        expect(after).toEqual({ x: 0, z: 0 });
        handle.dispose();
      }
    }
  });

  it("WASD-derived velocity equals arrow-derived velocity for every cardinal", () => {
    const pairs: ReadonlyArray<{ wasd: string; arrow: string }> = [
      { wasd: "KeyW", arrow: "ArrowUp" },
      { wasd: "KeyS", arrow: "ArrowDown" },
      { wasd: "KeyA", arrow: "ArrowLeft" },
      { wasd: "KeyD", arrow: "ArrowRight" },
    ];
    for (const { wasd, arrow } of pairs) {
      const fakeA = buildFakeWindow();
      const handleA = createKeyboardState(fakeA);
      fakeA.dispatch("keydown", wasd);
      const wasdVelocity = inputToVelocity(handleA.state);
      handleA.dispose();

      const fakeB = buildFakeWindow();
      const handleB = createKeyboardState(fakeB);
      fakeB.dispatch("keydown", arrow);
      const arrowVelocity = inputToVelocity(handleB.state);
      handleB.dispose();

      expect(arrowVelocity).toEqual(wasdVelocity);
    }
  });
});
