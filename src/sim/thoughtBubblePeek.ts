/**
 * Lookahead scan over a ghost's recording for the next qualitatively
 * different upcoming action (REQ-032; `docs/gdd/30-combat-and-interaction.md`
 * section 8).
 *
 * Each render frame, the host calls `nextQualitativelyDifferentAction` for
 * every active-timeline ghost and feeds the result to the ghost's
 * `ThoughtBubble.setIcon`. The function is pure: it reads the recording,
 * the ghost's current tick index, the current-state inputs (consciousness
 * + start position + portal triggers), and a window length, and returns
 * one of the icon kinds or null.
 *
 * Anti-spam (dossier section 8):
 *   - Walking is the baseline and is NOT surfaced. `footsteps` is defined
 *     in the spec for completeness but the lookahead never returns it
 *     (the dossier permits it to be invisible "most of the time"; this
 *     implementation makes it always invisible, which is the simpler
 *     contract).
 *   - Sleep is state-based: if the ghost is currently unconscious, the
 *     icon is `sleep`, regardless of what the recording says. Sleep
 *     persists for as long as the ghost is unconscious (the host
 *     re-evaluates each render frame; the result remains `sleep` until
 *     the ghost becomes conscious again, which v1 does not allow except
 *     via hard reset which clears every ghost).
 *   - Each other icon resolves from the FIRST priority match within the
 *     lookahead window. Once a punch flag is in the window, the icon is
 *     `fist` for the rest of the window even if a door entry would be
 *     reached after; the higher priority wins.
 *
 * Priority order (highest first):
 *
 *   sleep > throw > pickup > fist > door > null
 *
 * Sleep depends on CURRENT state (`isCurrentlyUnconscious`); the rest are
 * scanned over the recording window.
 *
 * Q-010 default: lookahead window = 30 ticks (0.5 s at 60 Hz).
 *
 * NOT in scope this slice:
 *   - Anti-spam beyond priority + once-per-render: a punch icon in the
 *     same window stays visible for every render until it resolves out;
 *     the dossier permits this.
 *   - Per-ghost cache that filters duplicate icon results; the host owns
 *     a small cache so it does not re-call `setIcon` on no-op changes.
 *   - Footsteps detection (idle-to-walking transition). The icon kind
 *     `footsteps` is omitted from the return type.
 *
 * The forward-integration for door-entry runs the SAME `inputToVelocity`
 * helper the recorder feeds, so a recorded path that crosses a portal
 * trigger volume between `currentTick` and `currentTick + lookaheadTicks`
 * is detected by stepping the ghost's predicted translation forward at
 * the fixed timestep. The step ignores Rapier collisions because the
 * recording is replay; the path is what the ghost WILL walk, modulo
 * world.step damping. For the prototype's window length (30 ticks at
 * 60 Hz, ~0.5 s) this is accurate enough to read as "about to enter the
 * door": the predicted x/z stays within the trigger volume's footprint
 * even under a 8.0 linear damping coefficient.
 */

import { inputToVelocity, type KeyState } from "../input/keyboard.ts";
import type { InputRecording } from "./inputRecorder.ts";
import {
  pointInsideTrigger,
  type PortalTrigger,
} from "./portalTrigger.ts";

/** Default lookahead window length in fixed-step ticks. Q-010 default. */
export const DEFAULT_LOOKAHEAD_TICKS = 30;

/**
 * One of the icons the thought-bubble lookahead can surface. `'footsteps'`
 * is OMITTED from the return type per anti-spam (walking is the baseline).
 * `'sleep'` is added by the host when the ghost is unconscious; it is
 * also returned by `nextQualitativelyDifferentAction` directly so the
 * priority pipeline lives in one place.
 */
export type ThoughtPeekKind =
  | "sleep"
  | "throw"
  | "pickup"
  | "fist"
  | "door";

/**
 * Inputs to the lookahead scan. The function is pure over these inputs.
 */
export interface ThoughtPeekOptions {
  /** Frozen recording driving this ghost's playback. */
  recording: InputRecording;
  /** The ghost's current `tickIndex`. The scan reads ticks
   * `currentTick + 1 .. currentTick + lookaheadTicks`. */
  currentTick: number;
  /** Number of ticks ahead to scan. Defaults to `DEFAULT_LOOKAHEAD_TICKS`. */
  lookaheadTicks?: number;
  /** Whether the ghost is currently unconscious. If true, the result is
   * always `'sleep'` (highest priority). */
  isCurrentlyUnconscious: boolean;
  /** The ghost's current world-space planar position. Used as the seed
   * for the door-entry forward integration. */
  currentPosition: { x: number; z: number };
  /** The portal trigger volumes the ghost might enter. Empty array
   * disables door detection. The host passes the same trigger list the
   * active player's detector uses. */
  triggers: readonly PortalTrigger[];
  /** Fixed-step timestep in seconds. Defaults to 1 / 60. */
  fixedStepSeconds?: number;
  /** Camera yaw used to turn recorded keys into predicted world velocity. */
  yawRad?: number;
}

const DEFAULT_FIXED_STEP_SECONDS = 1 / 60;

/**
 * Returns the next qualitatively different upcoming action's icon kind,
 * or `null` if nothing qualitatively different is in the window.
 *
 * Walks the lookahead window once. Returns the FIRST priority match: if
 * a throw flag is anywhere in the window, the result is `'throw'`. If
 * not, but a pickup flag is in the window, `'pickup'`. And so on through
 * `'fist'` (punch) and `'door'`. Sleep is checked first against the
 * supplied `isCurrentlyUnconscious` flag and short-circuits.
 *
 * Door-entry detection forward-integrates the recorded planar velocity
 * from `currentPosition`. Each tick of the window:
 *   1. Read the recorded `KeyState` at that tick (or zero past the end).
 *   2. Convert to a planar velocity via `inputToVelocity` and `yawRad`.
 *   3. Step the predicted position by `velocity * fixedStepSeconds`.
 *   4. Check `pointInsideTrigger` against every supplied portal trigger.
 *
 * The forward integration ignores Rapier damping. This is intentional: the
 * lookahead is a coarse "where will this ghost be" check, and including
 * damping would require simulating the same fixed-step impulse / integrate
 * pipeline Rapier runs (which the host already runs against the live
 * world). For the 30-tick window the discrepancy stays inside the
 * trigger volume's `PORTAL_TRIGGER_DEPTH = 0.6` margin in practice.
 */
export function nextQualitativelyDifferentAction(
  options: ThoughtPeekOptions,
): ThoughtPeekKind | null {
  const {
    recording,
    currentTick,
    lookaheadTicks = DEFAULT_LOOKAHEAD_TICKS,
    isCurrentlyUnconscious,
    currentPosition,
    triggers,
    fixedStepSeconds = DEFAULT_FIXED_STEP_SECONDS,
    yawRad = 0,
  } = options;

  // Sleep dominates regardless of recording content.
  if (isCurrentlyUnconscious) {
    return "sleep";
  }

  // Empty window short-circuits to null. The dossier specifies that a
  // ghost at the end of its recording shows null unless unconscious.
  if (lookaheadTicks <= 0) {
    return null;
  }

  let sawThrow = false;
  let sawPickup = false;
  let sawFist = false;
  let sawDoor = false;

  // Forward-integrate the predicted position once per tick so door
  // detection stays cheap. The same loop reads the recorded flags so we
  // do not iterate the window twice.
  let predictedX = currentPosition.x;
  let predictedZ = currentPosition.z;

  const startTick = currentTick + 1;
  const endTick = currentTick + lookaheadTicks;
  for (let t = startTick; t <= endTick; t += 1) {
    const keys = readKeysAtTick(recording, t);
    if (keys.throw) sawThrow = true;
    if (keys.pickup) sawPickup = true;
    if (keys.punch) sawFist = true;

    if (!sawDoor && triggers.length > 0) {
      const velocity = inputToVelocity(keys, undefined, yawRad);
      predictedX += velocity.x * fixedStepSeconds;
      predictedZ += velocity.z * fixedStepSeconds;
      for (const trigger of triggers) {
        if (pointInsideTrigger(trigger, predictedX, predictedZ)) {
          sawDoor = true;
          break;
        }
      }
    }

    // Early-out on the highest non-state priority. If we already saw a
    // throw flag, no further scanning can change the result.
    if (sawThrow) break;
  }

  if (sawThrow) return "throw";
  if (sawPickup) return "pickup";
  if (sawFist) return "fist";
  if (sawDoor) return "door";
  return null;
}

/**
 * Read the recorded `KeyState` at tick `t`. Returns an all-false neutral
 * state for ticks outside the recording (pre-start or past-end). The
 * neutral state is reused so the caller does not need to allocate per
 * tick of the lookahead.
 */
const NEUTRAL_KEYS: KeyState = Object.freeze({
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
});

function readKeysAtTick(recording: InputRecording, t: number): KeyState {
  if (t < 0 || t >= recording.length) {
    return NEUTRAL_KEYS;
  }
  return recording.frames[t].keys;
}
