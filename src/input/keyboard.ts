/**
 * Keyboard input for the prototype player capsule (REQ-026).
 *
 * The keyboard module is split into two layers:
 *   1. A pure mapping helper, `inputToVelocity`, that converts a key-state
 *      record into a normalized world-XZ velocity vector. This is the only
 *      thing exercised by tests, which keeps the unit boundary trivial.
 *   2. A small DOM-bound tracker, `createKeyboardState`, that listens for
 *      keydown / keyup on `window` and updates a shared `KeyState`.
 *
 * The prototype camera is fixed at a diagonal isometric angle, so the pure
 * mapping rotates movement by the camera yaw before it reaches the player
 * body. Scripted fixtures can pass `yawRad = 0` when they need the old
 * world-axis authoring frame.
 */

export interface KeyState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  /**
   * Punch input (REQ-033 partial). Captured as a per-tick boolean so the
   * recorder writes one frame's punch flag alongside the movement axes and
   * `replayAtTick` consumers can read it back. The default key binding is
   * `Space` (Q-002 default). The flag is sticky for the duration of the key
   * being held; the per-tick punch resolver in `src/sim/punch.ts` is
   * responsible for treating each frame's flag as the puncher's intent at
   * that tick. Edge-triggering (rising-edge only) is NOT applied here so a
   * future hold-to-charge variant can read the flag directly.
   */
  punch: boolean;
  /**
   * Pickup input (REQ-034). Captured as a per-tick boolean alongside the
   * other channels so the recorder snapshots it identically to `punch`.
   * Default key binding is `F` (Q-002 default). The carry layer
   * (`src/sim/carryState.ts`) is a TOGGLE (Q-004 default): one rising
   * edge picks up the nearest in-range unconscious body, another rising
   * edge drops it. Rising-edge detection itself is NOT applied here; the
   * recorder stores the raw key state and the host (`src/app.ts`) tracks
   * the previous tick's value to derive the edge. This mirrors the
   * `punch` model: per-tick boolean here, semantic interpretation in the
   * resolver. On replay a ghost's recorded pickup flag flows through the
   * same edge-detection path so a recorded pickup at tick T fires once,
   * not on every subsequent tick the recording keeps the flag held.
   */
  pickup: boolean;
  /**
   * Throw input (REQ-036). Per-tick boolean captured alongside the
   * other channels. Default key binding is `T` (Q-002 default). The
   * throw resolver (`src/sim/throw.ts`) fires on the rising edge while
   * the player is carrying: the carried body returns to dynamic and an
   * impulse is applied along the player's facing (Q-007 default
   * heuristic, last non-zero movement direction). Thrown bodies do
   * NOT spawn ghosts (dossier section 7 closed-form decision); the
   * throw input is part of the carrier's recording, so a replay
   * re-evaluates the throw against the replay world's carry state and
   * produces the same trajectory under Rapier's deterministic step
   * (Q-009 default).
   */
  throw: boolean;
}

export interface PlanarVelocity {
  x: number;
  z: number;
}

/**
 * Default movement speed in world units per second. 4 m/s reads as a brisk
 * walk on the 10x10 unit room: roughly two-and-a-half seconds wall-to-wall.
 * Tuned by feel; revisit when the camera framing and animation arrive.
 */
export const PLAYER_SPEED_MPS = 4;

/**
 * Camera yaw used by `inputToVelocity` to rotate input-axis velocity
 * into world-axis velocity, so "press W" moves the player toward the
 * top of the screen regardless of how the room is rotated in view.
 *
 * The prototype camera sits at the (+X, +Z) corner of the room and
 * looks toward the origin (see `src/scene/scene.ts`). Its forward
 * direction projected onto the XZ plane is `(-1, -1) / sqrt(2)`, which
 * is the Three.js default forward (`-Z`) rotated by +pi/4 radians
 * around the +Y axis. So a +pi/4 input yaw rotates the W -> (-Z)
 * keymap into the world direction "deeper into the scene from the
 * camera" (`(-1, -1) / sqrt(2)`), which is what the player reads as
 * "up on screen."
 *
 * Pan from `cameraGestures.ts` shifts both `camera.position` and the
 * lookAt by the same offset, so the camera's orientation (yaw,
 * pitch) is constant. A future slice that adds orbit / rotation will
 * need to recompute this from the camera each frame; today it is a
 * fixed constant.
 */
export const CAMERA_INPUT_YAW_RAD = Math.PI / 4;

/**
 * Pure helper: rotate a planar XZ velocity around the +Y axis by
 * `yawRad` radians. Used by `inputToVelocity` to apply the camera
 * yaw, and exposed separately so tests can verify the rotation
 * math without going through the key-state path.
 *
 * The rotation uses the right-handed Three.js convention so passing
 * `Math.PI / 4` rotates `(0, -1)` (the default W keymap) into
 * `(-1, -1) / sqrt(2)` (forward-and-left in world XZ).
 */
export function rotateVelocityByYaw(
  velocity: PlanarVelocity,
  yawRad: number,
): PlanarVelocity {
  if (yawRad === 0) return velocity;
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return {
    x: c * velocity.x + s * velocity.z,
    z: -s * velocity.x + c * velocity.z,
  };
}

/**
 * Converts a snapshot of key state into a planar velocity vector in
 * WORLD coordinates, with the camera yaw applied so "press W" moves
 * the player toward the top of the screen rather than along world
 * -Z.
 *
 * Raw key mapping (before yaw rotation): forward -> -Z, back -> +Z,
 * left -> -X, right -> +X. Diagonals are normalized so holding two
 * keys does not exceed `speed`.
 *
 * Yaw is applied at the end so the returned velocity is ready to
 * pass to `body.setLinvel({ x, y, z })`. Pass `yawRad = 0` for the
 * raw world-axis mapping (used by scripted-recording tests that
 * pre-date the camera-relative input slice).
 *
 * Pure function: same input always yields the same output, no
 * globals, no DOM.
 */
export function inputToVelocity(
  state: KeyState,
  speed: number = PLAYER_SPEED_MPS,
  yawRad: number = CAMERA_INPUT_YAW_RAD,
): PlanarVelocity {
  let x = 0;
  let z = 0;
  if (state.forward) z -= 1;
  if (state.back) z += 1;
  if (state.left) x -= 1;
  if (state.right) x += 1;

  if (x === 0 && z === 0) {
    return { x: 0, z: 0 };
  }

  const magnitude = Math.hypot(x, z);
  const raw: PlanarVelocity = {
    x: (x / magnitude) * speed,
    z: (z / magnitude) * speed,
  };
  return rotateVelocityByYaw(raw, yawRad);
}

interface KeyboardHandle {
  state: KeyState;
  dispose: () => void;
}

/**
 * Binds keydown / keyup listeners on the supplied target (typically
 * `window`) and returns a live `KeyState` object plus a `dispose` cleanup.
 *
 * WASD and the arrow keys are both supported. Repeats and held keys are
 * handled naturally by the browser firing a single keydown for each press;
 * we only flip the boolean, never count.
 */
export function createKeyboardState(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
): KeyboardHandle {
  const state: KeyState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    punch: false,
    pickup: false,
    throw: false,
  };

  const setKey = (code: string, down: boolean): void => {
    switch (code) {
      case "KeyW":
      case "ArrowUp":
        state.forward = down;
        break;
      case "KeyS":
      case "ArrowDown":
        state.back = down;
        break;
      case "KeyA":
      case "ArrowLeft":
        state.left = down;
        break;
      case "KeyD":
      case "ArrowRight":
        state.right = down;
        break;
      // Q-002 default: Space binds to the punch input (REQ-033). The
      // movement keys ignore Space, so there is no input collision.
      case "Space":
        state.punch = down;
        break;
      // Q-002 default: F binds to the pickup input (REQ-034). The
      // movement keys ignore F, so there is no input collision. The
      // toggle semantics live in `src/sim/carryState.ts`; this layer
      // captures only the raw key state.
      case "KeyF":
        state.pickup = down;
        break;
      // Q-002 default: T binds to the throw input (REQ-036). The
      // movement keys ignore T, so there is no input collision. The
      // rising-edge gate plus the carrying-state gate live in
      // `src/sim/throw.ts`; this layer captures only the raw key state.
      case "KeyT":
        state.throw = down;
        break;
      default:
        break;
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => setKey(event.code, true);
  const onKeyUp = (event: KeyboardEvent): void => setKey(event.code, false);

  target.addEventListener("keydown", onKeyDown as EventListener);
  target.addEventListener("keyup", onKeyUp as EventListener);

  const dispose = (): void => {
    target.removeEventListener("keydown", onKeyDown as EventListener);
    target.removeEventListener("keyup", onKeyUp as EventListener);
  };

  return { state, dispose };
}
