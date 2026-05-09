/**
 * Throw mechanic (REQ-036).
 *
 * While carrying, the active player can press the `throw` input (default
 * key: `T`; see Q-002) to detach the carried body and apply a fixed
 * impulse along the player's facing direction. The body returns to
 * `dynamic` and follows ballistic physics under gravity and damping.
 *
 * This module ships:
 *
 *   - Constants: `THROW_IMPULSE_N` (planar facing impulse, dossier section
 *     7), `THROW_UP_IMPULSE_N` (vertical bump for an arc).
 *   - `computeThrowImpulse(facing)`: pure helper that returns the impulse
 *     vector for a unit-length facing direction. Total: a zero-vector
 *     facing produces a zero-vector planar impulse plus the upward bump
 *     (defensive; the caller's tracker should never feed a zero facing,
 *     but the helper does not crash on one).
 *   - `applyThrow(body, facing)`: side-effecting helper that:
 *       1. Flips the body back to `Dynamic` (it was `KinematicPositionBased`
 *          during carry).
 *       2. Zeroes its linear velocity so the impulse acts on a known state.
 *       3. Applies the throw impulse along the facing direction plus the
 *          upward bump.
 *     The body's `linearDamping` is left at the unconscious value
 *     (`UNCONSCIOUS_LINEAR_DAMPING = 0.5`, set in `applyKnockoutBody`)
 *     because the carried body was already unconscious. Mesh tilt is
 *     untouched: the body remains unconscious, so the knockout tilt
 *     stays in place.
 *   - `tryThrow(opts)`: the high-level transition. Given the carrier's
 *     pre-tick `CarryState`, the rising-edge throw input flag, the live
 *     facing direction, and a callback that resolves the carried body
 *     handle from a `carriedId`, this helper applies the throw if and
 *     only if all preconditions hold. Returns the post-tick `CarryState`
 *     (back to `'idle'` on a successful throw, unchanged otherwise).
 *
 * Determinism (Q-009 default: trust Rapier deterministic step):
 *   - The facing direction is a deterministic function of the recorded
 *     `KeyState` sequence (see `src/sim/facing.ts`).
 *   - The throw impulse magnitude and direction are pure functions of the
 *     facing.
 *   - The body's pre-throw pose is the carrier's pose plus `CARRY_OFFSET`
 *     (set by `applyCarryAttachment` the previous tick).
 *   - Rapier's deterministic step plus identical initial conditions plus
 *     identical impulse equals identical trajectory.
 *
 * Replay note: thrown bodies do NOT spawn ghosts (dossier section 7
 * closed-form decision). Only voluntary entries by an instance with its
 * own `lifetime` produce ghosts. On replay, the recorded throw input
 * flows through the same `tryThrow` path and re-evaluates the throw
 * against the replay world's carry state. If the replay world has the
 * same body in carry at the same tick (which it does because the carry
 * state is itself a deterministic consequence of recorded inputs), the
 * thrown trajectory matches.
 *
 * NOT in scope this module:
 *   - Body-only portal traversal (lives in `src/sim/bodyTraversal.ts`).
 *   - Throw aim-arc UI.
 *   - Throwing while not carrying (the helper is a no-op in that state).
 */

import RAPIER from "@dimforge/rapier3d-compat";
import type { CarryState } from "./carryState.ts";
import type { Facing } from "./facing.ts";

/**
 * Planar impulse magnitude along the facing direction (dossier section 7).
 * Default: 14 N-s. The thrown body's mass is approximately 1 kg, so the
 * impulse produces about 14 m/s of forward velocity at the moment of
 * release. The 0.5 unconscious damping settles this within a few ticks
 * unless the body crosses a portal first.
 */
export const THROW_IMPULSE_N = 14;

/**
 * Vertical bump impulse so the thrown body lifts off the carrier's
 * height into a small arc rather than skimming flat. Default: 4 N-s.
 * The body's natural gravity and damping bring the arc back down within
 * the room's footprint at typical throw distances.
 */
export const THROW_UP_IMPULSE_N = 4;

/**
 * Pure helper: given a unit facing direction, return the impulse vector
 * the throw will apply. The y component is the constant upward bump; the
 * x and z components scale the facing by `THROW_IMPULSE_N`.
 *
 * Zero-vector facing input produces a zero planar impulse plus the
 * upward bump (defensive; the caller's facing tracker should never feed
 * a zero facing because it caches the last non-zero direction, but the
 * helper does not crash on one).
 */
export function computeThrowImpulse(facing: Facing): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: facing.x * THROW_IMPULSE_N,
    y: THROW_UP_IMPULSE_N,
    z: facing.z * THROW_IMPULSE_N,
  };
}

/**
 * Minimal subset of `RAPIER.RigidBody` the throw mutates. Mirrors the
 * structural-handle pattern used in `applyCarry.ts` so tests can pass
 * a stub.
 */
export interface ThrowBodyHandle {
  setBodyType: RAPIER.RigidBody["setBodyType"];
  setLinvel: RAPIER.RigidBody["setLinvel"];
  applyImpulse: RAPIER.RigidBody["applyImpulse"];
}

/**
 * Side-effecting throw: flip the body to `Dynamic`, zero its velocity,
 * and apply the throw impulse along the facing direction plus the
 * upward bump.
 *
 * The body's mesh rotation is intentionally NOT touched: the body
 * remains unconscious on throw, so the knockout tilt stays in place
 * (mirrors `applyCarryDrop`'s contract). The body's `linearDamping` is
 * also unchanged: the carried body was already at
 * `UNCONSCIOUS_LINEAR_DAMPING` and stays there during flight (dossier
 * section 7: "the thrown body's `linearDamping` stays at
 * `UNCONSCIOUS_LINEAR_DAMPING = 0.5` so the arc reads naturally").
 *
 * Total: any unit or non-unit facing produces a deterministic mutation
 * sequence. Repeated calls on the same body apply the impulse again
 * (so callers must gate on a state TRANSITION, the way the host gates
 * the pickup transition on `'idle' -> 'carrying'`).
 */
export function applyThrow(body: ThrowBodyHandle, facing: Facing): void {
  body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.applyImpulse(computeThrowImpulse(facing), true);
}

/**
 * Resolve a carried body's handle from its `instanceId`. Returns `null`
 * when no live body matches (e.g. the carried instance was cleared by a
 * hard reset between the carry-resolve tick and the throw-resolve tick;
 * defensive only, the host gates this in normal flow).
 */
export type CarriedBodyResolver = (
  carriedId: number,
) => ThrowBodyHandle | null;

export interface TryThrowOptions {
  /** Pre-tick carry state. Throws are no-ops unless this is `'carrying'`. */
  carry: CarryState;
  /** Rising-edge of the `throw` input this tick. False values are no-ops. */
  throwRisingEdge: boolean;
  /** Unit-length facing direction from the carrier's facing tracker. */
  facing: Facing;
  /** Resolves a carried body handle from its id. */
  resolveBody: CarriedBodyResolver;
}

/**
 * High-level throw transition. Returns the post-tick `CarryState`:
 *   - `'idle'` if the throw fired (carry slot cleared, body launched).
 *   - The input `carry` unchanged otherwise.
 *
 * Side effects: on a successful throw, calls `applyThrow` on the
 * resolved carried body. On a no-op (any precondition unmet), no
 * Rapier or scene mutation occurs.
 *
 * Preconditions for a fire:
 *   - `throwRisingEdge` is true (one fire per press; held throw input
 *     does not auto-fire after the body is gone).
 *   - `carry.kind === 'carrying'` (a throw with no carried body is a
 *     no-op; the recorder still captures the throw flag, but the
 *     state does not change).
 *   - `resolveBody(carriedId)` returns a non-null handle (defensive
 *     against a desync between the carry state and the live world,
 *     which the host normally prevents).
 *
 * The input `carry` is returned by value; callers compare the previous
 * and next states (the same way they do for the pickup toggle) to
 * detect the throw transition for any non-physics observers.
 */
export function tryThrow(options: TryThrowOptions): CarryState {
  const { carry, throwRisingEdge, facing, resolveBody } = options;
  if (!throwRisingEdge) return carry;
  if (carry.kind !== "carrying") return carry;
  const body = resolveBody(carry.carriedId);
  if (body === null) return carry;
  applyThrow(body, facing);
  return { kind: "idle" };
}
