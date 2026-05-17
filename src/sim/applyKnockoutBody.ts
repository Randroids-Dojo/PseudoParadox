/**
 * Knockout body response (REQ-033 finishing pass).
 *
 * The state half lives in `src/sim/knockoutState.ts`: a flip from
 * `'conscious'` to `'unconscious'`. This module ships the visible,
 * physical side: a one-shot bump impulse, a damping reduction so the
 * body slides instead of sticking, and a visual mesh tilt so the
 * capsule reads as "knocked over."
 *
 * Combat tone (`docs/gdd/30-combat-and-interaction.md` section 3):
 * "pure ragdoll physics. No glow flash, no screen effect. Physically
 * readable, slightly absurd, tonally consistent." The prototype uses a
 * single capsule body per instance, not a jointed ragdoll, so we
 * approximate the feel with three ingredients:
 *
 *   1. A small impulse along the punch direction plus a small upward
 *      bump, so the recipient visibly tips and slides.
 *   2. Linear damping drops aggressively so the body keeps moving for a
 *      moment before settling under gravity and friction.
 *   3. The visual mesh rotates to lie on its side. The Rapier body
 *      itself stays upright, so collisions remain capsule-shaped and
 *      door / wall interactions are unchanged. This seam is documented:
 *      the body is upright in physics, the mesh reads tipped over.
 *
 * Recovery: there is NO recovery in v1 (`docs/gdd/30-combat-and-interaction.md`
 * section 4: "The reverse transition does NOT exist in the prototype
 * scope"). Once unconscious, the capsule stays tilted until it is
 * picked up (REQ-034) or hard reset (REQ-025) is fired. Hard reset
 * clears the tilt and restores damping (`clearKnockoutBodyResponse`).
 *
 * Determinism: the impulse direction comes from the punch resolver, the
 * magnitude is a fixed module constant, and the mesh tilt is a fixed
 * Euler rotation. Calling the response a second time on a body that
 * has already received it is a no-op (idempotence is enforced by the
 * caller via the `'conscious' -> 'unconscious'` state transition; once
 * the flag flips, the resolver does not re-target the body, so the
 * response only fires once per knockout).
 *
 * Pure helper exports:
 *   - `knockoutBodyResponse(direction)`: returns the impulse vector and
 *     mesh rotation given an incoming horizontal punch direction. Does
 *     not touch any Rapier or Three.js state.
 *
 * Side-effecting exports:
 *   - `applyKnockoutBodyResponse(body, mesh, direction)`: applies the
 *     response to a Rapier body and a Three.js mesh.
 *   - `clearKnockoutBodyResponse(body, mesh)`: undo path used by hard
 *     reset.
 *
 * NOT in scope this slice:
 *   - Audio, particle FX, screen shake.
 *   - Carrier release on knockout (REQ-034 edge case).
 *   - Rapier rotation-lock relaxation. The mesh tilts visually; the
 *     body stays upright per the seam documented above.
 */

import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";

/**
 * Bump impulse magnitude along the incoming punch direction (planar XZ).
 * Default: 6 m/s of velocity-equivalent impulse.
 *
 * The default body mass for a Rapier dynamic capsule of the prototype's
 * dimensions is approximately 1 kg, so a 6 N-s impulse produces ~6 m/s
 * planar velocity at the moment of knockout. This is large enough that
 * the body visibly slides for a beat before damping settles it. See
 * `docs/gdd/30-combat-and-interaction.md` section 4.
 */
export const KNOCKOUT_IMPULSE_N = 6;

/**
 * Vertical bump impulse so the body lifts off the ground briefly and
 * tips, rather than purely sliding. Default: 2 N-s.
 */
export const KNOCKOUT_UP_IMPULSE_N = 2;

/**
 * Linear damping for an unconscious body. The active damping value is
 * 8.0 (locked to the player capsule for tight-feeling input response).
 * Reducing to 0.5 lets the post-impulse velocity dissipate over half a
 * second or so rather than a single tick. See dossier section 4.
 */
export const UNCONSCIOUS_LINEAR_DAMPING = 0.5;

/**
 * Active-state damping. Restored by `clearKnockoutBodyResponse` so a
 * hard reset returns the body to its conscious response curve. Mirrors
 * the literal `8.0` set in `createPlayer` and `createGhost`.
 */
export const ACTIVE_LINEAR_DAMPING = 8.0;

/**
 * Visual tilt applied to the mesh on knockout. Rotating the mesh's
 * local Z axis by `Math.PI / 2` lays the capsule on its side, which
 * reads as "knocked over." The body itself is not rotated; only the
 * mesh's `rotation.z` is modified.
 */
export const KNOCKOUT_MESH_TILT_Z = Math.PI / 2;

/**
 * Fallback direction used when the punch direction is the zero vector
 * (overlapping capsules at the moment of impact). World +X is chosen
 * deterministically so test fixtures can pin the behavior.
 */
export const KNOCKOUT_FALLBACK_DIRECTION: PlanarDirection = {
  x: 1,
  z: 0,
};

/** Planar XZ direction supplied by the punch resolver. */
export interface PlanarDirection {
  readonly x: number;
  readonly z: number;
}

/** The impulse vector and mesh rotation that the response applies. */
export interface KnockoutBodyResponse {
  readonly impulse: { readonly x: number; readonly y: number; readonly z: number };
  readonly meshRotationZ: number;
}

/**
 * Pure helper: given an incoming horizontal punch direction, return the
 * impulse vector plus the mesh tilt that the body response will apply.
 * The direction is normalized inside the helper, so callers can pass an
 * unnormalized recipient-minus-puncher vector.
 *
 * Zero-vector input falls back to `KNOCKOUT_FALLBACK_DIRECTION` (overlapping
 * capsules at the moment of impact). The fallback is deterministic so
 * tests can pin it.
 */
export function knockoutBodyResponse(
  direction: PlanarDirection,
): KnockoutBodyResponse {
  const lenSq = direction.x * direction.x + direction.z * direction.z;
  let nx: number;
  let nz: number;
  if (lenSq <= 1e-12) {
    nx = KNOCKOUT_FALLBACK_DIRECTION.x;
    nz = KNOCKOUT_FALLBACK_DIRECTION.z;
  } else {
    const len = Math.sqrt(lenSq);
    nx = direction.x / len;
    nz = direction.z / len;
  }
  return {
    impulse: {
      x: nx * KNOCKOUT_IMPULSE_N,
      y: KNOCKOUT_UP_IMPULSE_N,
      z: nz * KNOCKOUT_IMPULSE_N,
    },
    meshRotationZ: KNOCKOUT_MESH_TILT_Z,
  };
}

/**
 * Minimal subset of `RAPIER.RigidBody` the response touches. Mirrors the
 * structural-handle pattern used elsewhere in this codebase so tests can
 * pass a stub.
 */
export interface KnockoutBodyHandle {
  applyImpulse: RAPIER.RigidBody["applyImpulse"];
  setLinearDamping: RAPIER.RigidBody["setLinearDamping"];
}

/**
 * Apply the knockout body response to a Rapier body and a Three.js
 * mesh. This is the side-effecting entry point used by the host on a
 * `'conscious' -> 'unconscious'` transition. Idempotence is the caller's
 * responsibility (the punch resolver filters unconscious targets out of
 * the candidate set, so the function is only invoked once per knockout
 * per body).
 */
export function applyKnockoutBodyResponse(
  body: KnockoutBodyHandle,
  mesh: THREE.Object3D,
  direction: PlanarDirection,
): void {
  const response = knockoutBodyResponse(direction);
  body.applyImpulse(response.impulse, true);
  body.setLinearDamping(UNCONSCIOUS_LINEAR_DAMPING);
  // Skip the 90-degree mesh-level tilt when the figurine has its own
  // skeletal `die` clip (parked on `userData.characterAnimator` by
  // `createAstronautMesh`). The GLB clip animates the slump for real;
  // applying the tilt on top of it would double-rotate the body. The
  // procedural-capsule fallback has no die clip, so the tilt still
  // ships there.
  if (mesh.userData.characterAnimator === undefined) {
    mesh.rotation.z = response.meshRotationZ;
  }
}

/**
 * Clear the knockout body response: restore the active damping value
 * and snap the mesh's z-rotation back to identity. Used by hard reset
 * (`src/sim/hardReset.ts`) so the player walks out of the reset upright
 * with the conscious response curve. Total and idempotent: calling this
 * on a body that never received a knockout response is a no-op.
 */
export function clearKnockoutBodyResponse(
  body: KnockoutBodyHandle,
  mesh: THREE.Object3D,
): void {
  body.setLinearDamping(ACTIVE_LINEAR_DAMPING);
  mesh.rotation.z = 0;
}
