import * as THREE from "three";
import { cloneCharacterModel } from "./characterModel.ts";

export const ASTRONAUT_PART_NAMES = {
  visor: "astronaut-visor",
  leftArm: "astronaut-left-arm",
  rightArm: "astronaut-right-arm",
  leftBoot: "astronaut-left-boot",
  rightBoot: "astronaut-right-boot",
  backpack: "astronaut-backpack",
} as const;

export interface AstronautMeshOptions {
  radius: number;
  cylinderLength: number;
  name: string;
}

const makeMaterial = (color: number): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0.0,
  });

function addPart(
  root: THREE.Mesh,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: { x: number; y: number; z: number },
): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.name = name;
  part.position.set(position.x, position.y, position.z);
  root.add(part);
  return part;
}

export function createAstronautMesh(options: AstronautMeshOptions): THREE.Mesh {
  const { radius, cylinderLength, name } = options;
  const clone = cloneCharacterModel();
  if (clone) {
    // GLB path: the parent Mesh is an empty container (no draw call) that
    // owns the per-instance tintable placeholder material. The visible
    // figurine is a child group; `applyInstanceTint` recurses into it.
    // The per-instance `AnimationMixer` is parked on `userData` so the host
    // render loop can advance it and switch idle / walk by velocity.
    const root = new THREE.Mesh(new THREE.BufferGeometry(), makeMaterial(0xffffff));
    root.name = name;
    root.userData.visualStyle = "kenney-mini-character";
    root.userData.characterAnimator = clone.animator;
    root.add(clone.object);
    clone.animator.play("idle");
    return root;
  }

  const suitGeometry = new THREE.CapsuleGeometry(radius, cylinderLength, 8, 16);
  const suitMaterial = makeMaterial(0xc4d0e6);
  const root = new THREE.Mesh(suitGeometry, suitMaterial);
  root.name = name;
  root.userData.visualStyle = "anonymous-astronaut";

  const visorMaterial = makeMaterial(0x111820);
  const trimMaterial = makeMaterial(0xe9eef5);
  const packMaterial = makeMaterial(0x5f6d78);

  const visor = addPart(
    root,
    ASTRONAUT_PART_NAMES.visor,
    new THREE.BoxGeometry(radius * 1.15, radius * 0.42, radius * 0.08),
    visorMaterial,
    { x: 0, y: cylinderLength * 0.35, z: -radius * 0.9 },
  );
  visor.rotation.x = -0.12;

  addPart(
    root,
    ASTRONAUT_PART_NAMES.leftArm,
    new THREE.CapsuleGeometry(radius * 0.18, cylinderLength * 0.52, 4, 8),
    trimMaterial,
    { x: -radius * 1.12, y: 0, z: 0 },
  ).rotation.z = 0.08;

  addPart(
    root,
    ASTRONAUT_PART_NAMES.rightArm,
    new THREE.CapsuleGeometry(radius * 0.18, cylinderLength * 0.52, 4, 8),
    trimMaterial,
    { x: radius * 1.12, y: 0, z: 0 },
  ).rotation.z = -0.08;

  addPart(
    root,
    ASTRONAUT_PART_NAMES.leftBoot,
    new THREE.BoxGeometry(radius * 0.48, radius * 0.28, radius * 0.72),
    trimMaterial,
    { x: -radius * 0.36, y: -cylinderLength * 0.62, z: -radius * 0.04 },
  );

  addPart(
    root,
    ASTRONAUT_PART_NAMES.rightBoot,
    new THREE.BoxGeometry(radius * 0.48, radius * 0.28, radius * 0.72),
    trimMaterial,
    { x: radius * 0.36, y: -cylinderLength * 0.62, z: -radius * 0.04 },
  );

  addPart(
    root,
    ASTRONAUT_PART_NAMES.backpack,
    new THREE.BoxGeometry(radius * 0.92, cylinderLength * 0.58, radius * 0.32),
    packMaterial,
    { x: 0, y: -cylinderLength * 0.02, z: radius * 0.88 },
  );

  return root;
}
