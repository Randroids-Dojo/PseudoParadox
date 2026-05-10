import { describe, expect, it, beforeAll, vi } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  wireTraversal,
  type ActiveLifetime,
  type ActivePlayerHandle,
} from "../../src/sim/portalTraversal.ts";
import { createPortalTriggerSet } from "../../src/sim/portalTrigger.ts";
import {
  createPortal,
  createActOnePortals,
  HOURS_PER_DAY,
  type Portal,
} from "../../src/sim/portal.ts";
import {
  createDoor,
  createFourDoors,
  type DoorDirection,
} from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import { MilestoneRecorder } from "../../src/sim/milestone.ts";
import { PLAYER_CAPSULE } from "../../src/scene/player.ts";
import { applyInstanceTint } from "../../src/render/instanceTint.ts";
import type { GhostInstance } from "../../src/sim/ghostInstance.ts";
import type { KeyState } from "../../src/input/keyboard.ts";
import { interpolateWarmToCool } from "../../src/render/colorTint.ts";
import {
  createTimelineRegistry,
  type TimelineRegistry,
} from "../../src/sim/timelineRegistry.ts";

// The traversal harness keys the registry on hour 0 so the FIRST lit-portal
// entry files the spawned ghost into a non-active bucket (the "leaving"
// timeline) and switches the active bucket to the destination hour. Tests
// that need the leaving-timeline-equals-active behavior call
// `registry.setActiveTimeline(0)` before the trigger fires; tests that want
// the standard "left behind" semantics use the default (active = 0, leave =
// origin time, destination = portal hour).
const HARNESS_INITIAL_TIMELINE = 0;

beforeAll(async () => {
  await RAPIER.init();
});

const HALF_DEPTH = ROOM_DIMENSIONS.depth / 2;
const HALF_WIDTH = ROOM_DIMENSIONS.width / 2;

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

const makePortal = (
  direction: DoorDirection,
  destinationHours: number,
  isLit: boolean,
): Portal => {
  const door = createDoor(direction, ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
  return createPortal({ door, destinationHours, isLit });
};

interface Harness {
  scene: THREE.Scene;
  world: RAPIER.World;
  player: ActivePlayerHandle;
  lifetime: ActiveLifetime;
  registry: TimelineRegistry;
}

const makePlayerBody = (world: RAPIER.World): RAPIER.RigidBody => {
  const { radius, cylinderLength } = PLAYER_CAPSULE;
  const restY = cylinderLength / 2 + radius;
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, restY, 0)
    .enabledRotations(false, true, false);
  const body = world.createRigidBody(desc);
  const collider = RAPIER.ColliderDesc.capsule(cylinderLength / 2, radius);
  world.createCollider(collider, body);
  return body;
};

const makePlayerMesh = (): THREE.Mesh => {
  const geom = new THREE.CapsuleGeometry(
    PLAYER_CAPSULE.radius,
    PLAYER_CAPSULE.cylinderLength,
    8,
    16,
  );
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(geom, mat);
  // Stamp at warm anchor so test can detect re-stamping later.
  applyInstanceTint(mesh, 0);
  return mesh;
};

const buildHarness = (): Harness => {
  const scene = new THREE.Scene();
  const world = buildWorld();
  const body = makePlayerBody(world);
  const mesh = makePlayerMesh();
  scene.add(mesh);
  const player: ActivePlayerHandle = {
    body,
    mesh,
    originNormalized: 0,
    instanceId: 1,
    consciousness: "conscious",
    carry: { kind: "idle" },
  };
  const lifetime: ActiveLifetime = {
    startPosition: { x: 0, z: 0 },
    recorder: new InputRecorder(),
    milestones: new MilestoneRecorder(),
    originNormalized: 0,
    instanceId: 1,
  };
  const registry = createTimelineRegistry({
    initialTimeline: HARNESS_INITIAL_TIMELINE,
  });
  return { scene, world, player, lifetime, registry };
};

/**
 * Capture every ghost the registry has filed across all timelines, in
 * insertion order. Tests assert against this rather than a single bucket so
 * a leaving-timeline ghost (which is hidden but persisted) is still visible
 * to the test, the same way the previous flat `ghosts: GhostInstance[]`
 * harness made spawned ghosts visible.
 */
const allGhosts = (registry: TimelineRegistry): GhostInstance[] => {
  const seen = new Set<GhostInstance>();
  // Probe known prototype timelines: 0..23. Cheap; the registry rejects
  // out-of-range hours at the boundary.
  const out: GhostInstance[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (const ghost of registry.ghostsFor(hour)) {
      if (seen.has(ghost)) continue;
      seen.add(ghost);
      out.push(ghost);
    }
  }
  return out;
};

describe("wireTraversal: lit portal entry", () => {
  it("snapshots the lifetime recording into a ghost on lit-portal enter", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // Record some frames into the lifetime so the spawned ghost has a
    // recording to play back.
    lifetime.recorder.record(state({ forward: true }), 0);
    lifetime.recorder.record(state({ forward: true }), 0);
    lifetime.recorder.record(state({ forward: true }), 0);

    // Step the player into the south trigger.
    detector.step(0, HALF_DEPTH - 0.4, 0);

    const ghosts = allGhosts(registry);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].body).toBeDefined();
  });

  it("records a door_traversal milestone on the leaving lifetime and snapshots it onto the ghost (F-013 PR3a)", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(state({ back: true }), 0);
    lifetime.recorder.record(state({ back: true }), 0);

    detector.step(0, HALF_DEPTH - 0.4, 0);

    const ghosts = allGhosts(registry);
    expect(ghosts).toHaveLength(1);
    const ghost = ghosts[0];
    expect(ghost.milestones.length).toBe(1);
    const m = ghost.milestones.milestones[0];
    expect(m.kind).toBe("door_traversal");
    if (m.kind !== "door_traversal") throw new Error("unreachable");
    expect(m.door).toBe("south");
    expect(m.weight).toBe(5);
    // Tick equals the recorder length at the moment of traversal (2).
    expect(m.tick).toBe(2);
  });

  it("milestone recorder is reset on the new lifetime after traversal", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(state({ forward: true }), 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(lifetime.milestones.length).toBe(0);
  });

  it("ghost is tinted at the LIFETIME's origin normalized (the timeline being left behind)", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 0.25;
    player.originNormalized = 0.25;
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    const ghosts = allGhosts(registry);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].originNormalized).toBe(0.25);
    const mat = ghosts[0].mesh.material as THREE.MeshStandardMaterial;
    const expected = interpolateWarmToCool(0.25);
    expect(mat.color.r).toBeCloseTo(expected.r, 6);
    expect(mat.color.g).toBeCloseTo(expected.g, 6);
    expect(mat.color.b).toBeCloseTo(expected.b, 6);
  });

  it("ghost spawns at the lifetime's start position, not the player's current pose", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.startPosition = { x: 1.5, z: -2.25 };
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    const ghosts = allGhosts(registry);
    expect(ghosts).toHaveLength(1);
    const t = ghosts[0].body.translation();
    expect(t.x).toBeCloseTo(1.5, 6);
    expect(t.z).toBeCloseTo(-2.25, 6);
  });

  it("teleports the active player to the destination spawn pose (room center default)", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    // Move the player to the trigger zone before the step.
    player.body.setTranslation(
      { x: 0, y: player.body.translation().y, z: HALF_DEPTH - 0.4 },
      true,
    );
    detector.step(0, HALF_DEPTH - 0.4, 0);

    const t = player.body.translation();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(0, 6);
  });

  it("zeros the active player's velocity on traversal", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    player.body.setLinvel({ x: 3, y: -2, z: -4 }, true);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    const v = player.body.linvel();
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("re-stamps player.originNormalized to the destination time normalized", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(player.originNormalized).toBeCloseTo(12 / HOURS_PER_DAY, 6);
  });

  it("re-tints the active player's mesh to the destination color", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    const mat = player.mesh.material as THREE.MeshStandardMaterial;
    const expected = interpolateWarmToCool(12 / HOURS_PER_DAY);
    expect(mat.color.r).toBeCloseTo(expected.r, 6);
    expect(mat.color.g).toBeCloseTo(expected.g, 6);
    expect(mat.color.b).toBeCloseTo(expected.b, 6);
  });

  it("opens a fresh lifetime keyed at tick 0 of the destination timeline", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    lifetime.recorder.record(NEUTRAL, 0);
    expect(lifetime.recorder.length).toBe(2);
    const oldRecorder = lifetime.recorder;

    detector.step(0, HALF_DEPTH - 0.4, 0);

    // A fresh recorder at tick 0.
    expect(lifetime.recorder).not.toBe(oldRecorder);
    expect(lifetime.recorder.length).toBe(0);
    expect(lifetime.originNormalized).toBeCloseTo(12 / HOURS_PER_DAY, 6);
    expect(lifetime.startPosition.x).toBeCloseTo(0, 6);
    expect(lifetime.startPosition.z).toBeCloseTo(0, 6);
  });
});

describe("wireTraversal: dark portal filtering (REQ-010)", () => {
  it("does NOT spawn a ghost on dark-portal enter", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const dark = makePortal("south", 12, false);
    const detector = createPortalTriggerSet([dark]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(allGhosts(registry)).toHaveLength(0);
  });

  it("does NOT teleport the player on dark-portal enter", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const dark = makePortal("south", 12, false);
    const detector = createPortalTriggerSet([dark]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    const sentinelX = 1.234;
    const sentinelZ = HALF_DEPTH - 0.4;
    player.body.setTranslation(
      { x: sentinelX, y: player.body.translation().y, z: sentinelZ },
      true,
    );
    detector.step(sentinelX, sentinelZ, 0);

    const t = player.body.translation();
    expect(t.x).toBeCloseTo(sentinelX, 6);
    expect(t.z).toBeCloseTo(sentinelZ, 6);
  });

  it("does NOT swap the lifetime recorder on dark-portal enter", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const dark = makePortal("south", 12, false);
    const detector = createPortalTriggerSet([dark]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    const oldRecorder = lifetime.recorder;
    detector.step(0, HALF_DEPTH - 0.4, 0);
    expect(lifetime.recorder).toBe(oldRecorder);
    expect(lifetime.recorder.length).toBe(1);
  });

  it("REQ-010 regression: walking into the West dark portal at 5:00 leaves the player capsule's translation unchanged", () => {
    // Dossier section 11 asks for a regression that simulates the player
    // walking into a dark portal trigger (the West door at 5:00 is the
    // canonical case from `ACT_ONE_PORTAL_SPECS`) and asserts the active
    // player's translation is unchanged after the trigger fires. Uses the
    // canonical Act 1 portal set (NOT a hand-rolled portal) so the test
    // exercises the same data path the production room build uses.
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 5 / 24;
    player.originNormalized = 5 / 24;
    registry.setActiveTimeline(5);

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // West dark portal sits at -HALF_WIDTH; the trigger volume reaches
    // 0.4m inward. Place the player just inside the trigger.
    const sentinelX = -(HALF_WIDTH - 0.4);
    const sentinelY = player.body.translation().y;
    const sentinelZ = 0;
    player.body.setTranslation(
      { x: sentinelX, y: sentinelY, z: sentinelZ },
      true,
    );

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(sentinelX, sentinelZ, 0);

    // Player capsule's translation is unchanged (no teleport on dark entry).
    const t = player.body.translation();
    expect(t.x).toBeCloseTo(sentinelX, 6);
    expect(t.y).toBeCloseTo(sentinelY, 6);
    expect(t.z).toBeCloseTo(sentinelZ, 6);
    // Active timeline did not switch (no traversal).
    expect(registry.activeTimeline).toBe(5);
    // No ghost was spawned.
    expect(allGhosts(registry)).toHaveLength(0);
  });
});

describe("wireTraversal: empty recording handling", () => {
  it("does NOT spawn a ghost when the lifetime recording is empty (no visual noise)", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // No record() calls before the trigger fires.
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(allGhosts(registry)).toHaveLength(0);
    // ... but still teleports the player and resets the lifetime.
    const t = player.body.translation();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(0, 6);
    expect(lifetime.originNormalized).toBeCloseTo(12 / HOURS_PER_DAY, 6);
  });
});

describe("wireTraversal: exit and dispose semantics", () => {
  it("ignores `exit` events", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0); // enter
    expect(allGhosts(registry)).toHaveLength(1);
    detector.step(0, 0, 1); // exit
    expect(allGhosts(registry)).toHaveLength(1);
  });

  it("dispose() unsubscribes from the detector", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    const handle = wireTraversal({
      detector,
      player,
      lifetime,
      scene,
      world,
      registry,
    });

    handle.dispose();
    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(allGhosts(registry)).toHaveLength(0);
  });
});

describe("wireTraversal: multi-portal sequence", () => {
  it("at 5:00 ghost list grows by one per LIT entry, stays the same for DARK entries", () => {
    // Active timeline pinned to 5:00 so the table-derived lit/dark gate
    // (REQ-015) reads the canonical 5:00 state: South lit, East lit, North
    // dark, West dark. After a South entry the active timeline switches to
    // 12 (South's destination), where the table is unauthored and the gate
    // falls back to the portal's authored `isLit` field; the test therefore
    // hits North/West BEFORE leaving 5:00 to keep the timeline-derived gate
    // active throughout.
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 5 / 24;
    player.originNormalized = 5 / 24;
    registry.setActiveTimeline(5);

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    const recordSomething = (): void => {
      lifetime.recorder.record(NEUTRAL, 0);
    };

    let tick = 0;
    detector.step(0, 0, tick++); // outside

    // Dark north entry at 5:00: table[5][north] = false. No growth.
    recordSomething();
    detector.step(0, -(HALF_DEPTH - 0.4), tick++);
    expect(allGhosts(registry)).toHaveLength(0);
    detector.step(0, 0, tick++); // exit

    // Dark west entry at 5:00: table[5][west] = false. No growth.
    recordSomething();
    detector.step(-(HALF_WIDTH - 0.4), 0, tick++);
    expect(allGhosts(registry)).toHaveLength(0);
    detector.step(0, 0, tick++); // exit

    // Lit east entry at 5:00: table[5][east] = true. Grows to 1; active
    // timeline switches to 6 after this.
    recordSomething();
    detector.step(HALF_WIDTH - 0.4, 0, tick++);
    expect(allGhosts(registry)).toHaveLength(1);
    expect(registry.activeTimeline).toBe(6);
  });
});

describe("wireTraversal: spawn pose contract", () => {
  it("default room-center pose sits outside every Act 1 portal trigger volume (no re-entry ping-pong)", () => {
    // Sanity guard: the SpawnPoseResolver contract says the resolved pose
    // must be outside every trigger volume. If a future per-time resolver
    // breaks this invariant the next `step()` after a teleport will fire a
    // fresh enter event on the trigger the player spawned in. The default
    // resolver returns (0, 0); confirm that is outside all four canonical
    // Act 1 triggers.
    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    for (const trigger of detector.triggers) {
      const insideRoomCenter =
        Math.abs(0 - trigger.centerX) <= trigger.halfX &&
        Math.abs(0 - trigger.centerZ) <= trigger.halfZ;
      expect(insideRoomCenter).toBe(false);
    }
  });

  it("traversing through a lit portal does not immediately re-trigger another enter at the destination", () => {
    // End-to-end guard: an enter on the south trigger teleports the player
    // to the room center; the very next `step()` (now at the room center)
    // must not emit any new enter events. If this regresses a future change
    // (e.g. a per-time resolver puts the player inside another trigger),
    // this test catches the ping-pong loop before it ships.
    const { scene, world, player, lifetime, registry } = buildHarness();
    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    const events: string[] = [];
    detector.onPortalOverlap((e) => events.push(`${e.kind}:${e.portal.direction}`));

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0); // enter south
    // After traversal the player is at (0, 0). No new enter should fire.
    detector.step(0, 0, 1);
    detector.step(0, 0, 2);

    expect(events.filter((e) => e.startsWith("enter"))).toEqual(["enter:south"]);
  });
});

describe("wireTraversal: custom spawn pose resolver", () => {
  it("uses the supplied resolver to pick the destination spawn position", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    const resolveSpawnPose = vi.fn((normalized: number) => ({
      x: normalized * 10,
      z: -1.5,
    }));
    wireTraversal({
      detector,
      player,
      lifetime,
      scene,
      world,
      registry,
      resolveSpawnPose,
    });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(resolveSpawnPose).toHaveBeenCalledTimes(1);
    expect(resolveSpawnPose).toHaveBeenCalledWith(12 / HOURS_PER_DAY);
    const t = player.body.translation();
    expect(t.x).toBeCloseTo((12 / HOURS_PER_DAY) * 10, 6);
    expect(t.z).toBeCloseTo(-1.5, 6);
    expect(lifetime.startPosition.x).toBeCloseTo((12 / HOURS_PER_DAY) * 10, 6);
    expect(lifetime.startPosition.z).toBeCloseTo(-1.5, 6);
  });
});

describe("wireTraversal: REQ-015 6:00 timeline state", () => {
  it("fires onTimelineEnter once per LIT traversal with the destination hour", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 5 / 24;
    player.originNormalized = 5 / 24;
    registry.setActiveTimeline(5);

    const east = makePortal("east", 6, true);
    const detector = createPortalTriggerSet([east]);
    const enters: number[] = [];
    wireTraversal({
      detector,
      player,
      lifetime,
      scene,
      world,
      registry,
      onTimelineEnter: (hour) => enters.push(hour),
    });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(HALF_WIDTH - 0.4, 0, 0);

    expect(enters).toEqual([6]);
  });

  it("does NOT fire onTimelineEnter for dark-portal entries", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    registry.setActiveTimeline(5);

    const dark = makePortal("north", 12, false);
    const detector = createPortalTriggerSet([dark]);
    const enters: number[] = [];
    wireTraversal({
      detector,
      player,
      lifetime,
      scene,
      world,
      registry,
      onTimelineEnter: (hour) => enters.push(hour),
    });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, -(HALF_DEPTH - 0.4), 0);

    expect(enters).toEqual([]);
  });

  it("fires onTimelineEnter AFTER the registry switch (hook reads new active timeline)", () => {
    // Ordering guard: the host's hook implementation may want to inspect
    // `registry.activeTimeline` to drive a per-timeline render path. The
    // hook must fire after the registry has switched to the destination.
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 5 / 24;
    player.originNormalized = 5 / 24;
    registry.setActiveTimeline(5);

    const east = makePortal("east", 6, true);
    const detector = createPortalTriggerSet([east]);
    let observedActive = -1;
    wireTraversal({
      detector,
      player,
      lifetime,
      scene,
      world,
      registry,
      onTimelineEnter: () => {
        observedActive = registry.activeTimeline;
      },
    });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(HALF_WIDTH - 0.4, 0, 0);

    expect(observedActive).toBe(6);
  });

  it("first entry into 6:00 yields an empty active-ghost list (REQ-006 unvisited future)", () => {
    // End-to-end REQ-006 invariant: traversing East from 5:00 into the
    // unvisited 6:00 timeline produces zero active ghosts. The 5:00-recorded
    // ghost is filed into the 5 bucket and hidden by the registry switch.
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 5 / 24;
    player.originNormalized = 5 / 24;
    registry.setActiveTimeline(5);

    const east = makePortal("east", 6, true);
    const detector = createPortalTriggerSet([east]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(state({ forward: true }), 0);
    lifetime.recorder.record(state({ forward: true }), 0);
    detector.step(HALF_WIDTH - 0.4, 0, 0);

    expect(registry.activeTimeline).toBe(6);
    expect(registry.activeGhosts()).toEqual([]);
    // The recording itself is preserved in the 5 bucket.
    expect(registry.ghostsFor(5)).toHaveLength(1);
  });

  it("at 6:00 the West door is enterable and routes back to 5:00", () => {
    // Wire a fresh harness with the active timeline set to 6 and the
    // canonical Act 1 portal set (whose West portal is authored DARK with
    // destinationHours = 5). The traversal predicate must read from
    // doorLitStateAtHour(6), which lights West, so walking into the West
    // trigger fires a traversal even though the portal's frozen `isLit`
    // is false.
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 6 / 24;
    player.originNormalized = 6 / 24;
    registry.setActiveTimeline(6);

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    const enters: number[] = [];
    wireTraversal({
      detector,
      player,
      lifetime,
      scene,
      world,
      registry,
      onTimelineEnter: (hour) => enters.push(hour),
    });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(-(HALF_WIDTH - 0.4), 0, 0); // walk into West trigger

    expect(enters).toEqual([5]);
    expect(registry.activeTimeline).toBe(5);
    expect(player.originNormalized).toBeCloseTo(5 / 24, 6);
  });

  it("at 6:00 the South, East, and North doors are NOT enterable (only West is lit)", () => {
    // The lit/dark filter must derive from the current timeline. At 6:00
    // South and East (authored lit at 5:00) become dark, and North stays
    // dark. Walking into any of them must NOT trigger a traversal.
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 6 / 24;
    player.originNormalized = 6 / 24;
    registry.setActiveTimeline(6);

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    const enters: number[] = [];
    wireTraversal({
      detector,
      player,
      lifetime,
      scene,
      world,
      registry,
      onTimelineEnter: (hour) => enters.push(hour),
    });

    let tick = 0;
    detector.step(0, 0, tick++); // outside

    // South: lit at 5:00, dark at 6:00.
    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, tick++);
    detector.step(0, 0, tick++); // exit
    // East: lit at 5:00, dark at 6:00.
    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(HALF_WIDTH - 0.4, 0, tick++);
    detector.step(0, 0, tick++); // exit
    // North: dark at both.
    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, -(HALF_DEPTH - 0.4), tick++);

    expect(enters).toEqual([]);
    expect(registry.activeTimeline).toBe(6);
  });
});

describe("wireTraversal: instance generation numbering (REQ-007 / REQ-008)", () => {
  it("ghost takes the OUTGOING active player's instanceId on lit traversal", () => {
    // The OUTGOING active instance becomes the spawned ghost. The ghost IS
    // that closed-out instance, replayed; it keeps its generation index so a
    // future thought-bubble UI (REQ-032) can label it via formatInstanceId.
    const { scene, world, player, lifetime, registry } = buildHarness();
    player.instanceId = 1;
    lifetime.instanceId = 1;
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    const ghosts = allGhosts(registry);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].instanceId).toBe(1);
  });

  it("active player advances to nextInstanceId (1 -> 2) on lit traversal", () => {
    // Per REQ-008 the player always controls the most recently spawned active
    // instance, so a fresh generation arrives at the destination.
    const { scene, world, player, lifetime, registry } = buildHarness();
    player.instanceId = 1;
    lifetime.instanceId = 1;
    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(player.instanceId).toBe(2);
    expect(lifetime.instanceId).toBe(2);
  });

  it("sequential lit traversals produce ghosts with monotonically increasing instanceIds (You1 -> You-1 -> You-2)", () => {
    // Two consecutive lit traversals from the active player. The first
    // closes out You1 (instanceId 1); the second closes out You-1
    // (instanceId 2). The active player ends at instanceId 3 (You-2).
    // Destination hour 0 is intentionally unauthored: `litStateForTimeline`
    // returns null for hour 0 and `wireTraversal` falls back to the portal's
    // frozen `isLit: true` so both consecutive traversals fire. Once REQ-023
    // authored hour 12 in `DOOR_STATE_BY_HOUR` (with South dark), a 12 ->
    // 12 self-loop on the South portal gates closed on the second tick;
    // hour 0 keeps this test focused on the instance-numbering contract
    // without depending on a specific timeline's seed.
    const { scene, world, player, lifetime, registry } = buildHarness();
    player.instanceId = 1;
    lifetime.instanceId = 1;
    const south = makePortal("south", 0, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    let tick = 0;

    // First traversal: spawns the You1 ghost at instanceId 1.
    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, tick++);
    detector.step(0, 0, tick++); // exit
    expect(player.instanceId).toBe(2);

    // Second traversal: spawns the You-1 ghost at instanceId 2.
    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, tick++);
    expect(player.instanceId).toBe(3);

    const ghostIds = allGhosts(registry).map((g) => g.instanceId);
    expect(ghostIds).toEqual([1, 2]);
  });

  it("dark-portal entries do NOT advance the active player's instanceId", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    player.instanceId = 4;
    lifetime.instanceId = 4;
    const dark = makePortal("south", 12, false);
    const detector = createPortalTriggerSet([dark]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(player.instanceId).toBe(4);
    expect(lifetime.instanceId).toBe(4);
  });

  it("ghost retains its instanceId across timeline switches (re-entering the source timeline still labels it the same)", () => {
    // Cross East from 5:00 (closes out You1; instance 1 ghost in bucket 5,
    // active player advances to You-1 / instance 2). Then cross West from
    // 6:00 back to 5:00 (closes out You-1; instance 2 ghost in bucket 6,
    // active player advances to You-2 / instance 3). The original You1
    // ghost in bucket 5 must still report instanceId 1 after it is reset
    // and shown again.
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 5 / 24;
    player.originNormalized = 5 / 24;
    player.instanceId = 1;
    lifetime.instanceId = 1;
    registry.setActiveTimeline(5);

    const east = makePortal("east", 6, true);
    const eastDetector = createPortalTriggerSet([east]);
    const t1 = wireTraversal({
      detector: eastDetector,
      player,
      lifetime,
      scene,
      world,
      registry,
    });

    lifetime.recorder.record(state({ forward: true }), 0);
    eastDetector.step(HALF_WIDTH - 0.4, 0, 0);
    expect(player.instanceId).toBe(2);

    const fiveBucket = registry.ghostsFor(5);
    expect(fiveBucket).toHaveLength(1);
    const you1Ghost = fiveBucket[0];
    expect(you1Ghost.instanceId).toBe(1);

    t1.dispose();

    const west = makePortal("west", 5, true);
    const westDetector = createPortalTriggerSet([west]);
    wireTraversal({
      detector: westDetector,
      player,
      lifetime,
      scene,
      world,
      registry,
    });

    lifetime.recorder.record(NEUTRAL, 0);
    westDetector.step(-(HALF_WIDTH - 0.4), 0, 1);

    expect(player.instanceId).toBe(3);
    // The You1 ghost in bucket 5 still has instanceId 1 after the registry
    // reset / re-show on return to its source timeline.
    expect(you1Ghost.instanceId).toBe(1);
    // The You-1 ghost just spawned was filed into bucket 6 (timeline being
    // left behind); it carries instanceId 2.
    expect(registry.ghostsFor(6)).toHaveLength(1);
    expect(registry.ghostsFor(6)[0].instanceId).toBe(2);
  });
});

describe("wireTraversal: per-timeline ghost bookkeeping (REQ-001 / REQ-003)", () => {
  it("files the spawned ghost into the SOURCE timeline (the timeline left behind)", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    // Lifetime is recording in timeline 5 (the player started at 5:00 per
    // the Act 1 anchor; harness mirrors that by setting origin = 5/24 here).
    lifetime.originNormalized = 5 / 24;
    player.originNormalized = 5 / 24;
    registry.setActiveTimeline(5);

    const south = makePortal("south", 12, true);
    const detector = createPortalTriggerSet([south]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, HALF_DEPTH - 0.4, 0);

    expect(registry.ghostsFor(5)).toHaveLength(1);
    expect(registry.ghostsFor(12)).toEqual([]);
    expect(registry.ghostsFor(6)).toEqual([]);
  });

  it("switches the registry's active timeline to the destination on lit traversal", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 5 / 24;
    player.originNormalized = 5 / 24;
    registry.setActiveTimeline(5);

    const east = makePortal("east", 6, true);
    const detector = createPortalTriggerSet([east]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(HALF_WIDTH - 0.4, 0, 0);

    expect(registry.activeTimeline).toBe(6);
  });

  it("does NOT switch the active timeline on dark-portal entry", () => {
    // North is dark at 5:00 per `doorLitStateAtHour(5)`, so the
    // table-derived gate (REQ-015) blocks entry. The portal's authored
    // `isLit` field is false here too, so the test is unambiguous regardless
    // of which gate fires.
    const { scene, world, player, lifetime, registry } = buildHarness();
    lifetime.originNormalized = 5 / 24;
    player.originNormalized = 5 / 24;
    registry.setActiveTimeline(5);

    const dark = makePortal("north", 12, false);
    const detector = createPortalTriggerSet([dark]);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    lifetime.recorder.record(NEUTRAL, 0);
    detector.step(0, -(HALF_DEPTH - 0.4), 0);

    expect(registry.activeTimeline).toBe(5);
  });

  it("ghost recorded at 5:00 is hidden after traversing to 6:00 and visible again on return to 5:00 (Act 2 first loop)", () => {
    const { scene, world, player, lifetime, registry } = buildHarness();
    // Start at 5:00, active timeline 5.
    lifetime.originNormalized = 5 / 24;
    player.originNormalized = 5 / 24;
    registry.setActiveTimeline(5);

    const east = makePortal("east", 6, true);
    const eastDetector = createPortalTriggerSet([east]);
    const t1 = wireTraversal({
      detector: eastDetector,
      player,
      lifetime,
      scene,
      world,
      registry,
    });

    // Record some movement before leaving 5:00 so the spawned ghost has a
    // path to replay.
    lifetime.recorder.record(state({ forward: true }), 0);
    lifetime.recorder.record(state({ forward: true }), 0);

    // Cross the East trigger: ghost files into timeline 5, active swaps to 6.
    eastDetector.step(HALF_WIDTH - 0.4, 0, 0);
    expect(registry.activeTimeline).toBe(6);
    const fiveGhosts = registry.ghostsFor(5);
    expect(fiveGhosts).toHaveLength(1);
    const ghost = fiveGhosts[0];
    expect(ghost.mesh.visible).toBe(false);
    // No active ghosts at 6:00 (REQ-006: an unvisited future contains nothing).
    expect(registry.activeGhosts()).toEqual([]);

    t1.dispose();

    // Player at 6:00 now traverses West back to 5:00.
    const west = makePortal("west", 5, true);
    const westDetector = createPortalTriggerSet([west]);
    wireTraversal({
      detector: westDetector,
      player,
      lifetime,
      scene,
      world,
      registry,
    });

    // West entry: ghost files into timeline 6 (the timeline being LEFT
    // BEHIND, which is now 6 per the lifetime origin updated by the East
    // traversal). Then active swaps to 5, where the original ghost is
    // reset to tick 0 and shown.
    lifetime.recorder.record(NEUTRAL, 0);
    westDetector.step(-(HALF_WIDTH - 0.4), 0, 1);

    expect(registry.activeTimeline).toBe(5);
    expect(ghost.mesh.visible).toBe(true);
    expect(ghost.tickIndex).toBe(0);
    // The 5:00-recorded ghost is now active again.
    const active = registry.activeGhosts();
    expect(active).toContain(ghost);
  });
});
