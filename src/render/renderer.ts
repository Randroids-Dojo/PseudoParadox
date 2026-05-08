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
export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const sizeRenderer = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
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

  return renderer;
}
