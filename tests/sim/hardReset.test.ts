import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { hardReset } from "../../src/sim/hardReset.ts";
import {
  ACT_ONE_HOUR,
  ACT_ONE_NORMALIZED,
} from "../../src/sim/actOneAnchor.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import { TimeOfDay } from "../../src/sim/timeOfDay.ts";
import {
  createTimelineRegistry,
  type TimelineRegistry,
} from "../../src/sim/timelineRegistry.ts";
import { createGhost } from "../../src/sim/ghostInstance.ts";
import { createPortalTriggerSet } from "../../src/sim/portalTrigger.ts";
import { createActOnePortals, type Portal } from "../../src/sim/portal.ts";
import { createFourDoors } from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";
import { PLAYER_CAPSULE } from "../../src/scene/player.ts";
import {
  DOOR_LIT_COLOR_HEX,
  DOOR_DARK_COLOR_HEX,
} from "../../src/scene/door.ts";
import type { ActiveLifetime, ActivePlayerHandle } from "../../src/sim/portalTraversal.ts";
import type { KeyState } from "../../src/input/keyboard.ts";

beforeAll(async () => {
  await RAPIER.init();
});

const NEUTRAL: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
};

const buildRecording = (frames: KeyState[]) => {
  const r = new InputRecorder();
  for (const f of frames) r.record(f, 0);
  return r.snapshot();
};

interface Harness {
  scene: THREE.Scene;
  world: RAPIER.World;
  player: ActivePlayerHandle;
  playerBodyHandle: RAPIER.RigidBody;
  lifetime: ActiveLifetime;
  registry: TimelineRegistry;
  timeOfDay: TimeOfDay;
  portals: readonly Portal[];
  portalTriggers: ReturnType<typeof createPortalTriggerSet>;
}

const buildHarness = (initialActiveTimeline = ACT_ONE_HOUR): Harness => {
  const scene = new THREE.Scene();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;

  const { radius, cylinderLength } = PLAYER_CAPSULE;
  const restY = cylinderLength / 2 + radius;

  // Build a real player rigid body so the reset's body mutations are
  // exercised end-to-end (not against a stub).
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(2, restY, 3)
    .enabledRotations(false, true, false)
    .setLinearDamping(8.0);
  const playerBody = world.createRigidBody(bodyDesc);
  world.createCollider(
    RAPIER.ColliderDesc.capsule(cylinderLength / 2, radius).setFriction(0.5),
    playerBody,
  );

  const playerMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, cylinderLength, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xc4d0e6 }),
  );
  scene.add(playerMesh);

  const player: ActivePlayerHandle = {
    body: playerBody,
    mesh: playerMesh,
    // A non-Act-1 origin so the reset's re-stamp is observable.
    originNormalized: 6 / 24,
  };

  const lifetime: ActiveLifetime = {
    startPosition: { x: 1, z: 2 },
    recorder: new InputRecorder(),
    originNormalized: 6 / 24,
  };
  // Pre-seed the recorder with frames so the reset's "fresh recorder"
  // contract is observable (length should drop back to 0).
  lifetime.recorder.record(NEUTRAL, 6 / 24);
  lifetime.recorder.record(NEUTRAL, 6 / 24);

  const registry = createTimelineRegistry({ initialTimeline: initialActiveTimeline });

  const timeOfDay = new TimeOfDay({
    ticksPerSecond: 60,
    initialNormalized: 8 / 24,
  });

  const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
  for (const door of doors) scene.add(door.mesh);
  const portals = createActOnePortals(doors);

  const portalTriggers = createPortalTriggerSet(portals);

  return {
    scene,
    world,
    player,
    playerBodyHandle: playerBody,
    lifetime,
    registry,
    timeOfDay,
    portals,
    portalTriggers,
  };
};

const spawnGhostInto = (
  scene: THREE.Scene,
  world: RAPIER.World,
  startPosition: { x: number; z: number },
) =>
  createGhost({
    recording: buildRecording([
      { ...NEUTRAL, forward: true },
      { ...NEUTRAL, forward: true },
    ]),
    originNormalized: 5 / 24,
    scene,
    world,
    startPosition,
  });

describe("hardReset: pure teardown contract (REQ-025)", () => {
  it("clears every ghost from every timeline bucket", () => {
    const h = buildHarness();
    const ghostA = spawnGhostInto(h.scene, h.world, { x: 1, z: 0 });
    const ghostB = spawnGhostInto(h.scene, h.world, { x: 0, z: 1 });
    const ghostC = spawnGhostInto(h.scene, h.world, { x: -1, z: 0 });
    h.registry.add(5, ghostA);
    h.registry.add(6, ghostB);
    h.registry.add(12, ghostC);

    hardReset({
      player: h.player,
      lifetime: h.lifetime,
      registry: h.registry,
      scene: h.scene,
      world: h.world,
      timeOfDay: h.timeOfDay,
      portals: h.portals,
      portalTriggers: h.portalTriggers,
    });

    expect(h.registry.ghostsFor(5)).toEqual([]);
    expect(h.registry.ghostsFor(6)).toEqual([]);
    expect(h.registry.ghostsFor(12)).toEqual([]);
    // Meshes are detached from the scene.
    expect(h.scene.children).not.toContain(ghostA.mesh);
    expect(h.scene.children).not.toContain(ghostB.mesh);
    expect(h.scene.children).not.toContain(ghostC.mesh);
  });

  it("resets the active player body to the room center with zero velocity", () => {
    const h = buildHarness();
    h.playerBodyHandle.setLinvel({ x: 5, y: 0, z: -3 }, true);
    const yBefore = h.playerBodyHandle.translation().y;

    hardReset({
      player: h.player,
      lifetime: h.lifetime,
      registry: h.registry,
      scene: h.scene,
      world: h.world,
      timeOfDay: h.timeOfDay,
      portals: h.portals,
      portalTriggers: h.portalTriggers,
    });

    const t = h.playerBodyHandle.translation();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(0, 6);
    // y is preserved across the reset.
    expect(t.y).toBeCloseTo(yBefore, 6);
    const v = h.playerBodyHandle.linvel();
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("re-stamps player origin and tint to the Act 1 anchor", () => {
    const h = buildHarness();
    const beforeColor = (h.player.mesh.material as THREE.MeshStandardMaterial)
      .color.getHex();
    expect(h.player.originNormalized).toBe(6 / 24);

    hardReset({
      player: h.player,
      lifetime: h.lifetime,
      registry: h.registry,
      scene: h.scene,
      world: h.world,
      timeOfDay: h.timeOfDay,
      portals: h.portals,
      portalTriggers: h.portalTriggers,
    });

    expect(h.player.originNormalized).toBeCloseTo(ACT_ONE_NORMALIZED, 6);
    const afterColor = (h.player.mesh.material as THREE.MeshStandardMaterial)
      .color.getHex();
    // The instance tint at the Act 1 anchor must differ from the 6/24 stamp
    // the harness seeded; the exact hue is owned by `applyInstanceTint`.
    expect(afterColor).not.toBe(beforeColor);
  });

  it("opens a fresh lifetime at the Act 1 anchor (recorder empty, start at center)", () => {
    const h = buildHarness();
    expect(h.lifetime.recorder.length).toBe(2);
    const recorderBefore = h.lifetime.recorder;

    hardReset({
      player: h.player,
      lifetime: h.lifetime,
      registry: h.registry,
      scene: h.scene,
      world: h.world,
      timeOfDay: h.timeOfDay,
      portals: h.portals,
      portalTriggers: h.portalTriggers,
    });

    expect(h.lifetime.recorder).not.toBe(recorderBefore);
    expect(h.lifetime.recorder.length).toBe(0);
    expect(h.lifetime.startPosition).toEqual({ x: 0, z: 0 });
    expect(h.lifetime.originNormalized).toBeCloseTo(ACT_ONE_NORMALIZED, 6);
  });

  it("snaps the time-of-day clock to the Act 1 normalized hour", () => {
    const h = buildHarness();
    expect(h.timeOfDay.normalized()).toBeCloseTo(8 / 24, 6);

    hardReset({
      player: h.player,
      lifetime: h.lifetime,
      registry: h.registry,
      scene: h.scene,
      world: h.world,
      timeOfDay: h.timeOfDay,
      portals: h.portals,
      portalTriggers: h.portalTriggers,
    });

    expect(h.timeOfDay.normalized()).toBeCloseTo(ACT_ONE_NORMALIZED, 6);
  });

  it("repaints doors to the Act 1 lit/dark table", () => {
    const h = buildHarness();
    // Pre-condition: pretend the room was painted at 6:00 (West only lit)
    // so the reset's repaint is observable. Mutate the door materials
    // directly rather than going through `repaintDoorsForHour` to keep
    // this assertion cheap.
    const byDirection = new Map<string, Portal>();
    for (const p of h.portals) byDirection.set(p.direction, p);
    const setHex = (portal: Portal, hex: number): void => {
      (portal.door.mesh.material as THREE.MeshStandardMaterial).color.setHex(hex);
    };
    setHex(byDirection.get("south")!, DOOR_DARK_COLOR_HEX);
    setHex(byDirection.get("east")!, DOOR_DARK_COLOR_HEX);
    setHex(byDirection.get("north")!, DOOR_DARK_COLOR_HEX);
    setHex(byDirection.get("west")!, DOOR_LIT_COLOR_HEX);

    hardReset({
      player: h.player,
      lifetime: h.lifetime,
      registry: h.registry,
      scene: h.scene,
      world: h.world,
      timeOfDay: h.timeOfDay,
      portals: h.portals,
      portalTriggers: h.portalTriggers,
    });

    const colorHex = (portal: Portal): number =>
      (portal.door.mesh.material as THREE.MeshStandardMaterial).color.getHex();
    expect(colorHex(byDirection.get("south")!)).toBe(DOOR_LIT_COLOR_HEX);
    expect(colorHex(byDirection.get("east")!)).toBe(DOOR_LIT_COLOR_HEX);
    expect(colorHex(byDirection.get("north")!)).toBe(DOOR_DARK_COLOR_HEX);
    expect(colorHex(byDirection.get("west")!)).toBe(DOOR_DARK_COLOR_HEX);
  });

  it("clears portal-trigger overlap state without firing exit events", () => {
    const h = buildHarness();
    // Drive the detector into "inside one trigger" state. South-wall
    // trigger sits near (0, depth/2 - PORTAL_TRIGGER_DEPTH/2); a step at
    // its center forces overlapping[south] = true with an enter event.
    const south = h.portals.find((p) => p.direction === "south")!;
    const events: { kind: "enter" | "exit"; tick: number }[] = [];
    h.portalTriggers.onPortalOverlap((e) =>
      events.push({ kind: e.kind, tick: e.tick }),
    );
    // Walk into the south trigger (its center is at z = depth/2 - 0.3,
    // x = 0 by `createPortalTrigger`).
    const southTrigger = h.portalTriggers.triggers.find(
      (t) => t.portal === south,
    )!;
    h.portalTriggers.step(southTrigger.centerX, southTrigger.centerZ, 0);
    expect(events.filter((e) => e.kind === "enter")).toHaveLength(1);
    expect(h.portalTriggers.isOverlapping(south)).toBe(true);

    hardReset({
      player: h.player,
      lifetime: h.lifetime,
      registry: h.registry,
      scene: h.scene,
      world: h.world,
      timeOfDay: h.timeOfDay,
      portals: h.portals,
      portalTriggers: h.portalTriggers,
    });

    // The reset itself fires no events.
    expect(events).toHaveLength(1);
    expect(h.portalTriggers.isOverlapping(south)).toBe(false);

    // After the reset the next step at the room center must NOT fire an
    // exit event (overlap was cleared, so there is no "was inside" to
    // exit from). It must also NOT fire a stale enter event.
    h.portalTriggers.step(0, 0, 1);
    expect(events).toHaveLength(1);
  });
});

describe("hardReset: idempotence and post-traversal teardown (REQ-025)", () => {
  it("is idempotent: calling twice produces the same clean state", () => {
    const h = buildHarness();
    const ghost = spawnGhostInto(h.scene, h.world, { x: 1, z: 0 });
    h.registry.add(5, ghost);

    const args = {
      player: h.player,
      lifetime: h.lifetime,
      registry: h.registry,
      scene: h.scene,
      world: h.world,
      timeOfDay: h.timeOfDay,
      portals: h.portals,
      portalTriggers: h.portalTriggers,
    };
    hardReset(args);
    hardReset(args);

    expect(h.registry.ghostsFor(5)).toEqual([]);
    expect(h.lifetime.recorder.length).toBe(0);
    expect(h.lifetime.startPosition).toEqual({ x: 0, z: 0 });
    expect(h.timeOfDay.normalized()).toBeCloseTo(ACT_ONE_NORMALIZED, 6);
    const t = h.playerBodyHandle.translation();
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(0, 6);
  });

  it("clears ghosts in every visited timeline, not just the active one", () => {
    const h = buildHarness();
    // File ghosts into 5, 6, and 12 to mimic a player who has traversed
    // South to 12, East to 6, and back to 5 across multiple lifetimes.
    const ghosts = [
      spawnGhostInto(h.scene, h.world, { x: 1, z: 0 }),
      spawnGhostInto(h.scene, h.world, { x: 2, z: 0 }),
      spawnGhostInto(h.scene, h.world, { x: 0, z: 1 }),
      spawnGhostInto(h.scene, h.world, { x: 0, z: 2 }),
    ];
    h.registry.add(5, ghosts[0]);
    h.registry.add(6, ghosts[1]);
    h.registry.add(12, ghosts[2]);
    h.registry.add(6, ghosts[3]);
    // Switch the active timeline to 12 so the "active one" at reset time
    // is NOT the timeline most ghosts live in.
    h.registry.setActiveTimeline(12);
    expect(h.registry.activeTimeline).toBe(12);

    hardReset({
      player: h.player,
      lifetime: h.lifetime,
      registry: h.registry,
      scene: h.scene,
      world: h.world,
      timeOfDay: h.timeOfDay,
      portals: h.portals,
      portalTriggers: h.portalTriggers,
    });

    expect(h.registry.ghostsFor(5)).toEqual([]);
    expect(h.registry.ghostsFor(6)).toEqual([]);
    expect(h.registry.ghostsFor(12)).toEqual([]);
    // Active timeline returns to the Act 1 anchor regardless of where it
    // was at reset time.
    expect(h.registry.activeTimeline).toBe(ACT_ONE_HOUR);
    for (const ghost of ghosts) {
      expect(h.scene.children).not.toContain(ghost.mesh);
    }
  });

  it("on a clean state, reset is a safe no-op tear-down", () => {
    const h = buildHarness();
    // Start with an empty registry, the player at center, the clock at
    // the Act 1 anchor, and a fresh lifetime. Reset should not throw and
    // should not change observable state.
    h.playerBodyHandle.setTranslation(
      { x: 0, y: h.playerBodyHandle.translation().y, z: 0 },
      true,
    );
    h.timeOfDay.setNormalized(ACT_ONE_NORMALIZED);
    h.lifetime.recorder = new InputRecorder();
    h.lifetime.startPosition = { x: 0, z: 0 };
    h.lifetime.originNormalized = ACT_ONE_NORMALIZED;
    h.player.originNormalized = ACT_ONE_NORMALIZED;

    expect(() =>
      hardReset({
        player: h.player,
        lifetime: h.lifetime,
        registry: h.registry,
        scene: h.scene,
        world: h.world,
        timeOfDay: h.timeOfDay,
        portals: h.portals,
        portalTriggers: h.portalTriggers,
      }),
    ).not.toThrow();
    expect(h.registry.ghostsFor(5)).toEqual([]);
    expect(h.timeOfDay.normalized()).toBeCloseTo(ACT_ONE_NORMALIZED, 6);
  });
});
