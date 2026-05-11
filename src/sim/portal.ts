/**
 * Portal data structure for the prototype (REQ-005, REQ-009, REQ-010).
 *
 * A `Portal` pairs one `Door` mesh (the visual placeholder from REQ-027) with
 * its fixed destination time and a stubbed lit-versus-dark flag. The data
 * model is what later slices consume:
 *
 *   - REQ-005: portals have fixed locations and fixed destinations. The
 *     destination is a `readonly` field, and `createPortal` is the only way
 *     to set it. After construction the destination cannot mutate at runtime.
 *   - REQ-009: a lit door is enterable and sends the player to the door's
 *     fixed destination time. The runtime "send the player" half lands in a
 *     downstream traversal slice; this slice exposes the predicate that the
 *     traversal slice will gate on.
 *   - REQ-010: a dark door is a spawn-only exit. The same predicate returns
 *     false for dark portals, so traversal will refuse entry.
 *
 * NOT in scope this slice:
 *   - REQ-011: computing lit/dark from arrivals in the recorded timeline.
 *     The `isLit` field is a STUB chosen at construction. A later slice will
 *     replace the stub with a derivation over the timeline.
 *   - Traversal, collision triggers, trigger zones (REQ-009 runtime half).
 *   - Act 1 spawn pose (REQ-013).
 */

import type { DoorDirection } from "../scene/door.ts";
import type { Door } from "../scene/door.ts";

/** Hours per full day cycle. Portal destinations are written in 24-hour clock. */
export const HOURS_PER_DAY = 24;

/**
 * One portal, paired with a door mesh, with its fixed destination time.
 *
 * `destinationHours` is the canonical authoring field (e.g. 5, 6, 12) so a
 * reader can match it directly against the Act descriptions in the GDD. The
 * derived normalized form (in `[0, 1)`) is computed at read time via
 * `portalDestinationNormalized` so the two representations cannot drift.
 */
export interface Portal {
  /** The door mesh this portal is attached to. */
  readonly door: Door;
  /** Cardinal wall the door sits on. Convenience mirror of `door.direction`. */
  readonly direction: DoorDirection;
  /**
   * Fixed destination time on a 24-hour clock. Must be a finite number in
   * `[0, 24)`. Writable only via `createPortal`; the field is `readonly` so
   * runtime code cannot mutate it (REQ-005).
   */
  readonly destinationHours: number;
  /**
   * Stubbed lit/dark flag. `true` means lit (enterable, REQ-009); `false`
   * means dark (spawn-only, REQ-010). REQ-011 will derive this from the
   * timeline; until then, callers pick the value at construction.
   */
  readonly isLit: boolean;
  /**
   * Absolute tick within the destination timeline that this portal lands
   * the player at (F-014 Reading C). Per the user's 2026-05-10 design
   * pass: each door is pinned to a (timelineId, tick) destination so a
   * loop-back through this door places the player at a specific moment
   * within the destination timeline, and any ghost whose recording
   * covered that moment is fast-forwarded to its position-at-that-tick.
   * Defaults to 0 for backwards compatibility: a door whose destination
   * tick is not authored lands the player at the start of the
   * destination timeline (matches the pre-F-014 reset-to-tick-0
   * behavior).
   */
  readonly destinationTick: number;
}

export interface CreatePortalArgs {
  door: Door;
  destinationHours: number;
  isLit: boolean;
  /**
   * Optional destination tick within the destination timeline (F-014).
   * Defaults to `0` so existing portal authoring (Act 1-3 cinematic
   * scripts, test fixtures) continues to land at tick 0 of the
   * destination. A future game-design slice (PR3d) authors specific
   * destination ticks per door per the GDD.
   */
  destinationTick?: number;
}

/**
 * Builds a `Portal` from a door, a destination hour, and a lit/dark flag.
 *
 * Validates the destination is a finite number in `[0, 24)` so future slices
 * that consume `destinationHours` directly can trust the range.
 */
export function createPortal(args: CreatePortalArgs): Portal {
  const { door, destinationHours, isLit, destinationTick = 0 } = args;
  if (!Number.isFinite(destinationHours)) {
    throw new Error(
      `createPortal: destinationHours must be finite, got ${destinationHours}`,
    );
  }
  if (destinationHours < 0 || destinationHours >= HOURS_PER_DAY) {
    throw new Error(
      `createPortal: destinationHours must be in [0, ${HOURS_PER_DAY}), got ${destinationHours}`,
    );
  }
  if (!Number.isFinite(destinationTick) || destinationTick < 0) {
    throw new Error(
      `createPortal: destinationTick must be a finite non-negative number, got ${destinationTick}`,
    );
  }
  return Object.freeze({
    door,
    direction: door.direction,
    destinationHours,
    isLit,
    destinationTick,
  });
}

/**
 * Pure predicate matching REQ-009 / REQ-010: a portal is enterable iff lit.
 *
 * Kept as a free function (rather than reading `portal.isLit` directly at
 * each call site) so REQ-011 can replace the body with a timeline-derived
 * computation without changing every caller.
 */
export function isLit(portal: Portal): boolean {
  return portal.isLit;
}

/**
 * Returns the destination as a normalized `[0, 1)` value compatible with
 * `TimeOfDay.normalized()`. Computed at read time so the canonical
 * `destinationHours` field stays the single source of truth.
 */
export function portalDestinationNormalized(portal: Portal): number {
  return portal.destinationHours / HOURS_PER_DAY;
}

/**
 * Canonical Act 1 portal configuration at the 5:00 timeline state.
 *
 * Per the GDD (`docs/gdd/03-story-acts-1-3.md` and REQ-013 / REQ-014):
 *   - South door is lit and leads to 12:00.
 *   - East door is lit and leads to 6:00.
 *   - North door is dark.
 *   - West door is dark.
 *
 * Dark doors still need a destination time in the data model so the lit/dark
 * flag is the only thing that decides enterability. Dark destinations are
 * authored to where instances will EMERGE from in later acts (REQ-010 future
 * use), but until REQ-011 derives lit/dark dynamically, those values are not
 * read by any runtime code. The values picked here mirror the GDD's Act 2 and
 * Act 3 flow: the North dark door corresponds to the 12:00 cinematic exit,
 * the West dark door to the 6:00-to-5:00 return path.
 */
export interface ActOnePortalSpec {
  direction: DoorDirection;
  destinationHours: number;
  isLit: boolean;
  /**
   * F-014 / PR3d: tick within the destination timeline at which the
   * traversal lands. Zero (the previous behavior for every door) lands
   * the player at the start of the destination timeline; non-zero
   * values pin the (timeline, tick) pair so past lifetimes at the
   * destination are fast-forwarded to their position-at-arrival via
   * `GhostInstance.fastForwardTo`. Authored per the GDD's narrative
   * heuristic, not the spec text (the GDD describes events, not
   * ticks). See `docs/PROGRESS_LOG.md` PR3d entry for the heuristic
   * behind each value.
   */
  destinationTick: number;
}

export const ACT_ONE_PORTAL_SPECS: readonly ActOnePortalSpec[] = Object.freeze([
  // South at 5:00 sends to 12:00 tick 0: entering this door triggers
  // the Act 1 cinematic; the cinematic actors are filed at 12:00 with
  // startTick=0 and 240-frame recordings, so any non-zero
  // destinationTick would fast-forward them mid-cinematic on the
  // player's arrival.
  Object.freeze({
    direction: "south",
    destinationHours: 12,
    isLit: true,
    destinationTick: 0,
  }),
  // East at 5:00 sends to 6:00 tick 0: the GDD says 6:00 is "empty
  // (only the West door is lit)" the first time the player arrives.
  // No past ghosts to fast-forward.
  Object.freeze({
    direction: "east",
    destinationHours: 6,
    isLit: true,
    destinationTick: 0,
  }),
  // North at 12:00 is the Act 3 escape; the credits / end-of-game
  // beat fires right after, so the landing tick does not matter.
  Object.freeze({
    direction: "north",
    destinationHours: 12,
    isLit: false,
    destinationTick: 0,
  }),
  // West at 6:00 sends back to 5:00 at tick 30 so the player lands
  // mid-recording of their past-self ghost (the load-bearing
  // loop-back-bump invariant). 30 ticks = 0.5 s at 60 Hz: enough
  // time for the past-self to leave spawn and start walking, so
  // the returning player can see and bump the ghost mid-walk. The
  // scripted Acts 2-3 integration tests were migrated under F-015
  // to 40-frame east-walk recordings so their `door_traversal`
  // milestones fire at tick 40 > arrival 30 (past-self survives
  // the loop-back per Reading C / Q-026).
  Object.freeze({
    direction: "west",
    destinationHours: 5,
    isLit: false,
    destinationTick: 30,
  }),
]);

/**
 * Builds the four canonical Act 1 portals from a list of doors.
 *
 * The doors must include exactly one of each cardinal direction; the order
 * does not matter because the result is keyed off `door.direction`. The
 * returned array is ordered to match `ACT_ONE_PORTAL_SPECS` so the iteration
 * order is stable for tests and renderers.
 */
export function createActOnePortals(
  doors: readonly Door[],
): readonly Portal[] {
  const byDirection = new Map<DoorDirection, Door>();
  for (const door of doors) {
    if (byDirection.has(door.direction)) {
      throw new Error(
        `createActOnePortals: duplicate door for direction ${door.direction}`,
      );
    }
    byDirection.set(door.direction, door);
  }
  return Object.freeze(
    ACT_ONE_PORTAL_SPECS.map((spec) => {
      const door = byDirection.get(spec.direction);
      if (!door) {
        throw new Error(
          `createActOnePortals: missing door for direction ${spec.direction}`,
        );
      }
      return createPortal({
        door,
        destinationHours: spec.destinationHours,
        isLit: spec.isLit,
        destinationTick: spec.destinationTick,
      });
    }),
  );
}
