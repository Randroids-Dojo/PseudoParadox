/**
 * Side-effecting carry attachment (REQ-034).
 *
 * The pure half (state, helpers, constants) lives in `src/sim/carryState.ts`.
 * This module ships the Rapier and Three.js mutations that turn a
 * `'carrying'` state into observable behavior:
 *
 *   - Pickup transition (idle -> carrying):
 *     * Flip the carried body to `KinematicPositionBased` so its
 *       translation is driven by the host writing the carrier's pose
 *       each tick rather than by the integrator. Per Q-006 default, the
 *       kinematic flip plus the host-driven attachment together replace
 *       the dynamic integration of the carried body for the carry's
 *       duration.
 *     * Zero linear velocity at the moment of pickup so any residual
 *       slide from a previous knockout impulse does not carry into the
 *       attached pose.
 *
 *   - Carrying tick (per fixed step):
 *     * Write `carrier.translation + CARRY_OFFSET` onto the carried
 *       body via `setNextKinematicTranslation` so Rapier interpolates
 *       the kinematic motion correctly across the next world step.
 *
 *   - Drop transition (carrying -> idle):
 *     * Flip the carried body back to `Dynamic` so gravity, collisions,
 *       and damping all resume.
 *     * Zero linear velocity so the body falls from the drop position
 *       under gravity rather than continuing the carrier's last delta.
 *     * Reset the dropped body's translation onto the floor at the
 *       carrier's planar position (preserving the carrier's y so the
 *       capsule's base sits on the floor naturally per the pre-pickup
 *       resting height stored in `floorRestingY`).
 *     * Preserve the unconscious mesh tilt: the body stays unconscious
 *       on drop, so its mesh rotation is left untouched.
 *
 * Determinism: all three transitions are total functions of the input
 * state; identical inputs produce identical Rapier and Three.js
 * mutations. The host's pickup-toggle resolver in `app.ts` produces the
 * same transitions on replay (because the recorded pickup flag flows
 * through the same edge-detection path), so a recorded carry replays
 * frame-exactly.
 *
 * NOT in scope this module:
 *   - Throw (REQ-036): drop-on-throw shares the drop transition, but
 *     applies an impulse along the thrower's facing afterward. Lands
 *     in the next slice.
 *   - Collision-group exclusion (Q-006 belt). The kinematic flip alone
 *     prevents the dynamic-vs-dynamic integrator fight; the
 *     kinematic-vs-dynamic pair never integrates against each other.
 *     The dossier's "belt and suspenders" pairing of an excluded group
 *     is documented as a future tightening; the current slice ships
 *     only the kinematic flip (Q-006 default suspenders without belt).
 */

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { CARRY_OFFSET, type CarryState } from "./carryState.ts";

/**
 * Minimal subset of `RAPIER.RigidBody` the carry layer mutates. Mirrors
 * the structural-handle pattern used in `applyKnockoutBody.ts` so tests
 * can pass a stub.
 */
export interface CarryBodyHandle {
  setBodyType: RAPIER.RigidBody["setBodyType"];
  setLinvel: RAPIER.RigidBody["setLinvel"];
  setNextKinematicTranslation: RAPIER.RigidBody["setNextKinematicTranslation"];
  setTranslation: RAPIER.RigidBody["setTranslation"];
  translation: RAPIER.RigidBody["translation"];
}

/**
 * Apply the pickup transition to a carried body. Flips to kinematic and
 * zeroes linear velocity so the body stops drifting under any residual
 * impulse from the prior knockout.
 *
 * Total and idempotent on the body's observable state: calling this on a
 * body that is already `KinematicPositionBased` with zero velocity
 * produces no change. The host gates the call on a state TRANSITION
 * (idle -> carrying) so this only fires on the rising edge of carry.
 */
export function applyCarryPickup(body: CarryBodyHandle): void {
  body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
}

/**
 * Per-tick carry attachment: write the carrier's planar translation plus
 * `CARRY_OFFSET` onto the carried body's next kinematic translation.
 * Y is the carrier's y plus `CARRY_OFFSET.y` so the body rides above the
 * carrier's head; X and Z mirror the carrier's exactly.
 *
 * Uses `setNextKinematicTranslation` so Rapier interpolates motion
 * correctly through the next world step (the body's velocity at the
 * destination tick is implicit from the delta; queries against the body
 * during the step see the smoothed motion).
 */
export function applyCarryAttachment(
  carrier: { translation: () => { x: number; y: number; z: number } },
  carriedBody: CarryBodyHandle,
): void {
  const t = carrier.translation();
  carriedBody.setNextKinematicTranslation({
    x: t.x + CARRY_OFFSET.x,
    y: t.y + CARRY_OFFSET.y,
    z: t.z + CARRY_OFFSET.z,
  });
}

/**
 * Apply the drop transition to the carried body. Flips back to dynamic,
 * zeroes linear velocity, and snaps the translation onto the floor at
 * the carrier's planar position with the supplied `restingY` (the
 * capsule's natural rest height; the host computes this from
 * `cylinderLength / 2 + radius`).
 *
 * Mesh rotation is intentionally NOT touched: the body remains
 * unconscious on drop (the dossier forbids the reverse transition), so
 * the knockout tilt stays in place.
 */
export function applyCarryDrop(
  carrierBody: { translation: () => { x: number; y: number; z: number } },
  carriedBody: CarryBodyHandle,
  restingY: number,
): void {
  const carrier = carrierBody.translation();
  carriedBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  carriedBody.setTranslation({ x: carrier.x, y: restingY, z: carrier.z }, true);
  carriedBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
}

/**
 * Pure helper: derive the (previous, next) carry transition kind from
 * two `CarryState` values. The host uses this to decide whether to fire
 * the pickup, drop, or no-op side effects when the toggle resolver
 * produces a new state.
 */
export type CarryTransition = "pickup" | "drop" | "none";

export function carryTransitionKind(
  previous: CarryState,
  next: CarryState,
): CarryTransition {
  if (previous.kind === "idle" && next.kind === "carrying") return "pickup";
  if (previous.kind === "carrying" && next.kind === "idle") return "drop";
  return "none";
}

/**
 * Mesh attachment helper for visual sync. The carry-system's per-tick
 * attachment writes onto the Rapier body via
 * `setNextKinematicTranslation`; the mesh follows because the host's
 * existing `syncMeshFromBody` call reads the body's translation at the
 * end of the frame. This helper exists for callers that want to snap
 * the mesh immediately on the pickup transition (so the carried body
 * does not flicker at its previous position for a single frame between
 * the pickup tick and the next render). Total: callers may skip it if
 * the per-frame sync is sufficient.
 */
export function snapCarriedMeshAbove(
  carrierMesh: THREE.Object3D,
  carriedMesh: THREE.Object3D,
): void {
  carriedMesh.position.set(
    carrierMesh.position.x + CARRY_OFFSET.x,
    carrierMesh.position.y + CARRY_OFFSET.y,
    carrierMesh.position.z + CARRY_OFFSET.z,
  );
}
