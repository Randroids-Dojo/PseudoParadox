/**
 * Float-where-you-tap virtual joystick. Pointer events feed
 * `beginJoystick` / `moveJoystick` / `endJoystick`; consumers read
 * `readJoystick` for a deflection vector clamped to `[-1, 1]` on each axis.
 *
 * Pure data + pure functions: no DOM, no globals, no React. The DOM-bound
 * touch handler lives in `touch.ts` and the visible ring/knob is drawn by
 * the host in `app.ts`. Pattern lifted from VibeRacer's portable
 * `virtual-joystick.ts` so the same control feel ports cleanly between
 * projects.
 */

export interface JoystickState {
  active: boolean;
  pointerId: number | null;
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
}

export interface JoystickVector {
  x: number;
  y: number;
}

/**
 * Half-width of the joystick ring in CSS pixels. A tap at the origin
 * registers zero deflection; at one ring radius from the origin the
 * deflection saturates at 1.
 */
export const JOYSTICK_RADIUS = 64;

/**
 * Deadzone applied by the consumer when mapping deflection to discrete
 * key states. Stops finger jitter near the origin from flipping booleans.
 */
export const JOYSTICK_DEADZONE = 0.25;

export function createJoystick(): JoystickState {
  return {
    active: false,
    pointerId: null,
    originX: 0,
    originY: 0,
    currentX: 0,
    currentY: 0,
  };
}

export function beginJoystick(
  js: JoystickState,
  pointerId: number,
  x: number,
  y: number,
): void {
  js.active = true;
  js.pointerId = pointerId;
  js.originX = x;
  js.originY = y;
  js.currentX = x;
  js.currentY = y;
}

export function moveJoystick(
  js: JoystickState,
  x: number,
  y: number,
): void {
  if (!js.active) return;
  js.currentX = x;
  js.currentY = y;
}

export function endJoystick(js: JoystickState): void {
  js.active = false;
  js.pointerId = null;
}

/**
 * Returns the current deflection in `[-1, 1]` per axis. Screen Y grows
 * downward, so a thumb dragged up returns a negative y. Magnitudes
 * exceeding the ring radius are clamped to the unit circle.
 */
export function readJoystick(js: JoystickState): JoystickVector {
  if (!js.active) return { x: 0, y: 0 };
  const dx = js.currentX - js.originX;
  const dy = js.currentY - js.originY;
  const len = Math.hypot(dx, dy);
  if (len <= JOYSTICK_RADIUS) {
    return { x: dx / JOYSTICK_RADIUS, y: dy / JOYSTICK_RADIUS };
  }
  return { x: dx / len, y: dy / len };
}
