/**
 * Tests for the facing tracker (REQ-036 partial / Q-007 default).
 *
 * The throw mechanic needs a deterministic facing direction. This file
 * pins:
 *   - `DEFAULT_FACING` is north (`{ x: 0, z: -1 }`).
 *   - `facingFromVelocity` normalizes a non-zero velocity to a unit
 *     direction, returns `null` for zero / sub-epsilon vectors.
 *   - The tracker caches the last non-zero facing across update calls,
 *     leaves the cache untouched on zero ticks, and resets to the
 *     default on `reset()`.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FACING,
  createFacingTracker,
  facingFromVelocity,
} from "../../src/sim/facing.ts";

describe("DEFAULT_FACING: REQ-036 / Q-007 default", () => {
  it("is north (-z), matching the keyboard layer's forward = -z convention", () => {
    expect(DEFAULT_FACING).toEqual({ x: 0, z: -1 });
  });
});

describe("facingFromVelocity: REQ-036 normalization helper", () => {
  it("returns null for an exactly-zero velocity (the cache should be preserved on zero ticks)", () => {
    expect(facingFromVelocity({ x: 0, z: 0 })).toBeNull();
  });

  it("returns null for a sub-epsilon velocity (integrator jitter does not overwrite)", () => {
    expect(facingFromVelocity({ x: 1e-6, z: 0 })).toBeNull();
    expect(facingFromVelocity({ x: 0, z: 1e-6 })).toBeNull();
  });

  it("normalizes a unit-length velocity to itself", () => {
    expect(facingFromVelocity({ x: 1, z: 0 })).toEqual({ x: 1, z: 0 });
    expect(facingFromVelocity({ x: 0, z: -1 })).toEqual({ x: 0, z: -1 });
  });

  it("normalizes a non-unit velocity to a unit vector", () => {
    const facing = facingFromVelocity({ x: 4, z: 0 });
    expect(facing).not.toBeNull();
    expect(facing!.x).toBeCloseTo(1, 12);
    expect(facing!.z).toBeCloseTo(0, 12);
  });

  it("normalizes a diagonal velocity to a unit-length diagonal facing", () => {
    const facing = facingFromVelocity({ x: 3, z: 4 });
    expect(facing).not.toBeNull();
    expect(facing!.x).toBeCloseTo(0.6, 12);
    expect(facing!.z).toBeCloseTo(0.8, 12);
    expect(facing!.x * facing!.x + facing!.z * facing!.z).toBeCloseTo(1, 12);
  });
});

describe("createFacingTracker: REQ-036 mutable handle", () => {
  it("starts at DEFAULT_FACING (north) before any update", () => {
    const tracker = createFacingTracker();
    expect(tracker.current).toEqual({ x: 0, z: -1 });
  });

  it("updates the cache on the first non-zero velocity", () => {
    const tracker = createFacingTracker();
    tracker.update({ x: 4, z: 0 });
    expect(tracker.current.x).toBeCloseTo(1, 12);
    expect(tracker.current.z).toBeCloseTo(0, 12);
  });

  it("preserves the cache on zero-velocity ticks (the player kept facing where they last walked)", () => {
    const tracker = createFacingTracker();
    tracker.update({ x: 4, z: 0 }); // east
    tracker.update({ x: 0, z: 0 }); // stopped
    expect(tracker.current.x).toBeCloseTo(1, 12);
    expect(tracker.current.z).toBeCloseTo(0, 12);
  });

  it("overwrites the cache when a new non-zero velocity arrives", () => {
    const tracker = createFacingTracker();
    tracker.update({ x: 4, z: 0 }); // east
    tracker.update({ x: 0, z: 4 }); // south
    expect(tracker.current.x).toBeCloseTo(0, 12);
    expect(tracker.current.z).toBeCloseTo(1, 12);
  });

  it("reset() returns the cache to DEFAULT_FACING (REQ-025 hard reset semantics)", () => {
    const tracker = createFacingTracker();
    tracker.update({ x: 0, z: 4 }); // south
    tracker.reset();
    expect(tracker.current).toEqual({ x: 0, z: -1 });
  });
});
