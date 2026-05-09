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

  it("returns null for an unauthored timeline (hour 12)", () => {
    // The seed currently authors only 5 and 6. Hour 12 is reachable via the
    // South-from-5:00 portal but is not in the seed; the function returns
    // null and `wireTraversal` falls back to the portal's frozen `isLit`
    // flag (preserving pre-REQ-011 behavior for unauthored hours).
    const state = litStateForTimeline(12, { ghosts: NO_GHOSTS });
    expect(state).toBeNull();
  });

  it("returns null for unauthored hours 0 and 23", () => {
    expect(litStateForTimeline(0, { ghosts: NO_GHOSTS })).toBeNull();
    expect(litStateForTimeline(23, { ghosts: NO_GHOSTS })).toBeNull();
  });

  it("DEFAULT_BLOCKED_BY_ARRIVALS returns false for every input", () => {
    // The MVP body of the arrivals predicate. Acts 1-3 do not yet have a
    // narrative beat that blocks a door via arrivals; the default keeps the
    // seed lit/dark state authoritative until Act 2 / Act 3 land.
    for (const cardinal of CARDINALS) {
      expect(DEFAULT_BLOCKED_BY_ARRIVALS(NO_GHOSTS, cardinal)).toBe(false);
    }
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
  });

  it("returns null for unauthored hours", () => {
    expect(litStateForCardinal(12, "south", { ghosts: NO_GHOSTS })).toBeNull();
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
