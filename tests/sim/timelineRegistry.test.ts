import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  createTimelineRegistry,
  timelineIdFromNormalized,
} from "../../src/sim/timelineRegistry.ts";
import { createGhost } from "../../src/sim/ghostInstance.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
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

const state = (overrides: Partial<KeyState>): KeyState => ({
  ...NEUTRAL,
  ...overrides,
});

const buildWorld = (): RAPIER.World =>
  new RAPIER.World({ x: 0, y: -9.81, z: 0 });

const buildRecording = (frames: KeyState[]) => {
  const r = new InputRecorder();
  for (const f of frames) r.record(f, 0);
  return r.snapshot();
};

const spawnTestGhost = (
  scene: THREE.Scene,
  world: RAPIER.World,
  startPosition: { x: number; z: number },
) =>
  createGhost({
    recording: buildRecording([
      state({ forward: true }),
      state({ forward: true }),
    ]),
    originNormalized: 5 / 24,
    instanceId: 1,
    scene,
    world,
    startPosition,
  });

describe("timelineIdFromNormalized", () => {
  it("maps 5/24 to 5", () => {
    expect(timelineIdFromNormalized(5 / 24)).toBe(5);
  });

  it("maps 6/24 to 6", () => {
    expect(timelineIdFromNormalized(6 / 24)).toBe(6);
  });

  it("maps 12/24 to 12", () => {
    expect(timelineIdFromNormalized(12 / 24)).toBe(12);
  });

  it("wraps 1.0 to 0 (midnight)", () => {
    expect(timelineIdFromNormalized(1.0)).toBe(0);
  });

  it("rejects non-finite inputs", () => {
    expect(() => timelineIdFromNormalized(Number.NaN)).toThrow();
    expect(() => timelineIdFromNormalized(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("createTimelineRegistry: bucketing", () => {
  it("ghostsFor returns empty for an unvisited timeline (REQ-006)", () => {
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    expect(registry.ghostsFor(5)).toEqual([]);
    expect(registry.ghostsFor(6)).toEqual([]);
    expect(registry.ghostsFor(12)).toEqual([]);
  });

  it("add files a ghost into the requested timeline bucket", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });

    registry.add(5, ghost);
    expect(registry.ghostsFor(5)).toHaveLength(1);
    expect(registry.ghostsFor(5)[0]).toBe(ghost);
    expect(registry.ghostsFor(6)).toEqual([]);
  });

  it("activeGhosts returns only ghosts in the current active timeline", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const a = spawnTestGhost(scene, world, { x: 1, z: 0 });
    const b = spawnTestGhost(scene, world, { x: 0, z: 1 });
    registry.add(5, a);
    registry.add(6, b);

    const active = registry.activeGhosts();
    expect(active).toHaveLength(1);
    expect(active[0]).toBe(a);
  });

  it("rejects an out-of-range initialTimeline", () => {
    expect(() => createTimelineRegistry({ initialTimeline: -1 })).toThrow();
    expect(() => createTimelineRegistry({ initialTimeline: 24 })).toThrow();
    expect(() => createTimelineRegistry({ initialTimeline: 5.5 })).toThrow();
  });
});

describe("createTimelineRegistry: visibility on add", () => {
  it("filing a ghost into the ACTIVE timeline leaves it visible", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    registry.add(5, ghost);
    expect(ghost.mesh.visible).toBe(true);
  });

  it("filing a ghost into a NON-active timeline hides it (REQ-001 / REQ-003)", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    // Inject a non-zero velocity so the registry's "still the body" half can
    // be observed.
    ghost.body.setLinvel({ x: 4, y: 0, z: -2 }, true);
    registry.add(6, ghost);
    expect(ghost.mesh.visible).toBe(false);
    const v = ghost.body.linvel();
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });
});

describe("createTimelineRegistry: setActiveTimeline", () => {
  it("hides every ghost in the leaving timeline", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const a = spawnTestGhost(scene, world, { x: 0, z: 0 });
    const b = spawnTestGhost(scene, world, { x: 1, z: 0 });
    registry.add(5, a);
    registry.add(5, b);
    expect(a.mesh.visible).toBe(true);
    expect(b.mesh.visible).toBe(true);

    registry.setActiveTimeline(6);
    expect(a.mesh.visible).toBe(false);
    expect(b.mesh.visible).toBe(false);
  });

  it("resets every ghost in the entering timeline to tick 0 and shows it", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    // Spawn a ghost at (0, 0) and file it into timeline 6 (non-active).
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    registry.add(6, ghost);
    expect(ghost.mesh.visible).toBe(false);

    // Advance the ghost a few ticks so its body translates and tickIndex
    // grows. Step the world to integrate the planar velocity.
    world.timestep = 1 / 60;
    ghost.advanceTick();
    world.step();
    ghost.advanceTick();
    world.step();
    expect(ghost.tickIndex).toBeGreaterThan(0);

    // Switch the active timeline to 6: the ghost should reset.
    registry.setActiveTimeline(6);
    expect(ghost.mesh.visible).toBe(true);
    expect(ghost.tickIndex).toBe(0);
    const t = ghost.body.translation();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(0, 6);
    const v = ghost.body.linvel();
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("activeTimeline reflects the most recent setActiveTimeline call", () => {
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    expect(registry.activeTimeline).toBe(5);
    registry.setActiveTimeline(6);
    expect(registry.activeTimeline).toBe(6);
    registry.setActiveTimeline(12);
    expect(registry.activeTimeline).toBe(12);
  });

  it("is a no-op when next equals the current active timeline", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    registry.add(5, ghost);
    // Advance a few ticks so a reset would observably change tickIndex.
    ghost.advanceTick();
    ghost.advanceTick();
    const tickBefore = ghost.tickIndex;

    registry.setActiveTimeline(5);

    expect(ghost.tickIndex).toBe(tickBefore);
    expect(ghost.mesh.visible).toBe(true);
  });
});

describe("createTimelineRegistry: end-to-end Act 2 first-loop shape", () => {
  it("recording at 5:00 then traversing to 6:00 hides the recording, return to 5:00 replays it", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    // Spawn a ghost recorded at 5:00 (tinted at 5/24, filed into timeline 5).
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    registry.add(5, ghost);
    expect(ghost.mesh.visible).toBe(true);

    // Player traverses East to 6:00: the registry switches active to 6.
    registry.setActiveTimeline(6);
    expect(registry.activeTimeline).toBe(6);
    expect(ghost.mesh.visible).toBe(false);
    expect(registry.activeGhosts()).toEqual([]);

    // Player traverses West back to 5:00: the registry switches active to 5
    // and resets every ghost in that bucket to tick 0.
    registry.setActiveTimeline(5);
    expect(registry.activeTimeline).toBe(5);
    expect(ghost.mesh.visible).toBe(true);
    expect(ghost.tickIndex).toBe(0);
    const active = registry.activeGhosts();
    expect(active).toHaveLength(1);
    expect(active[0]).toBe(ghost);
  });
});

describe("createTimelineRegistry: removeGhost (F-012)", () => {
  it("removes a ghost from its bucket and disposes its scene/world resources", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });

    registry.add(5, ghost);
    expect(registry.activeGhosts()).toHaveLength(1);
    expect(scene.children).toContain(ghost.mesh);

    const removed = registry.removeGhost(ghost, scene, world);
    expect(removed).toBe(true);
    expect(registry.activeGhosts()).toHaveLength(0);
    expect(registry.ghostsFor(5)).toHaveLength(0);
    expect(scene.children).not.toContain(ghost.mesh);
  });

  it("returns false when the ghost is not in any bucket", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const stranger = spawnTestGhost(scene, world, { x: 0, z: 0 });

    const removed = registry.removeGhost(stranger, scene, world);
    expect(removed).toBe(false);
  });

  it("removes from non-active buckets too", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });

    registry.add(6, ghost);
    expect(registry.ghostsFor(6)).toHaveLength(1);

    const removed = registry.removeGhost(ghost, scene, world);
    expect(removed).toBe(true);
    expect(registry.ghostsFor(6)).toHaveLength(0);
  });

  it("subsequent activeGhosts excludes the removed ghost on the same tick", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const a = spawnTestGhost(scene, world, { x: 0, z: 0 });
    const b = spawnTestGhost(scene, world, { x: 1, z: 1 });

    registry.add(5, a);
    registry.add(5, b);
    expect(registry.activeGhosts()).toHaveLength(2);

    registry.removeGhost(a, scene, world);
    const remaining = registry.activeGhosts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(b);
  });
});

describe("createTimelineRegistry: rehomeGhost (F-007)", () => {
  it("moves a ghost from its source bucket to the destination bucket", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    registry.add(5, ghost);
    expect(registry.ghostsFor(5)).toHaveLength(1);
    expect(registry.ghostsFor(12)).toHaveLength(0);

    const moved = registry.rehomeGhost(ghost, 12);
    expect(moved).toBe(true);
    expect(registry.ghostsFor(5)).toHaveLength(0);
    expect(registry.ghostsFor(12)).toHaveLength(1);
    expect(registry.ghostsFor(12)[0]).toBe(ghost);
  });

  it("returns false for a ghost not in any bucket", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    const moved = registry.rehomeGhost(ghost, 12);
    expect(moved).toBe(false);
  });

  it("is idempotent when destination matches the current bucket", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    registry.add(5, ghost);
    const moved = registry.rehomeGhost(ghost, 5);
    expect(moved).toBe(true);
    expect(registry.ghostsFor(5)).toHaveLength(1);
  });

  it("does NOT remove the mesh from the scene (rehome is bookkeeping only)", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    scene.add(ghost.mesh);
    registry.add(5, ghost);
    registry.rehomeGhost(ghost, 12);
    expect(scene.children.includes(ghost.mesh)).toBe(true);
  });

  it("hides the mesh when rehoming OUT of the active timeline", () => {
    // F-007 visibility reconciliation: a ghost rehomed from the active
    // bucket should be hidden so it does not paint in the wrong timeline.
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    registry.add(5, ghost);
    expect(ghost.mesh.visible).toBe(true);
    registry.rehomeGhost(ghost, 12);
    expect(ghost.mesh.visible).toBe(false);
  });

  it("shows the mesh when rehoming INTO the active timeline", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const ghost = spawnTestGhost(scene, world, { x: 0, z: 0 });
    registry.add(12, ghost);
    // bucket 12 is non-active; add hides it.
    expect(ghost.mesh.visible).toBe(false);
    registry.rehomeGhost(ghost, 5);
    expect(ghost.mesh.visible).toBe(true);
  });
});

describe("createTimelineRegistry: findGhostByInstanceId (F-007)", () => {
  it("returns the ghost when present in any bucket", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const a = createGhost({
      recording: buildRecording([state({ forward: true })]),
      originNormalized: 5 / 24,
      instanceId: 11,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    const b = createGhost({
      recording: buildRecording([state({ forward: true })]),
      originNormalized: 12 / 24,
      instanceId: 22,
      scene,
      world,
      startPosition: { x: 1, z: 1 },
    });
    registry.add(5, a);
    registry.add(12, b);
    expect(registry.findGhostByInstanceId(11)).toBe(a);
    expect(registry.findGhostByInstanceId(22)).toBe(b);
  });

  it("returns undefined when no bucket holds a ghost with that id", () => {
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    expect(registry.findGhostByInstanceId(999)).toBeUndefined();
  });
});
