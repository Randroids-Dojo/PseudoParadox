/**
 * Win-screen overlay for the escape state (F-017).
 *
 * The 2026-05-12 fun-factor audit flagged: when the player reaches the
 * `'escaped'` watermark (active player crosses the lit North door at
 * 12:00 after the cinematic actors complete), the simulation just
 * keeps running silently and the player has to press R unprompted to
 * restart. This module mounts a full-screen DOM overlay that reads
 * "You escaped." plus a "Play again (R)" prompt, so the session has a
 * clear in / play / out flow.
 *
 * Design choices:
 * - DOM overlay, not a Three.js plane: the message is text, so
 *   keeping it in the DOM avoids a canvas-text font pipeline. Mirrors
 *   the `onboardingOverlay.ts` and `actionButtons.ts` precedent.
 * - Fade-in over a short duration: a slow fade-from-transparent so
 *   the win lands as a moment rather than a flash. Respects
 *   `(prefers-reduced-motion: reduce)` by skipping the fade.
 * - Click / tap or R-press dismisses: pressing R fires the existing
 *   hard-reset listener which clears the simulation; the overlay
 *   tears down via the host's call to `dispose`. Clicking the
 *   overlay also calls the supplied `onReset` so a mouse-only
 *   visitor (no keyboard nearby) has a path back.
 * - Live-region semantics so a screen reader announces the win:
 *   `role="status"`, `aria-live="polite"`, `aria-atomic="true"`.
 * - No new dependency: HTML5 `<div>` + inline styles. RULE 3 check
 *   passes.
 */

/**
 * Pure helper: pick the win-screen lines. Exposed so callers can
 * unit-test the content without instantiating the DOM overlay.
 * Returns an immutable readonly array of strings ordered top to
 * bottom for rendering.
 */
export function pickWinScreenContent(): {
  readonly title: string;
  readonly prompt: string;
} {
  return {
    title: "You escaped.",
    prompt: "Play again (R)",
  };
}

export interface WinScreenHandle {
  /** Remove the overlay element and detach listeners. Idempotent. */
  dispose: () => void;
}

export interface CreateWinScreenOptions {
  /**
   * Override the reduced-motion detection. Defaults to
   * `matchMedia('(prefers-reduced-motion: reduce)').matches` when
   * `window.matchMedia` exists, else `false`. Tests pass this
   * explicitly.
   */
  prefersReducedMotion?: boolean;
  /**
   * Callback fired when the player clicks / taps the overlay. The
   * host wires this to the existing hard-reset path. The R-key path
   * is independent: the existing `keydown KeyR` listener in
   * `src/app.ts` handles that and tears the overlay down via the
   * returned `dispose` reference. Defaults to a no-op so the
   * overlay is purely informational if no handler is supplied.
   */
  onReset?: () => void;
  /**
   * Milliseconds for the fade-in ramp. Defaults to 600. Set to 0
   * for instant-show (reduced-motion path).
   */
  fadeMs?: number;
}

const DEFAULT_FADE_MS = 600;

/**
 * Mounts the win-screen overlay onto `container`. Returns a handle
 * whose `dispose` tears the element down. The overlay does NOT
 * subscribe to any input on its own beyond the click / tap handler;
 * the host owns the R-key reset path.
 */
export function createWinScreen(
  container: HTMLElement,
  options: CreateWinScreenOptions = {},
): WinScreenHandle {
  const prefersReducedMotion =
    options.prefersReducedMotion ??
    (typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false);
  const fadeMs = prefersReducedMotion ? 0 : options.fadeMs ?? DEFAULT_FADE_MS;
  const onReset = options.onReset;

  const { title, prompt } = pickWinScreenContent();

  // Backdrop: a near-opaque warm wash. White-on-warm reads cleanly
  // against the room's grey palette and matches the warm-end of the
  // time-of-day tint anchors so the win moment feels "in world".
  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    background: "rgba(246, 192, 132, 0.92)",
    color: "rgba(20, 12, 4, 0.95)",
    font: "500 16px / 1.4 system-ui, sans-serif",
    cursor: onReset ? "pointer" : "default",
    zIndex: "20",
    opacity: fadeMs > 0 ? "0" : "1",
    transition: fadeMs > 0 ? `opacity ${fadeMs}ms ease-in` : "none",
  } satisfies Partial<CSSStyleDeclaration>);
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");
  root.setAttribute("data-win-screen", "true");

  const titleEl = document.createElement("div");
  titleEl.textContent = title;
  Object.assign(titleEl.style, {
    font: "600 36px / 1.2 system-ui, sans-serif",
    letterSpacing: "0.02em",
  } satisfies Partial<CSSStyleDeclaration>);

  const promptEl = document.createElement("div");
  promptEl.textContent = prompt;
  Object.assign(promptEl.style, {
    font: "500 18px / 1.3 system-ui, sans-serif",
    opacity: "0.85",
  } satisfies Partial<CSSStyleDeclaration>);

  root.appendChild(titleEl);
  root.appendChild(promptEl);
  container.appendChild(root);

  let disposed = false;
  const onClick = (): void => {
    if (disposed) return;
    onReset?.();
  };
  if (onReset) {
    root.addEventListener("click", onClick);
  }

  // Trigger the fade-in on the next animation frame so the browser
  // commits the initial opacity="0" before the transition kicks in.
  // Without the rAF the browser may collapse "0" + "1" into a single
  // paint and skip the transition entirely.
  if (fadeMs > 0 && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      if (disposed) return;
      root.style.opacity = "1";
    });
  } else if (fadeMs > 0) {
    root.style.opacity = "1";
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (onReset) root.removeEventListener("click", onClick);
    root.remove();
  };

  return { dispose };
}
