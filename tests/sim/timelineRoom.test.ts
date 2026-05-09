import { describe, expect, it } from "vitest";
import {
  repaintDoorsForHour,
  snapClockToHour,
} from "../../src/sim/timelineRoom.ts";
import {
  createPortal,
  type Portal,
} from "../../src/sim/portal.ts";
import {
  createDoor,
  DOOR_LIT_COLOR_HEX,
  DOOR_DARK_COLOR_HEX,
  type DoorDirection,
} from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";
import { TimeOfDay } from "../../src/sim/timeOfDay.ts";
import type * as THREE from "three";

const makePortal = (
  direction: DoorDirection,
  destinationHours: number,
  isLit: boolean,
): Portal => {
  const door = createDoor(direction, ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
  return createPortal({ door, destinationHours, isLit });
};

const colorHex = (portal: Portal): number => {
  const mat = portal.door.mesh.material as THREE.MeshStandardMaterial;
  return mat.color.getHex();
};

describe("repaintDoorsForHour: REQ-015 6:00 timeline state", () => {
  it("at 6:00 lights ONLY the West door and darkens South, East, North", () => {
    const portals: readonly Portal[] = [
      makePortal("south", 12, true),
      makePortal("east", 6, true),
      makePortal("north", 12, false),
      makePortal("west", 5, false),
    ];

    repaintDoorsForHour(portals, 6);

    const byDirection = new Map<DoorDirection, Portal>();
    for (const p of portals) byDirection.set(p.direction, p);
    expect(colorHex(byDirection.get("west")!)).toBe(DOOR_LIT_COLOR_HEX);
    expect(colorHex(byDirection.get("south")!)).toBe(DOOR_DARK_COLOR_HEX);
    expect(colorHex(byDirection.get("east")!)).toBe(DOOR_DARK_COLOR_HEX);
    expect(colorHex(byDirection.get("north")!)).toBe(DOOR_DARK_COLOR_HEX);
  });

  it("at 5:00 lights South and East, darkens North and West", () => {
    // Ports portals authored opposite (West lit, South dark) and confirms
    // the repaint flips them to the 5:00 canon. This proves the function
    // does not just trust the construction-time `isLit`; it reads from
    // the table.
    const portals: readonly Portal[] = [
      makePortal("south", 12, false),
      makePortal("east", 6, false),
      makePortal("north", 12, true),
      makePortal("west", 5, true),
    ];

    repaintDoorsForHour(portals, 5);

    const byDirection = new Map<DoorDirection, Portal>();
    for (const p of portals) byDirection.set(p.direction, p);
    expect(colorHex(byDirection.get("south")!)).toBe(DOOR_LIT_COLOR_HEX);
    expect(colorHex(byDirection.get("east")!)).toBe(DOOR_LIT_COLOR_HEX);
    expect(colorHex(byDirection.get("north")!)).toBe(DOOR_DARK_COLOR_HEX);
    expect(colorHex(byDirection.get("west")!)).toBe(DOOR_DARK_COLOR_HEX);
  });

  it("throws on an unauthored hour rather than silently no-op'ing", () => {
    const portals: readonly Portal[] = [makePortal("south", 12, true)];
    expect(() => repaintDoorsForHour(portals, 0)).toThrow();
    expect(() => repaintDoorsForHour(portals, 23)).toThrow();
  });
});

describe("snapClockToHour: REQ-015 clock snap on traversal", () => {
  it("snaps the clock so normalized() reads hour/24", () => {
    const clock = new TimeOfDay({
      ticksPerSecond: 60,
      initialNormalized: 5 / 24,
    });
    snapClockToHour(clock, 6);
    expect(clock.normalized()).toBeCloseTo(6 / 24, 6);
  });

  it("is idempotent: snapping to the same hour twice produces the same tick", () => {
    const clock = new TimeOfDay({ ticksPerSecond: 60 });
    snapClockToHour(clock, 6);
    const tickAfterFirst = clock.tick();
    snapClockToHour(clock, 6);
    expect(clock.tick()).toBe(tickAfterFirst);
  });

  it("subsequent advanceTicks continues from the snapped tick", () => {
    const clock = new TimeOfDay({ ticksPerSecond: 60 });
    snapClockToHour(clock, 6);
    const tickAfterSnap = clock.tick();
    clock.advanceTicks(10);
    expect(clock.tick()).toBe(tickAfterSnap + 10);
  });
});
