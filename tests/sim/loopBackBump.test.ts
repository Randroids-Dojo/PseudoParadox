/**
 * F-014 PR3d smoke test: the user's load-bearing loop-back-bump
 * invariant from the 2026-05-10 design pass:
 *
 *   "If I bump an instance in one time, then when I loop back to
 *   that time, I should see an instance of myself bumping that
 *   instance."
 *
 * Reading C (Q-026) is the implementation: each timeline has a
 * continuous absolute tick clock, ghosts have `startTick`, and door
 * destinations are pinned to (timelineId, tick) pairs. This test
 * exercises the full mechanism end-to-end against the registry's
 * public surface (no portal triggers, no scene graph beyond what
 * `createGhost` already needs).
 *
 * Scenario:
 *   1. At 5:00 tick 0, file PastSelf with a 40-tick recorded
 *      east-walk plus a `wall_bump` milestone at tick 20 (the bump
 *      we want to see replayed) and a `door_traversal` at tick 40
 *      (PastSelf walked east at original tick 40).
 *   2. Player traverses east. setActiveTimeline(6) so the 5:00
 *      bucket goes inactive.
 *   3. Player plays at 6:00 for 30 ticks. advanceActiveTick walks
 *      the 6:00 clock forward but the 5:00 clock stays at 0 (only
 *      the ACTIVE clock advances per F-014).
 *   4. Player traverses west with `arrivalTick = 30` (the loop-back
 *      destination). PastSelf's milestone abs tick = 0 + 40 = 40;
 *      40 > 30 so PastSelf is NOT despawned. PastSelf is
 *      fast-forwarded to position(30) of its east-walk: clearly
 *      east of spawn but not yet at the bump (tick 20) was
 *      historical, the body is now at the post-bump east position.
 *
 * Production note: the four Act 1 portals all author
 * `destinationTick = 0` in this slice because the existing Acts 2/3
 * integration tests use short scripted recordings whose
 * `door_traversal` milestones fire at tick 5 and would be despawned
 * by any non-zero destinationTick. A separate slice migrates those
 * tests to 40+ frame recordings so the West portal can ship with a
 * non-zero loop-back tick. This smoke test exercises the mechanism
 * against a recording long enough to survive the loop-back, so
 * PR3d ships proof the mechanism works end-to-end even before the
 * production west value goes non-zero.
 */

import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createTimelineRegistry } from "../../src/sim/timelineRegistry.ts";
import { createGhost } from "../../src/sim/ghostInstance.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import {
  DOOR_TRAVERSAL_WEIGHT,
  MilestoneRecorder,
  WALL_BUMP_WEIGHT,
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

describe("F-014 loop-back-bump invariant (PR3d smoke)", () => {
  it("PastSelf with door_traversal AFTER arrivalTick is fast-forwarded mid-recording", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    // PastSelf at 5:00: 40 ticks of east input, wall_bump at tick 20,
    // door_traversal at tick 40 (the original east-traversal).
    const recorder = new InputRecorder();
    for (let i = 0; i < 40; i += 1) {
      recorder.record({ ...NEUTRAL, right: true }, 5 / 24);
    }
    const milestones = new MilestoneRecorder();
    milestones.record({
      kind: "wall_bump",
      tick: 20,
      position: { x: 1.3, z: 0 },
      weight: WALL_BUMP_WEIGHT,
      wall: "east",
    });
    milestones.record({
      kind: "door_traversal",
      tick: 40,
      position: { x: 4.4, z: 0 },
      weight: DOOR_TRAVERSAL_WEIGHT,
      door: "east",
    });

    const pastSelf = createGhost({
      recording: recorder.snapshot(),
      milestones: milestones.snapshot(),
      originNormalized: 5 / 24,
      instanceId: 1,
      startTick: 0,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    registry.add(5, pastSelf);
    expect(registry.ghostsFor(5)).toHaveLength(1);

    // Player traverses east. Bucket 5 goes inactive; we do not assert
    // anything about its visibility here because the loop-back is
    // what matters.
    registry.setActiveTimeline(6, 0);

    // Player plays at 6:00 for 30 ticks. advanceActiveTick walks the
    // 6:00 clock only; the 5:00 clock stays at 0 by F-014.
    for (let i = 0; i < 30; i += 1) {
      registry.advanceActiveTick();
    }
    expect(registry.tickFor(6)).toBe(30);
    expect(registry.tickFor(5)).toBe(0);

    // Player traverses west back to 5:00 with arrivalTick = 30.
    // PastSelf's door_traversal milestone is at absolute tick 40, so
    // 40 > 30: PastSelf is NOT despawned. It is fast-forwarded to
    // its position-at-tick-30 (east of spawn, past the wall_bump at
    // tick 20).
    registry.setActiveTimeline(5, 30, { scene, world });
    expect(registry.activeTimeline).toBe(5);
    expect(registry.tickFor(5)).toBe(30);
    expect(registry.ghostsFor(5)).toHaveLength(1);

    const t = pastSelf.body.translation();
    // 30 ticks of right input at PLAYER_SPEED_MPS = 4 m/s gives
    // (4 m/s) * (30 / 60 s) = 2 m on +x. The body should be
    // visibly east of spawn, well past the wall_bump milestone at
    // x = 1.3 (which fired at tick 20 of the original recording).
    expect(t.x).toBeCloseTo(2, 5);
    expect(t.z).toBe(0);
    expect(pastSelf.mesh.visible).toBe(true);
  });

  it("PastSelf with door_traversal BEFORE arrivalTick is despawned (Reading C)", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    // Short PastSelf: 10-tick recording with door_traversal at
    // tick 10. The original PastSelf already left 5:00 at tick 10.
    const recorder = new InputRecorder();
    for (let i = 0; i < 10; i += 1) {
      recorder.record({ ...NEUTRAL, right: true }, 5 / 24);
    }
    const milestones = new MilestoneRecorder();
    milestones.record({
      kind: "door_traversal",
      tick: 10,
      position: { x: 4.4, z: 0 },
      weight: DOOR_TRAVERSAL_WEIGHT,
      door: "east",
    });

    const pastSelf = createGhost({
      recording: recorder.snapshot(),
      milestones: milestones.snapshot(),
      originNormalized: 5 / 24,
      instanceId: 1,
      startTick: 0,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    registry.add(5, pastSelf);

    // Loop back to 5:00 at arrivalTick = 30. PastSelf's milestone
    // absolute tick = 10, which is <= 30: PastSelf is despawned.
    registry.setActiveTimeline(6, 0);
    registry.setActiveTimeline(5, 30, { scene, world });
    expect(registry.ghostsFor(5)).toHaveLength(0);
    expect(scene.children).not.toContain(pastSelf.mesh);
  });

  it("PastSelf with startTick != 0 is correctly fast-forwarded by absolute arrival", () => {
    // Models the second loop iteration: a ghost filed in the middle
    // of a timeline (startTick > 0). Reading C: alive interval is
    // [startTick, startTick + door_traversal_tick).
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const recorder = new InputRecorder();
    for (let i = 0; i < 40; i += 1) {
      recorder.record({ ...NEUTRAL, right: true }, 5 / 24);
    }
    const milestones = new MilestoneRecorder();
    milestones.record({
      kind: "door_traversal",
      tick: 40,
      position: { x: 4.4, z: 0 },
      weight: DOOR_TRAVERSAL_WEIGHT,
      door: "east",
    });

    // Filed with startTick = 100. Alive interval is [100, 140).
    const pastSelf = createGhost({
      recording: recorder.snapshot(),
      milestones: milestones.snapshot(),
      originNormalized: 5 / 24,
      instanceId: 7,
      startTick: 100,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    registry.add(5, pastSelf);

    // Arrival at absolute tick 120 (inside [100, 140)): PastSelf is
    // alive and fast-forwarded to relativeTick = 20.
    registry.setActiveTimeline(6, 0);
    registry.setActiveTimeline(5, 120, { scene, world });
    expect(registry.ghostsFor(5)).toHaveLength(1);
    const t = pastSelf.body.translation();
    // 20 ticks at 4 m/s = 1.33 m east of spawn.
    expect(t.x).toBeCloseTo(20 * 4 / 60, 5);
    expect(t.z).toBe(0);

    // Arrival at absolute tick 200 (past [100, 140)): despawned.
    // We need to re-create the ghost since the previous registry
    // call mutated state; rebuild for the despawn assertion.
    const registry2 = createTimelineRegistry({ initialTimeline: 5 });
    const pastSelf2 = createGhost({
      recording: recorder.snapshot(),
      milestones: milestones.snapshot(),
      originNormalized: 5 / 24,
      instanceId: 7,
      startTick: 100,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    registry2.add(5, pastSelf2);
    registry2.setActiveTimeline(6, 0);
    registry2.setActiveTimeline(5, 200, { scene, world });
    expect(registry2.ghostsFor(5)).toHaveLength(0);
  });
});
