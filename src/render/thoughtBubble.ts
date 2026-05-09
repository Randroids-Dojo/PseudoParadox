import * as THREE from "three";
import { PLAYER_CAPSULE_TOTAL_HEIGHT } from "../scene/player.ts";

/**
 * Thought-bubble icon overlay (REQ-032; `docs/gdd/30-combat-and-interaction.md`
 * section 8).
 *
 * Each non-active ghost owns a `ThoughtBubble`: a small billboard placed above
 * the capsule's head that shows a text-free icon for the next qualitatively
 * different action the ghost is about to take. Walking is the baseline and is
 * NOT surfaced (anti-spam). Pillar 3 (sci-fi diegetic) forbids text, so the
 * icon set is purely glyph: an arrow shape (door entry), a stylized fist
 * (punch), a "Z" shape (sleep, persists while unconscious), an upward arrow
 * + dot (pickup), and a curved arc (throw).
 *
 * Implementation strategy: a `THREE.Group` parented to the scene, with a
 * disc backplate plus per-icon child meshes generated programmatically. The
 * group's world position is rewritten each render frame to the ghost's
 * translation plus a head offset (the host calls `positionThoughtBubble`).
 * Billboarding is manual via `lookAt(camera)` in `billboardThoughtBubble`;
 * the group rotates each frame so the disc face the camera.
 *
 * Generated geometry is preferred over loading PNG textures so the bundle
 * stays lean and the tests can verify the structure without a texture
 * loader stub. The visual reads as a small glyph; the active-color disc
 * makes the icon legible against the warm-to-cool background.
 *
 * The active player has NO bubble (the dossier specifies this; only ghosts
 * carry bubbles). Hard reset removes every bubble alongside its owning
 * ghost via `registry.clearAllGhosts` (the bubble is a child of the ghost's
 * scene group only via reparenting on the host's per-frame
 * `positionThoughtBubble` call; for safety the host also calls
 * `disposeThoughtBubble` on every ghost during teardown).
 *
 * NOT in scope this slice:
 *   - Bubble fade / animation.
 *   - Ghost-of-ghost previews (a ghost only previews its OWN immediate
 *     future, not chained futures).
 *   - Per-bubble color tinting by the ghost's `originNormalized`.
 */

/**
 * The set of icons a thought bubble can display. `null` hides the bubble
 * (no glyph showing; the disc backplate is also hidden).
 */
export type ThoughtBubbleIconKind =
  | "door"
  | "fist"
  | "sleep"
  | "pickup"
  | "throw";

/**
 * Vertical offset above the capsule center where the bubble is anchored.
 * The capsule is 1.8m tall (`PLAYER_CAPSULE_TOTAL_HEIGHT`); the bubble sits
 * 0.6m above the top of the head so it does not overlap the mesh.
 */
export const THOUGHT_BUBBLE_Y_OFFSET =
  PLAYER_CAPSULE_TOTAL_HEIGHT / 2 + 0.6;

/**
 * Disc backplate radius. Big enough to make the glyph legible against the
 * room background; small enough to not clutter the screen with multiple
 * bubbles in view.
 */
export const THOUGHT_BUBBLE_RADIUS = 0.22;

/**
 * One thought-bubble instance, owned by one ghost. The `group` is what the
 * host adds to / removes from the scene; the per-icon children live inside
 * the group and are toggled `visible` by `setThoughtBubbleIcon` so swapping
 * an icon does not allocate new geometry.
 */
export interface ThoughtBubble {
  /** Root group. Parented to the scene by `createThoughtBubble`. */
  readonly group: THREE.Group;
  /** Currently displayed icon, or `null` when the bubble is hidden. */
  readonly currentKind: ThoughtBubbleIconKind | null;
  /**
   * Swap the visible icon. Pass `null` to hide the bubble entirely. The
   * implementation toggles per-icon children rather than rebuilding meshes,
   * so this is cheap per render frame.
   */
  setIcon: (kind: ThoughtBubbleIconKind | null) => void;
  /**
   * Move the bubble to `{ x, y, z }` and orient it toward `camera`. Called
   * once per render frame by the host. The y is the ghost's body
   * translation y; the function adds `THOUGHT_BUBBLE_Y_OFFSET` so the
   * bubble sits above the head regardless of the capsule's pose.
   */
  update: (
    bodyTranslation: { x: number; y: number; z: number },
    camera: THREE.Camera,
  ) => void;
  /**
   * Tear down: remove the group from the scene and dispose every glyph's
   * geometry + material. Called during hard reset and on ghost teardown.
   */
  dispose: () => void;
}

/**
 * Create a single `ThoughtBubble` and add its group to `scene`. The bubble
 * starts hidden (no current kind, group `visible` false). The host calls
 * `setIcon` to surface a glyph and `update` each render frame to position
 * and billboard the group.
 */
export function createThoughtBubble(scene: THREE.Scene): ThoughtBubble {
  const group = new THREE.Group();
  group.name = "thoughtBubble";
  group.visible = false;
  scene.add(group);

  // Disc backplate so the glyph reads against any background. White with
  // slight transparency keeps the visual quiet; the glyph itself is the
  // legible element.
  const discGeometry = new THREE.CircleGeometry(THOUGHT_BUBBLE_RADIUS, 24);
  const discMaterial = new THREE.MeshBasicMaterial({
    color: 0xf5f5f5,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const disc = new THREE.Mesh(discGeometry, discMaterial);
  disc.renderOrder = 999;
  group.add(disc);

  // Per-icon children. Each is a small group of meshes positioned slightly
  // forward of the disc so the glyph is not z-fighting with the backplate.
  // All start hidden; `setIcon` toggles exactly one visible.
  const iconGroups: Record<ThoughtBubbleIconKind, THREE.Group> = {
    door: buildDoorArrowIcon(),
    fist: buildFistIcon(),
    sleep: buildSleepIcon(),
    pickup: buildPickupIcon(),
    throw: buildThrowIcon(),
  };
  for (const kind of Object.keys(iconGroups) as ThoughtBubbleIconKind[]) {
    const icon = iconGroups[kind];
    icon.visible = false;
    icon.position.z = 0.01;
    group.add(icon);
  }

  // Mutable state behind a getter on the returned object.
  let currentKind: ThoughtBubbleIconKind | null = null;

  const setIcon = (kind: ThoughtBubbleIconKind | null): void => {
    currentKind = kind;
    if (kind === null) {
      group.visible = false;
      for (const k of Object.keys(iconGroups) as ThoughtBubbleIconKind[]) {
        iconGroups[k].visible = false;
      }
      return;
    }
    group.visible = true;
    for (const k of Object.keys(iconGroups) as ThoughtBubbleIconKind[]) {
      iconGroups[k].visible = k === kind;
    }
  };

  const update: ThoughtBubble["update"] = (bodyTranslation, camera) => {
    group.position.set(
      bodyTranslation.x,
      bodyTranslation.y + THOUGHT_BUBBLE_Y_OFFSET,
      bodyTranslation.z,
    );
    // Manual billboard: face the camera each frame. `lookAt` orients the
    // group's local +Z toward the camera, which is what we want for the
    // disc + glyph children.
    group.lookAt(camera.position);
  };

  const dispose = (): void => {
    scene.remove(group);
    discGeometry.dispose();
    discMaterial.dispose();
    for (const k of Object.keys(iconGroups) as ThoughtBubbleIconKind[]) {
      const icon = iconGroups[k];
      icon.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mat = child.material;
          if (Array.isArray(mat)) {
            for (const m of mat) m.dispose();
          } else {
            mat.dispose();
          }
        }
      });
    }
  };

  return {
    group,
    get currentKind(): ThoughtBubbleIconKind | null {
      return currentKind;
    },
    setIcon,
    update,
    dispose,
  };
}

/**
 * Shared color for every glyph: dark gray reads against the white disc.
 * Kept as one constant so a future styling pass touches one place.
 */
const GLYPH_COLOR = 0x222222;

/**
 * Standard glyph material. Depth-test off so the glyph is always drawn on
 * top of the disc and never clipped by the room geometry behind the ghost.
 */
const buildGlyphMaterial = (): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: GLYPH_COLOR,
    side: THREE.DoubleSide,
    depthTest: false,
    transparent: true,
  });

/**
 * Door icon: a triangular arrow pointing right. Reads as "going through a
 * door." Direction-agnostic (the cardinal of the actual door is not
 * encoded in the glyph; the dossier's icon set is text-free and the
 * direction reads from the ghost's path itself).
 */
function buildDoorArrowIcon(): THREE.Group {
  const g = new THREE.Group();
  g.name = "thoughtBubble.door";
  const w = THOUGHT_BUBBLE_RADIUS * 0.7;
  const h = THOUGHT_BUBBLE_RADIUS * 0.55;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 4, h / 2);
  shape.lineTo(w / 4, h / 6);
  shape.lineTo(w / 2, h / 6);
  shape.lineTo(w / 2, -h / 6);
  shape.lineTo(w / 4, -h / 6);
  shape.lineTo(w / 4, -h / 2);
  shape.closePath();
  const geom = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geom, buildGlyphMaterial());
  mesh.renderOrder = 1000;
  g.add(mesh);
  return g;
}

/**
 * Fist icon: a filled circle with a smaller centered circle. Reads as
 * "punch about to land."
 */
function buildFistIcon(): THREE.Group {
  const g = new THREE.Group();
  g.name = "thoughtBubble.fist";
  const outerR = THOUGHT_BUBBLE_RADIUS * 0.45;
  const innerR = THOUGHT_BUBBLE_RADIUS * 0.18;
  const outer = new THREE.Mesh(
    new THREE.CircleGeometry(outerR, 16),
    buildGlyphMaterial(),
  );
  outer.renderOrder = 1000;
  g.add(outer);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xf5f5f5,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(innerR, 12),
    innerMat,
  );
  inner.position.z = 0.001;
  inner.renderOrder = 1001;
  g.add(inner);
  return g;
}

/**
 * Sleep icon: a "Z" shape. Three line segments forming the letter; reads
 * as "asleep / unconscious."
 */
function buildSleepIcon(): THREE.Group {
  const g = new THREE.Group();
  g.name = "thoughtBubble.sleep";
  const w = THOUGHT_BUBBLE_RADIUS * 0.55;
  const h = THOUGHT_BUBBLE_RADIUS * 0.55;
  const t = THOUGHT_BUBBLE_RADIUS * 0.08;
  // Top stroke.
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(w, t),
    buildGlyphMaterial(),
  );
  top.position.set(0, h / 2 - t / 2, 0);
  top.renderOrder = 1000;
  g.add(top);
  // Bottom stroke.
  const bottom = new THREE.Mesh(
    new THREE.PlaneGeometry(w, t),
    buildGlyphMaterial(),
  );
  bottom.position.set(0, -h / 2 + t / 2, 0);
  bottom.renderOrder = 1000;
  g.add(bottom);
  // Diagonal stroke (rotated rectangle).
  const diagLength = Math.hypot(w, h);
  const diag = new THREE.Mesh(
    new THREE.PlaneGeometry(diagLength, t),
    buildGlyphMaterial(),
  );
  diag.rotation.z = -Math.atan2(h, w);
  diag.renderOrder = 1000;
  g.add(diag);
  return g;
}

/**
 * Pickup icon: an upward arrow with a dot above it. Reads as "lifting
 * something off the ground."
 */
function buildPickupIcon(): THREE.Group {
  const g = new THREE.Group();
  g.name = "thoughtBubble.pickup";
  const w = THOUGHT_BUBBLE_RADIUS * 0.45;
  const h = THOUGHT_BUBBLE_RADIUS * 0.55;
  const arrow = new THREE.Shape();
  arrow.moveTo(0, h / 2);
  arrow.lineTo(w / 2, h / 6);
  arrow.lineTo(w / 6, h / 6);
  arrow.lineTo(w / 6, -h / 2);
  arrow.lineTo(-w / 6, -h / 2);
  arrow.lineTo(-w / 6, h / 6);
  arrow.lineTo(-w / 2, h / 6);
  arrow.closePath();
  const arrowMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(arrow),
    buildGlyphMaterial(),
  );
  arrowMesh.renderOrder = 1000;
  g.add(arrowMesh);
  return g;
}

/**
 * Throw icon: a curved arc reading as a ballistic trajectory. Drawn as a
 * series of small segments along a parabola so it reads as "thing
 * launched in an arc."
 */
function buildThrowIcon(): THREE.Group {
  const g = new THREE.Group();
  g.name = "thoughtBubble.throw";
  const w = THOUGHT_BUBBLE_RADIUS * 0.7;
  const h = THOUGHT_BUBBLE_RADIUS * 0.5;
  const segments = 12;
  const t = THOUGHT_BUBBLE_RADIUS * 0.05;
  for (let i = 0; i < segments; i += 1) {
    const u0 = i / segments;
    const u1 = (i + 1) / segments;
    const x0 = -w / 2 + u0 * w;
    const x1 = -w / 2 + u1 * w;
    const y0 = -h / 2 + 4 * h * u0 * (1 - u0);
    const y1 = -h / 2 + 4 * h * u1 * (1 - u1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const seg = new THREE.Mesh(
      new THREE.PlaneGeometry(len, t),
      buildGlyphMaterial(),
    );
    seg.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    seg.rotation.z = angle;
    seg.renderOrder = 1000;
    g.add(seg);
  }
  return g;
}
