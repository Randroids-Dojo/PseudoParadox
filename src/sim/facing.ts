/**
 * Facing direction for the active player (REQ-036 partial).
 *
 * The throw mechanic (REQ-036) needs a direction to apply the impulse along.
 * The fixed isometric camera offers no mouse-aim path, so the dossier
 * specifies a facing heuristic based on the player's last non-zero planar
 * movement direction. This module ships:
 *
 *   - `DEFAULT_FACING`: world-axis north (`{ x: 0, z: -1 }`) per Q-007's
 *     default. Forward in the keyboard layer is `-z` (`src/input/keyboard.ts`),
 *     so a fresh player who has not moved yet faces "into the screen."
 *   - `createFacingTracker()`: a tiny mutable handle that caches the last
 *     non-zero facing. The host (`src/app.ts`) calls `update(velocity)`
 *     each fixed step. Zero-velocity ticks do not overwrite the cache, so
 *     a player who stops walking keeps facing the direction they were
 *     last walking.
 *   - `facingFromVelocity(velocity)`: pure helper that normalizes a planar
 *     velocity to a unit-length facing direction. Returns `null` for zero
 *     vectors so callers can decide whether to overwrite the cache or
 *     leave it.
 *
 * Determinism: the tracker's state is a per-tick deterministic function of
 * the supplied velocity sequence. The same recorded `KeyState` sequence
 * produces the same facing trajectory on replay (the recorded keys flow
 * through `inputToVelocity`, which produces the same planar velocity, which
 * produces the same facing). This is load-bearing for Q-009's "trust
 * Rapier's deterministic step" stance: identical inputs, identical facing,
 * identical thrown-body trajectory.
 *
 * NOT in scope this module:
 *   - Heading-aware movement (the input layer is still world-axis-aligned).
 *   - Camera yaw / pitch.
 *   - Per-instance facing for ghosts (ghosts do not throw in this slice;
 *     the recorder channel for throw IS replayed for ghosts, and the
 *     ghost's own facing tracker is fed from the same `replayAtTick`
 *     velocity each tick, but that wiring lives in the host).
 */

/** Planar (XZ) direction vector. Always unit length when produced by this
 * module's helpers; callers may pass non-unit input which the helpers
 * normalize. */
export interface Facing {
  readonly x: number;
  readonly z: number;
}

/**
 * Default facing before the player has moved (Q-007 default: north).
 * Matches the keyboard layer's "forward = -z" convention.
 */
export const DEFAULT_FACING: Facing = Object.freeze({ x: 0, z: -1 });

/**
 * Squared-magnitude threshold below which a velocity is treated as zero
 * for facing purposes. Below this the helper returns `null` and the
 * tracker's cache is preserved. The threshold is small enough that any
 * pressed-key velocity (`PLAYER_SPEED_MPS = 4`) far exceeds it, but tiny
 * residual jitter from the integrator does not creep through.
 */
const ZERO_VELOCITY_EPSILON_SQ = 1e-8;

/**
 * Pure helper: normalize a planar velocity to a unit facing. Returns
 * `null` if the velocity is below `ZERO_VELOCITY_EPSILON_SQ` (so callers
 * can leave the cached facing untouched on a stopped tick).
 */
export function facingFromVelocity(
  velocity: { readonly x: number; readonly z: number },
): Facing | null {
  const magSq = velocity.x * velocity.x + velocity.z * velocity.z;
  if (magSq < ZERO_VELOCITY_EPSILON_SQ) return null;
  const mag = Math.sqrt(magSq);
  return Object.freeze({ x: velocity.x / mag, z: velocity.z / mag });
}

/**
 * Mutable handle returned by `createFacingTracker`. The host updates it
 * once per fixed simulation step and reads `current` when resolving a
 * throw input.
 */
export interface FacingTracker {
  /** Last non-zero facing observed (or the default if none yet). */
  readonly current: Facing;
  /**
   * Advance the tracker with this tick's planar velocity. Non-zero input
   * overwrites the cache; zero input is a no-op. Total: any input shape
   * is safe.
   */
  update(velocity: { readonly x: number; readonly z: number }): void;
  /**
   * Reset the cache to `DEFAULT_FACING`. Used by hard reset (REQ-025) so
   * a freshly-reset player faces north until they move again, even if
   * they had been walking south at the moment of reset.
   */
  reset(): void;
}

/**
 * Build a fresh facing tracker. Defaults to `DEFAULT_FACING` (north).
 */
export function createFacingTracker(): FacingTracker {
  let cached: Facing = DEFAULT_FACING;
  return {
    get current(): Facing {
      return cached;
    },
    update(velocity): void {
      const next = facingFromVelocity(velocity);
      if (next !== null) cached = next;
    },
    reset(): void {
      cached = DEFAULT_FACING;
    },
  };
}
