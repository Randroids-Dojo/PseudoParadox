import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { applyInstanceTint } from "../render/instanceTint.ts";

/**
 * Player capsule dimensions for the prototype (REQ-026).
 *
 * Three.js uses a "capsule" defined by a sphere radius plus a cylindrical
 * length between the two hemisphere caps. Rapier's capsule collider takes
 * a half-height (the cylinder half-length, not including the caps) plus
 * the radius. Both descriptions are kept here so the visual mesh and the
 * physics body align.
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
   * Sets the desired planar (world-XZ) velocity on the body, preserving
   * vertical velocity from gravity. Call this once per fixed physics step
   * (from the physics update loop), not once per render frame, so the
   * target velocity reacts at the simulation rate.
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
   * Normalized time-of-day in [0, 1] used to tint the capsule via
   * `applyInstanceTint`. Defaults to 0 (warm anchor) so callers that do not
   * yet have a `TimeOfDay` clock get a deterministic spawn color.
   */
  originNormalized?: number;
}

/**
 * Builds the player capsule: a Three.js mesh plus a Rapier dynamic rigid
 * body with a capsule collider. Both are placed at world origin (the room
 * center) with the capsule resting on the floor (y = 0).
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

  const geometry = new THREE.CapsuleGeometry(radius, cylinderLength, 8, 16);
  // The starting color is overwritten by `applyInstanceTint` below; the
  // initial value is kept so a future material-property tweak (roughness,
  // metalness) has a well-defined baseline to mutate from.
  const material = new THREE.MeshStandardMaterial({
    color: 0xc4d0e6,
    roughness: 0.6,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "player";
  // REQ-030: stamp the capsule with the warm-to-cool tint at the instance's
  // origin normalized time. For the active player this happens once at
  // spawn; a future portal-traversal slice will re-stamp on travel.
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

  const setPlanarVelocity = (vx: number, vz: number): void => {
    const current = body.linvel();
    body.setLinvel({ x: vx, y: current.y, z: vz }, true);
  };

  const syncMeshFromBody = (): void => {
    const t = body.translation();
    mesh.position.set(t.x, t.y, t.z);
  };

  // Place the mesh at the body's initial pose so the very first render frame
  // does not show the capsule at the origin before the first physics step.
  syncMeshFromBody();

  return {
    mesh,
    body,
    originNormalized,
    setPlanarVelocity,
    syncMeshFromBody,
  };
}
