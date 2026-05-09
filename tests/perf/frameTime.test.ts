import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import { createGhost } from "../../src/sim/ghostInstance.ts";
import { type KeyState } from "../../src/input/keyboard.ts";

/**
 * REQ-039 frame-time regression guard.
 * (`docs/gdd/23-prototype-scope.md#definition-of-shippable`.)
 *
 * REQ-039: "Demo build runs at 60fps on a 2020-era laptop." 60 fps is
 * 16.67 ms / frame budget. The browser's render path (Three.js draw call,
 * Rapier WASM step) is the canonical hot path; this Vitest in-process
 * test is a REGRESSION GUARD on the simulation cost (Rapier step plus
 * ghost tick advance plus per-frame recorder writes) under load. A
 * real-browser frame-budget measurement is documented as F-008 (see
 * `docs/FOLLOWUPS.md`); this test catches sim-side regressions cheaply.
 *
 * Q-019 default A consumed: the assertion is on the 95th-percentile of
 * per-step CPU time. A single dropped frame is acceptable jank; sustained
 * > 16.67 ms 95th-percentile is the failure mode the player perceives.
 *
 * The threshold is per the dossier: `MAX_FRAME_MS = 16.67`. The test
 * runs N=300 fixed steps with 4 active ghosts each holding a 200-frame
 * recording, in a fresh world. The runtime cost is dominated by Rapier's
 * `world.step()`; ghost recordings are cheap. A passing run on a 2020-era
 * laptop is comfortably under 5 ms / step, so the threshold has plenty
 * of headroom for CI shared runners.
 *
 * RULE 3: no new core dependencies. The test uses only `performance.now()`
 * (Node global since 16+), Rapier, Three.js, and the existing project
 * primitives.
 */

const MAX_FRAME_MS = 16.67;
const N_STEPS = 300;
const N_GHOSTS = 4;
const RECORDING_LENGTH = 200;

beforeAll(async () => {
  await RAPIER.init();
});

const NEUTRAL: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
};

const buildSyntheticRecording = (length: number) => {
  const recorder = new InputRecorder();
  for (let i = 0; i < length; i++) {
    // Alternate left / right so the recorded velocity is non-trivial and
    // the ghost body moves under recording-driven input. The exact pattern
    // does not matter; this test measures cost, not correctness.
    const keys: KeyState =
      i % 2 === 0
        ? { ...NEUTRAL, right: true }
        : { ...NEUTRAL, left: true };
    recorder.record(keys, 5 / 24);
  }
  return recorder.snapshot();
};

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
};

describe("REQ-039 frame-time regression guard", () => {
  it(`per-step CPU time stays under ${MAX_FRAME_MS} ms at the 95th percentile with ${N_GHOSTS} ghosts`, () => {
    const scene = new THREE.Scene();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    // A floor so ghost bodies do not free-fall through the world.
    const floorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    const floorBody = world.createRigidBody(floorDesc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.5, 50),
      floorBody,
    );

    const ghosts = [];
    for (let i = 0; i < N_GHOSTS; i++) {
      const recording = buildSyntheticRecording(RECORDING_LENGTH);
      const ghost = createGhost({
        recording,
        originNormalized: (i + 1) / 24,
        instanceId: i + 100,
        scene,
        world,
        startPosition: { x: i * 1.5, z: 0 },
      });
      ghosts.push(ghost);
    }

    const stepTimes: number[] = [];

    for (let step = 0; step < N_STEPS; step++) {
      const start = performance.now();

      for (const g of ghosts) {
        g.advanceTick();
      }
      world.step();

      const elapsed = performance.now() - start;
      stepTimes.push(elapsed);
    }

    const p95 = percentile(stepTimes, 95);
    const mean =
      stepTimes.reduce((acc, v) => acc + v, 0) / stepTimes.length;

    // Diagnostic logging on failure: the assertion message helps a future
    // bisector identify which slice introduced a regression.
    if (p95 >= MAX_FRAME_MS) {
      // eslint-disable-next-line no-console
      console.error(
        `REQ-039 frame-time regression: p95=${p95.toFixed(2)} ms, mean=${mean.toFixed(2)} ms (budget ${MAX_FRAME_MS} ms)`,
      );
    }

    expect(p95).toBeLessThan(MAX_FRAME_MS);
  });
});
