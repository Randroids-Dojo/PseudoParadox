import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ASTRONAUT_PART_NAMES,
  createAstronautMesh,
} from "../../src/scene/astronaut.ts";

const childNames = (mesh: THREE.Mesh): string[] =>
  mesh.children.map((child) => child.name).sort();

describe("createAstronautMesh", () => {
  it("keeps a tintable parent mesh for the existing instance-tint path", () => {
    const mesh = createAstronautMesh({
      radius: 0.4,
      cylinderLength: 1.0,
      name: "player",
    });

    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.name).toBe("player");
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mesh.userData.visualStyle).toBe("anonymous-astronaut");
  });

  it("adds the anonymous suit silhouette parts", () => {
    const mesh = createAstronautMesh({
      radius: 0.4,
      cylinderLength: 1.0,
      name: "ghost",
    });

    expect(childNames(mesh)).toEqual(
      Object.values(ASTRONAUT_PART_NAMES).slice().sort(),
    );
  });

  it("uses a dark visor instead of facial features", () => {
    const mesh = createAstronautMesh({
      radius: 0.4,
      cylinderLength: 1.0,
      name: "player",
    });
    const visor = mesh.getObjectByName(ASTRONAUT_PART_NAMES.visor);

    expect(visor).toBeInstanceOf(THREE.Mesh);
    const material = (visor as THREE.Mesh).material;
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      0x111820,
    );
  });
});
