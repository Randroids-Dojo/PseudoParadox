import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  ACT1_LEFT_DRAGGER_RECORDING,
  ACT1_LEFT_DRAGGER_SPAWN,
  ACT1_RIGHT_DRAGGER_RECORDING,
  ACT1_RIGHT_DRAGGER_SPAWN,
  ACT1_KNOCKOUT_BODY_RECORDING,
  ACT1_KNOCKOUT_BODY_SPAWN,
  ACT1_CINEMATIC_DURATION_TICKS,
  ACT1_CINEMATIC_FADE_START_TICK,
  ACT1_CINEMATIC_FADE_DURATION_TICKS,
  ACT1_DRAGGER_WALK_TICKS,
  mountAct1Cinematic,
} from "../../../src/sim/scripts/act1Cinematic.ts";
import { createTimelineRegistry } from "../../../src/sim/timelineRegistry.ts";
import { hourToNormalized } from "../../../src/sim/actOneAnchor.ts";
import { isAct1Spawn, type ActStateSnapshot } from "../../../src/sim/actState.ts";

beforeAll(async () => {
  await RAPIER.init();
});

const buildWorld = (): RAPIER.World =>
  new RAPIER.World({ x: 0, y: -9.81, z: 0 });

describe("act1Cinematic recording shapes", () => {
  it("each dragger recording has ACT1_CINEMATIC_DURATION_TICKS frames", () => {
    expect(ACT1_LEFT_DRAGGER_RECORDING.length).toBe(
      ACT1_CINEMATIC_DURATION_TICKS,
    );
    expect(ACT1_LEFT_DRAGGER_RECORDING.frames.length).toBe(
      ACT1_CINEMATIC_DURATION_TICKS,
    );
    expect(ACT1_RIGHT_DRAGGER_RECORDING.length).toBe(
      ACT1_CINEMATIC_DURATION_TICKS,
    );
    expect(ACT1_RIGHT_DRAGGER_RECORDING.frames.length).toBe(
      ACT1_CINEMATIC_DURATION_TICKS,
    );
  });

  it("body recording has exactly one frame (Q-021 default)", () => {
    expect(ACT1_KNOCKOUT_BODY_RECORDING.length).toBe(1);
    expect(ACT1_KNOCKOUT_BODY_RECORDING.frames.length).toBe(1);
  });

  it("recordings are deeply frozen", () => {
    expect(Object.isFrozen(ACT1_LEFT_DRAGGER_RECORDING)).toBe(true);
    expect(Object.isFrozen(ACT1_LEFT_DRAGGER_RECORDING.frames)).toBe(true);
    expect(Object.isFrozen(ACT1_LEFT_DRAGGER_RECORDING.frames[0])).toBe(true);
    expect(Object.isFrozen(ACT1_LEFT_DRAGGER_RECORDING.frames[0].keys)).toBe(
      true,
    );
    expect(Object.isFrozen(ACT1_KNOCKOUT_BODY_RECORDING)).toBe(true);
    expect(Object.isFrozen(ACT1_KNOCKOUT_BODY_RECORDING.frames[0].keys)).toBe(
      true,
    );
  });

  it("draggers walk south with pickup held during the walk window", () => {
    for (let tick = 0; tick < ACT1_DRAGGER_WALK_TICKS; tick++) {
      const left = ACT1_LEFT_DRAGGER_RECORDING.frames[tick].keys;
      const right = ACT1_RIGHT_DRAGGER_RECORDING.frames[tick].keys;
      // `back` axis increases world-Z, which is the southbound direction in
      // the room's coordinate convention (north door at -depth/2).
      expect(left.back).toBe(true);
      expect(right.back).toBe(true);
      // Pickup is held throughout the walk so a future ghost-to-ghost
      // carry attachment treats the actors as actively carrying the body.
      expect(left.pickup).toBe(true);
      expect(right.pickup).toBe(true);
      // No other axes are pressed.
      expect(left.forward).toBe(false);
      expect(left.left).toBe(false);
      expect(left.right).toBe(false);
      expect(left.punch).toBe(false);
      expect(left.throw).toBe(false);
    }
  });

  it("draggers idle (zero input) past the walk window", () => {
    for (
      let tick = ACT1_DRAGGER_WALK_TICKS;
      tick < ACT1_CINEMATIC_DURATION_TICKS;
      tick++
    ) {
      const left = ACT1_LEFT_DRAGGER_RECORDING.frames[tick].keys;
      const right = ACT1_RIGHT_DRAGGER_RECORDING.frames[tick].keys;
      expect(left.back).toBe(false);
      expect(left.forward).toBe(false);
      expect(left.left).toBe(false);
      expect(left.right).toBe(false);
      expect(left.pickup).toBe(false);
      expect(left.punch).toBe(false);
      expect(left.throw).toBe(false);
      expect(right.back).toBe(false);
      expect(right.pickup).toBe(false);
    }
  });

  it("body recording's sole frame has every axis at zero", () => {
    const keys = ACT1_KNOCKOUT_BODY_RECORDING.frames[0].keys;
    expect(keys.forward).toBe(false);
    expect(keys.back).toBe(false);
    expect(keys.left).toBe(false);
    expect(keys.right).toBe(false);
    expect(keys.punch).toBe(false);
    expect(keys.pickup).toBe(false);
    expect(keys.throw).toBe(false);
  });

  it("every recorded frame stamps the 12:00 normalized timeOfDay", () => {
    const expected = hourToNormalized(12);
    for (const frame of ACT1_LEFT_DRAGGER_RECORDING.frames) {
      expect(frame.timeOfDay).toBe(expected);
    }
    for (const frame of ACT1_RIGHT_DRAGGER_RECORDING.frames) {
      expect(frame.timeOfDay).toBe(expected);
    }
    expect(ACT1_KNOCKOUT_BODY_RECORDING.frames[0].timeOfDay).toBe(expected);
  });

  it("frame tick indices are monotonic from zero", () => {
    ACT1_LEFT_DRAGGER_RECORDING.frames.forEach((frame, i) => {
      expect(frame.tick).toBe(i);
    });
    ACT1_RIGHT_DRAGGER_RECORDING.frames.forEach((frame, i) => {
      expect(frame.tick).toBe(i);
    });
  });
});

describe("act1Cinematic spawn poses", () => {
  it("left dragger spawn is just inside the North door, left of center", () => {
    expect(ACT1_LEFT_DRAGGER_SPAWN.x).toBeLessThan(0);
    // North door sits at z = -depth / 2 = -5; "just inside" means slightly
    // less negative than -5.
    expect(ACT1_LEFT_DRAGGER_SPAWN.z).toBeGreaterThan(-5);
    expect(ACT1_LEFT_DRAGGER_SPAWN.z).toBeLessThan(0);
  });

  it("right dragger spawn mirrors the left dragger across the X axis", () => {
    expect(ACT1_RIGHT_DRAGGER_SPAWN.x).toBe(-ACT1_LEFT_DRAGGER_SPAWN.x);
    expect(ACT1_RIGHT_DRAGGER_SPAWN.z).toBe(ACT1_LEFT_DRAGGER_SPAWN.z);
  });

  it("body spawn is centered between the draggers, just inside the North door", () => {
    expect(ACT1_KNOCKOUT_BODY_SPAWN.x).toBe(0);
    expect(ACT1_KNOCKOUT_BODY_SPAWN.z).toBeGreaterThan(-5);
    expect(ACT1_KNOCKOUT_BODY_SPAWN.z).toBeLessThan(0);
  });

  it("spawn pose objects are frozen", () => {
    expect(Object.isFrozen(ACT1_LEFT_DRAGGER_SPAWN)).toBe(true);
    expect(Object.isFrozen(ACT1_RIGHT_DRAGGER_SPAWN)).toBe(true);
    expect(Object.isFrozen(ACT1_KNOCKOUT_BODY_SPAWN)).toBe(true);
  });
});

describe("act1Cinematic fade timing constants", () => {
  it("fade starts before the cinematic ends and finishes inside the window", () => {
    expect(ACT1_CINEMATIC_FADE_START_TICK).toBeGreaterThan(0);
    expect(ACT1_CINEMATIC_FADE_START_TICK).toBeLessThan(
      ACT1_CINEMATIC_DURATION_TICKS,
    );
    expect(
      ACT1_CINEMATIC_FADE_START_TICK + ACT1_CINEMATIC_FADE_DURATION_TICKS,
    ).toBeLessThanOrEqual(ACT1_CINEMATIC_DURATION_TICKS);
  });

  it("fade duration is positive", () => {
    expect(ACT1_CINEMATIC_FADE_DURATION_TICKS).toBeGreaterThan(0);
  });

  it("draggers finish walking before the fade begins", () => {
    expect(ACT1_DRAGGER_WALK_TICKS).toBeLessThanOrEqual(
      ACT1_CINEMATIC_FADE_START_TICK,
    );
  });
});

describe("mountAct1Cinematic host hook", () => {
  it("files exactly three ghosts into the 12:00 bucket", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    expect(registry.ghostsFor(12).length).toBe(0);

    mountAct1Cinematic({ registry, scene, world });

    expect(registry.ghostsFor(12).length).toBe(3);
  });

  it("returns the three ghost handles in left/right/body order", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const mounted = mountAct1Cinematic({ registry, scene, world });

    expect(mounted.leftDragger).toBeDefined();
    expect(mounted.rightDragger).toBeDefined();
    expect(mounted.body).toBeDefined();
    expect(mounted.leftDragger).not.toBe(mounted.rightDragger);
  });

  it("each cinematic ghost spawns at its declared start pose", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const mounted = mountAct1Cinematic({ registry, scene, world });

    const leftPos = mounted.leftDragger.body.translation();
    expect(leftPos.x).toBeCloseTo(ACT1_LEFT_DRAGGER_SPAWN.x, 6);
    expect(leftPos.z).toBeCloseTo(ACT1_LEFT_DRAGGER_SPAWN.z, 6);

    const rightPos = mounted.rightDragger.body.translation();
    expect(rightPos.x).toBeCloseTo(ACT1_RIGHT_DRAGGER_SPAWN.x, 6);
    expect(rightPos.z).toBeCloseTo(ACT1_RIGHT_DRAGGER_SPAWN.z, 6);

    const bodyPos = mounted.body.body.translation();
    expect(bodyPos.x).toBeCloseTo(ACT1_KNOCKOUT_BODY_SPAWN.x, 6);
    expect(bodyPos.z).toBeCloseTo(ACT1_KNOCKOUT_BODY_SPAWN.z, 6);
  });

  it("the body ghost is unconscious post-mount (Q-021 default)", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const mounted = mountAct1Cinematic({ registry, scene, world });

    expect(mounted.body.consciousness).toBe("unconscious");
    // Draggers stay conscious so the host's per-tick punch resolver does
    // not see them as already-knocked-out actors.
    expect(mounted.leftDragger.consciousness).toBe("conscious");
    expect(mounted.rightDragger.consciousness).toBe("conscious");
  });

  it("each cinematic ghost carries the 12:00 origin tint", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const mounted = mountAct1Cinematic({ registry, scene, world });
    const expected = hourToNormalized(12);

    expect(mounted.leftDragger.originNormalized).toBe(expected);
    expect(mounted.rightDragger.originNormalized).toBe(expected);
    expect(mounted.body.originNormalized).toBe(expected);
  });

  it("cinematic ghosts open hidden because 12:00 is not the active timeline", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const mounted = mountAct1Cinematic({ registry, scene, world });

    expect(mounted.leftDragger.mesh.visible).toBe(false);
    expect(mounted.rightDragger.mesh.visible).toBe(false);
    expect(mounted.body.mesh.visible).toBe(false);
  });

  it("ghosts share unique instance ids within the cinematic", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });

    const mounted = mountAct1Cinematic({ registry, scene, world });
    const ids = new Set([
      mounted.leftDragger.instanceId,
      mounted.rightDragger.instanceId,
      mounted.body.instanceId,
    ]);
    expect(ids.size).toBe(3);
  });
});

describe("mountAct1Cinematic plus ActState observer integration", () => {
  it("after mount, isAct1Spawn reads true with active timeline at 5", () => {
    const scene = new THREE.Scene();
    const world = buildWorld();
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    mountAct1Cinematic({ registry, scene, world });

    // Build a snapshot whose registry view mirrors the live registry's
    // 12:00 bucket count. The `BucketGhostSnapshot` projection only needs
    // the fields the predicates inspect (id, position, consciousness,
    // originNormalized, tickIndex, recordingLength); the predicate for
    // `isAct1Spawn` reads only the count, but the projection keeps
    // shape-compatibility with future predicates that inspect the bucket.
    const ghosts12 = registry.ghostsFor(12).map((g) => {
      const t = g.body.translation();
      return {
        id: g.instanceId,
        position: { x: t.x, z: t.z },
        consciousness: g.consciousness,
        originNormalized: g.originNormalized,
        tickIndex: g.tickIndex,
        recordingLength: g.recording.length,
      };
    });

    const snapshot: ActStateSnapshot = {
      registry: {
        activeTimeline: 5,
        ghostsFor: (timeline) => (timeline === 12 ? ghosts12 : []),
      },
      instances: [],
      currentTimeline: 5,
      activePlayer: {
        instanceId: 1,
        position: { x: 0, z: 0 },
        consciousness: "conscious",
        carry: { kind: "idle" },
      },
      recentWestEntries: [],
      activePlayerCrossedNorthAt12: false,
    };

    expect(isAct1Spawn(snapshot)).toBe(true);
  });

  it("isAct1Spawn reads false before the cinematic is mounted", () => {
    const registry = createTimelineRegistry({ initialTimeline: 5 });
    // No mountAct1Cinematic call: the 12:00 bucket is empty.
    const snapshot: ActStateSnapshot = {
      registry: {
        activeTimeline: 5,
        ghostsFor: () => [],
      },
      instances: [],
      currentTimeline: 5,
      activePlayer: {
        instanceId: 1,
        position: { x: 0, z: 0 },
        consciousness: "conscious",
        carry: { kind: "idle" },
      },
      recentWestEntries: [],
      activePlayerCrossedNorthAt12: false,
    };

    expect(registry.ghostsFor(12).length).toBe(0);
    expect(isAct1Spawn(snapshot)).toBe(false);
  });
});
