import { describe, expect, it } from "vitest";
import {
  ACT_STATE_CHAIN,
  CHASE_WINDOW_TICKS,
  DROP_CENTER_RADIUS_M,
  INITIAL_ACT_STATE,
  RECENT_WEST_ENTRIES_CAPACITY,
  actStateIndex,
  createActStateObserver,
  evaluateActState,
  isAct1Spawn,
  isAct2Loop1,
  isAct2Loop2,
  isAct3Chase,
  isAct3FinalKnockout,
  isAct3Mirror,
  isAct3Setup,
  isAct3TeamUp,
  isEscaped,
  maxActState,
  type ActState,
  type ActStateSnapshot,
  type BucketGhostSnapshot,
  type WestEntry,
} from "../../src/sim/actState.ts";
import type { CarryState } from "../../src/sim/carryState.ts";
import type { Consciousness } from "../../src/sim/knockoutState.ts";

// -----------------------------------------------------------------------------
// Test fixtures: a builder for ActStateSnapshot that defaults every field to a
// neutral value so each test only has to override the inputs the predicate
// under test reads. This keeps the tests focused and readable.
// -----------------------------------------------------------------------------

interface BuildSnapshotOptions {
  currentTimeline?: number;
  activeCarry?: CarryState;
  activeConsciousness?: Consciousness;
  activePosition?: { x: number; z: number };
  buckets?: Record<number, readonly BucketGhostSnapshot[]>;
  recentWestEntries?: readonly WestEntry[];
  activePlayerCrossedNorthAt12?: boolean;
}

function buildSnapshot(opts: BuildSnapshotOptions = {}): ActStateSnapshot {
  const buckets = opts.buckets ?? {};
  const ghostsFor = (timeline: number): readonly BucketGhostSnapshot[] =>
    buckets[timeline] ?? [];
  return {
    registry: {
      activeTimeline: opts.currentTimeline ?? 5,
      ghostsFor,
    },
    instances: [],
    currentTimeline: opts.currentTimeline ?? 5,
    activePlayer: {
      instanceId: 1,
      position: opts.activePosition ?? { x: 0, z: 0 },
      consciousness: opts.activeConsciousness ?? "conscious",
      carry: opts.activeCarry ?? { kind: "idle" },
    },
    recentWestEntries: opts.recentWestEntries ?? [],
    activePlayerCrossedNorthAt12: opts.activePlayerCrossedNorthAt12 ?? false,
  };
}

function ghost(
  overrides: Partial<BucketGhostSnapshot> & { id: number },
): BucketGhostSnapshot {
  return {
    id: overrides.id,
    position: overrides.position ?? { x: 0, z: 0 },
    consciousness: overrides.consciousness ?? "conscious",
    originNormalized: overrides.originNormalized ?? 5 / 24,
    tickIndex: overrides.tickIndex ?? 0,
    recordingLength: overrides.recordingLength ?? 100,
  };
}

// -----------------------------------------------------------------------------
// Section: chain plus helpers
// -----------------------------------------------------------------------------

describe("ACT_STATE_CHAIN", () => {
  it("starts at not-started and ends at escaped", () => {
    expect(ACT_STATE_CHAIN[0]).toBe("not-started");
    expect(ACT_STATE_CHAIN[ACT_STATE_CHAIN.length - 1]).toBe("escaped");
  });

  it("contains every documented beat in canonical order", () => {
    expect(ACT_STATE_CHAIN).toEqual([
      "not-started",
      "act-1-spawn",
      "act-2-loop-1",
      "act-2-loop-2",
      "act-3-setup",
      "act-3-chase",
      "act-3-team-up",
      "act-3-mirror",
      "act-3-final-knockout",
      "escaped",
    ]);
  });
});

describe("actStateIndex", () => {
  it("returns increasing indices along the chain", () => {
    let prev = -1;
    for (const s of ACT_STATE_CHAIN) {
      const idx = actStateIndex(s);
      expect(idx).toBeGreaterThan(prev);
      prev = idx;
    }
  });

  it("throws on an unknown state", () => {
    expect(() => actStateIndex("nonsense" as ActState)).toThrow(/unknown/);
  });
});

describe("maxActState", () => {
  it("returns the higher of two states by chain order", () => {
    expect(maxActState("act-3-chase", "act-1-spawn")).toBe("act-3-chase");
    expect(maxActState("escaped", "act-3-mirror")).toBe("escaped");
    expect(maxActState("not-started", "not-started")).toBe("not-started");
  });

  it("is symmetric", () => {
    expect(maxActState("act-2-loop-2", "act-3-setup")).toBe("act-3-setup");
    expect(maxActState("act-3-setup", "act-2-loop-2")).toBe("act-3-setup");
  });
});

// -----------------------------------------------------------------------------
// Constants documented in the dossier are pinned at their Q-NNN defaults.
// -----------------------------------------------------------------------------

describe("constants", () => {
  it("INITIAL_ACT_STATE is not-started", () => {
    expect(INITIAL_ACT_STATE).toBe("not-started");
  });

  it("DROP_CENTER_RADIUS_M is 1.0 (Q-014 default)", () => {
    expect(DROP_CENTER_RADIUS_M).toBe(1.0);
  });

  it("CHASE_WINDOW_TICKS is 2 (REQ-019 dossier default)", () => {
    expect(CHASE_WINDOW_TICKS).toBe(2);
  });

  it("RECENT_WEST_ENTRIES_CAPACITY is 4", () => {
    expect(RECENT_WEST_ENTRIES_CAPACITY).toBe(4);
  });
});

// -----------------------------------------------------------------------------
// Per-beat predicates: each gets a positive case plus at least one negative.
// -----------------------------------------------------------------------------

describe("isAct1Spawn", () => {
  it("returns true with three ghosts in the 12:00 bucket and active timeline 5", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      },
    });
    expect(isAct1Spawn(snap)).toBe(true);
  });

  it("returns false with fewer than three ghosts in the 12:00 bucket", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: { 12: [ghost({ id: 10 }), ghost({ id: 11 })] },
    });
    expect(isAct1Spawn(snap)).toBe(false);
  });

  it("returns false when not in the 5:00 timeline", () => {
    const snap = buildSnapshot({
      currentTimeline: 6,
      buckets: {
        12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      },
    });
    expect(isAct1Spawn(snap)).toBe(false);
  });
});

describe("isAct2Loop1", () => {
  it("returns true when 5 has a completed ghost and 6 has at least one ghost", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        5: [ghost({ id: 1, tickIndex: 100, recordingLength: 100 })],
        6: [ghost({ id: 2 })],
      },
    });
    expect(isAct2Loop1(snap)).toBe(true);
  });

  it("returns false when 5:00 ghost has not finished its recording", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        5: [ghost({ id: 1, tickIndex: 50, recordingLength: 100 })],
        6: [ghost({ id: 2 })],
      },
    });
    expect(isAct2Loop1(snap)).toBe(false);
  });

  it("returns false when the 6:00 bucket is empty", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        5: [ghost({ id: 1, tickIndex: 100, recordingLength: 100 })],
      },
    });
    expect(isAct2Loop1(snap)).toBe(false);
  });
});

describe("isAct2Loop2", () => {
  it("returns true when active player is unconscious at 6:00 with the right buckets", () => {
    const snap = buildSnapshot({
      currentTimeline: 6,
      activeConsciousness: "unconscious",
      buckets: {
        5: [ghost({ id: 1, consciousness: "unconscious" })],
        6: [ghost({ id: 2 })],
      },
    });
    expect(isAct2Loop2(snap)).toBe(true);
  });

  it("returns false when no unconscious ghost in the 5:00 bucket", () => {
    const snap = buildSnapshot({
      currentTimeline: 6,
      activeConsciousness: "unconscious",
      buckets: {
        5: [ghost({ id: 1, consciousness: "conscious" })],
        6: [ghost({ id: 2 })],
      },
    });
    expect(isAct2Loop2(snap)).toBe(false);
  });

  it("returns false when active player is conscious", () => {
    const snap = buildSnapshot({
      currentTimeline: 6,
      activeConsciousness: "conscious",
      buckets: {
        5: [ghost({ id: 1, consciousness: "unconscious" })],
        6: [ghost({ id: 2 })],
      },
    });
    expect(isAct2Loop2(snap)).toBe(false);
  });
});

describe("isAct3Setup", () => {
  it("returns true at 5:00 with an unconscious ghost in 6:00", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: { 6: [ghost({ id: 2, consciousness: "unconscious" })] },
    });
    expect(isAct3Setup(snap)).toBe(true);
  });

  it("returns false when 6:00 has only conscious ghosts", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: { 6: [ghost({ id: 2, consciousness: "conscious" })] },
    });
    expect(isAct3Setup(snap)).toBe(false);
  });
});

describe("isAct3Chase", () => {
  it("returns true with two distinct instances entering West within window at 5:00", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      recentWestEntries: [
        { instanceId: 1, tick: 100 },
        { instanceId: 2, tick: 101 },
      ],
    });
    expect(isAct3Chase(snap)).toBe(true);
  });

  it("returns true on a tick delta exactly equal to CHASE_WINDOW_TICKS", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      recentWestEntries: [
        { instanceId: 1, tick: 100 },
        { instanceId: 2, tick: 100 + CHASE_WINDOW_TICKS },
      ],
    });
    expect(isAct3Chase(snap)).toBe(true);
  });

  it("returns false when the same instance enters twice", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      recentWestEntries: [
        { instanceId: 1, tick: 100 },
        { instanceId: 1, tick: 101 },
      ],
    });
    expect(isAct3Chase(snap)).toBe(false);
  });

  it("returns false when the tick gap exceeds the window", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      recentWestEntries: [
        { instanceId: 1, tick: 100 },
        { instanceId: 2, tick: 100 + CHASE_WINDOW_TICKS + 1 },
      ],
    });
    expect(isAct3Chase(snap)).toBe(false);
  });
});

describe("isAct3TeamUp", () => {
  it("returns true at 5:00 with an unconscious ghost whose origin is 5", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        5: [
          ghost({
            id: 7,
            consciousness: "unconscious",
            originNormalized: 5 / 24,
          }),
        ],
      },
    });
    expect(isAct3TeamUp(snap)).toBe(true);
  });

  it("returns false when the unconscious ghost's origin is not 5", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        5: [
          ghost({
            id: 7,
            consciousness: "unconscious",
            originNormalized: 6 / 24,
          }),
        ],
      },
    });
    expect(isAct3TeamUp(snap)).toBe(false);
  });
});

describe("isAct3Mirror", () => {
  it("returns true at 12:00 idle carry with an unconscious body within the radius", () => {
    const snap = buildSnapshot({
      currentTimeline: 12,
      activeCarry: { kind: "idle" },
      buckets: {
        12: [
          ghost({
            id: 7,
            consciousness: "unconscious",
            position: { x: 0.5, z: 0.5 },
          }),
        ],
      },
    });
    expect(isAct3Mirror(snap)).toBe(true);
  });

  it("returns false when the body is outside the drop radius", () => {
    const snap = buildSnapshot({
      currentTimeline: 12,
      activeCarry: { kind: "idle" },
      buckets: {
        12: [
          ghost({
            id: 7,
            consciousness: "unconscious",
            position: { x: 3.0, z: 0 },
          }),
        ],
      },
    });
    expect(isAct3Mirror(snap)).toBe(false);
  });

  it("returns false when the active player is still carrying", () => {
    const snap = buildSnapshot({
      currentTimeline: 12,
      activeCarry: { kind: "carrying", carriedId: 7 },
      buckets: {
        12: [
          ghost({
            id: 7,
            consciousness: "unconscious",
            position: { x: 0, z: 0 },
          }),
        ],
      },
    });
    expect(isAct3Mirror(snap)).toBe(false);
  });
});

describe("isAct3FinalKnockout", () => {
  it("returns true at 12:00 with two unconscious ghosts in the bucket", () => {
    const snap = buildSnapshot({
      currentTimeline: 12,
      buckets: {
        12: [
          ghost({ id: 7, consciousness: "unconscious" }),
          ghost({ id: 8, consciousness: "unconscious" }),
        ],
      },
    });
    expect(isAct3FinalKnockout(snap)).toBe(true);
  });

  it("returns false with only one unconscious ghost", () => {
    const snap = buildSnapshot({
      currentTimeline: 12,
      buckets: {
        12: [
          ghost({ id: 7, consciousness: "unconscious" }),
          ghost({ id: 8, consciousness: "conscious" }),
        ],
      },
    });
    expect(isAct3FinalKnockout(snap)).toBe(false);
  });
});

describe("isEscaped", () => {
  it("returns true at 12:00 with the cinematic completed and the North crossing", () => {
    const snap = buildSnapshot({
      currentTimeline: 12,
      activePlayerCrossedNorthAt12: true,
      buckets: {
        12: [
          ghost({ id: 10, tickIndex: 50, recordingLength: 50 }),
          ghost({ id: 11, tickIndex: 50, recordingLength: 50 }),
          ghost({ id: 12, tickIndex: 1, recordingLength: 1 }),
        ],
      },
    });
    expect(isEscaped(snap)).toBe(true);
  });

  it("returns false when the cinematic actors have not completed", () => {
    const snap = buildSnapshot({
      currentTimeline: 12,
      activePlayerCrossedNorthAt12: true,
      buckets: {
        12: [
          ghost({ id: 10, tickIndex: 25, recordingLength: 50 }),
          ghost({ id: 11, tickIndex: 50, recordingLength: 50 }),
          ghost({ id: 12, tickIndex: 1, recordingLength: 1 }),
        ],
      },
    });
    expect(isEscaped(snap)).toBe(false);
  });

  it("returns false when the player has not crossed the North trigger", () => {
    const snap = buildSnapshot({
      currentTimeline: 12,
      activePlayerCrossedNorthAt12: false,
      buckets: {
        12: [ghost({ id: 10, tickIndex: 50, recordingLength: 50 })],
      },
    });
    expect(isEscaped(snap)).toBe(false);
  });

  it("returns false at any non-12 timeline", () => {
    const snap = buildSnapshot({
      currentTimeline: 5,
      activePlayerCrossedNorthAt12: true,
      buckets: {
        12: [ghost({ id: 10, tickIndex: 50, recordingLength: 50 })],
      },
    });
    expect(isEscaped(snap)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// evaluateActState: chain priority, watermark flooring, terminal escaped.
// -----------------------------------------------------------------------------

describe("evaluateActState", () => {
  it("returns not-started when no predicate succeeds and watermark is not-started", () => {
    const snap = buildSnapshot();
    expect(evaluateActState(snap)).toBe("not-started");
  });

  it("returns the higher beat when both act-1-spawn and act-3-setup succeed", () => {
    // act-1-spawn (3 ghosts in 12:00, active timeline 5) AND act-3-setup
    // (active timeline 5, unconscious ghost in 6:00) BOTH succeed; the
    // walk-from-highest order picks act-3-setup.
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
        6: [ghost({ id: 2, consciousness: "unconscious" })],
      },
    });
    expect(evaluateActState(snap)).toBe("act-3-setup");
  });

  it("never returns a state below the supplied watermark", () => {
    // Snapshot satisfies act-1-spawn only; watermark already at act-3-chase.
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      },
    });
    expect(evaluateActState(snap, "act-3-chase")).toBe("act-3-chase");
  });

  it("once escaped is the watermark, returns escaped regardless of snapshot", () => {
    // Snapshot satisfies nothing meaningful, but watermark is already
    // escaped: the terminal state holds.
    const snap = buildSnapshot();
    expect(evaluateActState(snap, "escaped")).toBe("escaped");
  });
});

// -----------------------------------------------------------------------------
// Observer wrapper: monotonicity, regression refusal, hardReset, ring buffer.
// -----------------------------------------------------------------------------

describe("createActStateObserver", () => {
  it("opens at not-started", () => {
    const obs = createActStateObserver();
    expect(obs.state).toBe("not-started");
  });

  it("advances the watermark when a higher predicate succeeds", () => {
    const obs = createActStateObserver();
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      },
    });
    expect(obs.update(snap)).toBe("act-1-spawn");
    expect(obs.state).toBe("act-1-spawn");
  });

  it("never regresses below the watermark across snapshots", () => {
    const obs = createActStateObserver();
    // First, push the observer up to act-3-chase via a snapshot that
    // satisfies that predicate (and lower beats too).
    const chaseSnap = buildSnapshot({
      currentTimeline: 5,
      recentWestEntries: [
        { instanceId: 1, tick: 100 },
        { instanceId: 2, tick: 101 },
      ],
    });
    expect(obs.update(chaseSnap)).toBe("act-3-chase");
    // Then, feed a snapshot that only satisfies act-1-spawn.
    const lowerSnap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      },
    });
    expect(obs.update(lowerSnap)).toBe("act-3-chase");
  });

  it("does not regress out of escaped under any snapshot", () => {
    const obs = createActStateObserver();
    // Walk into escaped.
    const escapedSnap = buildSnapshot({
      currentTimeline: 12,
      activePlayerCrossedNorthAt12: true,
      buckets: {
        12: [
          ghost({ id: 10, tickIndex: 50, recordingLength: 50 }),
          ghost({ id: 11, tickIndex: 50, recordingLength: 50 }),
          ghost({ id: 12, tickIndex: 1, recordingLength: 1 }),
        ],
      },
    });
    expect(obs.update(escapedSnap)).toBe("escaped");
    // A subsequent snapshot for an earlier beat (e.g. act-1-spawn) does
    // not pull the observer back.
    const earlierSnap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      },
    });
    expect(obs.update(earlierSnap)).toBe("escaped");
  });

  it("hardReset returns the observer to not-started and clears the ring buffer", () => {
    const obs = createActStateObserver();
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      },
    });
    obs.update(snap);
    obs.recordWestEntry({ instanceId: 1, tick: 50 });
    expect(obs.state).toBe("act-1-spawn");
    expect(obs.recentWestEntries().length).toBe(1);
    obs.hardReset();
    expect(obs.state).toBe("not-started");
    expect(obs.recentWestEntries().length).toBe(0);
  });

  it("recordWestEntry caps the ring buffer at RECENT_WEST_ENTRIES_CAPACITY", () => {
    const obs = createActStateObserver();
    for (let i = 0; i < RECENT_WEST_ENTRIES_CAPACITY + 3; i++) {
      obs.recordWestEntry({ instanceId: i + 1, tick: i });
    }
    const snapshot = obs.recentWestEntries();
    expect(snapshot.length).toBe(RECENT_WEST_ENTRIES_CAPACITY);
    // The oldest entries are discarded; the newest 4 are kept.
    expect(snapshot[0].tick).toBe(3);
    expect(snapshot[snapshot.length - 1].tick).toBe(
      RECENT_WEST_ENTRIES_CAPACITY + 2,
    );
  });

  it("recentWestEntries returns a defensive copy", () => {
    const obs = createActStateObserver();
    obs.recordWestEntry({ instanceId: 1, tick: 0 });
    const snap1 = obs.recentWestEntries();
    obs.recordWestEntry({ instanceId: 2, tick: 1 });
    const snap2 = obs.recentWestEntries();
    expect(snap1.length).toBe(1);
    expect(snap2.length).toBe(2);
  });

  it("walks an end-to-end valid sequence monotonically", () => {
    const obs = createActStateObserver();
    // act-1-spawn
    obs.update(
      buildSnapshot({
        currentTimeline: 5,
        buckets: {
          12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
        },
      }),
    );
    expect(obs.state).toBe("act-1-spawn");
    // act-2-loop-1
    obs.update(
      buildSnapshot({
        currentTimeline: 5,
        buckets: {
          5: [ghost({ id: 1, tickIndex: 100, recordingLength: 100 })],
          6: [ghost({ id: 2 })],
        },
      }),
    );
    expect(obs.state).toBe("act-2-loop-1");
    // act-2-loop-2
    obs.update(
      buildSnapshot({
        currentTimeline: 6,
        activeConsciousness: "unconscious",
        buckets: {
          5: [ghost({ id: 1, consciousness: "unconscious" })],
          6: [ghost({ id: 2 })],
        },
      }),
    );
    expect(obs.state).toBe("act-2-loop-2");
    // escaped at the end
    obs.update(
      buildSnapshot({
        currentTimeline: 12,
        activePlayerCrossedNorthAt12: true,
        buckets: {
          12: [
            ghost({ id: 10, tickIndex: 50, recordingLength: 50 }),
            ghost({ id: 11, tickIndex: 50, recordingLength: 50 }),
            ghost({ id: 12, tickIndex: 1, recordingLength: 1 }),
          ],
        },
      }),
    );
    expect(obs.state).toBe("escaped");
  });
});
