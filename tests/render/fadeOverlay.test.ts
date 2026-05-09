import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createFadeOverlay,
  FADE_OVERLAY_COLOR_HEX,
} from "../../src/render/fadeOverlay.ts";

describe("createFadeOverlay: defaults", () => {
  it("opens at opacity 0 with the plane hidden", () => {
    const overlay = createFadeOverlay();
    expect(overlay.opacity).toBe(0);
    const mesh = overlay.scene.children.find((c) => c.name === "fade-overlay");
    expect(mesh).toBeDefined();
    expect((mesh as THREE.Mesh).visible).toBe(false);
  });

  it("uses a black fade color by default", () => {
    expect(FADE_OVERLAY_COLOR_HEX).toBe(0x000000);
    const overlay = createFadeOverlay();
    const mesh = overlay.scene.children.find((c) => c.name === "fade-overlay");
    const material = (mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(FADE_OVERLAY_COLOR_HEX);
  });

  it("orthographic camera covers the [-1, 1] x [-1, 1] clip volume", () => {
    const overlay = createFadeOverlay();
    expect(overlay.camera.left).toBe(-1);
    expect(overlay.camera.right).toBe(1);
    expect(overlay.camera.top).toBe(1);
    expect(overlay.camera.bottom).toBe(-1);
  });
});

describe("createFadeOverlay: setOpacity", () => {
  it("clamps opacity to [0, 1]", () => {
    const overlay = createFadeOverlay();
    overlay.setOpacity(-0.5);
    expect(overlay.opacity).toBe(0);
    overlay.setOpacity(1.5);
    expect(overlay.opacity).toBe(1);
    overlay.setOpacity(0.42);
    expect(overlay.opacity).toBeCloseTo(0.42, 6);
  });

  it("toggles plane visibility based on opacity", () => {
    const overlay = createFadeOverlay();
    const mesh = overlay.scene.children.find(
      (c) => c.name === "fade-overlay",
    ) as THREE.Mesh;

    overlay.setOpacity(0.5);
    expect(mesh.visible).toBe(true);

    overlay.setOpacity(0);
    expect(mesh.visible).toBe(false);

    overlay.setOpacity(1);
    expect(mesh.visible).toBe(true);
  });
});

describe("createFadeOverlay: material flags", () => {
  it("plane material is transparent with depth test disabled", () => {
    const overlay = createFadeOverlay();
    const mesh = overlay.scene.children.find(
      (c) => c.name === "fade-overlay",
    ) as THREE.Mesh;
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
  });
});

describe("createFadeOverlay: custom color", () => {
  it("honors a colorHex override", () => {
    const overlay = createFadeOverlay({ colorHex: 0xffffff });
    const mesh = overlay.scene.children.find(
      (c) => c.name === "fade-overlay",
    ) as THREE.Mesh;
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(0xffffff);
  });
});

describe("createFadeOverlay: dispose", () => {
  it("removes the plane from its scene and disposes geometry / material", () => {
    const overlay = createFadeOverlay();
    const mesh = overlay.scene.children.find(
      (c) => c.name === "fade-overlay",
    ) as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    let geometryDisposed = false;
    let materialDisposed = false;
    geometry.addEventListener("dispose", () => {
      geometryDisposed = true;
    });
    (mesh.material as THREE.MeshBasicMaterial).addEventListener(
      "dispose",
      () => {
        materialDisposed = true;
      },
    );

    overlay.dispose();

    expect(overlay.scene.children).not.toContain(mesh);
    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(true);
  });
});
