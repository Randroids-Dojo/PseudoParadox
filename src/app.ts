import RAPIER from "@dimforge/rapier3d-compat";
import { createRenderer } from "./render/renderer.ts";
import { buildScene } from "./scene/scene.ts";
import { createPlayer } from "./scene/player.ts";
import { createKeyboardState, inputToVelocity } from "./input/keyboard.ts";

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
  const player = createPlayer(sceneCtx.scene, world);
  const keyboard = createKeyboardState(window);

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
      // Sample input once per physics step so target velocity reacts at the
      // simulation rate, not the render rate. The mapping is pure; the only
      // mutation is on the rigid body itself.
      const velocity = inputToVelocity(keyboard.state);
      player.setPlanarVelocity(velocity.x, velocity.z);
      world.step();
      physicsAccumulatorMs -= fixedStepMs;
      steps += 1;
    }

    player.syncMeshFromBody();
    renderer.render(sceneCtx.scene, sceneCtx.camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
