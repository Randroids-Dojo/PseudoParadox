import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createGhost } from "../../src/sim/ghostInstance.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import { createTimelineRegistry } from "../../src/sim/timelineRegistry.ts";
import { despawnGhostsAtLitPortals } from "../../src/sim/ghostDespawn.ts";
import { createPortalTriggerSet } from "../../src/sim/portalTrigger.ts";
import { createPortal, type Portal } from "../../src/sim/portal.ts";
import { createDoor, type DoorDirection } from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";
beforeAll(async () => {
  await RAPIER.init();
});

const buildWorld = (): RAPIER.World =>
  new RAPIER.World({ x: 0, y: -9.81, z: 0 });

const buildEmptyRecording = () => new InputRecorder().snapshot();

const makePortal = (
  direction: DoorDirection,
  destinationHours: number,
  isLit: boolean,
): Portal => {
  const door = createDoor(
    direction,
    ROOM_DIMENSIONS.width,
    ROOM_DIMENSIONS.depth,
  );
  return createPortal({ door, destinationHours, isLit });
};

const spawnGhostAt = (
  scene: THREE.Scene,
  world: RAPIER.World,
  position: { x: number; z: number },
) =>
  createGhost({
    recording: buildEmptyRecording(),
    originNormalized: 5 / 24,
    instanceId: 1,
    scene,
    world,
    startPosition: position,
  });

describe("despawnGhostsAtLitPortals", () => {
  it("despawns a ghost whose translation is inside a LIT portal trigger", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const south = makePortal("south", 12, true);
    const triggerSet = createPortalTriggerSet([south]);
    const trigger = triggerSet.triggers[0];

    // Spawn a ghost at the trigger center: guaranteed inside.
    const ghost = spawnGhostAt(scene, world, {
      x: trigger.centerX,
      z: trigger.centerZ,
    });
    registry.add(5, ghost);
    expect(registry.activeGhosts()).toHaveLength(1);

    const removed = despawnGhostsAtLitPortals(
      registry.activeGhosts().slice(),
      triggerSet.triggers,
      () => true,
      registry,
      scene,
      world,
    );

    expect(removed).toBe(1);
    expect(registry.activeGhosts()).toHaveLength(0);
    expect(scene.children).not.toContain(ghost.mesh);
  });

  it("does NOT despawn a ghost inside a DARK portal trigger", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const north = makePortal("north", 12, false);
    const triggerSet = createPortalTriggerSet([north]);
    const trigger = triggerSet.triggers[0];

    const ghost = spawnGhostAt(scene, world, {
      x: trigger.centerX,
      z: trigger.centerZ,
    });
    registry.add(5, ghost);

    const removed = despawnGhostsAtLitPortals(
      registry.activeGhosts().slice(),
      triggerSet.triggers,
      // The lit-state predicate reads from the portal's authored isLit (or
      // a per-timeline override in the host). In this test the predicate
      // mirrors the portal's own flag: dark stays dark.
      (portal) => portal.isLit,
      registry,
      scene,
      world,
    );

    expect(removed).toBe(0);
    expect(registry.activeGhosts()).toHaveLength(1);
    expect(scene.children).toContain(ghost.mesh);
  });

  it("despawns only the ghost(s) inside a lit trigger; leaves bystanders alone", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const south = makePortal("south", 12, true);
    const triggerSet = createPortalTriggerSet([south]);
    const trigger = triggerSet.triggers[0];

    const atDoor = spawnGhostAt(scene, world, {
      x: trigger.centerX,
      z: trigger.centerZ,
    });
    const inMiddle = spawnGhostAt(scene, world, { x: 0, z: 0 });
    registry.add(5, atDoor);
    registry.add(5, inMiddle);

    const removed = despawnGhostsAtLitPortals(
      registry.activeGhosts().slice(),
      triggerSet.triggers,
      () => true,
      registry,
      scene,
      world,
    );

    expect(removed).toBe(1);
    const remaining = registry.activeGhosts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(inMiddle);
  });

  it("is a no-op when no ghosts exist", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    const south = makePortal("south", 12, true);
    const triggerSet = createPortalTriggerSet([south]);

    const removed = despawnGhostsAtLitPortals(
      [],
      triggerSet.triggers,
      () => true,
      registry,
      scene,
      world,
    );

    expect(removed).toBe(0);
  });

  it("uses the supplied lit-state predicate, not the portal's authored flag", () => {
    // A portal is authored as dark, but the per-timeline predicate flips it
    // to lit (e.g. the arrivals body computes lit at runtime). The despawn
    // pass must follow the predicate, not the static field.
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const dark = makePortal("south", 12, false);
    const triggerSet = createPortalTriggerSet([dark]);
    const trigger = triggerSet.triggers[0];

    const ghost = spawnGhostAt(scene, world, {
      x: trigger.centerX,
      z: trigger.centerZ,
    });
    registry.add(5, ghost);

    const removed = despawnGhostsAtLitPortals(
      registry.activeGhosts().slice(),
      triggerSet.triggers,
      // Override: predicate reports lit even though the portal is authored dark.
      () => true,
      registry,
      scene,
      world,
    );

    expect(removed).toBe(1);
    expect(registry.activeGhosts()).toHaveLength(0);
  });
});

