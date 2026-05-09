import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ROOM_DIMENSIONS, buildRoom } from "../../src/scene/room.ts";
import {
  DOOR_DARK_COLOR_HEX,
  DOOR_LIT_COLOR_HEX,
  type DoorDirection,
} from "../../src/scene/door.ts";
import { doorLitStateAtHour } from "../../src/sim/doorStateAtTime.ts";
import { ACT_ONE_HOUR } from "../../src/sim/actOneAnchor.ts";

describe("room", () => {
  it("exposes square room dimensions matching the prototype spec", () => {
    expect(ROOM_DIMENSIONS.width).toBeGreaterThan(0);
    expect(ROOM_DIMENSIONS.depth).toBeGreaterThan(0);
    expect(ROOM_DIMENSIONS.height).toBeGreaterThan(0);
    // The prototype scope describes a single square room, so width and
    // depth should match. If a future slice intentionally changes this,
    // update the spec at docs/gdd/23-prototype-scope.md and this test.
    expect(ROOM_DIMENSIONS.width).toEqual(ROOM_DIMENSIONS.depth);
  });

  it("builds a group containing a floor, four walls, and four doors", () => {
    const room = buildRoom();
    // 1 floor + 4 walls + 4 doors.
    expect(room.group.children.length).toBe(9);
  });

  it("returns the four canonical Act 1 portals alongside the room group", () => {
    const room = buildRoom();
    expect(room.portals).toHaveLength(4);
    const directions = room.portals.map((p) => p.direction);
    expect(directions).toEqual(["south", "east", "north", "west"]);
  });

  it("paints South and East doors lit, North and West doors dark (REQ-013/REQ-014)", () => {
    const room = buildRoom();
    const doorMeshes = room.group.children.filter(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name.startsWith("door-"),
    );
    expect(doorMeshes).toHaveLength(4);

    const colorByDirection = new Map<DoorDirection, number>();
    for (const mesh of doorMeshes) {
      const direction = mesh.name.replace("door-", "") as DoorDirection;
      const material = mesh.material as THREE.MeshStandardMaterial;
      colorByDirection.set(direction, material.color.getHex());
    }

    expect(colorByDirection.get("south")).toBe(DOOR_LIT_COLOR_HEX);
    expect(colorByDirection.get("east")).toBe(DOOR_LIT_COLOR_HEX);
    expect(colorByDirection.get("north")).toBe(DOOR_DARK_COLOR_HEX);
    expect(colorByDirection.get("west")).toBe(DOOR_DARK_COLOR_HEX);
  });

  it("door painting flows through doorLitStateAtHour(ACT_ONE_HOUR)", () => {
    // End-to-end check that the room build's lit/dark stamping reads from
    // the same canonical table tested in `tests/sim/doorStateAtTime.test.ts`.
    // Future slices that re-paint on time change should keep this contract:
    // `room.group` doors agree with `doorLitStateAtHour(currentHour)` for
    // every cardinal direction.
    const room = buildRoom();
    const expectedLit = doorLitStateAtHour(ACT_ONE_HOUR);
    const doorMeshes = room.group.children.filter(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name.startsWith("door-"),
    );
    for (const mesh of doorMeshes) {
      const direction = mesh.name.replace("door-", "") as DoorDirection;
      const material = mesh.material as THREE.MeshStandardMaterial;
      const litColor = material.color.getHex() === DOOR_LIT_COLOR_HEX;
      expect(litColor).toBe(expectedLit[direction]);
    }
  });
});
