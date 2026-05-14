export interface PlayerSettings {
  readonly muted: boolean;
  readonly reduceMotion: boolean;
}

export interface PlayerSettingsStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface PlayerSettingsControlsHandle {
  readonly settings: PlayerSettings;
  dispose: () => void;
}

export interface CreatePlayerSettingsControlsOptions {
  initialSettings?: PlayerSettings;
  storage?: PlayerSettingsStorage;
  prefersReducedMotion?: boolean;
  onChange?: (settings: PlayerSettings) => void;
}

export const PLAYER_SETTINGS_STORAGE_KEY = "pseudo-paradox-player-settings-v1";

export function defaultPlayerSettings(
  prefersReducedMotion = false,
): PlayerSettings {
  return {
    muted: false,
    reduceMotion: prefersReducedMotion,
  };
}

export function readPlayerSettings(
  storage: PlayerSettingsStorage | undefined,
  fallback: PlayerSettings,
): PlayerSettings {
  if (!storage) return fallback;
  let raw: string | null;
  try {
    raw = storage.getItem(PLAYER_SETTINGS_STORAGE_KEY);
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
    return {
      muted: typeof parsed.muted === "boolean" ? parsed.muted : fallback.muted,
      reduceMotion:
        typeof parsed.reduceMotion === "boolean"
          ? parsed.reduceMotion
          : fallback.reduceMotion,
    };
  } catch {
    return fallback;
  }
}

export function writePlayerSettings(
  storage: PlayerSettingsStorage | undefined,
  settings: PlayerSettings,
): void {
  if (!storage) return;
  try {
    storage.setItem(PLAYER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Browsers can reject localStorage writes in private or blocked-storage
    // modes. The settings still apply for the current page life.
  }
}

export function pickPlayerSettingsLabels(settings: PlayerSettings): {
  readonly mute: string;
  readonly motion: string;
} {
  return {
    mute: settings.muted ? "Unmute" : "Mute",
    motion: settings.reduceMotion ? "Motion on" : "Reduce motion",
  };
}

export function createPlayerSettingsControls(
  container: HTMLElement,
  options: CreatePlayerSettingsControlsOptions = {},
): PlayerSettingsControlsHandle {
  const prefersReducedMotion =
    options.prefersReducedMotion ??
    (typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false);
  const storage =
    options.storage ??
    (() => {
      if (typeof window === "undefined") return undefined;
      try {
        return window.localStorage;
      } catch {
        return undefined;
      }
    })();
  let settings =
    options.initialSettings ??
    readPlayerSettings(storage, defaultPlayerSettings(prefersReducedMotion));
  let disposed = false;

  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "fixed",
    top: "92px",
    right: "12px",
    display: "flex",
    gap: "8px",
    zIndex: "26",
    pointerEvents: "auto",
  } satisfies Partial<CSSStyleDeclaration>);
  root.setAttribute("data-player-settings", "true");

  const makeButton = (label: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    Object.assign(button.style, {
      minWidth: "86px",
      height: "36px",
      borderRadius: "8px",
      border: "1px solid rgba(255, 255, 255, 0.68)",
      background: "rgba(10, 10, 10, 0.42)",
      color: "rgba(255, 255, 255, 0.94)",
      font: "600 12px / 1 system-ui, sans-serif",
      cursor: "pointer",
      touchAction: "manipulation",
      padding: "0 10px",
    } satisfies Partial<CSSStyleDeclaration>);
    button.setAttribute("aria-label", label);
    return button;
  };

  const muteButton = makeButton("Mute audio");
  const motionButton = makeButton("Reduce motion");

  const render = (): void => {
    const labels = pickPlayerSettingsLabels(settings);
    muteButton.textContent = labels.mute;
    muteButton.setAttribute("aria-pressed", String(settings.muted));
    motionButton.textContent = labels.motion;
    motionButton.setAttribute("aria-pressed", String(settings.reduceMotion));
  };

  const setSettings = (next: PlayerSettings): void => {
    if (disposed) return;
    settings = next;
    writePlayerSettings(storage, settings);
    render();
    options.onChange?.(settings);
  };

  muteButton.addEventListener("click", () => {
    setSettings({ ...settings, muted: !settings.muted });
  });
  motionButton.addEventListener("click", () => {
    setSettings({ ...settings, reduceMotion: !settings.reduceMotion });
  });

  render();
  root.appendChild(muteButton);
  root.appendChild(motionButton);
  container.appendChild(root);
  options.onChange?.(settings);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    root.remove();
  };

  return {
    get settings(): PlayerSettings {
      return settings;
    },
    dispose,
  };
}
