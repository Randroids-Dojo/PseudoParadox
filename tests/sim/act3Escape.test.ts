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
  isEscaped,
  type ActStateSnapshot,
  type BucketGhostSnapshot,
} from "../../src/sim/actState.ts";
import { litStateForTimeline } from "../../src/sim/litStateForTimeline.ts";
import { createGhost, type GhostInstance } from "../../src/sim/ghostInstance.ts";
import { type KeyState } from "../../src/input/keyboard.ts";
import {
  applyKnockout,
  INITIAL_CONSCIOUSNESS,
} from "../../src/sim/knockoutState.ts";
import { applyKnockoutBodyResponse } from "../../src/sim/applyKnockoutBody.ts";
import {
  applyCarryAttachment,
  applyCarryDrop,
  applyCarryPickup,
} from "../../src/sim/applyCarry.ts";
import { resolveCarryToggle, type Carryable } from "../../src/sim/carryState.ts";
import { nextInstanceId } from "../../src/sim/instanceId.ts";

/**
 * REQ-023 Act 3 escape integration test plus REQ-024 dependency monotonicity.
 * (`docs/gdd/03-story-acts-1-3.md` Act 3: Escape;
 * `docs/gdd/40-act-progress-and-narrative-beats.md` section 4 REQ-023.)
 *
 * The GDD's narrative for the Act 3 escape beat:
 *
 *   "The North door at 12:00 is now open. No one is left to stop the
 *   player. Run through the North door."
 *
 * The dossier's pseudocode:
 *
 *   beatAct3Escape(snapshot):
 *     return snapshot.currentTimeline === 12
 *         && snapshot.activePlayer.position.crossedNorthTriggerSinceWatermark
 *         && snapshot.watermark >= 'act-3-final-knockout'
 *         && allCinematicActorsCompleted(snapshot.registry.ghostsFor(12));
 *
 * The predicate reads: at 12:00 active timeline, the active player crossed
 * the North trigger since the last watermark advance, and every cinematic
 * actor in the 12:00 bucket has completed its recording. The watermark
 * prerequisite (`act-3-final-knockout` already reached) is enforced
 * OUTSIDE the predicate by the observer's monotonic walk.
 *
 * The load-bearing state for this slice:
 *
 *   - Phases 1 through 12 reuse the final-knockout harness verbatim to land
 *     the world at active=12, carry idle, with TWO unconscious ghosts in
 *     bucket 12 (the mirror placement-record and the just-knocked-out
 *     6:00-origin partner) plus the three cinematic-actor ghosts. Observer
 *     watermark sits at `act-3-final-knockout`.
 *   - Phase 13 advances every cinematic-actor ghost in the 12:00 bucket
 *     past the end of its recording via `advanceTick`. With the cinematic
 *     actors completed AND the active player crossing the North trigger,
 *     the `litStateForTimeline` arrivals body lights the North door at
 *     12:00 (REQ-011 deepening), and the active player can traverse.
 *   - Phase 14 walks the active player into the North trigger volume at
 *     12:00 via `detector.step`, sets `activePlayerCrossedNorthAt12 = true`
 *     on the snapshot, and asserts `isEscaped(snapshot) === true` plus
 *     `observer.update(snapshot)` walks from `act-3-final-knockout` to
 *     `escaped`.
 *
 * REQ-024 monotonicity confirmation: after the integration test lands the
 * full Act 1 to escape sequence end-to-end, a separate property test
 * confirms that out-of-order beat satisfaction does NOT advance the
 * watermark. A fresh observer fed an Act-3-shaped snapshot from
 * `not-started` stays at `not-started` because the forward walk requires
 * every prerequisite predicate to pass on the same snapshot.
 *
 * NOT in scope:
 *   - Wiring the F-006 unification of the visual paint path through
 *     `litStateForTimeline`. The painted door at 12:00 reads the static
 *     `DOOR_STATE_BY_HOUR[12]` seed (`north: true`) unconditionally; the
 *     traversal gate reads `litStateForTimeline` and respects the arrivals
 *     body. The mismatch is a known F-006 followup and does not block this
 *     slice (the test reads the gate, not the painted door).
 *   - The "destination of the North-from-12 portal." The Act 1 portal
 *     authoring marks `north` as `destinationHours: 12` (a self-loop)
 *     because the level boundary is "outside the room" with no destination
 *     timeline. This test asserts the active player CROSSED the North
 *     trigger (the level-complete signal); the post-traversal teleport is
 *     a follow-up if the host needs an after-credits state.
 */

beforeAll(async () => {
  await RAPIER.init();
});

const HALF_WIDTH = ROOM_DIMENSIONS.width / 2;
const HALF_DEPTH = ROOM_DIMENSIONS.depth / 2;

const RESTING_Y = PLAYER_CAPSULE.cylinderLength / 2 + PLAYER_CAPSULE.radius;

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
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, RESTING_Y, 0)
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
  options: { activePlayerCrossedNorthAt12?: boolean } = {},
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
    activePlayerCrossedNorthAt12:
      options.activePlayerCrossedNorthAt12 ?? false,
  };
};

/**
 * Drive the Act 2 first loop sequence to set the world up for loop 2.
 * Mirror of helpers in `act3Mirror.test.ts` and `act3FinalKnockout.test.ts`.
 * Per slice-discipline, the planned extraction into
 * `tests/sim/_helpers/act2Loops.ts` is its own slice; this slice keeps the
 * sixth use inline the same way the prior five did.
 */
const runLoopOne = (
  harness: Harness,
  detector: ReturnType<typeof createPortalTriggerSet>,
  startTick: number,
): { tick: number; ghostA: GhostInstance } => {
  const { lifetime, registry } = harness;
  let tick = startTick;
  detector.step(0, 0, tick++);
  for (let i = 0; i < 5; i++) {
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

const runLoopTwo = (
  harness: Harness,
  detector: ReturnType<typeof createPortalTriggerSet>,
  ghostA: GhostInstance,
  startTick: number,
): { tick: number } => {
  const { player, lifetime, registry } = harness;
  let tick = startTick;

  const ghostAPos = ghostA.body.translation();
  player.body.setTranslation(
    { x: ghostAPos.x + 0.5, y: player.body.translation().y, z: ghostAPos.z },
    true,
  );
  ghostA.consciousness = applyKnockout(ghostA.consciousness);
  applyKnockoutBodyResponse(ghostA.body, ghostA.mesh, { x: -0.5, z: 0 });

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
      "REQ-023 test harness: expected ghost-A to be selected for carry",
    );
  }
  applyCarryPickup(ghostA.body);

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

  lifetime.recorder.record(inputState({}), 6 / 24);
  player.consciousness = applyKnockout(player.consciousness);
  applyKnockoutBodyResponse(player.body, player.mesh, { x: 1, z: 0 });

  return { tick };
};

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

  player.body.setTranslation({ x: 0, y: RESTING_Y, z: 0 }, true);
  player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  player.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  player.consciousness = INITIAL_CONSCIOUSNESS;
  player.originNormalized = 5 / 24;
  applyInstanceTint(player.mesh, 5 / 24);
  player.mesh.rotation.set(0, 0, 0);
  player.instanceId = nextInstanceId(player.instanceId);
  player.carry = { kind: "idle" };

  lifetime.recorder = new InputRecorder();
  lifetime.startPosition = { x: 0, z: 0 };
  lifetime.originNormalized = 5 / 24;
  lifetime.instanceId = player.instanceId;

  registry.setActiveTimeline(5);
};

const runChaseToActive5 = (
  harness: Harness,
  detector: ReturnType<typeof createPortalTriggerSet>,
  observer: ReturnType<typeof createActStateObserver>,
  startTick: number,
): { tick: number; entries: ActStateSnapshot["recentWestEntries"] } => {
  const { scene, world, player, lifetime, registry } = harness;

  let tick = startTick;
  detector.step(0, 0, tick++);
  for (let i = 0; i < 5; i++) {
    lifetime.recorder.record(inputState({ right: true }), 5 / 24);
  }
  detector.step(HALF_WIDTH - 0.4, 0, tick++);

  const chaserRecorder = new InputRecorder();
  for (let i = 0; i < 5; i++) {
    chaserRecorder.record(inputState({ left: true }), 6 / 24);
  }
  const chaserRecording = chaserRecorder.snapshot();
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
    throw new Error("REQ-023 test: missing West portal trigger");
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

  if (
    activePlayerEntryTick < 0 ||
    chaserEntryTick < 0 ||
    Math.abs(activePlayerEntryTick - chaserEntryTick) > 2
  ) {
    throw new Error(
      `REQ-023 test: chase preconditions failed (player=${activePlayerEntryTick}, chaser=${chaserEntryTick})`,
    );
  }

  return { tick, entries: observer.recentWestEntries() };
};

describe("REQ-023 Act 3 escape integration", () => {
  it("with cinematic actors completed, walking the active player into the North trigger at 12:00 transitions the observer to escaped", () => {
    const harness = buildHarness();
    const { scene, world, player, lifetime, registry } = harness;

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // -----------------------------------------------------------------
    // Phases 1+2+3+4+5+6+7+8+9: drive the mirror state. Reuses the
    // mirror-beat harness verbatim to land the world at active=12, carry
    // idle, with one unconscious 12:00-origin placement-record in
    // bucket 12 at the room center. Observer watermark sits at
    // `act-3-mirror`.
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

    beginNewLifetimeAt5(harness);
    observer.update(buildActStateSnapshot(registry, player, []));
    expect(observer.state).toBe("act-3-setup");

    detector.resetOverlapState();

    const { tick: tickAfterChase, entries } = runChaseToActive5(
      harness,
      detector,
      observer,
      tickAfterLoop2 + 100,
    );
    observer.update(buildActStateSnapshot(registry, player, entries));
    expect(observer.state).toBe("act-3-chase");
    expect(registry.activeTimeline).toBe(5);

    // Apply the team-up knockout against a 5:00-origin ghost in bucket 5.
    const ghostsAt5 = registry.ghostsFor(5);
    const targetGhost = ghostsAt5.find(
      (g) => Math.abs(g.originNormalized - 5 / 24) < 1e-6,
    );
    if (!targetGhost) {
      throw new Error(
        "REQ-023 test: expected at least one 5:00-origin ghost in bucket 5",
      );
    }
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

    observer.update(buildActStateSnapshot(registry, player, entries));
    expect(observer.state).toBe("act-3-team-up");

    // Pick up the unconscious 5:00-origin ghost.
    const carryablesAt5: Carryable[] = registry.ghostsFor(5).map((g) => ({
      id: g.instanceId,
      position: { x: g.body.translation().x, z: g.body.translation().z },
      consciousness: g.consciousness,
    }));
    const carrierAt5 = {
      id: player.instanceId,
      position: {
        x: player.body.translation().x,
        z: player.body.translation().z,
      },
    };
    player.carry = resolveCarryToggle(
      player.carry,
      true,
      carrierAt5,
      carryablesAt5,
    );
    if (
      player.carry.kind !== "carrying" ||
      player.carry.carriedId !== targetGhost.instanceId
    ) {
      throw new Error(
        "REQ-023 test: expected target ghost to be selected for carry",
      );
    }
    applyCarryPickup(targetGhost.body);

    // Walk South while carrying, then traverse the South trigger to 12:00.
    const playerPreSouth = player.body.translation();
    player.body.setTranslation(
      { x: 0, y: playerPreSouth.y, z: HALF_DEPTH - 1.0 },
      true,
    );
    player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    let mirrorTick = tickAfterChase + 1;
    detector.step(0, HALF_DEPTH - 1.0, mirrorTick++);

    for (let i = 0; i < 4; i++) {
      lifetime.recorder.record(
        inputState({ back: true, pickup: true }),
        5 / 24,
      );
      if (player.carry.kind === "carrying") {
        applyCarryAttachment(player.body, targetGhost.body);
      }
    }

    detector.step(0, HALF_DEPTH - 0.4, mirrorTick++);

    expect(registry.activeTimeline).toBe(12);
    expect(player.carry.kind).toBe("carrying");

    if (player.carry.kind === "carrying") {
      applyCarryAttachment(player.body, targetGhost.body);
    }
    world.step();

    applyCarryDrop(player.body, targetGhost.body, RESTING_Y);
    player.carry = { kind: "idle" };

    // File the placement-record ghost into bucket 12 at the room center.
    const placementRecorder = new InputRecorder();
    placementRecorder.record(inputState({}), 12 / 24);
    const placementRecording = placementRecorder.snapshot();
    const placementInstanceId = nextInstanceId(
      nextInstanceId(player.instanceId),
    );
    const placementGhost = createGhost({
      recording: placementRecording,
      originNormalized: 12 / 24,
      instanceId: placementInstanceId,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    registry.add(12, placementGhost);
    placementGhost.consciousness = applyKnockout(placementGhost.consciousness);

    observer.update(buildActStateSnapshot(registry, player, entries));
    expect(observer.state).toBe("act-3-mirror");

    // -----------------------------------------------------------------
    // Phases 10+11+12: file the 6:00-origin team-up partner into
    // bucket 12 and knock it out. Mirror of the final-knockout harness;
    // bucket 12 ends with TWO unconscious bodies (placement-record plus
    // partner) so the final-knockout predicate fires.
    // -----------------------------------------------------------------
    const partnerRecorder = new InputRecorder();
    partnerRecorder.record(inputState({}), 12 / 24);
    const partnerRecording = partnerRecorder.snapshot();
    const partnerInstanceId = nextInstanceId(placementInstanceId);
    const partnerGhost = createGhost({
      recording: partnerRecording,
      originNormalized: 6 / 24,
      instanceId: partnerInstanceId,
      scene,
      world,
      startPosition: { x: 1.5, z: 0 },
    });
    registry.add(12, partnerGhost);

    const partnerPos = partnerGhost.body.translation();
    player.body.setTranslation(
      {
        x: partnerPos.x - 0.5,
        y: player.body.translation().y,
        z: partnerPos.z,
      },
      true,
    );
    partnerGhost.consciousness = applyKnockout(partnerGhost.consciousness);
    applyKnockoutBodyResponse(partnerGhost.body, partnerGhost.mesh, {
      x: 0.5,
      z: 0,
    });

    observer.update(buildActStateSnapshot(registry, player, entries));
    expect(observer.state).toBe("act-3-final-knockout");

    // -----------------------------------------------------------------
    // Phase 13: advance every cinematic-actor ghost in the 12:00 bucket
    // past the end of its recording. The Act 1 cinematic ghosts were
    // filed into bucket 12 at boot via `mountAct1Cinematic`; the
    // South-traversal in Phase 6 above triggered `setActiveTimeline(12)`
    // which reset every ghost in bucket 12 to tick 0 and made them
    // visible. Driving `advanceTick` for each ghost's full recording
    // length brings their `tickIndex >= recordingLength`, which
    // `litStateForTimeline`'s `DEFAULT_BLOCKED_BY_ARRIVALS` reads as
    // "no cinematic actor in flight" (the predicate is
    // `ghosts.some(g => g.tickIndex < g.recording.length)`), unblocking
    // the North door at 12:00 (REQ-011 deepening: the arrivals body now
    // has a non-trivial cell instead of always returning false).
    //
    // The placement-record and partner ghosts also live in bucket 12,
    // but their recordings are 1 frame each and they were created after
    // the active timeline switched, so their `tickIndex` was already at
    // 0 with `recording.length === 1`. One `advanceTick` brings their
    // tickIndex to 1 (= recordingLength), satisfying the completion
    // predicate.
    // -----------------------------------------------------------------
    const bucket12 = registry.ghostsFor(12);
    for (const g of bucket12) {
      const target = g.recording.length;
      while (g.tickIndex < target) {
        g.advanceTick();
      }
    }

    // The arrivals rule for North-at-12 now reads false (no in-flight
    // ghost). The seed `north: true` lights through.
    const litState = litStateForTimeline(12, {
      ghosts: registry.ghostsFor(12),
    });
    expect(litState).not.toBeNull();
    expect(litState!.north).toBe(true);

    // -----------------------------------------------------------------
    // Phase 14: walk the active player into the North trigger volume at
    // 12:00. The North door is on the negative-Z wall; the trigger
    // volume sits just inside that face. With the arrivals rule lit
    // and the watermark at `act-3-final-knockout`, the active player's
    // crossing into the trigger is the level-complete signal.
    //
    // The traversal handler's lit-portal branch will fire (since the
    // gate now reads lit), but the North portal's `destinationHours`
    // is 12 (a self-loop authored by `ACT_ONE_PORTAL_SPECS.north`),
    // so the active player teleports back to the room center at
    // 12:00. That is acceptable: the level-complete signal is the
    // cross of the trigger, not the post-traversal pose. The
    // observer reads `activePlayerCrossedNorthAt12` from the snapshot
    // (set by the host on the trigger overlap) rather than the
    // player's post-traversal position.
    // -----------------------------------------------------------------
    const northTrigger = detector.triggers.find(
      (t) => t.portal.door.direction === "north",
    );
    if (!northTrigger) {
      throw new Error("REQ-023 test: missing North portal trigger");
    }

    // Place the player just outside the North trigger's South face
    // (the inside-room face) so the next `detector.step` call crosses
    // a false-to-true edge for the trigger.
    const insideFaceZ = northTrigger.centerZ + northTrigger.halfZ;
    player.body.setTranslation(
      { x: 0, y: player.body.translation().y, z: insideFaceZ + 0.1 },
      true,
    );
    player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    let escapeTick = mirrorTick + 1;
    detector.step(
      player.body.translation().x,
      player.body.translation().z,
      escapeTick++,
    );

    // Now step the player into the trigger volume. Use the trigger's
    // center Z as the destination; that is comfortably inside the
    // volume on both axes.
    detector.step(0, northTrigger.centerZ, escapeTick++);
    expect(
      pointInsideTrigger(northTrigger, 0, northTrigger.centerZ),
    ).toBe(true);

    // -----------------------------------------------------------------
    // Phase 15: build the final snapshot with `activePlayerCrossedNorthAt12`
    // set true (the host populates this from the trigger-overlap
    // callback) and assert the escape predicate plus the observer
    // transition.
    // -----------------------------------------------------------------
    const escapeSnapshot = buildActStateSnapshot(registry, player, entries, {
      activePlayerCrossedNorthAt12: true,
    });
    // The active timeline may have been re-switched to 12 by the
    // North traversal (since the gate is now lit), but since
    // destinationHours === 12 the registry stays at 12. Confirm the
    // snapshot reads timeline 12.
    expect(escapeSnapshot.currentTimeline).toBe(12);
    expect(isEscaped(escapeSnapshot)).toBe(true);
    expect(observer.update(escapeSnapshot)).toBe("escaped");
    expect(observer.state).toBe("escaped");
  });

  it("isEscaped fails when any cinematic actor is still mid-recording in bucket 12", () => {
    // Boundary regression: the predicate's three conjunctions
    // (currentTimeline === 12, activePlayerCrossedNorthAt12,
    // allCinematicActorsCompleted) are each load-bearing. Build a
    // fully-satisfying base snapshot; flip an actor mid-recording and
    // assert the predicate returns false.
    const harness = buildHarness();
    const { scene, world, registry, player } = harness;

    // Synthesize the escape-shaped state in bucket 12 directly: switch
    // active timeline to 12 (which resets every ghost in the bucket to
    // tick 0 conscious), then drive the cinematic actors to completion.
    registry.setActiveTimeline(12);
    const bucket12Initial = registry.ghostsFor(12);
    for (const g of bucket12Initial) {
      const target = g.recording.length;
      while (g.tickIndex < target) {
        g.advanceTick();
      }
    }
    // Add two unconscious bodies to satisfy the watermark prerequisite
    // shape (the predicate itself reads only the cinematic-completed
    // condition; the watermark prerequisite is enforced outside the
    // predicate by the observer).
    const recorder = new InputRecorder();
    recorder.record(inputState({}), 12 / 24);
    const recording = recorder.snapshot();
    const body1 = createGhost({
      recording,
      originNormalized: 12 / 24,
      instanceId: 99,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    const body2 = createGhost({
      recording,
      originNormalized: 6 / 24,
      instanceId: 100,
      scene,
      world,
      startPosition: { x: 1.5, z: 0 },
    });
    registry.add(12, body1);
    registry.add(12, body2);
    body1.advanceTick();
    body2.advanceTick();
    body1.consciousness = applyKnockout(body1.consciousness);
    body2.consciousness = applyKnockout(body2.consciousness);

    player.body.setTranslation({ x: 0, y: RESTING_Y, z: 0 }, true);

    const baseSnapshot = buildActStateSnapshot(registry, player, [], {
      activePlayerCrossedNorthAt12: true,
    });
    expect(isEscaped(baseSnapshot)).toBe(true);

    // Drop conjunction 1: currentTimeline !== 12.
    const wrongTimeline: ActStateSnapshot = {
      ...baseSnapshot,
      currentTimeline: 5,
      registry: {
        activeTimeline: 5,
        ghostsFor: baseSnapshot.registry.ghostsFor,
      },
    };
    expect(isEscaped(wrongTimeline)).toBe(false);

    // Drop conjunction 2: !activePlayerCrossedNorthAt12.
    const noCrossing: ActStateSnapshot = {
      ...baseSnapshot,
      activePlayerCrossedNorthAt12: false,
    };
    expect(isEscaped(noCrossing)).toBe(false);

    // Drop conjunction 3: at least one cinematic actor still
    // mid-recording. Remap the bucket-12 projection so the first ghost
    // has tickIndex < recordingLength.
    const oneInFlight: ActStateSnapshot = {
      ...baseSnapshot,
      registry: {
        activeTimeline: 12,
        ghostsFor: (timeline) =>
          timeline === 12
            ? baseSnapshot.registry.ghostsFor(12).map((g, i) =>
                i === 0
                  ? { ...g, tickIndex: 0, recordingLength: 240 }
                  : g,
              )
            : baseSnapshot.registry.ghostsFor(timeline),
      },
    };
    expect(isEscaped(oneInFlight)).toBe(false);
  });
});

describe("REQ-024 dependency monotonicity confirmation", () => {
  it("a fresh observer fed an escape-shaped snapshot from not-started stays at not-started", () => {
    // The forward walk in `evaluateActState` halts at the first failing
    // prerequisite. An escape-shaped snapshot (timeline 12, north
    // crossing, cinematic completed, two unconscious bodies) does NOT
    // satisfy `isAct1Spawn` (timeline 12 not 5; cinematic-actor count
    // varies but the active timeline check fails first). So the
    // observer cannot skip to `escaped` even though the snapshot
    // locally satisfies `isEscaped`.
    const observer = createActStateObserver();
    const escapeShapedSnapshot: ActStateSnapshot = {
      registry: {
        activeTimeline: 12,
        ghostsFor: (timeline) => {
          if (timeline !== 12) return [];
          return [
            {
              id: 10,
              position: { x: 0, z: 0 },
              consciousness: "conscious",
              originNormalized: 12 / 24,
              tickIndex: 240,
              recordingLength: 240,
            },
            {
              id: 7,
              position: { x: 0.5, z: 0 },
              consciousness: "unconscious",
              originNormalized: 12 / 24,
              tickIndex: 50,
              recordingLength: 50,
            },
            {
              id: 8,
              position: { x: 1.5, z: 0 },
              consciousness: "unconscious",
              originNormalized: 6 / 24,
              tickIndex: 1,
              recordingLength: 1,
            },
          ];
        },
      },
      instances: [],
      currentTimeline: 12,
      activePlayer: {
        instanceId: 1,
        position: { x: 0, z: 0 },
        consciousness: "conscious",
        carry: { kind: "idle" },
      },
      recentWestEntries: [],
      activePlayerCrossedNorthAt12: true,
    };
    expect(isEscaped(escapeShapedSnapshot)).toBe(true);
    expect(observer.update(escapeShapedSnapshot)).toBe("not-started");
    expect(observer.state).toBe("not-started");
  });

  it("an out-of-order Act 3 chase satisfaction without Act 2 prerequisites does not skip the watermark forward", () => {
    // The chase predicate requires two distinct West entries within
    // CHASE_WINDOW_TICKS plus active timeline 5. Build a snapshot that
    // satisfies isAct3Chase locally but skips Act 2 entirely (no
    // ghosts in buckets 5 or 6). The forward walk halts at
    // `act-1-spawn` because there are no ghosts in bucket 12.
    const observer = createActStateObserver();
    const chaseShaped: ActStateSnapshot = {
      registry: {
        activeTimeline: 5,
        ghostsFor: () => [],
      },
      instances: [],
      currentTimeline: 5,
      activePlayer: {
        instanceId: 1,
        position: { x: 0, z: 0 },
        consciousness: "conscious",
        carry: { kind: "idle" },
      },
      recentWestEntries: [
        { instanceId: 1, tick: 100 },
        { instanceId: 2, tick: 101 },
      ],
      activePlayerCrossedNorthAt12: false,
    };
    expect(observer.update(chaseShaped)).toBe("not-started");
    expect(observer.state).toBe("not-started");
  });

  it("the watermark advances exactly one beat per tick on a forward-walking sequence and never regresses", () => {
    // Drive the observer through the full Act 1 to escaped sequence
    // and pin the per-step transitions. Each snapshot satisfies the
    // named beat AND every preceding beat that the forward walk needs
    // to confirm; the observer's monotonic walk advances exactly to
    // the named beat each tick. After landing at `escaped`, feeding
    // any earlier-shaped snapshot does NOT regress the watermark.
    const observer = createActStateObserver();

    // Helper: build a snapshot with explicit bucket projections.
    const buildSnap = (overrides: {
      currentTimeline: number;
      buckets: Record<number, BucketGhostSnapshot[]>;
      activeConsciousness?: "conscious" | "unconscious";
      activeCarry?: ActStateSnapshot["activePlayer"]["carry"];
      recentWestEntries?: ActStateSnapshot["recentWestEntries"];
      crossedNorth?: boolean;
    }): ActStateSnapshot => ({
      registry: {
        activeTimeline: overrides.currentTimeline,
        ghostsFor: (timeline) => overrides.buckets[timeline] ?? [],
      },
      instances: [],
      currentTimeline: overrides.currentTimeline,
      activePlayer: {
        instanceId: 1,
        position: { x: 0, z: 0 },
        consciousness: overrides.activeConsciousness ?? "conscious",
        carry: overrides.activeCarry ?? { kind: "idle" },
      },
      recentWestEntries: overrides.recentWestEntries ?? [],
      activePlayerCrossedNorthAt12: overrides.crossedNorth ?? false,
    });

    const cinematicGhost = (id: number): BucketGhostSnapshot => ({
      id,
      position: { x: 0, z: 0 },
      consciousness: "conscious",
      originNormalized: 12 / 24,
      tickIndex: 240,
      recordingLength: 240,
    });

    // act-1-spawn
    expect(
      observer.update(
        buildSnap({
          currentTimeline: 5,
          buckets: {
            12: [cinematicGhost(10), cinematicGhost(11), cinematicGhost(12)],
          },
        }),
      ),
    ).toBe("act-1-spawn");

    // act-2-loop-1
    expect(
      observer.update(
        buildSnap({
          currentTimeline: 5,
          buckets: {
            12: [cinematicGhost(10), cinematicGhost(11), cinematicGhost(12)],
            5: [
              {
                id: 1,
                position: { x: 0, z: 0 },
                consciousness: "conscious",
                originNormalized: 5 / 24,
                tickIndex: 100,
                recordingLength: 100,
              },
            ],
            6: [
              {
                id: 2,
                position: { x: 0, z: 0 },
                consciousness: "conscious",
                originNormalized: 6 / 24,
                tickIndex: 0,
                recordingLength: 100,
              },
            ],
          },
        }),
      ),
    ).toBe("act-2-loop-1");

    // act-2-loop-2
    expect(
      observer.update(
        buildSnap({
          currentTimeline: 6,
          activeConsciousness: "unconscious",
          buckets: {
            12: [cinematicGhost(10), cinematicGhost(11), cinematicGhost(12)],
            5: [
              {
                id: 1,
                position: { x: 0, z: 0 },
                consciousness: "unconscious",
                originNormalized: 5 / 24,
                tickIndex: 100,
                recordingLength: 100,
              },
            ],
            6: [
              {
                id: 2,
                position: { x: 0, z: 0 },
                consciousness: "conscious",
                originNormalized: 6 / 24,
                tickIndex: 0,
                recordingLength: 100,
              },
            ],
          },
        }),
      ),
    ).toBe("act-2-loop-2");

    // act-3-setup
    expect(
      observer.update(
        buildSnap({
          currentTimeline: 5,
          buckets: {
            12: [cinematicGhost(10), cinematicGhost(11), cinematicGhost(12)],
            6: [
              {
                id: 2,
                position: { x: 0, z: 0 },
                consciousness: "unconscious",
                originNormalized: 6 / 24,
                tickIndex: 0,
                recordingLength: 100,
              },
            ],
          },
        }),
      ),
    ).toBe("act-3-setup");

    // act-3-chase
    expect(
      observer.update(
        buildSnap({
          currentTimeline: 5,
          buckets: {
            12: [cinematicGhost(10), cinematicGhost(11), cinematicGhost(12)],
            6: [
              {
                id: 2,
                position: { x: 0, z: 0 },
                consciousness: "unconscious",
                originNormalized: 6 / 24,
                tickIndex: 0,
                recordingLength: 100,
              },
            ],
          },
          recentWestEntries: [
            { instanceId: 1, tick: 100 },
            { instanceId: 2, tick: 101 },
          ],
        }),
      ),
    ).toBe("act-3-chase");

    // act-3-team-up
    expect(
      observer.update(
        buildSnap({
          currentTimeline: 5,
          buckets: {
            12: [cinematicGhost(10), cinematicGhost(11), cinematicGhost(12)],
            5: [
              {
                id: 7,
                position: { x: 0, z: 0 },
                consciousness: "unconscious",
                originNormalized: 5 / 24,
                tickIndex: 100,
                recordingLength: 100,
              },
            ],
            6: [
              {
                id: 2,
                position: { x: 0, z: 0 },
                consciousness: "unconscious",
                originNormalized: 6 / 24,
                tickIndex: 0,
                recordingLength: 100,
              },
            ],
          },
          recentWestEntries: [
            { instanceId: 1, tick: 100 },
            { instanceId: 2, tick: 101 },
          ],
        }),
      ),
    ).toBe("act-3-team-up");

    // act-3-mirror
    expect(
      observer.update(
        buildSnap({
          currentTimeline: 12,
          activeCarry: { kind: "idle" },
          buckets: {
            12: [
              cinematicGhost(10),
              cinematicGhost(11),
              {
                id: 7,
                position: { x: 0.5, z: 0 },
                consciousness: "unconscious",
                originNormalized: 5 / 24,
                tickIndex: 1,
                recordingLength: 1,
              },
            ],
          },
        }),
      ),
    ).toBe("act-3-mirror");

    // act-3-final-knockout
    expect(
      observer.update(
        buildSnap({
          currentTimeline: 12,
          activeCarry: { kind: "idle" },
          buckets: {
            12: [
              cinematicGhost(10),
              {
                id: 7,
                position: { x: 0.5, z: 0 },
                consciousness: "unconscious",
                originNormalized: 5 / 24,
                tickIndex: 1,
                recordingLength: 1,
              },
              {
                id: 8,
                position: { x: 1.5, z: 0 },
                consciousness: "unconscious",
                originNormalized: 6 / 24,
                tickIndex: 1,
                recordingLength: 1,
              },
            ],
          },
        }),
      ),
    ).toBe("act-3-final-knockout");

    // escaped
    expect(
      observer.update(
        buildSnap({
          currentTimeline: 12,
          activeCarry: { kind: "idle" },
          crossedNorth: true,
          buckets: {
            12: [
              cinematicGhost(10),
              {
                id: 7,
                position: { x: 0.5, z: 0 },
                consciousness: "unconscious",
                originNormalized: 5 / 24,
                tickIndex: 1,
                recordingLength: 1,
              },
              {
                id: 8,
                position: { x: 1.5, z: 0 },
                consciousness: "unconscious",
                originNormalized: 6 / 24,
                tickIndex: 1,
                recordingLength: 1,
              },
            ],
          },
        }),
      ),
    ).toBe("escaped");

    // Regression: feeding an act-1-spawn-shaped snapshot AFTER escape
    // does NOT pull the watermark backward. The terminal state holds.
    expect(
      observer.update(
        buildSnap({
          currentTimeline: 5,
          buckets: {
            12: [cinematicGhost(10), cinematicGhost(11), cinematicGhost(12)],
          },
        }),
      ),
    ).toBe("escaped");
  });
});
