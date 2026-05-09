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
import { PLAYER_CAPSULE } from "../../src/scene/player.ts";
import { applyInstanceTint } from "../../src/render/instanceTint.ts";
import {
  createTimelineRegistry,
  type TimelineRegistry,
} from "../../src/sim/timelineRegistry.ts";
import { mountAct1Cinematic } from "../../src/sim/scripts/act1Cinematic.ts";
import {
  createActStateObserver,
  isAct3Mirror,
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
 * REQ-021 Act 3 mirror beat integration test
 * (`docs/gdd/03-story-acts-1-3.md` Act 3: Escape;
 * `docs/gdd/40-act-progress-and-narrative-beats.md` section 4 REQ-021).
 *
 * The GDD's narrative for the Act 3 mirror beat:
 *
 *   "Drag that instance South to 12:00. Place the body in the center of
 *    the room (mirroring Act 1)."
 *
 * The dossier's pseudocode:
 *
 *   beatAct3Mirror(snapshot):
 *     return snapshot.currentTimeline === 12
 *         && snapshot.activePlayer.carry.kind === 'idle'
 *         && snapshot.registry.ghostsFor(12).some(g =>
 *              g.consciousness === 'unconscious'
 *              && planarDistance(g.position, { x: 0, z: 0 })
 *                   <= DROP_CENTER_RADIUS_M);
 *
 * The predicate reads: at 12:00 active timeline, the active player is
 * idle (just dropped), and at least one unconscious ghost in bucket 12
 * sits within `DROP_CENTER_RADIUS_M = 1.0` of the room origin. The
 * watermark prerequisite (`act-3-team-up` already reached) is enforced
 * OUTSIDE the predicate by the observer's monotonic walk; this predicate
 * stays pure with respect to the snapshot only.
 *
 * The load-bearing state for this slice is:
 *
 *   - The team-up has already played out: the chase reached active=5
 *     with two distinct West-portal entries in the buffer, and a
 *     5:00-origin ghost in bucket 5 was knocked out. The observer's
 *     watermark sits at `act-3-team-up`. We reuse the team-up harness
 *     verbatim to land here.
 *   - The active player picks up the unconscious 5:00-origin ghost,
 *     walks South at 5:00, and crosses the South portal trigger (South
 *     lit at 5:00 per `DOOR_STATE_BY_HOUR`, routes to 12:00 per
 *     `ACT_ONE_PORTAL_SPECS.south.destinationHours`). The `wireTraversal`
 *     handler teleports the player to the room center at 12:00 and
 *     switches the active timeline to 12.
 *   - The carry survives the traversal per `dragRegression.test.ts`'s
 *     pinned contract: `wireTraversal` does not branch on the carry
 *     state (`ActivePlayerHandle.carry` docstring) and the per-tick
 *     attachment re-anchors the carried body to the destination spawn
 *     pose immediately on the next tick. The unconscious 5:00-instance
 *     body is now at (0, ~CARRY_OFFSET.y, 0) at 12:00.
 *   - The active player drops the body. `applyCarryDrop` flips the body
 *     back to `Dynamic`, snaps its translation onto the floor at the
 *     carrier's planar position (room center), and zeroes linvel.
 *     `player.carry` returns to `'idle'`.
 *   - A placement-record ghost is filed into bucket 12 as a fresh,
 *     single-frame `GhostInstance` parked at the room center with
 *     `consciousness === 'unconscious'` and `originNormalized = 12/24`,
 *     mirroring the `ACT1_KNOCKOUT_BODY_RECORDING` shape from
 *     `mountAct1Cinematic`. The original bucket-5 ghost is left
 *     untouched so the 5:00 timeline still records what happened there
 *     (the team-up's knockout); the placement-record represents the
 *     body's NEW presence in the 12:00 timeline as a distinct event,
 *     not a duplicate of the source-timeline record. F-007 partial
 *     behavior is the canonical owner of the runtime mechanism that
 *     produces this placement-record on a real South-portal traversal
 *     of a carried body and lands in its own follow-up slice.
 *
 * The mirror predicate
 * (`currentTimeline === 12 && carry.kind === 'idle' && ghosts12.some(
 * unconscious && distance <= 1.0)`) fires here. The observer's monotonic
 * walk advances the watermark from `act-3-team-up` to `act-3-mirror`.
 *
 * NOT in scope:
 *   - Wiring the F-007 cross-timeline body rehoming hook to fire
 *     automatically on the South portal traversal. F-007 is the
 *     canonical owner of the runtime mechanism that files a
 *     placement-record into bucket 12 on a real South-portal
 *     traversal of a carried body, and lands in its own slice. The
 *     integration test models the OUTCOME the predicate cares about
 *     (bucket 12 carries an unconscious ghost within 1.0 m of the
 *     room origin), not the mechanism.
 *   - REQ-022 (Act 3 second knockout): a separate slice extends this
 *     same harness pattern to land the final-knockout watermark.
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
 * Mirror of the helper in `act3TeamUp.test.ts`. Per slice-discipline,
 * the planned extraction into `tests/sim/_helpers/act2Loops.ts` is its
 * own slice (refactor-in-slice); this slice keeps the fourth use inline
 * the same way the prior three did.
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

/**
 * Drive the Act 2 second loop sequence on top of a loop-1 setup. Mirror
 * of the helper in `act3TeamUp.test.ts`.
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
      "REQ-021 test harness: expected ghost-A to be selected for carry",
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
 * unconscious at 6:00. Mirror of the helper in `act3TeamUp.test.ts`.
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
  lifetime.startPosition = { x: 0, z: 0 };
  lifetime.originNormalized = 5 / 24;
  lifetime.instanceId = player.instanceId;

  registry.setActiveTimeline(5);
};

/**
 * Drive the Act 3 chase sequence on top of an act-3-setup state. Mirror
 * of the helper in `act3TeamUp.test.ts`.
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
    throw new Error("REQ-021 test: missing West portal trigger");
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
      `REQ-021 test: chase preconditions failed (player=${activePlayerEntryTick}, chaser=${chaserEntryTick})`,
    );
  }

  return { tick, entries: observer.recentWestEntries() };
};

describe("REQ-021 Act 3 mirror integration", () => {
  it("dragging the team-up's knocked-out 5:00 instance South to 12:00 and dropping at the room center transitions the observer to act-3-mirror", () => {
    const harness = buildHarness();
    const { scene, world, player, lifetime, registry } = harness;

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // -----------------------------------------------------------------
    // Phases 1+2+3+4: drive the team-up state. Loops 1+2 land at
    // active=6 unconscious; the implicit Act 2 to Act 3 boundary opens
    // a fresh lifetime at 5:00; the chase traverses the player back to
    // 5:00; a 5:00-origin ghost in bucket 5 is knocked out by the
    // team. Observer watermark sits at `act-3-team-up`.
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
        "REQ-021 test: expected at least one 5:00-origin ghost in bucket 5",
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

    // -----------------------------------------------------------------
    // Phase 5: pick up the unconscious 5:00-origin ghost. The carry
    // resolver fires on a one-tick rising edge of pickup; the resulting
    // state is `{ kind: 'carrying', carriedId: targetGhost.instanceId }`
    // and `applyCarryPickup` flips the body to KinematicPositionBased.
    // -----------------------------------------------------------------
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
        "REQ-021 test: expected target ghost to be selected for carry",
      );
    }
    applyCarryPickup(targetGhost.body);

    // -----------------------------------------------------------------
    // Phase 6: walk South while carrying, then traverse the South
    // trigger. South is lit at 5:00 per `DOOR_STATE_BY_HOUR`, routes to
    // 12:00 per `ACT_ONE_PORTAL_SPECS.south.destinationHours`. The
    // lit-portal traversal handler teleports the player to the room
    // center at 12:00 and switches active timeline to 12. The carry
    // state is preserved (per `dragRegression.test.ts`'s pinned
    // contract); the carried body's kinematic translation is rewritten
    // by the next attachment tick to track the carrier.
    // -----------------------------------------------------------------
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

    // Cross the South trigger volume. Centered at (0, HALF_DEPTH - 0.3),
    // halfZ = 0.3, so z = HALF_DEPTH - 0.4 sits comfortably inside.
    detector.step(0, HALF_DEPTH - 0.4, mirrorTick++);

    expect(registry.activeTimeline).toBe(12);
    expect(player.carry.kind).toBe("carrying");

    // -----------------------------------------------------------------
    // Phase 7: drive one carry-attachment tick post-traversal so the
    // carried body re-anchors to the destination spawn pose (the
    // production path the dragRegression "post-traversal re-anchor"
    // case pins). Then drop the body via `applyCarryDrop`: the body
    // flips back to Dynamic, snaps to (0, RESTING_Y, 0), and the carry
    // state returns to `'idle'`.
    // -----------------------------------------------------------------
    if (player.carry.kind === "carrying") {
      applyCarryAttachment(player.body, targetGhost.body);
    }
    world.step();

    applyCarryDrop(player.body, targetGhost.body, RESTING_Y);
    player.carry = { kind: "idle" };

    const droppedPos = targetGhost.body.translation();
    expect(droppedPos.x).toBeCloseTo(0, 1);
    expect(droppedPos.z).toBeCloseTo(0, 1);

    // -----------------------------------------------------------------
    // Phase 8: file a placement-record ghost into bucket 12. The
    // dossier's narrative for this beat is "place the body in the
    // center of the room (mirroring Act 1)"; the predicate reads
    // `ghostsFor(12).some(unconscious && distance <= 1.0)`, so the
    // load-bearing state is bucket 12 carrying a record of an
    // unconscious body at the room center. The record is built as a
    // fresh, single-frame `GhostInstance` (mirroring the
    // `ACT1_KNOCKOUT_BODY_RECORDING` shape from
    // `mountAct1Cinematic`: a 1-frame all-zero recording stamped at
    // the 12:00 normalized timeOfDay, flipped to `unconscious`
    // post-creation). The original bucket-5 ghost is left untouched
    // so the 5:00 timeline still records what happened there (the
    // team-up's knockout); F-007 partial behavior covers the runtime
    // mechanism that produces this placement-record on a real
    // South-portal traversal of a carried body, and lands in its own
    // follow-up slice.
    //
    // The placement-record ghost is filed AFTER the active-timeline
    // switched to 12 by the South traversal, so `add` leaves it
    // visible (the non-active hide path does not fire). Knockout is
    // applied AFTER `add` because `add` does not call `reset`; the
    // reset path only fires on a non-trivial `setActiveTimeline`
    // switch, which has already happened.
    // -----------------------------------------------------------------
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

    // -----------------------------------------------------------------
    // Phase 9: build the snapshot and assert the mirror predicate.
    // -----------------------------------------------------------------
    const snapshot = buildActStateSnapshot(registry, player, entries);
    expect(isAct3Mirror(snapshot)).toBe(true);
    expect(observer.update(snapshot)).toBe("act-3-mirror");
    expect(observer.state).toBe("act-3-mirror");
  });

  it("isAct3Mirror fails when any of its three conjunctions is missing", () => {
    // Boundary regression: the predicate's three conjunctions
    // (currentTimeline === 12; activePlayer.carry.kind === 'idle'; at
    // least one unconscious ghost in bucket 12 within
    // DROP_CENTER_RADIUS_M of origin) are each load-bearing. Build a
    // fully-satisfying snapshot, then drop each conjunction in turn
    // and assert the predicate returns false.
    const harness = buildHarness();
    const { scene, world, registry, player } = harness;

    // Synthesize bucket 12: a 12:00-origin unconscious ghost at the
    // room center. The recording substrate is irrelevant to the
    // predicate (it reads only consciousness plus position).
    const recorder = new InputRecorder();
    recorder.record(inputState({}), 12 / 24);
    const ghost = createGhost({
      recording: recorder.snapshot(),
      originNormalized: 12 / 24,
      instanceId: 99,
      scene,
      world,
      startPosition: { x: 0, z: 0 },
    });
    registry.add(12, ghost);
    registry.setActiveTimeline(12);
    // Flip to unconscious AFTER the active-timeline switch: the
    // entering-bucket reset path in `setActiveTimeline` calls
    // `ghost.reset()`, which restores consciousness to the seed
    // (`'conscious'`). The mirror predicate reads consciousness at
    // snapshot time, so we apply the knockout post-switch.
    ghost.consciousness = applyKnockout(ghost.consciousness);

    // Place the player at room center, carry idle.
    player.body.setTranslation({ x: 0, y: RESTING_Y, z: 0 }, true);
    player.carry = { kind: "idle" };

    const baseSnapshot = buildActStateSnapshot(registry, player, []);
    expect(isAct3Mirror(baseSnapshot)).toBe(true);

    // Drop conjunction 1: currentTimeline !== 12.
    const wrongTimeline: ActStateSnapshot = {
      ...baseSnapshot,
      currentTimeline: 5,
      registry: {
        activeTimeline: 5,
        ghostsFor: baseSnapshot.registry.ghostsFor,
      },
    };
    expect(isAct3Mirror(wrongTimeline)).toBe(false);

    // Drop conjunction 2: carry.kind !== 'idle'.
    const stillCarrying: ActStateSnapshot = {
      ...baseSnapshot,
      activePlayer: {
        ...baseSnapshot.activePlayer,
        carry: { kind: "carrying", carriedId: 99 },
      },
    };
    expect(isAct3Mirror(stillCarrying)).toBe(false);

    // Drop conjunction 3 (variant a): the bucket-12 body is conscious.
    const consciousBody: ActStateSnapshot = {
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
    expect(isAct3Mirror(consciousBody)).toBe(false);

    // Drop conjunction 3 (variant b): the unconscious body sits beyond
    // DROP_CENTER_RADIUS_M (1.0 m) of the room origin. Project the
    // ghost at (5, 0): planar distance 5 > 1.0, so the predicate's
    // distance filter rejects the body.
    const farFromCenter: ActStateSnapshot = {
      ...baseSnapshot,
      registry: {
        activeTimeline: 12,
        ghostsFor: (timeline) =>
          timeline === 12
            ? baseSnapshot.registry
                .ghostsFor(12)
                .map((g) => ({ ...g, position: { x: 5, z: 0 } }))
            : baseSnapshot.registry.ghostsFor(timeline),
      },
    };
    expect(isAct3Mirror(farFromCenter)).toBe(false);
  });
});
