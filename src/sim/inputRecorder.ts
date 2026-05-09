/**
 * Per-tick input recording buffer for the active player instance.
 *
 * Foundation slice for REQ-001 (timeline persistence) and REQ-002 (past
 * instances replay recorded input frame-exact). The recorder captures the
 * keyboard state and the current time-of-day snapshot once per fixed
 * simulation step. A later slice will spawn a ghost capsule that drains a
 * frozen recording back into a player movement step, but the playback
 * surface (`replayAtTick`) is exposed here as a pure helper so tests can
 * exercise it without DOM, physics, or rendering.
 *
 * Scope this slice:
 *   - Per-tick capture of `KeyState` plus normalized time-of-day.
 *   - `snapshot()` returns a frozen, defensively copied recording.
 *   - `replayAtTick(recording, tick)` returns the recorded planar axes for a
 *     tick, or a zero vector if the tick is past the recording's end.
 *
 * NOT in scope this slice:
 *   - Replaying recorded input on a ghost capsule.
 *   - Portal-triggered recording boundaries (REQ-003).
 *   - Persistence across sessions.
 *   - Multi-instance state, generation numbering (REQ-007).
 */

import { inputToVelocity, type KeyState, type PlanarVelocity } from "../input/keyboard.ts";

/** A single captured frame of input at a specific simulation tick. */
export interface InputFrame {
  /** Monotonic simulation tick index. Starts at 0 and increments by one per record call. */
  readonly tick: number;
  /** Snapshot of the keyboard state at the moment of capture. */
  readonly keys: KeyState;
  /** Normalized time-of-day in [0, 1) at the moment of capture. */
  readonly timeOfDay: number;
}

/** A frozen, read-only recording produced by `InputRecorder.snapshot()`. */
export interface InputRecording {
  /** Captured frames in tick order. Defensive copy: mutating the recorder after
   * snapshotting does not affect this array. */
  readonly frames: readonly InputFrame[];
  /** Number of frames in the recording. Equal to `frames.length`. */
  readonly length: number;
}

/**
 * Mutable per-instance recorder. The active player owns one recorder; future
 * slices that introduce additional instances will give each its own recorder
 * (or its own immutable recording, for replay-only ghosts).
 *
 * Constructor takes no arguments because the recorder is purely additive: tick
 * indices are assigned monotonically by the recorder itself rather than passed
 * in. This keeps the contract dead-simple and prevents callers from accidentally
 * skipping or repeating ticks.
 */
export class InputRecorder {
  private readonly buffer: InputFrame[] = [];

  /**
   * Capture one fixed-step's worth of input. The recorder assigns the tick
   * index from the current buffer length, guaranteeing a contiguous monotonic
   * sequence starting at 0. Defensive-copies the supplied `KeyState` so later
   * mutation of the source object does not retroactively rewrite history.
   */
  record(keys: KeyState, timeOfDay: number): void {
    const frame: InputFrame = {
      tick: this.buffer.length,
      keys: { ...keys },
      timeOfDay,
    };
    this.buffer.push(frame);
  }

  /** Number of frames currently held in the buffer. */
  get length(): number {
    return this.buffer.length;
  }

  /**
   * Freeze the recorder's current contents into an immutable recording. The
   * returned object is a defensive copy: subsequent `record` calls do not
   * mutate it, and callers cannot reach back through it to mutate the
   * recorder's internal buffer.
   */
  snapshot(): InputRecording {
    const frames = this.buffer.map((frame) => Object.freeze({
      tick: frame.tick,
      keys: Object.freeze({ ...frame.keys }),
      timeOfDay: frame.timeOfDay,
    }));
    return Object.freeze({
      frames: Object.freeze(frames),
      length: frames.length,
    });
  }
}

/** Zero planar velocity. Returned for ticks past the end of a recording so a
 * ghost capsule that has run out of recorded input simply stops moving. */
const ZERO_AXES: PlanarVelocity = Object.freeze({ x: 0, z: 0 });

/**
 * Pure replay helper: given a recording and a tick index, returns the planar
 * velocity that the recorded keyboard state would produce.
 *
 * Returns a zero vector for ticks past the end of the recording. Returns a
 * zero vector for negative tick indices (defensive: callers should never feed
 * one but the function is total). The shape is stable regardless of branch so
 * callers can blindly write the result into a body's planar velocity each
 * tick.
 *
 * Tests pin the contract: mid-recording returns the exact recorded vector,
 * out-of-range returns zero. The mid-recording vector is derived through
 * `inputToVelocity` rather than stored, so any future tweak to the input
 * mapping (heading-aware movement, custom speed) replays consistently.
 */
export function replayAtTick(recording: InputRecording, tick: number): PlanarVelocity {
  if (tick < 0 || tick >= recording.length) {
    return ZERO_AXES;
  }
  const frame = recording.frames[tick];
  return inputToVelocity(frame.keys);
}

/**
 * Recorded punch flag at a tick. Returns `false` for ticks past the end of
 * the recording or for negative tick indices, matching the past-end semantics
 * of `replayAtTick` (a ghost that has exhausted its recording stops moving
 * AND stops punching). The flag is read directly from the recorded
 * `KeyState.punch` so any future change to the input mapping flows through.
 *
 * Kept as a sibling helper to `replayAtTick` rather than a combined return so
 * existing call sites that only need the planar velocity stay unchanged
 * (slice discipline: no drive-by signature edits).
 */
export function replayPunchAtTick(recording: InputRecording, tick: number): boolean {
  if (tick < 0 || tick >= recording.length) {
    return false;
  }
  return recording.frames[tick].keys.punch;
}

/**
 * Recorded pickup flag at a tick (REQ-034). Returns `false` for ticks past
 * the end of the recording or for negative tick indices, matching the
 * past-end semantics of `replayAtTick` and `replayPunchAtTick`. The flag is
 * read directly from `KeyState.pickup`. The carry resolver in
 * `src/sim/carryState.ts` interprets a sequence of recorded pickup flags as
 * a toggle: the host derives the rising edge by comparing tick T's flag
 * with tick T-1's flag.
 *
 * Sibling helper to `replayPunchAtTick` rather than a combined return so
 * existing call sites that only need the planar velocity stay unchanged
 * (slice discipline: no drive-by signature edits).
 */
export function replayPickupAtTick(recording: InputRecording, tick: number): boolean {
  if (tick < 0 || tick >= recording.length) {
    return false;
  }
  return recording.frames[tick].keys.pickup;
}
