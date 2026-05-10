import * as THREE from "three";
import { ROOM_DIMENSIONS, buildRoom } from "./room.ts";
import type { Portal } from "../sim/portal.ts";

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  portals: readonly Portal[];
  resizeCamera: (canvasWidth: number, canvasHeight: number) => void;
}

/**
 * Base world-space rect that the orthographic camera must contain at zoom 1.
 *
 * The room is 10x10x4. Viewed from a 3/4 dollhouse vantage the projected
 * footprint is roughly the room's diagonal in width and the depth+height
 * combination in vertical extent. These constants pad that with a small
 * margin so the room never sits flush against the canvas edges. The
 * frustum is then expanded along whichever axis the canvas is larger on,
 * so the room stays fully visible regardless of aspect ratio.
 */
const BASE_WORLD_WIDTH = 16;
const BASE_WORLD_HEIGHT = 12;

/**
 * Computes the orthographic frustum that contains a worldW x worldH rect
 * inside a canvasW x canvasH viewport, expanding (never cropping) along
 * the larger canvas axis. Pattern lifted from mi-casa-es-su-casa's
 * dollhouse renderer.
 */
function computeFrustum(
  canvasWidth: number,
  canvasHeight: number,
  worldWidth: number,
  worldHeight: number,
): { left: number; right: number; top: number; bottom: number } {
  const screenAspect = canvasWidth / Math.max(canvasHeight, 1);
  const worldAspect = worldWidth / worldHeight;
  let halfW: number;
  let halfH: number;
  if (screenAspect >= worldAspect) {
    halfH = worldHeight / 2;
    halfW = halfH * screenAspect;
  } else {
    halfW = worldWidth / 2;
    halfH = halfW / screenAspect;
  }
  return { left: -halfW, right: halfW, top: halfH, bottom: -halfH };
}

/**
 * Builds the placeholder scene used by the prototype shell.
 *
 * Camera is orthographic with a contain-fit frustum so the entire room is
 * always visible regardless of the canvas aspect ratio. The vantage is a
 * 3/4 dollhouse angle: lifted high and back so the floor, three walls,
 * and the four doors are all in frame. Resizing the canvas calls
 * `resizeCamera` to re-fit the frustum without changing the camera's
 * world-space pose.
 */
export function buildScene(): SceneContext {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101418);

  const room = buildRoom();
  scene.add(room.group);

  const hemi = new THREE.HemisphereLight(0xb1c5ff, 0x202020, 0.6);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(4, 8, 6);
  scene.add(key);

  const { width, depth, height } = ROOM_DIMENSIONS;

  // Initial frustum is a unit box; resizeCamera below re-fits it. The near
  // plane is small and the far plane large enough to clear the camera's
  // distance from the room (~25 units away in world space).
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

  // Dollhouse 3/4 vantage. Camera sits high and back so we see the floor,
  // three walls, and the door silhouettes. Distance does not affect the
  // image scale under orthographic projection, only the frustum bounds do,
  // so we choose a distance that keeps the room comfortably inside near/far.
  camera.position.set(width * 1.4, height * 2.2, depth * 1.4);
  camera.lookAt(0, height * 0.4, 0);

  const resizeCamera = (canvasWidth: number, canvasHeight: number): void => {
    const f = computeFrustum(
      canvasWidth,
      canvasHeight,
      BASE_WORLD_WIDTH,
      BASE_WORLD_HEIGHT,
    );
    camera.left = f.left;
    camera.right = f.right;
    camera.top = f.top;
    camera.bottom = f.bottom;
    camera.updateProjectionMatrix();
  };

  // Initial framing against the current window. The renderer also calls
  // resizeCamera on every layout change so the framing stays correct on
  // window resize and device rotation.
  resizeCamera(
    typeof window !== "undefined" ? window.innerWidth : 1,
    typeof window !== "undefined" ? window.innerHeight : 1,
  );

  return { scene, camera, portals: room.portals, resizeCamera };
}
