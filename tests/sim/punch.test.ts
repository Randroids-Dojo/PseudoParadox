import { describe, expect, it } from "vitest";
import {
  PUNCH_RANGE_M,
  resolvePunches,
  suppressUnconsciousPunches,
  type PunchActor,
} from "../../src/sim/punch.ts";

const conscious = (
  id: number,
  x: number,
  z: number,
  punching: boolean = false,
): PunchActor => ({
  id,
  position: { x, z },
  punching,
  consciousness: "conscious",
});

const unconscious = (
  id: number,
  x: number,
  z: number,
  punching: boolean = false,
): PunchActor => ({
  id,
  position: { x, z },
  punching,
  consciousness: "unconscious",
});

describe("PUNCH_RANGE_M default (Q-003)", () => {
  it("matches the dossier default of 1.2 m", () => {
    expect(PUNCH_RANGE_M).toBeCloseTo(1.2, 6);
  });
});

describe("suppressUnconsciousPunches (REQ-033 partial)", () => {
  it("flips an unconscious actor's punching flag to false", () => {
    const sanitized = suppressUnconsciousPunches([
      unconscious(1, 0, 0, true),
      conscious(2, 0, 0, true),
    ]);
    expect(sanitized[0].punching).toBe(false);
    expect(sanitized[1].punching).toBe(true);
  });

  it("does not mutate the input array", () => {
    const before: PunchActor[] = [unconscious(1, 0, 0, true)];
    const after = suppressUnconsciousPunches(before);
    expect(before[0].punching).toBe(true);
    expect(after[0].punching).toBe(false);
    expect(after).not.toBe(before);
  });

  it("leaves conscious actors untouched even when punching is false", () => {
    const sanitized = suppressUnconsciousPunches([
      conscious(1, 0, 0, false),
      conscious(2, 0, 0, true),
    ]);
    expect(sanitized[0].punching).toBe(false);
    expect(sanitized[1].punching).toBe(true);
  });
});

describe("resolvePunches: range and target selection (REQ-033 partial)", () => {
  it("returns a knockout pair when the puncher has exactly one target in range", () => {
    const r = resolvePunches([
      conscious(1, 0, 0, true),
      conscious(2, 1.0, 0, false),
    ]);
    expect(r).toEqual([{ attackerId: 1, targetId: 2 }]);
  });

  it("ignores out-of-range targets", () => {
    const r = resolvePunches([
      conscious(1, 0, 0, true),
      conscious(2, 5, 0, false),
    ]);
    expect(r).toEqual([]);
  });

  it("ignores already-unconscious targets (a punch against a knocked-out body is a no-op)", () => {
    const r = resolvePunches([
      conscious(1, 0, 0, true),
      unconscious(2, 1.0, 0, false),
    ]);
    expect(r).toEqual([]);
  });

  it("does not let an actor target itself", () => {
    const r = resolvePunches([conscious(1, 0, 0, true)]);
    expect(r).toEqual([]);
  });

  it("picks the SINGLE closest target when multiple are in range", () => {
    const r = resolvePunches([
      conscious(1, 0, 0, true),
      conscious(2, 1.0, 0, false),
      conscious(3, 0.5, 0, false),
    ]);
    expect(r).toEqual([{ attackerId: 1, targetId: 3 }]);
  });

  it("breaks distance ties by smallest InstanceId", () => {
    const r = resolvePunches([
      conscious(1, 0, 0, true),
      conscious(7, 1.0, 0, false),
      conscious(3, -1.0, 0, false),
    ]);
    expect(r).toEqual([{ attackerId: 1, targetId: 3 }]);
  });
});

describe("resolvePunches: simultaneous and unconscious-attacker cases (REQ-033 partial)", () => {
  it("simultaneous mutual punches: BOTH actors land their hit", () => {
    const r = resolvePunches([
      conscious(1, 0, 0, true),
      conscious(2, 1.0, 0, true),
    ]);
    // The resolver reads each candidate's pre-tick consciousness from the
    // input snapshot, so both attackers see the other as `'conscious'` and
    // both pairs are produced. The host applies them atomically.
    expect(r).toContainEqual({ attackerId: 1, targetId: 2 });
    expect(r).toContainEqual({ attackerId: 2, targetId: 1 });
    expect(r).toHaveLength(2);
  });

  it("an unconscious attacker's punch is NOT resolved (defensive belt against missed suppression)", () => {
    const r = resolvePunches([
      unconscious(1, 0, 0, true),
      conscious(2, 1.0, 0, false),
    ]);
    expect(r).toEqual([]);
  });

  it("an unconscious attacker that has been suppressed produces no resolution", () => {
    const sanitized = suppressUnconsciousPunches([
      unconscious(1, 0, 0, true),
      conscious(2, 1.0, 0, false),
    ]);
    expect(resolvePunches(sanitized)).toEqual([]);
  });

  it("multiple punchers each produce their own (attacker, target) pair", () => {
    const r = resolvePunches([
      conscious(1, 0, 0, true),
      conscious(2, 1.0, 0, true),
      conscious(3, 10, 10, false),
    ]);
    // 1 punches 2 and 2 punches 1; 3 is out of range of both.
    expect(r).toContainEqual({ attackerId: 1, targetId: 2 });
    expect(r).toContainEqual({ attackerId: 2, targetId: 1 });
    expect(r).toHaveLength(2);
  });
});

describe("resolvePunches: Act 3 team-up beat (REQ-033 partial)", () => {
  it("active player punches their OWN ghost (same instanceId in the same timeline) flips the ghost unconscious", () => {
    // The dot's "Active player punches own ghost in same timeline (Act 3
    // team-up beat)" edge case: the active player and a ghost can have
    // distinct ids in the active timeline by construction (the active
    // generation always exceeds every ghost's generation), but the dossier
    // permits the punch to land. This test pins the simpler invariant:
    // any conscious target in range gets knocked out regardless of its
    // identity relative to the puncher.
    const r = resolvePunches([
      conscious(3, 0, 0, true),
      conscious(1, 0.9, 0, false),
    ]);
    expect(r).toEqual([{ attackerId: 3, targetId: 1 }]);
  });
});
