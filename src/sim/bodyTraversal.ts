/**
 * Body-only portal traversal for thrown bodies (REQ-036).
 *
 * Thrown bodies cross a LIT portal mid-flight and teleport to the
 * destination time, preserving their velocity vector so the arc continues
 * on the other side (Q-008 default: linvel rotated zero degrees). This is
 * a SEPARATE code path from the active player's `wireTraversal`:
 *
 *   - A thrown body has no `lifetime` and no `InputRecorder`.
 *   - A thrown body does NOT spawn a ghost (dossier section 7 closed-form
 *     decision; only voluntary entries by an instance with its own
 *     `lifetime` produce ghosts).
 *   - A thrown body does NOT switch the registry's active timeline (only
 *     active-player traversal does that; a thrown body crossing a portal
 *     is "the body went somewhere" but the player is still wherever the
 *     player is).
 *
 * What this module ships:
 *
 *   - `BodyInFlight`: a tracked thrown body. The host registers a body
 *     here when it fires `applyThrow`, and the registry walks the list
 *     each fixed step to step a per-body portal-trigger detector. Each
 *     body owns its own detector instance so the per-portal "was inside
 *     last tick" flags do not interfere across bodies.
 *   - `createInFlightRegistry()`: builds the registry. Owns the list of
 *     in-flight bodies. Exposes `register(body)`, `unregister(body)`,
 *     `step(tick, isLit, resolveSpawn)`, `clear()`, and `inFlight()`.
 *   - On a lit-portal `enter` event for a body, the body is teleported
 *     to the destination spawn pose with its translation rewritten and
 *     its linear velocity preserved. The body's `inFlight` flag stays
 *     true: the body keeps flying after teleport.
 *   - A body whose linear velocity drops below `IN_FLIGHT_SETTLE_SPEED`
 *     for `IN_FLIGHT_SETTLE_TICKS` consecutive ticks is removed from
 *     the in-flight list. After settling, the body cannot re-traverse
 *     a portal (the dossier specifies thrown bodies are kicked into
 *     portals only during the airborne phase; a settled body bumped
 *     into a portal by a later collision is just an ordinary inert
 *     body, no different from an unconscious one lying on the floor).
 *
 * Determinism: the registry's behavior is a deterministic function of
 * the supplied body translations and velocities. The per-body detector
 * uses the same `pointInsideTrigger` predicate as the active player's
 * detector, so a body and a player crossing the same trigger volume at
 * the same translation would produce the same edge.
 *
 * NOT in scope this module:
 *   - Spawning ghosts (forbidden by the closed-form decision).
 *   - Mesh tint re-stamp (the body keeps its origin tint; the dossier
 *     does not specify a re-tint for thrown bodies and the game's
 *     visual reading is "the same body just in a different timeline").
 *   - Multi-active-player scenarios.
 */

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  pointInsideTrigger,
  type PortalTrigger,
} from "./portalTrigger.ts";
import {
  portalDestinationNormalized,
  type Portal,
} from "./portal.ts";

/**
 * Squared-velocity threshold below which a thrown body is considered
 * settled. Equivalent to ~0.3 m/s of total linear speed; the unconscious
 * damping value (0.5) takes a thrown body from the throw impulse down to
 * this threshold within a few seconds, well before any new portal
 * collision could re-arm it.
 */
export const IN_FLIGHT_SETTLE_SPEED_SQ = 0.09;

/**
 * Number of consecutive sub-threshold ticks before a body is unregistered.
 * A single sub-threshold tick is not enough (a body bouncing off a wall
 * could momentarily zero velocity); two consecutive ticks at low speed
 * indicates the body has actually settled.
 */
export const IN_FLIGHT_SETTLE_TICKS = 2;

/**
 * Minimal subset of `RAPIER.RigidBody` the body-traversal touches. Mirrors
 * the structural-handle pattern used in `applyCarry.ts` so tests can pass
 * a stub.
 */
export interface InFlightBodyHandle {
  translation: RAPIER.RigidBody["translation"];
  setTranslation: RAPIER.RigidBody["setTranslation"];
  linvel: RAPIER.RigidBody["linvel"];
  setLinvel: RAPIER.RigidBody["setLinvel"];
}

/**
 * One tracked body in flight. The host owns the underlying
 * `RAPIER.RigidBody` (it lives in the simulation world); the registry
 * holds the per-body bookkeeping needed to detect portal traversal and
 * settling.
 */
interface BodyInFlight {
  /** Stable id for the body (the carried instance's id). Used so the
   * host can resolve the body back to a mesh / instance for hard reset. */
  readonly id: number;
  /** Live Rapier body handle. */
  readonly body: InFlightBodyHandle;
  /** Optional Three.js mesh for hard-reset cleanup. */
  readonly mesh: THREE.Object3D | undefined;
  /** Per-portal "was inside last tick" flags, indexed parallel to the
   * shared trigger list. Owned by this body so two bodies in flight do
   * not share state. */
  overlapping: boolean[];
  /** Number of consecutive sub-threshold ticks. Resets to 0 on any
   * tick where the body is above the settle threshold. */
  subThresholdTicks: number;
}

/**
 * Resolves the destination spawn pose for a normalized destination time.
 * Mirrors `SpawnPoseResolver` in `portalTraversal.ts`. Defaults to the
 * room center; a future slice authoring per-time spawn poses (REQ-013)
 * supplies a richer resolver.
 */
export type BodySpawnPoseResolver = (
  destinationNormalized: number,
) => { x: number; z: number };

const DEFAULT_BODY_SPAWN_POSE: BodySpawnPoseResolver = () => ({ x: 0, z: 0 });

/**
 * Predicate returning whether a portal is currently lit for the body's
 * traversal context. Mirrors the `isLitForCurrentTimeline` closure in
 * `portalTraversal.ts`. The host wires this against the same
 * `litStateForTimeline` table the player's traversal uses, so a body
 * and the player share one source of truth.
 *
 * The host's wiring uses `registry.activeTimeline` to evaluate this; for
 * thrown bodies the dossier specifies the lit gate is the same one that
 * gates the active player (Q-008 / dossier section 7: "If the thrown
 * body's translation crosses a LIT portal trigger volume mid-flight,
 * the body teleports").
 */
export type BodyLitGate = (portal: Portal) => boolean;

/**
 * One step of the body-traversal detector for a single body. Compares
 * the body's current translation against each shared trigger and emits
 * an `enter` for any portal newly overlapping. On a lit-portal enter,
 * the body is teleported.
 *
 * The body's translation is read from the body, then if a teleport
 * fires the body's overlap flags are updated to reflect the post-
 * teleport position. This matches the active player's traversal which
 * teleports to a spawn pose authored to sit OUTSIDE every trigger
 * volume (`portalTraversal.ts` `SpawnPoseResolver` contract).
 */
const stepBodyDetector = (
  inFlight: BodyInFlight,
  triggers: readonly PortalTrigger[],
  isLit: BodyLitGate,
  resolveSpawnPose: BodySpawnPoseResolver,
): void => {
  const t = inFlight.body.translation();
  for (let i = 0; i < triggers.length; i += 1) {
    const trigger = triggers[i];
    const inside = pointInsideTrigger(trigger, t.x, t.z);
    const wasInside = inFlight.overlapping[i];
    if (inside && !wasInside) {
      inFlight.overlapping[i] = true;
      // Lit gate: dark portals do not teleport thrown bodies, mirroring
      // the player's traversal contract (REQ-010).
      if (isLit(trigger.portal)) {
        // Q-008 default: preserve the body's linear velocity through the
        // teleport so the arc continues on the other side.
        const linvel = inFlight.body.linvel();
        const destination = resolveSpawnPose(
          portalDestinationNormalized(trigger.portal),
        );
        const currentY = t.y;
        inFlight.body.setTranslation(
          { x: destination.x, y: currentY, z: destination.z },
          true,
        );
        inFlight.body.setLinvel(linvel, true);
        // After the teleport, the body's overlap flags should reflect the
        // post-teleport position. The default room-center spawn pose sits
        // outside every trigger volume (per the dossier's contract on
        // `SpawnPoseResolver`), so the safe behavior is to clear all
        // overlap flags. This prevents the next tick's detector from
        // firing a stale "still inside the entry trigger" enter, and the
        // post-teleport pose is outside every trigger so no fresh enter
        // is missed.
        for (let j = 0; j < inFlight.overlapping.length; j += 1) {
          inFlight.overlapping[j] = false;
        }
        // Stop iterating: the body has moved out of every trigger now,
        // so any further triggers would be false-inside-now anyway.
        return;
      }
    } else if (!inside && wasInside) {
      inFlight.overlapping[i] = false;
    }
  }
};

/**
 * Public registry of in-flight thrown bodies. Owned by the host
 * (`src/app.ts`) and walked once per fixed step.
 */
export interface InFlightRegistry {
  /** Register a body as in-flight. The host calls this immediately after
   * `applyThrow` fires so the body's portal-overlap detector starts on
   * the next tick. Idempotent: registering the same id twice keeps the
   * later registration. */
  register(body: {
    id: number;
    body: InFlightBodyHandle;
    mesh?: THREE.Object3D;
  }): void;
  /** Read-only snapshot of currently in-flight body ids. Useful for
   * tests and for the hard-reset path that needs to walk every flying
   * body before clearing. */
  inFlight(): readonly number[];
  /** Step every in-flight body one tick. The supplied lit-gate and
   * spawn-pose resolver are read at step time so a host that switches
   * its lit table can pass a fresh closure each tick. */
  step(
    isLit: BodyLitGate,
    resolveSpawnPose?: BodySpawnPoseResolver,
  ): void;
  /** Tear down every in-flight body: remove each body's mesh from
   * `scene` and rigid body from `world`, then clear the registry. Used
   * by the hard-reset path. The registry is empty after this call. */
  clear(scene: THREE.Scene, world: HardResetBodyWorld): void;
}

/** Minimal subset of `RAPIER.World` the registry's `clear` needs. */
export interface HardResetBodyWorld {
  removeRigidBody: (body: RAPIER.RigidBody) => void;
}

export interface CreateInFlightRegistryOptions {
  /** Shared trigger list. The same `PortalTrigger[]` the active player's
   * detector uses; thrown bodies and the player both gate on the same
   * volumes. */
  triggers: readonly PortalTrigger[];
}

/**
 * Build a fresh in-flight registry. The list starts empty.
 */
export function createInFlightRegistry(
  options: CreateInFlightRegistryOptions,
): InFlightRegistry {
  const { triggers } = options;
  const tracked: BodyInFlight[] = [];

  // The Rapier body handle stored in BodyInFlight must be the LIVE rapier
  // body so its mesh / world removal still works on hard reset. The
  // registry intentionally does not hold a strong reference to the
  // RAPIER.RigidBody type (the structural InFlightBodyHandle suffices
  // for the per-step path), but the hard-reset path needs the concrete
  // body. The registry stores both: the structural handle for the
  // hot path, and the concrete body for cleanup.
  const concreteBodies = new Map<number, RAPIER.RigidBody>();

  return {
    register(entry): void {
      // If the same id is already tracked, replace it (e.g. a re-throw of
      // the same body after it was picked up again). The list stays
      // unique by id.
      const existingIdx = tracked.findIndex((t) => t.id === entry.id);
      const item: BodyInFlight = {
        id: entry.id,
        body: entry.body,
        mesh: entry.mesh,
        overlapping: new Array<boolean>(triggers.length).fill(false),
        subThresholdTicks: 0,
      };
      if (existingIdx >= 0) {
        tracked[existingIdx] = item;
      } else {
        tracked.push(item);
      }
      // Cache the concrete body if it happens to be a real RAPIER.RigidBody.
      // The structural handle is enough for `step`; only `clear` reaches for
      // the concrete handle.
      const candidateBody = entry.body as unknown as RAPIER.RigidBody;
      concreteBodies.set(entry.id, candidateBody);
    },
    inFlight(): readonly number[] {
      return tracked.map((t) => t.id);
    },
    step(
      isLit: BodyLitGate,
      resolveSpawnPose: BodySpawnPoseResolver = DEFAULT_BODY_SPAWN_POSE,
    ): void {
      // Iterate a defensive copy so a teleport mutation that triggers a
      // future unregister does not skip entries.
      const snapshot = tracked.slice();
      for (const entry of snapshot) {
        stepBodyDetector(entry, triggers, isLit, resolveSpawnPose);
        // Settle check: if the body's velocity has been below the settle
        // threshold for `IN_FLIGHT_SETTLE_TICKS` consecutive ticks, drop
        // it from the registry. A settled body bumped into a portal by a
        // later collision does NOT re-traverse: the dossier specifies
        // the airborne phase as the only trigger window for thrown-body
        // teleport. After unregister, the body lies on the floor like
        // any other unconscious capsule.
        const linvel = entry.body.linvel();
        const speedSq =
          linvel.x * linvel.x +
          linvel.y * linvel.y +
          linvel.z * linvel.z;
        if (speedSq < IN_FLIGHT_SETTLE_SPEED_SQ) {
          entry.subThresholdTicks += 1;
          if (entry.subThresholdTicks >= IN_FLIGHT_SETTLE_TICKS) {
            const idx = tracked.indexOf(entry);
            if (idx >= 0) tracked.splice(idx, 1);
            concreteBodies.delete(entry.id);
          }
        } else {
          entry.subThresholdTicks = 0;
        }
      }
    },
    clear(scene: THREE.Scene, world: HardResetBodyWorld): void {
      for (const entry of tracked) {
        if (entry.mesh) scene.remove(entry.mesh);
        const concrete = concreteBodies.get(entry.id);
        if (concrete) {
          world.removeRigidBody(concrete);
        }
      }
      tracked.length = 0;
      concreteBodies.clear();
    },
  };
}
