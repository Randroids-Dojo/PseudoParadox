/**
 * Portal trigger overlap detection (REQ-009 deepening).
 *
 * This slice senses when the active player capsule overlaps a portal's trigger
 * volume and emits an edge-triggered event. The next slice consumes those
 * events to actually teleport the player. The lit/dark filter is NOT applied
 * here: an overlap is reported for every portal the player walks into,
 * regardless of `isLit`. The teleport slice will gate on `isLit(portal)`.
 *
 * Approach: pure AABB overlap. The Rapier-sensor path was considered. It
 * would require building a fixed body and a sensor collider per portal,
 * subscribing to narrow-phase events, and reconciling them with the
 * fixed-step loop in `src/app.ts`. The pure-overlap path lets us evaluate
 * the predicate each tick from the player's translation alone, which keeps
 * the detector trivially deterministic, framework-free, and trivially
 * testable. The door's footprint is already authored in `DOOR_DIMENSIONS`,
 * so the trigger volume is a small extruded box centered on the door's
 * inside face.
 *
 * Scope this slice:
 *   - Build a `PortalTrigger` per portal, sized to a small box just inside
 *     the door's mesh footprint.
 *   - Pure `pointInsideTrigger(trigger, x, z)` predicate.
 *   - `PortalTriggerSet` aggregates four triggers and emits edge-triggered
 *     `enter` and `exit` events from a `step(x, z, tick)` call.
 *   - `onPortalOverlap(callback)` subscriber hook.
 *
 * NOT in scope this slice:
 *   - Lit-only filtering. The next slice gates teleport on `isLit(portal)`.
 *   - Teleport. The next slice writes the player's translation on overlap.
 *   - Recording snapshot capture, ghost spawn at the door of arrival.
 *   - Y-axis containment. The room is single-floor and the player capsule
 *     base sits on `y = 0`, so a 2D XZ check is sufficient.
 */

import type { Portal } from "./portal.ts";
import { DOOR_DIMENSIONS } from "../scene/door.ts";

/**
 * Width of the trigger volume, measured along the wall the door sits on.
 * Slightly narrower than the door's authored width so a player skimming the
 * adjacent wall does not accidentally trip the trigger.
 */
export const PORTAL_TRIGGER_WALL_WIDTH = DOOR_DIMENSIONS.width;

/**
 * Depth of the trigger volume, measured perpendicular to the wall (i.e.
 * inward into the room). Authored to be wider than the player capsule
 * radius (0.4) so a single fixed-step traversal cannot skip past the
 * trigger between ticks at typical movement speeds.
 */
export const PORTAL_TRIGGER_DEPTH = 0.6;

/**
 * Axis-aligned XZ rectangle for one portal's trigger volume.
 *
 * The rectangle is centered at `(centerX, centerZ)` and extends to
 * `+/- halfX` along world X and `+/- halfZ` along world Z. Doors on the
 * north or south wall extend wide along X (the wall direction) and shallow
 * along Z (into the room). East and west doors are mirrored.
 */
export interface PortalTrigger {
  readonly portal: Portal;
  readonly centerX: number;
  readonly centerZ: number;
  readonly halfX: number;
  readonly halfZ: number;
}

/**
 * Builds the trigger rectangle for one portal, derived from the door's
 * mesh position plus `DOOR_DIMENSIONS`.
 *
 * The trigger sits just inside the door, centered on the door's inside
 * face. The "inside face" is the door face that points into the room. For
 * a north-wall door (negative Z) the inside face points to +Z, so the
 * trigger center is offset by `+halfDepth` from the door mesh; mirrored
 * for the other three directions.
 */
export function createPortalTrigger(portal: Portal): PortalTrigger {
  const door = portal.door;
  const meshPos = door.mesh.position;
  const halfTriggerWide = PORTAL_TRIGGER_WALL_WIDTH / 2;
  const halfTriggerDeep = PORTAL_TRIGGER_DEPTH / 2;

  switch (portal.direction) {
    case "north":
      return Object.freeze({
        portal,
        centerX: meshPos.x,
        centerZ: meshPos.z + halfTriggerDeep,
        halfX: halfTriggerWide,
        halfZ: halfTriggerDeep,
      });
    case "south":
      return Object.freeze({
        portal,
        centerX: meshPos.x,
        centerZ: meshPos.z - halfTriggerDeep,
        halfX: halfTriggerWide,
        halfZ: halfTriggerDeep,
      });
    case "east":
      return Object.freeze({
        portal,
        centerX: meshPos.x - halfTriggerDeep,
        centerZ: meshPos.z,
        halfX: halfTriggerDeep,
        halfZ: halfTriggerWide,
      });
    case "west":
      return Object.freeze({
        portal,
        centerX: meshPos.x + halfTriggerDeep,
        centerZ: meshPos.z,
        halfX: halfTriggerDeep,
        halfZ: halfTriggerWide,
      });
  }
}

/**
 * Pure AABB containment predicate. A point on the trigger boundary counts
 * as inside; this matches Rapier's inclusive collider behavior and keeps
 * the edge-triggered semantics symmetric on both faces.
 */
export function pointInsideTrigger(
  trigger: PortalTrigger,
  x: number,
  z: number,
): boolean {
  return (
    x >= trigger.centerX - trigger.halfX &&
    x <= trigger.centerX + trigger.halfX &&
    z >= trigger.centerZ - trigger.halfZ &&
    z <= trigger.centerZ + trigger.halfZ
  );
}

/** Edge-triggered event emitted when overlap state changes for a portal. */
export interface OverlapEvent {
  readonly portal: Portal;
  readonly kind: "enter" | "exit";
  readonly tick: number;
}

/** Subscriber callback shape. Receives one event per state transition. */
export type OverlapCallback = (event: OverlapEvent) => void;

/**
 * Aggregates a set of portal triggers and tracks per-portal overlap state
 * across ticks so the same overlap is not reported every step.
 */
export interface PortalTriggerSet {
  readonly triggers: readonly PortalTrigger[];
  /**
   * Steps the detector one tick. Compares the new overlap state against
   * the previous tick and emits one `enter` event per portal that just
   * began overlapping, and one `exit` event per portal that just stopped
   * overlapping. Subscribers are called synchronously in registration
   * order; events for the same tick are emitted in the trigger order
   * supplied to `createPortalTriggerSet`.
   */
  step(x: number, z: number, tick: number): void;
  /**
   * Registers a subscriber. Returns an unsubscribe function. Multiple
   * subscribers may register; each receives every event.
   */
  onPortalOverlap(callback: OverlapCallback): () => void;
  /**
   * Read-only view of which portals are currently inside the trigger.
   * Exposed for tests; the runtime path uses the event stream.
   */
  isOverlapping(portal: Portal): boolean;
}

/**
 * Builds a trigger set from a list of portals. The order of `portals` is
 * preserved for stable per-tick event ordering.
 */
export function createPortalTriggerSet(
  portals: readonly Portal[],
): PortalTriggerSet {
  const triggers = portals.map(createPortalTrigger);
  const overlapping = new Array<boolean>(triggers.length).fill(false);
  const subscribers: OverlapCallback[] = [];

  const emit = (event: OverlapEvent): void => {
    for (const cb of subscribers) cb(event);
  };

  return {
    triggers,
    step(x: number, z: number, tick: number): void {
      for (let i = 0; i < triggers.length; i += 1) {
        const trigger = triggers[i];
        const inside = pointInsideTrigger(trigger, x, z);
        const wasInside = overlapping[i];
        if (inside && !wasInside) {
          overlapping[i] = true;
          emit({ portal: trigger.portal, kind: "enter", tick });
        } else if (!inside && wasInside) {
          overlapping[i] = false;
          emit({ portal: trigger.portal, kind: "exit", tick });
        }
      }
    },
    onPortalOverlap(callback: OverlapCallback): () => void {
      subscribers.push(callback);
      return (): void => {
        const idx = subscribers.indexOf(callback);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },
    isOverlapping(portal: Portal): boolean {
      const idx = triggers.findIndex((t) => t.portal === portal);
      return idx >= 0 && overlapping[idx];
    },
  };
}
