import { describe, expect, it } from "vitest";
import { buildActStateSnapshot } from "../../src/sim/actStateSnapshot.ts";
import type {
  TimelineId,
  TimelineRegistry,
} from "../../src/sim/timelineRegistry.ts";
import type { GhostInstance } from "../../src/sim/ghostInstance.ts";
import type { ActivePlayerHandle } from "../../src/sim/portalTraversal.ts";
import type { CarryState } from "../../src/sim/carryState.ts";

// Minimal stubs: `buildActStateSnapshot` only reads a narrow slice of
// each handle (translation, activeTimeline, ghostsFor) so we avoid
// spinning up Rapier / THREE for a pure-projection test.

const stubPlayer = (
  x: number,
  z: number,
  instanceId: number = 1,
): ActivePlayerHandle =>
  ({
    instanceId,
    body: { translation: () => ({ x, y: 0.9, z }) },
    consciousness: "conscious",
    carry: { kind: "idle" } as CarryState,
  }) as unknown as ActivePlayerHandle;

const stubRegistry = (
  activeTimeline: TimelineId,
  bucketsByHour: ReadonlyMap<TimelineId, readonly GhostInstance[]> = new Map(),
): TimelineRegistry =>
  ({
    activeTimeline,
    ghostsFor: (timeline: TimelineId) => bucketsByHour.get(timeline) ?? [],
  }) as unknown as TimelineRegistry;

describe("buildActStateSnapshot (F-019)", () => {
  it("projects the active player position from the body translation", () => {
    const snap = buildActStateSnapshot(stubRegistry(5), stubPlayer(2, -1));
    expect(snap.activePlayer.position).toEqual({ x: 2, z: -1 });
    expect(snap.activePlayer.instanceId).toBe(1);
  });

  it("threads `recentWestEntries` through unchanged", () => {
    const entries = [{ instanceId: 1, tick: 17 }] as const;
    const snap = buildActStateSnapshot(stubRegistry(5), stubPlayer(0, 0), {
      recentWestEntries: entries,
    });
    expect(snap.recentWestEntries).toBe(entries);
  });

  it("defaults `activePlayerCrossedNorthAt12` to false when omitted", () => {
    const snap = buildActStateSnapshot(stubRegistry(12), stubPlayer(0, 0));
    expect(snap.activePlayerCrossedNorthAt12).toBe(false);
  });

  it("threads `activePlayerCrossedNorthAt12` through when passed", () => {
    const snap = buildActStateSnapshot(stubRegistry(12), stubPlayer(0, 0), {
      activePlayerCrossedNorthAt12: true,
    });
    expect(snap.activePlayerCrossedNorthAt12).toBe(true);
  });

  it("uses the registry's active timeline as `currentTimeline`", () => {
    const snap = buildActStateSnapshot(stubRegistry(6), stubPlayer(0, 0));
    expect(snap.currentTimeline).toBe(6);
    expect(snap.registry.activeTimeline).toBe(6);
  });

  it("returns an empty `ghostsFor(timeline)` for unvisited timelines", () => {
    const snap = buildActStateSnapshot(stubRegistry(5), stubPlayer(0, 0));
    expect(snap.registry.ghostsFor(12)).toEqual([]);
    expect(snap.registry.ghostsFor(5)).toEqual([]);
  });
});
