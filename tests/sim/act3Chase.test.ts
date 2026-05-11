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
  isAct3Chase,
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
 * REQ-019 Act 3 chase beat integration test
 * (`docs/gdd/03-story-acts-1-3.md` Act 3: Escape;
 * `docs/gdd/40-act-progress-and-narrative-beats.md` section 4 REQ-019).
 *
 * The GDD's narrative for the Act 3 chase:
 *
 *   "This time, run toward the West door as the other instance chases
 *    you. Both instances get pulled through and arrive at 5:00. Two
 *    other instances of the player are now present in the same scene."
 *
 * The dossier's pseudocode:
 *
 *   beatAct3Chase(snapshot):
 *     return snapshot.recentWestEntries.distinctInstanceIds(window=2) >= 2
 *         && snapshot.currentTimeline === 5
 *
 * Two distinct instances (the active player plus a ghost from the prior
 * 6:00 lifetime) cross the West portal trigger within `CHASE_WINDOW_TICKS`
 * (= 2) of each other. The host populates the observer's `recentWestEntries`
 * ring buffer per-instance from the portal-trigger overlap callback; the
 * predicate then reads two distinct instance ids in the buffer plus the
 * active timeline being 5 (the destination of the West portal at 6:00 per
 * `ACT_ONE_PORTAL_SPECS`).
 *
 * Per Q-023's v1 simplification (`docs/OPEN_QUESTIONS.md`), unconscious
 * to conscious recovery is forbidden by REQ-033, so the literal "the
 * other instance chases" cannot be staged inside one play session: the
 * recording substrate of REQ-001 / REQ-002 satisfies it on the next loop
 * iteration. For the chase predicate gate this slice exercises, the
 * load-bearing state is:
 *
 *   - The active player is at 6:00 (post-Act 3 setup, walked East from
 *     5:00).
 *   - A ghost in bucket 6 walks West toward the West portal trigger,
 *     modelling the prior lifetime "chasing." Its recording is authored
 *     directly (the same pattern `mountAct1Cinematic` uses for the Act 1
 *     scripted-actor recordings) rather than captured from a prior
 *     player-driven loop, because Q-023 forbids the unconscious wake.
 *   - Both instances cross the West trigger volume in the SAME tick.
 *     The host calls `observer.recordWestEntry` once per instance with
 *     the entering instance id plus the tick. The buffer now holds two
 *     distinct entries.
 *   - The active player's lit-portal traversal sends them to 5:00 (the
 *     West portal's `destinationHours = 5` per `ACT_ONE_PORTAL_SPECS`,
 *     and the West door is lit at 6:00 per `DOOR_STATE_BY_HOUR`).
 *   - The ghost's body crosses the trigger but does NOT independently
 *     traverse: `wireTraversal` only acts on the active player. The
 *     dossier's "both arrive at 5:00" line is satisfied by the spawned
 *     ghost in the registry's bucket-5 (filed by the lit-portal
 *     traversal, replaying the East-bound walk that opened the lifetime
 *     at 5:00) plus the chasing ghost (whose body sits at 6:00 because
 *     ghosts are not portal-aware in the current scope; the predicate
 *     reads the buffer, not the ghost's position post-trigger).
 *
 * The chase predicate (`recentWestEntries has two distinct ids within
 * CHASE_WINDOW_TICKS && currentTimeline === 5`) fires here. The
 * observer's monotonic walk advances the watermark from `act-3-setup`
 * to `act-3-chase`.
 *
 * NOT in scope:
 *   - Wiring the host's portal-trigger callback to call
 *     `observer.recordWestEntry`. The observer is a data-only structure
 *     this slice; per-beat host wiring lands with the REQ-023 escape
 *     slice.
 *   - Multi-entity portal-trigger detection. The current `PortalTriggerSet`
 *     watches one entity (the active player) per `step` call. The
 *     ghost's West-trigger entry is detected via the pure
 *     `pointInsideTrigger` predicate against the ghost's body
 *     translation each tick; the host wiring slice will broaden this.
 *   - REQ-020+ (team-up / mirror / final-knockout / escape): separate
 *     slices extend this same harness pattern.
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
 * Mirror of `act3Setup.test.ts`'s `runLoopOne`; lifted verbatim because
 * the slice-discipline rule waits for the third repetition before
 * extracting (this is the second use; act2Loop2 has its loop-1 inline).
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
 * of `act3Setup.test.ts`'s `runLoopTwo`; lifted because the third-
 * repetition extraction trigger has now landed (this file plus
 * `act3Setup.test.ts` plus inline body in `act2Loop2.test.ts`). A
 * follow-up slice can extract these helpers into a shared module; per
 * slice-discipline the extraction is its own slice rather than
 * smuggled in here.
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

  // Idle frame at 6:00 BEFORE the knockout so the lifetime's recorder has
  // at least one frame when the Act 2 to Act 3 boundary files the prior
  // lifetime as a ghost in bucket 6 (the `recording.length > 0` gate
  // `wireTraversal` itself uses).
  lifetime.recorder.record(inputState({}), 6 / 24);

  // Phase 4: model the recorded "You-2 punches You1" beat as a direct
  // knockout against the active player at 6:00.
  player.consciousness = applyKnockout(player.consciousness);
  applyKnockoutBodyResponse(player.body, player.mesh, { x: 1, z: 0 });

  return { tick };
};

/**
 * Begin a fresh active lifetime at 5:00 after the prior lifetime ended
 * unconscious at 6:00. Mirror of `act3Setup.test.ts`'s
 * `beginNewLifetimeAt5`. Models the Act 2 to Act 3 implicit fade-out /
 * fade-in lifetime boundary the GDD describes: the prior lifetime's
 * recording is filed as an unconscious ghost in bucket 6 (post-flipped
 * via `applyKnockout` in the `mountAct1Cinematic` body-ghost pattern),
 * the active player is reset to a fresh conscious lifetime at the room
 * center at 5:00, and the registry switches active timeline to 5.
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

describe("REQ-019 Act 3 chase integration", () => {
  it("two distinct instances entering the West portal trigger within CHASE_WINDOW_TICKS at 6:00 and the active player traversing to 5:00 transitions the observer to act-3-chase", () => {
    const harness = buildHarness();
    const { scene, world, player, lifetime, registry } = harness;

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // ---------------------------------------------------------------
    // Phase 1: drive Act 2 loops 1 + 2 to land at active=6 with the
    // player unconscious at 6:00 (the prior-PR Act 2 end state). Phase
    // 1 mirrors `act3Setup.test.ts`'s phase 1.
    // ---------------------------------------------------------------
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

    // ---------------------------------------------------------------
    // Phase 2: implicit Act 2 to Act 3 fade boundary. Begin a fresh
    // lifetime at 5:00. After this: active=5, player conscious at the
    // room center, bucket 6 has the prior unconscious lifetime plus
    // the loop-1 ghost-B, bucket 5 has ghost-A and the dragging-East
    // ghost-C.
    // ---------------------------------------------------------------
    beginNewLifetimeAt5(harness);
    observer.update(buildActStateSnapshot(registry, player, []));
    expect(observer.state).toBe("act-3-setup");

    // Sanity: detector overlap state is stale from the prior phase
    // (the East trigger fired during the loop-2 East traversal, then
    // `setActiveTimeline(5)` ran without resetting the detector). Reset
    // it so the next `step` call against the room center does not fire
    // a stale exit event.
    detector.resetOverlapState();

    // ---------------------------------------------------------------
    // Phase 3: walk East from 5:00 to 6:00 to put the active player
    // back at 6:00 for the chase. The chase happens at 6:00 (the West
    // door is lit there per `DOOR_STATE_BY_HOUR[6]` and routes to 5:00
    // per `ACT_ONE_PORTAL_SPECS.west.destinationHours`).
    // ---------------------------------------------------------------
    let tick = tickAfterLoop2 + 100;
    detector.step(0, 0, tick++);
    for (let i = 0; i < 40; i++) {
      lifetime.recorder.record(inputState({ right: true }), 5 / 24);
    }
    detector.step(HALF_WIDTH - 0.4, 0, tick++);
    expect(registry.activeTimeline).toBe(6);
    expect(player.originNormalized).toBeCloseTo(6 / 24, 6);

    // ---------------------------------------------------------------
    // Phase 4: at 6:00 the prior 6:00 ghost-B (loop-1 West-bound) plus
    // the prior unconscious lifetime are both in bucket 6 and now
    // visible (entered-bucket reset on `setActiveTimeline(6)`). Author
    // a separate "chasing ghost" with a recording that walks West so
    // the test exercises two distinct instances entering the West
    // trigger in the same tick. The recording is authored directly
    // (the same pattern `mountAct1Cinematic` uses for scripted-actor
    // ghosts) because Q-023's v1 simplification forbids the
    // unconscious-to-conscious transition that would let a prior
    // lifetime "wake and chase" through the recording substrate.
    // ---------------------------------------------------------------
    const chaserRecorder = new InputRecorder();
    for (let i = 0; i < 5; i++) {
      chaserRecorder.record(inputState({ left: true }), 6 / 24);
    }
    const chaserRecording = chaserRecorder.snapshot();
    const chaserInstanceId = nextInstanceId(player.instanceId);
    const chaser = createGhost({
      recording: chaserRecording,
      originNormalized: 6 / 24,
      instanceId: chaserInstanceId,
      scene,
      world,
      // Spawn a hair East of the room center so the chaser walks West
      // through the West trigger volume in step with the active player.
      startPosition: { x: 0.2, z: 0 },
    });
    registry.add(6, chaser);

    // ---------------------------------------------------------------
    // Phase 5: drive both instances toward the West trigger. Each tick
    // the chaser advances under its recording (replayAtTick writes the
    // body's planar velocity), the active player records a left-bound
    // input frame, the world steps once so velocities integrate to
    // positions, and we test BOTH bodies against the West portal's
    // trigger volume via the pure `pointInsideTrigger` predicate. When
    // a body enters the trigger we record a West-entry against the
    // observer with that instance id and the current tick. The active
    // player's entry also fires through the detector callback so the
    // lit-portal traversal handler kicks in (sending them to 5:00).
    // ---------------------------------------------------------------
    const westTrigger = detector.triggers.find(
      (t) => t.portal.door.direction === "west",
    );
    if (!westTrigger) {
      throw new Error("REQ-019 test: missing West portal trigger");
    }

    // Pre-populate the active-player West-trigger overlap state so the
    // FIRST `step(x, z, tick)` call after the player walks into the
    // trigger fires a single `enter` event. The detector started with
    // overlapping[west] = false; the player has been at the room
    // center, so there is no stale state to clear. (`resetOverlapState`
    // already ran above.)

    // Snap both bodies just outside the West trigger volume on the
    // East face. The trigger covers `[centerX - halfX, centerX + halfX]`
    // along world X; placing each body at `centerX + halfX + epsilon`
    // puts them one step outside the East face. A small Z offset
    // between them keeps the two bodies from overlapping (both share
    // the same player capsule collider; without the offset Rapier's
    // contact response would shove them apart and perturb the trigger
    // entry tick).
    const eastFaceX = westTrigger.centerX + westTrigger.halfX;
    // Both bodies start a hair East of the trigger's East face. Z is
    // offset between the two (player at -0.5, chaser at 0.5) so the
    // player and chaser capsules do not overlap (capsule diameter is
    // PLAYER_CAPSULE.radius * 2 = 0.8 m); the trigger's `halfZ` is 0.6
    // m so both Z offsets sit comfortably inside the trigger volume.
    player.body.setTranslation(
      { x: eastFaceX + 0.05, y: player.body.translation().y, z: -0.5 },
      true,
    );
    player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    chaser.body.setTranslation(
      {
        x: eastFaceX + 0.05,
        y: chaser.body.translation().y,
        z: 0.5,
      },
      true,
    );
    chaser.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    // Drive both instances through the West trigger. Each fixed step:
    //   - the chaser body's velocity is written from its recording via
    //     `advanceTick` (mirrors how the host's per-tick loop drives
    //     ghost replay).
    //   - the active player's velocity is written from a synthesized
    //     left-bound input (mirrors the host's input-to-velocity).
    //   - `world.step()` integrates one fixed step so positions
    //     update.
    //   - both bodies are tested against the pure
    //     `pointInsideTrigger` predicate. On a false-to-true
    //     transition, we call `observer.recordWestEntry` with the
    //     instance id and the tick (mirrors what a future host
    //     wiring slice will do from the portal-trigger overlap
    //     callback for each tracked instance).
    //   - the active player's position is also fed to the production
    //     `detector.step(x, z, tick)`, which fires the `enter` event
    //     that the wired `wireTraversal` handler consumes (lit-portal
    //     traversal: snapshot the lifetime, teleport to 5:00, switch
    //     the active timeline). The detector watches the active
    //     player only; the chaser's trigger entry is detected via the
    //     pure predicate path because `PortalTriggerSet.step` accepts
    //     one entity per call. The dossier explicitly notes the host
    //     wiring will broaden multi-entity trigger detection in a
    //     future slice; this slice exercises the observer's
    //     `recordWestEntry` channel directly.
    let activePlayerInsideWest = false;
    let chaserInsideWest = false;
    let activePlayerEntryTick = -1;
    let chaserEntryTick = -1;
    // Cap iterations so a regression in the input-to-velocity mapping
    // does not infinite-loop; 60 ticks is generous (the trigger is
    // ~0.6m deep and the player walks at 4 m/s under linear damping,
    // so ~10 ticks is the realistic worst case).
    const CHASE_TICKS_MAX = 60;
    for (let i = 0; i < CHASE_TICKS_MAX; i++) {
      const t = tick++;

      // Drive chaser velocity through its recording (the production
      // ghost-replay path). After the recording exhausts, fall back to
      // a direct West-bound velocity write so the chaser keeps moving
      // toward the trigger; this models what a longer recording would
      // produce and keeps the trigger-entry guaranteed.
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

      // Once the active player has traversed (active timeline switched
      // to 5) AND the chaser has fired its West entry, the chase has
      // played out and the snapshot is ready.
      if (registry.activeTimeline === 5 && chaserEntryTick >= 0) break;
    }

    // Sanity: both entries fired within the 2-tick chase window.
    expect(activePlayerEntryTick).toBeGreaterThanOrEqual(0);
    expect(chaserEntryTick).toBeGreaterThanOrEqual(0);
    expect(Math.abs(activePlayerEntryTick - chaserEntryTick)).toBeLessThanOrEqual(2);

    // ---------------------------------------------------------------
    // Phase 6: assert the buffer captured two distinct entries within
    // the window, the active player traversed to 5:00 (lit-portal
    // handler ran), and the observer transitions to act-3-chase.
    // ---------------------------------------------------------------
    const entries = observer.recentWestEntries();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const distinctIds = new Set(entries.map((e) => e.instanceId));
    expect(distinctIds.size).toBeGreaterThanOrEqual(2);
    // Tick window: at least one pair of distinct ids within 2 ticks.
    let pairWithinWindow = false;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (
          entries[i].instanceId !== entries[j].instanceId &&
          Math.abs(entries[i].tick - entries[j].tick) <= 2
        ) {
          pairWithinWindow = true;
        }
      }
    }
    expect(pairWithinWindow).toBe(true);

    // The active player has traversed to 5:00.
    expect(registry.activeTimeline).toBe(5);
    expect(player.originNormalized).toBeCloseTo(5 / 24, 6);

    // The lit-portal traversal filed the 6:00 lifetime as a fresh
    // ghost in bucket 6 (the timeline being LEFT BEHIND, derived from
    // `lifetime.originNormalized` at the moment of the West-trigger
    // `enter`). Bucket 6 now holds at least: ghost-B (loop-1 West-
    // bound), the prior unconscious lifetime, the chaser, and the
    // just-traversed lifetime.
    expect(registry.ghostsFor(6).length).toBeGreaterThanOrEqual(3);

    // ---------------------------------------------------------------
    // Phase 7: build the snapshot and assert isAct3Chase plus the
    // observer transition. The snapshot reads the buffer from the
    // observer (defensive copy so the predicate's loop is reading
    // exactly what the observer holds).
    // ---------------------------------------------------------------
    const snapshot = buildActStateSnapshot(registry, player, entries);
    expect(isAct3Chase(snapshot)).toBe(true);
    expect(observer.update(snapshot)).toBe("act-3-chase");
    expect(observer.state).toBe("act-3-chase");
  });

  it("isAct3Chase fails when either of its two conjunctions is missing", () => {
    // Boundary regression: the predicate's two conjunctions
    // (currentTimeline === 5, two distinct instance ids in the buffer
    // within CHASE_WINDOW_TICKS) are each load-bearing. Build a fully-
    // satisfying snapshot, then drop each conjunction in turn and
    // assert the predicate returns false. Exercises the same
    // dossier-pseudocode mapping as the chase integration above; the
    // unit-level coverage in `actState.test.ts` already pins the
    // distinct-id and tick-window edges, so this case focuses on the
    // currentTimeline conjunction (the one the integration above
    // implicitly exercises by traversing).
    const harness = buildHarness();
    const { registry, player } = harness;

    // Force the registry into the post-traversal state directly: a
    // West entry pair within the window, active timeline 5. The
    // registry's bucket bookkeeping is irrelevant to isAct3Chase (it
    // reads only currentTimeline and recentWestEntries).
    registry.setActiveTimeline(5);

    const baseEntries: ActStateSnapshot["recentWestEntries"] = [
      { instanceId: 1, tick: 100 },
      { instanceId: 2, tick: 101 },
    ];
    const baseSnapshot = buildActStateSnapshot(registry, player, baseEntries);
    expect(isAct3Chase(baseSnapshot)).toBe(true);

    // Drop conjunction 1: currentTimeline !== 5.
    const wrongTimeline: ActStateSnapshot = {
      ...baseSnapshot,
      currentTimeline: 6,
      registry: {
        activeTimeline: 6,
        ghostsFor: baseSnapshot.registry.ghostsFor,
      },
    };
    expect(isAct3Chase(wrongTimeline)).toBe(false);

    // Drop conjunction 2: only one distinct instance id in the buffer
    // (two entries with the same id are a single instance re-entering,
    // not two instances chasing).
    const oneInstance: ActStateSnapshot = {
      ...baseSnapshot,
      recentWestEntries: [
        { instanceId: 1, tick: 100 },
        { instanceId: 1, tick: 101 },
      ],
    };
    expect(isAct3Chase(oneInstance)).toBe(false);

    // Drop conjunction 2 (variant): two distinct ids but outside the
    // window (delta > CHASE_WINDOW_TICKS).
    const outsideWindow: ActStateSnapshot = {
      ...baseSnapshot,
      recentWestEntries: [
        { instanceId: 1, tick: 100 },
        { instanceId: 2, tick: 105 },
      ],
    };
    expect(isAct3Chase(outsideWindow)).toBe(false);
  });
});
