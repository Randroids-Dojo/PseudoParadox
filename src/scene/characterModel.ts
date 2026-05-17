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
  /**
   * Switch to the named looping clip, cross-fading from the current one.
   * Ignored while a one-shot is active (the one-shot has priority until
   * its clip duration elapses).
   */
  play(clipName: string): void;
  /**
   * Play a non-looping clip once. Supersedes `play` until the clip's
   * duration elapses, after which the next `play` call resumes the
   * caller's chosen base clip. Use for transient actions (punch swing,
   * pickup gesture).
   */
  triggerOneShot(clipName: string): void;
  /** Currently-active clip name, or null before the first play() call. */
  current(): string | null;
  /** Advance the mixer by `deltaSeconds`. Call once per render frame. */
  update(deltaSeconds: number): void;
}

/** Per-instance gameplay state needed to pick a clip. */
export interface CharacterAnimationState {
  consciousness: "conscious" | "unconscious";
  carrying: boolean;
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
  const clipMap = new Map<
    string,
    { action: THREE.AnimationAction; duration: number }
  >();
  for (const clip of cachedAnimations) {
    clipMap.set(clip.name, {
      action: mixer.clipAction(clip),
      duration: clip.duration,
    });
  }
  let currentName: string | null = null;
  let oneShotName: string | null = null;
  let oneShotRemainingSeconds = 0;

  const doPlay = (
    clipName: string,
    loopOnce: boolean,
    forceRestart = false,
  ): void => {
    // `forceRestart` lets `triggerOneShot` re-trigger the same clip from
    // tick zero. Without it, a second punch while the swing's end pose
    // is clamped would extend the lockout but never replay the action,
    // leaving the figure stuck at the swing's final frame.
    if (!forceRestart && currentName === clipName) return;
    const next = clipMap.get(clipName);
    if (!next) return;
    next.action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
    if (loopOnce) {
      next.action.setLoop(THREE.LoopOnce, 1);
      next.action.clampWhenFinished = true;
    } else {
      next.action.setLoop(THREE.LoopRepeat, Infinity);
      next.action.clampWhenFinished = false;
    }
    next.action.fadeIn(CLIP_FADE_SECONDS).play();
    if (currentName !== null) {
      const prev = clipMap.get(currentName);
      if (prev) prev.action.fadeOut(CLIP_FADE_SECONDS);
    }
    currentName = clipName;
  };

  const animator: CharacterAnimator = {
    play(clipName: string): void {
      // One-shots own the clip until they elapse. Locking out base
      // updates while a punch swing plays keeps the swing visible even
      // if locomotion would otherwise fight for the slot every frame.
      if (oneShotName !== null) return;
      doPlay(clipName, false);
    },
    triggerOneShot(clipName: string): void {
      const entry = clipMap.get(clipName);
      if (!entry) return;
      oneShotName = clipName;
      oneShotRemainingSeconds = entry.duration;
      doPlay(clipName, true, true);
    },
    current(): string | null {
      return currentName;
    },
    update(deltaSeconds: number): void {
      if (oneShotName !== null) {
        oneShotRemainingSeconds -= deltaSeconds;
        if (oneShotRemainingSeconds <= 0) {
          oneShotName = null;
        }
      }
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
  state: CharacterAnimationState,
  deltaSeconds: number,
): void {
  const animator = character.mesh.userData.characterAnimator as
    | CharacterAnimator
    | undefined;
  if (!animator) return;
  const v = character.body.linvel();
  const planarSpeed = Math.hypot(v.x, v.z);
  // Priority: unconscious freezes everything else, carry beats locomotion
  // (the figurine glides while carrying because we are not yet blending
  // a walk-bottom-half layer with the holding-arms clip), then locomotion.
  let clipName: string;
  if (state.consciousness === "unconscious") {
    clipName = "die";
  } else if (state.carrying) {
    clipName = "holding-both";
  } else if (planarSpeed >= WALK_ANIM_SPEED_THRESHOLD) {
    clipName = "walk";
  } else {
    clipName = "idle";
  }
  animator.play(clipName);
  // Face the travel direction. Only update the target when the body is
  // conscious and actually moving; freezing the last-known facing keeps
  // the figure from snapping back to a default yaw on release or after
  // a knockout.
  if (
    state.consciousness === "conscious" &&
    planarSpeed >= WALK_ANIM_SPEED_THRESHOLD
  ) {
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

/**
 * One-shot punch swing. Plays `attack-melee-right` once and reverts to
 * the priority clip from `updateCharacterAnimation` when the swing ends.
 * Safe to call when the figure is using the procedural-capsule fallback
 * (no-op when no animator is attached).
 */
export function triggerPunchAnimation(character: AnimatedCharacter): void {
  const animator = character.mesh.userData.characterAnimator as
    | CharacterAnimator
    | undefined;
  if (!animator) return;
  animator.triggerOneShot("attack-melee-right");
}

/** Test-only reset hook. Clears the cache so a fresh preload can be issued. */
export function __resetCharacterModelCacheForTest(): void {
  cachedScene = null;
  cachedAnimations = [];
  preloadPromise = null;
}
