import { describe, expect, it } from "vitest";
import {
  DOOR_DIMENSIONS,
  createDoor,
  createFourDoors,
  type DoorDirection,
} from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";

describe("door", () => {
  it("exposes door-shaped placeholder dimensions", () => {
    expect(DOOR_DIMENSIONS.width).toBeGreaterThan(0);
    expect(DOOR_DIMENSIONS.height).toBeGreaterThan(DOOR_DIMENSIONS.width);
    expect(DOOR_DIMENSIONS.depth).toBeGreaterThan(0);
  });

  it("places one door at the midpoint of each wall, base on the floor", () => {
    const { width, depth } = ROOM_DIMENSIONS;
    const inset = DOOR_DIMENSIONS.depth / 2;
    const yExpected = DOOR_DIMENSIONS.height / 2;

    const cases: ReadonlyArray<{
      direction: DoorDirection;
      position: { x: number; y: number; z: number };
    }> = [
      { direction: "north", position: { x: 0, y: yExpected, z: -depth / 2 + inset } },
      { direction: "south", position: { x: 0, y: yExpected, z: depth / 2 - inset } },
      { direction: "east", position: { x: width / 2 - inset, y: yExpected, z: 0 } },
      { direction: "west", position: { x: -width / 2 + inset, y: yExpected, z: 0 } },
    ];

    for (const { direction, position } of cases) {
      const door = createDoor(direction, width, depth);
      expect(door.direction).toBe(direction);
      expect(door.mesh.position.x).toBeCloseTo(position.x);
      expect(door.mesh.position.y).toBeCloseTo(position.y);
      expect(door.mesh.position.z).toBeCloseTo(position.z);
    }
  });

  it("rotates east/west doors so they sit flush along their wall", () => {
    const { width, depth } = ROOM_DIMENSIONS;
    const north = createDoor("north", width, depth);
    const south = createDoor("south", width, depth);
    const east = createDoor("east", width, depth);
    const west = createDoor("west", width, depth);

    expect(north.mesh.rotation.y).toBe(0);
    expect(south.mesh.rotation.y).toBe(0);
    expect(east.mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(west.mesh.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it("scales placement to room dimensions", () => {
    // A non-square room exercises that width drives east/west and depth
    // drives north/south independently.
    const roomWidth = 8;
    const roomDepth = 14;
    const inset = DOOR_DIMENSIONS.depth / 2;

    const east = createDoor("east", roomWidth, roomDepth);
    const north = createDoor("north", roomWidth, roomDepth);

    expect(east.mesh.position.x).toBeCloseTo(roomWidth / 2 - inset);
    expect(east.mesh.position.z).toBeCloseTo(0);
    expect(north.mesh.position.x).toBeCloseTo(0);
    expect(north.mesh.position.z).toBeCloseTo(-roomDepth / 2 + inset);
  });

  it("creates four doors with distinct directions in a stable order", () => {
    const { width, depth } = ROOM_DIMENSIONS;
    const doors = createFourDoors(width, depth);

    expect(doors).toHaveLength(4);
    expect(doors.map((d) => d.direction)).toEqual([
      "north",
      "south",
      "east",
      "west",
    ]);
  });
});
