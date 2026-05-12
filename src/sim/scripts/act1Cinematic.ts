/**
 * Act 1 cinematic at 12:00 (REQ-012).
 *
 * Two scripted "actor" instances at 12:00 drag a knocked-out body through the
 * North door to the center of the room. The cinematic ends with a fade to
 * black before the player spawns at 5:00.
 *
 * `docs/gdd/40-act-progress-and-narrative-beats.md` section 5 is the canonical
 * spec. The dossier's chosen approach reuses the recorded-ghost machinery: a
 * scripted actor IS a `GhostInstance` whose `recording` is hand-authored as a
 * frozen `InputRecording` rather than captured by an `InputRecorder` during
 * play. The cinematic populates three ghosts in the 12:00 timeline bucket:
 *
 *   1. Left-side dragger: walks from a spawn pose just inside the North door
 *      to the center of the room.
 *   2. Right-side dragger: mirror of the left dragger on the other side.
 *   3. Knocked-out body: a 1-frame `unconscious` ghost (Q-021 default) seeded
 *      just inside the North door so the visible cinematic reads "two figures
 *      drag a body" even though the host loop's carry resolver only fires for
 *      the active player. Future scope can extend the carry attachment to fire
 *      for ghost-to-ghost pickups; this slice ships the data path.
 *
 * Defaults consumed:
 *
 *   - Q-012: recordings live under `src/sim/scripts/`.
 *   - Q-013: the fade-to-black is a Three.js full-screen plane (see
 *     `src/render/fadeOverlay.ts`).
 *   - Q-015: the player's actions during the cinematic are NOT recordable.
 *   - Q-016: the active player either does not exist during the cinematic or
 *     has its input ignored. The host's wiring keeps the existing 5:00 boot
 *     pose; the cinematic ghosts only become visible if and when the active
 *     player visits 12:00 (entering the South door).
 *   - Q-021: the body is a 1-frame `unconscious` ghost.
 *
 * NOT in scope this slice:
 *
 *   - Wiring the cinematic into the act-progress observer's `act-1-spawn`
 *     transition. `isAct1Spawn` already reads "three ghosts in 12:00 plus
 *     active player at 5" so mounting the cinematic at boot is enough.
 *   - Ghost-to-ghost carry attachment so the body visibly tracks the actors.
 *     The body's dragged path is a future tuning pass; this slice pins the
 *     data path and the spawn poses.
 *   - Per-tick fade-overlay opacity ramping wired into the host loop. The
 *     overlay primitive is exported by `src/render/fadeOverlay.ts` and a
 *     future slice (Act 2 fade-out, Act 3 setup fade) will drive it.
 */

import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { InputFrame, InputRecording } from "../inputRecorder.ts";
import type { KeyState } from "../../input/keyboard.ts";
import { hourToNormalized } from "../actOneAnchor.ts";
import {
  createGhost,
  type GhostInstance,
  type GhostWorldHandle,
} from "../ghostInstance.ts";
import type { TimelineRegistry } from "../timelineRegistry.ts";
import { applyKnockout } from "../knockoutState.ts";
import type { Position2D } from "../position.ts";

/**
 * Spawn pose for the left-side dragger. Just inside the North door, slightly
 * left of center on the X axis. The North door sits at z = -depth / 2 with
 * the room 10 units deep, so just inside is z = -3.5.
 */
export const ACT1_LEFT_DRAGGER_SPAWN: Position2D =
  Object.freeze({ x: -0.6, z: -3.5 });

/**
 * Spawn pose for the right-side dragger. Mirror of the left dragger on the
 * other side of the body.
 */
export const ACT1_RIGHT_DRAGGER_SPAWN: Position2D =
  Object.freeze({ x: 0.6, z: -3.5 });

/**
 * Spawn pose for the unconscious body. Centered between the two draggers,
 * just inside the North door so the cinematic reads "the body enters with
 * the actors."
 */
export const ACT1_KNOCKOUT_BODY_SPAWN: Position2D =
  Object.freeze({ x: 0, z: -3.6 });

/**
 * Total cinematic duration in fixed-step ticks. Four seconds at 60 Hz = 240
 * ticks. The recordings below are 240 frames; past the end of the recording
 * a ghost writes zero planar velocity each tick and decelerates to a stop.
 */
export const ACT1_CINEMATIC_DURATION_TICKS = 240;

/**
 * Tick at which the fade to black begins. Picked at the back end of the
 * cinematic so the actors finish walking before the screen darkens.
 */
export const ACT1_CINEMATIC_FADE_START_TICK = 180;

/**
 * Number of ticks the fade to black runs. One second at 60 Hz.
 */
export const ACT1_CINEMATIC_FADE_DURATION_TICKS = 60;

/**
 * Number of ticks the draggers walk south. At the player's 4 m/s walk speed
 * and 60 Hz fixed step, 60 ticks covers four meters; the spawn pose at
 * z = -3.5 plus four meters of southward motion lands the actor near the
 * room center (z ~ 0.5). Tuned so the dragger reads as having "walked the
 * body to the middle of the room."
 */
export const ACT1_DRAGGER_WALK_TICKS = 60;

/**
 * The 12:00 timeline normalized timeOfDay value. Stamped on every recorded
 * frame so the recordings declare their origin timeline (matching what an
 * `InputRecorder` would have captured if the actors had been recorded live).
 */
const ACT1_CINEMATIC_TIME_OF_DAY = hourToNormalized(12);

/**
 * Build a frozen `InputRecording` from an array of `KeyState` frames. Pure
 * factory; the returned object is deeply frozen so the cinematic recordings
 * mirror the snapshot semantics of `InputRecorder.snapshot()`. Each frame's
 * `tick` is its index and the `timeOfDay` stamp is the 12:00 normalized
 * scalar.
 */
function freezeRecording(frames: readonly KeyState[]): InputRecording {
  const frozen: InputFrame[] = frames.map((keys, tick) =>
    Object.freeze({
      tick,
      keys: Object.freeze({ ...keys }),
      timeOfDay: ACT1_CINEMATIC_TIME_OF_DAY,
    }),
  );
  return Object.freeze({
    frames: Object.freeze(frozen),
    length: frozen.length,
  });
}

/**
 * Neutral key state with every channel false. Recordings build off this base
 * with selective overrides per tick.
 */
const NEUTRAL: KeyState = Object.freeze({
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
});

/**
 * Build the dragger recording: walk south for `ACT1_DRAGGER_WALK_TICKS`
 * ticks, then idle for the remainder. Pickup is held continuously so a
 * future ghost-to-ghost carry attachment treats the actors as actively
 * carrying the body for the duration of the walk.
 */
function buildDraggerRecording(): InputRecording {
  const frames: KeyState[] = [];
  for (let tick = 0; tick < ACT1_CINEMATIC_DURATION_TICKS; tick++) {
    if (tick < ACT1_DRAGGER_WALK_TICKS) {
      frames.push({ ...NEUTRAL, back: true, pickup: true });
    } else {
      frames.push({ ...NEUTRAL });
    }
  }
  return freezeRecording(frames);
}

/**
 * Left-side dragger recording. Hand-authored: 60 ticks of southbound walk
 * (the `back` axis decreases world-Z, but the keyboard module's convention
 * is `forward` decreases Z and `back` increases Z; the North door sits at
 * z = -depth / 2 so a dragger walking AWAY from the North door INTO the
 * room walks south, which IS the `back` axis in the keyboard mapping per
 * `inputToVelocity`). Pickup held for the carry-attachment seam.
 *
 * Recordings are identical for both draggers: the spawn poses (left vs
 * right) provide the only positional differentiation, and the carry
 * attachment behavior depends on `pickup` being held throughout the walk.
 * Authoring two distinct recordings would diverge their tick-by-tick
 * inputs without changing the visible cinematic; the dossier's stated
 * intent is that the actors mirror each other on either side of the body.
 */
export const ACT1_LEFT_DRAGGER_RECORDING: InputRecording = buildDraggerRecording();

/**
 * Right-side dragger recording. Mirror of the left dragger; see comment
 * above for why the recordings are identical.
 */
export const ACT1_RIGHT_DRAGGER_RECORDING: InputRecording = buildDraggerRecording();

/**
 * Knocked-out body recording (Q-021 default A). A 1-frame ghost in the
 * 12:00 bucket whose recording is a single all-zero `KeyState` so the
 * body's recorded velocity is zero from the moment it spawns. The body is
 * marked `unconscious` post-creation so the host's punch resolver sees it
 * as already knocked out, and the unconscious-ghost movement gate in
 * `src/app.ts` preserves whatever momentum the carry attachment imparts
 * rather than snapping the body back to its zero-velocity recording.
 */
export const ACT1_KNOCKOUT_BODY_RECORDING: InputRecording = freezeRecording([
  { ...NEUTRAL },
]);

/**
 * Options for `mountAct1Cinematic`. The host (`src/app.ts`) supplies its
 * live `TimelineRegistry`, Three.js scene, and Rapier world; the function
 * builds three `GhostInstance` objects via `createGhost` and files them
 * into the 12:00 bucket via `registry.add(12, ghost)`.
 */
export interface MountAct1CinematicOptions {
  registry: TimelineRegistry;
  scene: THREE.Scene;
  world: GhostWorldHandle & {
    removeRigidBody: RAPIER.World["removeRigidBody"];
  };
}

/**
 * Result of `mountAct1Cinematic`: the three ghost handles, in the order
 * left dragger, right dragger, body. Returned so a future slice can wire
 * the fade-overlay's start trigger to the draggers' tick progression
 * without re-querying the registry.
 */
export interface MountedAct1Cinematic {
  readonly leftDragger: GhostInstance;
  readonly rightDragger: GhostInstance;
  readonly body: GhostInstance;
}

/**
 * Mount the Act 1 cinematic into the 12:00 timeline bucket. Builds three
 * `GhostInstance` objects via `createGhost`: the left dragger, the right
 * dragger, and the unconscious body. Files each into `registry`'s 12:00
 * bucket via `registry.add(12, ghost)`. The `add` call hides any ghost
 * filed into a non-active bucket, so the cinematic ghosts open hidden;
 * they become visible only when the active player visits 12:00 (via the
 * South door from 5:00) and `setActiveTimeline(12)` resets each ghost to
 * its tick-0 spawn pose.
 *
 * Pure-ish: the function mutates `registry`, `scene`, and `world` (each
 * ghost adds a mesh to the scene and a body to the world) but does not
 * read or mutate any module-level state. Idempotent at the FACTORY level:
 * calling it twice files six ghosts into the 12:00 bucket. The host
 * should call this exactly once at boot.
 *
 * The instance ids 101, 102, 103 are chosen above the active player's
 * `INITIAL_INSTANCE_ID = 1` so a hard reset (which returns the player to
 * id 1) does not collide with the cinematic ghost ids until 100
 * traversals have occurred (well past the prototype's bounded scope).
 */
export function mountAct1Cinematic(
  options: MountAct1CinematicOptions,
): MountedAct1Cinematic {
  const { registry, scene, world } = options;
  const originNormalized = ACT1_CINEMATIC_TIME_OF_DAY;

  const leftDragger = createGhost({
    recording: ACT1_LEFT_DRAGGER_RECORDING,
    originNormalized,
    instanceId: 101,
    scene,
    world,
    startPosition: { ...ACT1_LEFT_DRAGGER_SPAWN },
  });
  registry.add(12, leftDragger);

  const rightDragger = createGhost({
    recording: ACT1_RIGHT_DRAGGER_RECORDING,
    originNormalized,
    instanceId: 102,
    scene,
    world,
    startPosition: { ...ACT1_RIGHT_DRAGGER_SPAWN },
  });
  registry.add(12, rightDragger);

  const body = createGhost({
    recording: ACT1_KNOCKOUT_BODY_RECORDING,
    originNormalized,
    instanceId: 103,
    scene,
    world,
    startPosition: { ...ACT1_KNOCKOUT_BODY_SPAWN },
  });
  // Q-021 default: the body is a 1-frame `unconscious` ghost. Flip the
  // ghost's consciousness post-creation so the host's punch resolver and
  // the carry resolver both see it as already knocked out. `applyKnockout`
  // is idempotent on already-unconscious inputs, so this is safe to call
  // repeatedly.
  body.consciousness = applyKnockout(body.consciousness);
  registry.add(12, body);

  return { leftDragger, rightDragger, body };
}
