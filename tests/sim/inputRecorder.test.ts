import { describe, expect, it } from "vitest";
import {
  InputRecorder,
  replayAtTick,
} from "../../src/sim/inputRecorder.ts";
import { PLAYER_SPEED_MPS, type KeyState } from "../../src/input/keyboard.ts";

const NEUTRAL: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
};

const state = (overrides: Partial<KeyState>): KeyState => ({
  ...NEUTRAL,
  ...overrides,
});

describe("InputRecorder.record", () => {
  it("starts empty", () => {
    const r = new InputRecorder();
    expect(r.length).toBe(0);
  });

  it("assigns monotonic tick indices starting at 0", () => {
    const r = new InputRecorder();
    r.record(NEUTRAL, 0);
    r.record(state({ forward: true }), 0.1);
    r.record(state({ right: true }), 0.2);

    const snap = r.snapshot();
    expect(snap.length).toBe(3);
    expect(snap.frames.map((f) => f.tick)).toEqual([0, 1, 2]);
  });

  it("captures the keyboard state and time-of-day for each frame", () => {
    const r = new InputRecorder();
    r.record(state({ forward: true }), 0.25);
    r.record(state({ left: true, forward: true }), 0.5);

    const snap = r.snapshot();
    expect(snap.frames[0].keys).toEqual(state({ forward: true }));
    expect(snap.frames[0].timeOfDay).toBe(0.25);
    expect(snap.frames[1].keys).toEqual(state({ left: true, forward: true }));
    expect(snap.frames[1].timeOfDay).toBe(0.5);
  });

  it("defensively copies KeyState so later mutation does not rewrite history", () => {
    const r = new InputRecorder();
    const live: KeyState = { ...NEUTRAL, forward: true };
    r.record(live, 0);
    // Simulate the live keyboard releasing forward and pressing back the next frame.
    live.forward = false;
    live.back = true;

    const snap = r.snapshot();
    expect(snap.frames[0].keys).toEqual({ ...NEUTRAL, forward: true });
  });
});

describe("InputRecorder.snapshot", () => {
  it("returns a defensive copy that does not grow when more frames are recorded", () => {
    const r = new InputRecorder();
    r.record(NEUTRAL, 0);
    r.record(state({ forward: true }), 0);
    const snap = r.snapshot();
    expect(snap.length).toBe(2);

    r.record(state({ back: true }), 0);
    expect(snap.length).toBe(2);
    expect(snap.frames.length).toBe(2);
  });

  it("freezes the recording so callers cannot mutate it", () => {
    const r = new InputRecorder();
    r.record(state({ forward: true }), 0);
    const snap = r.snapshot();

    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.frames)).toBe(true);
    expect(Object.isFrozen(snap.frames[0])).toBe(true);
    expect(Object.isFrozen(snap.frames[0].keys)).toBe(true);
  });

  it("snapshots empty recordings as length zero", () => {
    const snap = new InputRecorder().snapshot();
    expect(snap.length).toBe(0);
    expect(snap.frames).toEqual([]);
  });
});

describe("replayAtTick", () => {
  it("returns the recorded planar velocity for a tick mid-recording", () => {
    const r = new InputRecorder();
    r.record(NEUTRAL, 0);
    r.record(state({ right: true }), 0);
    r.record(state({ forward: true }), 0);
    const snap = r.snapshot();

    expect(replayAtTick(snap, 0)).toEqual({ x: 0, z: 0 });
    expect(replayAtTick(snap, 1)).toEqual({ x: PLAYER_SPEED_MPS, z: 0 });
    expect(replayAtTick(snap, 2)).toEqual({ x: 0, z: -PLAYER_SPEED_MPS });
  });

  it("returns zero vector for ticks past the end of the recording", () => {
    const r = new InputRecorder();
    r.record(state({ right: true }), 0);
    const snap = r.snapshot();

    expect(replayAtTick(snap, 1)).toEqual({ x: 0, z: 0 });
    expect(replayAtTick(snap, 1000)).toEqual({ x: 0, z: 0 });
  });

  it("returns zero vector for an empty recording at any tick", () => {
    const snap = new InputRecorder().snapshot();
    expect(replayAtTick(snap, 0)).toEqual({ x: 0, z: 0 });
    expect(replayAtTick(snap, 5)).toEqual({ x: 0, z: 0 });
  });

  it("returns zero vector for negative tick indices", () => {
    const r = new InputRecorder();
    r.record(state({ forward: true }), 0);
    const snap = r.snapshot();
    expect(replayAtTick(snap, -1)).toEqual({ x: 0, z: 0 });
  });

  it("returns the same shape regardless of branch", () => {
    const r = new InputRecorder();
    r.record(state({ forward: true }), 0);
    const snap = r.snapshot();

    const inRange = replayAtTick(snap, 0);
    const pastEnd = replayAtTick(snap, 5);
    expect(Object.keys(inRange).sort()).toEqual(["x", "z"]);
    expect(Object.keys(pastEnd).sort()).toEqual(["x", "z"]);
  });
});
