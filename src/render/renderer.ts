import * as THREE from "three";

/**
 * Creates the Three.js WebGL renderer attached to the supplied container.
 *
 * The renderer auto-resizes to the container's bounding box and sets the
 * device pixel ratio with a sane upper bound so high-DPI displays do not
 * blow out fragment shading cost. This stays decoupled from scene
 * construction so future slices can swap render passes (post-processing,
 * outline pass, etc.) without touching scene authoring code.
 */
export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  /**
   * Subscribe to resize events. The callback receives the canvas's current
   * pixel-space dimensions immediately on subscription and on every
   * subsequent layout change. Used by the orthographic camera to re-fit
   * the dollhouse frustum so the room stays in frame on window resize and
   * device rotation.
   */
  onResize: (cb: (width: number, height: number) => void) => void;
}

export function createRenderer(container: HTMLElement): RendererHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const subscribers = new Set<(w: number, h: number) => void>();

  const sizeRenderer = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    // updateStyle=true (the default): write the canvas CSS size as well as
    // its buffer size. With updateStyle=false the canvas had no inline
    // style and rendered at its raw pixel buffer size, which on a HiDPI
    // display is 2x the viewport, leaving the framed scene confined to
    // the upper-left quadrant.
    renderer.setSize(width, height, true);
    for (const cb of subscribers) cb(width, height);
  };

  sizeRenderer();
  container.appendChild(renderer.domElement);

  // Use ResizeObserver where available so embedding the canvas in flex/grid
  // layouts still produces correct sizing without listening to global resize.
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => sizeRenderer());
    observer.observe(container);
  } else {
    window.addEventListener("resize", sizeRenderer);
  }

  const onResize = (cb: (width: number, height: number) => void): void => {
    subscribers.add(cb);
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    cb(width, height);
  };

  return { renderer, onResize };
}
