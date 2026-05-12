/**
 * Touch action buttons for mobile playability (F-009).
 *
 * The touch joystick (`src/render/touchOverlay.ts` plus
 * `src/input/touch.ts`) ships movement only; punch / pickup / throw /
 * hard-reset still need a keyboard. This module mounts four DOM
 * buttons on the bottom-right of the canvas so a phone player can
 * complete every action a desktop player can. Each press flips the
 * same `KeyState` boolean the keyboard handler would, so the
 * downstream recorder and replay paths read identical state regardless
 * of input source.
 *
 * Hard reset is special: there is no `KeyState.reset` field; the
 * reset is triggered by a `keydown KeyR` listener in `src/app.ts`.
 * The Reset button dispatches a synthetic `KeyboardEvent` so the same
 * listener fires, keeping a single source of truth for the reset
 * sequence.
 *
 * Design choices:
 * - Buttons are large (64 px square) for finger-friendly hit targets.
 * - Vertical stack on the bottom-right above the iOS safe area.
 * - `aria-pressed` reflects the pressed state on the three KeyState
 *   buttons; the Reset button uses an `aria-label` only (each press
 *   is an action, not a toggle).
 * - `touchstart` / `mousedown` flip the flag to `true`;
 *   `touchend` / `touchcancel` / `mouseup` / `mouseleave` flip it back.
 *   The same pointer-down semantics the keyboard handler uses (held =
 *   sustained boolean) carry over to touch.
 * - The `Reset` button fires once per pointer down; held does not
 *   re-fire (the listener does not re-trigger on a sustained keydown).
 * - The Joystick is intentionally NOT covered by these buttons. They
 *   sit on the OPPOSITE corner so a one-thumb-per-corner layout works.
 */

import type { KeyState } from "../input/keyboard.ts";

export const ACTION_BUTTON_SIZE_PX = 64;
export const ACTION_BUTTON_GAP_PX = 12;
export const ACTION_BUTTON_RIGHT_PX = 16;
export const ACTION_BUTTON_BOTTOM_PX = 16;

export interface ActionButtonsHandle {
  /** Remove every button from the DOM. */
  dispose: () => void;
}

/**
 * Minimal target shape used to dispatch the synthetic Reset key
 * event. `Window` satisfies this; tests can pass any object that
 * implements `dispatchEvent`.
 */
export interface ActionButtonsKeyTarget {
  dispatchEvent: (event: Event) => boolean;
}

/**
 * Optional override hook for the keydown dispatch target. Defaults to
 * `window` when omitted so the production wiring stays one-liner.
 */
export interface CreateActionButtonsOptions {
  /** Defaults to `window` if available; otherwise omitted (no-op reset). */
  keyTarget?: ActionButtonsKeyTarget;
}

/**
 * Mounts four touch action buttons onto `container`. Each `keyState`
 * boolean is flipped on press and release; the Reset button instead
 * dispatches a `keydown KeyR` event to `keyTarget`.
 */
export function createActionButtons(
  container: HTMLElement,
  keyState: KeyState,
  options: CreateActionButtonsOptions = {},
): ActionButtonsHandle {
  const keyTarget: ActionButtonsKeyTarget | undefined =
    options.keyTarget ??
    (typeof window !== "undefined" ? window : undefined);

  const buttons: HTMLButtonElement[] = [];

  const makeButton = (
    label: string,
    onPress: () => void,
    onRelease: () => void,
    isToggle: boolean,
  ): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.setAttribute("aria-label", label);
    if (isToggle) btn.setAttribute("aria-pressed", "false");
    Object.assign(btn.style, {
      width: `${ACTION_BUTTON_SIZE_PX}px`,
      height: `${ACTION_BUTTON_SIZE_PX}px`,
      borderRadius: "50%",
      border: "2px solid rgba(255, 255, 255, 0.85)",
      background: "rgba(0, 0, 0, 0.35)",
      color: "rgba(255, 255, 255, 0.95)",
      font: "600 13px / 1 system-ui, sans-serif",
      cursor: "pointer",
      touchAction: "manipulation",
      userSelect: "none",
      webkitUserSelect: "none",
      zIndex: "15",
      padding: "0",
      pointerEvents: "auto",
    } satisfies Partial<CSSStyleDeclaration>);

    const press = (event: Event): void => {
      event.preventDefault();
      onPress();
      if (isToggle) btn.setAttribute("aria-pressed", "true");
      btn.style.background = "rgba(255, 255, 255, 0.45)";
    };
    const release = (event: Event): void => {
      event.preventDefault();
      onRelease();
      if (isToggle) btn.setAttribute("aria-pressed", "false");
      btn.style.background = "rgba(0, 0, 0, 0.35)";
    };

    btn.addEventListener("touchstart", press, { passive: false });
    btn.addEventListener("touchend", release, { passive: false });
    btn.addEventListener("touchcancel", release, { passive: false });
    btn.addEventListener("mousedown", press);
    btn.addEventListener("mouseup", release);
    btn.addEventListener("mouseleave", release);
    // Keyboard activation: preserve Enter / Space defaults so a
    // focused button still flips the same flag a touch press would.
    // Space is the punch keybinding so we route this through the same
    // press / release pair instead of intercepting; the keyboard
    // handler in `src/input/keyboard.ts` owns the Space binding when
    // the button is not focused.
    btn.addEventListener("keydown", (e) => {
      if (e.code === "Enter" || e.code === "Space") press(e);
    });
    btn.addEventListener("keyup", (e) => {
      if (e.code === "Enter" || e.code === "Space") release(e);
    });

    return btn;
  };

  // Compose four buttons. Stacking bottom-up: Reset (bottom), Throw,
  // Pickup, Punch (top). The bottom button sits at
  // `ACTION_BUTTON_BOTTOM_PX` from the canvas edge; each subsequent
  // button stacks above with an `ACTION_BUTTON_GAP_PX` gap.
  const punchBtn = makeButton(
    "Punch",
    () => {
      keyState.punch = true;
    },
    () => {
      keyState.punch = false;
    },
    true,
  );
  const pickupBtn = makeButton(
    "Pick",
    () => {
      keyState.pickup = true;
    },
    () => {
      keyState.pickup = false;
    },
    true,
  );
  const throwBtn = makeButton(
    "Throw",
    () => {
      keyState.throw = true;
    },
    () => {
      keyState.throw = false;
    },
    true,
  );
  // Reset fires a `keydown KeyR` so the host's existing reset
  // listener in `src/app.ts` triggers the hard reset. On release we
  // dispatch a matching `keyup` to keep the synthetic key state
  // symmetrical (no listener consumes the keyup today, but a future
  // hold-to-confirm reset variant could).
  const resetBtn = makeButton(
    "Reset",
    () => {
      keyTarget?.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyR",
          key: "r",
          bubbles: true,
        }),
      );
    },
    () => {
      keyTarget?.dispatchEvent(
        new KeyboardEvent("keyup", {
          code: "KeyR",
          key: "r",
          bubbles: true,
        }),
      );
    },
    false,
  );

  // Position each button in a vertical stack from the bottom-right.
  // Index 0 is the bottom (Reset). The buttons-from-top order for
  // visual readability is Punch / Pick / Throw / Reset; in CSS that
  // means assigning `bottom` offsets in reverse.
  const stack = [resetBtn, throwBtn, pickupBtn, punchBtn];
  stack.forEach((btn, i) => {
    const bottomPx =
      ACTION_BUTTON_BOTTOM_PX +
      i * (ACTION_BUTTON_SIZE_PX + ACTION_BUTTON_GAP_PX);
    Object.assign(btn.style, {
      position: "fixed",
      right: `${ACTION_BUTTON_RIGHT_PX}px`,
      bottom: `${bottomPx}px`,
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(btn);
    buttons.push(btn);
  });

  const dispose = (): void => {
    for (const btn of buttons) {
      btn.remove();
    }
  };

  return { dispose };
}
