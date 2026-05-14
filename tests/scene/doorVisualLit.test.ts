/**
 * REQ-028 regression: door visual state matches the lit/dark predicate.
 *
 * Dossier: `docs/gdd/40-act-progress-and-narrative-beats.md` section 6.
 *
 * The visual paint path (`buildRoom` in `src/scene/room.ts` and
 * `repaintDoorsForHour` in `src/sim/timelineRoom.ts`) calls
 * `doorLitStateAtHour(hour)` directly today. The lit/dark gate
 * (`isLitForCurrentTimeline` in `src/sim/portalTraversal.ts`) reads through
 * `litStateForTimeline(timeline, { ghosts })`. F-006 will eventually unify
 * those into one call site; this slice only PINS that they agree on every
 * reachable hour by walking the four cardinals at hours 5, 6, 12 and
 * asserting the painted door's material color matches what
 * `litStateForTimeline(hour, { ghosts: [] })` returns. A second case
 * exercises the arrivals seam: with a `blockedByArrivals` body that
 * darkens an otherwise-lit cardinal, `repaintDoorsForHour` repainted via
 * the predicate-derived booleans flips the door material in place. (The
 * paint path is not yet wired through `litStateForTimeline`; that is F-006.
 * The regression injects the predicate's output into `applyDoorLitState`
 * directly to PROVE the visual layer reacts to predicate state changes,
 * which is what REQ-028 requires.)
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyDoorLitState,
  createFourDoors,
  DOOR_AFFORDANCE_NAMES,
  DOOR_DARK_COLOR_HEX,
  DOOR_LIT_COLOR_HEX,
  type DoorDirection,
} from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS, buildRoom } from "../../src/scene/room.ts";
import {
  repaintDoorsForHour,
} from "../../src/sim/timelineRoom.ts";
import {
  litStateForTimeline,
  type BlockedByArrivals,
} from "../../src/sim/litStateForTimeline.ts";
import type { GhostInstance } from "../../src/sim/ghostInstance.ts";
import { createPortal, type Portal } from "../../src/sim/portal.ts";
import { ACT_ONE_HOUR } from "../../src/sim/actOneAnchor.ts";

const NO_GHOSTS: readonly GhostInstance[] = [];
const CARDINALS: readonly DoorDirection[] = ["north", "south", "east", "west"];

const colorHex = (mesh: THREE.Mesh): number =>
  (mesh.material as THREE.MeshStandardMaterial).color.getHex();

const emissiveIntensity = (mesh: THREE.Mesh): number =>
  (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity;

const litAffordanceVisible = (mesh: THREE.Mesh): boolean =>
  mesh.getObjectByName(DOOR_AFFORDANCE_NAMES.lit)?.visible ?? false;

const darkAffordanceVisible = (mesh: THREE.Mesh): boolean =>
  mesh.getObjectByName(DOOR_AFFORDANCE_NAMES.dark)?.visible ?? false;

const doorMeshesByDirection = (
  group: THREE.Group,
): Map<DoorDirection, THREE.Mesh> => {
  const out = new Map<DoorDirection, THREE.Mesh>();
  for (const child of group.children) {
    if (child instanceof THREE.Mesh && child.name.startsWith("door-")) {
      const direction = child.name.replace("door-", "") as DoorDirection;
      out.set(direction, child);
    }
  }
  return out;
};

describe("REQ-028: door visual lit/dark matches the predicate", () => {
  it("at the Act 1 anchor (5:00) door materials agree with `litStateForTimeline(5, { ghosts: [] })`", () => {
    expect(ACT_ONE_HOUR).toBe(5);
    const room = buildRoom();
    const expected = litStateForTimeline(5, { ghosts: NO_GHOSTS });
    expect(expected).not.toBeNull();
    const doors = doorMeshesByDirection(room.group);

    for (const direction of CARDINALS) {
      const mesh = doors.get(direction);
      expect(mesh).toBeDefined();
      const expectedLit = expected![direction];
      const actualLit = colorHex(mesh!) === DOOR_LIT_COLOR_HEX;
      expect(actualLit).toBe(expectedLit);
      // Smoke: lit doors emissive > 0; dark doors emissive === 0.
      if (expectedLit) {
        expect(emissiveIntensity(mesh!)).toBeGreaterThan(0);
        expect(litAffordanceVisible(mesh!)).toBe(true);
        expect(darkAffordanceVisible(mesh!)).toBe(false);
      } else {
        expect(emissiveIntensity(mesh!)).toBe(0);
        expect(litAffordanceVisible(mesh!)).toBe(false);
        expect(darkAffordanceVisible(mesh!)).toBe(true);
      }
    }
  });

  it("at 6:00 the repainted doors agree with `litStateForTimeline(6, { ghosts: [] })`", () => {
    // Build a fresh portal set (any initial isLit; repaint reads from the
    // hour table, not from `portal.isLit`).
    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals: readonly Portal[] = doors.map((d) =>
      createPortal({ door: d, destinationHours: 5, isLit: false }),
    );
    repaintDoorsForHour(portals, 6);
    const expected = litStateForTimeline(6, { ghosts: NO_GHOSTS });
    expect(expected).not.toBeNull();

    for (const portal of portals) {
      const expectedLit = expected![portal.direction];
      const actualLit = colorHex(portal.door.mesh) === DOOR_LIT_COLOR_HEX;
      expect(actualLit).toBe(expectedLit);
      if (expectedLit) {
        expect(emissiveIntensity(portal.door.mesh)).toBeGreaterThan(0);
      } else {
        expect(emissiveIntensity(portal.door.mesh)).toBe(0);
      }
    }
  });

  it("at 12:00 the seed lights only the North door and the paint path agrees (REQ-023)", () => {
    // Hour 12 is the Act 3 escape timeline. The seed authors `north: true`
    // (the escape door); `litStateForTimeline`'s arrivals body darkens
    // North while the cinematic actors have not yet completed, but with
    // `NO_GHOSTS` (no scripted-actor recordings in flight) the seed reads
    // through unchanged.
    const expected = litStateForTimeline(12, { ghosts: NO_GHOSTS });
    expect(expected).not.toBeNull();
    expect(expected!.north).toBe(true);
    expect(expected!.south).toBe(false);
    expect(expected!.east).toBe(false);
    expect(expected!.west).toBe(false);

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals: readonly Portal[] = doors.map((d) =>
      createPortal({ door: d, destinationHours: 5, isLit: false }),
    );
    repaintDoorsForHour(portals, 12);
    for (const portal of portals) {
      const expectedLit = expected![portal.direction];
      const actualLit = colorHex(portal.door.mesh) === DOOR_LIT_COLOR_HEX;
      expect(actualLit).toBe(expectedLit);
    }
  });

  it("door visuals react to a predicate state change via the arrivals seam", () => {
    // The arrivals predicate is the data path that future Acts 2-3 beats
    // populate. Today the default body returns `false` everywhere, so the
    // visual matches the seed. Inject a body that blocks the East door at
    // 5:00 and confirm the predicate flips that cardinal to dark, then
    // confirm a paint pass driven by the predicate's output flips the
    // door's material color in place. This is the regression that pins
    // "door material updates when the predicate changes" rather than
    // being set once at construction and never re-read.
    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    // Seed the doors at 5:00 lit/dark via the default predicate.
    const seedState = litStateForTimeline(5, { ghosts: NO_GHOSTS });
    expect(seedState).not.toBeNull();
    for (const door of doors) {
      applyDoorLitState(door, seedState![door.direction]);
    }
    const byDirection = new Map<DoorDirection, typeof doors[number]>();
    for (const d of doors) byDirection.set(d.direction, d);
    // Sanity: East starts lit per the 5:00 seed.
    expect(colorHex(byDirection.get("east")!.mesh)).toBe(DOOR_LIT_COLOR_HEX);

    // Inject an arrivals rule that blocks East. The seam's contract is
    // `seed && !blockedByArrivals`; East is seeded lit, blocked = true,
    // so the predicate flips East to dark.
    const blockEast: BlockedByArrivals = (_ghosts, cardinal) =>
      cardinal === "east";
    const after = litStateForTimeline(5, {
      ghosts: NO_GHOSTS,
      blockedByArrivals: blockEast,
    });
    expect(after).not.toBeNull();
    expect(after!.east).toBe(false);
    expect(after!.south).toBe(true);

    // Drive a paint pass from the predicate's output. The same
    // `applyDoorLitState` mutator the production paint path uses must
    // accept the new boolean and flip the material in place.
    for (const door of doors) {
      applyDoorLitState(door, after![door.direction]);
    }
    expect(colorHex(byDirection.get("east")!.mesh)).toBe(DOOR_DARK_COLOR_HEX);
    expect(emissiveIntensity(byDirection.get("east")!.mesh)).toBe(0);
    expect(litAffordanceVisible(byDirection.get("east")!.mesh)).toBe(false);
    expect(darkAffordanceVisible(byDirection.get("east")!.mesh)).toBe(true);
    // South stays lit; North and West stay dark.
    expect(colorHex(byDirection.get("south")!.mesh)).toBe(DOOR_LIT_COLOR_HEX);
    expect(colorHex(byDirection.get("north")!.mesh)).toBe(DOOR_DARK_COLOR_HEX);
    expect(colorHex(byDirection.get("west")!.mesh)).toBe(DOOR_DARK_COLOR_HEX);
  });
});
