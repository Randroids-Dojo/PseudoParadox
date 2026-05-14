import { describe, expect, it } from "vitest";
import {
  PLAYER_SETTINGS_STORAGE_KEY,
  defaultPlayerSettings,
  pickPlayerSettingsLabels,
  readPlayerSettings,
  writePlayerSettings,
  type PlayerSettingsStorage,
} from "../../src/render/playerSettings.ts";

function memoryStorage(seed?: string): PlayerSettingsStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(PLAYER_SETTINGS_STORAGE_KEY, seed);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("defaultPlayerSettings (F-023)", () => {
  it("inherits reduce-motion from the platform preference", () => {
    expect(defaultPlayerSettings(true)).toEqual({
      muted: false,
      reduceMotion: true,
    });
  });
});

describe("player settings storage (F-023)", () => {
  it("falls back when storage is empty", () => {
    expect(
      readPlayerSettings(memoryStorage(), {
        muted: true,
        reduceMotion: false,
      }),
    ).toEqual({ muted: true, reduceMotion: false });
  });

  it("reads saved booleans and ignores malformed fields", () => {
    const storage = memoryStorage(
      JSON.stringify({ muted: true, reduceMotion: "no" }),
    );

    expect(
      readPlayerSettings(storage, {
        muted: false,
        reduceMotion: true,
      }),
    ).toEqual({ muted: true, reduceMotion: true });
  });

  it("writes the persisted settings payload", () => {
    const storage = memoryStorage();

    writePlayerSettings(storage, { muted: true, reduceMotion: true });

    expect(storage.values.get(PLAYER_SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify({ muted: true, reduceMotion: true }),
    );
  });

  it("treats blocked storage as optional", () => {
    const storage: PlayerSettingsStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(
      readPlayerSettings(storage, {
        muted: false,
        reduceMotion: true,
      }),
    ).toEqual({ muted: false, reduceMotion: true });
    expect(() =>
      writePlayerSettings(storage, { muted: true, reduceMotion: true }),
    ).not.toThrow();
  });
});

describe("pickPlayerSettingsLabels (F-023)", () => {
  it("shows the mute action when audio is currently enabled", () => {
    expect(
      pickPlayerSettingsLabels({ muted: false, reduceMotion: false }).mute,
    ).toBe("Mute");
  });

  it("shows the unmute action when audio is currently muted", () => {
    expect(
      pickPlayerSettingsLabels({ muted: true, reduceMotion: false }).mute,
    ).toBe("Unmute");
  });

  it("shows the motion action based on the current reduced-motion state", () => {
    expect(
      pickPlayerSettingsLabels({ muted: false, reduceMotion: false }).motion,
    ).toBe("Reduce motion");
    expect(
      pickPlayerSettingsLabels({ muted: false, reduceMotion: true }).motion,
    ).toBe("Motion on");
  });
});
