import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  wireTraversal,
  type ActiveLifetime,
  type ActivePlayerHandle,
} from "../../src/sim/portalTraversal.ts";
import { createPortalTriggerSet } from "../../src/sim/portalTrigger.ts";
import { createActOnePortals } from "../../src/sim/portal.ts";
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
  isAct2Loop2,
  isAct3Setup,
  type ActStateSnapshot,
  type BucketGhostSnapshot,
} from "../../src/sim/actState.ts";
import { createGhost, type GhostInstance } from "../../src/sim/ghostInstance.ts";
import { type KeyState } from "../../src/input/keyboard.ts";
import { applyKnockout, INITIAL_CONSCIOUSNESS } from "../../src/sim/knockoutState.ts";
import { applyKnockoutBodyResponse } from "../../src/sim/applyKnockoutBody.ts";
import {
  applyCarryAttachment,
  applyCarryPickup,
} from "../../src/sim/applyCarry.ts";
import { resolveCarryToggle, type Carryable } from "../../src/sim/carryState.ts";
import { nextInstanceId } from "../../src/sim/instanceId.ts";
import { runLoopOne } from "./_helpers/actLoops.ts";

/**
 * REQ-018 Act 3 setup integration test
 * (`docs/gdd/03-story-acts-1-3.md` Act 3: Escape;
 * `docs/gdd/40-act-progress-and-narrative-beats.md` section 4 REQ-018).
 *
 * The GDD's narrative for Act 3 setup:
 *
 *   "Fade in. Clock reads 5:00. Repeat the Act 2 sequence to position a
 *    knocked-out instance at 6:00. Wait for the other instance to wake."
 *
 * The Act 2 to Act 3 boundary in the GDD is a fade-out / fade-in: the
 * prior lifetime ended unconscious at 6:00, and a new active lifetime
 * begins at 5:00. There is no portal traversal between the two acts;
 * the lifetime boundary is implicit in the narrative.
 *
 * Per Q-023's v1 simplification (`docs/OPEN_QUESTIONS.md`), unconscious
 * to conscious recovery is forbidden by REQ-033 in v1. The literal
 * "wait for the other instance to wake" cannot be staged inside one
 * play session; the recording substrate of REQ-001 / REQ-002 satisfies
 * the literal version on the next loop iteration. For the act-3-setup
 * predicate gate this slice exercises, the load-bearing state is:
 *
 *   - The prior lifetime ended unconscious at 6:00; that lifetime is
 *     filed into bucket 6 as a ghost flagged `unconscious` (modelling
 *     the body left at 6:00 by Act 2 loop 2). Its consciousness flag
 *     is post-creation flipped via `applyKnockout`, the same pattern
 *     `mountAct1Cinematic` uses for the Act 1 body ghost.
 *   - A new active lifetime opens with `instanceId = nextInstanceId(prev)`
 *     at the room center, conscious. The prior recorder is replaced;
 *     `lifetime.startPosition`, `lifetime.originNormalized`, and
 *     `lifetime.instanceId` are advanced the same way `wireTraversal`
 *     advances them on a lit-portal traversal.
 *   - `setActiveTimeline(5)` hides bucket 6 (the unconscious ghost
 *     stays unconscious because hide does NOT reset; reset only fires
 *     on the entering bucket). At this snapshot moment, bucket 6 still
 *     holds the unconscious ghost, active timeline is 5, and the active
 *     player is conscious at 5:00.
 *
 * The act-3-setup predicate (`currentTimeline === 5 && ghosts6.some(unconscious)`)
 * fires here. The observer's monotonic walk advances the watermark
 * from `act-2-loop-2` (set by the prior phases) to `act-3-setup`.
 *
 * NOT in scope:
 *   - The Phase-4 wake mechanic itself (forbidden by REQ-033 in v1;
 *     the recording substrate satisfies the GDD's narrative on the next
 *     loop iteration when the recorded punch tick replays).
 *   - Any host-side wiring of the act-3-setup transition into `src/app.ts`.
 *     The observer remains a data-only structure this slice; per-beat
 *     host wiring lands with the REQ-023 escape slice.
 *   - REQ-019+ (Act 3 chase / team-up / mirror / final-knockout):
 *     separate slices extend this same harness pattern.
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
  // satisfies isAct1Spawn (the prerequisite for every later beat).
  mountAct1Cinematic({ registry, scene, world });
  return { scene, world, player, lifetime, registry };
};

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


/**
 * Drive the Act 2 second loop sequence on top of a loop-1 setup. After this
 * call returns: active timeline is 6, the active player is unconscious at
 * 6:00, bucket 5 holds at least one unconscious ghost (ghost-A) plus the
 * dragging-East lifetime (ghost-C), bucket 6 still holds ghost-B.
 *
 * Mirror of `act2Loop2.test.ts`'s in-test sequence; the helper extraction is
 * deferred per slice-discipline (third repetition). This second-loop driver
 * is only one repetition (the first lives inline in `act2Loop2.test.ts`),
 * so the body is kept here local to this file's narrative.
 */
const runLoopTwo = (
  harness: Harness,
  detector: ReturnType<typeof createPortalTriggerSet>,
  ghostA: GhostInstance,
  startTick: number,
): { tick: number } => {
  const { player, lifetime, registry } = harness;
  let tick = startTick;

  // Phase 3a: knock out ghost-A.
  const ghostAPos = ghostA.body.translation();
  player.body.setTranslation(
    { x: ghostAPos.x + 0.5, y: player.body.translation().y, z: ghostAPos.z },
    true,
  );
  ghostA.consciousness = applyKnockout(ghostA.consciousness);
  applyKnockoutBodyResponse(ghostA.body, ghostA.mesh, { x: -0.5, z: 0 });

  // Phase 3b: pickup ghost-A.
  const carryables: Carryable[] = registry.ghostsFor(5).map((g) => ({
    id: g.instanceId,
    position: { x: g.body.translation().x, z: g.body.translation().z },
    consciousness: g.consciousness,
  }));
  const carrier = {
    id: player.instanceId,
    position: {
      x: player.body.translation().x,
      z: player.body.translation().z,
    },
  };
  player.carry = resolveCarryToggle(player.carry, true, carrier, carryables);
  applyCarryPickup(ghostA.body);

  // Phase 3c: walk East with the body carried, then traverse East trigger.
  detector.step(
    player.body.translation().x,
    player.body.translation().z,
    tick++,
  );
  for (let i = 0; i < 4; i++) {
    lifetime.recorder.record(
      inputState({ right: true, pickup: true }),
      5 / 24,
    );
    applyCarryAttachment(player.body, ghostA.body);
  }
  detector.step(HALF_WIDTH - 0.4, 0, tick++);

  // Record one idle frame at 6:00 BEFORE the knockout so the lifetime's
  // recorder has at least one frame when the Act 2 to Act 3 boundary
  // files the prior lifetime as a ghost in bucket 6. Without this, the
  // recorder is fresh-empty (the East traversal swapped recorders) and
  // `beginNewLifetimeAt5` would silently skip filing the prior lifetime
  // (the same zero-length skip path `wireTraversal` uses on a no-recording
  // traversal).
  lifetime.recorder.record(inputState({}), 6 / 24);

  // Phase 4: model the recorded "You-2 punches You1" beat as a direct
  // knockout against the active player at 6:00.
  player.consciousness = applyKnockout(player.consciousness);
  applyKnockoutBodyResponse(player.body, player.mesh, { x: 1, z: 0 });

  return { tick };
};

/**
 * Begin a fresh active lifetime at 5:00 after the prior lifetime ended
 * unconscious at 6:00. This is the implicit fade-out / fade-in boundary
 * the GDD describes between Act 2 and Act 3. The operations mirror the
 * lifetime-rollover the host's traversal handler runs on a lit-portal
 * traversal (`wireTraversal` step 1-7), minus the destination teleport
 * (which here is to the room center at 5:00) and minus the East/West
 * trigger event that drove the rollover. The prior lifetime's recording
 * is filed as a ghost in bucket 6 (where it ended) and post-flipped to
 * `unconscious` via `applyKnockout` in the same pattern
 * `mountAct1Cinematic` uses for the Act 1 body ghost.
 *
 * After this call returns:
 *   - Bucket 6 has at least one unconscious ghost (the prior lifetime).
 *   - The active player is conscious at the room center at 5:00 with a
 *     fresh `instanceId`, a fresh recorder, and `originNormalized = 5/24`.
 *   - Active timeline is 5.
 */
const beginNewLifetimeAt5 = (harness: Harness): void => {
  const { scene, world, player, lifetime, registry } = harness;

  // 1. File the prior (unconscious) lifetime as a ghost in bucket 6. Use
  //    the recorder's snapshot as the ghost's recording. The ghost's
  //    `originNormalized` reflects the timeline the lifetime ended in
  //    (6:00) so the registry's tint and bucket bookkeeping match where
  //    the body actually lies. The post-creation `applyKnockout` flip
  //    mirrors the Act 1 cinematic body ghost: `createGhost` opens
  //    conscious; the host-side flag flip is what records the unconscious
  //    state.
  const recording = lifetime.recorder.snapshot();
  if (recording.length > 0) {
    const priorGhost = createGhost({
      recording,
      originNormalized: 6 / 24,
      instanceId: lifetime.instanceId,
      scene,
      world,
      // Position the ghost at the active player's last position (where
      // the body went down at 6:00).
      startPosition: {
        x: player.body.translation().x,
        z: player.body.translation().z,
      },
    });
    priorGhost.consciousness = applyKnockout(priorGhost.consciousness);
    registry.add(6, priorGhost);
  }

  // 2. Reset the active player to a fresh lifetime at 5:00. Mirror what
  //    `wireTraversal` does on a lit traversal: zero velocity, restamp
  //    origin tint, advance instanceId, and place the body at the room
  //    center. The mesh's tilt from the prior knockout is reset by
  //    re-stamping the origin tint and clearing the rotation.
  const restY = PLAYER_CAPSULE.cylinderLength / 2 + PLAYER_CAPSULE.radius;
  player.body.setTranslation({ x: 0, y: restY, z: 0 }, true);
  player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  player.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  player.consciousness = INITIAL_CONSCIOUSNESS;
  player.originNormalized = 5 / 24;
  applyInstanceTint(player.mesh, 5 / 24);
  player.mesh.rotation.set(0, 0, 0);
  player.instanceId = nextInstanceId(player.instanceId);
  player.carry = { kind: "idle" };

  // 3. Open a fresh lifetime at 5:00. Same shape as the traversal handler.
  lifetime.recorder = new InputRecorder();
  lifetime.milestones = new MilestoneRecorder();
  lifetime.startPosition = { x: 0, z: 0 };
  lifetime.originNormalized = 5 / 24;
  lifetime.instanceId = player.instanceId;

  // 4. Switch the registry's active timeline to 5. This hides bucket 6
  //    (the unconscious prior-lifetime ghost stays unconscious because
  //    hide does NOT reset; reset only fires on the entering bucket) and
  //    resets bucket 5 ghosts to tick 0 (ghost-A and ghost-C re-spawn
  //    conscious; their consciousness is per-loop replay state per
  //    REQ-033's reset semantics).
  registry.setActiveTimeline(5);
};

describe("REQ-018 Act 3 setup integration", () => {
  it("repeating the Act 2 sequence to position a knocked-out instance at 6:00 and beginning a fresh lifetime at 5:00 transitions the observer to act-3-setup", () => {
    const harness = buildHarness();
    const { scene, world, player, lifetime, registry } = harness;

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // ---------------------------------------------------------------
    // Phase 1: drive the Act 2 first and second loops to the prior-PR
    // end state. After this: active=6, player unconscious at 6:00,
    // bucket 5 = [ghost-A unconscious, ghost-C dragging-East], bucket 6
    // = [ghost-B West-bound]. The observer is opened mid-test and fed
    // the loop-1 then loop-2 snapshots so the watermark advances to
    // `act-2-loop-2`. This mirrors the host's per-fixed-step observer
    // drive in production.
    // ---------------------------------------------------------------
    const observer = createActStateObserver();

    const { tick: tickAfterLoop1, ghostA } = runLoopOne(harness, detector, 0);

    // Sanity: loop-1 state passes isAct2Loop1.
    expect(registry.activeTimeline).toBe(5);
    expect(isAct2Loop1(buildActStateSnapshot(registry, player))).toBe(true);
    observer.update(buildActStateSnapshot(registry, player));
    expect(observer.state).toBe("act-2-loop-1");

    const { tick: tickAfterLoop2 } = runLoopTwo(
      harness,
      detector,
      ghostA,
      tickAfterLoop1,
    );

    // Sanity: loop-2 state passes isAct2Loop2.
    expect(registry.activeTimeline).toBe(6);
    expect(player.consciousness).toBe("unconscious");
    expect(isAct2Loop2(buildActStateSnapshot(registry, player))).toBe(true);
    observer.update(buildActStateSnapshot(registry, player));
    expect(observer.state).toBe("act-2-loop-2");

    // ---------------------------------------------------------------
    // Phase 2: begin the Act 3 fresh lifetime at 5:00. The prior
    // unconscious lifetime is filed as an unconscious ghost in bucket 6
    // (the body left at 6:00), the active player resets to a fresh
    // conscious lifetime at the room center at 5:00, and the registry
    // switches active timeline to 5. The instance numbering / spawn
    // logic mirrors `wireTraversal`'s lit-portal traversal step 1-6,
    // minus the destination teleport's portal-trigger surface (which
    // is the only thing different between an Act 2 to Act 3 fade
    // boundary and a normal portal traversal).
    // ---------------------------------------------------------------
    const priorPlayerInstanceId = player.instanceId;
    beginNewLifetimeAt5(harness);

    // The instance numbering advanced (REQ-007 / REQ-008): the new
    // active player is `nextInstanceId(prev)`. The prior lifetime is now
    // in bucket 6 with the prior id.
    expect(player.instanceId).toBe(nextInstanceId(priorPlayerInstanceId));
    expect(lifetime.instanceId).toBe(player.instanceId);

    // Bucket 6 now holds ghost-B from loop 1 plus the prior lifetime
    // (unconscious). At least one ghost in bucket 6 is unconscious; the
    // act-3-setup predicate's gate.
    const bucket6 = registry.ghostsFor(6);
    expect(bucket6.length).toBeGreaterThanOrEqual(2);
    expect(bucket6.some((g) => g.consciousness === "unconscious")).toBe(true);
    // Active timeline is 5; the active player is at 5:00, conscious.
    expect(registry.activeTimeline).toBe(5);
    expect(player.consciousness).toBe("conscious");
    expect(player.originNormalized).toBeCloseTo(5 / 24, 6);

    // Bucket 5 ghosts (ghost-A, ghost-C) reset to conscious on entering-
    // bucket re-entry per REQ-033 reset semantics. The act-3-setup
    // predicate does NOT read bucket 5, so the reset is harmless here.
    expect(registry.ghostsFor(5).every((g) => g.consciousness === "conscious"))
      .toBe(true);

    // ---------------------------------------------------------------
    // Phase 3: assert the observer transitions to `act-3-setup`. The
    // predicate (`currentTimeline === 5 && ghosts6.some(unconscious)`)
    // fires here. The observer's monotonic walk advances the watermark
    // from `act-2-loop-2` to `act-3-setup`. The next predicate
    // (`act-3-chase`) requires two distinct West-portal entries within
    // CHASE_WINDOW_TICKS, which is empty in this snapshot, so the walk
    // halts at `act-3-setup`.
    // ---------------------------------------------------------------
    const snapshot = buildActStateSnapshot(registry, player);
    expect(isAct3Setup(snapshot)).toBe(true);
    expect(observer.update(snapshot)).toBe("act-3-setup");
    expect(observer.state).toBe("act-3-setup");

    // Suppress unused-variable lint warnings (the tick counters are
    // returned for narrative legibility / future continuation slices).
    void tickAfterLoop2;
  });

  it("isAct3Setup fails when either of its two conjunctions is missing", () => {
    // Boundary regression: the predicate's two conjunctions
    // (currentTimeline === 5, ghosts6 has at least one unconscious) are
    // each load-bearing. Build a fully-satisfying snapshot, then drop
    // each conjunction in turn and assert the predicate returns false.
    const harness = buildHarness();
    const { scene, world, player, lifetime, registry } = harness;

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    const { tick: tickAfterLoop1, ghostA } = runLoopOne(harness, detector, 0);
    runLoopTwo(harness, detector, ghostA, tickAfterLoop1);
    beginNewLifetimeAt5(harness);

    const baseSnapshot = buildActStateSnapshot(registry, player);
    expect(isAct3Setup(baseSnapshot)).toBe(true);

    // Drop conjunction 1: currentTimeline !== 5.
    const wrongTimeline: ActStateSnapshot = {
      ...baseSnapshot,
      currentTimeline: 6,
      registry: {
        activeTimeline: 6,
        ghostsFor: baseSnapshot.registry.ghostsFor,
      },
    };
    expect(isAct3Setup(wrongTimeline)).toBe(false);

    // Drop conjunction 2: no unconscious ghost in bucket 6. Project the
    // bucket-6 ghosts forcibly through a flag-flip filter.
    const noUnconsciousIn6: ActStateSnapshot = {
      ...baseSnapshot,
      registry: {
        activeTimeline: baseSnapshot.registry.activeTimeline,
        ghostsFor: (timeline) => {
          const ghosts = baseSnapshot.registry.ghostsFor(timeline);
          if (timeline !== 6) return ghosts;
          return ghosts.map((g) => ({ ...g, consciousness: "conscious" }));
        },
      },
    };
    expect(isAct3Setup(noUnconsciousIn6)).toBe(false);
  });
});
