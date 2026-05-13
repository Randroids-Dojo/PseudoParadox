/**
 * Per-tick knockout mesh-tilt animation (F-020).
 *
 * The 2026-05-12 fun-factor audit flagged that the knockout response
 * snaps `mesh.rotation.z` from 0 to ±pi/2 in a single tick, which
 * reads as weightless. The fix is a deterministic per-tick ease over
 * ~200 ms (12 fixed steps at 60 Hz) with:
 *
 *   - a small anticipation crouch on tick 0 (reverse rotation, the
 *     "wind up before the fall"),
 *   - a cubic ease-out from tick 0 toward the target rotation,
 *   - a damped overshoot so the body visibly settles instead of
 *     locking on impact,
 *   - and a snap to the exact target on the final tick so the
 *     animation always ends at the canonical pose.
 *
 * The animator owns a small list of in-flight animations. Each entry
 * tracks the mesh reference, the target rotation, and an integer
 * elapsed-ticks counter. `advance()` walks the list once per fixed
 * step, writing the eased value per mesh and removing finished
 * entries. `start(mesh, target)` registers a new animation, or
 * restarts an existing one when the same mesh is re-knocked-out (the
 * latter is impossible today per the punch resolver's idempotence,
 * but the API stays total).
 *
 * Determinism: the eased value is a pure integer-tick function of
 * `elapsedTicks / KNOCKOUT_ANIMATION_TICKS`. Same recording, same
 * tick sequence, same rotation trajectory.
 */

import type * as THREE from "three";

/**
 * Animation length in fixed steps. 12 ticks at 60 Hz = 200 ms. Long
 * enough to read as "the body falls" without delaying the next
 * action the player takes.
 */
export const KNOCKOUT_ANIMATION_TICKS = 12;

/**
 * Anticipation fraction at tick 0. The mesh starts at this multiple
 * of the target rotation, which is a small reverse tilt (-6% of
 * target) so the body visibly winds up before tipping. The negative
 * sign is what produces the "crouch" feel for a capsule.
 */
export const KNOCKOUT_ANTICIPATION_FRACTION = -0.06;

/**
 * Back-easing coefficient. Standard easeOutBack curve uses
 * c1 = 1.70158, c3 = c1 + 1, producing a peak overshoot of ~10%
 * above the target between t = 0.6 and t = 0.85 before settling
 * exactly at 1. Higher values push the overshoot higher.
 */
export const KNOCKOUT_BACK_EASE_C1 = 1.70158;

/**
 * Pure helper: return the rotation multiplier at `elapsedTicks` of a
 * `KNOCKOUT_ANIMATION_TICKS`-long animation. The host applies the
 * returned value as `target * multiplier`. Exposed for unit tests
 * and for callers who want to drive the curve from outside the
 * animator handle.
 *
 *   - `elapsedTicks <= 0`: returns `KNOCKOUT_ANTICIPATION_FRACTION`
 *     (the wind-up; the multiplier is negative so the mesh tilts a
 *     small amount in the opposite direction before falling).
 *   - `elapsedTicks >= KNOCKOUT_ANIMATION_TICKS`: returns 1.0
 *     (settled at target).
 *   - In between: an easeOutBack curve from tick 1 onward so the
 *     body launches out of anticipation, overshoots ~10% past the
 *     target around mid-animation, and settles exactly at 1.
 */
export function knockoutTiltMultiplier(elapsedTicks: number): number {
  if (elapsedTicks <= 0) return KNOCKOUT_ANTICIPATION_FRACTION;
  if (elapsedTicks >= KNOCKOUT_ANIMATION_TICKS) return 1.0;
  // Map ticks 1..N to t in [0, 1] so the back-ease covers the full
  // post-anticipation arc.
  const span = KNOCKOUT_ANIMATION_TICKS - 1;
  const t = (elapsedTicks - 1) / span;
  const c1 = KNOCKOUT_BACK_EASE_C1;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

interface KnockoutAnimation {
  mesh: THREE.Object3D;
  targetRotationZ: number;
  elapsedTicks: number;
}

export interface KnockoutAnimator {
  /**
   * Register a new animation for `mesh` toward `targetRotationZ`.
   * If the mesh is already animating, the existing entry is reset
   * (elapsedTicks back to 0, new target captured) rather than
   * stacking. The first frame is rendered the next time `advance`
   * is called.
   */
  start: (mesh: THREE.Object3D, targetRotationZ: number) => void;
  /**
   * Advance every active animation by one fixed step. Writes the
   * eased `mesh.rotation.z` value per entry and removes entries
   * that have reached the target.
   */
  advance: () => void;
  /**
   * Drop any animation registered for `mesh`. Used by hard reset
   * so the post-reset mesh does not have a stale animation
   * overriding its identity rotation.
   */
  clear: (mesh: THREE.Object3D) => void;
  /**
   * Drop every animation. Idempotent. Used by hard reset.
   */
  clearAll: () => void;
}

/**
 * Build a fresh animator. Each animator owns its own list, so
 * separate animators do not interfere; a host typically creates one.
 */
export function createKnockoutAnimator(): KnockoutAnimator {
  const animations: KnockoutAnimation[] = [];

  const findIndex = (mesh: THREE.Object3D): number =>
    animations.findIndex((a) => a.mesh === mesh);

  const writeForEntry = (entry: KnockoutAnimation): void => {
    const m = knockoutTiltMultiplier(entry.elapsedTicks);
    entry.mesh.rotation.z = entry.targetRotationZ * m;
  };

  const start: KnockoutAnimator["start"] = (mesh, targetRotationZ) => {
    const existing = findIndex(mesh);
    if (existing >= 0) {
      animations[existing].targetRotationZ = targetRotationZ;
      animations[existing].elapsedTicks = 0;
    } else {
      animations.push({ mesh, targetRotationZ, elapsedTicks: 0 });
    }
    // Write tick 0 immediately so the first visual frame of the
    // knockout shows the anticipation crouch rather than whatever
    // rotation the mesh held a moment earlier.
    writeForEntry(animations[existing >= 0 ? existing : animations.length - 1]);
  };

  const advance: KnockoutAnimator["advance"] = () => {
    for (let i = animations.length - 1; i >= 0; i--) {
      const entry = animations[i];
      entry.elapsedTicks += 1;
      writeForEntry(entry);
      if (entry.elapsedTicks >= KNOCKOUT_ANIMATION_TICKS) {
        // Snap to the exact target so the mesh ends at the canonical
        // pose regardless of any overshoot residual.
        entry.mesh.rotation.z = entry.targetRotationZ;
        animations.splice(i, 1);
      }
    }
  };

  const clear: KnockoutAnimator["clear"] = (mesh) => {
    const idx = findIndex(mesh);
    if (idx >= 0) animations.splice(idx, 1);
  };

  const clearAll: KnockoutAnimator["clearAll"] = () => {
    animations.length = 0;
  };

  return { start, advance, clear, clearAll };
}
