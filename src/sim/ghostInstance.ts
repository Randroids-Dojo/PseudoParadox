import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PLAYER_CAPSULE } from "../scene/player.ts";
import { applyInstanceTint } from "../render/instanceTint.ts";
import { replayAtTick, type InputRecording } from "./inputRecorder.ts";
import {
  EMPTY_MILESTONE_RECORDING,
  type MilestoneRecording,
} from "./milestone.ts";
import type { InstanceId } from "./instanceId.ts";
import {
  INITIAL_CONSCIOUSNESS,
  type Consciousness,
} from "./knockoutState.ts";
import {
  createThoughtBubble,
  type ThoughtBubble,
} from "../render/thoughtBubble.ts";

/**
 * Ghost-replay capsule (REQ-001 / REQ-002 deepening).
 *
 * A ghost is a separate Three.js mesh + Rapier dynamic capsule whose planar
 * velocity each fixed simulation step is taken from a frozen `InputRecording`
 * via `replayAtTick`. The ghost owns its own tick counter that advances by
 * exactly one per call to `advanceTick`, so the host (`src/app.ts`) can drive
 * every active ghost from the same fixed-step loop that already advances
 * physics and `TimeOfDay`.
 *
 * Past the end of the recording, `replayAtTick` returns a zero vector, so the
 * ghost simply stops moving. Despawn semantics are NOT in scope for this slice;
 * deletion is tied to portal traversal and lands with REQ-003.
 *
 * The ghost's mesh is tinted once at spawn with `applyInstanceTint` so it reads
 * as a different generation than the active player. The tint is a one-shot
 * stamp; it does not update over the day cycle.
 *
 * NOT in scope:
 *   - Portal traversal (REQ-003).
 *   - Despawn / cleanup of finished ghosts.
 *   - Multi-ghost scheduling driven by timeline state.
 *   - Heading-aware movement (input is world-axis-aligned, matching the
 *     active player).
 */

/** Minimal subset of `RAPIER.World` the ghost factory needs, so tests can pass
 * a real world or a stub. */
export interface GhostWorldHandle {
  createRigidBody: RAPIER.World["createRigidBody"];
  createCollider: RAPIER.World["createCollider"];
}

export interface GhostInstance {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  /** Origin normalized time-of-day in [0, 1] used for the constant tint. */
  originNormalized: number;
  /**
   * Generation index of the instance this ghost is replaying (REQ-007). Set
   * once at spawn from the OUTGOING active player's `instanceId` at the
   * moment of traversal: the ghost IS that closed-out instance, just rendered
   * as a recording. Carried so a future thought-bubble UI (REQ-032) can label
   * the ghost via `formatInstanceId`. The label is data only this slice.
   */
  readonly instanceId: InstanceId;
  /**
   * Frozen input recording driving this ghost's playback. Exposed so the
   * host can read the punch flag at the ghost's current tick via
   * `replayPunchAtTick(recording, tickIndex)` for the per-tick punch
   * resolver (REQ-033 partial). The recording is deeply frozen at
   * snapshot time (`InputRecorder.snapshot`) so reading it is safe; the
   * recorder cannot mutate it after capture.
   */
  readonly recording: InputRecording;
  /**
   * Frozen milestone recording captured during the lifetime that produced
   * this ghost (F-013 PR3a). Empty for ghosts spawned from a lifetime
   * that fired no milestones (e.g. Act 1 cinematic actors whose
   * hand-authored recordings predate the milestone system). PR3b's
   * hybrid replay path-follower steers toward these milestones; this
   * slice only stores them.
   */
  readonly milestones: MilestoneRecording;
  /**
   * Two-state consciousness flag (REQ-033 partial). A ghost opens at
   * `'conscious'` regardless of how its recording resolved in the source
   * timeline; the per-tick punch resolver in the host can flip this to
   * `'unconscious'` if a punch lands on this ghost in the active timeline.
   * On `reset()` the flag returns to `'conscious'` so each timeline visit
   * is a fresh playback (a previously knocked-out ghost is conscious
   * again on re-entry).
   */
  consciousness: Consciousness;
  /**
   * Thought-bubble overlay (REQ-032). Each ghost owns its own bubble so the
   * host can call `setIcon` once per render frame after the lookahead scan
   * resolves the next qualitatively different action. The bubble's group
   * mesh is parented to the same scene as the ghost mesh; `update` is
   * called per render frame to position and billboard it. Opens hidden
   * (no current kind, group `visible` false). `reset()` hides the bubble
   * so a re-entered timeline starts with a clean preview.
   */
  readonly thoughtBubble: ThoughtBubble;
  /** Number of `advanceTick` calls applied so far. Starts at 0. */
  readonly tickIndex: number;
  /**
   * Advance the ghost one fixed step: read the recording at the current tick,
   * write the resulting planar velocity onto the body (preserving y), and
   * increment the internal tick counter. After the recording is exhausted
   * this writes a zero planar velocity each call, so the ghost decelerates
   * to a stop under linear damping.
   */
  advanceTick: () => void;
  /** Copy the body's translation onto the mesh; call once per render frame. */
  syncMeshFromBody: () => void;
  /**
   * Rewind the ghost to its initial state: tick counter back to 0, body
   * translated back to the spawn position with zero linear velocity, and the
   * mesh resnapped onto the body. Used by `TimelineRegistry` when the active
   * player re-enters the timeline this ghost was recorded in: each visit is
   * a fresh playback (REQ-001 / REQ-003 deepening). The model is "the ghost
   * starts walking again the moment you arrive at its timeline."
   */
  reset: () => void;
}

export interface CreateGhostOptions {
  recording: InputRecording;
  /**
   * Frozen milestone recording for this ghost (F-013 PR3a). Optional;
   * defaults to an empty recording for callers that predate the
   * milestone system (Act 1 cinematic actors, ghost test fixtures).
   * PR3b's hybrid replay reads this to steer toward the next milestone.
   */
  milestones?: MilestoneRecording;
  /**
   * Normalized time-of-day in [0, 1] used to tint the ghost's mesh via
   * `applyInstanceTint`. Typically the `TimeOfDay.normalized()` reading at
   * the moment the ghost was spawned (which represents the recording's
   * origin from the host's perspective).
   */
  originNormalized: number;
  /**
   * Generation index of the instance this ghost is replaying (REQ-007). The
   * caller passes the OUTGOING active player's `instanceId` at the moment of
   * traversal so the ghost preserves its identity across timeline switches
   * (a returning player still sees the same You-1 / You-2 in its source
   * timeline). See `formatInstanceId` for the GDD-canonical display label.
   */
  instanceId: InstanceId;
  scene: THREE.Scene;
  world: GhostWorldHandle;
  /** World-space spawn position. The capsule center y is computed so the base
   * sits on y=0 regardless of the supplied y; only x and z are used. */
  startPosition: { x: number; z: number };
}

/**
 * Build a ghost-replay capsule. The mesh and body match the active player's
 * dimensions so a recorded path produces visually identical motion. The ghost
 * is dynamic (not kinematic) so it interacts with the same colliders the
 * active player does; that keeps the door-blocking behavior consistent with
 * REQ-002 ("worked around or physically redirected").
 */
export function createGhost(options: CreateGhostOptions): GhostInstance {
  const {
    recording,
    milestones = EMPTY_MILESTONE_RECORDING,
    originNormalized,
    instanceId,
    scene,
    world,
    startPosition,
  } = options;
  const { radius, cylinderLength } = PLAYER_CAPSULE;

  const geometry = new THREE.CapsuleGeometry(radius, cylinderLength, 8, 16);
  const material = new THREE.MeshStandardMaterial({
    color: 0xc4d0e6,
    roughness: 0.6,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "ghost";
  applyInstanceTint(mesh, originNormalized);
  scene.add(mesh);

  const restY = cylinderLength / 2 + radius;

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(startPosition.x, restY, startPosition.z)
    .enabledRotations(false, true, false)
    .setLinearDamping(8.0);

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.capsule(
    cylinderLength / 2,
    radius,
  ).setFriction(0.5);
  world.createCollider(colliderDesc, body);

  // REQ-032: each ghost owns one thought-bubble. The bubble starts hidden
  // (`setIcon(null)` is the implicit initial state inside `createThoughtBubble`).
  // The host's per-render loop reads the lookahead result and calls
  // `setIcon` on the matching kind.
  const thoughtBubble = createThoughtBubble(scene);

  // Mutable counter behind a getter on the returned object so the tick index
  // is observable but not externally writable. `advanceTick` is the only
  // mutation site, which makes ordering of replay calls verifiable.
  let tickIndex = 0;
  // REQ-033 partial: ghosts open conscious. The host's punch resolver
  // mutates this through the returned object; `reset()` returns it to the
  // seed so each timeline visit is a fresh playback.
  let consciousness: Consciousness = INITIAL_CONSCIOUSNESS;

  const advanceTick = (): void => {
    const velocity = replayAtTick(recording, tickIndex);
    const current = body.linvel();
    body.setLinvel({ x: velocity.x, y: current.y, z: velocity.z }, true);
    tickIndex += 1;
  };

  const syncMeshFromBody = (): void => {
    const t = body.translation();
    mesh.position.set(t.x, t.y, t.z);
  };

  const reset = (): void => {
    tickIndex = 0;
    // REQ-033 partial: re-entering a timeline is a fresh playback (REQ-001 /
    // REQ-003). Reset consciousness to the seed so a ghost that was knocked
    // out during a prior visit is conscious again on return.
    consciousness = INITIAL_CONSCIOUSNESS;
    body.setTranslation(
      { x: startPosition.x, y: restY, z: startPosition.z },
      true,
    );
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    syncMeshFromBody();
    // REQ-032: hide the thought bubble on reset so a re-entered timeline
    // starts with no preview. The host re-resolves the lookahead on the
    // next render frame and re-shows the matching icon if appropriate.
    thoughtBubble.setIcon(null);
  };

  syncMeshFromBody();

  return {
    mesh,
    body,
    originNormalized,
    instanceId,
    recording,
    milestones,
    thoughtBubble,
    get tickIndex(): number {
      return tickIndex;
    },
    get consciousness(): Consciousness {
      return consciousness;
    },
    set consciousness(next: Consciousness) {
      consciousness = next;
    },
    advanceTick,
    syncMeshFromBody,
    reset,
  };
}
