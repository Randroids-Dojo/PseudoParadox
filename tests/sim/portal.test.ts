import { describe, expect, it } from "vitest";
import {
  ACT_ONE_PORTAL_SPECS,
  HOURS_PER_DAY,
  createActOnePortals,
  createPortal,
  isLit,
  portalDestinationNormalized,
} from "../../src/sim/portal.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";
import {
  createDoor,
  createFourDoors,
  type Door,
  type DoorDirection,
} from "../../src/scene/door.ts";

function makeDoor(direction: DoorDirection): Door {
  return createDoor(direction, ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
}

describe("portal", () => {
  it("createPortal pairs a door with destination and lit state", () => {
    const door = makeDoor("south");
    const portal = createPortal({ door, destinationHours: 12, isLit: true });

    expect(portal.door).toBe(door);
    expect(portal.direction).toBe("south");
    expect(portal.destinationHours).toBe(12);
    expect(portal.isLit).toBe(true);
  });

  it("createPortal mirrors door.direction onto portal.direction", () => {
    for (const direction of ["north", "south", "east", "west"] as const) {
      const portal = createPortal({
        door: makeDoor(direction),
        destinationHours: 0,
        isLit: false,
      });
      expect(portal.direction).toBe(direction);
    }
  });

  it("createPortal rejects non-finite destination hours", () => {
    const door = makeDoor("east");
    expect(() =>
      createPortal({ door, destinationHours: Number.NaN, isLit: true }),
    ).toThrow(/finite/);
    expect(() =>
      createPortal({ door, destinationHours: Number.POSITIVE_INFINITY, isLit: true }),
    ).toThrow(/finite/);
  });

  it("createPortal rejects destination hours outside [0, 24)", () => {
    const door = makeDoor("east");
    expect(() =>
      createPortal({ door, destinationHours: -0.5, isLit: true }),
    ).toThrow(/\[0, 24\)/);
    expect(() =>
      createPortal({ door, destinationHours: 24, isLit: true }),
    ).toThrow(/\[0, 24\)/);
    expect(() =>
      createPortal({ door, destinationHours: 99, isLit: true }),
    ).toThrow(/\[0, 24\)/);
  });

  it("createPortal accepts the boundary destinationHours = 0", () => {
    const portal = createPortal({
      door: makeDoor("north"),
      destinationHours: 0,
      isLit: false,
    });
    expect(portal.destinationHours).toBe(0);
  });

  it("destinationHours cannot mutate after construction (REQ-005 fixity)", () => {
    const portal = createPortal({
      door: makeDoor("south"),
      destinationHours: 12,
      isLit: true,
    });
    // Strict-mode assignment to a frozen field throws; the test passes
    // either way as long as the value does not change.
    try {
      // @ts-expect-error: deliberately attempting a runtime mutation
      portal.destinationHours = 7;
    } catch {
      // Expected in strict mode (vitest runs ESM modules in strict mode).
    }
    expect(portal.destinationHours).toBe(12);
  });

  it("isLit predicate returns the portal's lit field", () => {
    const lit = createPortal({
      door: makeDoor("south"),
      destinationHours: 12,
      isLit: true,
    });
    const dark = createPortal({
      door: makeDoor("north"),
      destinationHours: 12,
      isLit: false,
    });
    expect(isLit(lit)).toBe(true);
    expect(isLit(dark)).toBe(false);
  });

  it("portalDestinationNormalized maps hours into [0, 1) for TimeOfDay", () => {
    const cases: ReadonlyArray<{ hours: number; expected: number }> = [
      { hours: 0, expected: 0 },
      { hours: 6, expected: 6 / HOURS_PER_DAY },
      { hours: 12, expected: 0.5 },
      { hours: 18, expected: 0.75 },
    ];
    for (const { hours, expected } of cases) {
      const portal = createPortal({
        door: makeDoor("east"),
        destinationHours: hours,
        isLit: true,
      });
      expect(portalDestinationNormalized(portal)).toBeCloseTo(expected, 10);
    }
  });
});

describe("Act 1 canonical portal table", () => {
  it("ACT_ONE_PORTAL_SPECS lights South -> 12:00 and East -> 6:00 (REQ-013/REQ-014)", () => {
    const byDirection = new Map(
      ACT_ONE_PORTAL_SPECS.map((spec) => [spec.direction, spec]),
    );

    const south = byDirection.get("south");
    expect(south).toBeDefined();
    expect(south?.isLit).toBe(true);
    expect(south?.destinationHours).toBe(12);

    const east = byDirection.get("east");
    expect(east).toBeDefined();
    expect(east?.isLit).toBe(true);
    expect(east?.destinationHours).toBe(6);
  });

  it("ACT_ONE_PORTAL_SPECS leaves North and West dark", () => {
    const byDirection = new Map(
      ACT_ONE_PORTAL_SPECS.map((spec) => [spec.direction, spec]),
    );
    expect(byDirection.get("north")?.isLit).toBe(false);
    expect(byDirection.get("west")?.isLit).toBe(false);
  });

  it("createActOnePortals pairs each Act 1 spec with the matching door", () => {
    const doors = createFourDoors(
      ROOM_DIMENSIONS.width,
      ROOM_DIMENSIONS.depth,
    );
    const portals = createActOnePortals(doors);

    expect(portals).toHaveLength(4);
    const directions = portals.map((p) => p.direction);
    expect(directions).toEqual(["south", "east", "north", "west"]);

    for (const portal of portals) {
      const matchingDoor = doors.find((d) => d.direction === portal.direction);
      expect(portal.door).toBe(matchingDoor);
    }

    const south = portals.find((p) => p.direction === "south")!;
    const east = portals.find((p) => p.direction === "east")!;
    const north = portals.find((p) => p.direction === "north")!;
    const west = portals.find((p) => p.direction === "west")!;

    expect(south.isLit).toBe(true);
    expect(south.destinationHours).toBe(12);
    expect(east.isLit).toBe(true);
    expect(east.destinationHours).toBe(6);
    expect(north.isLit).toBe(false);
    expect(west.isLit).toBe(false);
  });

  it("createActOnePortals throws when a cardinal direction is missing", () => {
    const doors = [
      makeDoor("north"),
      makeDoor("south"),
      makeDoor("east"),
    ];
    expect(() => createActOnePortals(doors)).toThrow(/west/);
  });

  it("createActOnePortals throws on duplicate directions", () => {
    const doors = [
      makeDoor("north"),
      makeDoor("north"),
      makeDoor("south"),
      makeDoor("east"),
      makeDoor("west"),
    ];
    expect(() => createActOnePortals(doors)).toThrow(/duplicate/);
  });
});
