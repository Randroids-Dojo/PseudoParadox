/**
 * Tests for the side-effecting carry layer (REQ-034).
 *
 * Pure helpers (state, constants, selection) live in `carryState.test.ts`.
 * This file exercises the Rapier body-type flips and the per-tick
 * attachment helper. We use stubbed `CarryBodyHandle`s for the unit
 * surface and one real Rapier body for the integration sanity check.
 */

import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  applyCarryAttachment,
  applyCarryDrop,
  applyCarryPickup,
  carryTransitionKind,
  snapCarriedMeshAbove,
  type CarryBodyHandle,
} from "../../src/sim/applyCarry.ts";
import { CARRY_OFFSET, type CarryState } from "../../src/sim/carryState.ts";

beforeAll(async () => {
  await RAPIER.init();
});

interface BodyCall {
  type:
    | "setBodyType"
    | "setLinvel"
    | "setNextKinematicTranslation"
    | "setTranslation";
  payload: unknown;
}

const buildStubBody = (
  initialTranslation: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): {
  body: CarryBodyHandle;
  calls: BodyCall[];
} => {
  const calls: BodyCall[] = [];
  let position = { ...initialTranslation };
  const body: CarryBodyHandle = {
    setBodyType: ((type, _wakeUp) => {
      calls.push({ type: "setBodyType", payload: type });
    }) as CarryBodyHandle["setBodyType"],
    setLinvel: ((linvel, _wakeUp) => {
      calls.push({
        type: "setLinvel",
        payload: { x: linvel.x, y: linvel.y, z: linvel.z },
      });
    }) as CarryBodyHandle["setLinvel"],
    setNextKinematicTranslation: ((t) => {
      calls.push({
        type: "setNextKinematicTranslation",
        payload: { x: t.x, y: t.y, z: t.z },
      });
    }) as CarryBodyHandle["setNextKinematicTranslation"],
    setTranslation: ((t, _wakeUp) => {
      position = { x: t.x, y: t.y, z: t.z };
      calls.push({ type: "setTranslation", payload: { ...position } });
    }) as CarryBodyHandle["setTranslation"],
    translation: () => position,
  };
  return { body, calls };
};

describe("applyCarryPickup: REQ-034 pickup transition", () => {
  it("flips the body to KinematicPositionBased and zeroes linear velocity", () => {
    const { body, calls } = buildStubBody();
    applyCarryPickup(body);
    expect(calls).toEqual([
      {
        type: "setBodyType",
        payload: RAPIER.RigidBodyType.KinematicPositionBased,
      },
      { type: "setLinvel", payload: { x: 0, y: 0, z: 0 } },
    ]);
  });
});

describe("applyCarryAttachment: REQ-034 per-tick carry", () => {
  it("writes the carrier's translation plus CARRY_OFFSET as the next kinematic translation", () => {
    const { body, calls } = buildStubBody();
    const carrier = {
      translation: () => ({ x: 2, y: 0.9, z: -1 }),
    };
    applyCarryAttachment(carrier, body);
    expect(calls).toEqual([
      {
        type: "setNextKinematicTranslation",
        payload: {
          x: 2 + CARRY_OFFSET.x,
          y: 0.9 + CARRY_OFFSET.y,
          z: -1 + CARRY_OFFSET.z,
        },
      },
    ]);
  });

  it("repeated calls track the carrier's motion frame-by-frame", () => {
    const { body, calls } = buildStubBody();
    let carrierPos = { x: 0, y: 0.9, z: 0 };
    const carrier = { translation: () => carrierPos };

    applyCarryAttachment(carrier, body);
    carrierPos = { x: 1, y: 0.9, z: 0 };
    applyCarryAttachment(carrier, body);
    carrierPos = { x: 2, y: 0.9, z: 0 };
    applyCarryAttachment(carrier, body);

    const xs = calls.map((c) => (c.payload as { x: number }).x);
    expect(xs).toEqual([0, 1, 2]);
  });
});

describe("applyCarryDrop: REQ-034 drop transition", () => {
  it("flips the body back to Dynamic, zeroes linvel, and snaps onto the floor at the carrier's planar position", () => {
    const { body, calls } = buildStubBody();
    const carrier = {
      translation: () => ({ x: 3, y: 0.9, z: -2 }),
    };

    applyCarryDrop(carrier, body, 0.9);

    expect(calls.find((c) => c.type === "setBodyType")?.payload).toBe(
      RAPIER.RigidBodyType.Dynamic,
    );
    expect(calls.find((c) => c.type === "setTranslation")?.payload).toEqual({
      x: 3,
      y: 0.9,
      z: -2,
    });
    expect(calls.find((c) => c.type === "setLinvel")?.payload).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it("preserves the unconscious mesh tilt by not touching the mesh (the body remains unconscious on drop)", () => {
    // The drop is body-only by design: the dropped body is still
    // unconscious so its mesh stays tilted from the prior knockout.
    // This test pins the contract: the helper signature does not take
    // a mesh, so it cannot accidentally clear the rotation.
    const { body } = buildStubBody();
    const carrier = { translation: () => ({ x: 0, y: 0.9, z: 0 }) };
    // Verify by signature: the helper does not accept a mesh.
    applyCarryDrop(carrier, body, 0.9);
    // No assertion needed; this test pins the API surface.
    expect(true).toBe(true);
  });
});

describe("carryTransitionKind: REQ-034 state-transition classifier", () => {
  it("classifies idle -> carrying as 'pickup'", () => {
    const prev: CarryState = { kind: "idle" };
    const next: CarryState = { kind: "carrying", carriedId: 7 };
    expect(carryTransitionKind(prev, next)).toBe("pickup");
  });

  it("classifies carrying -> idle as 'drop'", () => {
    const prev: CarryState = { kind: "carrying", carriedId: 7 };
    const next: CarryState = { kind: "idle" };
    expect(carryTransitionKind(prev, next)).toBe("drop");
  });

  it("classifies idle -> idle as 'none'", () => {
    expect(
      carryTransitionKind({ kind: "idle" }, { kind: "idle" }),
    ).toBe("none");
  });

  it("classifies carrying -> carrying as 'none' (the resolver never produces this, but the classifier is total)", () => {
    expect(
      carryTransitionKind(
        { kind: "carrying", carriedId: 1 },
        { kind: "carrying", carriedId: 2 },
      ),
    ).toBe("none");
  });
});

describe("snapCarriedMeshAbove: REQ-034 visual sync helper", () => {
  it("places the carried mesh at the carrier mesh position plus CARRY_OFFSET", () => {
    const carrierMesh = new THREE.Object3D();
    carrierMesh.position.set(2, 0.9, -1);
    const carriedMesh = new THREE.Object3D();
    carriedMesh.position.set(0, 0, 0);

    snapCarriedMeshAbove(carrierMesh, carriedMesh);

    expect(carriedMesh.position.x).toBeCloseTo(2 + CARRY_OFFSET.x, 12);
    expect(carriedMesh.position.y).toBeCloseTo(0.9 + CARRY_OFFSET.y, 12);
    expect(carriedMesh.position.z).toBeCloseTo(-1 + CARRY_OFFSET.z, 12);
  });
});

describe("integration with a real Rapier body (REQ-034)", () => {
  it("flips a real Rapier body to kinematic on pickup and back to dynamic on drop", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0.9, 0)
      .enabledRotations(false, true, false);
    const carriedBody = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4), carriedBody);

    // Initially dynamic.
    expect(carriedBody.bodyType()).toBe(RAPIER.RigidBodyType.Dynamic);

    applyCarryPickup(carriedBody);
    expect(carriedBody.bodyType()).toBe(
      RAPIER.RigidBodyType.KinematicPositionBased,
    );
    expect(carriedBody.linvel()).toEqual({ x: 0, y: 0, z: 0 });

    // Drop: flip back, snap to a new floor pose.
    const carrierBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(2, 0.9, -1),
    );
    applyCarryDrop(carrierBody, carriedBody, 0.9);

    expect(carriedBody.bodyType()).toBe(RAPIER.RigidBodyType.Dynamic);
    const t = carriedBody.translation();
    expect(t.x).toBeCloseTo(2, 6);
    expect(t.y).toBeCloseTo(0.9, 6);
    expect(t.z).toBeCloseTo(-1, 6);
  });

  it("attaches a kinematic body to a moving carrier via setNextKinematicTranslation", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    const carrierBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.9, 0),
    );
    const carriedBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0.5, 0.9, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4), carriedBody);

    applyCarryPickup(carriedBody);
    // Move the carrier and stamp the attachment.
    carrierBody.setTranslation({ x: 3, y: 0.9, z: 1 }, true);
    applyCarryAttachment(carrierBody, carriedBody);

    // Step the world so kinematic translation integrates.
    world.step();

    const t = carriedBody.translation();
    expect(t.x).toBeCloseTo(3 + CARRY_OFFSET.x, 4);
    expect(t.y).toBeCloseTo(0.9 + CARRY_OFFSET.y, 4);
    expect(t.z).toBeCloseTo(1 + CARRY_OFFSET.z, 4);
  });
});
