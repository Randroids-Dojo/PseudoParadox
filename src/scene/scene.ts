import * as THREE from "three";
import { ROOM_DIMENSIONS, buildRoom } from "./room.ts";

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

/**
 * Builds the placeholder scene used by the prototype shell.
 *
 * This slice intentionally avoids modeling doors, the player, or instance
 * tints. Those land in their own slices keyed to specific REQ rows
 * (REQ-026 player spawn, REQ-027 four doors, REQ-029 room color tint).
 * What lands here is the empty-room volume, a hemisphere fill light, a
 * directional key light, and a fixed isometric-ish camera so future slices
 * have a stable visual reference to author against.
 */
export function buildScene(): SceneContext {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101418);

  const room = buildRoom();
  scene.add(room);

  const hemi = new THREE.HemisphereLight(0xb1c5ff, 0x202020, 0.6);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(4, 8, 6);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(
    50,
    1,
    0.1,
    100,
  );
  // Lift the camera high and back so the whole room is in frame at startup.
  // Future camera-system slices replace this with the real prototype rig.
  const { width, depth } = ROOM_DIMENSIONS;
  camera.position.set(width * 0.9, 9, depth * 0.9);
  camera.lookAt(0, 1, 0);

  return { scene, camera };
}
