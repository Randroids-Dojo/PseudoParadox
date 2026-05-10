import * as THREE from "three";
import type { GhostInstance } from "./ghostInstance.ts";
import type { Portal } from "./portal.ts";
import type { PortalTrigger } from "./portalTrigger.ts";
import { pointInsideTrigger } from "./portalTrigger.ts";
import type {
  RegistryWorldHandle,
  TimelineRegistry,
} from "./timelineRegistry.ts";

/**
 * F-012: per-tick ghost-vs-portal traversal pass.
 *
 * When a ghost in the active timeline crosses a LIT portal trigger, despawn
 * it. Mirrors what the active player does on a lit traversal: the recording
 * the ghost is replaying captured the player walking through the door, so
 * on replay the ghost SHOULD also disappear at the door rather than coast
 * past with a dead recording and stand "stuck at the door" once the input
 * sequence ends.
 *
 * Dark portals are intentionally NOT despawn-triggers. With solid wall
 * colliders the ghost cannot physically pass through a dark door, but the
 * trigger volume still extends inward into the room; if a recorded path
 * happens to scrape the inner edge of a dark trigger zone we do not want
 * the ghost to vanish. The lit-state predicate the host passes in matches
 * the same `bodyLitGate` the in-flight registry uses, so this pass and
 * thrown-body traversal share one source of truth on which doors are
 * enterable in the current timeline (REQ-011 deepening compatibility).
 *
 * Pure function: same `(ghosts, triggers, predicate)` produces the same
 * removeGhost call sequence. The caller is responsible for snapshotting
 * the active-ghost list (`.slice()`) before invoking, because the
 * registry's removeGhost mutates the underlying bucket.
 *
 * Returns the count of ghosts despawned in this call. Each ghost despawns
 * at most once per call (we break out of the trigger loop on the first
 * match).
 */
export function despawnGhostsAtLitPortals(
  ghosts: readonly GhostInstance[],
  triggers: readonly PortalTrigger[],
  isLitForCurrentTimeline: (portal: Portal) => boolean,
  registry: TimelineRegistry,
  scene: THREE.Scene,
  world: RegistryWorldHandle,
): number {
  let despawned = 0;
  for (const ghost of ghosts) {
    const t = ghost.body.translation();
    for (const trigger of triggers) {
      if (!isLitForCurrentTimeline(trigger.portal)) continue;
      if (!pointInsideTrigger(trigger, t.x, t.z)) continue;
      registry.removeGhost(ghost, scene, world);
      despawned += 1;
      break;
    }
  }
  return despawned;
}
