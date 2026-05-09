/**
 * Tests for the knockout body response (REQ-033 finishing pass).
 *
 * The pure helper `knockoutBodyResponse` and the side-effecting
 * `applyKnockoutBodyResponse` / `clearKnockoutBodyResponse` together
 * implement the visible half of REQ-033: bump impulse, damping
 * reduction, mesh tilt. The dossier
 * (`docs/gdd/30-combat-and-interaction.md` section 4) is the source of
 * truth for the constants and the seam (body upright, mesh tipped).
 */

import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  ACTIVE_LINEAR_DAMPING,
  KNOCKOUT_FALLBACK_DIRECTION,
  KNOCKOUT_IMPULSE_N,
  KNOCKOUT_MESH_TILT_Z,
  KNOCKOUT_UP_IMPULSE_N,
  UNCONSCIOUS_LINEAR_DAMPING,
  applyKnockoutBodyResponse,
  clearKnockoutBodyResponse,
  knockoutBodyResponse,
  type KnockoutBodyHandle,
} from "../../src/sim/applyKnockoutBody.ts";

beforeAll(async () => {
  await RAPIER.init();
});

interface BodyCall {
  type: "applyImpulse" | "setLinearDamping";
  payload: unknown;
}

const buildStubBody = (): {
  body: KnockoutBodyHandle;
  calls: BodyCall[];
} => {
  const calls: BodyCall[] = [];
  const body: KnockoutBodyHandle = {
    applyImpulse: ((impulse, _wakeUp) => {
      calls.push({
        type: "applyImpulse",
        payload: { x: impulse.x, y: impulse.y, z: impulse.z },
      });
    }) as KnockoutBodyHandle["applyImpulse"],
    setLinearDamping: ((value) => {
      calls.push({ type: "setLinearDamping", payload: value });
    }) as KnockoutBodyHandle["setLinearDamping"],
  };
  return { body, calls };
};

describe("knockout body response constants (REQ-033 finishing pass)", () => {
  it("ships the dossier-default impulse magnitudes", () => {
    expect(KNOCKOUT_IMPULSE_N).toBe(6);
    expect(KNOCKOUT_UP_IMPULSE_N).toBe(2);
  });

  it("reduces damping to 0.5 for unconscious bodies (down from 8.0 active)", () => {
    expect(UNCONSCIOUS_LINEAR_DAMPING).toBe(0.5);
    expect(ACTIVE_LINEAR_DAMPING).toBe(8.0);
  });

  it("tilts the mesh by Math.PI / 2 on the local Z axis", () => {
    expect(KNOCKOUT_MESH_TILT_Z).toBeCloseTo(Math.PI / 2, 12);
  });

  it("falls back to world +X for the zero-direction edge case", () => {
    expect(KNOCKOUT_FALLBACK_DIRECTION).toEqual({ x: 1, z: 0 });
  });
});

describe("knockoutBodyResponse: pure impulse + tilt computation", () => {
  it("returns the impulse along the normalized incoming direction with the upward bump", () => {
    const r = knockoutBodyResponse({ x: 1, z: 0 });
    expect(r.impulse.x).toBeCloseTo(KNOCKOUT_IMPULSE_N, 6);
    expect(r.impulse.y).toBe(KNOCKOUT_UP_IMPULSE_N);
    expect(r.impulse.z).toBeCloseTo(0, 6);
    expect(r.meshRotationZ).toBeCloseTo(KNOCKOUT_MESH_TILT_Z, 12);
  });

  it("normalizes an unnormalized direction before scaling by the impulse magnitude", () => {
    const r = knockoutBodyResponse({ x: 3, z: 4 });
    expect(r.impulse.x).toBeCloseTo((3 / 5) * KNOCKOUT_IMPULSE_N, 6);
    expect(r.impulse.z).toBeCloseTo((4 / 5) * KNOCKOUT_IMPULSE_N, 6);
    expect(r.impulse.y).toBe(KNOCKOUT_UP_IMPULSE_N);
  });

  it("falls back to world +X when the direction is the zero vector (overlapping capsules)", () => {
    const r = knockoutBodyResponse({ x: 0, z: 0 });
    expect(r.impulse.x).toBeCloseTo(KNOCKOUT_IMPULSE_N, 6);
    expect(r.impulse.z).toBeCloseTo(0, 6);
    expect(r.impulse.y).toBe(KNOCKOUT_UP_IMPULSE_N);
  });

  it("preserves direction sign for an incoming vector along -Z", () => {
    const r = knockoutBodyResponse({ x: 0, z: -2 });
    expect(r.impulse.x).toBeCloseTo(0, 6);
    expect(r.impulse.z).toBeCloseTo(-KNOCKOUT_IMPULSE_N, 6);
  });
});

describe("applyKnockoutBodyResponse: side-effects on body and mesh", () => {
  it("applies the impulse, sets the unconscious damping, and tilts the mesh", () => {
    const { body, calls } = buildStubBody();
    const mesh = new THREE.Object3D();
    mesh.rotation.set(0, 0, 0);

    applyKnockoutBodyResponse(body, mesh, { x: 1, z: 0 });

    expect(calls).toEqual([
      {
        type: "applyImpulse",
        payload: {
          x: KNOCKOUT_IMPULSE_N,
          y: KNOCKOUT_UP_IMPULSE_N,
          z: 0,
        },
      },
      { type: "setLinearDamping", payload: UNCONSCIOUS_LINEAR_DAMPING },
    ]);
    expect(mesh.rotation.z).toBeCloseTo(KNOCKOUT_MESH_TILT_Z, 12);
  });

  it("applying twice double-scales the impulse on the body but leaves the tilt unchanged (caller-side idempotence is required)", () => {
    // The dossier specifies that the punch resolver filters unconscious
    // targets out, so this function is only invoked once per knockout
    // per body. This test pins the contract: the function itself does
    // not enforce idempotence; it is the caller's job. The mesh tilt is
    // already at the target so a second call is observably a no-op for
    // the tilt, but the body would receive a second impulse if the
    // caller failed to gate. Documented so a future regression here is
    // caught at the test level.
    const { body, calls } = buildStubBody();
    const mesh = new THREE.Object3D();

    applyKnockoutBodyResponse(body, mesh, { x: 1, z: 0 });
    applyKnockoutBodyResponse(body, mesh, { x: 1, z: 0 });

    const impulses = calls.filter((c) => c.type === "applyImpulse");
    expect(impulses.length).toBe(2);
    expect(mesh.rotation.z).toBeCloseTo(KNOCKOUT_MESH_TILT_Z, 12);
  });
});

describe("applyKnockoutBodyResponse: integration with a real Rapier body", () => {
  it("a real Rapier capsule receives non-zero linear velocity along the punch direction after one world step", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1.0, 0)
      .enabledRotations(false, true, false)
      .setLinearDamping(ACTIVE_LINEAR_DAMPING);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4), body);

    const mesh = new THREE.Object3D();

    // Punch landed from (-1, 0, 0): direction from puncher to recipient is +X.
    applyKnockoutBodyResponse(body, mesh, { x: 1, z: 0 });

    // Step the world once so the impulse integrates into linvel.
    world.step();

    const linvel = body.linvel();
    // X component carries the bulk of the bump; Z stays near zero (the
    // direction was pure +X). Y is nonzero from the upward bump and
    // gravity; only sign matters for this assertion (it should be
    // strictly positive immediately after a single step at this gravity
    // and impulse, since gravity has only had one tick to act).
    expect(linvel.x).toBeGreaterThan(0);
    expect(Math.abs(linvel.z)).toBeLessThan(0.01);
    expect(mesh.rotation.z).toBeCloseTo(KNOCKOUT_MESH_TILT_Z, 12);
  });

  it("the post-knockout damping value is observable on the body via Rapier's getter", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1.0, 0)
      .setLinearDamping(ACTIVE_LINEAR_DAMPING);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4), body);

    expect(body.linearDamping()).toBeCloseTo(ACTIVE_LINEAR_DAMPING, 6);

    const mesh = new THREE.Object3D();
    applyKnockoutBodyResponse(body, mesh, { x: 1, z: 0 });

    expect(body.linearDamping()).toBeCloseTo(UNCONSCIOUS_LINEAR_DAMPING, 6);

    clearKnockoutBodyResponse(body, mesh);
    expect(body.linearDamping()).toBeCloseTo(ACTIVE_LINEAR_DAMPING, 6);
  });
});

describe("clearKnockoutBodyResponse: hard-reset undo", () => {
  it("restores the active damping value and snaps the mesh rotation back to identity", () => {
    const { body, calls } = buildStubBody();
    const mesh = new THREE.Object3D();
    mesh.rotation.z = KNOCKOUT_MESH_TILT_Z;

    clearKnockoutBodyResponse(body, mesh);

    expect(calls).toEqual([
      { type: "setLinearDamping", payload: ACTIVE_LINEAR_DAMPING },
    ]);
    expect(mesh.rotation.z).toBe(0);
  });

  it("is idempotent on a never-knocked-out body (no observable change)", () => {
    const { body, calls } = buildStubBody();
    const mesh = new THREE.Object3D();

    clearKnockoutBodyResponse(body, mesh);
    clearKnockoutBodyResponse(body, mesh);

    expect(
      calls.every(
        (c) => c.type === "setLinearDamping" && c.payload === ACTIVE_LINEAR_DAMPING,
      ),
    ).toBe(true);
    expect(mesh.rotation.z).toBe(0);
  });
});
