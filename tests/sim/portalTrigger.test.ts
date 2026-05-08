import { describe, expect, it, vi } from "vitest";
import {
  PORTAL_TRIGGER_DEPTH,
  PORTAL_TRIGGER_WALL_WIDTH,
  createPortalTrigger,
  createPortalTriggerSet,
  pointInsideTrigger,
  type OverlapEvent,
} from "../../src/sim/portalTrigger.ts";
import { createPortal, createActOnePortals, type Portal } from "../../src/sim/portal.ts";
import {
  createDoor,
  createFourDoors,
  type DoorDirection,
} from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";

const HALF_WIDTH = ROOM_DIMENSIONS.width / 2;
const HALF_DEPTH = ROOM_DIMENSIONS.depth / 2;

function makePortal(direction: DoorDirection, isLit = true): Portal {
  const door = createDoor(direction, ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
  return createPortal({ door, destinationHours: 12, isLit });
}

describe("createPortalTrigger: geometry", () => {
  it("south door trigger sits just inside the south wall, centered on +Z face", () => {
    const portal = makePortal("south");
    const trigger = createPortalTrigger(portal);

    // South door mesh sits near +Z; the trigger center is offset inward
    // (toward the room) by half the trigger depth.
    expect(trigger.centerX).toBeCloseTo(0, 6);
    expect(trigger.centerZ).toBeCloseTo(
      portal.door.mesh.position.z - PORTAL_TRIGGER_DEPTH / 2,
      6,
    );
    // The wall direction (X) is the wide axis for north/south doors.
    expect(trigger.halfX).toBeCloseTo(PORTAL_TRIGGER_WALL_WIDTH / 2, 6);
    expect(trigger.halfZ).toBeCloseTo(PORTAL_TRIGGER_DEPTH / 2, 6);
  });

  it("north door trigger sits just inside the north wall, centered on -Z face", () => {
    const portal = makePortal("north");
    const trigger = createPortalTrigger(portal);

    expect(trigger.centerX).toBeCloseTo(0, 6);
    expect(trigger.centerZ).toBeCloseTo(
      portal.door.mesh.position.z + PORTAL_TRIGGER_DEPTH / 2,
      6,
    );
    expect(trigger.halfX).toBeCloseTo(PORTAL_TRIGGER_WALL_WIDTH / 2, 6);
    expect(trigger.halfZ).toBeCloseTo(PORTAL_TRIGGER_DEPTH / 2, 6);
  });

  it("east door trigger swaps wide and shallow axes", () => {
    const portal = makePortal("east");
    const trigger = createPortalTrigger(portal);

    expect(trigger.centerZ).toBeCloseTo(0, 6);
    expect(trigger.centerX).toBeCloseTo(
      portal.door.mesh.position.x - PORTAL_TRIGGER_DEPTH / 2,
      6,
    );
    expect(trigger.halfZ).toBeCloseTo(PORTAL_TRIGGER_WALL_WIDTH / 2, 6);
    expect(trigger.halfX).toBeCloseTo(PORTAL_TRIGGER_DEPTH / 2, 6);
  });

  it("west door trigger mirrors east", () => {
    const portal = makePortal("west");
    const trigger = createPortalTrigger(portal);

    expect(trigger.centerZ).toBeCloseTo(0, 6);
    expect(trigger.centerX).toBeCloseTo(
      portal.door.mesh.position.x + PORTAL_TRIGGER_DEPTH / 2,
      6,
    );
    expect(trigger.halfZ).toBeCloseTo(PORTAL_TRIGGER_WALL_WIDTH / 2, 6);
    expect(trigger.halfX).toBeCloseTo(PORTAL_TRIGGER_DEPTH / 2, 6);
  });

  it("returned trigger object is frozen", () => {
    const portal = makePortal("south");
    const trigger = createPortalTrigger(portal);
    expect(Object.isFrozen(trigger)).toBe(true);
  });
});

describe("pointInsideTrigger: predicate", () => {
  it("reports true at the center of the trigger volume", () => {
    const portal = makePortal("south");
    const trigger = createPortalTrigger(portal);
    expect(pointInsideTrigger(trigger, trigger.centerX, trigger.centerZ)).toBe(true);
  });

  it("reports false well outside the trigger in both axes", () => {
    const portal = makePortal("south");
    const trigger = createPortalTrigger(portal);
    expect(pointInsideTrigger(trigger, trigger.centerX + 100, trigger.centerZ)).toBe(false);
    expect(pointInsideTrigger(trigger, trigger.centerX, trigger.centerZ - 100)).toBe(false);
  });

  it("treats the boundary as inside (inclusive)", () => {
    const portal = makePortal("south");
    const trigger = createPortalTrigger(portal);
    expect(
      pointInsideTrigger(trigger, trigger.centerX + trigger.halfX, trigger.centerZ),
    ).toBe(true);
    expect(
      pointInsideTrigger(trigger, trigger.centerX - trigger.halfX, trigger.centerZ),
    ).toBe(true);
    expect(
      pointInsideTrigger(trigger, trigger.centerX, trigger.centerZ + trigger.halfZ),
    ).toBe(true);
  });

  it("reports false just past the boundary on each axis", () => {
    const portal = makePortal("south");
    const trigger = createPortalTrigger(portal);
    const eps = 1e-6;
    expect(
      pointInsideTrigger(trigger, trigger.centerX + trigger.halfX + eps, trigger.centerZ),
    ).toBe(false);
    expect(
      pointInsideTrigger(trigger, trigger.centerX, trigger.centerZ - trigger.halfZ - eps),
    ).toBe(false);
  });

  it("reports false at a far cardinal direction's trigger center", () => {
    // Point at the south door's trigger center should not register on the
    // north door's trigger.
    const south = makePortal("south");
    const north = makePortal("north");
    const southTrigger = createPortalTrigger(south);
    const northTrigger = createPortalTrigger(north);
    expect(pointInsideTrigger(northTrigger, southTrigger.centerX, southTrigger.centerZ)).toBe(false);
  });

  it("rejects an out-of-room point regardless of door direction", () => {
    for (const dir of ["north", "south", "east", "west"] as const) {
      const trigger = createPortalTrigger(makePortal(dir));
      // (1000, 1000) is wildly outside the room footprint (10x10).
      expect(pointInsideTrigger(trigger, 1000, 1000)).toBe(false);
    }
  });
});

describe("createPortalTriggerSet: edge-triggered events", () => {
  it("emits exactly one enter when the player crosses into the trigger", () => {
    const portal = makePortal("south");
    const set = createPortalTriggerSet([portal]);
    const events: OverlapEvent[] = [];
    set.onPortalOverlap((e) => events.push(e));

    // Start outside the trigger, sweep onto it.
    set.step(0, 0, 0); // outside
    set.step(0, HALF_DEPTH - 0.4, 1); // inside (south trigger ~ z in [4.34, 4.94])
    set.step(0, HALF_DEPTH - 0.4, 2); // still inside, no re-emit

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("enter");
    expect(events[0].portal).toBe(portal);
    expect(events[0].tick).toBe(1);
  });

  it("emits exactly one exit when the player leaves the trigger", () => {
    const portal = makePortal("south");
    const set = createPortalTriggerSet([portal]);
    const events: OverlapEvent[] = [];
    set.onPortalOverlap((e) => events.push(e));

    set.step(0, HALF_DEPTH - 0.4, 0); // enter
    set.step(0, HALF_DEPTH - 0.4, 1); // still inside
    set.step(0, 0, 2); // exit
    set.step(0, 0, 3); // outside, no re-emit

    expect(events.map((e) => e.kind)).toEqual(["enter", "exit"]);
    expect(events[1].tick).toBe(2);
    expect(events[1].portal).toBe(portal);
  });

  it("emits both enter and exit on a single sweep across the trigger", () => {
    // Sweep along Z from outside (origin) into the south trigger and back.
    const portal = makePortal("south");
    const set = createPortalTriggerSet([portal]);
    const events: OverlapEvent[] = [];
    set.onPortalOverlap((e) => events.push(e));

    const path = [
      { z: 0, tick: 0 },
      { z: 1, tick: 1 },
      { z: 2, tick: 2 },
      { z: HALF_DEPTH - 0.4, tick: 3 }, // inside
      { z: HALF_DEPTH - 0.5, tick: 4 }, // inside
      { z: 1, tick: 5 }, // outside
      { z: 0, tick: 6 }, // outside
    ];
    for (const p of path) set.step(0, p.z, p.tick);

    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("enter");
    expect(events[1].kind).toBe("exit");
  });

  it("does NOT filter on lit/dark; both lit and dark portals fire overlap", () => {
    const lit = makePortal("south", true);
    const dark = makePortal("north", false);
    const set = createPortalTriggerSet([lit, dark]);
    const events: OverlapEvent[] = [];
    set.onPortalOverlap((e) => events.push(e));

    // Step into the lit portal first (south trigger spans z in [4.34, 4.94]).
    set.step(0, HALF_DEPTH - 0.4, 0);
    // Step into the dark portal (north trigger spans z in [-4.94, -4.34]).
    set.step(0, -(HALF_DEPTH - 0.4), 1);
    // Step out.
    set.step(0, 0, 2);

    const enters = events.filter((e) => e.kind === "enter");
    expect(enters).toHaveLength(2);
    expect(enters.map((e) => e.portal.direction).sort()).toEqual(["north", "south"]);
  });

  it("multiple subscribers each receive every event", () => {
    const portal = makePortal("south");
    const set = createPortalTriggerSet([portal]);
    const a = vi.fn();
    const b = vi.fn();
    set.onPortalOverlap(a);
    set.onPortalOverlap(b);

    set.step(0, HALF_DEPTH - 0.4, 0); // enter
    set.step(0, 0, 1); // exit

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops further callbacks", () => {
    const portal = makePortal("south");
    const set = createPortalTriggerSet([portal]);
    const cb = vi.fn();
    const off = set.onPortalOverlap(cb);

    set.step(0, HALF_DEPTH - 0.4, 0); // enter
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    set.step(0, 0, 1); // exit, but unsubscribed
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("isOverlapping reports current state per portal", () => {
    const south = makePortal("south");
    const east = makePortal("east");
    const set = createPortalTriggerSet([south, east]);

    set.step(0, HALF_DEPTH - 0.4, 0); // inside south
    expect(set.isOverlapping(south)).toBe(true);
    expect(set.isOverlapping(east)).toBe(false);

    set.step(HALF_WIDTH - 0.4, 0, 1); // inside east, outside south
    expect(set.isOverlapping(south)).toBe(false);
    expect(set.isOverlapping(east)).toBe(true);
  });

  it("works end-to-end against the canonical Act 1 portal set", () => {
    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const set = createPortalTriggerSet(portals);
    const events: OverlapEvent[] = [];
    set.onPortalOverlap((e) => events.push(e));

    // Walk into each cardinal trigger in turn from the room center.
    const insets = {
      south: { x: 0, z: HALF_DEPTH - 0.4 },
      east: { x: HALF_WIDTH - 0.4, z: 0 },
      north: { x: 0, z: -(HALF_DEPTH - 0.4) },
      west: { x: -(HALF_WIDTH - 0.4), z: 0 },
    };

    let tick = 0;
    set.step(0, 0, tick++);
    for (const dir of ["south", "east", "north", "west"] as const) {
      set.step(insets[dir].x, insets[dir].z, tick++);
      set.step(0, 0, tick++);
    }

    // Expect 4 enters and 4 exits, paired and in walk order.
    const sequence = events.map((e) => `${e.kind}:${e.portal.direction}`);
    expect(sequence).toEqual([
      "enter:south",
      "exit:south",
      "enter:east",
      "exit:east",
      "enter:north",
      "exit:north",
      "enter:west",
      "exit:west",
    ]);
  });
});
