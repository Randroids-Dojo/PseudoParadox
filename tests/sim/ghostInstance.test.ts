import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createGhost } from "../../src/sim/ghostInstance.ts";
import {
  InputRecorder,
  replayPunchAtTick,
} from "../../src/sim/inputRecorder.ts";
import {
  PLAYER_SPEED_MPS,
  type KeyState,
} from "../../src/input/keyboard.ts";
import { interpolateWarmToCool } from "../../src/render/colorTint.ts";
import {
  resolvePunches,
  suppressUnconsciousPunches,
  type PunchActor,
} from "../../src/sim/punch.ts";

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

const state = (overrides: Partial<KeyState>): KeyState => ({
  ...NEUTRAL,
  ...overrides,
});

const buildWorld = (): RAPIER.World =>
  new RAPIER.World({ x: 0, y: -9.81, z: 0 });

const buildRecording = (frames: KeyState[]) => {
  const r = new InputRecorder();
  for (const f of frames) r.record(f, 0);
  return r.snapshot();
};

const expectColorClose = (a: THREE.Color, b: THREE.Color): void => {
  expect(a.r).toBeCloseTo(b.r, 6);
  expect(a.g).toBeCloseTo(b.g, 6);
  expect(a.b).toBeCloseTo(b.b, 6);
};

describe("createGhost: tick-driven replay", () => {
  it("starts at tick 0 and increments by one per advanceTick call", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL, NEUTRAL, NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0.5,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });

    expect(ghost.tickIndex).toBe(0);
    ghost.advanceTick();
    expect(ghost.tickIndex).toBe(1);
    ghost.advanceTick();
    ghost.advanceTick();
    expect(ghost.tickIndex).toBe(3);
  });

  it("writes the recorded planar velocity onto the body each tick", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([
      state({ right: true }),
      state({ forward: true }),
      state({ left: true }),
    ]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });

    ghost.advanceTick();
    let v = ghost.body.linvel();
    expect(v.x).toBeCloseTo(PLAYER_SPEED_MPS, 6);
    expect(v.z).toBeCloseTo(0, 6);

    ghost.advanceTick();
    v = ghost.body.linvel();
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(-PLAYER_SPEED_MPS, 6);

    ghost.advanceTick();
    v = ghost.body.linvel();
    expect(v.x).toBeCloseTo(-PLAYER_SPEED_MPS, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("preserves the body's vertical velocity (gravity is not overwritten)", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([state({ forward: true })]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });

    // Inject a downward y velocity to simulate gravity having acted.
    ghost.body.setLinvel({ x: 0, y: -3.5, z: 0 }, true);
    ghost.advanceTick();
    const v = ghost.body.linvel();
    expect(v.y).toBeCloseTo(-3.5, 6);
    expect(v.z).toBeCloseTo(-PLAYER_SPEED_MPS, 6);
  });

  it("writes zero planar velocity past the end of the recording", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([state({ right: true })]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });

    ghost.advanceTick();
    expect(ghost.body.linvel().x).toBeCloseTo(PLAYER_SPEED_MPS, 6);

    // Past the end: zero planar velocity, indefinitely.
    ghost.advanceTick();
    let v = ghost.body.linvel();
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);

    ghost.advanceTick();
    ghost.advanceTick();
    v = ghost.body.linvel();
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("integrates recorded motion through the physics world", () => {
    // End-to-end style: drive a recording of 30 ticks of "forward" through a
    // real Rapier world stepping at the simulation rate. After integration
    // the ghost should have moved roughly the recorded distance in -Z.
    const scene = new THREE.Scene();
    const world = buildWorld();
    world.timestep = 1 / 60;
    const ticks = 30;
    const recording = buildRecording(
      Array.from({ length: ticks }, () => state({ forward: true })),
    );
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });

    const startZ = ghost.body.translation().z;
    for (let i = 0; i < ticks; i++) {
      ghost.advanceTick();
      world.step();
    }
    const endZ = ghost.body.translation().z;

    // Forward pushes -Z. With linear damping (8.0) and a per-tick velocity
    // command of PLAYER_SPEED_MPS (4 m/s), the ghost is approximately at
    // terminal speed within a few ticks. Be generous: at least 0.5 m of
    // negative-Z displacement is well below the analytic minimum but above
    // any noise floor.
    expect(endZ).toBeLessThan(startZ - 0.5);
  });
});

describe("createGhost: tint and scene wiring", () => {
  it("tints the ghost mesh with the warm-to-cool color at originNormalized", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0.7,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });

    const material = ghost.mesh.material as THREE.MeshStandardMaterial;
    expectColorClose(material.color, interpolateWarmToCool(0.7));
    expect(ghost.originNormalized).toBe(0.7);
  });

  it("two ghosts spawned with different origins receive distinct tints", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL]);
    const a = createGhost({
      recording,
      originNormalized: 0.0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    const b = createGhost({
      recording,
      originNormalized: 0.85,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    const matA = a.mesh.material as THREE.MeshStandardMaterial;
    const matB = b.mesh.material as THREE.MeshStandardMaterial;
    expect(
      Math.abs(matA.color.r - matB.color.r) +
        Math.abs(matA.color.g - matB.color.g) +
        Math.abs(matA.color.b - matB.color.b),
    ).toBeGreaterThan(0.05);
  });

  it("adds the ghost mesh to the supplied scene at the supplied start position", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 1.5, z: -2.25 },
    });

    expect(scene.children).toContain(ghost.mesh);
    expect(ghost.mesh.position.x).toBeCloseTo(1.5, 6);
    expect(ghost.mesh.position.z).toBeCloseTo(-2.25, 6);
  });

  it("syncMeshFromBody copies the body translation onto the mesh", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });

    ghost.body.setTranslation({ x: 3, y: 1, z: -4 }, true);
    ghost.syncMeshFromBody();
    expect(ghost.mesh.position.x).toBeCloseTo(3, 6);
    expect(ghost.mesh.position.y).toBeCloseTo(1, 6);
    expect(ghost.mesh.position.z).toBeCloseTo(-4, 6);
  });
});

describe("createGhost: consciousness state (REQ-033 partial)", () => {
  it("opens at 'conscious'", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    expect(ghost.consciousness).toBe("conscious");
  });

  it("can be flipped to 'unconscious' through the setter", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    ghost.consciousness = "unconscious";
    expect(ghost.consciousness).toBe("unconscious");
  });

  it("reset() returns the consciousness flag to 'conscious'", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    ghost.consciousness = "unconscious";
    ghost.reset();
    expect(ghost.consciousness).toBe("conscious");
  });

  it("a recorded punch in timeline T replays through a ghost and knocks out a target in range", () => {
    // End-to-end punch-replay shape mirroring the host loop in `src/app.ts`:
    // a ghost replaying a recording with `punch=true` at tick T, plus a
    // conscious "active player" stand-in within range, produces a
    // resolution that flips the target unconscious.
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([
      state({ punch: false }),
      state({ punch: true }),
      state({ punch: false }),
    ]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      // Place the ghost at (0, 0); the "active player" stand-in sits at
      // (1.0, 0), inside the 1.2 m punch range.
      startPosition: { x: 0, z: 0 },
    });

    const targetActor: PunchActor = {
      id: 2,
      position: { x: 1.0, z: 0 },
      punching: false,
      consciousness: "conscious",
    };
    let targetState: "conscious" | "unconscious" = "conscious";

    // Tick 0: no punch in the recording, no resolution.
    {
      const punchActors: PunchActor[] = [
        {
          id: ghost.instanceId,
          position: ghost.body.translation(),
          punching: replayPunchAtTick(ghost.recording, ghost.tickIndex),
          consciousness: ghost.consciousness,
        },
        { ...targetActor, consciousness: targetState },
      ];
      const r = resolvePunches(suppressUnconsciousPunches(punchActors));
      expect(r).toEqual([]);
      ghost.advanceTick();
    }

    // Tick 1: the recording has punch=true at the ghost's current tick.
    // The resolver produces (ghost.instanceId, target.id).
    {
      const punchActors: PunchActor[] = [
        {
          id: ghost.instanceId,
          position: ghost.body.translation(),
          punching: replayPunchAtTick(ghost.recording, ghost.tickIndex),
          consciousness: ghost.consciousness,
        },
        { ...targetActor, consciousness: targetState },
      ];
      const r = resolvePunches(suppressUnconsciousPunches(punchActors));
      expect(r).toEqual([{ attackerId: ghost.instanceId, targetId: 2 }]);
      // Apply the knockout the way the host does.
      for (const { targetId } of r) {
        if (targetId === 2) targetState = "unconscious";
      }
      ghost.advanceTick();
    }
    expect(targetState).toBe("unconscious");
  });

  it("exposes a thoughtBubble parented to the scene (REQ-032)", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    expect(ghost.thoughtBubble).toBeDefined();
    expect(scene.children).toContain(ghost.thoughtBubble.group);
    expect(ghost.thoughtBubble.currentKind).toBeNull();
  });

  it("reset() hides the thought bubble (REQ-032)", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    ghost.thoughtBubble.setIcon("fist");
    expect(ghost.thoughtBubble.currentKind).toBe("fist");
    ghost.reset();
    expect(ghost.thoughtBubble.currentKind).toBeNull();
  });

  it("REQ-030 regression: a ghost built with originNormalized = 0.5 tints to interpolateWarmToCool(0.5) within 1e-6", () => {
    // Dossier section 11 asks for a regression that builds a ghost with
    // `originNormalized = 0.5` and asserts
    // `ghost.mesh.material.color.equals(interpolateWarmToCool(0.5))` to
    // within `1e-6`. The ghost's mesh material color is stamped at
    // construction by `applyInstanceTint`; assert the per-channel deltas
    // are all under the tolerance.
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0.5,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });

    const material = ghost.mesh.material as THREE.MeshStandardMaterial;
    const expected = interpolateWarmToCool(0.5);
    const TOL = 1e-6;
    expect(Math.abs(material.color.r - expected.r)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(material.color.g - expected.g)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(material.color.b - expected.b)).toBeLessThanOrEqual(TOL);
    expect(ghost.originNormalized).toBe(0.5);
  });

  it("exposes the recording so the host can read replayPunchAtTick(recording, tickIndex)", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const recording = buildRecording([NEUTRAL, NEUTRAL]);
    const ghost = createGhost({
      recording,
      originNormalized: 0,
      instanceId: 1,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    // The exposed recording is the same frozen object the caller passed in.
    expect(ghost.recording).toBe(recording);
  });
});
