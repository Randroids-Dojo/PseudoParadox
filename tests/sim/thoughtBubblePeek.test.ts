import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOOKAHEAD_TICKS,
  nextQualitativelyDifferentAction,
} from "../../src/sim/thoughtBubblePeek.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import type { KeyState } from "../../src/input/keyboard.ts";
import type { PortalTrigger } from "../../src/sim/portalTrigger.ts";
import type { Portal } from "../../src/sim/portal.ts";

const NEUTRAL: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
};

const state = (overrides: Partial<KeyState>): KeyState => ({
  ...NEUTRAL,
  ...overrides,
});

const buildRecording = (frames: KeyState[]) => {
  const r = new InputRecorder();
  for (const f of frames) r.record(f, 0);
  return r.snapshot();
};

/**
 * Build a fake portal trigger directly so the test does not depend on the
 * real `createPortalTrigger` factory's wall-direction switch (the function
 * needs a real Door mesh; for purely the trigger volume we hand-roll the
 * shape).
 */
const fakeTrigger = (
  centerX: number,
  centerZ: number,
  halfX: number,
  halfZ: number,
): PortalTrigger => ({
  portal: {} as Portal,
  centerX,
  centerZ,
  halfX,
  halfZ,
});

describe("nextQualitativelyDifferentAction: sleep priority (REQ-032)", () => {
  it("returns 'sleep' for an unconscious ghost regardless of recording content", () => {
    const recording = buildRecording([
      state({ throw: true }),
      state({ pickup: true }),
      state({ punch: true }),
    ]);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: true,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBe("sleep");
  });

  it("returns 'sleep' for an unconscious ghost even with an empty recording", () => {
    const recording = buildRecording([]);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: true,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBe("sleep");
  });
});

describe("nextQualitativelyDifferentAction: punch detection", () => {
  it("returns 'fist' when a punch flag is in the lookahead window", () => {
    // Frames 0 and 1 are neutral; frame 2 has punch=true. With currentTick=0
    // the scan window is ticks 1..30, so the punch at tick 2 is found.
    const frames: KeyState[] = [
      NEUTRAL,
      NEUTRAL,
      state({ punch: true }),
      NEUTRAL,
    ];
    const recording = buildRecording(frames);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBe("fist");
  });

  it("returns null when a punch is past the lookahead window", () => {
    // Place punch far past the window. With lookaheadTicks=5 and
    // currentTick=0 the scan window is ticks 1..5; punch at tick 100 is
    // past the window.
    const frames: KeyState[] = Array.from({ length: 101 }, (_, i) =>
      i === 100 ? state({ punch: true }) : NEUTRAL,
    );
    const recording = buildRecording(frames);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      lookaheadTicks: 5,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBeNull();
  });
});

describe("nextQualitativelyDifferentAction: door detection", () => {
  it("returns 'door' when forward integration crosses a portal trigger inside the window", () => {
    // Walk forward (-Z) at PLAYER_SPEED_MPS = 4 m/s for 30 ticks at
    // 1/60s per tick: covers about 4 * 30 / 60 = 2.0 m of -Z. Place a
    // trigger 1.0 m ahead of the start position.
    const frames: KeyState[] = Array.from(
      { length: 60 },
      () => state({ forward: true }),
    );
    const recording = buildRecording(frames);
    const trigger = fakeTrigger(0, -1.0, 0.6, 0.3);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [trigger],
    });
    expect(result).toBe("door");
  });

  it("returns null when only walking with no trigger in range", () => {
    const frames: KeyState[] = Array.from(
      { length: 60 },
      () => state({ forward: true }),
    );
    const recording = buildRecording(frames);
    // Trigger far away in the orthogonal direction so the predicted path
    // never enters it.
    const trigger = fakeTrigger(10, 10, 0.3, 0.3);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [trigger],
    });
    expect(result).toBeNull();
  });

  it("returns null when the recording is only walking with no triggers supplied", () => {
    const frames: KeyState[] = Array.from(
      { length: 60 },
      () => state({ forward: true }),
    );
    const recording = buildRecording(frames);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBeNull();
  });

  it("uses explicit yaw when predicting a door crossing", () => {
    const frames: KeyState[] = Array.from(
      { length: 60 },
      () => state({ forward: true }),
    );
    const recording = buildRecording(frames);
    const rawNorthTrigger = fakeTrigger(0, -1.0, 0.6, 0.3);
    const cameraForwardTrigger = fakeTrigger(-1.0, -1.0, 0.3, 0.3);

    const raw = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [rawNorthTrigger],
      yawRad: 0,
    });
    const cameraRelative = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [cameraForwardTrigger],
      yawRad: Math.PI / 4,
    });

    expect(raw).toBe("door");
    expect(cameraRelative).toBe("door");
  });
});

describe("nextQualitativelyDifferentAction: priority order", () => {
  it("returns 'throw' when throw, pickup, and punch all appear in the window", () => {
    const frames: KeyState[] = [
      state({ punch: true }),
      state({ pickup: true }),
      state({ throw: true }),
    ];
    const recording = buildRecording(frames);
    // currentTick=-1 so the window covers ticks 0..29, finding all three.
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: -1,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBe("throw");
  });

  it("returns 'pickup' when pickup and punch (but no throw) appear in the window", () => {
    const frames: KeyState[] = [
      state({ punch: true }),
      state({ pickup: true }),
    ];
    const recording = buildRecording(frames);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: -1,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBe("pickup");
  });

  it("returns 'fist' when only punch appears in the window", () => {
    const frames: KeyState[] = [state({ punch: true })];
    const recording = buildRecording(frames);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: -1,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBe("fist");
  });

  it("punch beats door when both are in the window", () => {
    // Walk forward and have a punch flag; the forward integration would
    // cross a trigger but the priority order returns 'fist' instead.
    const frames: KeyState[] = Array.from({ length: 60 }, (_, i) =>
      i === 5 ? state({ forward: true, punch: true }) : state({ forward: true }),
    );
    const recording = buildRecording(frames);
    const trigger = fakeTrigger(0, -1.0, 0.6, 0.3);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [trigger],
    });
    expect(result).toBe("fist");
  });

  it("sleep beats every recorded action even if the window has throw", () => {
    const frames: KeyState[] = [state({ throw: true })];
    const recording = buildRecording(frames);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: -1,
      isCurrentlyUnconscious: true,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBe("sleep");
  });
});

describe("nextQualitativelyDifferentAction: window boundaries", () => {
  it("returns null when the ghost is past the end of the recording", () => {
    const recording = buildRecording([NEUTRAL, NEUTRAL]);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 100,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBeNull();
  });

  it("default lookahead window is 30 ticks", () => {
    expect(DEFAULT_LOOKAHEAD_TICKS).toBe(30);
  });

  it("respects a custom lookahead window length", () => {
    // Punch at tick 10; with lookaheadTicks=5 and currentTick=0 the scan
    // window is ticks 1..5, which excludes tick 10.
    const frames: KeyState[] = Array.from({ length: 11 }, (_, i) =>
      i === 10 ? state({ punch: true }) : NEUTRAL,
    );
    const recording = buildRecording(frames);
    const tight = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      lookaheadTicks: 5,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(tight).toBeNull();
    const wide = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      lookaheadTicks: 15,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(wide).toBe("fist");
  });

  it("returns null for a non-positive lookaheadTicks", () => {
    const recording = buildRecording([state({ throw: true })]);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: -1,
      lookaheadTicks: 0,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBeNull();
  });
});

describe("nextQualitativelyDifferentAction: walking is not flagged", () => {
  it("returns null when the recording is purely movement (no qualitative actions)", () => {
    const frames: KeyState[] = Array.from({ length: 60 }, () =>
      state({ forward: true }),
    );
    const recording = buildRecording(frames);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBeNull();
  });

  it("returns null for an idle ghost (all-neutral frames)", () => {
    const frames: KeyState[] = Array.from({ length: 60 }, () => NEUTRAL);
    const recording = buildRecording(frames);
    const result = nextQualitativelyDifferentAction({
      recording,
      currentTick: 0,
      isCurrentlyUnconscious: false,
      currentPosition: { x: 0, z: 0 },
      triggers: [],
    });
    expect(result).toBeNull();
  });
});
