import { describe, expect, it } from "vitest";
import type { KeyState } from "../../src/input/keyboard.ts";
import {
  AUTOPLAY_SCRIPT,
  autoplayRequestedFromUrl,
  createAutoplayDriver,
  type AutoplayStep,
} from "../../src/debug/autoplayDriver.ts";

const makeState = (): KeyState => ({
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
});

describe("autoplayRequestedFromUrl", () => {
  it("returns true when the debug query param is autoplay", () => {
    expect(autoplayRequestedFromUrl("https://example.com/?debug=autoplay")).toBe(true);
    expect(autoplayRequestedFromUrl("https://example.com/?foo=1&debug=autoplay")).toBe(true);
  });

  it("returns false for any other URL shape", () => {
    expect(autoplayRequestedFromUrl("https://example.com/")).toBe(false);
    expect(autoplayRequestedFromUrl("https://example.com/?debug=clips")).toBe(false);
    expect(autoplayRequestedFromUrl("not a url at all")).toBe(false);
  });
});

describe("createAutoplayDriver", () => {
  it("writes the step's inputs into the live KeyState", () => {
    const keyboard = { state: makeState() };
    const driver = createAutoplayDriver(keyboard);
    driver.advance();
    // First scripted step is `walk-sw` which sets `back = true` and
    // `left = true`. The diagonal lands the figure at the SW lit door.
    expect(keyboard.state.back).toBe(true);
    expect(keyboard.state.left).toBe(true);
    expect(keyboard.state.forward).toBe(false);
    expect(keyboard.state.punch).toBe(false);
    expect(driver.currentLabel()).toBe("walk-sw");
  });

  it("clears stale channels between steps", () => {
    // Pre-poison the state with a punch the prior step would not have
    // touched. The driver's `clearAll` inside every step's `apply` is
    // what guarantees a stuck key from a previous source does not
    // bleed into the next phase.
    const keyboard = { state: makeState() };
    keyboard.state.punch = true;
    keyboard.state.right = true;
    const driver = createAutoplayDriver(keyboard);
    driver.advance();
    expect(keyboard.state.punch).toBe(false);
    expect(keyboard.state.right).toBe(false);
  });

  it("loops the script forever", () => {
    const keyboard = { state: makeState() };
    const totalTicks = AUTOPLAY_SCRIPT.reduce((sum, step) => sum + step.ticks, 0);
    const driver = createAutoplayDriver(keyboard);
    for (let i = 0; i < totalTicks + 1; i += 1) {
      driver.advance();
    }
    // After one full loop plus a single extra advance, the most-recently-
    // applied step is the first step of the second loop iteration.
    expect(driver.currentLabel()).toBe(AUTOPLAY_SCRIPT[0].label);
  });

  it("walks through every step in order and applies its inputs", () => {
    const probe: AutoplayStep[] = [
      {
        label: "set-forward",
        ticks: 2,
        apply: (s) => {
          s.forward = true;
          s.back = false;
        },
      },
      {
        label: "set-back",
        ticks: 2,
        apply: (s) => {
          s.forward = false;
          s.back = true;
        },
      },
    ];
    const keyboard = { state: makeState() };
    const driver = createAutoplayDriver(keyboard, probe);

    driver.advance();
    expect(driver.currentLabel()).toBe("set-forward");
    expect(keyboard.state.forward).toBe(true);
    driver.advance();
    expect(driver.currentLabel()).toBe("set-forward");
    driver.advance();
    expect(driver.currentLabel()).toBe("set-back");
    expect(keyboard.state.back).toBe(true);
    expect(keyboard.state.forward).toBe(false);
  });
});
