/**
 * Pause menu plus hard-reset confirmation (F-022).
 *
 * The hard-reset operation is destructive to the current run, so the final
 * UX routes both keyboard and touch reset requests through this menu before
 * calling `hardReset`. The host owns the actual simulation reset; this module
 * only owns DOM state and player-facing copy.
 */

export type PauseMenuView = "closed" | "menu" | "confirm-reset";

export type PauseMenuAction =
  | "open-menu"
  | "open-reset-confirmation"
  | "close"
  | "cancel-reset";

export interface PauseMenuContent {
  readonly title: string;
  readonly body?: string;
  readonly primary: string;
  readonly secondary?: string;
}

export function nextPauseMenuView(
  view: PauseMenuView,
  action: PauseMenuAction,
): PauseMenuView {
  switch (action) {
    case "open-menu":
      return "menu";
    case "open-reset-confirmation":
      return "confirm-reset";
    case "cancel-reset":
      return view === "confirm-reset" ? "menu" : view;
    case "close":
      return "closed";
  }
}

export function pickPauseMenuContent(
  view: Exclude<PauseMenuView, "closed">,
): PauseMenuContent {
  if (view === "confirm-reset") {
    return {
      title: "Reset run?",
      body: "Return to the 5:00 start and clear every recorded instance.",
      primary: "Reset to 5:00",
      secondary: "Cancel",
    };
  }
  return {
    title: "Paused",
    primary: "Resume",
    secondary: "Reset run",
  };
}

export interface PauseMenuHandle {
  openMenu: () => void;
  openResetConfirmation: () => void;
  handleEscape: () => void;
  close: () => void;
  isOpen: () => boolean;
  dispose: () => void;
}

export interface CreatePauseMenuOptions {
  onResetConfirmed: () => void;
  onOpenChange?: (open: boolean) => void;
}

const MENU_Z_INDEX = 40;
const PAUSE_BUTTON_Z_INDEX = 24;

export function createPauseMenu(
  container: HTMLElement,
  options: CreatePauseMenuOptions,
): PauseMenuHandle {
  let view: PauseMenuView = "closed";
  let overlay: HTMLDivElement | undefined;
  let disposed = false;

  const pauseButton = document.createElement("button");
  pauseButton.type = "button";
  pauseButton.textContent = "Pause";
  pauseButton.setAttribute("aria-label", "Pause");
  Object.assign(pauseButton.style, {
    position: "fixed",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    minWidth: "72px",
    height: "40px",
    borderRadius: "8px",
    border: "1px solid rgba(255, 255, 255, 0.72)",
    background: "rgba(10, 10, 10, 0.42)",
    color: "rgba(255, 255, 255, 0.94)",
    font: "600 13px / 1 system-ui, sans-serif",
    cursor: "pointer",
    touchAction: "manipulation",
    zIndex: `${PAUSE_BUTTON_Z_INDEX}`,
    pointerEvents: "auto",
  } satisfies Partial<CSSStyleDeclaration>);

  const emitOpenChange = (previous: PauseMenuView, next: PauseMenuView): void => {
    const wasOpen = previous !== "closed";
    const isNowOpen = next !== "closed";
    if (wasOpen !== isNowOpen) options.onOpenChange?.(isNowOpen);
  };

  const setView = (next: PauseMenuView): void => {
    if (disposed || next === view) return;
    const previous = view;
    view = next;
    emitOpenChange(previous, next);
    render();
  };

  const close = (): void => {
    setView("closed");
  };

  const openMenu = (): void => {
    setView("menu");
  };

  const openResetConfirmation = (): void => {
    setView("confirm-reset");
  };

  const handleEscape = (): void => {
    if (view === "confirm-reset") {
      setView("menu");
      return;
    }
    if (view === "menu") close();
    else openMenu();
  };

  const makeButton = (
    label: string,
    onClick: () => void,
    tone: "primary" | "secondary",
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    Object.assign(button.style, {
      minWidth: "132px",
      height: "42px",
      borderRadius: "8px",
      border:
        tone === "primary"
          ? "1px solid rgba(246, 192, 132, 0.9)"
          : "1px solid rgba(255, 255, 255, 0.35)",
      background:
        tone === "primary"
          ? "rgba(246, 192, 132, 0.92)"
          : "rgba(255, 255, 255, 0.08)",
      color:
        tone === "primary"
          ? "rgba(20, 12, 4, 0.96)"
          : "rgba(255, 255, 255, 0.92)",
      font: "600 14px / 1 system-ui, sans-serif",
      cursor: "pointer",
      padding: "0 16px",
      touchAction: "manipulation",
    } satisfies Partial<CSSStyleDeclaration>);
    button.addEventListener("click", onClick);
    return button;
  };

  const render = (): void => {
    overlay?.remove();
    overlay = undefined;
    if (view === "closed") return;

    const content = pickPauseMenuContent(view);
    const root = document.createElement("div");
    overlay = root;
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(2, 6, 10, 0.68)",
      color: "rgba(255, 255, 255, 0.94)",
      zIndex: `${MENU_Z_INDEX}`,
      pointerEvents: "auto",
      padding: "24px",
      boxSizing: "border-box",
    } satisfies Partial<CSSStyleDeclaration>);
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", content.title);
    root.setAttribute("data-pause-menu-overlay", "true");

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      width: "min(360px, 100%)",
      borderRadius: "8px",
      border: "1px solid rgba(255, 255, 255, 0.22)",
      background: "rgba(12, 18, 24, 0.96)",
      boxShadow: "0 18px 46px rgba(0, 0, 0, 0.42)",
      padding: "24px",
      display: "flex",
      flexDirection: "column",
      gap: "16px",
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement("div");
    title.textContent = content.title;
    Object.assign(title.style, {
      font: "700 24px / 1.2 system-ui, sans-serif",
    } satisfies Partial<CSSStyleDeclaration>);
    panel.appendChild(title);

    if (content.body) {
      const body = document.createElement("div");
      body.textContent = content.body;
      Object.assign(body.style, {
        font: "500 14px / 1.45 system-ui, sans-serif",
        color: "rgba(255, 255, 255, 0.78)",
      } satisfies Partial<CSSStyleDeclaration>);
      panel.appendChild(body);
    }

    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "10px",
    } satisfies Partial<CSSStyleDeclaration>);

    if (view === "confirm-reset") {
      actions.appendChild(
        makeButton(
          content.primary,
          () => {
            close();
            options.onResetConfirmed();
          },
          "primary",
        ),
      );
      actions.appendChild(
        makeButton(
          content.secondary ?? "Cancel",
          () => {
            setView(nextPauseMenuView(view, "cancel-reset"));
          },
          "secondary",
        ),
      );
    } else {
      actions.appendChild(makeButton(content.primary, close, "primary"));
      actions.appendChild(
        makeButton(
          content.secondary ?? "Reset run",
          () => {
            setView(nextPauseMenuView(view, "open-reset-confirmation"));
          },
          "secondary",
        ),
      );
    }

    panel.appendChild(actions);
    root.appendChild(panel);
    container.appendChild(root);

    const firstButton = actions.querySelector("button");
    if (firstButton instanceof HTMLButtonElement) {
      firstButton.focus();
    }
  };

  pauseButton.addEventListener("click", openMenu);
  container.appendChild(pauseButton);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    overlay?.remove();
    pauseButton.removeEventListener("click", openMenu);
    pauseButton.remove();
  };

  return {
    openMenu,
    openResetConfirmation,
    handleEscape,
    close,
    isOpen: () => view !== "closed",
    dispose,
  };
}
