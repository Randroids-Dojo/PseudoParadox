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
  isAct3FinalKnockout,
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
  applyCarryDrop,
  applyCarryPickup,
} from "../../src/sim/applyCarry.ts";
import { resolveCarryToggle, type Carryable } from "../../src/sim/carryState.ts";
import { nextInstanceId } from "../../src/sim/instanceId.ts";

/**
 * REQ-022 Act 3 final knockout integration test
 * (`docs/gdd/03-story-acts-1-3.md` Act 3: Escape;
 * `docs/gdd/40-act-progress-and-narrative-beats.md` section 4 REQ-022).
 *
 * The GDD's narrative for the Act 3 final knockout beat:
 *
 *   "Knock out the instance brought from 6:00."
 *
 * The dossier's pseudocode:
 *
 *   beatAct3FinalKnockout(snapshot):
 *     return snapshot.currentTimeline === 12
 *         && snapshot.registry.ghostsFor(12).filter(g =>
 *              g.consciousness === 'unconscious').length >= 2;
 *
 * The predicate reads: at 12:00 active timeline, at least two unconscious
 * ghosts are present in bucket 12. The two bodies represent the mirror
 * placement (the 5:00 instance dragged South) and the 6:00 instance the
 * player teamed up with (now knocked out post-traversal). The watermark
 * prerequisite (`act-3-mirror` already reached) is enforced OUTSIDE the
 * predicate by the observer's monotonic walk.
 *
 * The load-bearing state for this slice:
 *
 *   - Phases 1 through 9 reuse the mirror-beat harness verbatim to land
 *     the world at active=12, carry idle, with one unconscious 12:00-origin
 *     placement-record in bucket 12 at the room center. Observer watermark
 *     sits at `act-3-mirror`.
 *   - The 6:00-origin team-up partner is filed into bucket 12 as a fresh,
 *     conscious `GhostInstance` with `originNormalized = 6/24`, mirroring
 *     the GDD beat "you and the instance from 6:00 team up": the partner
 *     accompanied the player South, so it is present at 12:00 by the time
 *     the mirror beat completes. F-007 partial behavior is the canonical
 *     owner of the runtime mechanism that rehomes a co-traversing ghost
 *     into the destination bucket on a real South-portal traversal; this
 *     test models the OUTCOME the predicate cares about (bucket 12 carries
 *     a conscious 6:00-origin ghost ready to be knocked out), not the
 *     mechanism.
 *   - The active player walks toward the 6:00-origin partner and the
 *     punch resolver fires: `applyKnockout` flips the partner's
 *     consciousness to `'unconscious'`, `applyKnockoutBodyResponse` writes
 *     the impulse plus the mesh tilt. Bucket 12 now carries TWO unconscious
 *     ghosts: the placement-record (origin 12) and the partner (origin 6).
 *
 * The final-knockout predicate
 * (`currentTimeline === 12 && ghostsFor(12).filter(unconscious).length >= 2`)
 * fires here. The observer's monotonic walk advances the watermark from
 * `act-3-mirror` to `act-3-final-knockout`.
 *
 * NOT in scope:
 *   - Wiring the F-007 cross-timeline body rehoming hook to fire
 *     automatically on the South portal traversal for a co-traversing
 *     ghost. F-007 is the canonical owner; this test models the outcome.
 *   - REQ-023 (Act 3 escape): a separate slice extends this same harness
 *     to land the escaped watermark via the North door at 12:00.
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
 * Mirrors the helper in `act3Mirror.test.ts`. Per slice-discipline, the
 * planned extraction into `tests/sim/_helpers/act2Loops.ts` is its own
 * slice; this slice keeps the fifth use inline the same way the prior
 * four did.
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
 * of the helper in `act3Mirror.test.ts`.
 */
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
      "REQ-022 test harness: expected ghost-A to be selected for carry",
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

/**
 * Begin a fresh active lifetime at 5:00 after the prior lifetime ended
 * unconscious at 6:00. Mirror of the helper in `act3Mirror.test.ts`.
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

  lifetime.milestones = new MilestoneRecorder();
  lifetime.startPosition = { x: 0, z: 0 };
  lifetime.originNormalized = 5 / 24;
  lifetime.instanceId = player.instanceId;

  registry.setActiveTimeline(5);
};

/**
 * Drive the Act 3 chase sequence on top of an act-3-setup state. Mirror
 * of the helper in `act3Mirror.test.ts`.
 */
const runChaseToActive5 = (
  harness: Harness,
  detector: ReturnType<typeof createPortalTriggerSet>,
  observer: ReturnType<typeof createActStateObserver>,
  startTick: number,
): { tick: number; entries: ActStateSnapshot["recentWestEntries"] } => {
  const { scene, world, player, lifetime, registry } = harness;

  let tick = startTick;
  detector.step(0, 0, tick++);
  for (let i = 0; i < 40; i++) {
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
    throw new Error("REQ-022 test: missing West portal trigger");
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
      `REQ-022 test: chase preconditions failed (player=${activePlayerEntryTick}, chaser=${chaserEntryTick})`,
    );
  }

  return { tick, entries: observer.recentWestEntries() };
};

describe("REQ-022 Act 3 final knockout integration", () => {
  it("knocking out the 6:00-origin team-up partner inside the 12:00 timeline transitions the observer to act-3-final-knockout", () => {
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
        "REQ-022 test: expected at least one 5:00-origin ghost in bucket 5",
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
        "REQ-022 test: expected target ghost to be selected for carry",
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
    // Phase 10: file the 6:00-origin team-up partner into bucket 12.
    // The GDD beat reads "you and the instance from 6:00 team up" then
    // "drag him South to 12:00", so by the time the mirror beat
    // completes, the partner is present at 12:00 alongside the player.
    // F-007 partial behavior is the canonical owner of the runtime
    // mechanism that rehomes a co-traversing ghost into the destination
    // bucket on a real South-portal traversal of a teamed-up pair; this
    // test models the OUTCOME the predicate cares about, not the
    // mechanism.
    //
    // The partner is filed AFTER the active-timeline switched to 12 by
    // the South traversal, so `add` leaves it visible (the non-active
    // hide path does not fire). Consciousness stays at the seed
    // `'conscious'` because the partner has not been knocked out yet.
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
    expect(partnerGhost.consciousness).toBe("conscious");

    // The mirror predicate should still be the highest passing beat at
    // this point: bucket 12 has one unconscious body (the placement
    // record) plus one conscious partner. The final-knockout predicate
    // reads `>= 2` unconscious in bucket 12, which is not yet satisfied.
    observer.update(buildActStateSnapshot(registry, player, entries));
    expect(observer.state).toBe("act-3-mirror");

    // -----------------------------------------------------------------
    // Phase 11: walk toward the partner and apply the punch resolver's
    // side effects directly: `applyKnockout` flips consciousness to
    // `'unconscious'`, `applyKnockoutBodyResponse` writes the impulse
    // plus the mesh tilt. The test models the OUTCOME of the punch (the
    // predicate reads consciousness on the snapshot, not the impulse)
    // rather than driving a full per-tick punch-detection loop; the
    // punch resolver's pure logic is pinned by `tests/sim/punch.test.ts`.
    // -----------------------------------------------------------------
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

    expect(partnerGhost.consciousness).toBe("unconscious");

    // -----------------------------------------------------------------
    // Phase 12: build the snapshot and assert the final-knockout
    // predicate. Bucket 12 now carries TWO unconscious ghosts (the
    // placement-record at the room origin plus the partner at x=1.5),
    // so `isAct3FinalKnockout` returns true and the observer's monotonic
    // walk advances the watermark from `act-3-mirror` to
    // `act-3-final-knockout`.
    // -----------------------------------------------------------------
    const snapshot = buildActStateSnapshot(registry, player, entries);
    expect(isAct3FinalKnockout(snapshot)).toBe(true);
    expect(observer.update(snapshot)).toBe("act-3-final-knockout");
    expect(observer.state).toBe("act-3-final-knockout");
  });

  it("isAct3FinalKnockout fails when fewer than two unconscious ghosts are in bucket 12 or the active timeline is not 12", () => {
    // Boundary regression: the predicate's two conjunctions
    // (currentTimeline === 12; ghostsFor(12).filter(unconscious).length
    // >= 2) are each load-bearing. Build a fully-satisfying snapshot,
    // then drop each conjunction in turn and assert the predicate
    // returns false.
    const harness = buildHarness();
    const { scene, world, registry, player } = harness;

    // Synthesize bucket 12: two unconscious ghosts. The recording
    // substrate is irrelevant to the predicate (it reads only
    // consciousness).
    const recorder = new InputRecorder();
    recorder.record(inputState({}), 12 / 24);
    const recording = recorder.snapshot();

    const ghost1 = createGhost({
      recording,
      originNormalized: 12 / 24,
      instanceId: 99,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    const ghost2 = createGhost({
      recording,
      originNormalized: 6 / 24,
      instanceId: 100,
      scene,
      world,
      startPosition: { x: 1.5, z: 0 },
    });
    registry.add(12, ghost1);
    registry.add(12, ghost2);
    registry.setActiveTimeline(12);
    // Flip to unconscious AFTER the active-timeline switch: the
    // entering-bucket reset path in `setActiveTimeline` calls
    // `ghost.reset()`, which restores consciousness to the seed
    // (`'conscious'`).
    ghost1.consciousness = applyKnockout(ghost1.consciousness);
    ghost2.consciousness = applyKnockout(ghost2.consciousness);

    player.body.setTranslation({ x: 0, y: RESTING_Y, z: 0 }, true);

    const baseSnapshot = buildActStateSnapshot(registry, player, []);
    expect(isAct3FinalKnockout(baseSnapshot)).toBe(true);

    // Drop conjunction 1: currentTimeline !== 12.
    const wrongTimeline: ActStateSnapshot = {
      ...baseSnapshot,
      currentTimeline: 5,
      registry: {
        activeTimeline: 5,
        ghostsFor: baseSnapshot.registry.ghostsFor,
      },
    };
    expect(isAct3FinalKnockout(wrongTimeline)).toBe(false);

    // Drop conjunction 2 (variant a): only one unconscious ghost in
    // bucket 12 (the second is conscious). Key off the stable instanceId
    // so the variant remains correct if bucket ordering changes (the
    // registry's `add` does not pin a deterministic index, and Act 1
    // cinematic ghosts from `mountAct1Cinematic` already share bucket
    // 12 with the synthesized fixtures).
    const oneUnconscious: ActStateSnapshot = {
      ...baseSnapshot,
      registry: {
        activeTimeline: 12,
        ghostsFor: (timeline) =>
          timeline === 12
            ? baseSnapshot.registry.ghostsFor(12).map((g) =>
                g.id === ghost2.instanceId
                  ? { ...g, consciousness: "conscious" as const }
                  : g,
              )
            : baseSnapshot.registry.ghostsFor(timeline),
      },
    };
    expect(isAct3FinalKnockout(oneUnconscious)).toBe(false);

    // Drop conjunction 2 (variant b): zero unconscious ghosts in
    // bucket 12 (both flipped conscious).
    const noneUnconscious: ActStateSnapshot = {
      ...baseSnapshot,
      registry: {
        activeTimeline: 12,
        ghostsFor: (timeline) =>
          timeline === 12
            ? baseSnapshot.registry
                .ghostsFor(12)
                .map((g) => ({ ...g, consciousness: "conscious" as const }))
            : baseSnapshot.registry.ghostsFor(timeline),
      },
    };
    expect(isAct3FinalKnockout(noneUnconscious)).toBe(false);
  });
});
