import { describe, expect, it } from "vitest";
import {
  INITIAL_INSTANCE_ID,
  formatInstanceId,
  nextInstanceId,
} from "../../src/sim/instanceId.ts";

/**
 * Unit tests for the GDD-canonical instance generation numbering (REQ-007).
 * Quoting `docs/gdd/02-time-travel-rules.md` Instance numbering:
 *   "You1 is always the first-ever spawn... You-1 is the instance You1 sees
 *    arrive (the first replay). You-2 is the instance You-1 sees arrive
 *    (the second-order replay)."
 */

describe("INITIAL_INSTANCE_ID", () => {
  it("seeds at 1 (the GDD's first-ever spawn, You1)", () => {
    expect(INITIAL_INSTANCE_ID).toBe(1);
  });
});

describe("formatInstanceId", () => {
  it("formats 1 as You1 (the seed instance)", () => {
    expect(formatInstanceId(1)).toBe("You1");
  });

  it("formats 2 as You-1 (the first replay)", () => {
    expect(formatInstanceId(2)).toBe("You-1");
  });

  it("formats 3 as You-2 (the second-order replay)", () => {
    expect(formatInstanceId(3)).toBe("You-2");
  });

  it("formats 4 as You-3", () => {
    expect(formatInstanceId(4)).toBe("You-3");
  });

  it("formats 5 as You-4", () => {
    expect(formatInstanceId(5)).toBe("You-4");
  });

  it("rejects non-integer inputs", () => {
    expect(() => formatInstanceId(1.5)).toThrow(/integer/);
  });

  it("rejects zero (0 is not a valid InstanceId)", () => {
    expect(() => formatInstanceId(0)).toThrow(/positive/);
  });

  it("rejects negative inputs", () => {
    expect(() => formatInstanceId(-1)).toThrow(/positive/);
  });
});

describe("nextInstanceId", () => {
  it("advances 1 (You1) to 2 (You-1, the first replay)", () => {
    expect(nextInstanceId(1)).toBe(2);
  });

  it("advances 2 (You-1) to 3 (You-2)", () => {
    expect(nextInstanceId(2)).toBe(3);
  });

  it("composes monotonically (1 -> 2 -> 3 -> 4 -> 5)", () => {
    let id = INITIAL_INSTANCE_ID;
    const sequence: string[] = [formatInstanceId(id)];
    for (let i = 0; i < 4; i++) {
      id = nextInstanceId(id);
      sequence.push(formatInstanceId(id));
    }
    expect(sequence).toEqual(["You1", "You-1", "You-2", "You-3", "You-4"]);
  });

  it("rejects non-integer inputs", () => {
    expect(() => nextInstanceId(1.5)).toThrow(/integer/);
  });

  it("rejects non-positive inputs", () => {
    expect(() => nextInstanceId(0)).toThrow(/positive/);
  });
});
