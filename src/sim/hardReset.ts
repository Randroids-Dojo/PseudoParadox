/**
 * Hard reset (REQ-025): return the simulation to a clean Act 1 state.
 *
 * The GDD anchors this in `docs/gdd/03-story-acts-1-3.md` Failure recovery
 * section: "There is no auto-rewind. If the player gets stuck or makes the
 * puzzle unsolvable, hard reset is available in the pause menu." This slice
 * implements the teardown half. Pause-menu UI is OUT of scope; the host
 * (`src/app.ts`) wires a single key binding (`r`) to the function exported
 * here.
 *
 * Concrete teardown:
 *
 *   1. Remove every ghost from every timeline bucket: each ghost's mesh
 *      leaves the scene and each ghost's rigid body leaves the world.
 *   2. Reset the registry's active timeline to the Act 1 anchor hour.
 *   3. Reset the active player's body to the room center spawn pose with
 *      zero linear velocity and re-stamp its `originNormalized` plus tint
 *      to the Act 1 normalized time-of-day.
 *   4. Reset the active lifetime: a fresh `InputRecorder` keyed at tick 0
 *      of the Act 1 timeline, `startPosition` at the room center, and
 *      `originNormalized` at the Act 1 anchor.
 *   5. Snap the time-of-day clock back to the Act 1 normalized hour.
 *   6. Repaint every door's lit/dark visual to match the Act 1 timeline
 *      table (South lit, East lit, North dark, West dark).
 *   7. Clear the portal-trigger overlap state so the next `step` call after
 *      the reset does not fire a stale `exit` event for whatever trigger
 *      the player was standing in at reset, and a fresh `enter` event is
 *      deferred until the player walks into a trigger after the reset.
 *
 * The function is total and idempotent: calling it on an already-clean
 * state produces the same clean state and fires no errors. Calling it
 * after several traversals correctly tears down ghosts in every visited
 * timeline, not just the active one, because `clearAllGhosts` walks every
 * bucket.
 *
 * NOT in scope this slice:
 *   - Pause-menu UI (the GDD allows it but this slice ships only the key
 *     binding plus the teardown logic so the next slice's UI can call the
 *     same function).
 *   - Animated transition / fade-out on reset.
 *   - Undo or auto-rewind. The GDD explicitly forbids auto-rewind.
 */

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  ACT_ONE_HOUR,
  ACT_ONE_NORMALIZED,
} from "./actOneAnchor.ts";
import { InputRecorder } from "./inputRecorder.ts";
import { INITIAL_INSTANCE_ID } from "./instanceId.ts";
import { applyInstanceTint } from "../render/instanceTint.ts";
import {
  repaintDoorsForHour,
  snapClockToHour,
} from "./timelineRoom.ts";
import type { ActiveLifetime, ActivePlayerHandle } from "./portalTraversal.ts";
import type { Portal } from "./portal.ts";
import type { PortalTriggerSet } from "./portalTrigger.ts";
import type { TimelineRegistry } from "./timelineRegistry.ts";
import type { TimeOfDay } from "./timeOfDay.ts";

/**
 * Minimal subset of `RAPIER.World` the reset needs to remove ghost rigid
 * bodies. Mirrors the structural handles in `ghostInstance.ts` and
 * `timelineRegistry.ts` so tests can pass either a real world or a stub.
 */
export interface HardResetWorldHandle {
  removeRigidBody: RAPIER.World["removeRigidBody"];
}

export interface HardResetOptions {
  /** Active player handle. Body translation, velocity, mesh tint, and
   * `originNormalized` are mutated in place. */
  player: ActivePlayerHandle;
  /** Active lifetime. Recorder, start position, and origin are reset to a
   * fresh Act 1 lifetime. */
  lifetime: ActiveLifetime;
  /** Per-timeline ghost registry. Every bucket is emptied and the active
   * timeline is reset to the Act 1 anchor hour. */
  registry: TimelineRegistry;
  /** Three.js scene that hosts the player and ghost meshes. Ghost meshes
   * are removed from this scene during reset. */
  scene: THREE.Scene;
  /** Rapier world that hosts the player and ghost rigid bodies. Ghost
   * bodies are removed from this world during reset. */
  world: HardResetWorldHandle;
  /** Time-of-day clock. Snapped to the Act 1 normalized hour. */
  timeOfDay: TimeOfDay;
  /** Cardinal portals. Their door meshes are repainted to match the Act 1
   * lit/dark table. */
  portals: readonly Portal[];
  /** Edge-triggered portal overlap detector. Per-portal overlap flags are
   * cleared so the next `step` call does not fire a stale event. */
  portalTriggers: PortalTriggerSet;
}

/**
 * Room-center spawn position (REQ-013 / REQ-014). The player capsule's y
 * is preserved across the teleport so the body's resting height is
 * unchanged; only x and z are overridden.
 */
const ROOM_CENTER_X = 0;
const ROOM_CENTER_Z = 0;

/**
 * Tear down ghosts and reset the active player to the canonical Act 1
 * spawn pose. See module docstring for the full sequence.
 */
export function hardReset(options: HardResetOptions): void {
  const {
    player,
    lifetime,
    registry,
    scene,
    world,
    timeOfDay,
    portals,
    portalTriggers,
  } = options;

  // 1 / 2. Tear down every ghost in every timeline bucket and reset the
  // registry's active timeline to the Act 1 anchor hour. `clearAllGhosts`
  // walks every bucket (not just the active one) so a player who has
  // traversed multiple timelines still gets a clean tear-down.
  registry.clearAllGhosts(scene, world, ACT_ONE_HOUR);

  // 3. Reset the active player's body to the room center with zero linear
  // velocity. Preserve y (the capsule's resting height) so the player does
  // not float or sink on reset.
  const currentY = player.body.translation().y;
  player.body.setTranslation(
    { x: ROOM_CENTER_X, y: currentY, z: ROOM_CENTER_Z },
    true,
  );
  player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

  // Re-stamp the player's tint and origin to the Act 1 normalized time so
  // the capsule reads as a freshly-spawned 5:00 instance (REQ-030).
  player.originNormalized = ACT_ONE_NORMALIZED;
  applyInstanceTint(player.mesh, ACT_ONE_NORMALIZED);

  // Reset the active instance generation back to the seed (REQ-007 / REQ-025).
  // After hard reset the player is again "You1": the next portal traversal
  // will spawn a fresh You-1 ghost. Without this, a hard reset would leave
  // the next spawn at whatever generation the player happened to be at when
  // the reset key was pressed, breaking the GDD's "clean Act 1 state" contract.
  player.instanceId = INITIAL_INSTANCE_ID;

  // 4. Open a fresh lifetime at the Act 1 anchor: a new recorder (so no
  // recorded frames from the just-cleared run leak into a future ghost
  // spawn), a start position at the room center, the Act 1 origin, and the
  // seed `INITIAL_INSTANCE_ID` so the next spawned ghost is again You-1.
  lifetime.recorder = new InputRecorder();
  lifetime.startPosition = { x: ROOM_CENTER_X, z: ROOM_CENTER_Z };
  lifetime.originNormalized = ACT_ONE_NORMALIZED;
  lifetime.instanceId = INITIAL_INSTANCE_ID;

  // 5. Snap the time-of-day clock back to the Act 1 anchor so the room's
  // background tint reads as 5:00 amber on the next render frame.
  snapClockToHour(timeOfDay, ACT_ONE_HOUR);

  // 6. Repaint every door's lit/dark visual to match the Act 1 timeline
  // table (South lit, East lit, North dark, West dark per the GDD).
  repaintDoorsForHour(portals, ACT_ONE_HOUR);

  // 7. Clear the portal-trigger overlap state so the next `step` call
  // after the reset does not fire a stale `exit` event for whatever
  // trigger the player was standing in at reset, and a fresh `enter`
  // event is deferred until the player walks into a trigger after the
  // reset settles.
  portalTriggers.resetOverlapState();
}
