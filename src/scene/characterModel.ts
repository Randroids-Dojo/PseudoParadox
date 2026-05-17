import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * Cached character GLB pipeline.
 *
 * The active player and every ghost share one source GLB (a chunky Kenney
 * Mini Characters figurine, CC0). The host preloads it once during boot
 * (`preloadCharacterModel`) and the synchronous mesh factories in
 * `astronaut.ts` / `ghostInstance.ts` clone it on demand via
 * `cloneCharacterModel`. If no preload happened (Vitest in-process tests
 * never touch the renderer, never call `startApp`), the factories fall
 * back to the procedural capsule path so existing tests stay sync.
 *
 * Skinned-mesh cloning: a plain `Object3D.clone()` does not rebind a
 * `SkinnedMesh` to a cloned skeleton, so the clone's bones still point at
 * the original (untransformed) skeleton root and the body stays glued to
 * world origin even when the parent mesh moves. `SkeletonUtils.clone`
 * (from three/examples) handles the rebind, which is why ghosts and the
 * player visually follow their physics bodies again.
 *
 * Per-clone materials are deep-cloned so `applyInstanceTint` on one
 * instance does not leak its tint into other instances that share the
 * same source material.
 */

let cachedScene: THREE.Group | null = null;
let cachedAnimations: THREE.AnimationClip[] = [];
let preloadPromise: Promise<void> | null = null;

export const CHARACTER_MODEL_URL = "/models/character-male-a.glb";

/**
 * Tuned so the GLB's footprint aligns with the existing player capsule
 * (`PLAYER_CAPSULE`: radius 0.4, cylinderLength 1.0, total height 1.8).
 * The Kenney figurine ships pivoted at the feet with y range roughly
 * [0, 0.67]. Scaling by `scale` and offsetting by `yOffset` in mesh-local
 * lands the feet on the floor when the parent mesh sits at the capsule's
 * resting center (y = 0.9 in world).
 */
export const CHARACTER_MODEL_TRANSFORM = {
  scale: 2.5,
  yOffset: -0.9,
} as const;

/** Below this planar speed the figure plays idle instead of walk. */
export const WALK_ANIM_SPEED_THRESHOLD = 0.2;
/** Cross-fade duration between idle and walk, in seconds. */
const CLIP_FADE_SECONDS = 0.12;
/**
 * How fast the figure yaws toward its travel direction, in radians per
 * second. Tuned snappy so the turn lands before the player crosses the
 * room but not so snappy that it visually snaps. The lerp is applied on
 * the parent mesh's `rotation.y`, not the rigid body, because facing is
 * a purely visual concern: physics is yaw-locked, the sim does not read
 * the mesh rotation, and ghost replay determinism is unaffected because
 * the facing is recomputed each frame from the body's current linvel.
 */
const TURN_SPEED_RAD_PER_SEC = 14;

export interface CharacterAnimator {
  /** Switch to the named clip, cross-fading from the current one. */
  play(clipName: string): void;
  /** Currently-active clip name, or null before the first play() call. */
  current(): string | null;
  /** Advance the mixer by `deltaSeconds`. Call once per render frame. */
  update(deltaSeconds: number): void;
}

export interface CharacterModelClone {
  object: THREE.Object3D;
  animator: CharacterAnimator;
}

export function preloadCharacterModel(
  url: string = CHARACTER_MODEL_URL,
): Promise<void> {
  if (preloadPromise) return preloadPromise;
  const loader = new GLTFLoader();
  preloadPromise = new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        cachedScene = gltf.scene;
        cachedAnimations = gltf.animations ?? [];
        resolve();
      },
      undefined,
      (err) => {
        preloadPromise = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
  return preloadPromise;
}

export function getCachedCharacterModel(): THREE.Group | null {
  return cachedScene;
}

/**
 * Deep-clone the cached scene with per-instance materials AND per-instance
 * skeleton bindings, then attach a fresh `AnimationMixer` bound to the new
 * subtree. Returns `null` when no preload has resolved yet, signaling the
 * caller to use the procedural fallback.
 */
export function cloneCharacterModel(): CharacterModelClone | null {
  if (!cachedScene) return null;
  const cloned = cloneSkinned(cachedScene);
  cloned.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map((m) => m.clone());
      } else {
        obj.material = obj.material.clone();
      }
    }
  });
  cloned.scale.setScalar(CHARACTER_MODEL_TRANSFORM.scale);
  cloned.position.y = CHARACTER_MODEL_TRANSFORM.yOffset;
  cloned.name = "character-figure";

  const mixer = new THREE.AnimationMixer(cloned);
  const clipMap = new Map<string, THREE.AnimationAction>();
  for (const clip of cachedAnimations) {
    clipMap.set(clip.name, mixer.clipAction(clip));
  }
  let currentName: string | null = null;
  const animator: CharacterAnimator = {
    play(clipName: string): void {
      if (currentName === clipName) return;
      const next = clipMap.get(clipName);
      if (!next) return;
      next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
      next.fadeIn(CLIP_FADE_SECONDS).play();
      if (currentName !== null) {
        const prev = clipMap.get(currentName);
        if (prev) prev.fadeOut(CLIP_FADE_SECONDS);
      }
      currentName = clipName;
    },
    current(): string | null {
      return currentName;
    },
    update(deltaSeconds: number): void {
      mixer.update(deltaSeconds);
    },
  };

  return { object: cloned, animator };
}

/**
 * Per-frame helper: pick `idle` vs `walk` from the body's planar linear
 * velocity, then advance the mesh's animator. No-op when the mesh was
 * built through the procedural fallback (no animator attached).
 */
export interface AnimatedCharacter {
  mesh: THREE.Object3D;
  body: { linvel(): { x: number; y: number; z: number } };
}

export function updateCharacterAnimation(
  character: AnimatedCharacter,
  deltaSeconds: number,
): void {
  const animator = character.mesh.userData.characterAnimator as
    | CharacterAnimator
    | undefined;
  if (!animator) return;
  const v = character.body.linvel();
  const planarSpeed = Math.hypot(v.x, v.z);
  animator.play(
    planarSpeed >= WALK_ANIM_SPEED_THRESHOLD ? "walk" : "idle",
  );
  // Face the travel direction. Only update the target when the body is
  // actually moving; freezing the last-known facing while idle keeps the
  // figure from snapping back to a default yaw on release.
  if (planarSpeed >= WALK_ANIM_SPEED_THRESHOLD) {
    const targetYaw = Math.atan2(v.x, v.z);
    const current = character.mesh.rotation.y;
    let diff = targetYaw - current;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const maxStep = TURN_SPEED_RAD_PER_SEC * deltaSeconds;
    const step = Math.max(-maxStep, Math.min(maxStep, diff));
    character.mesh.rotation.y = current + step;
  }
  animator.update(deltaSeconds);
}

/** Test-only reset hook. Clears the cache so a fresh preload can be issued. */
export function __resetCharacterModelCacheForTest(): void {
  cachedScene = null;
  cachedAnimations = [];
  preloadPromise = null;
}
