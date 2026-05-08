import { describe, expect, it } from "vitest";
import { ROOM_DIMENSIONS, buildRoom } from "../../src/scene/room.ts";

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
    expect(room.children.length).toBe(9);
  });
});
