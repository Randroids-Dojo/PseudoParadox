import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PLAYER_CAPSULE, createPlayer } from "../../src/scene/player.ts";
import { interpolateWarmToCool } from "../../src/render/colorTint.ts";
import { ASTRONAUT_PART_NAMES } from "../../src/scene/astronaut.ts";

beforeAll(async () => {
  await RAPIER.init();
});

const buildWorld = (): RAPIER.World =>
  new RAPIER.World({ x: 0, y: -9.81, z: 0 });

const expectColorClose = (a: THREE.Color, b: THREE.Color): void => {
  expect(a.r).toBeCloseTo(b.r, 6);
  expect(a.g).toBeCloseTo(b.g, 6);
  expect(a.b).toBeCloseTo(b.b, 6);
};

describe("createPlayer originNormalized wiring (REQ-030)", () => {
  it("stamps the astronaut body with the warm-to-cool tint at the supplied origin", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const player = createPlayer(scene, world, { originNormalized: 0.3 });
    const material = player.mesh.material as THREE.MeshStandardMaterial;
    expectColorClose(material.color, interpolateWarmToCool(0.3));
    expect(player.originNormalized).toBe(0.3);
  });

  it("defaults originNormalized to 0 (warm anchor) when omitted", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const player = createPlayer(scene, world);
    const material = player.mesh.material as THREE.MeshStandardMaterial;
    expectColorClose(material.color, interpolateWarmToCool(0));
    expect(player.originNormalized).toBe(0);
  });

  it("two players spawned at different origins receive distinct tints", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const a = createPlayer(scene, world, { originNormalized: 0.0 });
    const b = createPlayer(scene, world, { originNormalized: 0.8 });
    const matA = a.mesh.material as THREE.MeshStandardMaterial;
    const matB = b.mesh.material as THREE.MeshStandardMaterial;
    expect(
      Math.abs(matA.color.r - matB.color.r) +
        Math.abs(matA.color.g - matB.color.g) +
        Math.abs(matA.color.b - matB.color.b),
    ).toBeGreaterThan(0.05);
  });
});

describe("createPlayer instance generation seed (REQ-007)", () => {
  it("seeds the active player at INITIAL_INSTANCE_ID = 1 (You1)", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const player = createPlayer(scene, world);
    expect(player.instanceId).toBe(1);
  });
});

describe("createPlayer visual silhouette (REQ-054)", () => {
  it("uses the anonymous astronaut mesh while keeping the tintable parent", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const player = createPlayer(scene, world);

    expect(player.mesh.userData.visualStyle).toBe("anonymous-astronaut");
    expect(
      player.mesh.getObjectByName(ASTRONAUT_PART_NAMES.visor),
    ).toBeDefined();
    expect(
      player.mesh.getObjectByName(ASTRONAUT_PART_NAMES.backpack),
    ).toBeDefined();
  });
});

describe("createPlayer consciousness seed (REQ-033 partial)", () => {
  it("seeds the active player at 'conscious'", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const player = createPlayer(scene, world);
    expect(player.consciousness).toBe("conscious");
  });
});

describe("createPlayer carry seed (REQ-034)", () => {
  it("seeds the active player at 'idle' carry state", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const player = createPlayer(scene, world);
    expect(player.carry).toEqual({ kind: "idle" });
  });

  it("setPlanarVelocity passes through unchanged when carry state is idle", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const player = createPlayer(scene, world);

    player.setPlanarVelocity(4, -3);
    const linvel = player.body.linvel();
    expect(linvel.x).toBeCloseTo(4, 6);
    expect(linvel.z).toBeCloseTo(-3, 6);
  });

  it("setPlanarVelocity scales by CARRY_SPEED_MULTIPLIER (0.6) when carrying", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const player = createPlayer(scene, world);

    player.carry = { kind: "carrying", carriedId: 2 };
    player.setPlanarVelocity(4, -3);
    const linvel = player.body.linvel();
    // 0.6 * 4 = 2.4; 0.6 * -3 = -1.8.
    expect(linvel.x).toBeCloseTo(2.4, 6);
    expect(linvel.z).toBeCloseTo(-1.8, 6);
  });

  it("setPlanarVelocity preserves Y velocity from gravity when scaling under carry", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const player = createPlayer(scene, world);

    // Pre-set a Y component on the body (e.g., from gravity falling).
    player.body.setLinvel({ x: 0, y: -5, z: 0 }, true);
    player.carry = { kind: "carrying", carriedId: 2 };
    player.setPlanarVelocity(4, 0);

    const linvel = player.body.linvel();
    expect(linvel.x).toBeCloseTo(2.4, 6);
    expect(linvel.y).toBeCloseTo(-5, 6);
  });
});

describe("REQ-026 spawn pose regression", () => {
  it("the active player spawns at the room center with the capsule resting on the floor", () => {
    // Dossier section 11 asks for a regression that spawn pose at game start
    // matches `(0, 0)` plus the capsule resting Y. The resting Y is the
    // capsule center such that the base of the lower hemisphere just
    // touches y = 0 (matching `restY = cylinderLength / 2 + radius` in
    // `createPlayer`).
    const scene = new THREE.Scene();
    const world = buildWorld();
    const player = createPlayer(scene, world);

    const t = player.body.translation();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(0, 6);
    const restY = PLAYER_CAPSULE.cylinderLength / 2 + PLAYER_CAPSULE.radius;
    expect(t.y).toBeCloseTo(restY, 6);

    // Mesh follows the body's pose at construction so the very first render
    // frame sees the astronaut at the spawn pose.
    expect(player.mesh.position.x).toBeCloseTo(0, 6);
    expect(player.mesh.position.y).toBeCloseTo(restY, 6);
    expect(player.mesh.position.z).toBeCloseTo(0, 6);
  });
});
