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

  it("does not skip beats: a snapshot satisfying a late beat from not-started halts at the first failing prerequisite", () => {
    // The snapshot locally satisfies isAct1Spawn (3 ghosts in 12:00, active
    // timeline 5) AND isAct3Setup (unconscious ghost in 6:00), but does
    // NOT satisfy isAct2Loop1 (no ghosts in the 5:00 bucket) or
    // isAct2Loop2. The forward walk halts at act-1-spawn because
    // act-2-loop-1 fails.
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
        6: [ghost({ id: 2, consciousness: "unconscious" })],
      },
    });
    expect(evaluateActState(snap)).toBe("act-1-spawn");
  });

  it("does not jump to escaped from not-started even when isEscaped passes locally", () => {
    // Snapshot locally satisfies isEscaped (timeline 12, north crossing,
    // cinematic complete) but the walk from not-started halts at the
    // first failing prerequisite (isAct1Spawn fails because there are
    // only 0 ghosts in the 12:00 bucket from a not-started timeline of
    // 12, i.e. wrong timeline). Even if act-1-spawn passed, the walk
    // would still need each intermediate beat to pass. The result is
    // not-started.
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
    expect(evaluateActState(snap)).toBe("not-started");
  });

  it("advances multiple steps in one call when all intermediate predicates pass", () => {
    // Construct a snapshot that satisfies isAct1Spawn, isAct2Loop1, AND
    // isAct3Setup simultaneously: timeline 5, 3 ghosts in 12:00, a
    // completed ghost in the 5:00 bucket, an unconscious ghost in 6:00.
    // The forward walk advances from not-started through act-1-spawn,
    // act-2-loop-1, then halts at act-2-loop-2 (which requires timeline
    // 6 plus an unconscious active player); the highest reachable beat
    // is act-2-loop-1.
    const snap = buildSnapshot({
      currentTimeline: 5,
      buckets: {
        12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
        5: [ghost({ id: 1, tickIndex: 100, recordingLength: 100 })],
        6: [ghost({ id: 2, consciousness: "unconscious" })],
      },
    });
    expect(evaluateActState(snap)).toBe("act-2-loop-1");
  });

  it("never returns a state below the supplied watermark", () => {
    // Snapshot satisfies act-1-spawn only; watermark already at act-3-chase.
    // The walk skips already-reached states (states at or below watermark
    // are known-reached) and tests only forward; with no later predicates
    // succeeding the result floors to the watermark.
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

// -----------------------------------------------------------------------------
// Snapshot builders for each beat, including the prerequisites the observer
// walks through. Each builder returns a snapshot that satisfies the named
// beat AND every preceding beat in the chain. Use these to drive the
// observer through valid sequences.
// -----------------------------------------------------------------------------

function snapAct1Spawn(): ActStateSnapshot {
  return buildSnapshot({
    currentTimeline: 5,
    buckets: {
      12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
    },
  });
}

function snapAct2Loop1(): ActStateSnapshot {
  return buildSnapshot({
    currentTimeline: 5,
    buckets: {
      12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      5: [ghost({ id: 1, tickIndex: 100, recordingLength: 100 })],
      6: [ghost({ id: 2 })],
    },
  });
}

function snapAct2Loop2(): ActStateSnapshot {
  return buildSnapshot({
    currentTimeline: 6,
    activeConsciousness: "unconscious",
    buckets: {
      12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      // Note: at timeline 6 the act-2-loop-1 predicate cannot pass
      // (requires timeline 5), but the observer's watermark is already
      // at act-2-loop-1 from a prior tick, so the prerequisite is
      // already satisfied. The forward walk only needs act-2-loop-2 to
      // pass to advance from the watermark.
      5: [ghost({ id: 1, consciousness: "unconscious" })],
      6: [ghost({ id: 2 })],
    },
  });
}

function snapAct3Setup(): ActStateSnapshot {
  return buildSnapshot({
    currentTimeline: 5,
    buckets: {
      12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      5: [ghost({ id: 1, tickIndex: 100, recordingLength: 100 })],
      6: [ghost({ id: 2, consciousness: "unconscious" })],
    },
  });
}

function snapAct3Chase(): ActStateSnapshot {
  // act-3-chase requires the same active timeline as act-3-setup (timeline
  // 5) plus two distinct West entries. Reuses the act-3-setup baseline
  // and adds the West-entry buffer.
  return buildSnapshot({
    currentTimeline: 5,
    buckets: {
      12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      5: [ghost({ id: 1, tickIndex: 100, recordingLength: 100 })],
      6: [ghost({ id: 2, consciousness: "unconscious" })],
    },
    recentWestEntries: [
      { instanceId: 1, tick: 100 },
      { instanceId: 2, tick: 101 },
    ],
  });
}

function snapAct3TeamUp(): ActStateSnapshot {
  return buildSnapshot({
    currentTimeline: 5,
    buckets: {
      12: [ghost({ id: 10 }), ghost({ id: 11 }), ghost({ id: 12 })],
      5: [
        ghost({ id: 1, tickIndex: 100, recordingLength: 100 }),
        ghost({
          id: 7,
          consciousness: "unconscious",
          originNormalized: 5 / 24,
        }),
      ],
      6: [ghost({ id: 2, consciousness: "unconscious" })],
    },
    recentWestEntries: [
      { instanceId: 1, tick: 100 },
      { instanceId: 2, tick: 101 },
    ],
  });
}

function snapAct3Mirror(): ActStateSnapshot {
  // act-3-mirror requires timeline 12, idle carry, and an unconscious
  // ghost within radius. Once the observer's watermark is at
  // act-3-team-up, prior states' predicates need not pass on the new
  // snapshot; the forward walk only checks act-3-mirror onward.
  return buildSnapshot({
    currentTimeline: 12,
    activeCarry: { kind: "idle" },
    buckets: {
      12: [
        ghost({ id: 10 }),
        ghost({ id: 11 }),
        ghost({
          id: 7,
          consciousness: "unconscious",
          position: { x: 0.5, z: 0.0 },
        }),
      ],
    },
  });
}

function snapAct3FinalKnockout(): ActStateSnapshot {
  return buildSnapshot({
    currentTimeline: 12,
    activeCarry: { kind: "idle" },
    buckets: {
      12: [
        ghost({ id: 10 }),
        ghost({
          id: 7,
          consciousness: "unconscious",
          position: { x: 0.5, z: 0.0 },
        }),
        ghost({ id: 8, consciousness: "unconscious" }),
      ],
    },
  });
}

function snapEscaped(): ActStateSnapshot {
  return buildSnapshot({
    currentTimeline: 12,
    activeCarry: { kind: "idle" },
    activePlayerCrossedNorthAt12: true,
    buckets: {
      12: [
        ghost({ id: 10, tickIndex: 50, recordingLength: 50 }),
        ghost({
          id: 7,
          consciousness: "unconscious",
          position: { x: 0.5, z: 0.0 },
          tickIndex: 50,
          recordingLength: 50,
        }),
        ghost({
          id: 8,
          consciousness: "unconscious",
          tickIndex: 1,
          recordingLength: 1,
        }),
      ],
    },
  });
}

describe("createActStateObserver", () => {
  it("opens at not-started", () => {
    const obs = createActStateObserver();
    expect(obs.state).toBe("not-started");
  });

  it("advances the watermark when a higher predicate succeeds", () => {
    const obs = createActStateObserver();
    expect(obs.update(snapAct1Spawn())).toBe("act-1-spawn");
    expect(obs.state).toBe("act-1-spawn");
  });

  it("does not skip beats: a fresh observer fed an act-3-chase-shaped snapshot stays at not-started", () => {
    // The chase snapshot has West entries but no ghosts in the 12:00
    // bucket, so isAct1Spawn fails and the walk halts at not-started.
    const obs = createActStateObserver();
    const chaseShaped = buildSnapshot({
      currentTimeline: 5,
      recentWestEntries: [
        { instanceId: 1, tick: 100 },
        { instanceId: 2, tick: 101 },
      ],
    });
    expect(obs.update(chaseShaped)).toBe("not-started");
  });

  it("never regresses below the watermark across snapshots", () => {
    const obs = createActStateObserver();
    // Drive the observer up through the chain via valid sequence.
    obs.update(snapAct1Spawn());
    obs.update(snapAct2Loop1());
    obs.update(snapAct2Loop2());
    obs.update(snapAct3Setup());
    obs.update(snapAct3Chase());
    expect(obs.state).toBe("act-3-chase");
    // Then feed a snapshot that only satisfies act-1-spawn locally.
    expect(obs.update(snapAct1Spawn())).toBe("act-3-chase");
    expect(obs.state).toBe("act-3-chase");
  });

  it("does not regress out of escaped under any snapshot", () => {
    const obs = createActStateObserver();
    // Walk through the chain to escaped via a valid sequence.
    obs.update(snapAct1Spawn());
    obs.update(snapAct2Loop1());
    obs.update(snapAct2Loop2());
    obs.update(snapAct3Setup());
    obs.update(snapAct3Chase());
    obs.update(snapAct3TeamUp());
    obs.update(snapAct3Mirror());
    obs.update(snapAct3FinalKnockout());
    expect(obs.update(snapEscaped())).toBe("escaped");
    // A subsequent snapshot for an earlier beat does not pull the
    // observer back.
    expect(obs.update(snapAct1Spawn())).toBe("escaped");
  });

  it("hardReset returns the observer to not-started and clears the ring buffer", () => {
    const obs = createActStateObserver();
    obs.update(snapAct1Spawn());
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

  it("walks an end-to-end valid sequence monotonically through every beat", () => {
    const obs = createActStateObserver();
    expect(obs.update(snapAct1Spawn())).toBe("act-1-spawn");
    expect(obs.update(snapAct2Loop1())).toBe("act-2-loop-1");
    expect(obs.update(snapAct2Loop2())).toBe("act-2-loop-2");
    expect(obs.update(snapAct3Setup())).toBe("act-3-setup");
    expect(obs.update(snapAct3Chase())).toBe("act-3-chase");
    expect(obs.update(snapAct3TeamUp())).toBe("act-3-team-up");
    expect(obs.update(snapAct3Mirror())).toBe("act-3-mirror");
    expect(obs.update(snapAct3FinalKnockout())).toBe("act-3-final-knockout");
    expect(obs.update(snapEscaped())).toBe("escaped");
  });

  it("rejects escaped before act-3-final-knockout has been reached", () => {
    // Drive the observer up to act-3-mirror via a valid sequence and
    // then feed an escape-shaped snapshot. The forward walk halts at
    // act-3-final-knockout (the snapshot does not satisfy that
    // predicate) so the observer must NOT report escaped.
    const obs = createActStateObserver();
    obs.update(snapAct1Spawn());
    obs.update(snapAct2Loop1());
    obs.update(snapAct2Loop2());
    obs.update(snapAct3Setup());
    obs.update(snapAct3Chase());
    obs.update(snapAct3TeamUp());
    obs.update(snapAct3Mirror());
    expect(obs.state).toBe("act-3-mirror");
    // An escape-shaped snapshot at this point has the cinematic
    // completed plus the north-trigger crossing, but the 12:00 bucket
    // for the snapshot crafted below has only one unconscious ghost
    // (the mirror body), so isAct3FinalKnockout fails. The forward
    // walk halts there; the watermark stays at act-3-mirror.
    const escapeShapedButNoFinalKnockout = buildSnapshot({
      currentTimeline: 12,
      activeCarry: { kind: "idle" },
      activePlayerCrossedNorthAt12: true,
      buckets: {
        12: [
          ghost({ id: 10, tickIndex: 50, recordingLength: 50 }),
          ghost({
            id: 7,
            consciousness: "unconscious",
            position: { x: 0.5, z: 0.0 },
            tickIndex: 50,
            recordingLength: 50,
          }),
        ],
      },
    });
    expect(obs.update(escapeShapedButNoFinalKnockout)).toBe("act-3-mirror");
    // Once isAct3FinalKnockout passes (two unconscious ghosts at 12)
    // and then isEscaped passes on the next snapshot, the observer
    // advances to escaped.
    expect(obs.update(snapAct3FinalKnockout())).toBe("act-3-final-knockout");
    expect(obs.update(snapEscaped())).toBe("escaped");
  });
});
