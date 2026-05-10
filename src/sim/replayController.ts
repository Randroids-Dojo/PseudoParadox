/**
 * Hybrid replay controller for ghost playback (F-013, PR3b slice).
 *
 * Per the design pass on 2026-05-10 (Q-024 default B, Q-025 default A):
 *
 *   - Mode A: `replaying-input`. Each tick the controller writes the
 *     recorded velocity from the input recording onto the ghost's body.
 *     Same behavior as PR3a's pure replay.
 *
 *   - Mode B: `path-following`. The controller steers the ghost toward
 *     the next pending milestone with `PLAYER_SPEED_MPS`. When the ghost
 *     is within `ARRIVAL_RADIUS` of the milestone, the milestone is
 *     marked reached, the milestone index advances, and the controller
 *     returns to `replaying-input`.
 *
 * Switch-to-path-following condition: drift between the ghost's actual
 * body translation and the position the recording WOULD produce at the
 * current tick, assuming the ghost integrated the recorded velocities
 * unobstructed from its start position. If drift exceeds
 * `DRIFT_THRESHOLD`, the ghost is off course and the controller switches
 * to path-following toward the next pending milestone.
 *
 * Skip rule: each milestone has a tick budget per kind. If the ghost's
 * current tick is more than `WALL_BUMP_BUDGET_TICKS` past a wall_bump's
 * recorded tick, the bump is skipped and the controller targets the
 * next milestone. `door_traversal` is unskippable; the door is sacred.
 *
 * Drift baseline tracking is O(1) per tick: the controller maintains a
 * running `expectedPos` that adds the current tick's recorded velocity
 * times the fixed step. On a milestone reach, the baseline is
 * re-anchored to the ghost's current body position so the next tick's
 * drift check restarts cleanly.
 *
 * Pure data: the controller's state is a plain struct; `advanceReplay`
 * is a pure function that takes the state, the recording, the milestone
 * log, the ghost's current body position, and the fixed step, and
 * returns the velocity to write plus the next state. The ghost holds
 * the state and threads it through each tick.
 */

import { replayAtTick, type InputRecording } from "./inputRecorder.ts";
import {
  DOOR_TRAVERSAL_WEIGHT,
  type Milestone,
} from "./milestone.ts";
import { PLAYER_SPEED_MPS, type PlanarVelocity } from "../input/keyboard.ts";

/**
 * Drift threshold in world units. If the ghost's body translation is
 * more than this far from the recording's expected position at the
 * current tick, the controller switches to `path-following`.
 */
export const DRIFT_THRESHOLD = 0.5;

/**
 * Arrival radius in world units. If the ghost's body translation is
 * within this distance of the next pending milestone's position, the
 * milestone is marked reached and the controller returns to
 * `replaying-input`.
 */
export const ARRIVAL_RADIUS = 0.3;

/**
 * Tick budget for `wall_bump` milestones. If `currentTick - milestone.tick`
 * exceeds this, the milestone is skipped past. `door_traversal` is
 * unskippable: its budget is `Infinity`.
 */
export const WALL_BUMP_BUDGET_TICKS = 60;

export type ReplayMode = "replaying-input" | "path-following";

export interface ReplayState {
  /** Per-tick counter. Mirrors `GhostInstance.tickIndex` semantics. */
  readonly tickIndex: number;
  /** Index into the milestone log for the NEXT pending milestone.
   * Equals milestones.length once all milestones are reached or skipped. */
  readonly milestoneIdx: number;
  /** Running expected position assuming no obstructions. Updated each
   * tick by adding `replayAtTick(recording, tickIndex) * dt`. Re-anchored
   * to the ghost's actual body position when a milestone is reached. */
  readonly expectedPos: { readonly x: number; readonly z: number };
  /** The mode used in the most recent `advanceReplay` call. Exposed for
   * tests and any future overlay debugging. */
  readonly lastMode: ReplayMode;
}

export function createReplayState(startPosition: {
  x: number;
  z: number;
}): ReplayState {
  return {
    tickIndex: 0,
    milestoneIdx: 0,
    expectedPos: { x: startPosition.x, z: startPosition.z },
    lastMode: "replaying-input",
  };
}

interface ReplayResult {
  readonly velocity: PlanarVelocity;
  readonly state: ReplayState;
}

/**
 * Advance the replay one tick. Returns the velocity to write onto the
 * ghost's body plus the next state. Pure: same inputs always yield the
 * same outputs.
 *
 * The order of operations:
 *   1. Skip stale low-weight milestones (door is unskippable).
 *   2. Compute the recorded velocity at this tick and the new expected
 *      position (running integral).
 *   3. If a pending milestone exists and the ghost is within the
 *      arrival radius, advance the milestone index, switch to
 *      `replaying-input`, and re-anchor expected position to the body's
 *      current position.
 *   4. Otherwise, if drift exceeds the threshold and a pending
 *      milestone exists, switch to `path-following` and return a
 *      direction-toward-milestone velocity.
 *   5. Otherwise, stay in `replaying-input` and return the recorded
 *      velocity.
 */
export function advanceReplay(
  state: ReplayState,
  recording: InputRecording,
  milestones: readonly Milestone[],
  currentBodyPos: { x: number; z: number },
  fixedStepSeconds: number,
): ReplayResult {
  // 1. Skip stale low-weight milestones up to (but not past) the next
  //    door. Door budget is Infinity so the comparison stays false for
  //    door entries.
  let milestoneIdx = state.milestoneIdx;
  while (milestoneIdx < milestones.length) {
    const m = milestones[milestoneIdx];
    if (m.weight === DOOR_TRAVERSAL_WEIGHT) break;
    if (state.tickIndex - m.tick > WALL_BUMP_BUDGET_TICKS) {
      milestoneIdx += 1;
      continue;
    }
    break;
  }

  // 2. Recorded velocity at this tick plus running expected position.
  const recordedVelocity = replayAtTick(recording, state.tickIndex);
  const baseExpected = {
    x: state.expectedPos.x + recordedVelocity.x * fixedStepSeconds,
    z: state.expectedPos.z + recordedVelocity.z * fixedStepSeconds,
  };

  // 3. Milestone arrival check.
  const pending =
    milestoneIdx < milestones.length ? milestones[milestoneIdx] : null;
  if (pending !== null) {
    const distToMilestone = Math.hypot(
      currentBodyPos.x - pending.position.x,
      currentBodyPos.z - pending.position.z,
    );
    if (distToMilestone < ARRIVAL_RADIUS) {
      // Re-anchor expected position to the ghost's current body pos so
      // the next tick's drift check restarts cleanly.
      return {
        velocity: recordedVelocity,
        state: {
          tickIndex: state.tickIndex + 1,
          milestoneIdx: milestoneIdx + 1,
          expectedPos: { x: currentBodyPos.x, z: currentBodyPos.z },
          lastMode: "replaying-input",
        },
      };
    }
  }

  // 4. Drift check + sticky path-follow. The ghost stays in
  //    `path-following` once engaged until the milestone arrival check
  //    (step 3) advances the milestone index and re-anchors. Without
  //    stickiness the controller would fall back to recorded input as
  //    soon as drift dropped under the threshold mid-correction, which
  //    can leave the ghost stranded short of the milestone it was
  //    supposed to reach. The first switch to path-follow still
  //    requires drift > threshold; subsequent ticks keep steering
  //    toward the same pending milestone until it is reached.
  const drift = Math.hypot(
    currentBodyPos.x - baseExpected.x,
    currentBodyPos.z - baseExpected.z,
  );
  const shouldPathFollow =
    pending !== null &&
    (state.lastMode === "path-following" || drift > DRIFT_THRESHOLD);
  if (shouldPathFollow && pending !== null) {
    const dx = pending.position.x - currentBodyPos.x;
    const dz = pending.position.z - currentBodyPos.z;
    const len = Math.hypot(dx, dz);
    const velocity: PlanarVelocity =
      len > 0
        ? {
            x: (dx / len) * PLAYER_SPEED_MPS,
            z: (dz / len) * PLAYER_SPEED_MPS,
          }
        : { x: 0, z: 0 };
    return {
      velocity,
      state: {
        tickIndex: state.tickIndex + 1,
        milestoneIdx,
        expectedPos: baseExpected,
        lastMode: "path-following",
      },
    };
  }

  // 5. Default: keep replaying recorded input.
  return {
    velocity: recordedVelocity,
    state: {
      tickIndex: state.tickIndex + 1,
      milestoneIdx,
      expectedPos: baseExpected,
      lastMode: "replaying-input",
    },
  };
}
