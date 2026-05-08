import * as THREE from "three";
import { interpolateWarmToCool } from "./colorTint.ts";

/**
 * Per-instance tinting (REQ-030).
 *
 * Each instance (the active player capsule, or any past replay capsule that a
 * future slice spawns) carries a `originNormalized` value in `[0, 1]`. That
 * value is the `TimeOfDay.normalized()` reading captured at the moment the
 * instance last traveled through a portal. The instance's mesh color is
 * frozen to `interpolateWarmToCool(originNormalized)` for its lifetime so
 * the player can read at a glance which timeline an instance came from. The
 * room background uses the same warm-to-cool anchor pair (REQ-029) so an
 * instance whose origin matches the current time visually fades into the
 * room and a far-from-now instance reads as a contrasting shade.
 *
 * The active player gets its origin stamped at spawn, before any travel has
 * happened, so the very first visible state is consistent with the rule. A
 * later slice will overwrite the value when the player traverses a lit door.
 *
 * This helper accepts any `THREE.Mesh` whose material is one of the standard
 * shaded materials with a `color` property. It mutates the existing material
 * in place rather than swapping the material for a tinted clone, so the
 * caller does not need to track the new material for disposal. The intent is
 * a one-shot color stamp at construction; the caller is expected to call this
 * exactly once per instance.
 */

/** Three's color-bearing material types we tint with this helper. */
type ColorBearingMaterial =
  | THREE.MeshStandardMaterial
  | THREE.MeshBasicMaterial
  | THREE.MeshLambertMaterial
  | THREE.MeshPhongMaterial;

function isColorBearingMaterial(
  material: THREE.Material | THREE.Material[],
): material is ColorBearingMaterial {
  if (Array.isArray(material)) {
    return false;
  }
  // The standard shaded materials we use in the scene all expose a
  // `color: THREE.Color` field. Other material families (e.g. ShaderMaterial,
  // LineDashedMaterial) do not, and tinting them through this helper would be
  // a silent no-op. The boundary check makes that an explicit error instead.
  return (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshBasicMaterial ||
    material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshPhongMaterial
  );
}

/**
 * Stamp the given mesh's material color with the warm-to-cool tint at the
 * supplied normalized origin time. Returns the resolved color so callers
 * (typically tests) can verify the stamp without having to reach into the
 * mesh's material themselves.
 *
 * Inputs outside `[0, 1]` are clamped by `interpolateWarmToCool`. Multi-
 * material meshes and unrecognized material types throw rather than
 * silently no-op.
 */
export function applyInstanceTint(
  mesh: THREE.Mesh,
  originNormalized: number,
): THREE.Color {
  if (!Number.isFinite(originNormalized)) {
    throw new Error(
      `applyInstanceTint requires a finite originNormalized, got ${originNormalized}`,
    );
  }
  const { material } = mesh;
  if (!isColorBearingMaterial(material)) {
    throw new Error(
      "applyInstanceTint requires a single color-bearing material on the mesh",
    );
  }
  const tint = interpolateWarmToCool(originNormalized);
  material.color.copy(tint);
  return tint;
}
