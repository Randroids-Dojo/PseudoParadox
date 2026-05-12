/**
 * Onboarding controls and objective overlay (F-016).
 *
 * The 2026-05-12 fun-factor audit flagged: a new player lands on the
 * page with zero path to discovery. The lit-vs-dark portal rule, the
 * punch-past-self mechanic, and the "escape through North door at
 * 12:00" win condition are all discovery-only. This module mounts an
 * ambient corner hint that names the controls and the goal, then
 * removes itself on the first user input so it does not occlude play.
 *
 * Design choices:
 * - Top-right corner: the top-left is taken by the "Pseudo Paradox
 *   prototype" label (`index.html`); the bottom-left is the touch
 *   joystick; the bottom-right is the action button stack on mobile.
 *   Top-right is the only quadrant free on every layout.
 * - Variant by pointer kind: a coarse-pointer device (phone, tablet)
 *   already has the four labeled action buttons (`actionButtons.ts`)
 *   and the joystick ring (`touchOverlay.ts`), so the desktop key
 *   legend would be redundant noise; coarse-pointer users see the
 *   one-line objective only. Fine-pointer users (mouse / trackpad)
 *   see the full key legend plus the goal.
 * - Hide on first input: any `keydown` or `pointerdown` removes the
 *   overlay. One-shot per page life; pressing R for a hard reset
 *   does not re-mount it. This matches the "ambient hint, not a
 *   tutorial" framing from F-016.
 * - No new dependency: HTML5 `<div>` + inline styles, mirroring the
 *   touchOverlay / actionButtons precedent. RULE 3 stack-constraint
 *   check passes.
 */

/**
 * Pure helper: pick the content to render for an onboarding overlay.
 * Coarse-pointer devices (touch primary) already have on-screen labels
 * for every action, so they only need the goal hint. Fine-pointer
 * devices (mouse primary) need the keyboard legend too.
 */
export function pickOnboardingContent(isCoarsePointer: boolean): {
  readonly lines: readonly string[];
} {
  if (isCoarsePointer) {
    return { lines: ["Goal: escape through a lit door."] };
  }
  return {
    lines: [
      "Move: WASD",
      "Punch: SPACE",
      "Pick up: F",
      "Throw: T",
      "Reset: R",
      "",
      "Goal: escape through a lit door.",
    ],
  };
}

export interface OnboardingOverlayHandle {
  /** Remove the overlay element and detach its listeners. Idempotent. */
  dispose: () => void;
}

export interface CreateOnboardingOverlayOptions {
  /**
   * Override the pointer-kind detection. Defaults to
   * `matchMedia('(pointer: coarse)').matches` when `window.matchMedia`
   * exists, else `false`. Tests pass this explicitly.
   */
  isCoarsePointer?: boolean;
  /**
   * Event target the overlay listens on for first-input detection.
   * Defaults to `window`. Tests pass a stub.
   */
  inputTarget?: EventTarget;
  /**
   * Milliseconds for the fade-out before the element is removed.
   * Defaults to 400. Set to 0 in tests / reduced-motion contexts to
   * remove immediately.
   */
  fadeMs?: number;
}

const DEFAULT_FADE_MS = 400;

/**
 * Mounts the onboarding overlay onto `container`. Returns a handle whose
 * `dispose` tears the element down. The overlay also disposes itself on
 * the first `keydown` or `pointerdown` from `inputTarget`.
 */
export function createOnboardingOverlay(
  container: HTMLElement,
  options: CreateOnboardingOverlayOptions = {},
): OnboardingOverlayHandle {
  const isCoarsePointer =
    options.isCoarsePointer ??
    (typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false);
  const inputTarget: EventTarget =
    options.inputTarget ?? (typeof window !== "undefined" ? window : container);
  const fadeMs = options.fadeMs ?? DEFAULT_FADE_MS;

  const { lines } = pickOnboardingContent(isCoarsePointer);

  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    padding: "10px 14px",
    borderRadius: "8px",
    background: "rgba(0, 0, 0, 0.45)",
    color: "rgba(255, 255, 255, 0.92)",
    font: "500 13px / 1.45 system-ui, sans-serif",
    pointerEvents: "none",
    zIndex: "12",
    maxWidth: "240px",
    whiteSpace: "pre-line",
    transition: `opacity ${fadeMs}ms ease-out`,
    opacity: "1",
  } satisfies Partial<CSSStyleDeclaration>);
  // Screen-reader semantics: `role="status"` + polite live region so the
  // first-time hint is announced on mount without interrupting any focused
  // control. `aria-atomic="true"` so the whole hint reads as one update
  // rather than line-by-line; `aria-hidden="false"` is explicit so the
  // hide path's flip to `"true"` is symmetric.
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "true");
  el.setAttribute("aria-hidden", "false");
  el.setAttribute("data-onboarding-overlay", "true");
  el.textContent = lines.join("\n");
  container.appendChild(el);

  let disposed = false;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    inputTarget.removeEventListener("keydown", hide);
    inputTarget.removeEventListener("pointerdown", hide);
    if (fadeTimer !== undefined) clearTimeout(fadeTimer);
    el.remove();
  };

  const hide = (): void => {
    if (disposed) return;
    el.style.opacity = "0";
    el.setAttribute("aria-hidden", "true");
    inputTarget.removeEventListener("keydown", hide);
    inputTarget.removeEventListener("pointerdown", hide);
    if (fadeMs <= 0) {
      dispose();
      return;
    }
    fadeTimer = setTimeout(() => {
      dispose();
    }, fadeMs);
  };

  inputTarget.addEventListener("keydown", hide, { once: true });
  inputTarget.addEventListener("pointerdown", hide, { once: true });

  return { dispose };
}
