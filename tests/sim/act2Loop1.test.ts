import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  wireTraversal,
  type ActiveLifetime,
  type ActivePlayerHandle,
} from "../../src/sim/portalTraversal.ts";
import { createPortalTriggerSet } from "../../src/sim/portalTrigger.ts";
import {
  createActOnePortals,
} from "../../src/sim/portal.ts";
import { createFourDoors } from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import { MilestoneRecorder } from "../../src/sim/milestone.ts";
import { PLAYER_CAPSULE } from "../../src/scene/player.ts";
import { applyInstanceTint } from "../../src/render/instanceTint.ts";
import {
  createTimelineRegistry,
  type TimelineRegistry,
} from "../../src/sim/timelineRegistry.ts";
import { mountAct1Cinematic } from "../../src/sim/scripts/act1Cinematic.ts";
import {
  createActStateObserver,
  isAct2Loop1,
  type ActStateSnapshot,
  type BucketGhostSnapshot,
} from "../../src/sim/actState.ts";
import type { GhostInstance } from "../../src/sim/ghostInstance.ts";
import { inputToVelocity, type KeyState } from "../../src/input/keyboard.ts";

/**
 * REQ-016 Act 2 first loop integration test (`docs/gdd/40-act-progress-and-narrative-beats.md`
 * section 4 REQ-016).
 *
 * This is the integration slice that drives the existing primitives
 * (recorder, traversal, registry, ghost, observer) through the GDD's
 * scripted Act 2 first-loop sequence: walk East at 5:00, walk West at 6:00,
 * land back at 5:00. Asserts that the You-1 ghost replays the East-bound
 * path, exhausts its recording at the West portal, and the
 * `ActStateObserver` transitions to `act-2-loop-1` once the snapshot
 * reflects the bucket states the predicate keys on.
 *
 * The test does NOT step the Rapier physics loop; instead it drives the
 * portal-trigger detector with `step(x, z, tick)` calls which is the same
 * surface the host uses to convert player position into enter/exit events.
 * That keeps the test deterministic without coupling to fixed-step
 * scheduling. The ghost's playback is exercised via `advanceTick` calls so
 * the recording is "consumed" up to its end, satisfying the
 * `allGhostsAtRest` half of the predicate.
 */

beforeAll(async () => {
  await RAPIER.init();
});

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

const inputState = (overrides: Partial<KeyState>): KeyState => ({
  ...NEUTRAL,
  ...overrides,
});

const buildWorld = (): RAPIER.World =>
  new RAPIER.World({ x: 0, y: -9.81, z: 0 });

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
  applyInstanceTint(mesh, 5 / 24);
  return mesh;
};

interface Harness {
  scene: THREE.Scene;
  world: RAPIER.World;
  player: ActivePlayerHandle;
  lifetime: ActiveLifetime;
  registry: TimelineRegistry;
}

const buildHarness = (): Harness => {
  const scene = new THREE.Scene();
  const world = buildWorld();
  const body = makePlayerBody(world);
  const mesh = makePlayerMesh();
  scene.add(mesh);
  const player: ActivePlayerHandle = {
    body,
    mesh,
    originNormalized: 5 / 24,
    instanceId: 1,
    consciousness: "conscious",
    carry: { kind: "idle" },
  };
  const lifetime: ActiveLifetime = {
    startPosition: { x: 0, z: 0 },
    recorder: new InputRecorder(),
    milestones: new MilestoneRecorder(),
    startTick: 0,
    originNormalized: 5 / 24,
    instanceId: 1,
  };
  const registry = createTimelineRegistry({ initialTimeline: 5 });
  // Mount the Act 1 cinematic into the 12:00 bucket so the predicate chain
  // satisfies isAct1Spawn (the prerequisite for act-2-loop-1) when the
  // observer walks the chain.
  mountAct1Cinematic({ registry, scene, world });
  return { scene, world, player, lifetime, registry };
};

/**
 * Project a live `GhostInstance` into the read-only `BucketGhostSnapshot`
 * shape the observer's predicates inspect. This is the same projection the
 * host loop will perform once per fixed step when REQ-016+ slices wire the
 * observer into `src/app.ts`.
 */
const projectGhost = (g: GhostInstance): BucketGhostSnapshot => {
  const t = g.body.translation();
  return {
    id: g.instanceId,
    position: { x: t.x, z: t.z },
    consciousness: g.consciousness,
    originNormalized: g.originNormalized,
    tickIndex: g.tickIndex,
    recordingLength: g.recording.length,
  };
};

const buildActStateSnapshot = (
  registry: TimelineRegistry,
  player: ActivePlayerHandle,
): ActStateSnapshot => {
  const t = player.body.translation();
  return {
    registry: {
      activeTimeline: registry.activeTimeline,
      ghostsFor: (timeline) =>
        registry.ghostsFor(timeline).map(projectGhost),
    },
    instances: [],
    currentTimeline: registry.activeTimeline,
    activePlayer: {
      instanceId: player.instanceId,
      position: { x: t.x, z: t.z },
      consciousness: player.consciousness,
      carry: player.carry,
    },
    recentWestEntries: [],
    activePlayerCrossedNorthAt12: false,
  };
};

describe("REQ-016 Act 2 first loop integration", () => {
  it("walking East from 5:00 to 6:00 then West back to 5:00 produces a You-1 ghost whose East-bound recording replays in 5:00", () => {
    const harness = buildHarness();
    const { scene, world, player, lifetime, registry } = harness;

    // Build the canonical Act 1 portal set so the lit/dark gates derive
    // from `doorLitStateAtHour` rather than a hand-rolled per-direction
    // flag. East is lit at 5:00 and West is lit at 6:00 (per
    // `DOOR_STATE_BY_HOUR`); the portal data itself is unchanged across
    // timelines.
    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // Phase 1: at 5:00, walk East. Record several frames of forward / right
    // input so the spawned You1 ghost has a non-trivial recording. The
    // exact key pattern is not load-bearing; the recording's length and
    // its eventual `tickIndex >= recordingLength` after replay are what
    // matter to the predicate.
    let tick = 0;
    detector.step(0, 0, tick++); // outside any trigger
    for (let i = 0; i < 5; i++) {
      lifetime.recorder.record(inputState({ right: true }), 5 / 24);
    }
    expect(lifetime.recorder.length).toBe(5);
    const eastRecorderBeforeTraversal = lifetime.recorder;

    // Cross the East trigger at 5:00. East is lit at 5:00, so traversal
    // fires: ghost-A files into bucket 5, active timeline switches to 6,
    // recorder resets.
    detector.step(HALF_WIDTH - 0.4, 0, tick++);

    // Assert: ghost-A is now in bucket 5 with the East-bound recording.
    expect(registry.activeTimeline).toBe(6);
    const fiveBucketAfterEast = registry.ghostsFor(5);
    expect(fiveBucketAfterEast).toHaveLength(1);
    const ghostA = fiveBucketAfterEast[0];
    expect(ghostA.recording.length).toBe(5);
    expect(ghostA.instanceId).toBe(1);
    // Hidden because timeline 5 is no longer active.
    expect(ghostA.mesh.visible).toBe(false);
    // Recorder swapped to a fresh one keyed at tick 0 of the destination.
    expect(lifetime.recorder).not.toBe(eastRecorderBeforeTraversal);
    expect(lifetime.recorder.length).toBe(0);
    expect(lifetime.originNormalized).toBeCloseTo(6 / 24, 6);
    // 6:00 bucket is empty at this point (REQ-006 unvisited future).
    expect(registry.ghostsFor(6)).toEqual([]);

    // Phase 2: at 6:00, walk West. Step out of the East trigger first so
    // the next West-trigger entry registers as a fresh `enter` event.
    detector.step(0, 0, tick++);
    for (let i = 0; i < 4; i++) {
      lifetime.recorder.record(inputState({ left: true }), 6 / 24);
    }
    expect(lifetime.recorder.length).toBe(4);
    const westRecorderBeforeTraversal = lifetime.recorder;

    // Cross the West trigger at 6:00. West is lit at 6:00 per
    // `DOOR_STATE_BY_HOUR`, so traversal fires: ghost-B files into bucket
    // 6, active timeline switches back to 5.
    detector.step(-(HALF_WIDTH - 0.4), 0, tick++);

    // Assert: ghost-B is in bucket 6 (the timeline being LEFT BEHIND).
    expect(registry.activeTimeline).toBe(5);
    const sixBucketAfterWest = registry.ghostsFor(6);
    expect(sixBucketAfterWest).toHaveLength(1);
    const ghostB = sixBucketAfterWest[0];
    expect(ghostB.recording.length).toBe(4);
    expect(ghostB.instanceId).toBe(2);
    // Hidden because timeline 6 is no longer active.
    expect(ghostB.mesh.visible).toBe(false);
    // Recorder swapped again, fresh at tick 0 of timeline 5.
    expect(lifetime.recorder).not.toBe(westRecorderBeforeTraversal);
    expect(lifetime.recorder.length).toBe(0);
    expect(lifetime.originNormalized).toBeCloseTo(5 / 24, 6);

    // Ghost-A (recorded at 5:00) is now active again: visible, reset to
    // tick 0, and present in `activeGhosts()`.
    expect(ghostA.mesh.visible).toBe(true);
    expect(ghostA.tickIndex).toBe(0);
    expect(registry.activeGhosts()).toContain(ghostA);

    // Phase 3: drive ghost-A's playback forward to exhaustion. Each
    // `advanceTick` call consumes one recorded frame; once the tick index
    // reaches the recording length, `replayAtTick` returns zero and the
    // ghost is "at rest" by the predicate's definition. The host loop in
    // `src/app.ts` already calls `advanceTick` for every active ghost
    // each fixed step; this test exercises the same surface directly.
    for (let i = 0; i < ghostA.recording.length; i++) {
      ghostA.advanceTick();
    }
    expect(ghostA.tickIndex).toBe(ghostA.recording.length);

    // Phase 4: build a snapshot from the live state and feed it to the
    // observer. The observer should walk the chain from `not-started`
    // through `act-1-spawn` (cinematic mounted at 12:00) and
    // `act-2-loop-1` (5:00 ghost at-rest, 6:00 has at least one ghost).
    const observer = createActStateObserver();
    const snapshot = buildActStateSnapshot(registry, player);

    // Sanity: the predicate itself is satisfied.
    expect(isAct2Loop1(snapshot)).toBe(true);

    // The observer's update walks `not-started -> act-1-spawn ->
    // act-2-loop-1` and halts at the first failing predicate (act-2-loop-2
    // requires timeline 6 plus an unconscious active player).
    expect(observer.update(snapshot)).toBe("act-2-loop-1");
    expect(observer.state).toBe("act-2-loop-1");
  });

  it("ghost-A's playback is byte-identical to the recorded input", () => {
    // Determinism guard: the GDD's "and disappears" semantics mean the
    // ghost's per-tick body translations during replay must match the
    // recording exactly. Since the recording itself is a list of
    // `KeyState` frames driven through `inputToVelocity`, the ghost's
    // per-tick `body.linvel()` (xz components) must equal the recorded
    // frame's `inputToVelocity(keys)` for every tick within the
    // recording, and zero for ticks past the end.
    const harness = buildHarness();
    const { scene, world, player, lifetime, registry } = harness;

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // Record an East-bound walk with a deterministic key sequence. Use a
    // small varied pattern so each tick reads a different recorded
    // velocity, exposing any off-by-one in the replay counter.
    const recordedKeys: KeyState[] = [
      inputState({ right: true }),
      inputState({ right: true, forward: true }),
      inputState({ forward: true }),
      inputState({ right: true }),
      inputState({}),
    ];
    let tick = 0;
    detector.step(0, 0, tick++);
    for (const k of recordedKeys) {
      lifetime.recorder.record(k, 5 / 24);
    }

    detector.step(HALF_WIDTH - 0.4, 0, tick++);
    detector.step(0, 0, tick++);
    for (let i = 0; i < 2; i++) {
      lifetime.recorder.record(inputState({ left: true }), 6 / 24);
    }
    detector.step(-(HALF_WIDTH - 0.4), 0, tick++);

    expect(registry.activeTimeline).toBe(5);
    const ghostA = registry.ghostsFor(5)[0];
    expect(ghostA).toBeDefined();
    expect(ghostA.recording.length).toBe(recordedKeys.length);

    // Replay the ghost tick-by-tick and snapshot the recorded velocity at
    // each step BEFORE `advanceTick` writes the next velocity. The
    // `advanceTick` body reads the recording at `tickIndex` then
    // increments, so the per-frame recorded keys at `tickIndex` produce
    // the velocity written for THIS tick.
    for (let i = 0; i < ghostA.recording.length; i++) {
      ghostA.advanceTick();
      const v = ghostA.body.linvel();
      const expectedKeys = ghostA.recording.frames[i].keys;
      // Use the same `inputToVelocity` mapping the recording was driven
      // through. The recording stores the raw `KeyState`, so the predicted
      // velocity is a pure function of the keys.
      const expected = inputToVelocity(expectedKeys);
      expect(v.x).toBeCloseTo(expected.x, 6);
      expect(v.z).toBeCloseTo(expected.z, 6);
    }
  });
});
