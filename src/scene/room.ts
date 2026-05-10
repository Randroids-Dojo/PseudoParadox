import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { applyDoorLitState, createFourDoors } from "./door.ts";
import { createActOnePortals } from "../sim/portal.ts";
import type { Portal } from "../sim/portal.ts";
import { ACT_ONE_HOUR } from "../sim/actOneAnchor.ts";
import { doorLitStateAtHour } from "../sim/doorStateAtTime.ts";

/**
 * Floor / wall slab thickness used for both the visual mesh and the
 * static physics colliders. Exported so `createRoomColliders` can size
 * the cuboid colliders against the same constant the meshes use.
 */
export const ROOM_WALL_THICKNESS = 0.2;

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
 * Aggregates the room's scene group and the portal data structures built
 * alongside its doors. The portals are returned so `src/app.ts` can wire
 * runtime systems (overlap detection, traversal) against the same Portal
 * instances that `buildRoom` paints lit/dark on at construction.
 */
export interface RoomBuild {
  group: THREE.Group;
  portals: readonly Portal[];
}

/**
 * Builds the placeholder room: a floor, four walls, and four doors (one
 * per wall). REQ-027 lands the door meshes; REQ-028 will drive their
 * lit/dark visual state and REQ-001/REQ-005 will wire them to portal
 * traversal.
 */
export function buildRoom(): RoomBuild {
  const group = new THREE.Group();
  group.name = "room";

  const { width, depth, height } = ROOM_DIMENSIONS;
  const wallThickness = ROOM_WALL_THICKNESS;

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3f47,
    roughness: 0.9,
    metalness: 0.0,
  });
  // Walls render BackSide so the camera-facing walls do not occlude the
  // dollhouse view. BoxGeometry normals point outward; rendering only the
  // back faces means each wall is visible from inside the room and
  // invisible from outside, producing the mi-casa-style cutaway where the
  // two far walls form the visible backdrop and the two near walls drop
  // out so the floor and doors are unobstructed.
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a5260,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.BackSide,
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
  // Each door is paired with a Portal carrying its fixed destination time
  // (REQ-005). The lit/dark VISUAL state is sourced from
  // `doorLitStateAtHour(ACT_ONE_HOUR)` (REQ-013/REQ-014): the canonical
  // 5:00 table lights South and East and leaves North and West dark. The
  // portal's own `isLit` flag still feeds the runtime traversal predicate;
  // both views agree because `ACT_ONE_PORTAL_SPECS` and
  // `DOOR_STATE_BY_HOUR[5]` both encode the same GDD truth. REQ-011 will
  // collapse the two sources into one timeline-derived computation.
  const doors = createFourDoors(width, depth);
  for (const door of doors) {
    group.add(door.mesh);
  }
  const portals = createActOnePortals(doors);
  const litByDirection = doorLitStateAtHour(ACT_ONE_HOUR);
  for (const door of doors) {
    applyDoorLitState(door, litByDirection[door.direction]);
  }

  return { group, portals };
}

/**
 * Half-extent of the static floor collider along world X and Z. Sized
 * far larger than the room footprint so the player capsule cannot walk
 * off the edge and fall, even after passing through a dark-door gap or
 * the visual wall mesh (walls are visual-only this slice). The room
 * itself is still 10x10; the extra apron is invisible because the
 * collider has no mesh.
 */
const FLOOR_COLLIDER_HALF_EXTENT = 50;

/**
 * Spawns the static floor collider so the dynamic player capsule has
 * something to stand on. Without this the body falls under gravity the
 * moment the simulation starts. Wall colliders are intentionally NOT
 * created in this slice: with door-shaped gaps the player would escape
 * through dark doors, and with solid walls the portal trigger volumes
 * (centered on the inner wall face) would sit out of reach behind the
 * collider. The wider floor means leaving the visual room footprint
 * costs the player nothing worse than a confused walk in empty space.
 */
export function createRoomColliders(world: RAPIER.World): void {
  const thickness = ROOM_WALL_THICKNESS;

  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      FLOOR_COLLIDER_HALF_EXTENT,
      thickness / 2,
      FLOOR_COLLIDER_HALF_EXTENT,
    ).setTranslation(0, -thickness / 2, 0),
    floorBody,
  );
}
