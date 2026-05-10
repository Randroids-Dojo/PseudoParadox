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
 * REQ-040 end-to-end completability gate.
 * (`docs/gdd/23-prototype-scope.md#definition-of-shippable`.)
 *
 * REQ-040: "Demo build supports the full Act 1 to Act 3 puzzle without
 * crashes or timeline desync." This is the single most load-bearing
 * regression gate in the prototype: the entire prior 42 PRs landed
 * primitives whose only justification is that, composed in order, they
 * drive the player from spawn at 5:00 to escaped at 12:00.
 *
 * The test reuses the per-beat harness sequence assembled across PRs
 * #34-#42 (Act 1 cinematic via `mountAct1Cinematic`, Act 2 loop 1, loop 2,
 * Act 3 setup, chase, team-up, mirror, final knockout, escape). It drives
 * every beat in order and at the end asserts:
 *
 *   - `ActStateObserver` reaches `'escaped'` on the final snapshot.
 *   - `isEscaped(finalSnapshot)` is true (predicate alignment with the
 *     observer).
 *   - No NaN positions on the active player or any ghost in any bucket.
 *   - Every ghost has a positive `InstanceId` and an `originNormalized`
 *     in [0, 1).
 *   - Per-timeline tick counts are sane: `0 <= tickIndex` and
 *     `tickIndex <= recording.length` for every ghost in every visited
 *     bucket.
 *   - Determinism gate: running the entire sequence a second time on a
 *     fresh harness produces the same final ActState plus the same
 *     bucket-12 ghost count plus the same active timeline. The observer
 *     watermark and the observable shape of the world are reproducible
 *     from a fresh world (REQ-001 / REQ-002 substrate).
 *
 * Q-020 default A would prefer Playwright against the live build. Per the
 * loop instructions and RULE 3 (no new core deps), this slice ships the
 * Vitest in-process equivalent and defers the live-browser smoke to F-008.
 * The Vitest path exercises the same primitives `src/app.ts` composes,
 * minus the WebGL canvas and the host's per-fixed-step loop wiring; that
 * delta is the F-008 gap.
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
      "REQ-040 test harness: expected ghost-A to be selected for carry",
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

  lifetime.milestones = new MilestoneRecorder();
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
    throw new Error("REQ-040 test: missing West portal trigger");
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
      `REQ-040 test: chase preconditions failed (player=${activePlayerEntryTick}, chaser=${chaserEntryTick})`,
    );
  }

  return { tick, entries: observer.recentWestEntries() };
};

interface SequenceResult {
  finalState: string;
  finalTimeline: number;
  bucket12Count: number;
  bucket5Count: number;
  bucket6Count: number;
  finalIsEscaped: boolean;
  ghostHealthIssues: string[];
}

/**
 * Drive the full Act 1 to escape sequence on a fresh harness. Returns the
 * observable shape of the final world (the determinism gate's reproducible
 * surface) plus a `ghostHealthIssues` list of any NaN positions, invalid
 * instance ids, out-of-range origins, or out-of-range tick counts spotted
 * across every visited bucket.
 */
const runFullSequence = (): SequenceResult => {
  const harness = buildHarness();
  const { scene, world, player, lifetime, registry } = harness;

  const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
  const portals = createActOnePortals(doors);
  const detector = createPortalTriggerSet(portals);
  wireTraversal({ detector, player, lifetime, scene, world, registry });

  const observer = createActStateObserver();

  const { tick: tickAfterLoop1, ghostA } = runLoopOne(harness, detector, 0);
  observer.update(buildActStateSnapshot(registry, player, []));

  const { tick: tickAfterLoop2 } = runLoopTwo(
    harness,
    detector,
    ghostA,
    tickAfterLoop1,
  );
  observer.update(buildActStateSnapshot(registry, player, []));

  beginNewLifetimeAt5(harness);
  observer.update(buildActStateSnapshot(registry, player, []));

  detector.resetOverlapState();

  const { tick: tickAfterChase, entries } = runChaseToActive5(
    harness,
    detector,
    observer,
    tickAfterLoop2 + 100,
  );
  observer.update(buildActStateSnapshot(registry, player, entries));

  // Team-up knockout against a 5:00-origin ghost in bucket 5.
  const ghostsAt5 = registry.ghostsFor(5);
  const targetGhost = ghostsAt5.find(
    (g) => Math.abs(g.originNormalized - 5 / 24) < 1e-6,
  );
  if (!targetGhost) {
    throw new Error(
      "REQ-040 test: expected at least one 5:00-origin ghost in bucket 5",
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

  // Carry the unconscious 5:00-origin ghost.
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
      "REQ-040 test: expected target ghost to be selected for carry",
    );
  }
  applyCarryPickup(targetGhost.body);

  // Walk South while carrying, traverse to 12:00.
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

  if (player.carry.kind === "carrying") {
    applyCarryAttachment(player.body, targetGhost.body);
  }
  world.step();

  applyCarryDrop(player.body, targetGhost.body, RESTING_Y);
  player.carry = { kind: "idle" };

  // F-007 partial path consumed (mirrors `act3Mirror.test.ts` /
  // `act3FinalKnockout.test.ts`). The runtime mechanism that REHOMES a
  // carried unconscious body across timelines on a South-portal traversal
  // does not exist yet; it is the canonical owner of the placement-record
  // creation in bucket 12 and is documented as F-007. Until F-007 ships,
  // every per-beat integration test (act3Mirror, act3FinalKnockout, and
  // this end-to-end driver) files the placement-record / partner ghosts
  // directly via `createGhost` + `registry.add` so the predicate has the
  // OUTCOME shape it reads (one unconscious 12:00-origin body within
  // DROP_CENTER_RADIUS_M of the origin; two unconscious bodies in bucket
  // 12 for final-knockout; cinematic-actors completed plus crossed-North
  // for escape). The test reads only the OUTCOME the predicates care
  // about, not the runtime mechanism that produces it. When F-007 lands,
  // these direct registry.add calls become assertions on the registry
  // shape AFTER the South traversal hook fires, and the test becomes
  // strictly end-to-end.

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

  // File the 6:00-origin team-up partner into bucket 12 and knock it out.
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

  // Advance every cinematic-actor ghost in bucket 12 past completion.
  const bucket12 = registry.ghostsFor(12);
  for (const g of bucket12) {
    const target = g.recording.length;
    while (g.tickIndex < target) {
      g.advanceTick();
    }
  }

  // Walk into the North trigger at 12:00.
  const northTrigger = detector.triggers.find(
    (t) => t.portal.door.direction === "north",
  );
  if (!northTrigger) {
    throw new Error("REQ-040 test: missing North portal trigger");
  }
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
  detector.step(0, northTrigger.centerZ, escapeTick++);

  const escapeSnapshot = buildActStateSnapshot(registry, player, entries, {
    activePlayerCrossedNorthAt12: true,
  });
  const finalState = observer.update(escapeSnapshot);

  // Walk every ghost in every visited bucket and record any health
  // violation. This is the "no orphaned ghosts" gate the REQ-040 dossier
  // calls out.
  const ghostHealthIssues: string[] = [];
  const checkedTimelines = [5, 6, 12];
  for (const tl of checkedTimelines) {
    const bucket = registry.ghostsFor(tl);
    for (const g of bucket) {
      const t = g.body.translation();
      if (!Number.isFinite(t.x) || !Number.isFinite(t.z)) {
        ghostHealthIssues.push(
          `bucket ${tl}: ghost id=${g.instanceId} has non-finite position (${t.x}, ${t.z})`,
        );
      }
      if (!Number.isFinite(g.instanceId) || g.instanceId <= 0) {
        ghostHealthIssues.push(
          `bucket ${tl}: ghost has invalid instanceId=${g.instanceId}`,
        );
      }
      if (
        !Number.isFinite(g.originNormalized) ||
        g.originNormalized < 0 ||
        g.originNormalized >= 1
      ) {
        ghostHealthIssues.push(
          `bucket ${tl}: ghost id=${g.instanceId} has out-of-range originNormalized=${g.originNormalized}`,
        );
      }
      if (g.tickIndex < 0) {
        ghostHealthIssues.push(
          `bucket ${tl}: ghost id=${g.instanceId} has negative tickIndex=${g.tickIndex}`,
        );
      }
      // tickIndex can equal recording.length (completed) but never
      // exceed it. The cinematic-completion phase above drives every
      // ghost in bucket 12 to exactly recording.length.
      if (g.tickIndex > g.recording.length) {
        ghostHealthIssues.push(
          `bucket ${tl}: ghost id=${g.instanceId} has tickIndex=${g.tickIndex} past recording.length=${g.recording.length}`,
        );
      }
    }
  }

  // Active player position health.
  const playerT = player.body.translation();
  if (!Number.isFinite(playerT.x) || !Number.isFinite(playerT.z)) {
    ghostHealthIssues.push(
      `active player has non-finite position (${playerT.x}, ${playerT.z})`,
    );
  }

  return {
    finalState,
    finalTimeline: registry.activeTimeline,
    bucket12Count: registry.ghostsFor(12).length,
    bucket5Count: registry.ghostsFor(5).length,
    bucket6Count: registry.ghostsFor(6).length,
    finalIsEscaped: isEscaped(escapeSnapshot),
    ghostHealthIssues,
  };
};

describe("REQ-040 end-to-end completability", () => {
  it("the full Act 1 to Act 3 sequence reaches escaped with no orphaned ghosts and no NaN positions", () => {
    const result = runFullSequence();

    expect(result.finalState).toBe("escaped");
    expect(result.finalIsEscaped).toBe(true);
    expect(result.finalTimeline).toBe(12);

    // Every ghost passed the per-bucket health checks (no NaN positions,
    // valid instance ids, in-range origins, sane tick counts).
    expect(result.ghostHealthIssues).toEqual([]);

    // Bucket 12 holds the three cinematic actors plus the placement-record
    // body plus the team-up partner: 5 ghosts. Bucket 6 holds the loop-1
    // West-bound ghost-B, the prior-lifetime unconscious ghost from the
    // Act 2 -> Act 3 boundary, and the chase chaser. Bucket 5 holds the
    // loop-1 East-bound ghost-A, the loop-2 dragging-East ghost-C, and
    // the chase fresh-lifetime recording filed by the West traversal.
    expect(result.bucket12Count).toBeGreaterThanOrEqual(5);
    expect(result.bucket6Count).toBeGreaterThanOrEqual(2);
    expect(result.bucket5Count).toBeGreaterThanOrEqual(2);
  });

  it("running the full sequence twice on fresh harnesses produces the same final ActState and bucket counts", () => {
    // Determinism gate: REQ-001 / REQ-002 substrate plus the per-beat
    // primitives must produce a reproducible final world from a fresh
    // boot. The test does NOT assert per-tick byte-identical state
    // (Rapier's contact solver depends on float-order, which the test
    // does not pin); it asserts the OBSERVABLE shape of the final world
    // is reproducible: same observer state, same active timeline, same
    // bucket cardinalities, same isEscaped reading. That is the regression
    // surface REQ-040 cares about.
    const a = runFullSequence();
    const b = runFullSequence();

    expect(b.finalState).toBe(a.finalState);
    expect(b.finalTimeline).toBe(a.finalTimeline);
    expect(b.bucket12Count).toBe(a.bucket12Count);
    expect(b.bucket5Count).toBe(a.bucket5Count);
    expect(b.bucket6Count).toBe(a.bucket6Count);
    expect(b.finalIsEscaped).toBe(a.finalIsEscaped);
    expect(b.ghostHealthIssues).toEqual(a.ghostHealthIssues);
  });
});
