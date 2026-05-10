/**
 * Wall-bump milestone detector (F-013, PR3a slice).
 *
 * Position-based per-wall edge-trigger detector. A "bump" fires the first
 * tick the player capsule center crosses INTO the contact band of a wall,
 * not on every tick the capsule remains pressed against the wall. Sliding
 * along a wall produces ONE bump milestone, not 60 per second.
 *
 * Why position-based instead of Rapier contact pairs: the existing host
 * loop calls `world.step()` without an `EventQueue`, so contact events
 * are not exposed. A position-based detector reads the same data the
 * portal trigger reads (the player's translation) and produces a stable
 * edge stream without surfacing more of Rapier's API. The detector knows
 * the wall geometry from `ROOM_DIMENSIONS` and `ROOM_WALL_THICKNESS`
 * (matching `createRoomColliders` in `src/scene/room.ts`).
 *
 * Contract:
 *   - Constructor: no args. The detector starts with all four walls in
 *     the "not in contact" state.
 *   - `step(playerX, playerZ, capsuleRadius)` returns the list of walls
 *     the player crossed INTO this tick (zero, one, or two for a corner
 *     pinch). Walls already in contact do not appear again until the
 *     player exits the contact band.
 *
 * The capsule radius is passed in (rather than imported from
 * `PLAYER_CAPSULE`) so the detector stays decoupled from the player
 * module: tests can pass a smaller capsule, and a future Q that retunes
 * the capsule does not require a detector change.
 */

import { ROOM_DIMENSIONS } from "../scene/room.ts";
import { ROOM_WALL_THICKNESS } from "../scene/room.ts";
import type { DoorDirection } from "../scene/door.ts";

/**
 * Margin added to the capsule radius when computing the contact band.
 * Slightly generous so the trigger fires reliably even when the physics
 * step settles the capsule a hair short of the wall under damping.
 */
export const WALL_BUMP_CONTACT_MARGIN = 0.05;

interface WallBand {
  readonly direction: DoorDirection;
  /**
   * Predicate that returns true when the capsule center at `(x, z)` with
   * radius `r` is inside this wall's contact band.
   */
  inBand: (x: number, z: number, r: number) => boolean;
}

const HALF_W = ROOM_DIMENSIONS.width / 2;
const HALF_D = ROOM_DIMENSIONS.depth / 2;
const HALF_T = ROOM_WALL_THICKNESS / 2;

/**
 * Inner-face coordinates per wall. The wall colliders sit centered on
 * `+/- HALF_W` (east / west) or `+/- HALF_D` (north / south) with a
 * half-thickness of `HALF_T`. The face that points INTO the room is the
 * inner face; the contact band is the slab inside the room with depth
 * `radius + WALL_BUMP_CONTACT_MARGIN` from that face.
 */
const NORTH_INNER_Z = -HALF_D + HALF_T; // walls at z=-HALF_D inner face at z=-HALF_D + HALF_T
const SOUTH_INNER_Z = HALF_D - HALF_T;
const EAST_INNER_X = HALF_W - HALF_T;
const WEST_INNER_X = -HALF_W + HALF_T;

const WALLS: readonly WallBand[] = Object.freeze([
  Object.freeze({
    direction: "north" as const,
    inBand: (_x: number, z: number, r: number) =>
      z <= NORTH_INNER_Z + r + WALL_BUMP_CONTACT_MARGIN,
  }),
  Object.freeze({
    direction: "south" as const,
    inBand: (_x: number, z: number, r: number) =>
      z >= SOUTH_INNER_Z - r - WALL_BUMP_CONTACT_MARGIN,
  }),
  Object.freeze({
    direction: "east" as const,
    inBand: (x: number, _z: number, r: number) =>
      x >= EAST_INNER_X - r - WALL_BUMP_CONTACT_MARGIN,
  }),
  Object.freeze({
    direction: "west" as const,
    inBand: (x: number, _z: number, r: number) =>
      x <= WEST_INNER_X + r + WALL_BUMP_CONTACT_MARGIN,
  }),
]);

/**
 * Per-wall in-contact flag plus the most recent step's edge result. The
 * detector mutates this shape in place; callers receive a fresh array
 * from `step` each call (defensive copy of the edge set).
 */
export interface WallBumpDetector {
  /**
   * Advance one tick. Returns the walls the player crossed INTO this
   * tick (rising edge). Walls already in contact emit nothing.
   */
  step: (
    playerX: number,
    playerZ: number,
    capsuleRadius: number,
  ) => readonly DoorDirection[];
  /**
   * Read-only view of which walls the player is currently in contact
   * with. Exposed for tests and debugging; the runtime path uses the
   * step return value.
   */
  inContactWith: (direction: DoorDirection) => boolean;
}

export function createWallBumpDetector(): WallBumpDetector {
  const inContact = new Map<DoorDirection, boolean>();
  for (const w of WALLS) inContact.set(w.direction, false);

  const step: WallBumpDetector["step"] = (x, z, r) => {
    const enters: DoorDirection[] = [];
    for (const wall of WALLS) {
      const wasInContact = inContact.get(wall.direction) === true;
      const isInContact = wall.inBand(x, z, r);
      if (isInContact && !wasInContact) {
        enters.push(wall.direction);
      }
      inContact.set(wall.direction, isInContact);
    }
    return enters;
  };

  const inContactWith: WallBumpDetector["inContactWith"] = (direction) =>
    inContact.get(direction) === true;

  return { step, inContactWith };
}
