/**
 * Instance generation numbering (REQ-007 / REQ-008 foundation).
 *
 * The GDD anchors this in `docs/gdd/02-time-travel-rules.md` Instance numbering
 * section:
 *
 *   - You1 is always the first-ever spawn (the seed instance, the one the
 *     player starts as in Act 1).
 *   - You-1 is the instance You1 sees arrive (the first replay).
 *   - You-2 is the instance You-1 sees arrive (the second-order replay).
 *   - The player always controls the most recently spawned active instance.
 *
 * Internally we represent the generation as a positive monotonic integer:
 *
 *   - 1 -> You1   (the first-ever active instance)
 *   - 2 -> You-1  (the first replay; arrived after one portal traversal)
 *   - 3 -> You-2  (the second-order replay; arrived after two traversals)
 *   - ...
 *
 * On every lit-portal traversal the OUTGOING active instance becomes a ghost
 * carrying its current `InstanceId` (so a future thought-bubble UI can label
 * it with `formatInstanceId`), and the INCOMING active instance is a fresh
 * generation: `previousId + 1`. Hard reset (REQ-025) returns the active
 * player to `INITIAL_INSTANCE_ID = 1` (the next spawn is again You1).
 *
 * NOT in scope this slice:
 *   - UI rendering of the instance ID. The label is data only here. The
 *     overlay UI lands with REQ-032 (thought bubbles).
 *   - Persistence across level restarts. The simulation is session-local.
 */

/**
 * Generation index for an instance. Positive monotonic integer starting at 1.
 *
 *   - 1 represents "You1"   (the seed instance).
 *   - 2 represents "You-1"  (the first replay).
 *   - 3 represents "You-2"  (the second-order replay).
 *
 * The numeric type is a thin alias rather than a branded nominal type so the
 * value can flow through the existing `number` channels (test fixtures, body
 * userData, debug logs) without ceremony. The `format` and `next` helpers
 * are the canonical way to derive a display label or the next generation.
 */
export type InstanceId = number;

/**
 * The seed instance. Every fresh game (and every hard reset) starts here.
 * The value is `1` because the GDD's first-ever spawn is "You1" (one, not
 * zero). Keeping the math grounded at 1 also makes `formatInstanceId(1)`
 * read as "You1" without an off-by-one.
 */
export const INITIAL_INSTANCE_ID: InstanceId = 1;

/**
 * Format an `InstanceId` as the GDD-canonical display label:
 *
 *   formatInstanceId(1) === "You1"
 *   formatInstanceId(2) === "You-1"
 *   formatInstanceId(3) === "You-2"
 *   formatInstanceId(4) === "You-3"
 *
 * Quoting `docs/gdd/02-time-travel-rules.md` Instance numbering:
 *   "You1 is always the first-ever spawn... You-1 is the instance You1 sees
 *    arrive (the first replay). You-2 is the instance You-1 sees arrive
 *    (the second-order replay)."
 *
 * Throws on non-integer or non-positive inputs so a caller cannot ship a
 * `formatInstanceId(0)` reading as "You-1" (that would conflict with the
 * GDD's intent that "You-1" is the FIRST replay, not the seed instance).
 */
export function formatInstanceId(id: InstanceId): string {
  if (!Number.isInteger(id)) {
    throw new Error(
      `formatInstanceId requires an integer InstanceId, got ${id}`,
    );
  }
  if (id < 1) {
    throw new Error(
      `formatInstanceId requires a positive InstanceId (>= 1), got ${id}`,
    );
  }
  if (id === 1) return "You1";
  return `You-${id - 1}`;
}

/**
 * Return the next generation after `id`. Pure; the caller decides where to
 * write the new value (active player handle, lifetime, ghost). Used by the
 * portal traversal handler: on a lit entry the OUTGOING active's id becomes
 * the spawned ghost's id, and the INCOMING active's id is `nextInstanceId`
 * of the outgoing.
 *
 * Throws on non-integer or non-positive inputs to match `formatInstanceId`.
 */
export function nextInstanceId(id: InstanceId): InstanceId {
  if (!Number.isInteger(id)) {
    throw new Error(`nextInstanceId requires an integer InstanceId, got ${id}`);
  }
  if (id < 1) {
    throw new Error(
      `nextInstanceId requires a positive InstanceId (>= 1), got ${id}`,
    );
  }
  return id + 1;
}
