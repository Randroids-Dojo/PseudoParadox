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
  type ActStateSnapshot,
  type BucketGhostSnapshot,
} from "../../src/sim/actState.ts";
import type { GhostInstance } from "../../src/sim/ghostInstance.ts";
import { type KeyState } from "../../src/input/keyboard.ts";
import { applyKnockout } from "../../src/sim/knockoutState.ts";
import { applyKnockoutBodyResponse } from "../../src/sim/applyKnockoutBody.ts";
import {
  applyCarryAttachment,
  applyCarryPickup,
} from "../../src/sim/applyCarry.ts";
import { resolveCarryToggle, type Carryable } from "../../src/sim/carryState.ts";
import { runLoopOne } from "./_helpers/actLoops.ts";

/**
 * REQ-017 Act 2 second loop integration test
 * (`docs/gdd/03-story-acts-1-3.md` Act 2: Meet yourself, second loop;
 * `docs/gdd/40-act-progress-and-narrative-beats.md` section 4 REQ-017).
 *
 * The GDD's narrative for the Act 2 second loop:
 *
 *   1. Replay the Act 2 first loop to position a You-1 ghost at 5:00 and a
 *      You-1 (returning) ghost at 6:00.
 *   2. On return to 5:00, the player sees the You-1 ghost replaying the
 *      East-bound walk. The player walks toward that ghost and punches it.
 *      The ghost flips to `unconscious`.
 *   3. The player picks up the unconscious body, walks East with the body
 *      carried, and traverses the East lit portal at 5:00. The carried
 *      body teleports with the carrier (carry survives traversal per
 *      `dragRegression.test.ts > carry survives lit-portal traversal` and
 *      `wireTraversal`'s ActivePlayerHandle.carry passthrough).
 *   4. At 6:00, the player waits for "another instance to wake up" and
 *      gets knocked out by that instance (You-2 in the GDD's recording).
 *
 * Q-023 documents the v1 simplification of step 4. Under REQ-033 the
 * unconscious -> conscious transition does NOT exist (the dossier
 * explicitly forbids it; hard reset is the only path back). The GDD's
 * "wait for another instance to wake up" therefore cannot be staged
 * literally inside one play session: it would require a wake transition
 * the prototype intentionally lacks. The test treats step 4 as a direct
 * `applyKnockout` against the active player at 6:00, modelling the
 * outcome of the recorded punch tick that the GDD beat is actually
 * about (You-2 punches You1; the interesting state change is the
 * active player going down, not the wake-up itself). The recording
 * substrate of REQ-001 / REQ-002 gives us exactly this on the next
 * loop iteration: any future visit to 6:00 will replay this very
 * sequence, including the punch.
 *
 * The test does NOT step the Rapier physics loop for portal-trigger
 * detection; instead it drives `detector.step(x, z, tick)` directly,
 * the same surface the host loop uses. That keeps the test
 * deterministic without coupling to fixed-step scheduling.
 *
 * Carry semantics:
 *   - Pickup is invoked via `resolveCarryToggle` on a one-tick rising
 *     edge of the pickup input, mirroring the host's per-tick toggle
 *     resolver. The side-effecting `applyCarryPickup` flips the
 *     ghost's body to `KinematicPositionBased`. Carry survives the
 *     East lit-portal traversal because `wireTraversal` does not
 *     branch on `player.carry`.
 *   - The carry attachment is NOT exercised tick-by-tick through
 *     `world.step` here: this slice's predicate gate
 *     (`isAct2Loop2`) reads only the registry buckets and the active
 *     player's consciousness; the body's exact translation post-
 *     traversal is pinned by `dragRegression.test.ts`'s "post-
 *     traversal re-anchor" case and is out of scope for this slice.
 *
 * NOT in scope:
 *   - The Phase-4 wake mechanic itself (Q-023 default A: simulated by
 *     direct knockout flip).
 *   - Any host-side wiring of the observer into `src/app.ts`. The
 *     observer remains a data-only structure this slice; per-beat
 *     host wiring lands with the REQ-023 escape slice.
 *   - REQ-018+ (Act 3): a separate slice extends this same harness
 *     pattern for Act 3 setup / chase / team-up / mirror / final.
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
  // satisfies isAct1Spawn (the prerequisite walked by the observer).
  mountAct1Cinematic({ registry, scene, world });
  return { scene, world, player, lifetime, registry };
};

/**
 * Project a live `GhostInstance` into the read-only `BucketGhostSnapshot`
 * shape the observer's predicates inspect. Same projection as
 * `act2Loop1.test.ts`; lifted here verbatim to keep the two integration
 * tests independently legible (slice-discipline: wait for the third
 * repetition before extracting).
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


describe("REQ-017 Act 2 second loop integration", () => {
  it("knocking out You-1 on return to 5:00, dragging the body East to 6:00, then resolving the You-2 punch transitions the observer to act-2-loop-2", () => {
    const harness = buildHarness();
    const { scene, world, player, lifetime, registry } = harness;

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // -----------------------------------------------------------------
    // Phase 1+2: Run the Act 2 first loop. After this we have ghost-A
    // (East-bound recording, instance 1) in bucket 5 and ghost-B
    // (West-bound recording, instance 2) in bucket 6, active timeline
    // is 5, and ghost-A is at-rest. Sanity check via isAct2Loop1.
    // -----------------------------------------------------------------
    const { tick: tickAfterLoop1, ghostA } = runLoopOne(harness, detector, 0);
    let tick = tickAfterLoop1;

    expect(registry.activeTimeline).toBe(5);
    expect(registry.ghostsFor(5)).toHaveLength(1);
    expect(registry.ghostsFor(6)).toHaveLength(1);
    // F-014: ghost-A starts at tickIndex = West.destinationTick (30)
    // after loop-back, so after `recording.length` advanceTick calls
    // it ends at tickIndex = 70. The at-rest predicate cares about >=.
    expect(ghostA.tickIndex).toBeGreaterThanOrEqual(
      ghostA.recording.length,
    );
    expect(isAct2Loop1(buildActStateSnapshot(registry, player))).toBe(true);

    // Open the observer here and feed the loop-1 snapshot so the
    // watermark advances to `act-2-loop-1`. The host's observer is
    // driven once per fixed step in production, so by the time the
    // player completes Loop 2 the watermark has already passed every
    // earlier beat. We mirror that monotonic advance explicitly to
    // pin the chain prerequisite walk.
    const observer = createActStateObserver();
    observer.update(buildActStateSnapshot(registry, player));
    expect(observer.state).toBe("act-2-loop-1");

    // -----------------------------------------------------------------
    // Phase 3a: Knock out You-1 (ghost-A). The player walks adjacent
    // to ghost-A's body and punches. We simulate the punch landing by
    // applying the same side effects the host loop applies in
    // `src/app.ts`: flip the consciousness flag plus the body
    // response (impulse + mesh tilt). This mirrors `applyKnockout`
    // and `applyKnockoutBodyResponse` being called on a punch
    // resolution that targets ghost-A's id.
    // -----------------------------------------------------------------
    // Position the player capsule next to ghost-A so a punch would
    // land on it (within `PUNCH_RANGE_M = 1.2`). Ghost-A's spawn
    // position is the room center because lifetime.startPosition was
    // (0, 0) at the moment of the East traversal that filed it.
    const ghostAPos = ghostA.body.translation();
    player.body.setTranslation(
      { x: ghostAPos.x + 0.5, y: player.body.translation().y, z: ghostAPos.z },
      true,
    );

    // Simulated punch resolution. The direction of the bump is the
    // recipient minus the attacker, projected XZ.
    const direction = {
      x: ghostAPos.x - (ghostAPos.x + 0.5),
      z: ghostAPos.z - ghostAPos.z,
    };
    ghostA.consciousness = applyKnockout(ghostA.consciousness);
    applyKnockoutBodyResponse(ghostA.body, ghostA.mesh, direction);
    expect(ghostA.consciousness).toBe("unconscious");

    // -----------------------------------------------------------------
    // Phase 3b: Pickup the unconscious ghost-A. Drive the same toggle
    // resolver the host uses with a one-tick rising edge.
    // -----------------------------------------------------------------
    const carryables: Carryable[] = registry
      .ghostsFor(5)
      .map((g) => ({
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
    const nextCarry = resolveCarryToggle(player.carry, true, carrier, carryables);
    expect(nextCarry).toEqual({ kind: "carrying", carriedId: ghostA.instanceId });
    player.carry = nextCarry;
    applyCarryPickup(ghostA.body);

    // -----------------------------------------------------------------
    // Phase 3c: Walk East with the body carried. Record a few input
    // frames so the spawned You-2 ghost (the one that will file into
    // bucket 5 on this East traversal) has a non-trivial recording.
    // The `pickup: true` channel is held throughout the carry per
    // Q-011 (the carrier's recorder captures pickup directly so the
    // body's trajectory is a deterministic CONSEQUENCE on replay).
    // -----------------------------------------------------------------
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
      // Apply the carry attachment each tick the way the host does;
      // here we don't world.step so we simply pin the body to track
      // the carrier directly via setNextKinematicTranslation.
      applyCarryAttachment(player.body, ghostA.body);
    }

    // Cross the East trigger at 5:00 (East lit at 5:00 per
    // DOOR_STATE_BY_HOUR). Carry survives traversal: wireTraversal
    // does NOT branch on player.carry, so player.carry passes through
    // unchanged.
    detector.step(HALF_WIDTH - 0.4, 0, tick++);

    // -----------------------------------------------------------------
    // Phase 3d: Post-East-traversal assertions. Active timeline is 6.
    // The carrier's prior 5:00 lifetime (the carrying-East walk) was
    // snapshotted as a ghost in bucket 5 (filed under the LEAVING
    // timeline per portalTraversal.ts step 1). The carry state is
    // preserved.
    // -----------------------------------------------------------------
    expect(registry.activeTimeline).toBe(6);
    expect(player.carry).toEqual({
      kind: "carrying",
      carriedId: ghostA.instanceId,
    });
    // Bucket 5 now holds at least one unconscious ghost (ghost-A) plus
    // the freshly-filed dragging-East ghost (ghost-C). Both are hidden
    // in the leaving bucket. Ghost-A retained its `unconscious` flag
    // because `setActiveTimeline` on the leaving bucket only HIDES; it
    // does not reset (reset fires on ENTERING bucket re-entry).
    expect(registry.ghostsFor(5).length).toBeGreaterThanOrEqual(2);
    expect(
      registry.ghostsFor(5).some((g) => g.consciousness === "unconscious"),
    ).toBe(true);
    // Bucket 6 still holds ghost-B (the prior loop's West-bound ghost).
    expect(registry.ghostsFor(6).length).toBeGreaterThanOrEqual(1);

    // -----------------------------------------------------------------
    // Phase 4: Resolve the "You-2 wakes up and punches You1" beat.
    // Per Q-023 default A, this is modelled as a direct knockout
    // against the active player. The recording substrate of REQ-001 /
    // REQ-002 is what makes the GDD's reading work on a future loop:
    // the punch the player just received here will replay the next
    // time the player visits 6:00, and the recorded punch is the
    // `'wake up'` beat the GDD describes.
    //
    // Apply the same side effects the host's punch resolver applies:
    // flip consciousness plus the body response.
    // -----------------------------------------------------------------
    player.consciousness = applyKnockout(player.consciousness);
    applyKnockoutBodyResponse(player.body, player.mesh, { x: 1, z: 0 });
    expect(player.consciousness).toBe("unconscious");

    // -----------------------------------------------------------------
    // Phase 5: Build the final snapshot and feed it to the observer.
    // The chain walked is `not-started -> act-1-spawn -> act-2-loop-1
    // -> act-2-loop-2`. The observer halts at `act-2-loop-2` because
    // the next predicate (act-3-setup) requires `currentTimeline === 5`.
    // -----------------------------------------------------------------
    const snapshot = buildActStateSnapshot(registry, player);
    expect(isAct2Loop2(snapshot)).toBe(true);
    expect(observer.update(snapshot)).toBe("act-2-loop-2");
    expect(observer.state).toBe("act-2-loop-2");
  });

  it("isAct2Loop2 fails when any one of its four conjunctions is missing", () => {
    // Boundary regression: the predicate's four conjunctions
    // (currentTimeline === 6, activePlayer unconscious, ghosts5 has an
    // unconscious, ghosts6 non-empty) are each load-bearing. Drop one
    // at a time and assert the predicate returns false.
    const harness = buildHarness();
    const { scene, world, player, lifetime, registry } = harness;

    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    const portals = createActOnePortals(doors);
    const detector = createPortalTriggerSet(portals);
    wireTraversal({ detector, player, lifetime, scene, world, registry });

    // Set up the Act 2 loop 1 state, then knock out ghost-A and
    // East-traverse with the carry, then knock out the active player.
    // After this every conjunction of `isAct2Loop2` is satisfied.
    const { tick: tickAfterLoop1, ghostA } = runLoopOne(harness, detector, 0);
    let tick = tickAfterLoop1;

    const ghostAPos = ghostA.body.translation();
    player.body.setTranslation(
      { x: ghostAPos.x + 0.5, y: player.body.translation().y, z: ghostAPos.z },
      true,
    );
    ghostA.consciousness = applyKnockout(ghostA.consciousness);
    applyKnockoutBodyResponse(ghostA.body, ghostA.mesh, { x: -1, z: 0 });

    const carryables: Carryable[] = registry
      .ghostsFor(5)
      .map((g) => ({
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

    detector.step(
      player.body.translation().x,
      player.body.translation().z,
      tick++,
    );
    for (let i = 0; i < 3; i++) {
      lifetime.recorder.record(
        inputState({ right: true, pickup: true }),
        5 / 24,
      );
      applyCarryAttachment(player.body, ghostA.body);
    }
    detector.step(HALF_WIDTH - 0.4, 0, tick++);
    player.consciousness = applyKnockout(player.consciousness);
    applyKnockoutBodyResponse(player.body, player.mesh, { x: 1, z: 0 });

    const baseSnapshot = buildActStateSnapshot(registry, player);
    expect(isAct2Loop2(baseSnapshot)).toBe(true);

    // Drop conjunction 1: currentTimeline !== 6.
    const wrongTimeline: ActStateSnapshot = {
      ...baseSnapshot,
      currentTimeline: 5,
      registry: {
        activeTimeline: 5,
        ghostsFor: baseSnapshot.registry.ghostsFor,
      },
    };
    expect(isAct2Loop2(wrongTimeline)).toBe(false);

    // Drop conjunction 2: active player is conscious.
    const consciousPlayer: ActStateSnapshot = {
      ...baseSnapshot,
      activePlayer: {
        ...baseSnapshot.activePlayer,
        consciousness: "conscious",
      },
    };
    expect(isAct2Loop2(consciousPlayer)).toBe(false);

    // Drop conjunction 3: no unconscious ghost in bucket 5. Project
    // ghosts5 forcibly through a flag-flip filter.
    const noUnconsciousIn5: ActStateSnapshot = {
      ...baseSnapshot,
      registry: {
        activeTimeline: baseSnapshot.registry.activeTimeline,
        ghostsFor: (timeline) => {
          const ghosts = baseSnapshot.registry.ghostsFor(timeline);
          if (timeline !== 5) return ghosts;
          return ghosts.map((g) => ({ ...g, consciousness: "conscious" }));
        },
      },
    };
    expect(isAct2Loop2(noUnconsciousIn5)).toBe(false);

    // Drop conjunction 4: empty bucket 6.
    const emptyBucket6: ActStateSnapshot = {
      ...baseSnapshot,
      registry: {
        activeTimeline: baseSnapshot.registry.activeTimeline,
        ghostsFor: (timeline) =>
          timeline === 6 ? [] : baseSnapshot.registry.ghostsFor(timeline),
      },
    };
    expect(isAct2Loop2(emptyBucket6)).toBe(false);
  });
});
