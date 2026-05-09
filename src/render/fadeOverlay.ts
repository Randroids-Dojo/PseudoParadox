/**
 * Fade-to-black overlay for the Act 1 cinematic (REQ-012; Q-013 default A).
 *
 * The fade is a Three.js full-screen plane on a separate `OrthographicCamera`
 * so it sits on top of the world geometry without depth-fighting. The plane's
 * material is a `MeshBasicMaterial` with `transparent: true` and `depthTest:
 * false`; the host writes a per-tick opacity in `[0, 1]` via `setOpacity`.
 * The overlay's `render(renderer)` call composites the plane onto whatever
 * the main scene already drew this frame.
 *
 * `docs/gdd/40-act-progress-and-narrative-beats.md` section 5.4 spec:
 * "the fade is a Three.js full-screen plane in front of the camera, opacity
 * ramped from 0 to 1 over `ACT1_CINEMATIC_FADE_DURATION_TICKS` ticks
 * starting at `ACT1_CINEMATIC_FADE_START_TICK`, then ramped back to 0 once
 * the player has spawned at 5:00."
 *
 * The module is standalone: it does NOT subscribe to the cinematic's tick
 * counter or the active timeline. The host owns the timing logic and writes
 * the per-tick opacity through `setOpacity`. This keeps the overlay reusable
 * for the Act 2 fade-out, the Act 3 setup fade, and the level-complete fade
 * without coupling to any one cinematic's timing constants.
 *
 * NOT in scope:
 *
 *   - Cross-fades between two scenes. The overlay fades to a solid color
 *     only.
 *   - Per-pixel post-processing. The plane is uniform black; if a future
 *     fade needs a color other than black, `setColor(hex)` is a one-line
 *     extension.
 *   - Driving the opacity ramp from a host-side tick counter. The host
 *     writes `setOpacity(t)` directly each frame.
 */

import * as THREE from "three";

/**
 * Default fade color: black. The overlay's `MeshBasicMaterial.color` is set
 * to this hex at construction. Future cinematics that want a non-black fade
 * can pass an override via `createFadeOverlay({ colorHex })`.
 */
export const FADE_OVERLAY_COLOR_HEX = 0x000000;

export interface FadeOverlay {
  /**
   * The orthographic camera the overlay's plane is rendered through. Held
   * separately from the main scene's camera so the overlay's plane does not
   * interact with the world's perspective projection.
   */
  readonly camera: THREE.OrthographicCamera;
  /**
   * The scene containing the full-screen plane. Held separately from the
   * world's main scene so adding world objects does not pollute the
   * overlay pass.
   */
  readonly scene: THREE.Scene;
  /**
   * Current opacity in `[0, 1]`. Read-only view of the material's `opacity`
   * field; mutate via `setOpacity`.
   */
  readonly opacity: number;
  /**
   * Set the overlay's opacity. Values are clamped to `[0, 1]`. Sets the
   * plane's `visible` flag to `false` when the opacity rounds to zero so
   * the renderer can skip the draw call entirely (a 0-opacity transparent
   * pass still costs a state change in WebGL).
   */
  setOpacity: (opacity: number) => void;
  /**
   * Render the overlay on top of whatever the main scene already drew
   * this frame. Uses the renderer's existing target; the caller does NOT
   * need to clear depth between the main pass and the overlay pass
   * because `depthTest: false` on the overlay material disables the
   * depth read.
   *
   * Calls `renderer.autoClear = false` before rendering and restores the
   * previous value after; the main render pass typically runs with
   * `autoClear = true` (the renderer's default) and clearing again here
   * would erase the world below.
   */
  render: (renderer: THREE.WebGLRenderer) => void;
  /**
   * Tear down the overlay's geometry and material. Does NOT remove the
   * camera or scene (Three.js does not require disposing those). Safe to
   * call once at app teardown; subsequent `setOpacity` / `render` calls
   * are undefined-behavior, matching the rest of the codebase's `dispose`
   * conventions (e.g. `ThoughtBubble.dispose`).
   */
  dispose: () => void;
}

export interface CreateFadeOverlayOptions {
  /**
   * Override for the fade's solid color. Defaults to
   * `FADE_OVERLAY_COLOR_HEX` (black). Future cinematics that want a white
   * fade or a tinted fade pass a hex here.
   */
  colorHex?: number;
}

/**
 * Build a fade-to-black overlay. The plane sits in front of an orthographic
 * camera so it covers the entire framebuffer regardless of aspect ratio;
 * `PlaneGeometry(2, 2)` matches the camera's `[-1, 1]` x `[-1, 1]` clip
 * volume. The overlay opens at `opacity = 0` (fully transparent) and
 * `visible = false` so it renders no pixels until the host calls
 * `setOpacity` with a positive value.
 */
export function createFadeOverlay(
  options: CreateFadeOverlayOptions = {},
): FadeOverlay {
  const { colorHex = FADE_OVERLAY_COLOR_HEX } = options;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();

  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "fade-overlay";
  mesh.visible = false;
  scene.add(mesh);

  const setOpacity = (next: number): void => {
    // Treat non-finite inputs (NaN, Infinity) as 0 before clamping. The
    // host writes the per-tick opacity from a ramp computation that could
    // in principle produce a NaN if a divisor lands at zero; defaulting to
    // a fully-transparent overlay is the safer fallback.
    const safe = Number.isFinite(next) ? next : 0;
    const clamped = Math.max(0, Math.min(1, safe));
    material.opacity = clamped;
    mesh.visible = clamped > 0;
  };

  const render = (renderer: THREE.WebGLRenderer): void => {
    if (!mesh.visible) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = prevAutoClear;
  };

  const dispose = (): void => {
    geometry.dispose();
    material.dispose();
    scene.remove(mesh);
  };

  return {
    camera,
    scene,
    get opacity(): number {
      return material.opacity;
    },
    setOpacity,
    render,
    dispose,
  };
}
