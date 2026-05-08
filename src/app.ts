import RAPIER from "@dimforge/rapier3d-compat";
import { createRenderer } from "./render/renderer.ts";
import { interpolateWarmToCool } from "./render/colorTint.ts";
import { buildScene } from "./scene/scene.ts";
import { createPlayer } from "./scene/player.ts";
import { createFloorRing, updateFloorRing } from "./scene/floorRing.ts";
import { createKeyboardState, inputToVelocity } from "./input/keyboard.ts";
import { TimeOfDay } from "./sim/timeOfDay.ts";
import { InputRecorder } from "./sim/inputRecorder.ts";
import type { GhostInstance } from "./sim/ghostInstance.ts";
import { createPortalTriggerSet } from "./sim/portalTrigger.ts";
import { wireTraversal, type ActiveLifetime } from "./sim/portalTraversal.ts";

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
  const timeOfDay = new TimeOfDay({ ticksPerSecond: 60 });
  // REQ-030: stamp the player capsule with the warm-to-cool tint at its
  // spawn time. With a freshly constructed clock at tick 0 this is the warm
  // anchor; a later portal-traversal slice will re-stamp on travel.
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
  };

  // REQ-009 deepening: edge-triggered portal overlap detector. Reports an
  // `enter` once per portal when the active player walks into its trigger
  // volume and an `exit` once when leaving. The detector is driven once per
  // fixed simulation step so its tick numbers align with the recorder and
  // ghost replay; lit/dark filtering and the teleport response live in
  // `wireTraversal` below (REQ-009 runtime half / REQ-010).
  const portalTriggers = createPortalTriggerSet(sceneCtx.portals);
  let portalTick = 0;

  // Active ghost instances. Each ghost owns its own tick counter that
  // advances by one per fixed simulation step. Despawn semantics belong to
  // a later slice tied to per-timeline ghost bookkeeping; for now ghosts
  // simply stop moving past the end of their recording.
  const ghosts: GhostInstance[] = [];

  // REQ-009 runtime / REQ-013 / REQ-014 partial: on a lit-portal `enter`,
  // snapshot the lifetime's recording into a ghost from the lifetime's
  // start position, teleport the active player to the destination spawn
  // pose, re-stamp the player's origin tint, and open a fresh lifetime at
  // the destination time. Dark portals are filtered (REQ-010).
  wireTraversal({
    detector: portalTriggers,
    player,
    lifetime,
    scene: sceneCtx.scene,
    world,
    ghosts,
  });

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
      const velocity = inputToVelocity(keyboard.state);
      player.setPlanarVelocity(velocity.x, velocity.z);
      // Advance every active ghost by one tick BEFORE stepping the world so
      // each ghost's planar velocity is written into the same `world.step()`
      // that consumes the active player's velocity. Past the end of the
      // recording `replayAtTick` returns zero, so the ghost decelerates to
      // a stop under linear damping (REQ-002: the recording itself is
      // immutable; the ghost cannot be altered, only worked around).
      for (const ghost of ghosts) {
        ghost.advanceTick();
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
    for (const ghost of ghosts) {
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
