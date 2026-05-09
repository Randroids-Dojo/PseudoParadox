/**
 * Pickup-and-carry state and pure helpers (REQ-034).
 *
 * The carry layer is a per-active-player state machine plus a small handful
 * of pure helpers that the host (`src/app.ts`) drives once per fixed step.
 * The dossier (`docs/gdd/30-combat-and-interaction.md` section 5) is the
 * source of truth for the constants, the toggle semantics, and the edge
 * cases.
 *
 * Defaults consumed:
 *   - Q-002: `F` key binds to the pickup input.
 *   - Q-004: pickup is a TOGGLE. One rising edge picks up the nearest
 *     unconscious body in range; another rising edge drops it.
 *   - Q-005: while carrying, the carrier's planar speed is multiplied by
 *     `CARRY_SPEED_MULTIPLIER = 0.6` (60% of normal).
 *   - Q-006: the carried body is held kinematic-feel (the host writes the
 *     carrier's translation onto the body each tick) plus the dossier's
 *     belt-and-suspenders pairing of the kinematic body type and an
 *     excluded collision pairing for the duration of the carry. This module
 *     ships only the data side (the `CarryState` type and the pure helpers);
 *     the side-effecting flips live in `applyCarry.ts`.
 *   - Q-011: the carrier's `InputRecorder` channel captures the pickup flag
 *     directly; the body's trajectory is a deterministic CONSEQUENCE of the
 *     carrier's recorded inputs. No per-body translation channel.
 *
 * NOT in scope this module:
 *   - Throw (REQ-036; carry must drop on throw, but the throw direction and
 *     impulse land in the next slice).
 *   - Drag-physics specifics (REQ-035 ships as a regression test on top of
 *     this slice).
 *   - Visible mesh reparenting / Rapier body-type flips. Those are
 *     side effects and live in `applyCarry.ts`. This module is pure data.
 */

import type { Consciousness } from "./knockoutState.ts";

/**
 * Pickup range in meters (Q-006-adjacent, but the range value is the
 * dossier's `PICKUP_RANGE_M`). Roughly one-and-a-half capsule diameters,
 * so the carrier needs to be standing essentially next to the body to
 * pick it up. Smaller than `PUNCH_RANGE_M` (1.2 m) deliberately: pickup
 * implies physical contact, not just being in arm's reach.
 */
export const PICKUP_RANGE_M = 1.0;

/**
 * Multiplier applied to the carrier's `inputToVelocity` output while
 * carrying (Q-005 default). `0.6` reads as a visible slowdown without
 * crossing into tedium across the room's 10x10 footprint.
 */
export const CARRY_SPEED_MULTIPLIER = 0.6;

/**
 * Offset from the carrier's body translation to the carried body's
 * translation (head/shoulder height, Q-006 default). The carried mesh
 * appears suspended just above the carrier's head so the silhouette
 * reads as "I am holding you up." Y is the dominant axis; X and Z are
 * zero so the body sits centered above the carrier.
 */
export const CARRY_OFFSET = { x: 0, y: 1.2, z: 0 } as const;

/**
 * Stable identifier for any instance the carry layer can pick up. The
 * active player's `instanceId` and the ghost's `instanceId` are both
 * positive monotonic integers (`InstanceId`), but the carry layer's
 * surface is intentionally narrow: it only needs the id, the planar
 * position, and the consciousness flag. Callers project their richer
 * snapshots into this minimal projection (mirrors the `PunchActor`
 * pattern in `src/sim/punch.ts`).
 */
export interface Carryable {
  /** Stable id used for tie-breaking on equidistant candidates. */
  readonly id: number;
  /** Planar XZ position at the moment of selection. */
  readonly position: { readonly x: number; readonly z: number };
  /** Pre-tick consciousness state. Only `'unconscious'` candidates are
   * eligible for pickup. */
  readonly consciousness: Consciousness;
}

/**
 * Per-active-player carry state. Two flavors:
 *   - `idle`: nothing held. The default for a freshly-spawned player and
 *     the state the carrier returns to after a drop.
 *   - `carrying`: the carrier is holding the instance with id
 *     `carriedId`. The host attaches the carried body to the carrier
 *     each tick by writing the carrier's translation plus `CARRY_OFFSET`
 *     onto the carried body.
 *
 * The state intentionally does NOT carry a reference to the Rapier body
 * or the Three.js mesh; the host resolves the id back into the live
 * handles each tick. This keeps the state pure and serializable, which
 * matters for future replay/persistence work.
 */
export type CarryState =
  | { readonly kind: "idle" }
  | { readonly kind: "carrying"; readonly carriedId: number };

/** Default state for a freshly-spawned active player. */
export const INITIAL_CARRY_STATE: CarryState = { kind: "idle" };

/**
 * Pure helper: returns the closest unconscious candidate within `range`
 * planar XZ distance of `carrier`, or `null` if none qualify.
 *
 * Rules (from `docs/gdd/30-combat-and-interaction.md` section 5):
 *   - Only `consciousness === 'unconscious'` candidates are considered.
 *   - The carrier is filtered out of the candidate set even if it
 *     happens to be unconscious itself (a knocked-out carrier cannot
 *     pick up; the host gates the input upstream, but this is a defensive
 *     belt).
 *   - Candidates outside `range` are filtered out.
 *   - Of the remaining candidates, the one with the smallest squared
 *     planar distance wins. Ties on distance are broken by the smallest
 *     id (deterministic; mirrors the `resolvePunches` tie-break).
 *
 * Returns `null` for an empty candidate set, no in-range candidates, or
 * no unconscious candidates. Total: any input shape returns either a
 * single `Carryable` or `null`.
 */
export function nearestCarryable(
  carrier: { readonly id: number; readonly position: { readonly x: number; readonly z: number } },
  candidates: readonly Carryable[],
  range: number = PICKUP_RANGE_M,
): Carryable | null {
  const rangeSq = range * range;
  let best: Carryable | null = null;
  let bestDistSq = Infinity;
  for (const candidate of candidates) {
    if (candidate.id === carrier.id) continue;
    if (candidate.consciousness !== "unconscious") continue;
    const dx = candidate.position.x - carrier.position.x;
    const dz = candidate.position.z - carrier.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > rangeSq) continue;
    if (
      distSq < bestDistSq ||
      (distSq === bestDistSq && best !== null && candidate.id < best.id)
    ) {
      bestDistSq = distSq;
      best = candidate;
    }
  }
  return best;
}

/**
 * Pure helper: scale a planar velocity by `CARRY_SPEED_MULTIPLIER` iff
 * the supplied carry state is `'carrying'`. Idle returns the velocity
 * unchanged. Total and stateless: same input always yields the same
 * output. Callers wrap their `inputToVelocity` result through this
 * function before writing onto the body.
 *
 * The input is read by value (xz scalars) rather than as the
 * `PlanarVelocity` interface so the function can be reused if a future
 * slice introduces a heading-aware velocity layer with a different
 * shape.
 */
export function applyCarrySpeedScaling(
  state: CarryState,
  velocity: { readonly x: number; readonly z: number },
): { x: number; z: number } {
  if (state.kind !== "carrying") {
    return { x: velocity.x, z: velocity.z };
  }
  return {
    x: velocity.x * CARRY_SPEED_MULTIPLIER,
    z: velocity.z * CARRY_SPEED_MULTIPLIER,
  };
}

/**
 * Pure helper: resolve a single pickup-toggle input against the current
 * carry state and the candidate list. Returns the next carry state.
 *
 * Semantics:
 *   - If `pickupRisingEdge` is false, the state passes through unchanged.
 *   - If the carrier is currently `'carrying'`, a rising edge transitions
 *     to `'idle'` (drop). The drop is unconditional: the carrier always
 *     succeeds in dropping whatever it is holding.
 *   - If the carrier is `'idle'`, a rising edge searches for the nearest
 *     unconscious body in range. If one is found, the state transitions
 *     to `'carrying'` with that id. If none qualify, the state stays
 *     `'idle'` (no-op; idempotent).
 *
 * The carry state is returned by value so callers can compare the
 * previous and next states to detect transitions (e.g., to fire mesh
 * reparenting only on the rising / falling edge of carry).
 */
export function resolveCarryToggle(
  state: CarryState,
  pickupRisingEdge: boolean,
  carrier: { readonly id: number; readonly position: { readonly x: number; readonly z: number } },
  candidates: readonly Carryable[],
  range: number = PICKUP_RANGE_M,
): CarryState {
  if (!pickupRisingEdge) return state;
  if (state.kind === "carrying") {
    return { kind: "idle" };
  }
  const target = nearestCarryable(carrier, candidates, range);
  if (target === null) return state;
  return { kind: "carrying", carriedId: target.id };
}
