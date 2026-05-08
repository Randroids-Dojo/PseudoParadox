import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  COOL_ANCHOR_HEX,
  WARM_ANCHOR_HEX,
  interpolateWarmToCool,
} from "../../src/render/colorTint.ts";

const WARM = new THREE.Color(WARM_ANCHOR_HEX);
const COOL = new THREE.Color(COOL_ANCHOR_HEX);

const expectColorClose = (
  actual: THREE.Color,
  expected: THREE.Color,
  tolerance = 1e-6,
): void => {
  expect(actual.r).toBeCloseTo(expected.r, 6);
  expect(actual.g).toBeCloseTo(expected.g, 6);
  expect(actual.b).toBeCloseTo(expected.b, 6);
  // Tolerance is exposed so future REQ-030 callers can dial precision if
  // a coarser grid of instance tints needs forgiving comparisons.
  void tolerance;
};

describe("interpolateWarmToCool", () => {
  it("returns the warm anchor at t = 0", () => {
    expectColorClose(interpolateWarmToCool(0), WARM);
  });

  it("returns the cool anchor at t = 1", () => {
    expectColorClose(interpolateWarmToCool(1), COOL);
  });

  it("returns the channelwise midpoint at t = 0.5", () => {
    const mid = interpolateWarmToCool(0.5);
    expect(mid.r).toBeCloseTo((WARM.r + COOL.r) / 2, 6);
    expect(mid.g).toBeCloseTo((WARM.g + COOL.g) / 2, 6);
    expect(mid.b).toBeCloseTo((WARM.b + COOL.b) / 2, 6);
  });

  it("clamps inputs below 0 to the warm anchor", () => {
    expectColorClose(interpolateWarmToCool(-0.5), WARM);
  });

  it("clamps inputs above 1 to the cool anchor", () => {
    expectColorClose(interpolateWarmToCool(1.7), COOL);
  });

  it("returns a fresh THREE.Color so callers cannot share state", () => {
    const a = interpolateWarmToCool(0.25);
    const b = interpolateWarmToCool(0.75);
    expect(a).not.toBe(b);
    // Mutating one should not affect the other.
    a.setRGB(0, 0, 0);
    expect(b.r).not.toBe(0);
  });
});
