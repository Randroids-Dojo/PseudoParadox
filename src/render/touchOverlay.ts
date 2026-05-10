import { JOYSTICK_RADIUS, type JoystickState } from "../input/joystick.ts";

/**
 * DOM overlay for the float-where-you-tap virtual joystick. Two absolutely
 * positioned divs (a ring and a knob) sit above the WebGL canvas and are
 * shown when the joystick is active and hidden otherwise. The overlay is
 * decoupled from Three.js; the host calls `update(joystick)` whenever the
 * joystick state changes so the visual stays in sync without polling.
 */

const KNOB_RADIUS = 26;

export interface TouchOverlay {
  update: (joystick: JoystickState) => void;
  dispose: () => void;
}

/**
 * Mounts the joystick overlay onto `container`. Uses inline styles so the
 * prototype does not need a CSS pipeline; future polish slices can move
 * the look into a stylesheet without changing the data flow.
 */
export function createTouchOverlay(container: HTMLElement): TouchOverlay {
  const ring = document.createElement("div");
  Object.assign(ring.style, {
    position: "fixed",
    width: `${JOYSTICK_RADIUS * 2}px`,
    height: `${JOYSTICK_RADIUS * 2}px`,
    borderRadius: "50%",
    border: "2px solid rgba(255, 255, 255, 0.85)",
    background: "rgba(0, 0, 0, 0.2)",
    pointerEvents: "none",
    zIndex: "15",
    display: "none",
    boxSizing: "border-box",
  } satisfies Partial<CSSStyleDeclaration>);

  const knob = document.createElement("div");
  Object.assign(knob.style, {
    position: "fixed",
    width: `${KNOB_RADIUS * 2}px`,
    height: `${KNOB_RADIUS * 2}px`,
    borderRadius: "50%",
    background: "rgba(255, 255, 255, 0.85)",
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.35)",
    pointerEvents: "none",
    zIndex: "15",
    display: "none",
    boxSizing: "border-box",
  } satisfies Partial<CSSStyleDeclaration>);

  container.appendChild(ring);
  container.appendChild(knob);

  const update = (joystick: JoystickState): void => {
    if (!joystick.active) {
      ring.style.display = "none";
      knob.style.display = "none";
      return;
    }
    const dx = joystick.currentX - joystick.originX;
    const dy = joystick.currentY - joystick.originY;
    const len = Math.hypot(dx, dy);
    const scale = len > JOYSTICK_RADIUS ? JOYSTICK_RADIUS / len : 1;
    const knobX = joystick.originX + dx * scale;
    const knobY = joystick.originY + dy * scale;
    ring.style.display = "block";
    ring.style.left = `${joystick.originX - JOYSTICK_RADIUS}px`;
    ring.style.top = `${joystick.originY - JOYSTICK_RADIUS}px`;
    knob.style.display = "block";
    knob.style.left = `${knobX - KNOB_RADIUS}px`;
    knob.style.top = `${knobY - KNOB_RADIUS}px`;
  };

  const dispose = (): void => {
    ring.remove();
    knob.remove();
  };

  return { update, dispose };
}
