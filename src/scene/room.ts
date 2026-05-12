import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createFourDoors } from "./door.ts";
import { createActOnePortals } from "../sim/portal.ts";
import type { Portal } from "../sim/portal.ts";
import { ACT_ONE_HOUR } from "../sim/actOneAnchor.ts";
import { repaintDoorsForHour } from "../sim/timelineRoom.ts";

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
  // (REQ-005). The lit/dark VISUAL state runs through
  // `repaintDoorsForHour` (REQ-013/REQ-014, F-006): the same code path
  // the per-traversal repaint and hard reset use. At boot no ghosts
  // exist yet (the registry has not been built), so the default empty
  // ghost list yields the seed answer for 5:00 (South lit, East lit,
  // North dark, West dark).
  const doors = createFourDoors(width, depth);
  for (const door of doors) {
    group.add(door.mesh);
  }
  const portals = createActOnePortals(doors);
  repaintDoorsForHour(portals, ACT_ONE_HOUR);

  return { group, portals };
}

/**
 * Spawns the static physics colliders that make the room a solid play
 * volume: a floor the player capsule rests on plus four solid walls
 * that contain the capsule. Solid walls also stop the player from
 * walking through dark doors (which are not enterable per REQ-010) or
 * out into the void.
 *
 * The portal trigger volumes are sized to overlap the band of player-
 * center positions reachable when the capsule is pressed against a
 * wall: with `wallThickness = 0.2` and `PORTAL_TRIGGER_DEPTH = 0.6`,
 * the trigger zone for a north door covers `z in [-4.94, -4.34]` and a
 * 0.4-radius capsule pressed against the wall sits at center
 * `z = -4.5`, which is inside the trigger. So solid walls and the
 * existing trigger geometry coexist without changing the trigger
 * shape.
 */
export function createRoomColliders(world: RAPIER.World): void {
  const { width, depth, height } = ROOM_DIMENSIONS;
  const thickness = ROOM_WALL_THICKNESS;

  const halfW = width / 2;
  const halfD = depth / 2;
  const halfH = height / 2;
  const halfT = thickness / 2;

  // Floor: a thin slab whose top face sits on y = 0 (the player capsule's
  // resting plane). Sized to the room footprint; the four wall colliders
  // below close the box so the player cannot leave the floor.
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfW, halfT, halfD)
      .setTranslation(0, -halfT, 0),
    floorBody,
  );

  // Four solid walls flush with the visual wall meshes. North and south
  // run along world X (wide along X, thin along Z). East and west run
  // along world Z. Each wall is one cuboid, no door cutout: the player
  // capsule's center reaches the portal trigger zone before the edge
  // hits the wall, so lit-portal traversal still fires.
  const wallSpecs = [
    // North
    { hx: halfW, hy: halfH, hz: halfT, x: 0, y: halfH, z: -halfD },
    // South
    { hx: halfW, hy: halfH, hz: halfT, x: 0, y: halfH, z: halfD },
    // East
    { hx: halfT, hy: halfH, hz: halfD, x: halfW, y: halfH, z: 0 },
    // West
    { hx: halfT, hy: halfH, hz: halfD, x: -halfW, y: halfH, z: 0 },
  ];
  for (const w of wallSpecs) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(w.hx, w.hy, w.hz)
        .setTranslation(w.x, w.y, w.z),
      body,
    );
  }
}
