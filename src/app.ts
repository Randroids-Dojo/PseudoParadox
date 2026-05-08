import RAPIER from "@dimforge/rapier3d-compat";
import { createRenderer } from "./render/renderer.ts";
import { buildScene } from "./scene/scene.ts";

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

  // Track the most recent frame time so the physics integrator can use
  // a stable fixed step independent of the browser's vsync jitter.
  const fixedStepSeconds = 1 / 60;
  world.timestep = fixedStepSeconds;

  let lastFrameMs = performance.now();
  let physicsAccumulatorMs = 0;
  const fixedStepMs = fixedStepSeconds * 1000;

  function frame(nowMs: number): void {
    const deltaMs = nowMs - lastFrameMs;
    lastFrameMs = nowMs;

    physicsAccumulatorMs += deltaMs;
    // Cap the catch-up so a tab returning from background does not run
    // hundreds of physics steps in one frame.
    const maxStepsPerFrame = 5;
    let steps = 0;
    while (physicsAccumulatorMs >= fixedStepMs && steps < maxStepsPerFrame) {
      world.step();
      physicsAccumulatorMs -= fixedStepMs;
      steps += 1;
    }

    renderer.render(sceneCtx.scene, sceneCtx.camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
