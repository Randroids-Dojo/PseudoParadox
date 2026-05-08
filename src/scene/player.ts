import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

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
export function createPlayer(scene: THREE.Scene, world: RAPIER.World): Player {
  const { radius, cylinderLength } = PLAYER_CAPSULE;

  const geometry = new THREE.CapsuleGeometry(radius, cylinderLength, 8, 16);
  const material = new THREE.MeshStandardMaterial({
    color: 0xc4d0e6,
    roughness: 0.6,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "player";
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

  return { mesh, body, setPlanarVelocity, syncMeshFromBody };
}
