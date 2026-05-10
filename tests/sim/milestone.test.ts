import { describe, expect, it } from "vitest";
import {
  DOOR_TRAVERSAL_WEIGHT,
  EMPTY_MILESTONE_RECORDING,
  MilestoneRecorder,
  WALL_BUMP_WEIGHT,
  type Milestone,
} from "../../src/sim/milestone.ts";

const wallBump = (overrides: Partial<Extract<Milestone, { kind: "wall_bump" }>> = {}): Milestone => ({
  kind: "wall_bump",
  tick: 10,
  position: { x: 0, z: -4.5 },
  weight: WALL_BUMP_WEIGHT,
  wall: "north",
  ...overrides,
});

const doorTraversal = (
  overrides: Partial<Extract<Milestone, { kind: "door_traversal" }>> = {},
): Milestone => ({
  kind: "door_traversal",
  tick: 100,
  position: { x: 0, z: 4.4 },
  weight: DOOR_TRAVERSAL_WEIGHT,
  door: "south",
  ...overrides,
});

describe("MilestoneRecorder", () => {
  it("starts empty", () => {
    const r = new MilestoneRecorder();
    expect(r.length).toBe(0);
    const snap = r.snapshot();
    expect(snap.length).toBe(0);
    expect(snap.milestones).toHaveLength(0);
  });

  it("records milestones in insertion order", () => {
    const r = new MilestoneRecorder();
    r.record(wallBump({ tick: 1, wall: "north" }));
    r.record(wallBump({ tick: 5, wall: "east" }));
    r.record(doorTraversal({ tick: 10 }));
    expect(r.length).toBe(3);
    const snap = r.snapshot();
    expect(snap.length).toBe(3);
    expect(snap.milestones[0].kind).toBe("wall_bump");
    expect(snap.milestones[1].kind).toBe("wall_bump");
    expect(snap.milestones[2].kind).toBe("door_traversal");
    expect(snap.milestones[0].tick).toBe(1);
    expect(snap.milestones[2].tick).toBe(10);
  });

  it("snapshot is a defensive copy: subsequent record does not mutate it", () => {
    const r = new MilestoneRecorder();
    r.record(wallBump({ tick: 1 }));
    const snap = r.snapshot();
    expect(snap.length).toBe(1);
    r.record(wallBump({ tick: 2 }));
    expect(snap.length).toBe(1);
    expect(r.length).toBe(2);
  });

  it("snapshot freezes the milestone array and individual milestones", () => {
    const r = new MilestoneRecorder();
    r.record(wallBump({ tick: 1 }));
    const snap = r.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.milestones)).toBe(true);
    expect(Object.isFrozen(snap.milestones[0])).toBe(true);
  });

  it("records preserve discriminated-union metadata fields", () => {
    const r = new MilestoneRecorder();
    r.record(wallBump({ wall: "west" }));
    r.record(doorTraversal({ door: "east" }));
    const snap = r.snapshot();
    const m0 = snap.milestones[0];
    if (m0.kind !== "wall_bump") throw new Error("expected wall_bump");
    expect(m0.wall).toBe("west");
    const m1 = snap.milestones[1];
    if (m1.kind !== "door_traversal") throw new Error("expected door_traversal");
    expect(m1.door).toBe("east");
  });

  it("weights are stable per kind", () => {
    expect(WALL_BUMP_WEIGHT).toBe(1);
    expect(DOOR_TRAVERSAL_WEIGHT).toBe(5);
    const r = new MilestoneRecorder();
    r.record(wallBump());
    r.record(doorTraversal());
    const snap = r.snapshot();
    expect(snap.milestones[0].weight).toBe(WALL_BUMP_WEIGHT);
    expect(snap.milestones[1].weight).toBe(DOOR_TRAVERSAL_WEIGHT);
  });
});

describe("EMPTY_MILESTONE_RECORDING", () => {
  it("is a frozen empty recording shared across callers", () => {
    expect(EMPTY_MILESTONE_RECORDING.length).toBe(0);
    expect(EMPTY_MILESTONE_RECORDING.milestones).toHaveLength(0);
    expect(Object.isFrozen(EMPTY_MILESTONE_RECORDING)).toBe(true);
    expect(Object.isFrozen(EMPTY_MILESTONE_RECORDING.milestones)).toBe(true);
  });
});
