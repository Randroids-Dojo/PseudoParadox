import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  KNOCKOUT_ANIMATION_TICKS,
  KNOCKOUT_ANTICIPATION_FRACTION,
  createKnockoutAnimator,
  knockoutTiltMultiplier,
} from "../../src/sim/knockoutAnimator.ts";

const TARGET = Math.PI / 2;

describe("knockoutTiltMultiplier (F-020)", () => {
  it("returns the anticipation fraction at tick 0 (reverse tilt wind-up)", () => {
    expect(knockoutTiltMultiplier(0)).toBe(KNOCKOUT_ANTICIPATION_FRACTION);
    expect(KNOCKOUT_ANTICIPATION_FRACTION).toBeLessThan(0);
  });

  it("returns the anticipation fraction at any negative tick (defensive total)", () => {
    expect(knockoutTiltMultiplier(-5)).toBe(KNOCKOUT_ANTICIPATION_FRACTION);
  });

  it("returns exactly 1 at the final tick so the mesh ends at the target", () => {
    expect(knockoutTiltMultiplier(KNOCKOUT_ANIMATION_TICKS)).toBe(1);
  });

  it("returns 1 for any tick past the animation length (defensive total)", () => {
    expect(knockoutTiltMultiplier(KNOCKOUT_ANIMATION_TICKS + 99)).toBe(1);
  });

  it("crosses above the target at least once before settling (the overshoot)", () => {
    let sawOvershoot = false;
    for (let t = 1; t < KNOCKOUT_ANIMATION_TICKS; t++) {
      if (knockoutTiltMultiplier(t) > 1) {
        sawOvershoot = true;
        break;
      }
    }
    expect(sawOvershoot).toBe(true);
  });

  it("is monotonically advancing in the first quarter of the animation", () => {
    const quarter = Math.floor(KNOCKOUT_ANIMATION_TICKS / 4);
    let prev = knockoutTiltMultiplier(1);
    for (let t = 2; t <= quarter; t++) {
      const cur = knockoutTiltMultiplier(t);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });
});

describe("createKnockoutAnimator (F-020)", () => {
  it("writes the anticipation rotation immediately on start", () => {
    const animator = createKnockoutAnimator();
    const mesh = new THREE.Object3D();
    animator.start(mesh, TARGET);
    expect(mesh.rotation.z).toBeCloseTo(
      TARGET * KNOCKOUT_ANTICIPATION_FRACTION,
      12,
    );
  });

  it("advances toward the target across exactly KNOCKOUT_ANIMATION_TICKS steps", () => {
    const animator = createKnockoutAnimator();
    const mesh = new THREE.Object3D();
    animator.start(mesh, TARGET);
    for (let i = 0; i < KNOCKOUT_ANIMATION_TICKS; i++) {
      animator.advance();
    }
    expect(mesh.rotation.z).toBeCloseTo(TARGET, 12);
  });

  it("snaps to the exact target on the final tick (any overshoot residual is discarded)", () => {
    const animator = createKnockoutAnimator();
    const mesh = new THREE.Object3D();
    animator.start(mesh, TARGET);
    for (let i = 0; i < KNOCKOUT_ANIMATION_TICKS - 1; i++) {
      animator.advance();
    }
    const beforeFinal = mesh.rotation.z;
    animator.advance();
    expect(mesh.rotation.z).toBe(TARGET);
    // Sanity: the final-tick value SHOULD have been close-ish even
    // without the snap, but the snap is what guarantees exact.
    expect(Math.abs(beforeFinal - TARGET)).toBeLessThan(0.2);
  });

  it("running advance past completion is a no-op (the entry is removed)", () => {
    const animator = createKnockoutAnimator();
    const mesh = new THREE.Object3D();
    animator.start(mesh, TARGET);
    for (let i = 0; i < KNOCKOUT_ANIMATION_TICKS; i++) animator.advance();
    expect(mesh.rotation.z).toBe(TARGET);
    // Subsequent advances do not change the mesh.
    for (let i = 0; i < 5; i++) animator.advance();
    expect(mesh.rotation.z).toBe(TARGET);
  });

  it("advances independent animations independently", () => {
    const animator = createKnockoutAnimator();
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    animator.start(a, TARGET);
    animator.advance();
    animator.start(b, TARGET);
    // After this sequence: a has 1 advance recorded (so 2 advances
    // worth at next tick), b has just been started.
    expect(a.rotation.z).not.toBe(b.rotation.z);
  });

  it("re-starting an existing animation resets elapsed ticks to 0", () => {
    const animator = createKnockoutAnimator();
    const mesh = new THREE.Object3D();
    animator.start(mesh, TARGET);
    for (let i = 0; i < KNOCKOUT_ANIMATION_TICKS - 2; i++) animator.advance();
    animator.start(mesh, TARGET);
    // Back to the anticipation frame.
    expect(mesh.rotation.z).toBeCloseTo(
      TARGET * KNOCKOUT_ANTICIPATION_FRACTION,
      12,
    );
  });

  it("clear(mesh) drops the animation; subsequent advances do not touch the mesh", () => {
    const animator = createKnockoutAnimator();
    const mesh = new THREE.Object3D();
    animator.start(mesh, TARGET);
    animator.clear(mesh);
    mesh.rotation.z = 0;
    animator.advance();
    expect(mesh.rotation.z).toBe(0);
  });

  it("clearAll() drops every animation", () => {
    const animator = createKnockoutAnimator();
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    animator.start(a, TARGET);
    animator.start(b, TARGET);
    animator.clearAll();
    a.rotation.z = 0;
    b.rotation.z = 0;
    animator.advance();
    expect(a.rotation.z).toBe(0);
    expect(b.rotation.z).toBe(0);
  });

  it("is deterministic: two animators driven with the same sequence produce identical rotations", () => {
    const a = createKnockoutAnimator();
    const b = createKnockoutAnimator();
    const meshA = new THREE.Object3D();
    const meshB = new THREE.Object3D();
    a.start(meshA, TARGET);
    b.start(meshB, TARGET);
    for (let i = 0; i < KNOCKOUT_ANIMATION_TICKS; i++) {
      a.advance();
      b.advance();
      expect(meshA.rotation.z).toBe(meshB.rotation.z);
    }
  });
});
