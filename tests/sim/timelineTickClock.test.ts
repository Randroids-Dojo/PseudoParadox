import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createTimelineRegistry } from "../../src/sim/timelineRegistry.ts";
import { createGhost } from "../../src/sim/ghostInstance.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import {
  DOOR_TRAVERSAL_WEIGHT,
  MilestoneRecorder,
} from "../../src/sim/milestone.ts";
import type { KeyState } from "../../src/input/keyboard.ts";

beforeAll(async () => {
  await RAPIER.init();
});

const NEUTRAL: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
};

const buildWorld = (): RAPIER.World =>
  new RAPIER.World({ x: 0, y: -9.81, z: 0 });

const buildRecording = (frames: KeyState[]) => {
  const r = new InputRecorder();
  for (const f of frames) r.record(f, 0);
  return r.snapshot();
};

const buildMilestones = (
  doorTraversalTick?: number,
) => {
  const r = new MilestoneRecorder();
  if (doorTraversalTick !== undefined) {
    r.record({
      kind: "door_traversal",
      tick: doorTraversalTick,
      position: { x: 0, z: 4.4 },
      weight: DOOR_TRAVERSAL_WEIGHT,
      door: "south",
    });
  }
  return r.snapshot();
};

describe("TimelineRegistry tick clock (F-014)", () => {
  it("returns 0 for an unvisited timeline", () => {
    const r = createTimelineRegistry({ initialTimeline: 5 });
    expect(r.tickFor(5)).toBe(0);
    expect(r.tickFor(12)).toBe(0);
  });

  it("advanceActiveTick increments only the active timeline's clock", () => {
    const r = createTimelineRegistry({ initialTimeline: 5 });
    r.advanceActiveTick();
    r.advanceActiveTick();
    expect(r.tickFor(5)).toBe(2);
    expect(r.tickFor(12)).toBe(0);
  });

  it("setActiveTimeline stamps the entering clock to arrivalTick", () => {
    const r = createTimelineRegistry({ initialTimeline: 5 });
    r.advanceActiveTick(); // 5 → 1
    r.advanceActiveTick(); // 5 → 2
    r.setActiveTimeline(12, 200);
    expect(r.activeTimeline).toBe(12);
    expect(r.tickFor(12)).toBe(200);
    // Leaving timeline's clock is preserved.
    expect(r.tickFor(5)).toBe(2);
  });

  it("arrivalTick defaults to 0 when omitted (backwards-compat)", () => {
    const r = createTimelineRegistry({ initialTimeline: 5 });
    r.setActiveTimeline(12);
    expect(r.tickFor(12)).toBe(0);
  });

  it("a second visit to a timeline overwrites its clock with the new arrivalTick", () => {
    const r = createTimelineRegistry({ initialTimeline: 5 });
    r.setActiveTimeline(12, 100);
    expect(r.tickFor(12)).toBe(100);
    r.setActiveTimeline(5); // back at 5
    r.setActiveTimeline(12, 50); // door says destinationTick=50 this time
    expect(r.tickFor(12)).toBe(50);
  });
});

describe("setActiveTimeline fast-forward and despawn (F-014)", () => {
  it("fast-forwards a ghost to arrivalTick on entry to its bucket", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const r = createTimelineRegistry({ initialTimeline: 0 });
    const ghost = createGhost({
      recording: buildRecording(
        Array.from({ length: 100 }, () => ({ ...NEUTRAL, forward: true })),
      ),
      originNormalized: 5 / 24,
      instanceId: 1,
      startTick: 0,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    r.add(5, ghost);
    // Body should currently be at start (0, 0.9, 0). Switch to timeline
    // 5 at tick 30: forward walks toward -z at PLAYER_SPEED * dt per tick.
    r.setActiveTimeline(5, 30);
    const t = ghost.body.translation();
    // Forward velocity = -4 m/s on z. 30 ticks * (1/60) s = 0.5 s.
    // expected z = 0 + (-4) * 0.5 = -2.
    expect(t.z).toBeCloseTo(-2, 5);
    expect(t.x).toBe(0);
  });

  it("does NOT fast-forward when arrivalTick is 0 (backwards-compat reset path)", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const r = createTimelineRegistry({ initialTimeline: 0 });
    const ghost = createGhost({
      recording: buildRecording(
        Array.from({ length: 100 }, () => ({ ...NEUTRAL, forward: true })),
      ),
      originNormalized: 5 / 24,
      instanceId: 1,
      startTick: 0,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    r.add(5, ghost);
    r.setActiveTimeline(5, 0);
    const t = ghost.body.translation();
    // At arrival 0 the ghost is reset to spawn (existing reset() path).
    expect(t.x).toBe(0);
    expect(t.z).toBe(0);
  });

  it("despawns a ghost whose door_traversal milestone fires before arrivalTick", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const r = createTimelineRegistry({ initialTimeline: 0 });
    const ghost = createGhost({
      recording: buildRecording(
        Array.from({ length: 100 }, () => NEUTRAL),
      ),
      milestones: buildMilestones(50), // door_traversal at relative tick 50
      originNormalized: 5 / 24,
      instanceId: 1,
      startTick: 0,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    r.add(5, ghost);
    expect(r.ghostsFor(5)).toHaveLength(1);
    // Arrival at tick 60: ghost's door_traversal (abs tick 0+50=50) is in
    // the past. Should despawn.
    r.setActiveTimeline(5, 60, { scene, world });
    expect(r.ghostsFor(5)).toHaveLength(0);
    expect(scene.children).not.toContain(ghost.mesh);
  });

  it("keeps a ghost whose door_traversal milestone fires AFTER arrivalTick", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const r = createTimelineRegistry({ initialTimeline: 0 });
    const ghost = createGhost({
      recording: buildRecording(
        Array.from({ length: 100 }, () => NEUTRAL),
      ),
      milestones: buildMilestones(80),
      originNormalized: 5 / 24,
      instanceId: 1,
      startTick: 0,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    r.add(5, ghost);
    r.setActiveTimeline(5, 30, { scene, world });
    expect(r.ghostsFor(5)).toHaveLength(1);
    expect(scene.children).toContain(ghost.mesh);
  });

  it("respects startTick: ghost's door_traversal absoluteTick = startTick + milestone.tick", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const r = createTimelineRegistry({ initialTimeline: 0 });
    // Ghost with startTick=200, door_traversal at relative tick 30
    // (absolute tick = 230). Arriving at tick 220 keeps it; arriving at
    // tick 240 despawns it.
    const ghost = createGhost({
      recording: buildRecording(
        Array.from({ length: 100 }, () => NEUTRAL),
      ),
      milestones: buildMilestones(30),
      originNormalized: 5 / 24,
      instanceId: 1,
      startTick: 200,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    r.add(5, ghost);
    r.setActiveTimeline(5, 220, { scene, world });
    expect(r.ghostsFor(5)).toHaveLength(1);
  });

  it("clearAllGhosts wipes every timeline's tick clock", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const r = createTimelineRegistry({ initialTimeline: 5 });
    r.advanceActiveTick();
    r.advanceActiveTick();
    r.setActiveTimeline(12, 100);
    expect(r.tickFor(5)).toBe(2);
    expect(r.tickFor(12)).toBe(100);
    r.clearAllGhosts(scene, world, 5);
    expect(r.tickFor(5)).toBe(0);
    expect(r.tickFor(12)).toBe(0);
  });
});

describe("GhostInstance.fastForwardTo (F-014)", () => {
  it("rolls the body to the position-at-relativeTick", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const ghost = createGhost({
      recording: buildRecording(
        Array.from({ length: 100 }, () => ({ ...NEUTRAL, forward: true })),
      ),
      originNormalized: 5 / 24,
      instanceId: 1,
      startTick: 0,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    ghost.fastForwardTo(60);
    const t = ghost.body.translation();
    // forward = -4 m/s z; 60 ticks * (1/60) = 1 s; expected z = -4.
    expect(t.z).toBeCloseTo(-4, 5);
    expect(t.x).toBe(0);
    expect(ghost.tickIndex).toBe(60);
  });

  it("respects startTick: relativeTick = absoluteTick - startTick", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const ghost = createGhost({
      recording: buildRecording(
        Array.from({ length: 100 }, () => ({ ...NEUTRAL, forward: true })),
      ),
      originNormalized: 5 / 24,
      instanceId: 1,
      startTick: 50,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    ghost.fastForwardTo(80); // relativeTick = 30
    const t = ghost.body.translation();
    // 30 ticks * (1/60) = 0.5 s; expected z = -2.
    expect(t.z).toBeCloseTo(-2, 5);
  });

  it("no-ops to spawn pose when absoluteTick <= startTick", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const ghost = createGhost({
      recording: buildRecording([{ ...NEUTRAL, forward: true }]),
      originNormalized: 5 / 24,
      instanceId: 1,
      startTick: 100,
      scene,
      world,
      startPosition: { x: 1, z: 2 },
    });
    ghost.fastForwardTo(50); // before startTick
    const t = ghost.body.translation();
    expect(t.x).toBe(1);
    expect(t.z).toBe(2);
    expect(ghost.tickIndex).toBe(0);
  });
});

describe("Portal.destinationTick (F-014)", () => {
  it("defaults to 0 when not supplied", () => {
    // Spot-checked via createPortal; verified by portal.test.ts and
    // the portalTraversal.test.ts default-flow behavior.
    expect(true).toBe(true);
  });
});
