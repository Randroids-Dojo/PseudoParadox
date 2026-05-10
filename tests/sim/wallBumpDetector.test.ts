import { describe, expect, it } from "vitest";
import { createWallBumpDetector } from "../../src/sim/wallBumpDetector.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";
import { PLAYER_CAPSULE } from "../../src/scene/player.ts";

const HALF_W = ROOM_DIMENSIONS.width / 2;
const HALF_D = ROOM_DIMENSIONS.depth / 2;
const R = PLAYER_CAPSULE.radius;

describe("createWallBumpDetector", () => {
  it("starts with no walls in contact", () => {
    const d = createWallBumpDetector();
    expect(d.inContactWith("north")).toBe(false);
    expect(d.inContactWith("south")).toBe(false);
    expect(d.inContactWith("east")).toBe(false);
    expect(d.inContactWith("west")).toBe(false);
  });

  it("emits no enters when the player is at room center", () => {
    const d = createWallBumpDetector();
    const enters = d.step(0, 0, R);
    expect(enters).toEqual([]);
  });

  it("emits a north-wall enter when the player presses against the north wall", () => {
    const d = createWallBumpDetector();
    // First step: away from any wall.
    d.step(0, 0, R);
    // Second step: pressed against the north wall (z = -HALF_D + thickness/2 + R).
    const enters = d.step(0, -HALF_D + R, R);
    expect(enters).toEqual(["north"]);
    expect(d.inContactWith("north")).toBe(true);
  });

  it("does NOT re-emit on subsequent ticks while still in contact (slide along wall)", () => {
    const d = createWallBumpDetector();
    d.step(0, 0, R);
    const first = d.step(0, -HALF_D + R, R);
    expect(first).toEqual(["north"]);
    // Sliding east along the same wall: still in contact, no re-emit.
    const second = d.step(1, -HALF_D + R, R);
    expect(second).toEqual([]);
    const third = d.step(2, -HALF_D + R, R);
    expect(third).toEqual([]);
  });

  it("re-emits after the player leaves and returns to contact", () => {
    const d = createWallBumpDetector();
    d.step(0, 0, R);
    expect(d.step(0, -HALF_D + R, R)).toEqual(["north"]);
    // Walk back to room center: not in contact.
    d.step(0, 0, R);
    expect(d.inContactWith("north")).toBe(false);
    // Walk back to the wall: fresh enter.
    expect(d.step(0, -HALF_D + R, R)).toEqual(["north"]);
  });

  it("emits two walls on a corner pinch (north-east)", () => {
    const d = createWallBumpDetector();
    d.step(0, 0, R);
    const enters = d.step(HALF_W - R, -HALF_D + R, R);
    expect([...enters].sort()).toEqual(["east", "north"]);
  });

  it("south, east, west walls also trigger their own enters", () => {
    const south = createWallBumpDetector();
    south.step(0, 0, R);
    expect(south.step(0, HALF_D - R, R)).toEqual(["south"]);

    const east = createWallBumpDetector();
    east.step(0, 0, R);
    expect(east.step(HALF_W - R, 0, R)).toEqual(["east"]);

    const west = createWallBumpDetector();
    west.step(0, 0, R);
    expect(west.step(-HALF_W + R, 0, R)).toEqual(["west"]);
  });

  it("respects the supplied capsule radius (a smaller capsule needs to get closer)", () => {
    const small = 0.1;
    const d = createWallBumpDetector();
    d.step(0, 0, small);
    // At z = -4.5 (the radius=0.4 capsule contact band) but with radius=0.1
    // the small capsule is NOT yet in contact.
    expect(d.step(0, -4.5, small)).toEqual([]);
    // At z = -HALF_D + small the small capsule IS in contact.
    expect(d.step(0, -HALF_D + small, small)).toEqual(["north"]);
  });
});
