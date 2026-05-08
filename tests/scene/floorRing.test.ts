import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  FLOOR_RING_COLOR_HEX,
  FLOOR_RING_INNER_RADIUS,
  FLOOR_RING_OPACITY,
  FLOOR_RING_OUTER_RADIUS,
  FLOOR_RING_Y_OFFSET,
  createFloorRing,
  updateFloorRing,
} from "../../src/scene/floorRing.ts";

beforeAll(async () => {
  await RAPIER.init();
});

const buildWorld = (): RAPIER.World =>
  new RAPIER.World({ x: 0, y: -9.81, z: 0 });

const buildSyntheticBody = (
  world: RAPIER.World,
  x: number,
  y: number,
  z: number,
): RAPIER.RigidBody => {
  const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    x,
    y,
    z,
  );
  return world.createRigidBody(desc);
};

describe("createFloorRing (REQ-031)", () => {
  it("returns a mesh named 'floor-ring' that lies flat on the XZ plane just above the floor", () => {
    const ring = createFloorRing();
    expect(ring.name).toBe("floor-ring");
    expect(ring.position.y).toBeCloseTo(FLOOR_RING_Y_OFFSET, 6);
    // RingGeometry is authored on XY; the mesh rotates -90deg about X so it
    // lies on the XZ floor plane. Confirm the rotation rather than peeking
    // at geometry attributes so the contract is observable.
    expect(ring.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("uses subtle defaults: low-opacity neutral white, double-sided, no glow", () => {
    const ring = createFloorRing();
    const material = ring.material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(FLOOR_RING_COLOR_HEX);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(FLOOR_RING_OPACITY, 6);
    expect(material.side).toBe(THREE.DoubleSide);
    // depthWrite off prevents the transparent ring from punching a hole in
    // the depth buffer that would hide subsequent translucent geometry.
    expect(material.depthWrite).toBe(false);
  });

  it("uses the configured inner and outer radii", () => {
    const ring = createFloorRing();
    const geometry = ring.geometry as THREE.RingGeometry;
    // RingGeometry stores its radii on the parameters object.
    const params = (geometry as unknown as {
      parameters: { innerRadius: number; outerRadius: number };
    }).parameters;
    expect(params.innerRadius).toBeCloseTo(FLOOR_RING_INNER_RADIUS, 6);
    expect(params.outerRadius).toBeCloseTo(FLOOR_RING_OUTER_RADIUS, 6);
  });
});

describe("updateFloorRing (REQ-031)", () => {
  it("copies the body's x/z onto the ring and pins y to the floor offset", () => {
    const world = buildWorld();
    const body = buildSyntheticBody(world, 1.5, 0.9, -2.25);
    const ring = createFloorRing();

    updateFloorRing(ring, body);

    expect(ring.position.x).toBeCloseTo(1.5, 6);
    expect(ring.position.z).toBeCloseTo(-2.25, 6);
    // y is pinned regardless of what the body's translation says, so a
    // jumping or falling player cannot drag the ring off the floor.
    expect(ring.position.y).toBeCloseTo(FLOOR_RING_Y_OFFSET, 6);
  });

  it("tracks subsequent translation changes without leaking the previous frame's pose", () => {
    const world = buildWorld();
    const body = buildSyntheticBody(world, 0, 0.9, 0);
    const ring = createFloorRing();
    updateFloorRing(ring, body);
    expect(ring.position.x).toBeCloseTo(0, 6);

    body.setTranslation({ x: 3, y: 5, z: 4 }, true);
    updateFloorRing(ring, body);

    expect(ring.position.x).toBeCloseTo(3, 6);
    expect(ring.position.z).toBeCloseTo(4, 6);
    expect(ring.position.y).toBeCloseTo(FLOOR_RING_Y_OFFSET, 6);
  });

  it("matches a synthetic player at world origin on the very first update", () => {
    const world = buildWorld();
    const body = buildSyntheticBody(world, 0, 0.9, 0);
    const ring = createFloorRing();

    updateFloorRing(ring, body);

    expect(ring.position.x).toBeCloseTo(0, 6);
    expect(ring.position.z).toBeCloseTo(0, 6);
    expect(ring.position.y).toBeCloseTo(FLOOR_RING_Y_OFFSET, 6);
  });

  it("does not mutate the ring's flat-on-XZ rotation across updates", () => {
    const world = buildWorld();
    const body = buildSyntheticBody(world, 1, 1, 1);
    const ring = createFloorRing();
    updateFloorRing(ring, body);
    body.setTranslation({ x: 2, y: 1, z: 2 }, true);
    updateFloorRing(ring, body);

    expect(ring.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
    expect(ring.rotation.y).toBeCloseTo(0, 6);
    expect(ring.rotation.z).toBeCloseTo(0, 6);
  });
});
