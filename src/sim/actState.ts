/**
 * Act-progress observer plus per-beat pure predicates (REQ-024 partial).
 *
 * The act-progress observer is the central data structure that turns the
 * time-travel substrate plus the combat surface into a finishable level. It
 * watches world state every fixed simulation tick and reports the highest
 * narrative beat the player has reached.
 *
 * `docs/gdd/40-act-progress-and-narrative-beats.md` sections 3 and 4 are the
 * canonical spec. Section 3 covers the data model (the `ActState` chain,
 * the snapshot shape, the observer's monotonic watermark, the recent-West
 * entries ring buffer used by the chase predicate). Section 4 defines each
 * per-beat predicate as a pure function over the snapshot.
 *
 * Defaults consumed:
 *   - Q-014: `DROP_CENTER_RADIUS_M = 1.0`. The Act 3 mirror beat's drop
 *     tolerance.
 *   - Q-022: observer-only enforcement. The observer reports the highest
 *     reachable state; the host does NOT refuse player actions that would
 *     skip a beat. The world's lit/dark gates already enforce beat ordering.
 *
 * NOT in scope this slice:
 *   - Wiring the observer into `src/app.ts`. The per-beat slices (REQ-016
 *     through REQ-023) wire each beat in turn.
 *   - Exposing the observer via a debug `window.__pseudoParadoxActState`
 *     hook. That lands with REQ-040's E2E completability slice.
 */

import type { TimelineId } from "./timelineRegistry.ts";
import { timelineIdFromNormalized } from "./timelineRegistry.ts";
import type { CarryState } from "./carryState.ts";
import type { Consciousness } from "./knockoutState.ts";
import type { InstanceId } from "./instanceId.ts";

// =============================================================================
// Section 3: ActState chain plus observer data model
// =============================================================================

/**
 * Linear chain of narrative beats. Order is significant: index N is reachable
 * only if index N-1 was reached at some point during the current simulation
 * lifetime.
 *
 *   - `not-started`: observer initial state, before Act 1 spawn.
 *   - `act-1-spawn`: the player has spawned at 5:00 with the cinematic
 *     ghosts already mounted in the 12:00 bucket.
 *   - `act-2-loop-1`: the player walked East from 5:00 to 6:00 and West
 *     back to 5:00; the You-1 ghost replays the East-bound walk.
 *   - `act-2-loop-2`: the player knocked out You-1 on return to 5:00 and
 *     dragged the body East to 6:00, ending unconscious at 6:00.
 *   - `act-3-setup`: the watermark is past `act-2-loop-2` and the player
 *     has returned to 5:00 with at least one unconscious ghost in 6:00.
 *   - `act-3-chase`: two distinct instances entered the West portal at
 *     5:00 within a small tick window (the chase beat).
 *   - `act-3-team-up`: an unconscious instance whose origin timeline is 5
 *     is present in the active 5:00 bucket (the 5:00 instance got knocked
 *     out by the team).
 *   - `act-3-mirror`: an unconscious body has been carried into 12:00 and
 *     placed within `DROP_CENTER_RADIUS_M` of the room origin.
 *   - `act-3-final-knockout`: the 12:00 bucket holds at least two
 *     unconscious bodies (the mirror body plus the instance brought from
 *     6:00, knocked out post-traversal).
 *   - `escaped`: the active player crossed the North door at 12:00 with
 *     the cinematic actors completed and the watermark at the final
 *     knockout. Terminal state.
 */
export type ActState =
  | "not-started"
  | "act-1-spawn"
  | "act-2-loop-1"
  | "act-2-loop-2"
  | "act-3-setup"
  | "act-3-chase"
  | "act-3-team-up"
  | "act-3-mirror"
  | "act-3-final-knockout"
  | "escaped";

/**
 * Linear chain in priority order. The observer walks the chain from highest
 * to lowest and returns the first beat whose predicate succeeds. Index in
 * this array is also the watermark integer used for monotonicity checks.
 */
export const ACT_STATE_CHAIN: readonly ActState[] = [
  "not-started",
  "act-1-spawn",
  "act-2-loop-1",
  "act-2-loop-2",
  "act-3-setup",
  "act-3-chase",
  "act-3-team-up",
  "act-3-mirror",
  "act-3-final-knockout",
  "escaped",
] as const;

/**
 * Initial state for a freshly-built observer. Returned by `hardReset` so a
 * cleared observer reads as if no beat had ever been reached.
 */
export const INITIAL_ACT_STATE: ActState = "not-started";

/**
 * Drop-center radius for the Act 3 mirror beat (Q-014 default). The body
 * must come to rest within this planar XZ distance of the room origin to
 * count as "dropped in the center." Tight enough that "dropped near a
 * wall" does not satisfy; loose enough that the player does not need to
 * land at exactly the origin.
 */
export const DROP_CENTER_RADIUS_M = 1.0;

/**
 * Window length for the chase-beat ring buffer (REQ-019). Two distinct
 * instances entering the West portal trigger within this many simulation
 * ticks satisfy `isAct3Chase`. The dossier's recommended default is two
 * ticks: the chase beat reads as "the same frame" with one tick of slack
 * to absorb tick-boundary races between the active player and a ghost.
 */
export const CHASE_WINDOW_TICKS = 2;

/**
 * Capacity of the recent-West-entries ring buffer. Capped to four so the
 * structure stays small and bounded; the chase predicate's window is two
 * ticks so four slots is more than enough headroom.
 */
export const RECENT_WEST_ENTRIES_CAPACITY = 4;

/**
 * One West-portal entry event. Recorded by the host's portal-trigger hook
 * as `instanceId` plus the simulation `tick` at the moment of the entry.
 * The observer reads the buffer to detect the chase beat (REQ-019).
 */
export interface WestEntry {
  readonly instanceId: InstanceId;
  readonly tick: number;
}

/**
 * Minimal projection of an active-timeline instance the observer needs.
 * The active player and every active-timeline ghost are flattened into the
 * same shape so predicates can iterate uniformly.
 *
 * Inactive-timeline ghosts are NOT included; the observer only sees what is
 * actively playing. The snapshot's `registry` provides per-timeline ghost
 * lists for predicates that need to read non-active buckets.
 */
export interface InstanceSnapshot {
  readonly id: InstanceId;
  readonly position: { readonly x: number; readonly z: number };
  readonly consciousness: Consciousness;
  /** Origin normalized time-of-day in [0, 1]; mirrors the ghost's tint. */
  readonly originNormalized: number;
}

/**
 * Read-only snapshot of the active player handle's relevant fields.
 */
export interface ActivePlayerSnapshot {
  readonly instanceId: InstanceId;
  readonly position: { readonly x: number; readonly z: number };
  readonly consciousness: Consciousness;
  readonly carry: CarryState;
}

/**
 * Read-only snapshot of an unconscious ghost in a timeline bucket the
 * observer needs to inspect. Predicates use this projection to check the
 * "unconscious-and-positioned" half of beats like the mirror beat.
 */
export interface BucketGhostSnapshot {
  readonly id: InstanceId;
  readonly position: { readonly x: number; readonly z: number };
  readonly consciousness: Consciousness;
  /** Origin normalized time-of-day (the timeline this ghost was recorded in). */
  readonly originNormalized: number;
  /** Tick the ghost is currently replaying. */
  readonly tickIndex: number;
  /** Length of the ghost's recording in ticks. */
  readonly recordingLength: number;
}

/**
 * Read-only registry projection. The observer needs `ghostsFor(timeline)`
 * to read non-active buckets (e.g., the 12:00 bucket from a 5:00 active
 * timeline) plus the count of ghosts in the 12:00 bucket for the cinematic
 * predicate. The shape mirrors the live `TimelineRegistry`'s relevant
 * surface so the host can build the projection cheaply.
 */
export interface RegistrySnapshot {
  readonly activeTimeline: TimelineId;
  ghostsFor: (timeline: TimelineId) => readonly BucketGhostSnapshot[];
}

/**
 * Full snapshot consumed by `evaluateActState`. The host builds this once
 * per fixed-step tick and threads the observer's stored watermark through
 * via `evaluateActState(snapshot, watermark)`.
 */
export interface ActStateSnapshot {
  readonly registry: RegistrySnapshot;
  readonly instances: readonly InstanceSnapshot[];
  readonly currentTimeline: TimelineId;
  readonly activePlayer: ActivePlayerSnapshot;
  /**
   * Recent West-portal entries (ring buffer view). The chase predicate
   * reads this to detect two distinct instance ids entering the West
   * trigger within `CHASE_WINDOW_TICKS` of each other.
   */
  readonly recentWestEntries: readonly WestEntry[];
  /**
   * True iff the active player crossed the North trigger volume at 12:00
   * since the watermark last advanced. Computed by the host from the
   * portal-trigger callback; the observer only consumes the boolean.
   */
  readonly activePlayerCrossedNorthAt12: boolean;
}

/**
 * Pure helper: integer index of `state` in the linear chain. Used for the
 * monotonicity comparison in `update`. Throws on an unknown state so the
 * caller cannot ship a typo silently.
 */
export function actStateIndex(state: ActState): number {
  const i = ACT_STATE_CHAIN.indexOf(state);
  if (i < 0) {
    throw new Error(`actStateIndex: unknown state '${state}'`);
  }
  return i;
}

/**
 * Pure helper: returns the higher of two `ActState` values per the chain
 * order. `maxActState('act-3-chase', 'act-1-spawn') === 'act-3-chase'`.
 * Used by the observer to enforce monotonicity: the observer never returns
 * a state lower than the watermark.
 */
export function maxActState(a: ActState, b: ActState): ActState {
  return actStateIndex(a) >= actStateIndex(b) ? a : b;
}

// =============================================================================
// Section 4: Per-beat pure predicates
// =============================================================================

/**
 * REQ-012 (Act 1 cinematic). The cinematic is a one-shot at game start; once
 * the player has spawned at 5:00 with the scripted-actor recordings mounted
 * in the 12:00 bucket, the cinematic has been satisfied. The dossier specs
 * three ghosts in the 12:00 bucket (two draggers plus the knocked-out body)
 * plus the active player at the 5:00 timeline.
 */
export function isAct1Spawn(snapshot: ActStateSnapshot): boolean {
  if (snapshot.currentTimeline !== 5) return false;
  return snapshot.registry.ghostsFor(12).length >= 3;
}

/**
 * REQ-016 (Act 2 first loop). The player walked East from 5:00 to 6:00 and
 * West back to 5:00, so the 5:00 bucket holds the recording of the
 * East-bound walk and the 6:00 bucket holds the West-bound return. On
 * re-entry to 5:00 the You-1 ghost replays the East-bound walk; the
 * predicate succeeds when both buckets carry at least one ghost AND the
 * 5:00-bucket ghosts have replayed past their recordings (the "and
 * disappears" half of the beat).
 */
export function isAct2Loop1(snapshot: ActStateSnapshot): boolean {
  if (snapshot.currentTimeline !== 5) return false;
  const ghosts5 = snapshot.registry.ghostsFor(5);
  const ghosts6 = snapshot.registry.ghostsFor(6);
  if (ghosts5.length < 1) return false;
  if (ghosts6.length < 1) return false;
  return allGhostsAtRest(ghosts5);
}

/**
 * REQ-017 (Act 2 second loop). After knocking out You-1 on return to 5:00
 * and dragging the body East to 6:00, the active player ends a lifetime at
 * 6:00 in `unconscious` state. The detection signal is the snapshot's
 * current state: active player at 6:00 unconscious, at least one
 * unconscious ghost in the 5:00 bucket, and at least one ghost in the 6:00
 * bucket (typically the carried body, or the active player's prior
 * lifetime).
 */
export function isAct2Loop2(snapshot: ActStateSnapshot): boolean {
  if (snapshot.currentTimeline !== 6) return false;
  if (snapshot.activePlayer.consciousness !== "unconscious") return false;
  const ghosts5 = snapshot.registry.ghostsFor(5);
  const ghosts6 = snapshot.registry.ghostsFor(6);
  if (!ghosts5.some((g) => g.consciousness === "unconscious")) return false;
  return ghosts6.length >= 1;
}

/**
 * REQ-018 (Act 3 setup). The player has repeated the Act 2 sequence and is
 * back at 5:00 waiting for the 6:00 instance to wake. The predicate reads
 * the destination state: active timeline is 5, there is at least one
 * unconscious ghost in the 6:00 bucket (the body left there by Act 2 loop
 * 2). The watermark guard is applied OUTSIDE the predicate by the
 * observer's monotonic combine; this predicate stays pure with respect to
 * the snapshot only.
 */
export function isAct3Setup(snapshot: ActStateSnapshot): boolean {
  if (snapshot.currentTimeline !== 5) return false;
  return snapshot.registry
    .ghostsFor(6)
    .some((g) => g.consciousness === "unconscious");
}

/**
 * REQ-019 (Act 3 chase beat). Two distinct instance ids enter the West
 * portal trigger within `CHASE_WINDOW_TICKS` of each other. The host
 * populates `recentWestEntries` from the portal-trigger overlap hook; the
 * predicate scans the buffer for two entries whose tick delta is within the
 * window and whose instance ids differ.
 */
export function isAct3Chase(snapshot: ActStateSnapshot): boolean {
  if (snapshot.currentTimeline !== 5) return false;
  const entries = snapshot.recentWestEntries;
  if (entries.length < 2) return false;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.instanceId === b.instanceId) continue;
      if (Math.abs(a.tick - b.tick) <= CHASE_WINDOW_TICKS) return true;
    }
  }
  return false;
}

/**
 * REQ-020 (Act 3 team-up beat). Two instances at 5:00 coordinate to knock
 * out the 5:00 instance. The predicate reads: at least one unconscious
 * ghost in the 5:00 bucket whose origin timeline is also 5 (i.e., the
 * instance that lived at 5:00 was the one knocked out).
 */
export function isAct3TeamUp(snapshot: ActStateSnapshot): boolean {
  if (snapshot.currentTimeline !== 5) return false;
  return snapshot.registry.ghostsFor(5).some(
    (g) =>
      g.consciousness === "unconscious" &&
      timelineIdFromNormalized(g.originNormalized) === 5,
  );
}

/**
 * REQ-021 (Act 3 mirror beat). The player has dragged the knocked-out 5:00
 * instance South to 12:00 and dropped the body in the center of the room.
 * The predicate reads: active timeline is 12, the active player is idle
 * (just dropped the body), and the 12:00 bucket holds at least one
 * unconscious ghost within `DROP_CENTER_RADIUS_M` of the room origin.
 */
export function isAct3Mirror(snapshot: ActStateSnapshot): boolean {
  if (snapshot.currentTimeline !== 12) return false;
  if (snapshot.activePlayer.carry.kind !== "idle") return false;
  return snapshot.registry.ghostsFor(12).some(
    (g) =>
      g.consciousness === "unconscious" &&
      planarDistance(g.position, { x: 0, z: 0 }) <= DROP_CENTER_RADIUS_M,
  );
}

/**
 * REQ-022 (Act 3 second knockout). The player knocks out the instance
 * brought from 6:00 inside the 12:00 timeline. The predicate reads: at
 * 12:00 there are now TWO unconscious ghosts (the mirror body plus the
 * 6:00 instance, just knocked out post-traversal).
 */
export function isAct3FinalKnockout(snapshot: ActStateSnapshot): boolean {
  if (snapshot.currentTimeline !== 12) return false;
  return (
    snapshot.registry
      .ghostsFor(12)
      .filter((g) => g.consciousness === "unconscious").length >= 2
  );
}

/**
 * REQ-023 (Act 3 escape). The active player crossed the North door at
 * 12:00 with the cinematic actors completed. The predicate reads three
 * conditions: timeline is 12, the host signaled a North-trigger crossing
 * since the last watermark advance, and every cinematic-actor ghost in
 * the 12:00 bucket has completed its recording. The watermark guard
 * (Act 3 final knockout already reached) is applied OUTSIDE the predicate
 * by the observer's monotonic combine.
 */
export function isEscaped(snapshot: ActStateSnapshot): boolean {
  if (snapshot.currentTimeline !== 12) return false;
  if (!snapshot.activePlayerCrossedNorthAt12) return false;
  return allCinematicActorsCompleted(snapshot.registry.ghostsFor(12));
}

/**
 * Pure helper: planar XZ distance between two points. Inlined here rather
 * than imported from a `math` module because the carry and punch layers
 * each compute their own variant; the slice-discipline rule waits for the
 * third repetition before extracting.
 */
export function planarDistance(
  a: { readonly x: number; readonly z: number },
  b: { readonly x: number; readonly z: number },
): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Pure helper: a ghost is "at rest" iff its tick index has reached or
 * passed the end of its recording. Used by `isAct2Loop1` to detect that
 * the You-1 ghost has finished walking West.
 */
function allGhostsAtRest(
  ghosts: readonly BucketGhostSnapshot[],
): boolean {
  return ghosts.every((g) => g.tickIndex >= g.recordingLength);
}

/**
 * Pure helper: every cinematic-actor ghost in the 12:00 bucket has
 * completed its recording. Used by `isEscaped` to gate the North door's
 * "open" state per the dossier section 4 REQ-023 pseudocode.
 */
function allCinematicActorsCompleted(
  ghosts: readonly BucketGhostSnapshot[],
): boolean {
  if (ghosts.length === 0) return false;
  return ghosts.every((g) => g.tickIndex >= g.recordingLength);
}

/**
 * Maps each non-`not-started` `ActState` to its predicate. Order is
 * irrelevant here; `evaluateActState` walks `ACT_STATE_CHAIN` to find the
 * highest passing beat.
 */
const PREDICATES: Readonly<
  Record<Exclude<ActState, "not-started">, (s: ActStateSnapshot) => boolean>
> = {
  "act-1-spawn": isAct1Spawn,
  "act-2-loop-1": isAct2Loop1,
  "act-2-loop-2": isAct2Loop2,
  "act-3-setup": isAct3Setup,
  "act-3-chase": isAct3Chase,
  "act-3-team-up": isAct3TeamUp,
  "act-3-mirror": isAct3Mirror,
  "act-3-final-knockout": isAct3FinalKnockout,
  escaped: isEscaped,
};

/**
 * Pure entry point: walks the linear chain from highest to lowest and
 * returns the highest beat whose predicate succeeds. `watermark` floors the
 * result: the function never returns a state lower than the watermark even
 * if no predicate currently succeeds (which preserves the dossier's
 * monotonicity contract from inside the pure function as well as from the
 * observer's mutable wrapper).
 *
 * Returns `INITIAL_ACT_STATE` ("not-started") iff no predicate succeeds AND
 * the watermark is also `not-started`.
 */
export function evaluateActState(
  snapshot: ActStateSnapshot,
  watermark: ActState = INITIAL_ACT_STATE,
): ActState {
  // Once `escaped` has been reached the chain terminates: the observer
  // does not regress out of the terminal state for any reason.
  if (watermark === "escaped") return "escaped";
  for (let i = ACT_STATE_CHAIN.length - 1; i > 0; i--) {
    const candidate = ACT_STATE_CHAIN[i] as Exclude<ActState, "not-started">;
    if (PREDICATES[candidate](snapshot)) {
      return maxActState(candidate, watermark);
    }
  }
  return watermark;
}

// =============================================================================
// Observer wrapper: watermark plus West-entries ring buffer
// =============================================================================

/**
 * Observer instance. Owns the watermark plus the recent-West-entries ring
 * buffer (the only mutable state in the system). `update(snapshot)` reads
 * the snapshot, advances the watermark monotonically, and returns the
 * current `ActState`. `hardReset()` clears both the watermark and the ring
 * buffer back to seed values.
 *
 * The observer is intentionally NOT a free function: the watermark and the
 * West-entries buffer have to live somewhere across ticks, and an instance
 * keeps that state encapsulated without introducing module-level mutability.
 * `evaluateActState` (the pure function) is exposed separately for tests
 * that want to drive the predicate chain without owning an observer.
 */
export interface ActStateObserver {
  readonly state: ActState;
  /**
   * Drive one tick of observation. Reads the snapshot, advances the
   * watermark to the highest beat whose predicate currently succeeds, and
   * returns the new state. Idempotent on a no-change snapshot: same input
   * yields same output.
   */
  update: (snapshot: ActStateSnapshot) => ActState;
  /**
   * Append a West-portal entry to the ring buffer. Older entries are
   * discarded once the buffer fills past `RECENT_WEST_ENTRIES_CAPACITY`.
   * The host calls this from the portal-trigger overlap callback when the
   * active player (or a ghost) enters the West trigger at the active
   * timeline; the observer reads the buffer via the snapshot.
   */
  recordWestEntry: (entry: WestEntry) => void;
  /**
   * Read-only view of the ring buffer. Returned by value as a defensive
   * snapshot so callers cannot mutate the underlying buffer.
   */
  recentWestEntries: () => readonly WestEntry[];
  /**
   * Reset the observer to the initial seed state: watermark to
   * `not-started`, ring buffer cleared. Called by `hardReset`.
   */
  hardReset: () => void;
}

/**
 * Build a fresh observer with `state === 'not-started'` and an empty ring
 * buffer. Pure factory; the returned object owns the only writable state.
 */
export function createActStateObserver(): ActStateObserver {
  let watermark: ActState = INITIAL_ACT_STATE;
  let westEntries: WestEntry[] = [];

  return {
    get state(): ActState {
      return watermark;
    },
    update: (snapshot) => {
      const nextEvaluated = evaluateActState(snapshot, watermark);
      // Monotonic: never regress below the current watermark. The dossier
      // section 3.1: "a transition from S_i to S_j is allowed iff every
      // state on the path has had its predicate read true." Since the
      // chain is linear and `evaluateActState` returns the highest
      // currently-passing predicate (already floored by `watermark`), a
      // direct assignment is sufficient.
      watermark = maxActState(watermark, nextEvaluated);
      return watermark;
    },
    recordWestEntry: (entry) => {
      westEntries.push(entry);
      if (westEntries.length > RECENT_WEST_ENTRIES_CAPACITY) {
        westEntries = westEntries.slice(-RECENT_WEST_ENTRIES_CAPACITY);
      }
    },
    recentWestEntries: () => westEntries.slice(),
    hardReset: () => {
      watermark = INITIAL_ACT_STATE;
      westEntries = [];
    },
  };
}
