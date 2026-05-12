/**
 * Shared planar XZ position shape. The sim treats Y as gravity / vertical
 * and works in XZ for hit detection, milestone proximity, replay drift,
 * carry attachment, and facing. Every internal consumer had grown its own
 * inline `{ readonly x: number; readonly z: number }` literal; this type
 * exists so they all reference one declaration.
 *
 * Compatible by structure with the Rapier-translation shape's `{x, y, z}`
 * because TypeScript's excess-property checks tolerate extra fields when
 * a value is widened to this type's positional projection. Callers that
 * receive a Rapier translation simply project into `Position2D` at the
 * boundary (typically `{ x: t.x, z: t.z }`).
 */
export type Position2D = {
  readonly x: number;
  readonly z: number;
};
