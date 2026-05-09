/**
 * Determinism test for thrown-body trajectory across replay (REQ-036 / Q-009).
 *
 * Q-009's recommended default is "trust Rapier's deterministic step plus
 * identical initial conditions plus identical impulse to produce identical
 * trajectory." Thrown bodies do NOT spawn ghosts (dossier section 7); on
 * replay, the recorded throw input flows through the same throw path and
 * a fresh thrown body in the past timeline follows the same physics.
 *
 * This test pins the contract: given identical world setup, identical
 * pre-throw body pose, and identical impulse along the same facing,
 * stepping for N ticks produces final positions that match within a
 * tight tolerance across two independent runs.
 *
 * NOTE: this is a Rapier determinism harness, not an end-to-end replay
 * harness. The full replay path (recorder snapshot, ghost replay of
 * throw input, second thrown body in the same world) lives in the host;
 * the DETERMINISTIC building block is what this test isolates so any
 * future regression to that building block surfaces here first.
 */

import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { applyThrow } from "../../src/sim/throw.ts";
import { DEFAULT_FACING } from "../../src/sim/facing.ts";

beforeAll(async () => {
  await RAPIER.init();
});

const buildThrowableWorld = (): {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
} => {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 1.5, 0)
    .enabledRotations(false, true, false)
    .setLinearDamping(0.5);
  const body = world.createRigidBody(bodyDesc);
  world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4), body);

  // Match the carry pickup transition: kinematic, zero velocity.
  body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  return { world, body };
};

describe("Thrown-body determinism (REQ-036 / Q-009)", () => {
  it("two identical setups produce identical final positions after N ticks", () => {
    const N = 30;

    const a = buildThrowableWorld();
    applyThrow(a.body, DEFAULT_FACING);
    for (let i = 0; i < N; i += 1) a.world.step();
    const finalA = a.body.translation();

    const b = buildThrowableWorld();
    applyThrow(b.body, DEFAULT_FACING);
    for (let i = 0; i < N; i += 1) b.world.step();
    const finalB = b.body.translation();

    expect(finalA.x).toBeCloseTo(finalB.x, 6);
    expect(finalA.y).toBeCloseTo(finalB.y, 6);
    expect(finalA.z).toBeCloseTo(finalB.z, 6);
  });

  it("identical throws along an arbitrary facing also produce identical trajectories", () => {
    const N = 30;
    const facing = { x: 0.6, z: 0.8 }; // unit-length diagonal

    const a = buildThrowableWorld();
    applyThrow(a.body, facing);
    for (let i = 0; i < N; i += 1) a.world.step();
    const finalA = a.body.translation();

    const b = buildThrowableWorld();
    applyThrow(b.body, facing);
    for (let i = 0; i < N; i += 1) b.world.step();
    const finalB = b.body.translation();

    expect(finalA.x).toBeCloseTo(finalB.x, 6);
    expect(finalA.y).toBeCloseTo(finalB.y, 6);
    expect(finalA.z).toBeCloseTo(finalB.z, 6);
  });

  it("a thrown body actually moves (sanity check that the test is not trivially passing)", () => {
    const N = 10;
    const a = buildThrowableWorld();
    const before = a.body.translation();
    applyThrow(a.body, { x: 1, z: 0 });
    for (let i = 0; i < N; i += 1) a.world.step();
    const after = a.body.translation();
    expect(after.x).toBeGreaterThan(before.x);
  });
});
