import * as THREE from "three";

export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  /**
   * Subscribe to resize events. The callback fires immediately with the
   * canvas's current pixel-space dimensions and on every subsequent layout
   * change. Returns an unsubscribe function that removes the callback.
   * Used by the orthographic camera to re-fit the dollhouse frustum so
   * the room stays in frame on window resize and device rotation.
   */
  onResize: (cb: (width: number, height: number) => void) => () => void;
  /**
   * Disconnect the resize observer or window listener, clear all
   * subscribers, dispose the WebGL context, and remove the canvas from
   * its container. Call when tearing down the renderer (HMR, route
   * change, test cleanup) to release GPU memory and stop stale callbacks
   * from firing on a discarded renderer.
   */
  dispose: () => void;
}

/**
 * Creates the Three.js WebGL renderer attached to the supplied container.
 *
 * The renderer auto-resizes to the container's bounding box and sets the
 * device pixel ratio with a sane upper bound so high-DPI displays do not
 * blow out fragment shading cost. This stays decoupled from scene
 * construction so future slices can swap render passes (post-processing,
 * outline pass, etc.) without touching scene authoring code.
 */
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
  let observer: ResizeObserver | null = null;
  const onWindowResize = (): void => sizeRenderer();
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => sizeRenderer());
    observer.observe(container);
  } else {
    window.addEventListener("resize", onWindowResize);
  }

  const onResize = (
    cb: (width: number, height: number) => void,
  ): (() => void) => {
    subscribers.add(cb);
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    cb(width, height);
    return () => {
      subscribers.delete(cb);
    };
  };

  const dispose = (): void => {
    subscribers.clear();
    if (observer) {
      observer.disconnect();
      observer = null;
    } else {
      window.removeEventListener("resize", onWindowResize);
    }
    renderer.dispose();
    renderer.domElement.remove();
  };

  return { renderer, onResize, dispose };
}
