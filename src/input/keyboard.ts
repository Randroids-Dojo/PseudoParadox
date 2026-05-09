/**
 * Keyboard input for the prototype player capsule (REQ-026).
 *
 * The keyboard module is split into two layers:
 *   1. A pure mapping helper, `inputToVelocity`, that converts a key-state
 *      record into a normalized world-XZ velocity vector. This is the only
 *      thing exercised by tests, which keeps the unit boundary trivial.
 *   2. A small DOM-bound tracker, `createKeyboardState`, that listens for
 *      keydown / keyup on `window` and updates a shared `KeyState`.
 *
 * Camera is fixed for the prototype, so movement is in world coordinates and
 * not relative to a heading. Future slices that introduce a camera that can
 * yaw will replace `inputToVelocity` with a heading-aware variant rather than
 * mutating this one.
 */

export interface KeyState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  /**
   * Punch input (REQ-033 partial). Captured as a per-tick boolean so the
   * recorder writes one frame's punch flag alongside the movement axes and
   * `replayAtTick` consumers can read it back. The default key binding is
   * `Space` (Q-002 default). The flag is sticky for the duration of the key
   * being held; the per-tick punch resolver in `src/sim/punch.ts` is
   * responsible for treating each frame's flag as the puncher's intent at
   * that tick. Edge-triggering (rising-edge only) is NOT applied here so a
   * future hold-to-charge variant can read the flag directly.
   */
  punch: boolean;
  /**
   * Pickup input (REQ-034). Captured as a per-tick boolean alongside the
   * other channels so the recorder snapshots it identically to `punch`.
   * Default key binding is `F` (Q-002 default). The carry layer
   * (`src/sim/carryState.ts`) is a TOGGLE (Q-004 default): one rising
   * edge picks up the nearest in-range unconscious body, another rising
   * edge drops it. Rising-edge detection itself is NOT applied here; the
   * recorder stores the raw key state and the host (`src/app.ts`) tracks
   * the previous tick's value to derive the edge. This mirrors the
   * `punch` model: per-tick boolean here, semantic interpretation in the
   * resolver. On replay a ghost's recorded pickup flag flows through the
   * same edge-detection path so a recorded pickup at tick T fires once,
   * not on every subsequent tick the recording keeps the flag held.
   */
  pickup: boolean;
}

export interface PlanarVelocity {
  x: number;
  z: number;
}

/**
 * Default movement speed in world units per second. 4 m/s reads as a brisk
 * walk on the 10x10 unit room: roughly two-and-a-half seconds wall-to-wall.
 * Tuned by feel; revisit when the camera framing and animation arrive.
 */
export const PLAYER_SPEED_MPS = 4;

/**
 * Converts a snapshot of key state into a planar velocity vector.
 *
 * Pressing forward decreases world Z (room "north" wall is at -depth/2 in
 * `room.ts`). Pressing right increases world X. Diagonals are normalized so
 * holding two keys does not exceed the configured speed. Pure function: same
 * input always yields the same output, no globals, no DOM.
 */
export function inputToVelocity(
  state: KeyState,
  speed: number = PLAYER_SPEED_MPS,
): PlanarVelocity {
  let x = 0;
  let z = 0;
  if (state.forward) z -= 1;
  if (state.back) z += 1;
  if (state.left) x -= 1;
  if (state.right) x += 1;

  if (x === 0 && z === 0) {
    return { x: 0, z: 0 };
  }

  const magnitude = Math.hypot(x, z);
  return {
    x: (x / magnitude) * speed,
    z: (z / magnitude) * speed,
  };
}

interface KeyboardHandle {
  state: KeyState;
  dispose: () => void;
}

/**
 * Binds keydown / keyup listeners on the supplied target (typically
 * `window`) and returns a live `KeyState` object plus a `dispose` cleanup.
 *
 * WASD and the arrow keys are both supported. Repeats and held keys are
 * handled naturally by the browser firing a single keydown for each press;
 * we only flip the boolean, never count.
 */
export function createKeyboardState(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
): KeyboardHandle {
  const state: KeyState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    punch: false,
    pickup: false,
  };

  const setKey = (code: string, down: boolean): void => {
    switch (code) {
      case "KeyW":
      case "ArrowUp":
        state.forward = down;
        break;
      case "KeyS":
      case "ArrowDown":
        state.back = down;
        break;
      case "KeyA":
      case "ArrowLeft":
        state.left = down;
        break;
      case "KeyD":
      case "ArrowRight":
        state.right = down;
        break;
      // Q-002 default: Space binds to the punch input (REQ-033). The
      // movement keys ignore Space, so there is no input collision.
      case "Space":
        state.punch = down;
        break;
      // Q-002 default: F binds to the pickup input (REQ-034). The
      // movement keys ignore F, so there is no input collision. The
      // toggle semantics live in `src/sim/carryState.ts`; this layer
      // captures only the raw key state.
      case "KeyF":
        state.pickup = down;
        break;
      default:
        break;
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => setKey(event.code, true);
  const onKeyUp = (event: KeyboardEvent): void => setKey(event.code, false);

  target.addEventListener("keydown", onKeyDown as EventListener);
  target.addEventListener("keyup", onKeyUp as EventListener);

  const dispose = (): void => {
    target.removeEventListener("keydown", onKeyDown as EventListener);
    target.removeEventListener("keyup", onKeyUp as EventListener);
  };

  return { state, dispose };
}
