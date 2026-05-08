import * as THREE from "three";

/**
 * Warm-to-cool color spectrum used for the room background tint (REQ-029).
 *
 * Anchors are picked so the warm end reads like a soft late-afternoon
 * interior (`#f6c084`, a desaturated peach) and the cool end reads like a
 * pre-dawn or twilight blue (`#5a78b8`). Both are intentionally muted so
 * the room geometry, doors, and player capsule remain readable against
 * the background at any point in the cycle. REQ-030 (instance tint
 * frozen at travel time) will reuse this same anchor pair so per-instance
 * tints visually agree with the room they were stamped from.
 */
export const WARM_ANCHOR_HEX = 0xf6c084;
export const COOL_ANCHOR_HEX = 0x5a78b8;

const WARM = new THREE.Color(WARM_ANCHOR_HEX);
const COOL = new THREE.Color(COOL_ANCHOR_HEX);

/**
 * Linearly interpolate between the warm and cool anchors at the given
 * normalized time `t`. Inputs outside `[0, 1]` are clamped: callers like
 * the renderer pass `TimeOfDay.normalized()` which is already in range,
 * but defensive clamping keeps the function total.
 *
 * Returns a fresh `THREE.Color` so callers can hand it to the scene
 * without worrying about the helper retaining shared state.
 */
export function interpolateWarmToCool(t: number): THREE.Color {
  const clamped = Math.max(0, Math.min(1, t));
  // `THREE.Color.lerpColors` mutates the receiver to be the interpolated
  // value, leaving the source colors untouched. That is what we want here.
  return new THREE.Color().lerpColors(WARM, COOL, clamped);
}
