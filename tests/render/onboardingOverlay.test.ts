import { describe, expect, it } from "vitest";
import { pickOnboardingContent } from "../../src/render/onboardingOverlay.ts";

describe("pickOnboardingContent (F-016)", () => {
  it("returns the keyboard legend plus the goal line for fine-pointer devices", () => {
    const { lines } = pickOnboardingContent(false);
    expect(lines).toContain("Move: WASD");
    expect(lines).toContain("Punch: SPACE");
    expect(lines).toContain("Pick up: F");
    expect(lines).toContain("Throw: T");
    expect(lines).toContain("Reset: R");
    expect(lines.at(-1)).toBe("Goal: escape through a lit door.");
  });

  it("returns the goal line only for coarse-pointer devices", () => {
    const { lines } = pickOnboardingContent(true);
    expect(lines).toEqual(["Goal: escape through a lit door."]);
  });

  it("returns a frozen-shape readonly array (callers cannot mutate the shared content)", () => {
    const fine = pickOnboardingContent(false);
    const coarse = pickOnboardingContent(true);
    expect(Array.isArray(fine.lines)).toBe(true);
    expect(Array.isArray(coarse.lines)).toBe(true);
    expect(fine.lines.length).toBeGreaterThan(coarse.lines.length);
  });
});
