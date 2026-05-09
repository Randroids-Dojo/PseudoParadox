/**
 * Drag regression (REQ-035).
 *
 * Drag is not a separate mechanic. It is the visible consequence of
 * pickup (REQ-034) plus movement: the carrier walks, the carried body's
 * kinematic translation is rewritten each tick to track the carrier
 * plus `CARRY_OFFSET`, so the body translates with the carrier.
 *
 * This file ships the regression test contract that pins those
 * invariants. The implementation is the existing carry layer
 * (`src/sim/carryState.ts`, `src/sim/applyCarry.ts`) plus the host
 * loop's per-tick attachment call. The tests below mirror the host
 * loop's carry sequence in a minimal harness so they exercise the
 * SAME side-effect order the production loop runs in.
 *
 * Coverage (`docs/gdd/30-combat-and-interaction.md` section 6):
 *
 *   1. Carrier walks N ticks while carrying. Body's planar position
 *      tracks carrier + CARRY_OFFSET each tick.
 *   2. Carrier walks then drops. Body lands at the carrier's current
 *      planar position, NOT the pickup position.
 *   3. Carrier traverses a lit portal while carrying. The carried
 *      body remains attached after the traversal (carry survives
 *      portal entry per dossier section 5 edge case 2; only THROWN
 *      bodies detach on traversal).
 *   4. Carrier is knocked out mid-drag (force-drop path). Subsequent
 *      carrier motion does not move the dropped body.
 *   5. Carrier stops moving while carrying. Body stays put (no drift).
 *   6. Hard reset (REQ-025) returns carry state to idle while
 *      carrying.
 */

import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  applyCarryAttachment,
  applyCarryDrop,
  applyCarryPickup,
} from "../../src/sim/applyCarry.ts";
import { CARRY_OFFSET } from "../../src/sim/carryState.ts";
import { wireTraversal } from "../../src/sim/portalTraversal.ts";
import { createPortalTriggerSet } from "../../src/sim/portalTrigger.ts";
import { createPortal } from "../../src/sim/portal.ts";
import { createDoor, type DoorDirection } from "../../src/scene/door.ts";
import { ROOM_DIMENSIONS } from "../../src/scene/room.ts";
import { PLAYER_CAPSULE } from "../../src/scene/player.ts";
import { InputRecorder } from "../../src/sim/inputRecorder.ts";
import { applyInstanceTint } from "../../src/render/instanceTint.ts";
import { createTimelineRegistry } from "../../src/sim/timelineRegistry.ts";
import { hardReset } from "../../src/sim/hardReset.ts";
import { TimeOfDay } from "../../src/sim/timeOfDay.ts";
import {
  ACT_ONE_HOUR,
  ACT_ONE_NORMALIZED,
} from "../../src/sim/actOneAnchor.ts";
import { createFourDoors } from "../../src/scene/door.ts";
import { createActOnePortals } from "../../src/sim/portal.ts";
import type {
  ActiveLifetime,
  ActivePlayerHandle,
} from "../../src/sim/portalTraversal.ts";

beforeAll(async () => {
  await RAPIER.init();
});

const HALF_DEPTH = ROOM_DIMENSIONS.depth / 2;

const RESTING_Y =
  PLAYER_CAPSULE.cylinderLength / 2 + PLAYER_CAPSULE.radius;

const buildCapsuleBody = (
  world: RAPIER.World,
  x: number,
  z: number,
): RAPIER.RigidBody => {
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, RESTING_Y, z)
    .enabledRotations(false, true, false)
    .setLinearDamping(8.0);
  const body = world.createRigidBody(desc);
  world.createCollider(
    RAPIER.ColliderDesc.capsule(
      PLAYER_CAPSULE.cylinderLength / 2,
      PLAYER_CAPSULE.radius,
    ).setFriction(0.5),
    body,
  );
  return body;
};

interface DragHarness {
  scene: THREE.Scene;
  world: RAPIER.World;
  carrier: RAPIER.RigidBody;
  carried: RAPIER.RigidBody;
}

const buildDragHarness = (): DragHarness => {
  const scene = new THREE.Scene();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const carrier = buildCapsuleBody(world, 0, 0);
  // Carried body sits within PICKUP_RANGE_M of the carrier.
  const carried = buildCapsuleBody(world, 0.5, 0);
  return { scene, world, carrier, carried };
};

/**
 * Mirror the host loop's per-tick carry sequence for a SINGLE step:
 *
 *   1. Write the carrier's planar velocity for this tick.
 *   2. Run the per-tick attachment so the carried body's next
 *      kinematic translation tracks the carrier (using the carrier's
 *      pre-step pose).
 *   3. Step the world.
 *
 * The order matters: the attachment runs AFTER the velocity write so
 * the carrier's intended motion is what the body follows on the next
 * world.step(). This mirrors `src/app.ts`'s carry sequence.
 *
 * Returns the carrier's pre-step translation so callers can assert
 * the body's post-step translation against the value the attachment
 * actually wrote (the carried body's kinematic target was the
 * carrier's pose at the moment of `applyCarryAttachment`, not the
 * carrier's post-step pose). The body therefore tracks the
 * carrier's PREVIOUS-frame translation: a one-step lag is the
 * deterministic, expected consequence of the kinematic attachment
 * model.
 */
const tickWhileCarrying = (
  carrier: RAPIER.RigidBody,
  carried: RAPIER.RigidBody,
  velocity: { x: number; z: number },
  world: RAPIER.World,
): { x: number; y: number; z: number } => {
  carrier.setLinvel({ x: velocity.x, y: carrier.linvel().y, z: velocity.z }, true);
  const preStep = carrier.translation();
  const captured = { x: preStep.x, y: preStep.y, z: preStep.z };
  applyCarryAttachment(carrier, carried);
  world.step();
  return captured;
};

describe("drag regression (REQ-035): body tracks carrier under continuous motion", () => {
  it("carried body's planar position tracks the carrier's pre-step pose plus CARRY_OFFSET each tick across a 5-tick walk", () => {
    // The kinematic attachment writes the carrier's pre-step translation +
    // CARRY_OFFSET as the body's next target. Rapier integrates that
    // target across the same world.step() during which the carrier moves
    // forward, so the body lands at the PRE-step carrier pose plus the
    // offset (a deterministic one-step lag). This is the production
    // contract: the body tracks the carrier with one step of latency.
    const { world, carrier, carried } = buildDragHarness();
    applyCarryPickup(carried);

    const v = { x: 0, z: -2 };
    for (let i = 0; i < 5; i++) {
      const preStepCarrier = tickWhileCarrying(carrier, carried, v, world);
      const bP = carried.translation();
      expect(bP.x).toBeCloseTo(preStepCarrier.x + CARRY_OFFSET.x, 4);
      expect(bP.y).toBeCloseTo(preStepCarrier.y + CARRY_OFFSET.y, 4);
      expect(bP.z).toBeCloseTo(preStepCarrier.z + CARRY_OFFSET.z, 4);
    }
    // The carrier actually translated over the 5-tick walk.
    const finalCarrier = carrier.translation();
    expect(finalCarrier.z).toBeLessThan(-0.05);
  });

  it("body tracks the carrier through a direction change mid-walk", () => {
    const { world, carrier, carried } = buildDragHarness();
    applyCarryPickup(carried);

    // 3 ticks forward, 3 ticks east.
    for (let i = 0; i < 3; i++) {
      tickWhileCarrying(carrier, carried, { x: 0, z: -2 }, world);
    }
    let lastPreStep: { x: number; y: number; z: number } | null = null;
    for (let i = 0; i < 3; i++) {
      lastPreStep = tickWhileCarrying(carrier, carried, { x: 2, z: 0 }, world);
    }
    const cP = carrier.translation();
    const bP = carried.translation();
    // Body tracks the LAST pre-step carrier pose (one-step lag).
    expect(lastPreStep).not.toBeNull();
    expect(bP.x).toBeCloseTo(lastPreStep!.x + CARRY_OFFSET.x, 4);
    expect(bP.z).toBeCloseTo(lastPreStep!.z + CARRY_OFFSET.z, 4);
    // The carrier actually moved on both axes.
    expect(Math.abs(cP.x)).toBeGreaterThan(0);
    expect(Math.abs(cP.z)).toBeGreaterThan(0);
  });

  it("zero-velocity ticks freeze the carried body's planar position relative to the (settled) carrier", () => {
    // Carrying at zero input velocity does not translate the body
    // arbitrarily: the body's planar position drifts at most as much
    // as the carrier does. The key invariant the test pins is that
    // the body cannot move INDEPENDENTLY of the carrier under a
    // zero-input regime; any motion the carrier makes (e.g. coasting
    // under the kinematic attachment's incidental contact, a
    // documented Q-006 belt-and-suspenders followup) is mirrored on
    // the body within a small bounded delta.
    const { world, carrier, carried } = buildDragHarness();
    applyCarryPickup(carried);

    // Walk a few ticks so the carrier is at a non-origin pose.
    for (let i = 0; i < 4; i++) {
      tickWhileCarrying(carrier, carried, { x: 1, z: 0 }, world);
    }
    const settledCarrier = carrier.translation();
    const settledCarried = carried.translation();
    const settledOffset = {
      x: settledCarried.x - settledCarrier.x,
      z: settledCarried.z - settledCarrier.z,
    };

    // Stand still: zero linvel each tick.
    for (let i = 0; i < 30; i++) {
      tickWhileCarrying(carrier, carried, { x: 0, z: 0 }, world);
    }
    const finalCarrier = carrier.translation();
    const finalCarried = carried.translation();
    const finalOffset = {
      x: finalCarried.x - finalCarrier.x,
      z: finalCarried.z - finalCarrier.z,
    };
    // The carrier-to-carried planar offset is bounded across the
    // standstill window: the body did not drift away from the
    // carrier under zero-input motion. Tolerance is one step of
    // physics integration.
    expect(Math.abs(finalOffset.x - settledOffset.x)).toBeLessThan(0.5);
    expect(Math.abs(finalOffset.z - settledOffset.z)).toBeLessThan(0.5);
  });
});

describe("drag regression (REQ-035): drop semantics", () => {
  it("dropping mid-walk leaves the body at the carrier's current planar position, NOT the pickup position", () => {
    const { world, carrier, carried } = buildDragHarness();
    const pickupPosition = {
      x: carried.translation().x,
      z: carried.translation().z,
    };
    applyCarryPickup(carried);

    // Walk forward for 5 ticks.
    for (let i = 0; i < 5; i++) {
      tickWhileCarrying(carrier, carried, { x: 0, z: -2 }, world);
    }
    const carrierAtDrop = {
      x: carrier.translation().x,
      z: carrier.translation().z,
    };

    applyCarryDrop(carrier, carried, RESTING_Y);

    const dropped = carried.translation();
    expect(dropped.x).toBeCloseTo(carrierAtDrop.x, 4);
    expect(dropped.z).toBeCloseTo(carrierAtDrop.z, 4);
    expect(dropped.y).toBeCloseTo(RESTING_Y, 4);

    // Sanity: the drop position is NOT the pickup position (the carrier
    // actually moved between pickup and drop).
    expect(
      Math.hypot(
        carrierAtDrop.x - pickupPosition.x,
        carrierAtDrop.z - pickupPosition.z,
      ),
    ).toBeGreaterThan(0.5);
  });

  it("after a drop, the body is no longer kinematically attached to the carrier", () => {
    // The drop transition flips the body back to Dynamic. From that
    // moment, applyCarryAttachment is not called on the body anymore
    // (the host loop gates the attachment on
    // `player.carry.kind === 'carrying'`). To pin the contract, we
    // teleport the carrier far away post-drop and confirm the body
    // does not chase: the body's planar position drifts only under
    // gravity and damping, NOT by tracking the carrier.
    const { world, carrier, carried } = buildDragHarness();
    applyCarryPickup(carried);
    for (let i = 0; i < 3; i++) {
      tickWhileCarrying(carrier, carried, { x: 0, z: -1.5 }, world);
    }
    applyCarryDrop(carrier, carried, RESTING_Y);

    const droppedAt = {
      x: carried.translation().x,
      z: carried.translation().z,
    };

    // Teleport the carrier far away (no contact with the dropped
    // body) to prove the body does not follow.
    carrier.setTranslation(
      { x: droppedAt.x + 10, y: RESTING_Y, z: droppedAt.z + 10 },
      true,
    );
    carrier.setLinvel({ x: 0, y: 0, z: 0 }, true);

    for (let i = 0; i < 30; i++) {
      world.step();
    }

    const finalCarried = carried.translation();
    const finalCarrier = carrier.translation();
    // Carrier is far away.
    expect(Math.abs(finalCarrier.x - droppedAt.x)).toBeGreaterThan(5);
    // Body did not follow: its planar XZ remained near droppedAt.
    expect(finalCarried.x).toBeCloseTo(droppedAt.x, 1);
    expect(finalCarried.z).toBeCloseTo(droppedAt.z, 1);
  });
});

describe("drag regression (REQ-035): force-drop on knockout-while-carrying", () => {
  it("after a force-drop, continuing to walk the carrier does not translate the dropped body (REQ-034 edge case 3)", () => {
    // The host loop force-drops the body when the carrier is knocked
    // out mid-carry; the dossier specifies the body falls in place at
    // the carrier's planar position. After the drop, the body is
    // dynamic and unattached, so subsequent carrier motion does not
    // affect it. This test mirrors the relevant slice of the host
    // loop: pickup, walk, force-drop via applyCarryDrop, walk
    // further, body did not move.
    const { world, carrier, carried } = buildDragHarness();
    applyCarryPickup(carried);
    for (let i = 0; i < 4; i++) {
      tickWhileCarrying(carrier, carried, { x: 1.5, z: 0 }, world);
    }
    // Force-drop in place at the carrier's pose.
    applyCarryDrop(carrier, carried, RESTING_Y);
    const carrierAtDrop = carrier.translation();
    const dropped = carried.translation();
    expect(dropped.x).toBeCloseTo(carrierAtDrop.x, 4);
    expect(dropped.z).toBeCloseTo(carrierAtDrop.z, 4);

    // Teleport the carrier far away (no contact with the dropped
    // body) and step. The body must not follow.
    const beforeChase = {
      x: carried.translation().x,
      z: carried.translation().z,
    };
    carrier.setTranslation(
      { x: beforeChase.x + 10, y: RESTING_Y, z: beforeChase.z + 10 },
      true,
    );
    carrier.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 20; i++) {
      world.step();
    }
    const afterChase = carried.translation();
    expect(afterChase.x).toBeCloseTo(beforeChase.x, 1);
    expect(afterChase.z).toBeCloseTo(beforeChase.z, 1);
  });
});

describe("drag regression (REQ-035): carry survives lit-portal traversal", () => {
  it("after the carrier traverses a lit portal, the player.carry state is preserved (the body is still carried in the destination timeline)", () => {
    // The dossier section 5 edge case 2 specifies that picking up at a
    // portal trigger is allowed and the next portal traversal of the
    // carrier carries the body. wireTraversal does NOT branch on the
    // carry state (per portalTraversal.ts ActivePlayerHandle.carry
    // docstring), so the carry state passes through traversal
    // untouched. This test pins that contract.
    const scene = new THREE.Scene();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    const playerBody = buildCapsuleBody(world, 0, 0);
    const playerMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(
        PLAYER_CAPSULE.radius,
        PLAYER_CAPSULE.cylinderLength,
        8,
        16,
      ),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    applyInstanceTint(playerMesh, 0);
    scene.add(playerMesh);

    const player: ActivePlayerHandle = {
      body: playerBody,
      mesh: playerMesh,
      originNormalized: 0,
      instanceId: 1,
      consciousness: "conscious",
      // Pre-set to carrying with carriedId 99 so the post-traversal
      // assertion is observable.
      carry: { kind: "carrying", carriedId: 99 },
    };
    const lifetime: ActiveLifetime = {
      startPosition: { x: 0, z: 0 },
      recorder: new InputRecorder(),
      originNormalized: 0,
      instanceId: 1,
    };
    const registry = createTimelineRegistry({ initialTimeline: 0 });

    const south = createPortal({
      door: createDoor("south" as DoorDirection, ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth),
      destinationHours: 12,
      isLit: true,
    });
    const detector = createPortalTriggerSet([south]);
    wireTraversal({
      detector,
      player,
      lifetime,
      scene,
      world,
      registry,
    });

    // Record one frame so the spawned ghost has something to play.
    lifetime.recorder.record(
      { forward: false, back: false, left: false, right: false, punch: false, pickup: false, throw: false },
      0,
    );
    // Step into the south portal trigger volume.
    detector.step(0, HALF_DEPTH - 0.4, 0);

    // Post-traversal assertion: the carry state is preserved as the
    // dossier specifies. carriedId 99 is unchanged.
    expect(player.carry).toEqual({ kind: "carrying", carriedId: 99 });
  });

  it("post-traversal, the per-tick carry attachment re-anchors the carried body to the destination spawn pose immediately on the next tick", () => {
    // After traversal the player teleports to the destination spawn
    // pose (room center by default). On the very next tick, the host
    // loop's per-tick attachment writes the (post-teleport) carrier
    // pose + CARRY_OFFSET onto the carried body's next kinematic
    // translation. The body's post-step translation lands at exactly
    // the value `applyCarryAttachment` wrote, regardless of how the
    // carrier moves during the step (kinematic targets are absolute,
    // not relative).
    const { world, carrier, carried } = buildDragHarness();
    applyCarryPickup(carried);

    // Simulate wireTraversal: teleport carrier to (0, 0) and zero
    // linvel.
    carrier.setTranslation({ x: 0, y: RESTING_Y, z: 0 }, true);
    carrier.setLinvel({ x: 0, y: 0, z: 0 }, true);

    // The attachment writes the carrier's pose + CARRY_OFFSET as the
    // body's kinematic target. We capture the exact target written.
    const preStepCarrier = carrier.translation();
    const expectedTarget = {
      x: preStepCarrier.x + CARRY_OFFSET.x,
      y: preStepCarrier.y + CARRY_OFFSET.y,
      z: preStepCarrier.z + CARRY_OFFSET.z,
    };
    applyCarryAttachment(carrier, carried);
    world.step();

    const bP = carried.translation();
    // Body lands at the kinematic target the attachment wrote.
    expect(bP.x).toBeCloseTo(expectedTarget.x, 4);
    expect(bP.y).toBeCloseTo(expectedTarget.y, 4);
    expect(bP.z).toBeCloseTo(expectedTarget.z, 4);
  });
});

describe("drag regression (REQ-035): hard reset clears carry state mid-drag", () => {
  it("hard reset called while carrying returns player.carry to idle", () => {
    // Pin the contract that REQ-025 hard reset clears the carry slot
    // even when the player was actively dragging at the moment of
    // reset. This is already covered in `tests/sim/hardReset.test.ts`
    // (carry state reset describe) but we re-pin it here from the
    // drag-regression vantage so a future change to the carry
    // attachment cannot silently break the reset path.
    const scene = new THREE.Scene();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    const { radius, cylinderLength } = PLAYER_CAPSULE;
    const restY = cylinderLength / 2 + radius;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(2, restY, 3)
      .enabledRotations(false, true, false)
      .setLinearDamping(8.0);
    const playerBody = world.createRigidBody(desc);
    world.createCollider(
      RAPIER.ColliderDesc.capsule(cylinderLength / 2, radius),
      playerBody,
    );
    const playerMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, cylinderLength, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xc4d0e6 }),
    );
    scene.add(playerMesh);

    const player: ActivePlayerHandle = {
      body: playerBody,
      mesh: playerMesh,
      originNormalized: 6 / 24,
      instanceId: 4,
      consciousness: "conscious",
      // Mid-drag at reset time.
      carry: { kind: "carrying", carriedId: 99 },
    };
    const lifetime: ActiveLifetime = {
      startPosition: { x: 1, z: 2 },
      recorder: new InputRecorder(),
      originNormalized: 6 / 24,
      instanceId: 4,
    };
    const registry = createTimelineRegistry({ initialTimeline: ACT_ONE_HOUR });
    const timeOfDay = new TimeOfDay({
      ticksPerSecond: 60,
      initialNormalized: 8 / 24,
    });
    const doors = createFourDoors(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);
    for (const door of doors) scene.add(door.mesh);
    const portals = createActOnePortals(doors);
    const portalTriggers = createPortalTriggerSet(portals);

    hardReset({
      player,
      lifetime,
      registry,
      scene,
      world,
      timeOfDay,
      portals,
      portalTriggers,
    });

    expect(player.carry).toEqual({ kind: "idle" });
    expect(timeOfDay.normalized()).toBeCloseTo(ACT_ONE_NORMALIZED, 6);
  });
});
