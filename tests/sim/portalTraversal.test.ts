import { describe, expect, it, beforeAll, vi } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  wireTraversal,
  type ActiveLifetime,
  type ActivePlayerHandle,
} from "../../src/sim/portalTraversal.ts";
import { createPortalTriggerSet } from "../../src/sim/portalTrigger.ts";
import {
  createPortal,
  createActOnePortals,
  HOURS_PER_DAY,
  type Portal,
} from "../../src/sim/portal.ts";
import {
  createDoor,
  createFourDoors,
  type DoorDirection,
} from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import { PLAYER_CAPSULE } from "../../src/scene/player.ts";
import { applyInstanceTint } from "../../src/render/instanceTint.ts";
import type { GhostInstance } from "../../src/sim/ghostInstance.ts";
import type { KeyState } from "../../src/input/keyboard.ts";
import { interpolateWarmToCool } from "../../src/render/colorTint.ts";

beforeAll(async () => {
  await RAPIER.init();
});

const HALF_DEPTH = ROOM_DIMENSIONS.depth / 2;
const HALF_WIDTH = ROOM_DIMENSIONS.width / 2;

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

const makePortal = (
  direction: DoorDirection,
  destinationHours: number,
  isLit: boolean,
): Portal => {
  const door = createDoor(direction, ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
  return createPortal({ door, destinationHours, isLit });
};

interface Harness {
  scene: THREE.Scene;
  world: RAPIER.World;
  player: ActivePlayerHandle;
  lifetime: ActiveLifetime;
  ghosts: GhostInstance[];
}

const makePlayerBody = (world: RAPIER.World): RAPIER.RigidBody => {
  const { radius, cylinderLength } = PLAYER_CAPSULE;
  const restY = cylinderLength / 2 + radius;
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, restY, 0)
    .enabledRotations(false, true, false);
  const body = world.createRigidBody(desc);
  const collider = RAPIER.ColliderDesc.capsule(cylinderLength / 2, radius);
  world.createCollider(collider, body);
  return body;
};

const makePlayerMesh = (): THREE.Mesh => {
  const geom = new THREE.CapsuleGeometry(
    PLAYER_CAPSULE.radius,
    PLAYER_CAPSULE.cylinderLength,
    8,
    16,
  );
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(geom, mat);
  // Stamp at warm anchor so test can detect re-stamping later.
  applyInstanceTint(mesh, 0);
  return mesh;
};

const buildHarness = (): Harness => {
  const scene = new THREE.Scene();
  const world = buildWorld();
  const body = makePlayerBody(world);
  const mesh = makePlayerMesh();
  scene.add(mesh);
  const player: ActivePlayerHandle = {
    body,
    mesh,
    originNormalized: 0,
  };
  const lifetime: ActiveLifetime = {
    startPosition: { x: 0, z: 0 },
    recorder: new InputRecorder(),
    originNormalized: 0,
  };
  const ghosts: GhostInstance[] = [];
  return { scene, world, player, lifetime, ghosts };
};

describe("wireTraversal: lit portal entry", () => {
  it("snapshots the lifetime recording into a ghost on lit-portal enter", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    // Record some frames into the lifetime so the spawned ghost has a
    // recording to play back.
    lifetime.recorder.record(state({ forward: true }), 0);
    lifetime.recorder.record(state({ forward: true }), 0);
    lifetime.recorder.record(state({ forward: true }), 0);

    // Step the player into the south trigger.
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].body).toBeDefined();
  });

  it("ghost is tinted at the LIFETIME's origin normalized (the timeline being left behind)", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    lifetime.originNormalized = 0.25;
    player.originNormalized = 0.25;
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].originNormalized).toBe(0.25);
    const mat = ghosts[0].mesh.material as THREE.MeshStandardMaterial;
    const expected = interpolateWarmToCool(0.25);
    expect(mat.color.r).toBeCloseTo(expected.r, 6);
    expect(mat.color.g).toBeCloseTo(expected.g, 6);
    expect(mat.color.b).toBeCloseTo(expected.b, 6);
  });

  it("ghost spawns at the lifetime's start position, not the player's current pose", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    lifetime.startPosition = { x: 1.5, z: -2.25 };
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(ghosts).toHaveLength(1);
    const t = ghosts[0].body.translation();
    expect(t.x).toBeCloseTo(1.5, 6);
    expect(t.z).toBeCloseTo(-2.25, 6);
  });

  it("teleports the active player to the destination spawn pose (room center default)", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    // Move the player to the trigger zone before the step.
    player.body.setTranslation(
      { x: 0, y: player.body.translation().y, z: HALF_DEPTH - 0.4 },
      true,
    );
    detector.step(0, HALF_DEPTH - 0.4, 0);

    const t = player.body.translation();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(0, 6);
  });

  it("zeros the active player's velocity on traversal", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    player.body.setLinvel({ x: 3, y: -2, z: -4 }, true);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    const v = player.body.linvel();
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("re-stamps player.originNormalized to the destination time normalized", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(player.originNormalized).toBeCloseTo(12 / HOURS_PER_DAY, 6);
  });

  it("re-tints the active player's mesh to the destination color", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    const mat = player.mesh.material as THREE.MeshStandardMaterial;
    const expected = interpolateWarmToCool(12 / HOURS_PER_DAY);
    expect(mat.color.r).toBeCloseTo(expected.r, 6);
    expect(mat.color.g).toBeCloseTo(expected.g, 6);
    expect(mat.color.b).toBeCloseTo(expected.b, 6);
  });

  it("opens a fresh lifetime keyed at tick 0 of the destination timeline", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    lifetime.recorder.record(NEUTRAL, 0);
    expect(lifetime.recorder.length).toBe(2);
    const oldRecorder = lifetime.recorder;

    detector.step(0, HALF_DEPTH - 0.4, 0);

    // A fresh recorder at tick 0.
    expect(lifetime.recorder).not.toBe(oldRecorder);
    expect(lifetime.recorder.length).toBe(0);
    expect(lifetime.originNormalized).toBeCloseTo(12 / HOURS_PER_DAY, 6);
    expect(lifetime.startPosition.x).toBeCloseTo(0, 6);
    expect(lifetime.startPosition.z).toBeCloseTo(0, 6);
  });
});

describe("wireTraversal: dark portal filtering (REQ-010)", () => {
  it("does NOT spawn a ghost on dark-portal enter", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const dark = makePortal("south", 12, false);
    const detector = createPortalTriggerSet([dark]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(ghosts).toHaveLength(0);
  });

  it("does NOT teleport the player on dark-portal enter", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const dark = makePortal("south", 12, false);
    const detector = createPortalTriggerSet([dark]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    const sentinelX = 1.234;
    const sentinelZ = HALF_DEPTH - 0.4;
    player.body.setTranslation(
      { x: sentinelX, y: player.body.translation().y, z: sentinelZ },
      true,
    );
    detector.step(sentinelX, sentinelZ, 0);

    const t = player.body.translation();
    expect(t.x).toBeCloseTo(sentinelX, 6);
    expect(t.z).toBeCloseTo(sentinelZ, 6);
  });

  it("does NOT swap the lifetime recorder on dark-portal enter", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const dark = makePortal("south", 12, false);
    const detector = createPortalTriggerSet([dark]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    const oldRecorder = lifetime.recorder;
    detector.step(0, HALF_DEPTH - 0.4, 0);
    expect(lifetime.recorder).toBe(oldRecorder);
    expect(lifetime.recorder.length).toBe(1);
  });
});

describe("wireTraversal: empty recording handling", () => {
  it("does NOT spawn a ghost when the lifetime recording is empty (no visual noise)", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    // No record() calls before the trigger fires.
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(ghosts).toHaveLength(0);
    // ... but still teleports the player and resets the lifetime.
    const t = player.body.translation();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(0, 6);
    expect(lifetime.originNormalized).toBeCloseTo(12 / HOURS_PER_DAY, 6);
  });
});

describe("wireTraversal: exit and dispose semantics", () => {
  it("ignores `exit` events", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0); // enter
    expect(ghosts).toHaveLength(1);
    detector.step(0, 0, 1); // exit
    expect(ghosts).toHaveLength(1);
  });

  it("dispose() unsubscribes from the detector", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    const handle = wireTraversal({
      detector,
      player,
      lifetime,
      scene,
      world,
      ghosts,
    });

    handle.dispose();
    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(ghosts).toHaveLength(0);
  });
});

describe("wireTraversal: multi-portal sequence", () => {
  it("ghost list grows by one per LIT entry, stays the same for DARK entries", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    // Reuse the canonical Act 1 portal set: south lit, east lit, north dark,
    // west dark. The traversal handler must teleport on south/east entries
    // and ignore north/west entries.
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    // Record a small recording so each lit entry has something to snapshot.
    const recordSomething = (): void => {
      lifetime.recorder.record(NEUTRAL, 0);
    };

    let tick = 0;
    detector.step(0, 0, tick++); // outside

    // Lit south entry.
    recordSomething();
    detector.step(0, HALF_DEPTH - 0.4, tick++);
    expect(ghosts).toHaveLength(1);
    detector.step(0, 0, tick++); // exit

    // Dark north entry: no growth.
    recordSomething();
    detector.step(0, -(HALF_DEPTH - 0.4), tick++);
    expect(ghosts).toHaveLength(1);
    detector.step(0, 0, tick++); // exit

    // Lit east entry.
    recordSomething();
    detector.step(HALF_WIDTH - 0.4, 0, tick++);
    expect(ghosts).toHaveLength(2);
    detector.step(0, 0, tick++); // exit

    // Dark west entry: no growth.
    recordSomething();
    detector.step(-(HALF_WIDTH - 0.4), 0, tick++);
    expect(ghosts).toHaveLength(2);
  });
});

describe("wireTraversal: spawn pose contract", () => {
  it("default room-center pose sits outside every Act 1 portal trigger volume (no re-entry ping-pong)", () => {
    // Sanity guard: the SpawnPoseResolver contract says the resolved pose
    // must be outside every trigger volume. If a future per-time resolver
    // breaks this invariant the next `step()` after a teleport will fire a
    // fresh enter event on the trigger the player spawned in. The default
    // resolver returns (0, 0); confirm that is outside all four canonical
    // Act 1 triggers.
    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    for (const trigger of detector.triggers) {
      const insideRoomCenter =
        Math.abs(0 - trigger.centerX) <= trigger.halfX &&
        Math.abs(0 - trigger.centerZ) <= trigger.halfZ;
      expect(insideRoomCenter).toBe(false);
    }
  });

  it("traversing through a lit portal does not immediately re-trigger another enter at the destination", () => {
    // End-to-end guard: an enter on the south trigger teleports the player
    // to the room center; the very next `step()` (now at the room center)
    // must not emit any new enter events. If this regresses a future change
    // (e.g. a per-time resolver puts the player inside another trigger),
    // this test catches the ping-pong loop before it ships.
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, ghosts });

    const events: string[] = [];
    detector.onPortalOverlap((e) => events.push(`${e.kind}:${e.portal.direction}`));

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0); // enter south
    // After traversal the player is at (0, 0). No new enter should fire.
    detector.step(0, 0, 1);
    detector.step(0, 0, 2);

    expect(events.filter((e) => e.startsWith("enter"))).toEqual(["enter:south"]);
  });
});

describe("wireTraversal: custom spawn pose resolver", () => {
  it("uses the supplied resolver to pick the destination spawn position", () => {
    const { scene, world, player, lifetime, ghosts } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    const resolveSpawnPose = vi.fn((normalized: number) => ({
      x: normalized * 10,
      z: -1.5,
    }));
    wireTraversal({
      detector,
      player,
      lifetime,
      scene,
      world,
      ghosts,
      resolveSpawnPose,
    });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(resolveSpawnPose).toHaveBeenCalledTimes(1);
    expect(resolveSpawnPose).toHaveBeenCalledWith(12 / HOURS_PER_DAY);
    const t = player.body.translation();
    expect(t.x).toBeCloseTo((12 / HOURS_PER_DAY) * 10, 6);
    expect(t.z).toBeCloseTo(-1.5, 6);
    expect(lifetime.startPosition.x).toBeCloseTo((12 / HOURS_PER_DAY) * 10, 6);
    expect(lifetime.startPosition.z).toBeCloseTo(-1.5, 6);
  });
});
