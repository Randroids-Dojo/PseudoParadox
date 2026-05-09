import RAPIER from "@dimforge/rapier3d-compat";
import { createRenderer } from "./render/renderer.ts";
import { interpolateWarmToCool } from "./render/colorTint.ts";
import { buildScene } from "./scene/scene.ts";
import { createPlayer } from "./scene/player.ts";
import { createFloorRing, updateFloorRing } from "./scene/floorRing.ts";
import { createKeyboardState, inputToVelocity } from "./input/keyboard.ts";
import { TimeOfDay } from "./sim/timeOfDay.ts";
import { ACT_ONE_HOUR, ACT_ONE_NORMALIZED } from "./sim/actOneAnchor.ts";
import { InputRecorder } from "./sim/inputRecorder.ts";
import { INITIAL_INSTANCE_ID } from "./sim/instanceId.ts";
import { createPortalTriggerSet } from "./sim/portalTrigger.ts";
import { wireTraversal, type ActiveLifetime } from "./sim/portalTraversal.ts";
import { createTimelineRegistry } from "./sim/timelineRegistry.ts";
import {
  repaintDoorsForHour,
  snapClockToHour,
} from "./sim/timelineRoom.ts";
import { hardReset } from "./sim/hardReset.ts";
import {
  PUNCH_RANGE_M,
  resolvePunches,
  suppressUnconsciousPunches,
  type PunchActor,
} from "./sim/punch.ts";
import { applyKnockout } from "./sim/knockoutState.ts";
import { replayPunchAtTick } from "./sim/inputRecorder.ts";

/**
 * Boots the Pseudo Paradox prototype.
 *
 * Responsibilities of this entry point:
 *   1. Initialize the Rapier3D physics WASM module (async).
 *   2. Build the Three.js renderer and scene.
 *   3. Spin up a fixed-step physics tick alongside the render loop.
 *
 * Subsequent slices will register player input, instance spawn logic, and
 * the timeline recorder against the App returned here.
 */
export async function startApp(container: HTMLElement): Promise<void> {
  await RAPIER.init();

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  const renderer = createRenderer(container);
  const sceneCtx = buildScene();
  // REQ-029: warm-to-cool room tint driven by the deterministic simulation
  // tick. The clock is advanced once per fixed physics step below, not per
  // render frame, so REQ-001 timeline recording playback stays frame-exact
  // independent of how many frames render between physics steps.
  // REQ-013 / REQ-014: anchor the opening time at 5:00 on the canonical
  // 24-hour day arc (ACT_ONE_NORMALIZED = 5/24) so the very first frame
  // renders the Act 1 spawn pose: the room tints to the 5:00 amber, the
  // player capsule's tint stamps at the same normalized time, and the door
  // lit/dark state painted in `buildRoom` matches what the GDD specifies
  // for 5:00.
  const timeOfDay = new TimeOfDay({
    ticksPerSecond: 60,
    initialNormalized: ACT_ONE_NORMALIZED,
  });
  // REQ-030: stamp the player capsule with the warm-to-cool tint at its
  // spawn time. The clock starts at the Act 1 5:00 anchor so this lands on
  // the 5:00 hue; a later portal-traversal slice will re-stamp on travel.
  const player = createPlayer(sceneCtx.scene, world, {
    originNormalized: timeOfDay.normalized(),
  });
  // REQ-031: subtle floor ring underneath the active player. This is the
  // prototype's only non-diegetic UI element. The ring is added to the same
  // scene as the player and snapped to the player's planar position each
  // render frame below.
  const floorRing = createFloorRing();
  sceneCtx.scene.add(floorRing);
  updateFloorRing(floorRing, player.body);
  const keyboard = createKeyboardState(window);
  // REQ-001 / REQ-002 / REQ-003 foundation: the active player owns a
  // `lifetime` whose `recorder` captures input each fixed step. On portal
  // traversal the lifetime is closed (its recording snapshotted onto a
  // ghost) and a fresh one is opened at the destination time. Holding the
  // lifetime in a `let` keeps the per-frame capture path resolving against
  // the current recorder after a traversal swaps it.
  const playerSpawn = (() => {
    const t = player.body.translation();
    return { x: t.x, z: t.z };
  })();
  const lifetime: ActiveLifetime = {
    startPosition: { ...playerSpawn },
    recorder: new InputRecorder(),
    originNormalized: timeOfDay.normalized(),
    // REQ-007: the lifetime opens at the active player's current generation.
    // The first lifetime opens at `INITIAL_INSTANCE_ID = 1` (You1, the GDD's
    // first-ever spawn). On every lit-portal traversal the lifetime advances
    // to `nextInstanceId(previous)` (REQ-008: most-recently-spawned active).
    instanceId: INITIAL_INSTANCE_ID,
  };

  // REQ-009 deepening: edge-triggered portal overlap detector. Reports an
  // `enter` once per portal when the active player walks into its trigger
  // volume and an `exit` once when leaving. The detector is driven once per
  // fixed simulation step so its tick numbers align with the recorder and
  // ghost replay; lit/dark filtering and the teleport response live in
  // `wireTraversal` below (REQ-009 runtime half / REQ-010).
  const portalTriggers = createPortalTriggerSet(sceneCtx.portals);
  let portalTick = 0;

  // Per-timeline ghost bookkeeping. Ghosts are filed against the timeline
  // they were RECORDED IN (not the timeline they were spawned during a
  // traversal of). `registry.activeGhosts()` returns only the ghosts in the
  // timeline the active player is currently inside; the per-fixed-step
  // loop below ticks and renders only that bucket. On every lit-portal
  // traversal the registry hides the leaving timeline's ghosts and resets
  // the entering timeline's ghosts to tick 0 (REQ-001 / REQ-003).
  const registry = createTimelineRegistry({ initialTimeline: ACT_ONE_HOUR });

  // REQ-009 runtime / REQ-013 / REQ-014 partial / REQ-001 / REQ-003: on a
  // lit-portal `enter`, snapshot the lifetime's recording into a ghost from
  // the lifetime's start position, teleport the active player to the
  // destination spawn pose, re-stamp the player's origin tint, open a fresh
  // lifetime at the destination time, and switch the registry's active
  // timeline to the destination so per-timeline ghost visibility updates.
  // Dark portals are filtered (REQ-010).
  wireTraversal({
    detector: portalTriggers,
    player,
    lifetime,
    scene: sceneCtx.scene,
    world,
    registry,
    // REQ-015: on lit traversal, repaint the doors per the destination
    // hour's lit/dark table and snap the time-of-day clock so the room
    // background and the door visuals match the new timeline. The same
    // `doorLitStateAtHour` table that paints here also gates the runtime
    // entry predicate inside `wireTraversal`, so the visual and behavior
    // stay in lockstep.
    onTimelineEnter(destinationHour) {
      repaintDoorsForHour(sceneCtx.portals, destinationHour);
      snapClockToHour(timeOfDay, destinationHour);
    },
  });

  // REQ-025: hard reset on `r` keydown. The pause-menu UI is out of scope
  // for this slice; a single key binding is enough to return the simulation
  // to a clean Act 1 state when the player gets stuck. The handler is bound
  // to `window` (the same target the keyboard movement listeners use) and
  // is intentionally edge-triggered on `keydown` so holding `r` does not
  // continuously re-reset the simulation.
  const onResetKey = (event: KeyboardEvent): void => {
    if (event.code !== "KeyR") return;
    hardReset({
      player,
      lifetime,
      registry,
      scene: sceneCtx.scene,
      world,
      timeOfDay,
      portals: sceneCtx.portals,
      portalTriggers,
    });
  };
  window.addEventListener("keydown", onResetKey as EventListener);

  // Track the most recent frame time so the physics integrator can use
  // a stable fixed step independent of the browser's vsync jitter.
  const fixedStepSeconds = 1 / 60;
  world.timestep = fixedStepSeconds;

  let lastFrameMs = performance.now();
  let physicsAccumulatorMs = 0;
  const fixedStepMs = fixedStepSeconds * 1000;
  const maxStepsPerFrame = 5;
  // Bound the accumulator itself (not just per-frame steps). Without this
  // clamp, returning from a long tab pause leaves a massive backlog that
  // drains across many subsequent frames in delayed catch-up mode. Clamping
  // to the per-frame budget means we accept some lost simulation time after
  // a long pause but stay real-time responsive afterward.
  const maxAccumulatorMs = fixedStepMs * maxStepsPerFrame;

  function frame(nowMs: number): void {
    const deltaMs = nowMs - lastFrameMs;
    lastFrameMs = nowMs;

    physicsAccumulatorMs = Math.min(
      physicsAccumulatorMs + deltaMs,
      maxAccumulatorMs,
    );

    let steps = 0;
    while (physicsAccumulatorMs >= fixedStepMs && steps < maxStepsPerFrame) {
      // Advance the time-of-day clock first so the recorder captures the
      // tick-of-arrival's normalized time, matching what any later instance
      // observing this tick from outside will see (REQ-030).
      timeOfDay.advanceTicks(1);
      // Sample input once per physics step so target velocity reacts at the
      // simulation rate, not the render rate. The mapping is pure; the only
      // mutation is on the rigid body itself. The same KeyState snapshot is
      // also pushed into the recorder so a ghost capsule can later replay
      // this path tick-for-tick.
      lifetime.recorder.record(keyboard.state, timeOfDay.normalized());

      // REQ-033 partial: per-tick punch resolution. Build a PunchActor list
      // from the active player and every ghost in the active timeline, run
      // it through the resolver, and flip each target's `consciousness` to
      // `'unconscious'`. The resolution reads each actor's pre-tick state,
      // so simultaneous mutual punches both land. Unconscious attackers
      // have their `punching` flag suppressed before the resolver so they
      // cannot punch even if their recorded input still has it set this
      // tick. Done BEFORE advancing ghost ticks and BEFORE stepping the
      // world so the punch flag for THIS tick is the ghost's
      // `replayPunchAtTick(recording, tickIndex)` reading.
      const activeGhostsList = registry.activeGhosts();
      const playerTranslation = player.body.translation();
      const punchActors: PunchActor[] = [
        {
          id: player.instanceId,
          position: { x: playerTranslation.x, z: playerTranslation.z },
          punching: keyboard.state.punch,
          consciousness: player.consciousness,
        },
      ];
      for (const ghost of activeGhostsList) {
        const ghostTranslation = ghost.body.translation();
        // The ghost's recording stores one boolean per tick; the punch flag
        // for THIS tick is at `ghost.tickIndex` BEFORE advanceTick runs.
        // Past the end of the recording the helper returns false, so a
        // ghost that has exhausted its recording stops punching.
        const ghostPunching = replayPunchAtTick(
          ghost.recording,
          ghost.tickIndex,
        );
        punchActors.push({
          id: ghost.instanceId,
          position: { x: ghostTranslation.x, z: ghostTranslation.z },
          punching: ghostPunching,
          consciousness: ghost.consciousness,
        });
      }
      const sanitizedActors = suppressUnconsciousPunches(punchActors);
      const resolutions = resolvePunches(sanitizedActors, PUNCH_RANGE_M);
      if (resolutions.length > 0) {
        for (const { targetId } of resolutions) {
          if (targetId === player.instanceId) {
            player.consciousness = applyKnockout(player.consciousness);
            continue;
          }
          for (const ghost of activeGhostsList) {
            if (ghost.instanceId === targetId) {
              ghost.consciousness = applyKnockout(ghost.consciousness);
              break;
            }
          }
        }
      }

      // REQ-033 partial: an unconscious player has its keyboard input
      // suppressed before the planar velocity write so the body stops
      // moving (and its recorded input continues to capture whatever the
      // player presses, which is consistent with the dossier's "input is
      // frozen" semantics: the recorded path stops moving on replay too
      // because the punch resolver flips the recorded ghost when it
      // re-enters this timeline).
      const velocity =
        player.consciousness === "conscious"
          ? inputToVelocity(keyboard.state)
          : { x: 0, z: 0 };
      player.setPlanarVelocity(velocity.x, velocity.z);
      // Advance every ACTIVE ghost (those filed into the timeline the
      // player is currently in) by one tick BEFORE stepping the world so
      // each ghost's planar velocity is written into the same `world.step()`
      // that consumes the active player's velocity. Ghosts in non-active
      // timelines are hidden by the registry and not iterated here, so
      // they neither tick nor render until the player returns to their
      // timeline (REQ-001 / REQ-003 / REQ-006).
      for (const ghost of activeGhostsList) {
        ghost.advanceTick();
        // REQ-033 partial: an unconscious ghost stops moving. The body
        // response (bump impulse, damping) lands in the next slice; for
        // now we just zero the planar velocity AFTER advanceTick wrote
        // the recorded value.
        if (ghost.consciousness === "unconscious") {
          const current = ghost.body.linvel();
          ghost.body.setLinvel({ x: 0, y: current.y, z: 0 }, true);
        }
      }
      world.step();
      // REQ-009: evaluate portal-overlap edges AFTER the world step so the
      // detector reads the post-integration translation. The same tick
      // counter advances here regardless of how many ghosts exist.
      const playerPos = player.body.translation();
      portalTriggers.step(playerPos.x, playerPos.z, portalTick);
      portalTick += 1;
      physicsAccumulatorMs -= fixedStepMs;
      steps += 1;
    }

    player.syncMeshFromBody();
    for (const ghost of registry.activeGhosts()) {
      ghost.syncMeshFromBody();
    }
    // REQ-031: keep the active-player floor ring snapped to the player's
    // planar position. Done after `syncMeshFromBody` for symmetry; the ring
    // reads from the body directly so ordering does not matter, but keeping
    // both visual updates adjacent makes the render-frame contract obvious.
    updateFloorRing(floorRing, player.body);
    // Apply the interpolated background color from whatever tick the
    // simulation is currently on. The clock itself is advanced inside the
    // fixed-step loop above, not here, so frame rate cannot affect it.
    sceneCtx.scene.background = interpolateWarmToCool(timeOfDay.normalized());
    renderer.render(sceneCtx.scene, sceneCtx.camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
