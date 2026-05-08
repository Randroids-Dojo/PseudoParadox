import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Floor ring visual constants (REQ-031).
 *
 * The ring is the prototype's SOLE non-diegetic UI element. It sits just
 * above the floor, underneath the active player, and tracks the player's
 * planar position each render frame so the operator can read which capsule
 * they currently control. The GDD asks for "subtle"; that translates to a
 * single-tone neutral color, low opacity, no glow, no pulse, no animation.
 *
 * Sizing is keyed off the player capsule radius so a future capsule resize
 * does not silently desynchronize the ring footprint from the body.
 */
export const FLOOR_RING_INNER_RADIUS = 0.5;
export const FLOOR_RING_OUTER_RADIUS = 0.7;

/**
 * Vertical offset above the floor surface (y = 0). Picked to clear the
 * floor box's top face by a wider margin than typical Three.js z-fighting
 * tolerance at the prototype camera distance, while still reading as
 * "on the floor" rather than floating.
 */
export const FLOOR_RING_Y_OFFSET = 0.01;

/** Subtle white at low alpha. No glow, no pulse, no animation. */
export const FLOOR_RING_COLOR_HEX = 0xffffff;
export const FLOOR_RING_OPACITY = 0.25;

/**
 * Builds the active-player floor ring mesh.
 *
 * Returned as a plain `THREE.Mesh` (not a wrapper object) because the only
 * per-frame mutation the prototype needs is positional, and `mesh.position`
 * is already a stable Three.js handle. Future deepening (e.g. ring tracks
 * the most-recently-spawned active instance after a portal traversal) can
 * change the binding without changing the geometry contract.
 *
 * The ring is rotated flat onto the XZ plane (RingGeometry is authored on
 * the XY plane) and uses `DoubleSide` so an off-axis camera tilt cannot
 * cause it to disappear when viewed from below.
 */
export function createFloorRing(): THREE.Mesh {
  const geometry = new THREE.RingGeometry(
    FLOOR_RING_INNER_RADIUS,
    FLOOR_RING_OUTER_RADIUS,
    48,
  );
  const material = new THREE.MeshBasicMaterial({
    color: FLOOR_RING_COLOR_HEX,
    transparent: true,
    opacity: FLOOR_RING_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "floor-ring";
  // RingGeometry is authored on the XY plane; rotate -90deg about X so the
  // ring lies flat on the XZ floor plane.
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = FLOOR_RING_Y_OFFSET;
  return mesh;
}

/**
 * Snaps the ring's planar (XZ) position to the active player body's
 * translation. The ring's y stays pinned to `FLOOR_RING_Y_OFFSET` so a
 * jumping or falling player does not drag the ring off the floor.
 *
 * Pure with respect to the body (read-only) and keeps the mesh's rotation
 * untouched, so the caller can call this every render frame without
 * accumulating side effects.
 */
export function updateFloorRing(
  ring: THREE.Mesh,
  body: RAPIER.RigidBody,
): void {
  const t = body.translation();
  ring.position.set(t.x, FLOOR_RING_Y_OFFSET, t.z);
}
