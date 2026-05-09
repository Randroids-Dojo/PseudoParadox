import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createThoughtBubble,
  THOUGHT_BUBBLE_Y_OFFSET,
  THOUGHT_BUBBLE_RADIUS,
  type ThoughtBubbleIconKind,
} from "../../src/render/thoughtBubble.ts";

const ALL_KINDS: readonly ThoughtBubbleIconKind[] = [
  "door",
  "fist",
  "sleep",
  "pickup",
  "throw",
];

describe("createThoughtBubble: scene wiring (REQ-032)", () => {
  it("adds a hidden group to the scene on construction", () => {
    const scene = new THREE.Scene();
    const bubble = createThoughtBubble(scene);
    expect(scene.children).toContain(bubble.group);
    expect(bubble.group.visible).toBe(false);
    expect(bubble.currentKind).toBeNull();
  });

  it("dispose removes the group from the scene", () => {
    const scene = new THREE.Scene();
    const bubble = createThoughtBubble(scene);
    bubble.dispose();
    expect(scene.children).not.toContain(bubble.group);
  });

  it("exports a positive y offset above the capsule head", () => {
    expect(THOUGHT_BUBBLE_Y_OFFSET).toBeGreaterThan(0);
    expect(THOUGHT_BUBBLE_RADIUS).toBeGreaterThan(0);
  });
});

describe("createThoughtBubble: setIcon visibility toggle", () => {
  it("setIcon(null) hides the group and clears currentKind", () => {
    const scene = new THREE.Scene();
    const bubble = createThoughtBubble(scene);
    bubble.setIcon("fist");
    expect(bubble.group.visible).toBe(true);
    bubble.setIcon(null);
    expect(bubble.group.visible).toBe(false);
    expect(bubble.currentKind).toBeNull();
  });

  it("setIcon(kind) shows the group and updates currentKind", () => {
    const scene = new THREE.Scene();
    const bubble = createThoughtBubble(scene);
    for (const kind of ALL_KINDS) {
      bubble.setIcon(kind);
      expect(bubble.group.visible).toBe(true);
      expect(bubble.currentKind).toBe(kind);
    }
  });

  it("only the selected kind's child is visible", () => {
    const scene = new THREE.Scene();
    const bubble = createThoughtBubble(scene);
    bubble.setIcon("door");
    const visibleNames = bubble.group.children
      .filter(
        (c) =>
          c.name.startsWith("thoughtBubble.") &&
          c instanceof THREE.Group &&
          c.visible,
      )
      .map((c) => c.name);
    expect(visibleNames).toEqual(["thoughtBubble.door"]);
  });

  it("swapping kinds toggles only the relevant child without rebuilding", () => {
    const scene = new THREE.Scene();
    const bubble = createThoughtBubble(scene);
    const childCountBefore = bubble.group.children.length;
    bubble.setIcon("fist");
    bubble.setIcon("sleep");
    bubble.setIcon("throw");
    bubble.setIcon("pickup");
    bubble.setIcon("door");
    expect(bubble.group.children.length).toBe(childCountBefore);
  });
});

describe("createThoughtBubble: update positions and billboards", () => {
  it("update writes the world position with y offset above the body", () => {
    const scene = new THREE.Scene();
    const bubble = createThoughtBubble(scene);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 5, 5);

    bubble.setIcon("fist");
    bubble.update({ x: 1.5, y: 0.9, z: -2.25 }, camera);

    expect(bubble.group.position.x).toBeCloseTo(1.5, 6);
    expect(bubble.group.position.y).toBeCloseTo(0.9 + THOUGHT_BUBBLE_Y_OFFSET, 6);
    expect(bubble.group.position.z).toBeCloseTo(-2.25, 6);
  });

  it("update orients the group toward the camera (lookAt)", () => {
    const scene = new THREE.Scene();
    const bubble = createThoughtBubble(scene);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(10, 5, 0);

    bubble.setIcon("fist");
    bubble.update({ x: 0, y: 0, z: 0 }, camera);

    // The group's local +Z should point toward the camera. Compute its
    // world-space forward direction and check the dot product against the
    // camera-relative direction is positive (i.e. the disc faces the camera).
    const forward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(bubble.group.quaternion)
      .normalize();
    const toCamera = new THREE.Vector3()
      .subVectors(camera.position, bubble.group.position)
      .normalize();
    expect(forward.dot(toCamera)).toBeGreaterThan(0.5);
  });
});
