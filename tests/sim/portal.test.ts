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

/**
 * REQ-005 portal fixity property test (dossier section 11). Builds the four
 * canonical Act 1 portals, then runs a 1000-tick randomized simulation that
 * "advances" by reading and re-reading each portal's destination per tick.
 * The randomization is a 30-line LCG seeded from the test description (Q-017
 * default: hand-rolled, no third-party PRNG) so the sequence is deterministic
 * across machines. The test asserts that after every tick `portal.destination`
 * Hours and `portal.direction` are unchanged from the values captured at
 * construction. TypeScript readonly already prevents the mutation at compile
 * time; this test gives runtime confirmation that nothing in the fuzzer
 * sequence (including the explicit assignment attempts under each tick) can
 * mutate the frozen field.
 */
function lcgFromString(seed: string): () => number {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("REQ-005 portal destination fixity property test", () => {
  it("destinationHours and direction are unchanged across a 1000-tick fuzz", () => {
    const doors = createFourDoors(
      ROOM_DIMENSIONS.width,
      ROOM_DIMENSIONS.depth,
    );
    const portals = createActOnePortals(doors);

    const originalDestinations = portals.map((p) => p.destinationHours);
    const originalDirections = portals.map((p) => p.direction);
    const originalLitFlags = portals.map((p) => p.isLit);

    const rand = lcgFromString(
      "REQ-005 portal destination fixity property test",
    );

    const TICKS = 1000;
    const touched = new Array<number>(portals.length).fill(0);
    for (let tick = 0; tick < TICKS; tick++) {
      // Pick a random portal each tick and try to mutate its destination
      // and direction. Object.freeze means strict-mode assignment throws;
      // catch and continue so the test exercises the runtime guarantee.
      const idx = Math.floor(rand() * portals.length);
      touched[idx] += 1;
      const portal = portals[idx];
      const candidate = Math.floor(rand() * 24);
      try {
        // @ts-expect-error: deliberately attempting a runtime mutation
        portal.destinationHours = candidate;
      } catch {
        // Expected: frozen object rejects the write in strict mode.
      }
      try {
        // @ts-expect-error: deliberately attempting a runtime mutation
        portal.direction = "north";
      } catch {
        // Expected: frozen object rejects the write in strict mode.
      }
      try {
        // @ts-expect-error: deliberately attempting a runtime mutation
        portal.isLit = !portal.isLit;
      } catch {
        // Expected: frozen object rejects the write in strict mode.
      }

      // Re-read every portal's fixed fields each tick and confirm they
      // still match the construction-time snapshot.
      for (let i = 0; i < portals.length; i++) {
        expect(portals[i].destinationHours).toBe(originalDestinations[i]);
        expect(portals[i].direction).toBe(originalDirections[i]);
        expect(portals[i].isLit).toBe(originalLitFlags[i]);
      }
    }

    // Final snapshot equality (belt-and-suspenders).
    expect(portals.map((p) => p.destinationHours)).toEqual(
      originalDestinations,
    );
    expect(portals.map((p) => p.direction)).toEqual(originalDirections);
    expect(portals.map((p) => p.isLit)).toEqual(originalLitFlags);
    // Coverage guard: a degenerate seed that never lands on one of the
    // portals would silently weaken the fuzz. Assert every portal was
    // exercised at least once across the 1000 ticks.
    expect(touched.every((n) => n > 0)).toBe(true);
  });
});
