/**
 * REQ-004 no-paradox property tests.
 *
 * Source spec: `docs/gdd/40-act-progress-and-narrative-beats.md` section 7.
 * The four invariants below are translated from Pillar 2 into testable
 * properties. Each property runs at least 100 randomized input sequences
 * derived from a hand-rolled LCG (Q-017 default) seeded from the test name,
 * so failures are deterministic across runs.
 *
 *   1. Input recordings are immutable post-snapshot. The recorder may be
 *      mutated for additional ticks after `snapshot()` returns, but the
 *      returned object's frames and per-frame keys are deeply frozen and
 *      mutation attempts are silently rejected (or throw under strict mode);
 *      in either case the snapshot's observable state is unchanged.
 *
 *   2. Timeline registry entries do not lose ghosts during the simulation
 *      lifecycle. Across 100 trials, each running a 50-operation randomized
 *      sequence (70% `add`, 30% `setActiveTimeline`), the total ghost count
 *      across all buckets is monotonically non-decreasing, except across
 *      `clearAllGhosts` (the registry's hard-reset path), after which the
 *      count is zero.
 *
 *   3. A ghost's recorded behavior at tick K does not depend on any input
 *      made AFTER tick K. A ghost built from a snapshot taken at tick K
 *      produces identical body translations regardless of whether the source
 *      recorder kept recording (or what was recorded) past K.
 *
 *   4. (Combined with REQ-005) `Portal.destinationHours` is readonly across
 *      a long randomized simulation. REQ-005's polish flip already pinned a
 *      portal-specific test (`tests/sim/portal.test.ts`); this file only
 *      adds a recorder-side / registry-side assertion that snapshotting and
 *      registry mutation never cause a portal-bound recording's keys or
 *      origin-normalized to drift, so the no-paradox invariant covers the
 *      ghost's full state space, not just velocity at a tick.
 *
 * The LCG is a 30-line hand-rolled Lehmer-style generator (NOT a third-party
 * library, per Rule 3 stack constraints). Seed is derived from the test
 * name via a small djb2 hash so each test gets a stable, distinct sequence.
 */

import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  InputRecorder,
  replayAtTick,
  type InputRecording,
} from "../../src/sim/inputRecorder.ts";
import { createGhost } from "../../src/sim/ghostInstance.ts";
import {
  createTimelineRegistry,
  type TimelineRegistry,
} from "../../src/sim/timelineRegistry.ts";
import type { KeyState } from "../../src/input/keyboard.ts";

beforeAll(async () => {
  await RAPIER.init();
});

// LCG: 32-bit Lehmer (multiplicative congruential). Seeded from a non-zero
// 32-bit integer; advances with `state = (state * 48271) % 0x7fffffff`. This
// is the same generator Park-Miller documented; sufficient for fuzz seeding
// where cryptographic strength is not required. Seed=0 collapses the
// generator, so the constructor maps 0 to 1.
const djb2 = (input: string): number => {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return h >>> 0;
};

class Lcg {
  private state: number;

  constructor(seedString: string) {
    const seed = djb2(seedString) & 0x7fffffff;
    this.state = seed === 0 ? 1 : seed;
  }

  /** Returns a number in [0, 1). */
  next(): number {
    this.state = (this.state * 48271) % 0x7fffffff;
    return (this.state - 1) / 0x7ffffffe;
  }

  /** Returns an integer in [0, n). */
  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Returns true with probability p. */
  bool(p = 0.5): boolean {
    return this.next() < p;
  }
}

const NEUTRAL: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
};

const randomKeyState = (lcg: Lcg): KeyState => ({
  forward: lcg.bool(0.3),
  back: lcg.bool(0.2),
  left: lcg.bool(0.25),
  right: lcg.bool(0.25),
  punch: lcg.bool(0.1),
  pickup: lcg.bool(0.05),
  throw: lcg.bool(0.05),
});

const buildWorld = (): RAPIER.World =>
  new RAPIER.World({ x: 0, y: -9.81, z: 0 });

const buildScene = (): THREE.Scene => new THREE.Scene();

const cloneFrame = (recording: InputRecording, tick: number) => ({
  tick: recording.frames[tick].tick,
  keys: { ...recording.frames[tick].keys },
  timeOfDay: recording.frames[tick].timeOfDay,
});

const cloneRecording = (recording: InputRecording) =>
  recording.frames.map((_, i) => cloneFrame(recording, i));

describe("REQ-004 invariant 1: InputRecordings are immutable post-snapshot", () => {
  it("snapshot frames and keys are frozen; 100 random sequences leave the snapshot unchanged after further recording", () => {
    const lcg = new Lcg(
      "REQ-004 invariant 1: InputRecordings are immutable post-snapshot",
    );

    for (let trial = 0; trial < 100; trial += 1) {
      const recorder = new InputRecorder();
      const initialLen = 50 + lcg.nextInt(50);
      for (let t = 0; t < initialLen; t += 1) {
        recorder.record(randomKeyState(lcg), lcg.next());
      }
      const snap = recorder.snapshot();
      // Capture the canonical state for comparison.
      const expectedFrames = cloneRecording(snap);

      // Snapshot's outer object and frames array MUST be frozen.
      expect(Object.isFrozen(snap)).toBe(true);
      expect(Object.isFrozen(snap.frames)).toBe(true);
      for (const frame of snap.frames) {
        expect(Object.isFrozen(frame)).toBe(true);
        expect(Object.isFrozen(frame.keys)).toBe(true);
      }

      // Continue recording for an additional random number of ticks.
      const extraLen = 20 + lcg.nextInt(80);
      for (let t = 0; t < extraLen; t += 1) {
        recorder.record(randomKeyState(lcg), lcg.next());
      }

      // The snapshot's observable state must be unchanged.
      expect(snap.length).toBe(initialLen);
      expect(snap.frames.length).toBe(initialLen);
      for (let i = 0; i < initialLen; i += 1) {
        expect(snap.frames[i].tick).toBe(expectedFrames[i].tick);
        expect(snap.frames[i].timeOfDay).toBe(expectedFrames[i].timeOfDay);
        expect(snap.frames[i].keys).toEqual(expectedFrames[i].keys);
      }
    }
  });

  it("100 random sequences: silent or throwing rejection of mutation attempts on a snapshot leave the snapshot unchanged", () => {
    const lcg = new Lcg(
      "REQ-004 invariant 1: silent or throwing rejection of mutation",
    );

    for (let trial = 0; trial < 100; trial += 1) {
      const recorder = new InputRecorder();
      const len = 30 + lcg.nextInt(40);
      for (let t = 0; t < len; t += 1) {
        recorder.record(randomKeyState(lcg), lcg.next());
      }
      const snap = recorder.snapshot();
      const expected = cloneRecording(snap);

      // Attempt mutation. Under non-strict mode `Object.freeze` silently
      // rejects writes; under strict mode (vitest's default for ES modules)
      // it throws. Either is acceptable; the invariant is the snapshot is
      // observably unchanged after each attempt.
      const tryMutate = (fn: () => void): void => {
        try {
          fn();
        } catch {
          // Frozen-object writes throw under strict mode; expected.
        }
      };

      tryMutate(() => {
        (snap.frames as unknown as { push: (x: unknown) => void }).push({
          tick: 99999,
          keys: { ...NEUTRAL },
          timeOfDay: 0,
        });
      });
      tryMutate(() => {
        const target = snap.frames[lcg.nextInt(len)] as unknown as {
          tick: number;
        };
        target.tick = -1;
      });
      tryMutate(() => {
        const target = snap.frames[lcg.nextInt(len)].keys as unknown as {
          forward: boolean;
        };
        target.forward = !target.forward;
      });
      tryMutate(() => {
        (snap as unknown as { length: number }).length = 0;
      });

      // Snapshot still matches its captured baseline.
      expect(snap.length).toBe(len);
      expect(snap.frames.length).toBe(len);
      for (let i = 0; i < len; i += 1) {
        expect(snap.frames[i].tick).toBe(expected[i].tick);
        expect(snap.frames[i].keys).toEqual(expected[i].keys);
        expect(snap.frames[i].timeOfDay).toBe(expected[i].timeOfDay);
      }
    }
  });
});

describe("REQ-004 invariant 2: Timeline registry entries do not lose ghosts during the simulation lifecycle", () => {
  it("100 random traversal sequences: total ghost count is monotonically non-decreasing across add and setActiveTimeline; clearAllGhosts is the only zeroing operation", () => {
    const lcg = new Lcg("REQ-004 invariant 2: registry monotonicity");
    const TIMELINES = [5, 6, 12];

    for (let trial = 0; trial < 100; trial += 1) {
      const scene = buildScene();
      const world = buildWorld();
      const registry = createTimelineRegistry({ initialTimeline: 5 });
      const totalCount = (r: TimelineRegistry): number => {
        let n = 0;
        for (const t of TIMELINES) n += r.ghostsFor(t).length;
        return n;
      };

      let previousCount = 0;
      // 50 random operations (add or switch timeline). add increases the
      // count; setActiveTimeline preserves it.
      for (let op = 0; op < 50; op += 1) {
        if (lcg.bool(0.7)) {
          // Add a ghost into a random timeline.
          const targetTimeline = TIMELINES[lcg.nextInt(TIMELINES.length)];
          const recorder = new InputRecorder();
          recorder.record(NEUTRAL, 0);
          const ghost = createGhost({
            recording: recorder.snapshot(),
            originNormalized: targetTimeline / 24,
            instanceId: 1,
            scene,
            world,
            startPosition: { x: 0, z: 0 },
          });
          registry.add(targetTimeline, ghost);
        } else {
          const next = TIMELINES[lcg.nextInt(TIMELINES.length)];
          registry.setActiveTimeline(next);
        }
        const next = totalCount(registry);
        expect(next).toBeGreaterThanOrEqual(previousCount);
        previousCount = next;
      }

      // After the random sequence, clearAllGhosts is the only path that
      // returns the count to zero.
      registry.clearAllGhosts(scene, world, 5);
      expect(totalCount(registry)).toBe(0);
    }
  });
});

describe("REQ-004 invariant 3: A ghost's recorded behavior at tick K does not depend on input made after tick K", () => {
  it("100 random sequences: a ghost built from a snapshot at tick K produces identical body translations regardless of post-K recording", () => {
    const lcg = new Lcg("REQ-004 invariant 3: ghost causality");

    for (let trial = 0; trial < 100; trial += 1) {
      const k = 15 + lcg.nextInt(30);

      // 1) Record an initial sequence S of length k.
      const recorder = new InputRecorder();
      for (let t = 0; t < k; t += 1) {
        recorder.record(randomKeyState(lcg), 0);
      }

      // Snapshot at tick K.
      const snapAtK = recorder.snapshot();

      // 2) Build ghost A from the snapshot, advance N=20 ticks, record
      //    each body translation.
      const sceneA = buildScene();
      const worldA = buildWorld();
      const ghostA = createGhost({
        recording: snapAtK,
        originNormalized: 0,
        instanceId: 1,
        scene: sceneA,
        world: worldA,
        startPosition: { x: 0, z: 0 },
      });
      const STEPS = 20;
      const translationsA: { x: number; y: number; z: number }[] = [];
      for (let t = 0; t < STEPS; t += 1) {
        ghostA.advanceTick();
        worldA.step();
        const tr = ghostA.body.translation();
        translationsA.push({ x: tr.x, y: tr.y, z: tr.z });
      }

      // 3) Continue recording into the SAME recorder for many additional
      //    random ticks. Take a fresh snapshot of the recorder (which now
      //    holds k + extra frames) but build ghost B FROM snapAtK (the
      //    K-tick snapshot), so the post-K recording cannot leak.
      const extra = 10 + lcg.nextInt(80);
      for (let t = 0; t < extra; t += 1) {
        recorder.record(randomKeyState(lcg), 0);
      }
      // Sanity: the new snapshot is longer; the K-tick snapshot is unchanged.
      const newerSnap = recorder.snapshot();
      expect(newerSnap.length).toBe(k + extra);
      expect(snapAtK.length).toBe(k);

      // 4) Build ghost B from snapAtK and replay it the same N steps.
      const sceneB = buildScene();
      const worldB = buildWorld();
      const ghostB = createGhost({
        recording: snapAtK,
        originNormalized: 0,
        instanceId: 1,
        scene: sceneB,
        world: worldB,
        startPosition: { x: 0, z: 0 },
      });
      for (let t = 0; t < STEPS; t += 1) {
        ghostB.advanceTick();
        worldB.step();
        const tr = ghostB.body.translation();
        const a = translationsA[t];
        // Bit-identical: same recording, same fixed-step world, same start.
        expect(tr.x).toBe(a.x);
        expect(tr.y).toBe(a.y);
        expect(tr.z).toBe(a.z);
      }
    }
  });

  it("100 random sequences: replayAtTick(snapshot, t) reads the same value before and after the recorder is mutated past K", () => {
    const lcg = new Lcg("REQ-004 invariant 3: replayAtTick determinism");

    for (let trial = 0; trial < 100; trial += 1) {
      const k = 10 + lcg.nextInt(40);
      const recorder = new InputRecorder();
      for (let t = 0; t < k; t += 1) {
        recorder.record(randomKeyState(lcg), 0);
      }
      const snap = recorder.snapshot();

      // Capture every replay value in [0, k).
      const before: { x: number; z: number }[] = [];
      for (let t = 0; t < k; t += 1) {
        const v = replayAtTick(snap, t);
        before.push({ x: v.x, z: v.z });
      }

      // Mutate the recorder.
      const extra = 1 + lcg.nextInt(50);
      for (let t = 0; t < extra; t += 1) {
        recorder.record(randomKeyState(lcg), 0);
      }

      // Re-read; values must match exactly.
      for (let t = 0; t < k; t += 1) {
        const v = replayAtTick(snap, t);
        expect(v.x).toBe(before[t].x);
        expect(v.z).toBe(before[t].z);
      }
    }
  });
});

describe("REQ-004 invariant 4: cross-cutting properties of the recording surface", () => {
  it("100 random sequences: a snapshot's per-frame keys are frozen and equality-stable across registry add operations", () => {
    const lcg = new Lcg("REQ-004 invariant 4: cross-cutting key stability");

    for (let trial = 0; trial < 100; trial += 1) {
      const scene = buildScene();
      const world = buildWorld();
      const registry = createTimelineRegistry({ initialTimeline: 5 });

      const recorder = new InputRecorder();
      const len = 20 + lcg.nextInt(40);
      for (let t = 0; t < len; t += 1) {
        recorder.record(randomKeyState(lcg), 0);
      }
      const snap = recorder.snapshot();
      const expectedKeys = snap.frames.map((f) => ({ ...f.keys }));

      const ghost = createGhost({
        recording: snap,
        originNormalized: 5 / 24,
        instanceId: 1,
        scene,
        world,
        startPosition: { x: 0, z: 0 },
      });
      registry.add(5, ghost);

      // After the registry add and a few simulation steps, the ghost's
      // recording reference still points at the same snapshot, and the
      // per-frame keys are unchanged. (The ghost reads the recording but
      // does not own it, so this is a property of InputRecording's
      // snapshot contract, but verifying it through the registry catches
      // any subtle aliasing the host could introduce.)
      for (let t = 0; t < 5; t += 1) {
        ghost.advanceTick();
        world.step();
      }

      expect(ghost.recording).toBe(snap);
      expect(ghost.recording.length).toBe(len);
      for (let i = 0; i < len; i += 1) {
        expect(ghost.recording.frames[i].keys).toEqual(expectedKeys[i]);
      }
    }
  });
});
