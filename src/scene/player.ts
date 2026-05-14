import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { applyInstanceTint } from "../render/instanceTint.ts";
import { createAstronautMesh } from "./astronaut.ts";
import { INITIAL_INSTANCE_ID, type InstanceId } from "../sim/instanceId.ts";
import {
  INITIAL_CONSCIOUSNESS,
  type Consciousness,
} from "../sim/knockoutState.ts";
import {
  INITIAL_CARRY_STATE,
  applyCarrySpeedScaling,
  type CarryState,
} from "../sim/carryState.ts";

/**
 * Player capsule dimensions for the prototype (REQ-026).
 *
 * Three.js uses a "capsule" defined by a sphere radius plus a cylindrical
 * length between the two hemisphere caps. Rapier's capsule collider takes
 * a half-height (the cylinder half-length, not including the caps) plus
 * the radius. Both descriptions are kept here so the astronaut body and the
 * physics collider align.
 */
export const PLAYER_CAPSULE = {
  radius: 0.4,
  // Cylindrical length between the two hemispherical caps.
  cylinderLength: 1.0,
} as const;

/**
 * Total height of the capsule (cap + cylinder + cap). Useful for placing
 * the body so its base sits on the floor.
 */
export const PLAYER_CAPSULE_TOTAL_HEIGHT =
  PLAYER_CAPSULE.cylinderLength + PLAYER_CAPSULE.radius * 2;

export interface Player {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  /**
   * Normalized time-of-day in [0, 1] representing the moment this instance
   * last traveled (or, for the active player, the moment it spawned). REQ-030
   * uses this to drive the per-instance warm-to-cool tint. Recorded for
   * future ghost-replay slices that want to re-stamp on portal traversal.
   */
  originNormalized: number;
  /**
   * Generation index for the active player (REQ-007). Starts at
   * `INITIAL_INSTANCE_ID = 1` (You1, the first-ever spawn) and increments by
   * one on every lit-portal traversal so "the player always controls the most
   * recently spawned active instance" (REQ-008). Hard reset (REQ-025) returns
   * this to `INITIAL_INSTANCE_ID`. The label is data only this slice; the UI
   * overlay lands with REQ-032.
   */
  instanceId: InstanceId;
  /**
   * Two-state consciousness flag (REQ-033 partial). The active player opens
   * at `'conscious'`. A landed punch from another instance flips this to
   * `'unconscious'`. While unconscious, the host (`src/app.ts`) suppresses
   * keyboard input before the per-tick punch resolver and before the
   * planar velocity write, so the body stops moving and stops punching.
   * Visual body response (bump impulse, damping reduction, rotation lock
   * relaxation) lands in the next slice. Hard reset returns this to
   * `'conscious'` (`src/sim/hardReset.ts`).
   */
  consciousness: Consciousness;
  /**
   * Pickup-and-carry state (REQ-034). The active player opens at
   * `'idle'`. Toggling pickup with an unconscious body in range
   * transitions to `'carrying'`; toggling again drops. Mutated by the
   * host's per-tick carry resolver in `src/app.ts`. Hard reset returns
   * this to `'idle'` (`src/sim/hardReset.ts`).
   */
  carry: CarryState;
  /**
   * Sets the desired planar (world-XZ) velocity on the body, preserving
   * vertical velocity from gravity. Call this once per fixed physics step
   * (from the physics update loop), not once per render frame, so the
   * target velocity reacts at the simulation rate.
   *
   * The setter applies `applyCarrySpeedScaling` against the player's
   * current `carry` state before writing to Rapier (REQ-034 / Q-005):
   * while carrying, the input velocity is multiplied by
   * `CARRY_SPEED_MULTIPLIER = 0.6` so the carrier visibly slows down.
   * Idle state passes the velocity through unchanged. The host's
   * `inputToVelocity` call site does NOT need to know about carry
   * state; the scaling is encapsulated here.
   */
  setPlanarVelocity: (vx: number, vz: number) => void;
  /**
   * Copies the body's translation onto the mesh. Call once per render frame
   * AFTER physics integration so the visual reflects the latest pose.
   */
  syncMeshFromBody: () => void;
}

export interface CreatePlayerOptions {
  /**
   * Normalized time-of-day in [0, 1] used to tint the astronaut body via
   * `applyInstanceTint`. Defaults to 0 (warm anchor) so callers that do not
   * yet have a `TimeOfDay` clock get a deterministic spawn color.
   */
  originNormalized?: number;
}

/**
 * Builds the player astronaut mesh plus a Rapier dynamic rigid body with a
 * capsule collider. Both are placed at world origin (the room center) with
 * the collider resting on the floor (y = 0).
 *
 * The slice intentionally does not handle:
 *   - camera follow (camera is fixed for the prototype scope)
 *   - heading rotation (movement is world-axis-aligned)
 *   - door collisions (REQ-027 lands the door geometry)
 */
export function createPlayer(
  scene: THREE.Scene,
  world: RAPIER.World,
  options: CreatePlayerOptions = {},
): Player {
  const { radius, cylinderLength } = PLAYER_CAPSULE;
  const originNormalized = options.originNormalized ?? 0;

  const mesh = createAstronautMesh({ radius, cylinderLength, name: "player" });
  // REQ-030: stamp the parent body with the warm-to-cool tint at the
  // instance's origin normalized time. For the active player this happens
  // once at spawn; a future portal-traversal slice will re-stamp on travel.
  applyInstanceTint(mesh, originNormalized);
  scene.add(mesh);

  // Capsule center y so the base of the lower hemisphere just touches y=0.
  const restY = cylinderLength / 2 + radius;

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, restY, 0)
    // Locking pitch and roll keeps the capsule upright without tuning a
    // separate damping system. Yaw stays free in case future slices add a
    // heading rotation; for now the input layer ignores it.
    .enabledRotations(false, true, false)
    .setLinearDamping(8.0);

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.capsule(
    cylinderLength / 2,
    radius,
  ).setFriction(0.5);
  world.createCollider(colliderDesc, body);

  // REQ-034: per-active-player carry state. Mutable behind a getter /
  // setter on the returned object so the host can flip `idle` <-> `carrying`
  // and `setPlanarVelocity` reads the current value through the closure
  // (the speed-multiplier path stays encapsulated in this module). Hard
  // reset returns this to `INITIAL_CARRY_STATE` by writing through the
  // setter.
  let carry: CarryState = INITIAL_CARRY_STATE;

  const setPlanarVelocity = (vx: number, vz: number): void => {
    // REQ-034 / Q-005: scale the input velocity by `CARRY_SPEED_MULTIPLIER`
    // when carrying. Idle passes through unchanged. The scaling is applied
    // here so every call site (input-driven, replay-driven, future
    // facing-aware) gets the slowdown for free.
    const scaled = applyCarrySpeedScaling(carry, { x: vx, z: vz });
    const current = body.linvel();
    body.setLinvel({ x: scaled.x, y: current.y, z: scaled.z }, true);
  };

  const syncMeshFromBody = (): void => {
    const t = body.translation();
    mesh.position.set(t.x, t.y, t.z);
  };

  // Place the mesh at the body's initial pose so the very first render frame
  // does not show the astronaut at the origin before the first physics step.
  syncMeshFromBody();

  return {
    mesh,
    body,
    originNormalized,
    // The active player always opens at `INITIAL_INSTANCE_ID = 1` (You1, the
    // GDD's first-ever spawn). Subsequent lit-portal traversals advance this
    // by one in `wireTraversal`; hard reset returns it to the seed.
    instanceId: INITIAL_INSTANCE_ID,
    // REQ-033 partial: every freshly-spawned player opens conscious. The
    // flag is mutated by the punch resolver in `src/app.ts` and reset to
    // `'conscious'` by `hardReset`.
    consciousness: INITIAL_CONSCIOUSNESS,
    get carry(): CarryState {
      return carry;
    },
    set carry(next: CarryState) {
      carry = next;
    },
    setPlanarVelocity,
    syncMeshFromBody,
  };
}
