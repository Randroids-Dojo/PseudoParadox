import { describe, expect, it } from "vitest";
import { pickWinScreenContent } from "../../src/render/winScreen.ts";

describe("pickWinScreenContent (F-017)", () => {
  it("returns the title 'You escaped.'", () => {
    expect(pickWinScreenContent().title).toBe("You escaped.");
  });

  it("returns the prompt 'Play again (R)' for the reset hint", () => {
    expect(pickWinScreenContent().prompt).toBe("Play again (R)");
  });

  it("returns a fresh object so the title and prompt are never empty", () => {
    const { title, prompt } = pickWinScreenContent();
    expect(title.length).toBeGreaterThan(0);
    expect(prompt.length).toBeGreaterThan(0);
  });
});
