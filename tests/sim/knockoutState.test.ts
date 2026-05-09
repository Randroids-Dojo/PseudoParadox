import { describe, expect, it } from "vitest";
import {
  applyKnockout,
  isConscious,
  INITIAL_CONSCIOUSNESS,
} from "../../src/sim/knockoutState.ts";

describe("INITIAL_CONSCIOUSNESS (REQ-033 partial)", () => {
  it("is 'conscious' so freshly-spawned instances default to conscious", () => {
    expect(INITIAL_CONSCIOUSNESS).toBe("conscious");
  });
});

describe("applyKnockout (REQ-033 partial)", () => {
  it("flips a conscious state to unconscious", () => {
    expect(applyKnockout("conscious")).toBe("unconscious");
  });

  it("is idempotent on an already-unconscious state", () => {
    expect(applyKnockout("unconscious")).toBe("unconscious");
    expect(applyKnockout(applyKnockout("conscious"))).toBe("unconscious");
  });

  it("does not mutate its input argument (it takes a primitive string)", () => {
    const before: "conscious" | "unconscious" = "conscious";
    applyKnockout(before);
    // Primitives cannot be mutated; this assertion is a smoke test that the
    // helper does not, e.g., reassign the binding via a side channel.
    expect(before).toBe("conscious");
  });
});

describe("isConscious (REQ-033 partial)", () => {
  it("returns true for 'conscious' and false for 'unconscious'", () => {
    expect(isConscious("conscious")).toBe(true);
    expect(isConscious("unconscious")).toBe(false);
  });
});
