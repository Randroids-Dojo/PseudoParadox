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

/**
 * Visual constants for the lit/dark door state stub.
 *
 * REQ-009 (lit doors enterable) and REQ-010 (dark doors spawn-only) need a
 * legible visual difference even before the runtime traversal slice ships,
 * so a player looking at the room can tell which doors are which. A lit door
 * keeps the warm placeholder color and adds an emissive boost; a dark door
 * is desaturated almost to black with no emissive. REQ-011 will replace the
 * stamping caller (lit/dark will be derived from timeline arrivals) but the
 * material treatment stays the same.
 */
export const DOOR_LIT_COLOR_HEX = 0xf2c987;
export const DOOR_DARK_COLOR_HEX = 0x1a1612;
export const DOOR_LIT_EMISSIVE_HEX = 0x6a3a14;
export const DOOR_LIT_EMISSIVE_INTENSITY = 0.6;

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

/**
 * Stamps the lit/dark visual state onto a door's material in place.
 *
 * Lit doors get a warm color plus an emissive boost so they read as glowing.
 * Dark doors get a near-black color and no emissive. The mesh's material is
 * mutated rather than replaced so callers do not need to dispose of an old
 * material.
 *
 * REQ-009 / REQ-010 ship the lit/dark visual stub here; REQ-011 will swap
 * the call site to compute the boolean from the recorded timeline. The
 * function only cares about the boolean, so the call site changes without
 * touching this helper.
 */
export function applyDoorLitState(door: Door, isLit: boolean): void {
  const material = door.mesh.material;
  if (Array.isArray(material) || !(material instanceof THREE.MeshStandardMaterial)) {
    throw new Error(
      "applyDoorLitState: door mesh must have a single MeshStandardMaterial",
    );
  }
  if (isLit) {
    material.color.setHex(DOOR_LIT_COLOR_HEX);
    material.emissive.setHex(DOOR_LIT_EMISSIVE_HEX);
    material.emissiveIntensity = DOOR_LIT_EMISSIVE_INTENSITY;
  } else {
    material.color.setHex(DOOR_DARK_COLOR_HEX);
    material.emissive.setHex(0x000000);
    material.emissiveIntensity = 0;
  }
}
