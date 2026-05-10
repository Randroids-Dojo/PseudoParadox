import { describe, expect, it } from "vitest";
import {
  ARRIVAL_RADIUS,
  DRIFT_THRESHOLD,
  WALL_BUMP_BUDGET_TICKS,
  advanceReplay,
  createReplayState,
} from "../../src/sim/replayController.ts";
import {
  DOOR_TRAVERSAL_WEIGHT,
  WALL_BUMP_WEIGHT,
  type Milestone,
} from "../../src/sim/milestone.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import { PLAYER_SPEED_MPS } from "../../src/input/keyboard.ts";
import type { KeyState } from "../../src/input/keyboard.ts";

const NEUTRAL: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
};

const DT = 1 / 60;

const buildRecording = (frames: KeyState[]) => {
  const r = new InputRecorder();
  for (const f of frames) r.record(f, 0);
  return r.snapshot();
};

const wallBump = (
  overrides: Partial<Extract<Milestone, { kind: "wall_bump" }>> = {},
): Milestone => ({
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

describe("createReplayState", () => {
  it("opens at tick 0, milestone idx 0, mode replaying-input", () => {
    const s = createReplayState({ x: 1, z: 2 });
    expect(s.tickIndex).toBe(0);
    expect(s.milestoneIdx).toBe(0);
    expect(s.expectedPos).toEqual({ x: 1, z: 2 });
    expect(s.lastMode).toBe("replaying-input");
  });
});

describe("advanceReplay: input-mode default path", () => {
  it("returns the recorded velocity and stays in replaying-input when no drift and no milestone arrival", () => {
    const recording = buildRecording([{ ...NEUTRAL, forward: true }]);
    const state = createReplayState({ x: 0, z: 0 });
    // Body at the expected start position: drift = 0.
    const r = advanceReplay(state, recording, [], { x: 0, z: 0 }, DT);
    expect(r.state.lastMode).toBe("replaying-input");
    // forward: true maps to negative-Z velocity.
    expect(r.velocity.x).toBe(0);
    expect(r.velocity.z).toBe(-PLAYER_SPEED_MPS);
    // tickIndex advances.
    expect(r.state.tickIndex).toBe(1);
    expect(r.state.milestoneIdx).toBe(0);
  });

  it("with no milestones, stays in replaying-input even when drift is huge (no path target)", () => {
    const recording = buildRecording([NEUTRAL]);
    const state = createReplayState({ x: 0, z: 0 });
    const farFromExpected = { x: 100, z: 100 };
    const r = advanceReplay(state, recording, [], farFromExpected, DT);
    expect(r.state.lastMode).toBe("replaying-input");
    expect(r.velocity).toEqual({ x: 0, z: 0 });
  });

  it("updates running expectedPos by recorded velocity * dt each tick", () => {
    // Record one frame of forward (velocity -PLAYER_SPEED on z).
    const recording = buildRecording([{ ...NEUTRAL, forward: true }]);
    const state = createReplayState({ x: 0, z: 0 });
    const r = advanceReplay(state, recording, [], { x: 0, z: 0 }, DT);
    // expectedPos = startPos + velocity * dt = (0, 0) + (0, -SPEED * dt)
    expect(r.state.expectedPos.x).toBe(0);
    expect(r.state.expectedPos.z).toBeCloseTo(-PLAYER_SPEED_MPS * DT, 6);
  });
});

describe("advanceReplay: drift triggers path-following", () => {
  it("switches to path-following when drift exceeds DRIFT_THRESHOLD and a pending milestone exists", () => {
    const recording = buildRecording([NEUTRAL]);
    const state = createReplayState({ x: 0, z: 0 });
    const ms = [wallBump({ tick: 0, position: { x: 5, z: 0 } })];
    // Body 1m off the expected path along x.
    const r = advanceReplay(state, recording, ms, { x: 1, z: 0 }, DT);
    expect(r.state.lastMode).toBe("path-following");
    // Velocity points from body (1,0) toward milestone (5,0) at PLAYER_SPEED.
    expect(r.velocity.x).toBeCloseTo(PLAYER_SPEED_MPS, 6);
    expect(r.velocity.z).toBe(0);
  });

  it("stays in input mode if drift is within threshold", () => {
    const recording = buildRecording([NEUTRAL]);
    const state = createReplayState({ x: 0, z: 0 });
    const ms = [wallBump({ tick: 0, position: { x: 5, z: 0 } })];
    // Body within threshold of (0, 0).
    const r = advanceReplay(state, recording, ms, { x: 0.4, z: 0 }, DT);
    expect(r.state.lastMode).toBe("replaying-input");
  });
});

describe("advanceReplay: milestone arrival", () => {
  it("advances milestoneIdx and re-anchors expectedPos when within ARRIVAL_RADIUS", () => {
    const recording = buildRecording([NEUTRAL, NEUTRAL]);
    const state = createReplayState({ x: 0, z: 0 });
    const ms = [
      wallBump({ tick: 5, position: { x: 1, z: 1 } }),
      doorTraversal({ tick: 50 }),
    ];
    // Body within arrival radius of milestone[0].
    const r = advanceReplay(
      state,
      recording,
      ms,
      { x: 1 + ARRIVAL_RADIUS / 2, z: 1 },
      DT,
    );
    expect(r.state.milestoneIdx).toBe(1);
    expect(r.state.lastMode).toBe("replaying-input");
    // expectedPos snapped to body's current position.
    expect(r.state.expectedPos.x).toBeCloseTo(1 + ARRIVAL_RADIUS / 2, 6);
    expect(r.state.expectedPos.z).toBe(1);
  });
});

describe("advanceReplay: skip rule (Q-025 default A)", () => {
  it("skips a wall_bump milestone whose tick is more than WALL_BUMP_BUDGET_TICKS behind", () => {
    const recording = buildRecording(Array.from({ length: 200 }, () => NEUTRAL));
    const state = {
      ...createReplayState({ x: 0, z: 0 }),
      tickIndex: WALL_BUMP_BUDGET_TICKS + 5,
    };
    const ms = [
      wallBump({ tick: 0, position: { x: 5, z: 0 } }),
      doorTraversal({ tick: 100, position: { x: 0, z: 4.4 } }),
    ];
    const r = advanceReplay(state, recording, ms, { x: 0, z: 0 }, DT);
    // Wall bump at tick 0 is currentTick - 0 = 65 ticks behind, > budget 60. Skipped.
    expect(r.state.milestoneIdx).toBe(1);
  });

  it("does NOT skip a door_traversal even if very stale", () => {
    const recording = buildRecording(Array.from({ length: 1000 }, () => NEUTRAL));
    const state = {
      ...createReplayState({ x: 0, z: 0 }),
      tickIndex: 1000,
    };
    const ms = [doorTraversal({ tick: 0, position: { x: 0, z: 4.4 } })];
    const r = advanceReplay(state, recording, ms, { x: 0, z: 0 }, DT);
    // Door is unskippable; milestoneIdx still points at it.
    expect(r.state.milestoneIdx).toBe(0);
  });

  it("skips multiple stale wall_bumps to reach a still-valid milestone", () => {
    const recording = buildRecording(Array.from({ length: 200 }, () => NEUTRAL));
    const state = {
      ...createReplayState({ x: 0, z: 0 }),
      tickIndex: 100,
    };
    // Three stale wall bumps then a valid one.
    const ms = [
      wallBump({ tick: 0 }),
      wallBump({ tick: 10 }),
      wallBump({ tick: 20 }),
      wallBump({ tick: 90 }), // currentTick - 90 = 10, < budget 60: not stale.
    ];
    const r = advanceReplay(state, recording, ms, { x: 0, z: 0 }, DT);
    expect(r.state.milestoneIdx).toBe(3);
  });
});

describe("advanceReplay: path-follow stickiness", () => {
  it("stays in path-following on subsequent ticks even if drift drops back inside threshold", () => {
    const recording = buildRecording([NEUTRAL, NEUTRAL]);
    const initial = createReplayState({ x: 0, z: 0 });
    const ms = [wallBump({ tick: 0, position: { x: 5, z: 0 } })];
    // First tick: drift > threshold, switch to path-follow.
    const r1 = advanceReplay(initial, recording, ms, { x: 1, z: 0 }, DT);
    expect(r1.state.lastMode).toBe("path-following");
    // Second tick: ghost has corrected back near expectedPos so drift drops.
    // Without stickiness the controller would fall back to input replay
    // before reaching the milestone.
    const r2 = advanceReplay(
      r1.state,
      recording,
      ms,
      { x: r1.state.expectedPos.x, z: r1.state.expectedPos.z },
      DT,
    );
    expect(r2.state.lastMode).toBe("path-following");
  });

  it("returns to replaying-input only after the milestone is reached", () => {
    const recording = buildRecording([NEUTRAL, NEUTRAL, NEUTRAL]);
    const initial = createReplayState({ x: 0, z: 0 });
    const ms = [wallBump({ tick: 0, position: { x: 5, z: 0 } })];
    // Drift triggers path-follow.
    const r1 = advanceReplay(initial, recording, ms, { x: 1, z: 0 }, DT);
    expect(r1.state.lastMode).toBe("path-following");
    // Body within ARRIVAL_RADIUS of the milestone: arrival fires, mode
    // returns to input replay.
    const r2 = advanceReplay(
      r1.state,
      recording,
      ms,
      { x: 5 + ARRIVAL_RADIUS / 2, z: 0 },
      DT,
    );
    expect(r2.state.lastMode).toBe("replaying-input");
    expect(r2.state.milestoneIdx).toBe(1);
  });
});

describe("advanceReplay: drift threshold semantics", () => {
  it("drift exactly at the threshold does not switch (strict greater-than)", () => {
    const recording = buildRecording([NEUTRAL]);
    const state = createReplayState({ x: 0, z: 0 });
    const ms = [wallBump({ tick: 0, position: { x: 5, z: 0 } })];
    // Drift exactly DRIFT_THRESHOLD: body offset by exactly 0.5.
    const r = advanceReplay(state, recording, ms, { x: DRIFT_THRESHOLD, z: 0 }, DT);
    expect(r.state.lastMode).toBe("replaying-input");
  });

  it("drift just over the threshold switches", () => {
    const recording = buildRecording([NEUTRAL]);
    const state = createReplayState({ x: 0, z: 0 });
    const ms = [wallBump({ tick: 0, position: { x: 5, z: 0 } })];
    const r = advanceReplay(
      state,
      recording,
      ms,
      { x: DRIFT_THRESHOLD + 0.01, z: 0 },
      DT,
    );
    expect(r.state.lastMode).toBe("path-following");
  });
});
