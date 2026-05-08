import * as THREE from "three";

/**
 * Cardinal directions a door can sit on. The room is square and the four
 * doors land at the midpoint of each wall (REQ-027).
 */
export type DoorDirection = "north" | "south" | "east" | "west";

/**
 * Door geometry constants for the prototype.
 *
 * Doors are placeholder slabs sized to read against the player capsule
 * (PLAYER_CAPSULE_TOTAL_HEIGHT is ~1.8). The depth is intentionally a hair
 * thicker than the wall so the door reads as a distinct surface flush
 * against the inside face of its wall rather than z-fighting with it.
 */
export const DOOR_DIMENSIONS = {
  width: 1.2,
  height: 2.2,
  depth: 0.12,
} as const;

export interface Door {
  mesh: THREE.Mesh;
  direction: DoorDirection;
}

/**
 * Builds one door mesh for the given wall direction and room footprint.
 *
 * The door is positioned at the midpoint of its wall, centered horizontally
 * along the wall and resting on the floor. Doors are visual-only in this
 * slice. REQ-001 (timeline persistence) and REQ-005 (fixed door
 * destinations) will revisit this module to add portal triggers; REQ-028
 * will add the lit-versus-dark visual state. Until then there is no
 * collider, so the player capsule passes through the door surface (the
 * wall behind it still blocks). That is acceptable for a placeholder
 * because the wall is the actual barrier.
 */
export function createDoor(
  direction: DoorDirection,
  roomWidth: number,
  roomDepth: number,
): Door {
  const { width, height, depth } = DOOR_DIMENSIONS;

  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({
    // Warm placeholder so the door reads against the cool grey walls.
    // REQ-028 (lit/dark) will replace this with a state-driven material.
    color: 0x9a6a3c,
    roughness: 0.7,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `door-${direction}`;

  // The wall midpoints sit at +/- (roomWidth/2) on X for east/west and at
  // +/- (roomDepth/2) on Z for north/south. Doors face inward, so a north
  // or south door is wide along X and a east or west door is wide along Z.
  // The base of the door rests on the floor (y = height/2). To avoid
  // z-fighting with the wall, the door's outer face sits a hair inward of
  // the wall's inner face: half the door depth.
  const yCenter = height / 2;
  const halfWidth = roomWidth / 2;
  const halfDepth = roomDepth / 2;
  const inset = depth / 2;

  switch (direction) {
    case "north":
      mesh.position.set(0, yCenter, -halfDepth + inset);
      break;
    case "south":
      mesh.position.set(0, yCenter, halfDepth - inset);
      break;
    case "east":
      mesh.position.set(halfWidth - inset, yCenter, 0);
      // Rotate so the door's wide face runs along the wall (Z axis).
      mesh.rotation.y = Math.PI / 2;
      break;
    case "west":
      mesh.position.set(-halfWidth + inset, yCenter, 0);
      mesh.rotation.y = Math.PI / 2;
      break;
  }

  return { mesh, direction };
}

/**
 * Builds all four doors for the room and returns them in a stable order
 * (north, south, east, west). The caller is responsible for adding each
 * door's mesh to the scene graph.
 */
export function createFourDoors(
  roomWidth: number,
  roomDepth: number,
): readonly Door[] {
  const directions: readonly DoorDirection[] = [
    "north",
    "south",
    "east",
    "west",
  ];
  return directions.map((d) => createDoor(d, roomWidth, roomDepth));
}
