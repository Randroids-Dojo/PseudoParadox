import { describe, expect, it } from "vitest";
import {
  litStateForCardinal,
  litStateForTimeline,
  DEFAULT_BLOCKED_BY_ARRIVALS,
  type BlockedByArrivals,
} from "../../src/sim/litStateForTimeline.ts";
import {
  DOOR_STATE_BY_HOUR,
  doorLitStateAtHour,
} from "../../src/sim/doorStateAtTime.ts";
import type { GhostInstance } from "../../src/sim/ghostInstance.ts";
import type { DoorDirection } from "../../src/scene/door.ts";

const NO_GHOSTS: readonly GhostInstance[] = [];
const CARDINALS: readonly DoorDirection[] = ["north", "south", "east", "west"];

describe("litStateForTimeline (REQ-011)", () => {
  it("returns the seed object for hour 5 when no arrivals override", () => {
    const state = litStateForTimeline(5, { ghosts: NO_GHOSTS });
    expect(state).not.toBeNull();
    // No arrivals override means the seed object passes through by reference,
    // so a future caller relying on identity (the `DOOR_STATE_BY_HOUR[5]
    // is the source of truth` regression test) keeps holding.
    expect(state).toBe(DOOR_STATE_BY_HOUR[5]);
  });

  it("returns the seed object for hour 6 when no arrivals override", () => {
    const state = litStateForTimeline(6, { ghosts: NO_GHOSTS });
    expect(state).not.toBeNull();
    expect(state).toBe(DOOR_STATE_BY_HOUR[6]);
  });

  it("matches `doorLitStateAtHour(hour)` for every authored hour and cardinal under the default arrivals stub", () => {
    // Acts 1-3 starting state: `litStateForTimeline` and `doorLitStateAtHour`
    // are equivalent for every authored hour (the arrivals stub returns
    // false, so seed AND-ed with !false === seed).
    for (const hour of [5, 6] as const) {
      const direct = doorLitStateAtHour(hour);
      const derived = litStateForTimeline(hour, { ghosts: NO_GHOSTS });
      expect(derived).not.toBeNull();
      for (const cardinal of CARDINALS) {
        expect(derived![cardinal]).toBe(direct[cardinal]);
      }
    }
  });

  it("returns the seed object for hour 12 when no arrivals override (REQ-023 escape seed)", () => {
    // The 12:00 seed authors `north: true` (the escape door); with no
    // ghosts in flight, the seed reads through unchanged.
    const state = litStateForTimeline(12, { ghosts: NO_GHOSTS });
    expect(state).not.toBeNull();
    expect(state).toBe(DOOR_STATE_BY_HOUR[12]);
    expect(state!.north).toBe(true);
  });

  it("returns null for unauthored hours 0 and 23", () => {
    expect(litStateForTimeline(0, { ghosts: NO_GHOSTS })).toBeNull();
    expect(litStateForTimeline(23, { ghosts: NO_GHOSTS })).toBeNull();
  });

  it("DEFAULT_BLOCKED_BY_ARRIVALS returns false for every (5, cardinal) and (6, cardinal) pair", () => {
    // The Acts 1-3 body only blocks North-at-12; every other pair is
    // unblocked. Acts 1-3 do not have any other narrative beat that blocks
    // a door via arrivals.
    for (const cardinal of CARDINALS) {
      expect(DEFAULT_BLOCKED_BY_ARRIVALS(NO_GHOSTS, cardinal, 5)).toBe(false);
      expect(DEFAULT_BLOCKED_BY_ARRIVALS(NO_GHOSTS, cardinal, 6)).toBe(false);
    }
  });

  it("DEFAULT_BLOCKED_BY_ARRIVALS at (12, north) returns false when no ghost is mid-recording", () => {
    // No ghosts at all: nothing is staffing the door, so the seed lights
    // through and the player can escape.
    expect(DEFAULT_BLOCKED_BY_ARRIVALS(NO_GHOSTS, "north", 12)).toBe(false);
    // Ghosts present but all completed: every recording exhausted, so
    // nothing is staffing the door.
    const completedGhost = {
      tickIndex: 50,
      recording: { length: 50 },
    } as unknown as GhostInstance;
    expect(
      DEFAULT_BLOCKED_BY_ARRIVALS([completedGhost], "north", 12),
    ).toBe(false);
  });

  it("DEFAULT_BLOCKED_BY_ARRIVALS at (12, north) returns true when any ghost is mid-recording", () => {
    // One ghost mid-recording: the door is blocked. The cinematic body
    // (1-frame recording) at tickIndex 0 satisfies this.
    const inFlightGhost = {
      tickIndex: 0,
      recording: { length: 1 },
    } as unknown as GhostInstance;
    expect(
      DEFAULT_BLOCKED_BY_ARRIVALS([inFlightGhost], "north", 12),
    ).toBe(true);
    // Mixed: one completed, one mid-recording. The any() reads true.
    const completedGhost = {
      tickIndex: 50,
      recording: { length: 50 },
    } as unknown as GhostInstance;
    expect(
      DEFAULT_BLOCKED_BY_ARRIVALS(
        [completedGhost, inFlightGhost],
        "north",
        12,
      ),
    ).toBe(true);
  });

  it("DEFAULT_BLOCKED_BY_ARRIVALS does not block non-North cardinals at 12:00", () => {
    // The arrivals rule scopes to North only at 12:00. South / East / West
    // at 12:00 are unblocked even with ghosts mid-recording (the seed
    // already darkens those cardinals at 12:00 anyway).
    const inFlightGhost = {
      tickIndex: 0,
      recording: { length: 1 },
    } as unknown as GhostInstance;
    for (const cardinal of ["south", "east", "west"] as const) {
      expect(
        DEFAULT_BLOCKED_BY_ARRIVALS([inFlightGhost], cardinal, 12),
      ).toBe(false);
    }
  });

  it("DEFAULT_BLOCKED_BY_ARRIVALS does not light a seed-dark cardinal via the seed-and-blocked rule", () => {
    // The full lit-state rule is `seed && !blocked`. A seed-dark cardinal
    // stays dark regardless of what `blocked` returns; this test confirms
    // that even at (12, south) where the seed is dark and the rule
    // returns false, `litStateForTimeline` does NOT flip the cardinal lit.
    const state = litStateForTimeline(12, { ghosts: NO_GHOSTS });
    expect(state!.south).toBe(false);
  });

  it("flips the North door at 12:00 to dark while a cinematic-shaped ghost is mid-recording", () => {
    // End-to-end: a single in-flight ghost in the bucket darkens the
    // seeded-lit North door via the default arrivals rule.
    const inFlightGhost = {
      tickIndex: 30,
      recording: { length: 240 },
    } as unknown as GhostInstance;
    const state = litStateForTimeline(12, { ghosts: [inFlightGhost] });
    expect(state).not.toBeNull();
    expect(state!.north).toBe(false);
    expect(state).not.toBe(DOOR_STATE_BY_HOUR[12]);
  });

  it("lights the North door at 12:00 once every cinematic-shaped ghost has completed", () => {
    // The escape state: every ghost has reached tickIndex >= recording.length,
    // so the arrivals rule reads false and the seed lights through.
    const completedDragger = {
      tickIndex: 240,
      recording: { length: 240 },
    } as unknown as GhostInstance;
    const completedBody = {
      tickIndex: 1,
      recording: { length: 1 },
    } as unknown as GhostInstance;
    const state = litStateForTimeline(12, {
      ghosts: [completedDragger, completedDragger, completedBody],
    });
    expect(state).not.toBeNull();
    expect(state!.north).toBe(true);
    expect(state).toBe(DOOR_STATE_BY_HOUR[12]);
  });

  it("respects an injected arrivals predicate that blocks a single cardinal", () => {
    // Inject a predicate that says "South is blocked by arrivals". The seed
    // at 5:00 lights South, so the derived state must darken it. North/West
    // were already dark; East stays lit.
    const blockSouth: BlockedByArrivals = (_ghosts, cardinal) =>
      cardinal === "south";
    const state = litStateForTimeline(5, {
      ghosts: NO_GHOSTS,
      blockedByArrivals: blockSouth,
    });
    expect(state).not.toBeNull();
    expect(state!.south).toBe(false);
    expect(state!.east).toBe(true);
    expect(state!.north).toBe(false);
    expect(state!.west).toBe(false);
  });

  it("does NOT light a seed-dark door even if arrivals predicate would clear it", () => {
    // The blocked-by-arrivals path can only DARKEN a seed-lit door. A
    // seed-dark door stays dark regardless of what the predicate returns,
    // because the rule is `seed && !blocked`. This protects the GDD's
    // intent: the seed is the ground truth for "this door has nothing
    // arriving here" and arrivals can only subtract from that.
    const everythingClear: BlockedByArrivals = () => false;
    const everythingBlocked: BlockedByArrivals = () => true;
    // 5:00 has North dark, West dark.
    const stateA = litStateForTimeline(5, {
      ghosts: NO_GHOSTS,
      blockedByArrivals: everythingClear,
    });
    expect(stateA!.north).toBe(false);
    expect(stateA!.west).toBe(false);
    const stateB = litStateForTimeline(5, {
      ghosts: NO_GHOSTS,
      blockedByArrivals: everythingBlocked,
    });
    expect(stateB!.north).toBe(false);
    expect(stateB!.west).toBe(false);
  });

  it("returns a fresh result object (not the seed) when arrivals override", () => {
    // Reference equality matters here: a caller mutating the returned state
    // must not corrupt the seed. The override path returns a fresh object;
    // the no-override path returns the seed by reference (covered above) so
    // existing identity-based tests still pass.
    const blockEast: BlockedByArrivals = (_ghosts, cardinal) =>
      cardinal === "east";
    const state = litStateForTimeline(5, {
      ghosts: NO_GHOSTS,
      blockedByArrivals: blockEast,
    });
    expect(state).not.toBe(DOOR_STATE_BY_HOUR[5]);
    expect(state!.east).toBe(false);
    // The seed itself is untouched.
    expect(DOOR_STATE_BY_HOUR[5]!.east).toBe(true);
  });

  it("hands the registry's per-timeline ghost list to the predicate", () => {
    // Smoke test the seam: the predicate receives the same `ghosts` array
    // the caller passed in, not some other reference. This is how a future
    // Acts 2-3 rule will read the recorded arrivals.
    const fakeGhost = { tag: "fake-ghost-marker" } as unknown as GhostInstance;
    const fakeList: readonly GhostInstance[] = [fakeGhost];
    let received: readonly GhostInstance[] | null = null;
    const capturing: BlockedByArrivals = (ghosts) => {
      received = ghosts;
      return false;
    };
    litStateForTimeline(5, {
      ghosts: fakeList,
      blockedByArrivals: capturing,
    });
    expect(received).toBe(fakeList);
  });
});

describe("litStateForCardinal (REQ-011)", () => {
  it("returns the seed bit for an authored hour and cardinal", () => {
    expect(litStateForCardinal(5, "south", { ghosts: NO_GHOSTS })).toBe(true);
    expect(litStateForCardinal(5, "north", { ghosts: NO_GHOSTS })).toBe(false);
    expect(litStateForCardinal(6, "west", { ghosts: NO_GHOSTS })).toBe(true);
    expect(litStateForCardinal(6, "east", { ghosts: NO_GHOSTS })).toBe(false);
    // REQ-023: hour 12 is now authored (north lit, others dark).
    expect(litStateForCardinal(12, "north", { ghosts: NO_GHOSTS })).toBe(true);
    expect(litStateForCardinal(12, "south", { ghosts: NO_GHOSTS })).toBe(false);
  });

  it("returns null for unauthored hours", () => {
    expect(litStateForCardinal(7, "south", { ghosts: NO_GHOSTS })).toBeNull();
    expect(litStateForCardinal(0, "north", { ghosts: NO_GHOSTS })).toBeNull();
  });

  it("respects the injected arrivals predicate", () => {
    const blockSouth: BlockedByArrivals = (_g, cardinal) => cardinal === "south";
    expect(
      litStateForCardinal(5, "south", {
        ghosts: NO_GHOSTS,
        blockedByArrivals: blockSouth,
      }),
    ).toBe(false);
    expect(
      litStateForCardinal(5, "east", {
        ghosts: NO_GHOSTS,
        blockedByArrivals: blockSouth,
      }),
    ).toBe(true);
  });
});
