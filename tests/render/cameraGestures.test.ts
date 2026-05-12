import { describe, expect, it } from "vitest";
import {
  applyPanDelta,
  applyZoomScale,
  PAN_LIMIT_M,
  screenDragToWorldPan,
  WHEEL_ZOOM_PER_PIXEL,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../../src/render/cameraGestures.ts";

describe("applyZoomScale (F-010)", () => {
  it("scales the previous zoom and clamps to [ZOOM_MIN, ZOOM_MAX]", () => {
    expect(applyZoomScale(1, 1.5)).toBe(1.5);
    expect(applyZoomScale(1, 0.5)).toBe(0.5);
  });

  it("clamps at the upper bound when scale would exceed ZOOM_MAX", () => {
    expect(applyZoomScale(2, 2)).toBe(ZOOM_MAX);
    expect(applyZoomScale(ZOOM_MAX, 10)).toBe(ZOOM_MAX);
  });

  it("clamps at the lower bound when scale would fall below ZOOM_MIN", () => {
    expect(applyZoomScale(1, 0.1)).toBe(ZOOM_MIN);
    expect(applyZoomScale(ZOOM_MIN, 0.1)).toBe(ZOOM_MIN);
  });

  it("WHEEL_ZOOM_PER_PIXEL at +100 deltaY (scroll down) zooms out", () => {
    // factor = WHEEL_ZOOM_PER_PIXEL^-100 < 1 -> zoom decreases.
    const factor = WHEEL_ZOOM_PER_PIXEL ** -100;
    expect(factor).toBeLessThan(1);
    expect(applyZoomScale(1, factor)).toBeLessThan(1);
  });

  it("WHEEL_ZOOM_PER_PIXEL at -100 deltaY (scroll up) zooms in", () => {
    const factor = WHEEL_ZOOM_PER_PIXEL ** 100;
    expect(factor).toBeGreaterThan(1);
    expect(applyZoomScale(1, factor)).toBeGreaterThan(1);
  });
});

describe("applyPanDelta (F-010)", () => {
  it("sums the previous offset with the delta", () => {
    expect(applyPanDelta(0, 0, 1, 2)).toEqual({ x: 1, z: 2 });
    expect(applyPanDelta(1, 2, 0.5, -1)).toEqual({ x: 1.5, z: 1 });
  });

  it("clamps each axis to [-PAN_LIMIT_M, PAN_LIMIT_M]", () => {
    expect(applyPanDelta(0, 0, 100, 100)).toEqual({
      x: PAN_LIMIT_M,
      z: PAN_LIMIT_M,
    });
    expect(applyPanDelta(0, 0, -100, -100)).toEqual({
      x: -PAN_LIMIT_M,
      z: -PAN_LIMIT_M,
    });
  });

  it("clamps each axis independently", () => {
    // Reaching the X bound does not constrain the Z drift.
    expect(applyPanDelta(PAN_LIMIT_M - 1, 0, 5, 2)).toEqual({
      x: PAN_LIMIT_M,
      z: 2,
    });
  });
});

describe("screenDragToWorldPan (F-010)", () => {
  const frustum = { left: -9, right: 9, top: 9, bottom: -9 };
  const canvas = { width: 1800, height: 1800 };

  it("at zoom 1, a one-pixel drag right is one (worldWidth / canvasWidth) shift left in world X", () => {
    const out = screenDragToWorldPan(100, 0, frustum, canvas, 1);
    // worldWidth = 18, px-to-world = 18 / 1800 = 0.01. 100 px * 0.01 = 1.0
    // sign inverted: drag right -> world view shifts right -> camera moves left -> -1.0
    expect(out.x).toBeCloseTo(-1.0, 5);
    expect(out.z).toBe(0);
  });

  it("zoom 2 halves the world delta per pixel of drag (more zoomed = finer pan)", () => {
    const out1 = screenDragToWorldPan(100, 0, frustum, canvas, 1);
    const out2 = screenDragToWorldPan(100, 0, frustum, canvas, 2);
    expect(Math.abs(out2.x)).toBeCloseTo(Math.abs(out1.x) / 2, 5);
  });

  it("dragging down (positive deltaY) shifts the look target toward -Z (world view scrolls down)", () => {
    const out = screenDragToWorldPan(0, 100, frustum, canvas, 1);
    expect(out.x).toBe(0);
    expect(out.z).toBeCloseTo(-1.0, 5);
  });

  it("zero delta produces zero pan", () => {
    expect(screenDragToWorldPan(0, 0, frustum, canvas, 1)).toEqual({
      x: 0,
      z: 0,
    });
  });

  it("guards against a zero-width canvas (no NaN, no Infinity)", () => {
    const out = screenDragToWorldPan(
      10,
      10,
      frustum,
      { width: 0, height: 0 },
      1,
    );
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.z)).toBe(true);
  });
});

describe("ZOOM range constants (F-010)", () => {
  it("ZOOM_MIN and ZOOM_MAX match the user-selected design (0.5x to 3x)", () => {
    expect(ZOOM_MIN).toBe(0.5);
    expect(ZOOM_MAX).toBe(3);
    expect(ZOOM_MIN).toBeLessThan(ZOOM_MAX);
  });

  it("PAN_LIMIT_M matches the room half-width (+/- 5m)", () => {
    expect(PAN_LIMIT_M).toBe(5);
  });
});
