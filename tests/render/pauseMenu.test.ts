import { describe, expect, it } from "vitest";
import {
  nextPauseMenuView,
  pickPauseMenuContent,
  type PauseMenuView,
} from "../../src/render/pauseMenu.ts";

describe("pause menu content", () => {
  it("uses the compact pause-menu labels from the GDD", () => {
    expect(pickPauseMenuContent("menu")).toEqual({
      title: "Paused",
      primary: "Resume",
      secondary: "Reset run",
    });
  });

  it("uses concrete reset confirmation copy", () => {
    expect(pickPauseMenuContent("confirm-reset")).toEqual({
      title: "Reset run?",
      body: "Return to the 5:00 start and clear every recorded instance.",
      primary: "Reset to 5:00",
      secondary: "Cancel",
    });
  });
});

describe("pause menu state transitions", () => {
  it.each<{
    readonly from: PauseMenuView;
    readonly action: Parameters<typeof nextPauseMenuView>[1];
    readonly to: PauseMenuView;
  }>([
    { from: "closed", action: "open-menu", to: "menu" },
    { from: "closed", action: "open-reset-confirmation", to: "confirm-reset" },
    { from: "menu", action: "open-reset-confirmation", to: "confirm-reset" },
    { from: "confirm-reset", action: "cancel-reset", to: "menu" },
    { from: "menu", action: "close", to: "closed" },
    { from: "confirm-reset", action: "close", to: "closed" },
  ])("$from + $action -> $to", ({ from, action, to }) => {
    expect(nextPauseMenuView(from, action)).toBe(to);
  });
});
