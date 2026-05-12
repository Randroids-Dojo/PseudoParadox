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

    // Body launched from outside the trigger; tests an edge crossing.
    // The detector is edge-triggered: register seeds overlap from
    // the body's current position (so a thrown-while-resident body
    // does not falsely fire), then step() picks up the boundary
    // crossing on the next tick.
    const stub = buildStubBody(
      { x: 0, y: 1.5, z: HALF_DEPTH - 1.5 },
      { x: 0, y: 4, z: 5 },
    );
    reg.register({ id: 7, body: stub.body });
    // Move the body INTO the trigger volume to simulate the arc
    // crossing. The detector is sampled against the body's live
    // translation each step.
    stub.setPos(0, 1.5, HALF_DEPTH - 0.2);
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

  it("does NOT teleport a body that is registered while ALREADY inside a trigger (edge-triggered detector)", () => {
    // Regression: a body thrown while standing inside a trigger
    // volume should not falsely fire a teleport on the first step.
    // The detector is edge-triggered, so register() seeds the
    // overlap state from the body's current position.
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });

    const startZ = HALF_DEPTH - 0.2;
    const stub = buildStubBody(
      { x: 0, y: 1.5, z: startZ },
      { x: 0, y: 0, z: 0 },
    );
    reg.register({ id: 7, body: stub.body });
    reg.step(litAll);

    // Position unchanged: the detector saw the body as already
    // inside, no edge crossed, no teleport fired.
    const t = stub.pos();
    expect(t.z).toBeCloseTo(startZ, 6);
  });

  it("does NOT teleport a body crossing a DARK portal (REQ-010 lit gate)", () => {
    const south = makePortal("south", 12, false);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });

    const stub = buildStubBody(
      { x: 0, y: 1.5, z: HALF_DEPTH - 1.5 },
      { x: 0, y: 4, z: 5 },
    );
    reg.register({ id: 7, body: stub.body });
    // Move into the trigger volume.
    const insideZ = HALF_DEPTH - 0.2;
    stub.setPos(0, 1.5, insideZ);
    reg.step(litNone);

    // Position unchanged: dark portal does not teleport.
    const t = stub.pos();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(insideZ, 6);
  });

  it("does NOT spawn a ghost (closed-form: thrown bodies are inert moving objects)", () => {
    // The InFlightRegistry exposes no ghost-spawn surface. This test
    // pins the API contract: the registry's public methods are
    // limited to register / step / clear / inFlight / clearTracking.
    // No method takes a `TimelineRegistry` and no method spawns a
    // `GhostInstance`.
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });
    const stub = buildStubBody(
      { x: 0, y: 1.5, z: HALF_DEPTH - 1.5 },
      { x: 0, y: 4, z: 5 },
    );
    reg.register({ id: 7, body: stub.body });
    stub.setPos(0, 1.5, HALF_DEPTH - 0.2);
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

    // Body launched from outside the trigger with an arc.
    const stub = buildStubBody(
      { x: 0, y: 1.5, z: HALF_DEPTH - 1.5 },
      { x: 0, y: 4, z: 5 },
    );
    reg.register({ id: 7, body: stub.body });

    // First step: move into the trigger and teleport.
    stub.setPos(0, 1.5, HALF_DEPTH - 0.2);
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
      // Position OUTSIDE the trigger; the body will fly INTO it.
      .setTranslation(0, 1.5, HALF_DEPTH - 1.5)
      .enabledRotations(false, true, false)
      .setLinearDamping(0.5);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4), body);
    body.setLinvel({ x: 0, y: 4, z: 5 }, true);

    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });
    reg.register({ id: 7, body });

    // Move the body into the trigger via a real Rapier step. Several
    // ticks of forward velocity (5 m/s along +z) push the body into
    // the south trigger's volume.
    for (let i = 0; i < 30; i += 1) {
      world.step();
      reg.step(litAll);
      // Stop if the teleport happened (the body's z snapped back to 0).
      if (Math.abs(body.translation().z) < HALF_DEPTH - 1.5) break;
    }
    const tAfter = body.translation();
    expect(tAfter.x).toBeCloseTo(0, 4);
    expect(Math.abs(tAfter.z)).toBeLessThan(HALF_DEPTH - 1.5);
    // The body remains in flight (still tracked, not yet settled).
    expect(reg.inFlight()).toContain(7);
  });
});

describe("InFlightRegistry: F-007 / Q-028 bodyId + portal crossing callback", () => {
  it("hasBodyForThrow returns true after register(bodyId), false before", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });
    const stub = buildStubBody({ x: 0, y: 1, z: 0 }, { x: 0, y: 4, z: 5 });
    expect(reg.hasBodyForThrow("1:100")).toBe(false);
    reg.register({ id: 7, body: stub.body, bodyId: "1:100" });
    expect(reg.hasBodyForThrow("1:100")).toBe(true);
    expect(reg.hasBodyForThrow("1:99")).toBe(false);
  });

  it("hasBodyForThrow remains false for bodies registered without a bodyId (back-compat)", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const reg = createInFlightRegistry({ triggers });
    const stub = buildStubBody({ x: 0, y: 1, z: 0 }, { x: 0, y: 4, z: 5 });
    reg.register({ id: 7, body: stub.body });
    // A registered body without a bodyId does not surface in the
    // dedupe lookup at all; the empty-string and other ids miss.
    expect(reg.hasBodyForThrow("")).toBe(false);
    expect(reg.hasBodyForThrow("anything")).toBe(false);
  });

  it("onPortalCrossing fires on lit-portal traversal with the body id and the crossed portal", () => {
    const south = makePortal("south", 12, true);
    const triggers = makeTriggers([south]);
    const crossings: { id: number; portal: Portal }[] = [];
    const reg = createInFlightRegistry({
      triggers,
      onPortalCrossing: (id, portal) => {
        crossings.push({ id, portal });
      },
    });

    // Body just outside the south trigger volume; one step + velocity
    // along +z drives it into the trigger and fires the lit-portal
    // teleport. The callback should fire with the carried id (7) and
    // the south portal object.
    const stub = buildStubBody(
      { x: 0, y: 1, z: HALF_DEPTH - 1 },
      { x: 0, y: 0, z: 5 },
    );
    reg.register({ id: 7, body: stub.body, bodyId: "1:100" });
    // Manually advance the body into the trigger before stepping
    // (the stub does not integrate; we set position so the next
    // step's pointInsideTrigger sees the body inside).
    stub.setPos(0, 1, HALF_DEPTH - 0.2);
    reg.step(litAll);
    expect(crossings).toHaveLength(1);
    expect(crossings[0].id).toBe(7);
    expect(crossings[0].portal).toBe(south);
  });

  it("onPortalCrossing does NOT fire when the portal is dark", () => {
    const south = makePortal("south", 12, false);
    const triggers = makeTriggers([south]);
    const crossings: { id: number; portal: Portal }[] = [];
    const reg = createInFlightRegistry({
      triggers,
      onPortalCrossing: (id, portal) => {
        crossings.push({ id, portal });
      },
    });
    const stub = buildStubBody(
      { x: 0, y: 1, z: HALF_DEPTH - 1 },
      { x: 0, y: 0, z: 5 },
    );
    reg.register({ id: 7, body: stub.body, bodyId: "1:100" });
    stub.setPos(0, 1, HALF_DEPTH - 0.2);
    reg.step(litNone);
    expect(crossings).toEqual([]);
  });
});
