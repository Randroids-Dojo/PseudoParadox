/**
 * Milestone capture for goal-oriented ghost replay (F-013, PR3a slice).
 *
 * A milestone is a concrete event the active player produces during a
 * lifetime that the replay layer (PR3b) will steer toward. Initial schema
 * is the minimum the user spec calls out (Q-027 default A): wall bumps
 * (low weight) and door traversals (high weight). Extending the schema is
 * a future-proofing hook; the discriminated union is the contract.
 *
 * Milestones are captured ONLY on the active player's lifetime. Ghost
 * replay does not generate new milestones (a replaying ghost re-bumping
 * the same wall does not file a new event because the ghost is replaying
 * the original lifetime, not creating a new one).
 *
 * Scope this slice (PR3a):
 *   - Discriminated union of milestone kinds with stable per-kind weights.
 *   - `MilestoneRecorder` with `record` and `snapshot`.
 *   - Defensive freezing on snapshot so a snapshotted milestone log cannot
 *     be mutated by later recorder calls.
 *
 * NOT in scope (PR3b and later):
 *   - Replay path-follower that consumes the milestone log.
 *   - Skip rule (ticks-behind per weight tier, Q-025).
 *   - Hybrid replay state machine (Q-024 default B).
 *   - F-014 sub-hour catch-up (Q-026 Reading C).
 */

import type { DoorDirection } from "../scene/door.ts";

/**
 * Stable per-kind weights. The replay path-follower (PR3b) uses these for
 * the skip rule: milestones with `weight < DOOR_WEIGHT` can be skipped if
 * the ghost is too delayed; the door is unskippable.
 */
export const WALL_BUMP_WEIGHT = 1;
export const DOOR_TRAVERSAL_WEIGHT = 5;

/**
 * One milestone captured at a specific tick of the active player's
 * lifetime. Discriminated on `kind` so the replay layer can branch on
 * milestone-specific metadata (which wall, which door, etc.).
 */
export type Milestone =
  | {
      readonly kind: "wall_bump";
      readonly tick: number;
      readonly position: { readonly x: number; readonly z: number };
      readonly weight: typeof WALL_BUMP_WEIGHT;
      readonly wall: DoorDirection;
    }
  | {
      readonly kind: "door_traversal";
      readonly tick: number;
      readonly position: { readonly x: number; readonly z: number };
      readonly weight: typeof DOOR_TRAVERSAL_WEIGHT;
      readonly door: DoorDirection;
    };

/**
 * Frozen, read-only snapshot of a recorder's milestone log. Returned by
 * `MilestoneRecorder.snapshot()`. Defensive copy: mutating the recorder
 * after snapshotting does not affect this array.
 */
export interface MilestoneRecording {
  readonly milestones: readonly Milestone[];
  readonly length: number;
}

/**
 * Mutable per-lifetime milestone log. Each lifetime owns one recorder
 * alongside the `InputRecorder`. On portal traversal the host snapshots
 * both, files the snapshots onto the spawned ghost, and resets both for
 * the fresh lifetime.
 *
 * No-arg constructor mirrors `InputRecorder`. Tick indices come from the
 * caller (the host knows the current simulation tick); the recorder does
 * not assign them itself, since milestones can fire on any tick (not
 * necessarily contiguous).
 */
export class MilestoneRecorder {
  private readonly buffer: Milestone[] = [];

  /**
   * Append one milestone. The caller is responsible for picking the
   * correct `kind`, `tick`, and `position`; this recorder is a passive
   * sink. Defensive-freezes the milestone object so callers that retain
   * a reference cannot mutate it later.
   */
  record(milestone: Milestone): void {
    this.buffer.push(Object.freeze(milestone));
  }

  /** Number of milestones currently recorded. */
  get length(): number {
    return this.buffer.length;
  }

  /**
   * Freeze the recorder's current contents into an immutable snapshot.
   * Subsequent `record` calls do not mutate the returned object. Each
   * snapshot is a defensive copy of the buffer.
   */
  snapshot(): MilestoneRecording {
    const milestones = this.buffer.slice();
    return Object.freeze({
      milestones: Object.freeze(milestones),
      length: milestones.length,
    });
  }
}

/**
 * Empty milestone recording. Used as the default for ghosts spawned from
 * a lifetime that ended without firing any milestones (e.g. a zero-length
 * recording, or an Act 1 cinematic ghost whose hand-authored recording
 * predates the milestone system). Frozen at module load so callers can
 * share one reference instead of constructing a fresh empty object per
 * ghost.
 */
export const EMPTY_MILESTONE_RECORDING: MilestoneRecording = Object.freeze({
  milestones: Object.freeze([] as readonly Milestone[]),
  length: 0,
});
