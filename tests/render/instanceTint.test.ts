import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyInstanceTint } from "../../src/render/instanceTint.ts";
import { interpolateWarmToCool } from "../../src/render/colorTint.ts";

const buildMesh = (initialHex = 0xffffff): THREE.Mesh => {
  const geometry = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
  const material = new THREE.MeshStandardMaterial({ color: initialHex });
  return new THREE.Mesh(geometry, material);
};

const expectColorClose = (a: THREE.Color, b: THREE.Color): void => {
  expect(a.r).toBeCloseTo(b.r, 6);
  expect(a.g).toBeCloseTo(b.g, 6);
  expect(a.b).toBeCloseTo(b.b, 6);
};

describe("applyInstanceTint", () => {
  it("stamps the warm anchor at originNormalized = 0", () => {
    const mesh = buildMesh();
    applyInstanceTint(mesh, 0);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expectColorClose(material.color, interpolateWarmToCool(0));
  });

  it("stamps the cool anchor at originNormalized = 1", () => {
    const mesh = buildMesh();
    applyInstanceTint(mesh, 1);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expectColorClose(material.color, interpolateWarmToCool(1));
  });

  it("stamps mid-cycle origins to the corresponding interpolated color", () => {
    const mesh = buildMesh();
    applyInstanceTint(mesh, 0.25);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expectColorClose(material.color, interpolateWarmToCool(0.25));
  });

  it("returns the resolved tint color matching the material color", () => {
    const mesh = buildMesh();
    const returned = applyInstanceTint(mesh, 0.7);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expectColorClose(returned, material.color);
    expectColorClose(returned, interpolateWarmToCool(0.7));
  });

  it("two meshes stamped at different times receive distinct colors", () => {
    const a = buildMesh();
    const b = buildMesh();
    applyInstanceTint(a, 0.1);
    applyInstanceTint(b, 0.9);
    const matA = a.material as THREE.MeshStandardMaterial;
    const matB = b.material as THREE.MeshStandardMaterial;
    expect(
      Math.abs(matA.color.r - matB.color.r) +
        Math.abs(matA.color.g - matB.color.g) +
        Math.abs(matA.color.b - matB.color.b),
    ).toBeGreaterThan(0.05);
    expectColorClose(matA.color, interpolateWarmToCool(0.1));
    expectColorClose(matB.color, interpolateWarmToCool(0.9));
  });

  it("clamps inputs outside [0, 1] like interpolateWarmToCool does", () => {
    const low = buildMesh();
    const high = buildMesh();
    applyInstanceTint(low, -0.5);
    applyInstanceTint(high, 1.5);
    const matLow = low.material as THREE.MeshStandardMaterial;
    const matHigh = high.material as THREE.MeshStandardMaterial;
    expectColorClose(matLow.color, interpolateWarmToCool(0));
    expectColorClose(matHigh.color, interpolateWarmToCool(1));
  });

  it("mutates the existing material in place rather than swapping it", () => {
    const mesh = buildMesh();
    const materialBefore = mesh.material;
    applyInstanceTint(mesh, 0.4);
    expect(mesh.material).toBe(materialBefore);
  });

  it("throws on a non-finite originNormalized", () => {
    const mesh = buildMesh();
    expect(() => applyInstanceTint(mesh, Number.NaN)).toThrow();
    expect(() => applyInstanceTint(mesh, Number.POSITIVE_INFINITY)).toThrow();
  });

  it("throws on a multi-material mesh", () => {
    const geometry = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
      new THREE.MeshStandardMaterial({ color: 0x000000 }),
    ];
    const mesh = new THREE.Mesh(geometry, materials);
    expect(() => applyInstanceTint(mesh, 0.5)).toThrow();
  });
});
