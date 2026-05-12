/**
 * Camera pan / zoom gestures (F-010).
 *
 * The prototype's orthographic dollhouse camera is fixed by default: a
 * high 3/4 vantage looking down at the room origin with a contain-fit
 * frustum (`src/scene/scene.ts`). This module layers two interactive
 * gestures on top:
 *
 * - **Zoom** via mouse wheel (desktop) or two-finger pinch (mobile).
 *   Scales `camera.zoom` exponentially, clamped to `[ZOOM_MIN, ZOOM_MAX]`.
 * - **Pan** via right-click drag (desktop) or two-finger drag (mobile).
 *   Shifts both `camera.position` and the look target by a planar XZ
 *   delta, clamped so the look target stays within `+/- PAN_LIMIT_M`
 *   of the room center. Left-click drag is intentionally NOT bound so
 *   future UI (click-to-move, area selection) can claim it.
 *
 * The pan offset is reified as an XZ delta that's added to the camera's
 * INITIAL position and INITIAL look target so the dollhouse angle is
 * preserved during pan. Zoom uses Three.js's built-in
 * `OrthographicCamera.zoom` scalar; the contain-fit frustum from
 * `scene.ts` continues to drive the projection bounds.
 *
 * Design knobs are anchored in code constants so a future tuning slice
 * can flip them without touching the data flow. The chosen defaults
 * came from the F-010 design pass:
 *
 *   - Zoom range: 0.5x to 3x.
 *   - Desktop pan: right-click drag (context menu suppressed on the
 *     gesture-bound element).
 *   - Pan bounds: room half-width (`PAN_LIMIT_M = 5`).
 */

import * as THREE from "three";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const PAN_LIMIT_M = 5;

/**
 * Exponential zoom factor per pixel of wheel deltaY. A typical
 * one-notch wheel tick produces ~100 px of deltaY; at 1.0015 per pixel
 * that maps to a ~1.16x zoom step, which feels like one "notch" of
 * zoom per mouse wheel detent. Negative deltaY (scroll up) zooms in.
 */
export const WHEEL_ZOOM_PER_PIXEL = 1.0015;

export interface CameraGesturesHandle {
  /** Remove every listener and the context-menu suppression. */
  dispose: () => void;
}

export interface CameraGesturesOptions {
  /**
   * Element to bind listeners on. The container holding the WebGL
   * canvas is the natural choice; events outside the canvas are
   * ignored.
   */
  container: HTMLElement;
  /** The camera whose `zoom`, `position`, and `lookAt` are mutated. */
  camera: THREE.OrthographicCamera;
}

/**
 * Clamp a numeric value to a closed range.
 */
const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

/**
 * Compute the new zoom level after a multiplicative scale. Caller
 * supplies the previous zoom and the scale factor; the result is
 * clamped to the configured range.
 */
export function applyZoomScale(
  previousZoom: number,
  scale: number,
): number {
  return clamp(previousZoom * scale, ZOOM_MIN, ZOOM_MAX);
}

/**
 * Compute the new pan offset after an XZ delta in world units. The
 * resulting offset is clamped so the look target (which sits at
 * `origin + offset`) stays within `+/- PAN_LIMIT_M` of the room center.
 */
export function applyPanDelta(
  previousX: number,
  previousZ: number,
  deltaX: number,
  deltaZ: number,
): { x: number; z: number } {
  return {
    x: clamp(previousX + deltaX, -PAN_LIMIT_M, PAN_LIMIT_M),
    z: clamp(previousZ + deltaZ, -PAN_LIMIT_M, PAN_LIMIT_M),
  };
}

/**
 * Translate a screen-pixel drag delta into a world-space XZ delta for
 * an orthographic camera with the given frustum and zoom. The
 * dollhouse vantage in `scene.ts` looks down at the XZ plane, so
 * screen X maps directly to world X and screen Y maps to world Z
 * (negated: dragging the cursor toward the bottom of the screen pulls
 * the world toward the top, which means panning in +Z).
 *
 * The sign convention is "drag pulls the world": dragging right
 * (positive deltaPx.x) moves the world view right, which means
 * shifting the look target in the -X direction (camera moves +X).
 * Returning negative deltas implements this.
 */
export function screenDragToWorldPan(
  deltaPxX: number,
  deltaPxY: number,
  frustum: { left: number; right: number; top: number; bottom: number },
  canvasSize: { width: number; height: number },
  zoom: number,
): { x: number; z: number } {
  const worldWidth = (frustum.right - frustum.left) / zoom;
  const worldHeight = (frustum.top - frustum.bottom) / zoom;
  const pxToWorldX = worldWidth / Math.max(canvasSize.width, 1);
  const pxToWorldZ = worldHeight / Math.max(canvasSize.height, 1);
  // Drag right (positive deltaPxX) -> world view scrolls right ->
  // look target shifts left (-X). Drag down (positive deltaPxY) ->
  // world view scrolls down -> look target shifts toward -Z (the
  // dollhouse vantage has the camera at +Z so "toward the top of the
  // screen" is -Z in world space; dragging down inverts that).
  // `0 - x` (instead of `-x`) keeps zero positive so callers using
  // strict equality / Object.is do not see `-0` for zero deltas.
  return {
    x: 0 - deltaPxX * pxToWorldX,
    z: 0 - deltaPxY * pxToWorldZ,
  };
}

/**
 * Mounts wheel + right-drag (desktop) and pinch + two-finger-drag
 * (mobile) gestures on `container`. Mutates `camera.zoom`,
 * `camera.position`, and the look target in place. Returns a
 * `dispose` for teardown.
 */
export function attachCameraGestures(
  options: CameraGesturesOptions,
): CameraGesturesHandle {
  const { container, camera } = options;

  // Capture the camera's initial pose so pan is computed against a
  // stable anchor. The dollhouse vantage is restored when the user
  // pans back to (0, 0) and the relative camera-to-target offset is
  // preserved at every pan.
  const initialPosition = camera.position.clone();
  const initialTarget = new THREE.Vector3(0, camera.position.y * 0.05, 0);
  // The lookAt target is anchored on the floor at the camera's
  // calibration point. `scene.ts` uses `(0, height*0.25, 0)`; we
  // re-derive it from camera.position.y instead of duplicating the
  // constant, so a future scene tweak does not desync this module.
  // `height * 0.25 = (height * 5.0 / 20)` when y is `height * 5.0`,
  // hence `position.y * 0.05`. The exact value is not load-bearing;
  // any constant offset above the floor produces the same dollhouse
  // tilt.

  let panOffsetX = 0;
  let panOffsetZ = 0;

  const updateCameraPose = (): void => {
    camera.position.set(
      initialPosition.x - panOffsetX,
      initialPosition.y,
      initialPosition.z - panOffsetZ,
    );
    camera.lookAt(
      initialTarget.x - panOffsetX,
      initialTarget.y,
      initialTarget.z - panOffsetZ,
    );
    // Pan does not change `zoom`; only the projection's bounds shift
    // implicitly through lookAt. Updating the projection matrix is
    // still required for the zoom path to take effect, so we update
    // both consistently here.
    camera.updateProjectionMatrix();
  };

  const getCanvasSize = (): { width: number; height: number } => ({
    width: container.clientWidth || 1,
    height: container.clientHeight || 1,
  });

  // ---------------------- Wheel zoom (desktop) ----------------------
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Scroll up (negative deltaY) zooms in. Map every pixel of
    // deltaY to an exponential zoom factor so smooth-scroll wheels
    // feel continuous and discrete wheels still produce clear notches.
    const factor = WHEEL_ZOOM_PER_PIXEL ** -event.deltaY;
    camera.zoom = applyZoomScale(camera.zoom, factor);
    camera.updateProjectionMatrix();
  };

  // -------------------- Right-drag pan (desktop) --------------------
  let rightDragLastX = 0;
  let rightDragLastY = 0;
  let rightDragging = false;

  const onPointerDownPan = (event: PointerEvent): void => {
    // Right-button is button=2; ignore everything else so left-click
    // is free for future UI bindings.
    if (event.button !== 2) return;
    if (event.pointerType === "touch") return;
    rightDragging = true;
    rightDragLastX = event.clientX;
    rightDragLastY = event.clientY;
    container.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMovePan = (event: PointerEvent): void => {
    if (!rightDragging) return;
    if (event.pointerType === "touch") return;
    const dxPx = event.clientX - rightDragLastX;
    const dyPx = event.clientY - rightDragLastY;
    rightDragLastX = event.clientX;
    rightDragLastY = event.clientY;
    const worldDelta = screenDragToWorldPan(
      dxPx,
      dyPx,
      {
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
      },
      getCanvasSize(),
      camera.zoom,
    );
    const next = applyPanDelta(
      panOffsetX,
      panOffsetZ,
      worldDelta.x,
      worldDelta.z,
    );
    panOffsetX = next.x;
    panOffsetZ = next.z;
    updateCameraPose();
  };
  const onPointerUpPan = (event: PointerEvent): void => {
    if (!rightDragging) return;
    if (event.pointerType === "touch") return;
    rightDragging = false;
    if (container.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }
  };

  // Suppress the right-click context menu on the gesture-bound
  // element so the right-drag pan does not race with the browser
  // menu. The menu is still available on every other DOM element
  // outside the canvas.
  const onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  // -------- Touch pinch zoom + two-finger pan (mobile) --------
  // The joystick (`src/input/touch.ts`) claims the FIRST touch
  // pointer via `beginJoystick(pointerId)`. The camera gestures only
  // engage when TWO touch pointers are active so single-finger touch
  // remains the joystick.
  interface TrackedTouch {
    id: number;
    x: number;
    y: number;
  }
  const activeTouches = new Map<number, TrackedTouch>();
  let pinchInitialDistance = 0;
  let pinchInitialZoom = camera.zoom;
  let pinchInitialMidX = 0;
  let pinchInitialMidY = 0;
  let pinchInitialPanX = 0;
  let pinchInitialPanZ = 0;

  const beginPinch = (): void => {
    const [a, b] = [...activeTouches.values()];
    if (!a || !b) return;
    pinchInitialDistance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    pinchInitialZoom = camera.zoom;
    pinchInitialMidX = (a.x + b.x) / 2;
    pinchInitialMidY = (a.y + b.y) / 2;
    pinchInitialPanX = panOffsetX;
    pinchInitialPanZ = panOffsetZ;
  };

  const updatePinch = (): void => {
    const [a, b] = [...activeTouches.values()];
    if (!a || !b) return;
    const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const scale = distance / pinchInitialDistance;
    camera.zoom = applyZoomScale(pinchInitialZoom, scale);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dxPx = midX - pinchInitialMidX;
    const dyPx = midY - pinchInitialMidY;
    const worldDelta = screenDragToWorldPan(
      dxPx,
      dyPx,
      {
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
      },
      getCanvasSize(),
      camera.zoom,
    );
    const next = applyPanDelta(
      pinchInitialPanX,
      pinchInitialPanZ,
      worldDelta.x,
      worldDelta.z,
    );
    panOffsetX = next.x;
    panOffsetZ = next.z;
    updateCameraPose();
  };

  const onPointerDownTouch = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    activeTouches.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    if (activeTouches.size === 2) {
      beginPinch();
      event.preventDefault();
    }
  };
  const onPointerMoveTouch = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    const tracked = activeTouches.get(event.pointerId);
    if (!tracked) return;
    tracked.x = event.clientX;
    tracked.y = event.clientY;
    if (activeTouches.size >= 2) {
      updatePinch();
      event.preventDefault();
    }
  };
  const onPointerUpTouch = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    if (!activeTouches.delete(event.pointerId)) return;
    // Dropping to 1 finger ends the pinch; the remaining finger
    // does not resume the joystick (the joystick was never
    // active for the pinch's pointer-ids).
  };

  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("pointerdown", onPointerDownPan);
  container.addEventListener("pointermove", onPointerMovePan);
  container.addEventListener("pointerup", onPointerUpPan);
  container.addEventListener("pointercancel", onPointerUpPan);
  container.addEventListener("pointerdown", onPointerDownTouch);
  container.addEventListener("pointermove", onPointerMoveTouch);
  container.addEventListener("pointerup", onPointerUpTouch);
  container.addEventListener("pointercancel", onPointerUpTouch);
  container.addEventListener("contextmenu", onContextMenu);

  const dispose = (): void => {
    container.removeEventListener("wheel", onWheel);
    container.removeEventListener("pointerdown", onPointerDownPan);
    container.removeEventListener("pointermove", onPointerMovePan);
    container.removeEventListener("pointerup", onPointerUpPan);
    container.removeEventListener("pointercancel", onPointerUpPan);
    container.removeEventListener("pointerdown", onPointerDownTouch);
    container.removeEventListener("pointermove", onPointerMoveTouch);
    container.removeEventListener("pointerup", onPointerUpTouch);
    container.removeEventListener("pointercancel", onPointerUpTouch);
    container.removeEventListener("contextmenu", onContextMenu);
  };

  return { dispose };
}
