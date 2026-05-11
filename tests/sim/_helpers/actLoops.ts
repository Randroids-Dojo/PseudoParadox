/**
 * Shared scaffolding for the Acts 2-3 integration tests.
 *
 * Cleanup round 1 (post-PR3 sequence) extracts the canonical loop
 * helpers and input primitives that were duplicated across eight act
 * test files. The slice-discipline rule says wait for the third
 * repetition before extracting; we are well past that bar so the
 * extraction is overdue.
 *
 * The helpers operate against the minimal `RunLoopHarness` shape
 * (just `lifetime` and `registry`) so callers can pass any harness
 * that exposes those two fields, regardless of how the test file
 * builds its scene / world / player.
 */

import { type ActiveLifetime } from "../../../src/sim/portalTraversal.ts";
import { type TimelineRegistry } from "../../../src/sim/timelineRegistry.ts";
import { type createPortalTriggerSet } from "../../../src/sim/portalTrigger.ts";
import { type GhostInstance } from "../../../src/sim/ghostInstance.ts";
import { type KeyState } from "../../../src/input/keyboard.ts";
import { ROOM_DIMENSIONS } from "../../../src/scene/room.ts";

export const HALF_WIDTH = ROOM_DIMENSIONS.width / 2;

export const NEUTRAL: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  punch: false,
  pickup: false,
  throw: false,
};

export const inputState = (overrides: Partial<KeyState>): KeyState => ({
  ...NEUTRAL,
  ...overrides,
});

/**
 * Minimal harness shape used by the loop helpers. Tests typically
 * build a larger harness (`Harness` with scene / world / player /
 * portals); this interface narrows to just what the helpers touch.
 */
export interface RunLoopHarness {
  readonly lifetime: ActiveLifetime;
  readonly registry: TimelineRegistry;
}

/**
 * Drive the canonical Act 2 first-loop sequence. The active lifetime
 * walks East from 5:00 (40 recorded frames, F-015 length), crosses
 * the East trigger to traverse to 6:00, then walks West (4 frames)
 * and crosses the West trigger to traverse back to 5:00. After this
 * call returns: active timeline is 5, bucket 5 holds ghost-A
 * (East-bound, instanceId = 1) fast-forwarded to West.destinationTick
 * = 30 ticks per F-014, and ghost-A's `tickIndex` is past the end of
 * its recording (advanceTick was called `recording.length` times so
 * `tickIndex >= recording.length`).
 */
export const runLoopOne = (
  harness: RunLoopHarness,
  detector: ReturnType<typeof createPortalTriggerSet>,
  startTick: number,
): { tick: number; ghostA: GhostInstance } => {
  const { lifetime, registry } = harness;
  let tick = startTick;
  detector.step(0, 0, tick++);
  for (let i = 0; i < 40; i++) {
    lifetime.recorder.record(inputState({ right: true }), 5 / 24);
  }
  detector.step(HALF_WIDTH - 0.4, 0, tick++);
  detector.step(0, 0, tick++);
  for (let i = 0; i < 4; i++) {
    lifetime.recorder.record(inputState({ left: true }), 6 / 24);
  }
  detector.step(-(HALF_WIDTH - 0.4), 0, tick++);
  const ghostA = registry.ghostsFor(5)[0];
  if (!ghostA) {
    throw new Error(
      "runLoopOne precondition failed: expected at least one ghost in bucket 5 after west traversal back to 5:00",
    );
  }
  for (let i = 0; i < ghostA.recording.length; i++) {
    ghostA.advanceTick();
  }
  return { tick, ghostA };
};
