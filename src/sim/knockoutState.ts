/**
 * Per-instance consciousness state machine (REQ-033 partial).
 *
 * Each player or ghost instance carries a `Consciousness` flag with two
 * states: `'conscious'` (default) and `'unconscious'`. A punch that lands on
 * a conscious instance flips it to unconscious. The reverse transition does
 * not exist in the prototype scope per `docs/gdd/03-story-acts-1-3.md`
 * Failure recovery: there is no auto-rewind, only hard reset.
 *
 * This module is the data half of the knockout system. The body response
 * (bump impulse, damping reduction, rotation lock relaxation, the visible
 * "tipped over" pose) lands in the next slice (REQ-033 finishing pass) per
 * `docs/gdd/30-combat-and-interaction.md` section 4. While unconscious in
 * this slice, the visual capsule still stands upright; the only observable
 * change is that input is suppressed (active player) or the recorded punch
 * flag is suppressed (ghost).
 *
 * NOT in scope this slice:
 *   - Bump impulse, damping change, rotation lock relaxation.
 *   - A `recovery` transition. Hard reset is the only path back to conscious
 *     (handled in `src/sim/hardReset.ts`).
 *   - Multi-state animation flags. The flag is binary on purpose.
 */

/** Two-state consciousness flag. Default is `'conscious'`. */
export type Consciousness = "conscious" | "unconscious";

/** Default state for a freshly-spawned instance. */
export const INITIAL_CONSCIOUSNESS: Consciousness = "conscious";

/**
 * Pure helper: returns `'unconscious'`. Idempotent on an already-unconscious
 * input (returns the same `'unconscious'`). The function takes the current
 * state as an argument and is `total`: any defined `Consciousness` returns
 * `'unconscious'`. The argument is kept so future variants (a recovery
 * transition, a stunned intermediate) can branch without breaking callers.
 */
export function applyKnockout(_state: Consciousness): Consciousness {
  return "unconscious";
}

/**
 * Pure predicate: an instance can act on its inputs (movement, punch) iff
 * it is conscious. An unconscious instance has its inputs suppressed before
 * the per-tick punch resolver runs (see `src/sim/punch.ts`). The active
 * player's movement is also gated by this predicate in `src/app.ts`.
 */
export function isConscious(state: Consciousness): boolean {
  return state === "conscious";
}
