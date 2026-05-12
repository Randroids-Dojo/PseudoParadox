/**
 * Tests for the throw mechanic (REQ-036).
 *
 * Pure helpers (`computeThrowImpulse`) and the side-effecting transition
 * (`applyThrow`, `tryThrow`) are exercised here. Integration with the
 * in-flight registry and portal traversal lives in
 * `tests/sim/bodyTraversal.test.ts`.
 */

import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  THROW_IMPULSE_N,
  THROW_UP_IMPULSE_N,
  applyThrow,
  computeThrowImpulse,
  tryThrow,
  type ThrowBodyHandle,
} from "../../src/sim/throw.ts";
import { DEFAULT_FACING } from "../../src/sim/facing.ts";
import type { CarryState } from "../../src/sim/carryState.ts";

beforeAll(async () => {
  await RAPIER.init();
});

interface BodyCall {
  type: "setBodyType" | "setLinvel" | "applyImpulse";
  payload: unknown;
}

const buildStubBody = (): {
  body: ThrowBodyHandle;
  calls: BodyCall[];
} => {
  const calls: BodyCall[] = [];
  const body: ThrowBodyHandle = {
    setBodyType: ((type, _wakeUp) => {
      calls.push({ type: "setBodyType", payload: type });
    }) as ThrowBodyHandle["setBodyType"],
    setLinvel: ((linvel, _wakeUp) => {
      calls.push({
        type: "setLinvel",
        payload: { x: linvel.x, y: linvel.y, z: linvel.z },
      });
    }) as ThrowBodyHandle["setLinvel"],
    applyImpulse: ((impulse, _wakeUp) => {
      calls.push({
        type: "applyImpulse",
        payload: { x: impulse.x, y: impulse.y, z: impulse.z },
      });
    }) as ThrowBodyHandle["applyImpulse"],
  };
  return { body, calls };
};

describe("computeThrowImpulse: REQ-036 pure helper", () => {
  it("scales a unit facing by THROW_IMPULSE_N along the planar axes plus the upward bump", () => {
    const impulse = computeThrowImpulse({ x: 1, z: 0 });
    expect(impulse.x).toBe(THROW_IMPULSE_N);
    expect(impulse.y).toBe(THROW_UP_IMPULSE_N);
    expect(impulse.z).toBe(0);
  });

  it("scales the default north facing to a forward-going impulse with the upward bump", () => {
    const impulse = computeThrowImpulse(DEFAULT_FACING);
    expect(impulse.x).toBe(0);
    expect(impulse.y).toBe(THROW_UP_IMPULSE_N);
    expect(impulse.z).toBe(-THROW_IMPULSE_N);
  });

  it("preserves the planar direction across positive and negative facings", () => {
    const south = computeThrowImpulse({ x: 0, z: 1 });
    expect(south.x).toBe(0);
    expect(south.z).toBe(THROW_IMPULSE_N);
    const west = computeThrowImpulse({ x: -1, z: 0 });
    expect(west.x).toBe(-THROW_IMPULSE_N);
    expect(west.z).toBe(0);
  });

  it("zero facing produces a zero planar impulse plus the upward bump (defensive only; tracker should never feed zero)", () => {
    const impulse = computeThrowImpulse({ x: 0, z: 0 });
    expect(impulse.x).toBe(0);
    expect(impulse.y).toBe(THROW_UP_IMPULSE_N);
    expect(impulse.z).toBe(0);
  });
});

describe("applyThrow: REQ-036 side-effecting helper", () => {
  it("flips the body to Dynamic, zeroes velocity, and applies the throw impulse", () => {
    const { body, calls } = buildStubBody();
    applyThrow(body, { x: 1, z: 0 });
    expect(calls).toEqual([
      { type: "setBodyType", payload: RAPIER.RigidBodyType.Dynamic },
      { type: "setLinvel", payload: { x: 0, y: 0, z: 0 } },
      {
        type: "applyImpulse",
        payload: {
          x: THROW_IMPULSE_N,
          y: THROW_UP_IMPULSE_N,
          z: 0,
        },
      },
    ]);
  });

  it("applies the impulse along the supplied facing", () => {
    const { body, calls } = buildStubBody();
    applyThrow(body, { x: 0, z: -1 });
    const impulse = calls.find((c) => c.type === "applyImpulse")
      ?.payload as { x: number; y: number; z: number };
    expect(impulse.x).toBe(0);
    expect(impulse.z).toBe(-THROW_IMPULSE_N);
    expect(impulse.y).toBe(THROW_UP_IMPULSE_N);
  });
});

describe("tryThrow: REQ-036 high-level transition", () => {
  it("is a no-op when not carrying (idle stays idle, no body mutation)", () => {
    const { body, calls } = buildStubBody();
    const carry: CarryState = { kind: "idle" };
    const next = tryThrow({
      carry,
      throwRisingEdge: true,
      facing: { x: 1, z: 0 },
      resolveBody: () => body,
    });
    expect(next).toEqual({ kind: "idle" });
    expect(calls).toEqual([]);
  });

  it("is a no-op when the throw input is not on the rising edge (held key does not auto-fire)", () => {
    const { body, calls } = buildStubBody();
    const carry: CarryState = { kind: "carrying", carriedId: 7 };
    const next = tryThrow({
      carry,
      throwRisingEdge: false,
      facing: { x: 1, z: 0 },
      resolveBody: () => body,
    });
    expect(next).toEqual(carry);
    expect(calls).toEqual([]);
  });

  it("is a no-op when the resolver returns null (defensive against carry-state vs world desync)", () => {
    const { calls } = buildStubBody();
    const carry: CarryState = { kind: "carrying", carriedId: 7 };
    const next = tryThrow({
      carry,
      throwRisingEdge: true,
      facing: { x: 1, z: 0 },
      resolveBody: () => null,
    });
    expect(next).toEqual(carry);
    expect(calls).toEqual([]);
  });

  it("on a successful throw: returns idle, applies the impulse along the facing", () => {
    const { body, calls } = buildStubBody();
    const carry: CarryState = { kind: "carrying", carriedId: 7 };
    const next = tryThrow({
      carry,
      throwRisingEdge: true,
      facing: { x: 0, z: -1 },
      resolveBody: () => body,
    });
    expect(next).toEqual({ kind: "idle" });
    const impulse = calls.find((c) => c.type === "applyImpulse")
      ?.payload as { x: number; y: number; z: number };
    expect(impulse.x).toBe(0);
    expect(impulse.z).toBe(-THROW_IMPULSE_N);
    expect(impulse.y).toBe(THROW_UP_IMPULSE_N);
  });

  it("integration with a real Rapier body: pickup -> throw produces the expected impulse on a dynamic body", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1.2, 0)
      .enabledRotations(false, true, false)
      .setLinearDamping(0.5);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4), body);

    // Simulate the carry state: flip kinematic.
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    expect(body.bodyType()).toBe(RAPIER.RigidBodyType.KinematicPositionBased);

    // Throw east.
    applyThrow(body, { x: 1, z: 0 });
    expect(body.bodyType()).toBe(RAPIER.RigidBodyType.Dynamic);

    // After one step the body should be moving east + up.
    world.step();
    const linvel = body.linvel();
    expect(linvel.x).toBeGreaterThan(0);
    expect(linvel.y).toBeGreaterThan(0);
  });

  it("F-007 / Q-028: no-ops when isThrowAlreadyFired returns true (replay dedupe)", () => {
    const calls: BodyCall[] = [];
    const body: ThrowBodyHandle = {
      setBodyType: (kind, wakeUp) => {
        calls.push({ type: "setBodyType", payload: { kind, wakeUp } });
      },
      setLinvel: (linvel, wakeUp) => {
        calls.push({ type: "setLinvel", payload: { linvel, wakeUp } });
      },
      applyImpulse: (impulse, wakeUp) => {
        calls.push({ type: "applyImpulse", payload: { impulse, wakeUp } });
      },
    };
    let resolveBodyCalled = false;
    const carry: CarryState = { kind: "carrying", carriedId: 7 };
    const next = tryThrow({
      carry,
      throwRisingEdge: true,
      facing: { x: 0, z: -1 },
      resolveBody: () => {
        resolveBodyCalled = true;
        return body;
      },
      isThrowAlreadyFired: () => true,
    });
    // Carry stays at 'carrying' (no transition), no body calls, no
    // resolver lookup. The dedupe gate is short-circuit so the body
    // resolver is not even consulted.
    expect(next).toEqual(carry);
    expect(resolveBodyCalled).toBe(false);
    expect(calls).toEqual([]);
  });

  it("F-007 / Q-028: fires normally when isThrowAlreadyFired returns false", () => {
    const calls: BodyCall[] = [];
    const body: ThrowBodyHandle = {
      setBodyType: () => calls.push({ type: "setBodyType", payload: null }),
      setLinvel: () => calls.push({ type: "setLinvel", payload: null }),
      applyImpulse: () =>
        calls.push({ type: "applyImpulse", payload: null }),
    };
    const next = tryThrow({
      carry: { kind: "carrying", carriedId: 7 },
      throwRisingEdge: true,
      facing: { x: 0, z: -1 },
      resolveBody: () => body,
      isThrowAlreadyFired: () => false,
    });
    expect(next).toEqual({ kind: "idle" });
    expect(calls.length).toBe(3);
  });
});
