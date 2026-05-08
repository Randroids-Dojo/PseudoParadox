import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createGhost } from "../../src/sim/ghostInstance.ts";
import {
  InputRecorder,
} from "../../src/sim/inputRecorder.ts";
import {
  PLAYER_SPEED_MPS,
  type KeyState,
} from "../../src/input/keyboard.ts";
import { interpolateWarmToCool } from "../../src/render/colorTint.ts";

beforeAll(async () => {
  await RAPIER.init();
});

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
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    const b = createGhost({
      recording,
      originNormalized: 0.85,
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
