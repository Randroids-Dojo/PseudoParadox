import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  wireTraversal,
  type ActiveLifetime,
  type ActivePlayerHandle,
} from "../../src/sim/portalTraversal.ts";
import {
  createPortalTriggerSet,
  pointInsideTrigger,
} from "../../src/sim/portalTrigger.ts";
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
  isAct3TeamUp,
  type ActStateSnapshot,
  type BucketGhostSnapshot,
} from "../../src/sim/actState.ts";
import { createGhost, type GhostInstance } from "../../src/sim/ghostInstance.ts";
import { type KeyState } from "../../src/input/keyboard.ts";
import {
  applyKnockout,
  INITIAL_CONSCIOUSNESS,
} from "../../src/sim/knockoutState.ts";
import { applyKnockoutBodyResponse } from "../../src/sim/applyKnockoutBody.ts";
import {
  applyCarryAttachment,
  applyCarryPickup,
} from "../../src/sim/applyCarry.ts";
import { resolveCarryToggle, type Carryable } from "../../src/sim/carryState.ts";
import { nextInstanceId } from "../../src/sim/instanceId.ts";

/**
 * REQ-020 Act 3 team-up beat integration test
 * (`docs/gdd/03-story-acts-1-3.md` Act 3: Escape;
 * `docs/gdd/40-act-progress-and-narrative-beats.md` section 4 REQ-020).
 *
 * The GDD's narrative for the Act 3 team-up beat:
 *
 *   "This time, run toward the West door as the other instance chases
 *    you. Both instances get pulled through and arrive at 5:00. Two
 *    other instances of the player are now present in the same scene.
 *    The 6:00-origin instance and the active player team up to knock
 *    out the 5:00 instance."
 *
 * The dossier's pseudocode:
 *
 *   beatAct3TeamUp(snapshot):
 *     return snapshot.currentTimeline === 5
 *         && snapshot.registry.ghostsFor(5).some(g =>
 *              g.consciousness === 'unconscious'
 *              && timelineIdFromNormalized(g.originNormalized) === 5);
 *
 * The predicate reads: at 5:00 active timeline, at least one unconscious
 * ghost in bucket 5 whose origin timeline is 5 (i.e. the instance that
 * lived at 5:00 was the one knocked out). The watermark prerequisite
 * (`act-3-chase` already reached) is enforced OUTSIDE the predicate by
 * the observer's monotonic walk; this predicate stays pure with respect
 * to the snapshot only.
 *
 * Per Q-023's v1 simplification (`docs/OPEN_QUESTIONS.md`), unconscious
 * to conscious recovery is forbidden by REQ-033, so the literal "the
 * 6:00-arrival ghost punches the 5:00 instance on a recorded tick" is a
 * narrative property the recording substrate of REQ-001 / REQ-002
 * satisfies on the next loop iteration. For the team-up predicate gate
 * this slice exercises, the load-bearing state is:
 *
 *   - The chase has already played out: active timeline is 5, and the
 *     observer's watermark is at `act-3-chase`. We reuse the chase
 *     harness verbatim to land here.
 *   - Bucket 5 holds at least one ghost whose `originNormalized` is 5/24
 *     (i.e. recorded at 5:00; `timelineIdFromNormalized(5/24) === 5`).
 *     The chase test's prior phases have already filed two such ghosts
 *     into bucket 5: the loop-1 East-bound ghost-A (origin 5/24) and
 *     the loop-2 dragging-East ghost-C (origin 5/24, filed by
 *     `wireTraversal` on the East traversal at the end of loop 2).
 *     Per F-014, when the chase traversal switches the active
 *     timeline back to 5, the registry stamps the entering bucket's
 *     tick clock to West's `destinationTick = 30` and fast-forwards
 *     each ghost to `position(30 - startTick)`. Ghost-A and ghost-C
 *     have door_traversal milestones at recording length 40, which
 *     exceeds 30, so they stay alive and are fast-forwarded to
 *     tickIndex 30 of their east-walk replay.
 *   - The active player walks up to one of the 5:00-origin ghosts in
 *     bucket 5 and applies the same side effects the host's punch
 *     resolver applies: `applyKnockout(ghost.consciousness)` flips it
 *     to `'unconscious'`, `applyKnockoutBodyResponse(...)` writes the
 *     impulse plus the mesh tilt. This models the team-up: the active
 *     player throws the punch; the GDD's narrative places the
 *     6:00-arrival ghost coordinating on the same beat (per the
 *     dossier's "two instances at 5:00 coordinate"), but the predicate
 *     reads only the OUTCOME (the 5:00-origin instance going down), not
 *     the mechanism by which it was knocked out. The recording-driven
 *     coordination is narrative dressing per Q-023.
 *
 * The team-up predicate
 * (`currentTimeline === 5 && ghosts5.some(unconscious && origin === 5)`)
 * fires here. The observer's monotonic walk advances the watermark from
 * `act-3-chase` to `act-3-team-up`.
 *
 * NOT in scope:
 *   - Wiring the host's punch-resolver output to fire on a recorded tick
 *     of a 6:00-origin ghost. The team-up predicate reads the outcome,
 *     not the mechanism; the host wiring slice for Act 3 (REQ-023) is
 *     the canonical place for the per-tick punch resolver to drive this
 *     same state from live recordings.
 *   - REQ-021+ (mirror / final-knockout / escape): separate slices
 *     extend this same harness pattern.
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
  recentWestEntries: ActStateSnapshot["recentWestEntries"],
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
    recentWestEntries,
    activePlayerCrossedNorthAt12: false,
  };
};

/**
 * Drive the Act 2 first loop sequence to set the world up for loop 2.
 * Mirror of the helper in `act3Chase.test.ts` and `act3Setup.test.ts`;
 * lifted again because slice-discipline asks the third repetition before
 * extracting. This is now the third use; a follow-up extraction slice
 * will fold the three into a shared `tests/sim/_helpers/act2Loops.ts`
 * module rather than smuggling the extraction in here (per
 * slice-discipline: refactors are their own slice, not "while I'm
 * here" cleanups).
 */
const runLoopOne = (
  harness: Harness,
  detector: ReturnType<typeof createPortalTriggerSet>,
  startTick: number,
): { tick: number; ghostA: GhostInstance } => {
  const { lifetime, registry } = harness;
  let tick = startTick;
  detector.step(0, 0, tick++);
  for (let i = 0; i < 40; i++) {
    lifetime.recorder.record(inputState({ right: true }), 5 / 24);
  }
  detector.step(HALF_WIDTH - 0.4, 0, tick++);
  detector.step(0, 0, tick++);
  for (let i = 0; i < 4; i++) {
    lifetime.recorder.record(inputState({ left: true }), 6 / 24);
  }
  detector.step(-(HALF_WIDTH - 0.4), 0, tick++);
  const ghostA = registry.ghostsFor(5)[0];
  for (let i = 0; i < ghostA.recording.length; i++) {
    ghostA.advanceTick();
  }
  return { tick, ghostA };
};

/**
 * Drive the Act 2 second loop sequence on top of a loop-1 setup. Mirror
 * of the helper in `act3Chase.test.ts` and `act3Setup.test.ts`; lifted
 * again per the same third-repetition rationale. Same followup applies.
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
  if (
    player.carry.kind !== "carrying" ||
    player.carry.carriedId !== ghostA.instanceId
  ) {
    throw new Error(
      "REQ-020 test harness: expected ghost-A to be selected for carry",
    );
  }
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
    if (player.carry.kind === "carrying") {
      applyCarryAttachment(player.body, ghostA.body);
    }
  }
  detector.step(HALF_WIDTH - 0.4, 0, tick++);

  // Idle frame at 6:00 BEFORE the knockout so the lifetime's recorder has
  // at least one frame when the Act 2 to Act 3 boundary files the prior
  // lifetime as a ghost in bucket 6.
  lifetime.recorder.record(inputState({}), 6 / 24);

  // Phase 4: model the recorded "You-2 punches You1" beat as a direct
  // knockout against the active player at 6:00.
  player.consciousness = applyKnockout(player.consciousness);
  applyKnockoutBodyResponse(player.body, player.mesh, { x: 1, z: 0 });

  return { tick };
};

/**
 * Begin a fresh active lifetime at 5:00 after the prior lifetime ended
 * unconscious at 6:00. Mirror of the helper in `act3Chase.test.ts` and
 * `act3Setup.test.ts`; lifted again per the same third-repetition
 * rationale.
 */
const beginNewLifetimeAt5 = (harness: Harness): void => {
  const { scene, world, player, lifetime, registry } = harness;

  const recording = lifetime.recorder.snapshot();
  if (recording.length > 0) {
    const priorGhost = createGhost({
      recording,
      originNormalized: 6 / 24,
      instanceId: lifetime.instanceId,
      scene,
      world,
      startPosition: {
        x: player.body.translation().x,
        z: player.body.translation().z,
      },
    });
    priorGhost.consciousness = applyKnockout(priorGhost.consciousness);
    registry.add(6, priorGhost);
  }

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

  lifetime.recorder = new InputRecorder();

  lifetime.milestones = new MilestoneRecorder();
  lifetime.startPosition = { x: 0, z: 0 };
  lifetime.originNormalized = 5 / 24;
  lifetime.instanceId = player.instanceId;

  registry.setActiveTimeline(5);
};

/**
 * Drive the Act 3 chase sequence on top of an act-3-setup state. Files
 * a chasing ghost into bucket 6, drives both bodies through the West
 * trigger, and confirms the active player traversed back to active=5
 * with two distinct West-entry events recorded on the observer. Returns
 * the post-traversal `tick` so the team-up phase can continue from a
 * fresh tick. Mirrors the chase phase from `act3Chase.test.ts`; this is
 * its second use, so the slice keeps it inline per slice-discipline
 * (extraction waits for the third repetition).
 */
const runChaseToActive5 = (
  harness: Harness,
  detector: ReturnType<typeof createPortalTriggerSet>,
  observer: ReturnType<typeof createActStateObserver>,
  startTick: number,
): { tick: number; entries: ActStateSnapshot["recentWestEntries"] } => {
  const { scene, world, player, lifetime, registry } = harness;

  // Walk East from 5:00 to 6:00 so the chase happens at 6:00 (West door
  // lit there per `DOOR_STATE_BY_HOUR[6]`, routes to 5:00 per
  // `ACT_ONE_PORTAL_SPECS.west.destinationHours`).
  let tick = startTick;
  detector.step(0, 0, tick++);
  for (let i = 0; i < 40; i++) {
    lifetime.recorder.record(inputState({ right: true }), 5 / 24);
  }
  detector.step(HALF_WIDTH - 0.4, 0, tick++);

  // Author the chasing ghost: a 5-frame West-bound recording filed into
  // bucket 6.
  const chaserRecorder = new InputRecorder();
  for (let i = 0; i < 5; i++) {
    chaserRecorder.record(inputState({ left: true }), 6 / 24);
  }
  const chaserRecording = chaserRecorder.snapshot();
  // Reserve an id past the upcoming West traversal: the active player will
  // be promoted to `nextInstanceId(player.instanceId)` on the lit-portal
  // entry, so the chaser takes the id one step beyond that to avoid a
  // collision in the post-chase snapshot.
  const chaserInstanceId = nextInstanceId(nextInstanceId(player.instanceId));
  const chaser = createGhost({
    recording: chaserRecording,
    originNormalized: 6 / 24,
    instanceId: chaserInstanceId,
    scene,
    world,
    startPosition: { x: 0.2, z: 0 },
  });
  registry.add(6, chaser);

  const westTrigger = detector.triggers.find(
    (t) => t.portal.door.direction === "west",
  );
  if (!westTrigger) {
    throw new Error("REQ-020 test: missing West portal trigger");
  }

  const eastFaceX = westTrigger.centerX + westTrigger.halfX;
  player.body.setTranslation(
    { x: eastFaceX + 0.05, y: player.body.translation().y, z: -0.5 },
    true,
  );
  player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

  chaser.body.setTranslation(
    { x: eastFaceX + 0.05, y: chaser.body.translation().y, z: 0.5 },
    true,
  );
  chaser.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

  let activePlayerInsideWest = false;
  let chaserInsideWest = false;
  let activePlayerEntryTick = -1;
  let chaserEntryTick = -1;
  const CHASE_TICKS_MAX = 60;
  for (let i = 0; i < CHASE_TICKS_MAX; i++) {
    const t = tick++;
    chaser.advanceTick();
    if (chaser.tickIndex > chaser.recording.length) {
      const chaserCurrent = chaser.body.linvel();
      chaser.body.setLinvel(
        { x: -4, y: chaserCurrent.y, z: 0 },
        true,
      );
    }

    const playerCurrent = player.body.linvel();
    player.body.setLinvel(
      { x: -4, y: playerCurrent.y, z: 0 },
      true,
    );
    lifetime.recorder.record(inputState({ left: true }), 6 / 24);

    world.step();

    const chaserT = chaser.body.translation();
    const chaserNowInside = pointInsideTrigger(
      westTrigger,
      chaserT.x,
      chaserT.z,
    );
    if (chaserNowInside && !chaserInsideWest) {
      observer.recordWestEntry({ instanceId: chaser.instanceId, tick: t });
      chaserEntryTick = t;
    }
    chaserInsideWest = chaserNowInside;

    const playerT = player.body.translation();
    const playerNowInside = pointInsideTrigger(
      westTrigger,
      playerT.x,
      playerT.z,
    );
    if (playerNowInside && !activePlayerInsideWest) {
      observer.recordWestEntry({
        instanceId: player.instanceId,
        tick: t,
      });
      activePlayerEntryTick = t;
    }
    activePlayerInsideWest = playerNowInside;
    detector.step(playerT.x, playerT.z, t);

    if (registry.activeTimeline === 5 && chaserEntryTick >= 0) break;
  }

  // Sanity: chase fired and player traversed.
  if (
    activePlayerEntryTick < 0 ||
    chaserEntryTick < 0 ||
    Math.abs(activePlayerEntryTick - chaserEntryTick) > 2
  ) {
    throw new Error(
      `REQ-020 test: chase preconditions failed (player=${activePlayerEntryTick}, chaser=${chaserEntryTick})`,
    );
  }

  return { tick, entries: observer.recentWestEntries() };
};

describe("REQ-020 Act 3 team-up integration", () => {
  it("knocking out a 5:00-origin ghost in bucket 5 after the chase transitions the observer to act-3-team-up", () => {
    const harness = buildHarness();
    const { scene, world, player, lifetime, registry } = harness;

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // -----------------------------------------------------------------
    // Phase 1: drive Act 2 loops 1 + 2 to land at active=6 with the
    // player unconscious at 6:00.
    // -----------------------------------------------------------------
    const observer = createActStateObserver();

    const { tick: tickAfterLoop1, ghostA } = runLoopOne(harness, detector, 0);
    observer.update(buildActStateSnapshot(registry, player, []));
    expect(observer.state).toBe("act-2-loop-1");

    const { tick: tickAfterLoop2 } = runLoopTwo(
      harness,
      detector,
      ghostA,
      tickAfterLoop1,
    );
    observer.update(buildActStateSnapshot(registry, player, []));
    expect(observer.state).toBe("act-2-loop-2");

    // -----------------------------------------------------------------
    // Phase 2: implicit Act 2 to Act 3 fade boundary. Begin a fresh
    // lifetime at 5:00; observer transitions to `act-3-setup`.
    // -----------------------------------------------------------------
    beginNewLifetimeAt5(harness);
    observer.update(buildActStateSnapshot(registry, player, []));
    expect(observer.state).toBe("act-3-setup");

    // Sanity: detector overlap state is stale from the prior East
    // traversal; reset it before driving the chase.
    detector.resetOverlapState();

    // -----------------------------------------------------------------
    // Phase 3: drive the Act 3 chase. Walks East to 6:00, files a
    // chasing ghost in bucket 6, drives both bodies through the West
    // trigger, and traverses the active player back to 5:00.
    // -----------------------------------------------------------------
    const { entries } = runChaseToActive5(
      harness,
      detector,
      observer,
      tickAfterLoop2 + 100,
    );
    observer.update(buildActStateSnapshot(registry, player, entries));
    expect(observer.state).toBe("act-3-chase");
    expect(registry.activeTimeline).toBe(5);

    // -----------------------------------------------------------------
    // Phase 4: identify a 5:00-origin ghost in bucket 5 and apply the
    // team-up knockout. Bucket 5 holds the loop-1 ghost-A (origin
    // 5/24) plus the loop-2 dragging-East ghost-C (origin 5/24, filed
    // by `wireTraversal` at the end of loop 2). Both were reset to
    // tick 0 conscious by `setActiveTimeline(5)` when the chase
    // traversal switched the active timeline back to 5.
    //
    // Per Q-023, the GDD's narrative places the 6:00-arrival ghost
    // coordinating on the same beat; the predicate reads only the
    // OUTCOME (the 5:00-origin instance going down), not the
    // mechanism. The active player throws the punch directly here,
    // modelling the team-up's load-bearing state change.
    // -----------------------------------------------------------------
    const ghostsAt5 = registry.ghostsFor(5);
    expect(ghostsAt5.length).toBeGreaterThanOrEqual(1);
    const targetGhost = ghostsAt5.find(
      (g) => Math.abs(g.originNormalized - 5 / 24) < 1e-6,
    );
    if (!targetGhost) {
      throw new Error(
        "REQ-020 test: expected at least one 5:00-origin ghost in bucket 5",
      );
    }
    expect(targetGhost.consciousness).toBe("conscious");

    const targetPos = targetGhost.body.translation();
    player.body.setTranslation(
      {
        x: targetPos.x + 0.5,
        y: player.body.translation().y,
        z: targetPos.z,
      },
      true,
    );
    targetGhost.consciousness = applyKnockout(targetGhost.consciousness);
    applyKnockoutBodyResponse(targetGhost.body, targetGhost.mesh, {
      x: -0.5,
      z: 0,
    });

    // -----------------------------------------------------------------
    // Phase 5: build the snapshot and assert the team-up predicate.
    // -----------------------------------------------------------------
    const snapshot = buildActStateSnapshot(registry, player, entries);
    expect(isAct3TeamUp(snapshot)).toBe(true);
    expect(observer.update(snapshot)).toBe("act-3-team-up");
    expect(observer.state).toBe("act-3-team-up");
  });

  it("isAct3TeamUp fails when either of its conjunctions is missing", () => {
    // Boundary regression: the predicate's conjunctions
    // (currentTimeline === 5; bucket 5 has at least one unconscious
    // ghost whose origin timeline is 5) are each load-bearing. Build
    // a fully-satisfying snapshot, then drop each conjunction in
    // turn and assert the predicate returns false.
    const harness = buildHarness();
    const { scene, world, registry, player } = harness;

    // Synthesize bucket 5 directly: a 5:00-origin ghost flipped to
    // unconscious. The recording substrate is irrelevant to the
    // predicate (it reads only origin tint plus consciousness).
    const recorder = new InputRecorder();
    recorder.record(inputState({}), 5 / 24);
    const ghost = createGhost({
      recording: recorder.snapshot(),
      originNormalized: 5 / 24,
      instanceId: 99,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    ghost.consciousness = applyKnockout(ghost.consciousness);
    registry.add(5, ghost);
    registry.setActiveTimeline(5);

    const baseSnapshot = buildActStateSnapshot(registry, player, []);
    expect(isAct3TeamUp(baseSnapshot)).toBe(true);

    // Drop conjunction 1: currentTimeline !== 5.
    const wrongTimeline: ActStateSnapshot = {
      ...baseSnapshot,
      currentTimeline: 6,
      registry: {
        activeTimeline: 6,
        ghostsFor: baseSnapshot.registry.ghostsFor,
      },
    };
    expect(isAct3TeamUp(wrongTimeline)).toBe(false);

    // Drop conjunction 2 (variant a): the bucket-5 ghost is conscious.
    const consciousGhost: ActStateSnapshot = {
      ...baseSnapshot,
      registry: {
        activeTimeline: 5,
        ghostsFor: (timeline) =>
          timeline === 5
            ? baseSnapshot.registry
                .ghostsFor(5)
                .map((g) => ({ ...g, consciousness: "conscious" as const }))
            : baseSnapshot.registry.ghostsFor(timeline),
      },
    };
    expect(isAct3TeamUp(consciousGhost)).toBe(false);

    // Drop conjunction 2 (variant b): the unconscious ghost has a
    // non-5 origin (e.g. 6/24, the 6:00-origin chaser instance).
    // `timelineIdFromNormalized(6/24) === 6`, so the predicate's
    // origin filter rejects this ghost.
    const wrongOrigin: ActStateSnapshot = {
      ...baseSnapshot,
      registry: {
        activeTimeline: 5,
        ghostsFor: (timeline) =>
          timeline === 5
            ? baseSnapshot.registry
                .ghostsFor(5)
                .map((g) => ({ ...g, originNormalized: 6 / 24 }))
            : baseSnapshot.registry.ghostsFor(timeline),
      },
    };
    expect(isAct3TeamUp(wrongOrigin)).toBe(false);
  });
});
