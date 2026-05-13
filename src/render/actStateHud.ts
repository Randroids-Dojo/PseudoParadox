/**
 * Bottom-left act-state HUD line (F-019).
 *
 * The fun-factor audit flagged that the `ActStateObserver`'s watermark
 * is computed every fixed step but never surfaced to the player. The
 * player infers progress only from world state (ghosts appearing,
 * bodies piling up). This module reads the observer's state and
 * renders a short human-readable beat label so the player can tell
 * what stage of the loop they are in.
 *
 * Design choices:
 * - Bottom-left positioning. The top-left has the prototype label,
 *   the top-right has the auto-fading onboarding hint, and the
 *   bottom-right is the touch action-button stack. The bottom-left
 *   is the float-where-you-tap joystick zone on mobile, but the
 *   joystick is hidden until first tap and the HUD has
 *   `pointer-events: none` so a tap passes through to the joystick
 *   underneath.
 * - DOM overlay, not a Three.js plane. Text is easier in the DOM,
 *   and the codebase has the precedent (onboardingOverlay,
 *   actionButtons, winScreen).
 * - No animation. The followup spec says "text content swap is
 *   enough." The watermark only advances on real progress, so a
 *   text update reads as a discrete event without needing fade.
 * - Hidden on the seed state. `'not-started'` is unreachable in
 *   practice (the Act 1 cinematic mounts ghosts before the first
 *   simulation tick), but if the observer reports it the HUD just
 *   shows blank rather than the awkward "Not Started" label.
 */

import type { ActState } from "../sim/actState.ts";

/**
 * Pure helper: human-readable beat label for an `ActState`. Returns
 * an empty string for `'not-started'` so the HUD shows nothing
 * before the first beat lands.
 */
export function pickActStateLabel(state: ActState): string {
  switch (state) {
    case "not-started":
      return "";
    case "act-1-spawn":
      return "Act 1: Spawn";
    case "act-2-loop-1":
      return "Act 2: First Loop";
    case "act-2-loop-2":
      return "Act 2: Second Loop";
    case "act-3-setup":
      return "Act 3: Setup";
    case "act-3-chase":
      return "Act 3: Chase";
    case "act-3-team-up":
      return "Act 3: Team Up";
    case "act-3-mirror":
      return "Act 3: Mirror";
    case "act-3-final-knockout":
      return "Act 3: Final Knockout";
    case "escaped":
      return "Escaped";
  }
}

export interface ActStateHudHandle {
  /** Update the rendered label to the latest `ActState`. */
  update: (state: ActState) => void;
  /** Remove the overlay element. Idempotent. */
  dispose: () => void;
}

/**
 * Mount the act-state HUD overlay onto `container`. Returns a handle
 * the host calls per fixed step with the latest observer watermark.
 * Initial render is blank (`'not-started'` label).
 */
export function createActStateHud(container: HTMLElement): ActStateHudHandle {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed",
    left: "12px",
    bottom: "12px",
    padding: "6px 10px",
    borderRadius: "6px",
    background: "rgba(0, 0, 0, 0.35)",
    color: "rgba(255, 255, 255, 0.85)",
    font: "500 12px / 1.2 system-ui, sans-serif",
    letterSpacing: "0.04em",
    pointerEvents: "none",
    zIndex: "12",
    // Hidden by default; the first `update(state)` call with a
    // non-seed state flips display to `"block"`.
    display: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "true");
  el.setAttribute("data-act-state-hud", "true");
  el.textContent = "";
  container.appendChild(el);

  let disposed = false;
  let last: ActState = "not-started";

  const update = (state: ActState): void => {
    if (disposed) return;
    if (state === last) return;
    last = state;
    const label = pickActStateLabel(state);
    el.textContent = label;
    el.style.display = label.length > 0 ? "block" : "none";
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    el.remove();
  };

  return { update, dispose };
}
