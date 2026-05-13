import { describe, expect, it } from "vitest";
import { pickActStateLabel } from "../../src/render/actStateHud.ts";
import { ACT_STATE_CHAIN } from "../../src/sim/actState.ts";

describe("pickActStateLabel (F-019)", () => {
  it("returns the empty string for the seed state so the HUD shows blank pre-spawn", () => {
    expect(pickActStateLabel("not-started")).toBe("");
  });

  it("labels Act 1 spawn as 'Act 1: Spawn'", () => {
    expect(pickActStateLabel("act-1-spawn")).toBe("Act 1: Spawn");
  });

  it("labels the two Act 2 loops with their ordinal", () => {
    expect(pickActStateLabel("act-2-loop-1")).toBe("Act 2: First Loop");
    expect(pickActStateLabel("act-2-loop-2")).toBe("Act 2: Second Loop");
  });

  it("labels every Act 3 beat", () => {
    expect(pickActStateLabel("act-3-setup")).toBe("Act 3: Setup");
    expect(pickActStateLabel("act-3-chase")).toBe("Act 3: Chase");
    expect(pickActStateLabel("act-3-team-up")).toBe("Act 3: Team Up");
    expect(pickActStateLabel("act-3-mirror")).toBe("Act 3: Mirror");
    expect(pickActStateLabel("act-3-final-knockout")).toBe(
      "Act 3: Final Knockout",
    );
  });

  it("labels the terminal state simply 'Escaped'", () => {
    expect(pickActStateLabel("escaped")).toBe("Escaped");
  });

  it("returns a non-empty label for every state in the chain except 'not-started'", () => {
    for (const state of ACT_STATE_CHAIN) {
      const label = pickActStateLabel(state);
      if (state === "not-started") {
        expect(label).toBe("");
      } else {
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });
});
