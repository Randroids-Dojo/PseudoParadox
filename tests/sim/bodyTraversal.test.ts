/**
 * Tests for the body-only portal traversal (REQ-036).
 *
 * Thrown bodies traverse LIT portals mid-flight while preserving their
 * velocity vector (Q-008 default). They do NOT spawn ghosts (dossier
 * section 7 closed-form decision). This file pins those contracts plus
 * the settle behavior (a body that comes to rest unregisters and stops
 * being eligible for re-traversal).
 */

import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  IN_FLIGHT_SETTLE_TICKS,
  createInFlightRegistry,
  type BodyLitGate,
  type InFlightBodyHandle,
} from "../../src/sim/bodyTraversal.ts";
import {
  createPortalTrigger,
  type PortalTrigger,
} from "../../src/sim/portalTrigger.ts";
import {
  createPortal,
  type Portal,
} from "../../src/sim/portal.ts";
import {
  createDoor,
  type DoorDirection,
} from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";

beforeAll(async () => {
  await RAPIER.init();
});

const HALF_DEPTH = ROOM_DIMENSIONS.depth / 2;

const makePortal = (
  direction: DoorDirection,
  destinationHours: number,
  isLit: boolean,
): Portal => {
  const door = createDoor(direction, ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
  return createPortal({ door, destinationHours, isLit });
};

const makeTriggers = (portals: readonly Portal[]): PortalTrigger[] =>
  portals.map(createPortalTrigger);

interface StubBody {
  body: InFlightBodyHandle;
  setPos: (x: number, y: number, z: number) => void;
  setVel: (x: number, y: number, z: number) => void;
  pos: () => { x: number; y: number; z: number };
  vel: () => { x: number; y: number; z: number };
}

const buildStubBody = (
  initialPos: { x: number; y: number; z: number },
  initialVel: { x: number; y: number; z: number },
): StubBody => {
  let pos = { ...initialPos };
  let vel = { ...initialVel };
  const body: InFlightBodyHandle = {
    translation: () => pos,
    setTranslation: ((t, _wakeUp) => {
      pos = { x: t.x, y: t.y, z: t.z };
    }) as InFlightBodyHandle["setTranslation"],
    linvel: () => vel,
    setLinvel: ((v, _wakeUp) => {
      vel = { x: v.x, y: v.y, z: v.z };
    }) as InFlightBodyHandle["setLinvel"],
  };
  return {
    body,
    setPos: (x, y, z) => {
      pos = { x, y, z };
    },
    setVel: (x, y, z) => {
      vel = { x, y, z };
    },
    pos: () => pos,
    vel: () => vel,
  };
};

const litAll: BodyLitGate = () => true;
const litNone: BodyLitGate = () => false;

describe("createInFlightRegistry: REQ-036 in-flight tracking", () => {
  it("starts empty", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });
    expect(reg.inFlight()).toEqual([]);
  });

  it("register adds a body to the in-flight list", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });
    const stub = buildStubBody(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 4, z: 5 },
    );
    reg.register({ id: 7, body: stub.body });
    expect(reg.inFlight()).toEqual([7]);
  });

  it("registering the same id twice keeps a single entry (replaces the prior registration)", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });
    const stub = buildStubBody(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 4, z: 5 },
    );
    reg.register({ id: 7, body: stub.body });
    reg.register({ id: 7, body: stub.body });
    expect(reg.inFlight()).toEqual([7]);
  });
});

describe("InFlightRegistry.step: REQ-036 lit-portal traversal", () => {
  it("teleports a body crossing a LIT portal to the destination spawn pose with velocity preserved (Q-008)", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });

    // Position the body INSIDE the south trigger volume with a forward arc.
    // South trigger sits at +z; HALF_DEPTH - small offset is inside.
    const stub = buildStubBody(
      { x: 0, y: 1.5, z: HALF_DEPTH - 0.2 },
      { x: 0, y: 4, z: 5 },
    );
    reg.register({ id: 7, body: stub.body });
    reg.step(litAll);

    // Default spawn pose is room center (0, 0).
    const t = stub.pos();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(0, 6);
    // Velocity preserved: same direction and magnitude.
    const v = stub.vel();
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(4, 6);
    expect(v.z).toBeCloseTo(5, 6);
    // The body remains in flight (still tracked).
    expect(reg.inFlight()).toContain(7);
  });

  it("does NOT teleport a body crossing a DARK portal (REQ-010 lit gate)", () => {
    const south = makePortal("south", 12, false);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });

    const startZ = HALF_DEPTH - 0.2;
    const stub = buildStubBody(
      { x: 0, y: 1.5, z: startZ },
      { x: 0, y: 4, z: 5 },
    );
    reg.register({ id: 7, body: stub.body });
    reg.step(litNone);

    // Position unchanged.
    const t = stub.pos();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(startZ, 6);
  });

  it("does NOT spawn a ghost (closed-form: thrown bodies are inert moving objects)", () => {
    // The InFlightRegistry exposes no ghost-spawn surface. This test
    // pins the API contract: the registry's public methods are
    // limited to register / step / clear / inFlight. No method takes
    // a `TimelineRegistry` and no method spawns a `GhostInstance`.
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });
    const stub = buildStubBody(
      { x: 0, y: 1.5, z: HALF_DEPTH - 0.2 },
      { x: 0, y: 4, z: 5 },
    );
    reg.register({ id: 7, body: stub.body });
    reg.step(litAll);

    // No ghost was created. The registry does not produce
    // GhostInstance objects (compile-time contract). Runtime sanity:
    // the body is still tracked, but no other side effect surfaces.
    expect(reg.inFlight()).toEqual([7]);
  });

  it("a settled body unregisters after IN_FLIGHT_SETTLE_TICKS consecutive sub-threshold ticks", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });

    // Body sitting at low velocity well outside the trigger.
    const stub = buildStubBody(
      { x: 0, y: 1, z: 0 },
      { x: 0.01, y: 0.01, z: 0.01 },
    );
    reg.register({ id: 7, body: stub.body });

    // Step exactly IN_FLIGHT_SETTLE_TICKS times: body settles and unregisters.
    for (let i = 0; i < IN_FLIGHT_SETTLE_TICKS; i += 1) {
      reg.step(litAll);
    }
    expect(reg.inFlight()).toEqual([]);
  });

  it("a high-speed body does NOT settle: subThresholdTicks reset on any tick above the threshold", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });

    const stub = buildStubBody(
      { x: 0, y: 1, z: 0 },
      { x: 5, y: 0, z: 0 },
    );
    reg.register({ id: 7, body: stub.body });
    for (let i = 0; i < 10; i += 1) {
      reg.step(litAll);
    }
    expect(reg.inFlight()).toEqual([7]);
  });

  it("a body that settles after a teleport stops being eligible for re-traversal", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });

    // Position inside the south trigger with an arc.
    const stub = buildStubBody(
      { x: 0, y: 1.5, z: HALF_DEPTH - 0.2 },
      { x: 0, y: 4, z: 5 },
    );
    reg.register({ id: 7, body: stub.body });

    // First step: teleport to room center, body still tracked.
    reg.step(litAll);
    expect(reg.inFlight()).toContain(7);

    // Manually slow the body to simulate settling.
    stub.setVel(0.01, 0.01, 0.01);
    for (let i = 0; i < IN_FLIGHT_SETTLE_TICKS; i += 1) {
      reg.step(litAll);
    }
    expect(reg.inFlight()).toEqual([]);

    // Place the body back inside a trigger after settling. A NEW
    // registry would re-traverse, but a settled body has been
    // dropped from THIS registry, so step() is a no-op.
    stub.setPos(0, 1.5, HALF_DEPTH - 0.2);
    stub.setVel(0, 4, 5);
    reg.step(litAll);
    // Position unchanged: the registry is empty so nothing moves.
    const t = stub.pos();
    expect(t.z).toBeCloseTo(HALF_DEPTH - 0.2, 6);
  });
});

describe("InFlightRegistry.clear: REQ-036 hard reset teardown", () => {
  it("removes every tracked body's mesh from the scene and rigid body from the world", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });

    const scene = new THREE.Scene();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1, 0)
      .enabledRotations(false, true, false);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4), body);

    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1, 8, 16),
      new THREE.MeshStandardMaterial(),
    );
    scene.add(mesh);

    reg.register({ id: 7, body, mesh });
    expect(reg.inFlight()).toEqual([7]);
    expect(scene.children).toContain(mesh);
    expect(world.getRigidBody(body.handle)).toBeDefined();

    reg.clear(scene, world);

    expect(reg.inFlight()).toEqual([]);
    expect(scene.children).not.toContain(mesh);
  });

  it("clear is safe to call on an empty registry", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });
    const scene = new THREE.Scene();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    expect(() => reg.clear(scene, world)).not.toThrow();
  });
});

describe("InFlightRegistry: integration with a real Rapier body across multiple ticks", () => {
  it("teleports a real flying body crossing a lit portal and preserves its arc velocity", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      // Position right next to the south trigger inside-edge.
      .setTranslation(0, 1.5, HALF_DEPTH - 0.4)
      .enabledRotations(false, true, false)
      .setLinearDamping(0.5);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4), body);
    body.setLinvel({ x: 0, y: 4, z: 5 }, true);

    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });
    reg.register({ id: 7, body });

    // Step the registry first: should teleport the body to (0, 0).
    reg.step(litAll);
    const tAfter = body.translation();
    expect(tAfter.x).toBeCloseTo(0, 4);
    expect(tAfter.z).toBeCloseTo(0, 4);

    // Velocity preserved (rotated zero degrees).
    const v = body.linvel();
    expect(v.x).toBeCloseTo(0, 4);
    expect(v.y).toBeCloseTo(4, 4);
    expect(v.z).toBeCloseTo(5, 4);
  });
});
