import {
  JOYSTICK_DEADZONE,
  beginJoystick,
  createJoystick,
  endJoystick,
  moveJoystick,
  readJoystick,
  type JoystickState,
} from "./joystick.ts";
import type { KeyState } from "./keyboard.ts";

/**
 * Reads a joystick deflection vector and writes it into the four
 * directional booleans of `KeyState`. The mapping is single-stick: x
 * deflection drives left/right, y deflection drives forward/back.
 *
 * The deadzone matches the VibeRacer pattern so a thumb at rest does not
 * flip movement booleans. World-axis semantics match `inputToVelocity`:
 * negative y (thumb up) maps to `forward = true`, which the existing
 * velocity mapper translates to negative world Z.
 *
 * Pure function: same input always yields the same key flips, no
 * dependence on DOM state. The DOM-bound version is `bindTouchControls`
 * below.
 */
export function applyJoystickToKeys(
  state: KeyState,
  joystick: JoystickState,
): void {
  const v = readJoystick(joystick);
  state.left = v.x < -JOYSTICK_DEADZONE;
  state.right = v.x > JOYSTICK_DEADZONE;
  state.forward = v.y < -JOYSTICK_DEADZONE;
  state.back = v.y > JOYSTICK_DEADZONE;
}

export interface TouchHandle {
  joystick: JoystickState;
  /**
   * Subscribe to deflection changes. Fires on `pointerdown`, every
   * `pointermove` while the stick is active, and on release. Used by the
   * host to redraw the visible ring/knob.
   */
  onChange: (cb: (joystick: JoystickState) => void) => void;
  dispose: () => void;
}

/**
 * Binds float-where-you-tap pointer handlers on `target` (typically
 * `window`) and writes deflections into the supplied `keys` snapshot.
 * Touch input only: mouse and pen events are ignored so desktop pointer
 * input does not conflict with the keyboard handler in `keyboard.ts`.
 *
 * Pickup, throw, and punch are not bound here. Touch UI buttons for those
 * land in the same DOM overlay as the joystick visual when the prototype
 * needs them. This slice only ships the movement stick so the user can
 * actually walk the player on a phone.
 */
export function bindTouchControls(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  keys: KeyState,
): TouchHandle {
  const joystick = createJoystick();
  const subscribers = new Set<(js: JoystickState) => void>();

  const notify = (): void => {
    for (const cb of subscribers) cb(joystick);
  };

  const onPointerDown = (event: Event): void => {
    const e = event as PointerEvent;
    if (e.pointerType !== "touch") return;
    if (joystick.active) return;
    beginJoystick(joystick, e.pointerId, e.clientX, e.clientY);
    applyJoystickToKeys(keys, joystick);
    notify();
    e.preventDefault();
  };

  const onPointerMove = (event: Event): void => {
    const e = event as PointerEvent;
    if (e.pointerType !== "touch") return;
    if (joystick.pointerId !== e.pointerId) return;
    moveJoystick(joystick, e.clientX, e.clientY);
    applyJoystickToKeys(keys, joystick);
    notify();
  };

  const onPointerUp = (event: Event): void => {
    const e = event as PointerEvent;
    if (e.pointerType !== "touch") return;
    if (joystick.pointerId !== e.pointerId) return;
    endJoystick(joystick);
    applyJoystickToKeys(keys, joystick);
    notify();
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerUp);

  const dispose = (): void => {
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerUp);
  };

  const onChange = (cb: (js: JoystickState) => void): void => {
    subscribers.add(cb);
  };

  return { joystick, onChange, dispose };
}
