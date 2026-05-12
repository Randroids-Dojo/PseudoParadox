/**
 * Punch hit detection and per-tick punch resolver (REQ-033 partial).
 *
 * Pure helpers, no Rapier mutation. The host (`src/app.ts`) projects each
 * instance's body translation to XZ before calling, so the resolver knows
 * nothing about Rapier or Three.js.
 *
 * The dossier (`docs/gdd/30-combat-and-interaction.md` section 4) defines:
 *   - Default punch range: 1.2 m planar XZ distance (Q-003 default).
 *   - Hit detection: capsule-vs-capsule proximity at the moment of the
 *     punch input. No direction filter.
 *   - Multiple targets in range: punch hits the SINGLE closest target.
 *     Tie-break: smallest `instanceId`. Documented as the deterministic
 *     rule so test fixtures can pin it.
 *   - An unconscious attacker cannot punch: callers MUST suppress the
 *     punch flag before calling `resolvePunches` (see `suppressUnconsciousPunches`).
 *   - A punch against an already-unconscious target is a no-op: the
 *     resolver filters unconscious targets out of the candidate set.
 *   - Simultaneous mutual punches: if A is in range of B AND B is in range
 *     of A AND both punched on the same tick, BOTH go down. The resolver
 *     produces a list of (attacker, target) pairs and applies the knockouts
 *     atomically against the input snapshot, so reading attacker A's
 *     consciousness while resolving B's punch sees the pre-tick state.
 */

import type { Consciousness } from "./knockoutState.ts";
import type { Position2D } from "./position.ts";

/**
 * Default punch range in meters (Q-003 default). Roughly the diameter of
 * one player capsule plus a small contact margin, so the puncher and
 * recipient stand "in arm's reach" without their colliders overlapping.
 */
export const PUNCH_RANGE_M = 1.2;

/**
 * One instance's snapshot at the moment of resolution. The resolver does
 * not need a Rapier body or a Three.js mesh; it works against this
 * minimal projection. The host fills it in once per tick before calling
 * `resolvePunches`.
 */
export interface PunchActor {
  /** Stable identifier (positive monotonic integer). Used as the
   * tie-break for the closest-target rule (smallest id wins on ties) and
   * as the key the resolver returns its (attacker, target) pairs by. */
  readonly id: number;
  /** Planar XZ position of the body's translation at the resolve tick. */
  readonly position: Position2D;
  /** Whether the actor pressed the punch input this tick. Callers MUST
   * pass `false` for any actor whose `consciousness` is `'unconscious'`;
   * `suppressUnconsciousPunches` is the canonical helper. */
  readonly punching: boolean;
  /** Pre-tick consciousness state. Used to filter unconscious targets out
   * of the candidate set (a punch against an already-unconscious body is
   * a no-op per the dossier). */
  readonly consciousness: Consciousness;
}

/**
 * One resolved knockout this tick. The host applies these by flipping
 * each `targetId`'s `Consciousness` to `'unconscious'`. The pair shape
 * preserves the attacker for future logging or audio hooks.
 */
export interface PunchResolution {
  readonly attackerId: number;
  readonly targetId: number;
}

/**
 * Suppress the `punching` flag on every unconscious actor. The dossier
 * specifies that an unconscious attacker cannot punch even if its
 * recording still has the punch flag set at this tick; the canonical way
 * to enforce that is to flip the flag false before calling
 * `resolvePunches`. Returns a fresh array; the input is not mutated.
 */
export function suppressUnconsciousPunches(
  actors: readonly PunchActor[],
): PunchActor[] {
  return actors.map((a) =>
    a.consciousness === "unconscious" && a.punching
      ? { ...a, punching: false }
      : a,
  );
}

/**
 * Per-tick punch resolver. Given a snapshot of every instance's id,
 * position, punch flag, and consciousness, returns the list of
 * (attacker, target) pairs that knock out a target this tick.
 *
 * Rules (from `docs/gdd/30-combat-and-interaction.md` section 4):
 *   - Only `consciousness === 'conscious'` actors with `punching === true`
 *     are considered as attackers. Callers SHOULD have already passed
 *     their list through `suppressUnconsciousPunches` so this filter is
 *     a defensive belt.
 *   - Targets must be `consciousness === 'conscious'` (a punch against
 *     an already-unconscious body is a no-op).
 *   - Targets must be within `range` planar XZ distance of the attacker.
 *   - An attacker cannot target itself.
 *   - Each attacker hits exactly ONE target: the closest. Ties on the
 *     squared planar distance are broken by smallest `id`.
 *   - Simultaneous mutual punches: if A and B both punch and each is the
 *     other's closest target, the resolver produces TWO pairs ((A, B)
 *     and (B, A)) and the host flips BOTH to unconscious. The resolver
 *     reads each candidate target's `consciousness` from the input
 *     snapshot, not from a running mutation, so the order in which
 *     pairs are applied does not change the result.
 *
 * Output ordering: pairs are emitted in `actors` iteration order, which
 * for the host is the registry's iteration order. Tests depending on
 * exact ordering should sort by `attackerId`.
 */
export function resolvePunches(
  actors: readonly PunchActor[],
  range: number = PUNCH_RANGE_M,
): PunchResolution[] {
  const rangeSq = range * range;
  const resolutions: PunchResolution[] = [];
  for (const attacker of actors) {
    if (!attacker.punching) continue;
    if (attacker.consciousness !== "conscious") continue;
    let bestId: number | null = null;
    let bestDistSq = Infinity;
    for (const candidate of actors) {
      if (candidate.id === attacker.id) continue;
      if (candidate.consciousness !== "conscious") continue;
      const dx = candidate.position.x - attacker.position.x;
      const dz = candidate.position.z - attacker.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > rangeSq) continue;
      if (
        distSq < bestDistSq ||
        (distSq === bestDistSq && bestId !== null && candidate.id < bestId)
      ) {
        bestDistSq = distSq;
        bestId = candidate.id;
      }
    }
    if (bestId !== null) {
      resolutions.push({ attackerId: attacker.id, targetId: bestId });
    }
  }
  return resolutions;
}
