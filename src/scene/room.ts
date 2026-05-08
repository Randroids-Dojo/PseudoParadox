import * as THREE from "three";
import { createFourDoors } from "./door.ts";

/**
 * Canonical room dimensions for the prototype.
 *
 * The single playable room is fixed for the entire prototype (see
 * docs/gdd/23-prototype-scope.md). Width and depth are the floor footprint
 * in world units; height is the ceiling clearance. These constants are the
 * source of truth that future slices (door placement, camera framing,
 * navmesh) read from.
 */
export const ROOM_DIMENSIONS = {
  width: 10,
  depth: 10,
  height: 4,
} as const;

/**
 * Builds the placeholder room: a floor, four walls, and four doors (one
 * per wall). REQ-027 lands the door meshes; REQ-028 will drive their
 * lit/dark visual state and REQ-001/REQ-005 will wire them to portal
 * traversal.
 */
export function buildRoom(): THREE.Group {
  const group = new THREE.Group();
  group.name = "room";

  const { width, depth, height } = ROOM_DIMENSIONS;
  const wallThickness = 0.2;

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3f47,
    roughness: 0.9,
    metalness: 0.0,
  });
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a5260,
    roughness: 0.85,
    metalness: 0.0,
  });

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width, wallThickness, depth),
    floorMaterial,
  );
  floor.position.y = -wallThickness / 2;
  group.add(floor);

  // Four walls placed flush with the floor footprint.
  const wallNorth = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, wallThickness),
    wallMaterial,
  );
  wallNorth.position.set(0, height / 2, -depth / 2);
  group.add(wallNorth);

  const wallSouth = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, wallThickness),
    wallMaterial,
  );
  wallSouth.position.set(0, height / 2, depth / 2);
  group.add(wallSouth);

  const wallEast = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, height, depth),
    wallMaterial,
  );
  wallEast.position.set(width / 2, height / 2, 0);
  group.add(wallEast);

  const wallWest = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, height, depth),
    wallMaterial,
  );
  wallWest.position.set(-width / 2, height / 2, 0);
  group.add(wallWest);

  // Doors: one per wall, placed at the wall midpoint. Visual-only for now;
  // collisions and portal traversal land in later slices (REQ-001/REQ-005).
  for (const door of createFourDoors(width, depth)) {
    group.add(door.mesh);
  }

  return group;
}
