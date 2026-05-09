/**
 * Tests for the pure pickup-and-carry helpers (REQ-034).
 *
 * The data half of the carry system: state types, constants, and the
 * three pure helpers `nearestCarryable`, `applyCarrySpeedScaling`, and
 * `resolveCarryToggle`. The dossier
 * (`docs/gdd/30-combat-and-interaction.md` section 5) is the source of
 * truth for the constants and the toggle semantics.
 *
 * Side-effecting tests (Rapier body-type flips, mesh attachment) live in
 * `applyCarry.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  CARRY_OFFSET,
  CARRY_SPEED_MULTIPLIER,
  INITIAL_CARRY_STATE,
  PICKUP_RANGE_M,
  applyCarrySpeedScaling,
  nearestCarryable,
  resolveCarryToggle,
  type CarryState,
  type Carryable,
} from "../../src/sim/carryState.ts";

const conscious = (id: number, x: number, z: number): Carryable => ({
  id,
  position: { x, z },
  consciousness: "conscious",
});

const unconscious = (id: number, x: number, z: number): Carryable => ({
  id,
  position: { x, z },
  consciousness: "unconscious",
});

describe("carry constants (REQ-034)", () => {
  it("ships the dossier-default pickup range and speed multiplier", () => {
    expect(PICKUP_RANGE_M).toBe(1.0);
    expect(CARRY_SPEED_MULTIPLIER).toBe(0.6);
  });

  it("places the carry offset at head/shoulder height (Q-006 default)", () => {
    expect(CARRY_OFFSET).toEqual({ x: 0, y: 1.2, z: 0 });
  });

  it("opens at 'idle' (INITIAL_CARRY_STATE)", () => {
    expect(INITIAL_CARRY_STATE).toEqual({ kind: "idle" });
  });
});

describe("nearestCarryable: closest unconscious in range", () => {
  const carrier = { id: 1, position: { x: 0, z: 0 } };

  it("returns null when the candidate set is empty", () => {
    expect(nearestCarryable(carrier, [])).toBeNull();
  });

  it("returns null when no candidates are unconscious", () => {
    expect(
      nearestCarryable(carrier, [
        conscious(2, 0.5, 0),
        conscious(3, 0, 0.5),
      ]),
    ).toBeNull();
  });

  it("returns null when all unconscious candidates are out of range", () => {
    expect(
      nearestCarryable(carrier, [
        unconscious(2, PICKUP_RANGE_M + 0.1, 0),
        unconscious(3, 0, PICKUP_RANGE_M + 0.5),
      ]),
    ).toBeNull();
  });

  it("returns the only in-range unconscious candidate", () => {
    const target = unconscious(2, 0.5, 0.5);
    expect(nearestCarryable(carrier, [target])).toEqual(target);
  });

  it("picks the closer of two in-range unconscious candidates", () => {
    const closer = unconscious(2, 0.5, 0);
    const farther = unconscious(3, 0.9, 0);
    expect(nearestCarryable(carrier, [farther, closer])).toEqual(closer);
  });

  it("breaks ties on equal squared distance by smallest id", () => {
    const a = unconscious(5, 0.6, 0);
    const b = unconscious(2, 0.6, 0);
    expect(nearestCarryable(carrier, [a, b])).toEqual(b);
  });

  it("ignores conscious candidates even when they are closer than an unconscious one", () => {
    const consciousNear = conscious(2, 0.1, 0);
    const unconsciousFar = unconscious(3, 0.8, 0);
    expect(
      nearestCarryable(carrier, [consciousNear, unconsciousFar]),
    ).toEqual(unconsciousFar);
  });

  it("filters out the carrier itself from the candidate set", () => {
    const self: Carryable = {
      id: carrier.id,
      position: { x: 0, z: 0 },
      consciousness: "unconscious",
    };
    const other = unconscious(2, 0.6, 0);
    expect(nearestCarryable(carrier, [self, other])).toEqual(other);
  });

  it("treats a candidate exactly at the range boundary as in-range", () => {
    const onBoundary = unconscious(2, PICKUP_RANGE_M, 0);
    expect(nearestCarryable(carrier, [onBoundary])).toEqual(onBoundary);
  });

  it("respects a custom range argument", () => {
    const inDefaultButOutOfTight = unconscious(2, 0.9, 0);
    expect(nearestCarryable(carrier, [inDefaultButOutOfTight], 0.5)).toBeNull();
    expect(nearestCarryable(carrier, [inDefaultButOutOfTight], 1.0)).toEqual(
      inDefaultButOutOfTight,
    );
  });
});

describe("applyCarrySpeedScaling: REQ-034 / Q-005 multiplier", () => {
  it("passes velocity through unchanged when state is idle", () => {
    const idle: CarryState = { kind: "idle" };
    expect(applyCarrySpeedScaling(idle, { x: 4, z: -3 })).toEqual({
      x: 4,
      z: -3,
    });
  });

  it("multiplies both axes by 0.6 when state is carrying", () => {
    const carrying: CarryState = { kind: "carrying", carriedId: 2 };
    const v = applyCarrySpeedScaling(carrying, { x: 4, z: -3 });
    expect(v.x).toBeCloseTo(4 * CARRY_SPEED_MULTIPLIER, 12);
    expect(v.z).toBeCloseTo(-3 * CARRY_SPEED_MULTIPLIER, 12);
  });

  it("returns zero unchanged when carrying", () => {
    const carrying: CarryState = { kind: "carrying", carriedId: 2 };
    expect(applyCarrySpeedScaling(carrying, { x: 0, z: 0 })).toEqual({
      x: 0,
      z: 0,
    });
  });

  it("does not mutate the input vector", () => {
    const input = { x: 4, z: -3 };
    const carrying: CarryState = { kind: "carrying", carriedId: 2 };
    applyCarrySpeedScaling(carrying, input);
    expect(input).toEqual({ x: 4, z: -3 });
  });
});

describe("resolveCarryToggle: REQ-034 toggle semantics", () => {
  const carrier = { id: 1, position: { x: 0, z: 0 } };

  it("returns the same state when there is no rising edge (idle pass-through)", () => {
    const idle: CarryState = { kind: "idle" };
    expect(
      resolveCarryToggle(idle, false, carrier, [unconscious(2, 0.5, 0)]),
    ).toBe(idle);
  });

  it("returns the same state when there is no rising edge (carrying pass-through)", () => {
    const carrying: CarryState = { kind: "carrying", carriedId: 2 };
    expect(resolveCarryToggle(carrying, false, carrier, [])).toBe(carrying);
  });

  it("transitions idle -> carrying when an in-range unconscious candidate exists on a rising edge", () => {
    const idle: CarryState = { kind: "idle" };
    const next = resolveCarryToggle(idle, true, carrier, [
      unconscious(2, 0.5, 0),
    ]);
    expect(next).toEqual({ kind: "carrying", carriedId: 2 });
  });

  it("stays idle on a rising edge when no candidate is in range (no-op idempotence)", () => {
    const idle: CarryState = { kind: "idle" };
    const next = resolveCarryToggle(idle, true, carrier, [
      unconscious(2, PICKUP_RANGE_M + 0.5, 0),
    ]);
    expect(next).toEqual({ kind: "idle" });
  });

  it("stays idle on a rising edge when only conscious candidates are in range", () => {
    const idle: CarryState = { kind: "idle" };
    const next = resolveCarryToggle(idle, true, carrier, [
      conscious(2, 0.4, 0),
    ]);
    expect(next).toEqual({ kind: "idle" });
  });

  it("transitions carrying -> idle on a rising edge unconditionally (drop)", () => {
    const carrying: CarryState = { kind: "carrying", carriedId: 7 };
    const next = resolveCarryToggle(carrying, true, carrier, []);
    expect(next).toEqual({ kind: "idle" });
  });

  it("drops even when the previously-carried body is no longer in the candidate list", () => {
    // Edge case from the dossier: the carried body was removed (e.g.,
    // via hard reset on a follow-up tick) but the resolver still
    // produces a clean drop on the rising edge.
    const carrying: CarryState = { kind: "carrying", carriedId: 99 };
    const next = resolveCarryToggle(carrying, true, carrier, [
      unconscious(2, 0.4, 0),
    ]);
    expect(next).toEqual({ kind: "idle" });
  });

  it("picks the closest in-range unconscious candidate when multiple are in range", () => {
    const idle: CarryState = { kind: "idle" };
    const next = resolveCarryToggle(idle, true, carrier, [
      unconscious(3, 0.9, 0),
      unconscious(2, 0.4, 0),
    ]);
    expect(next).toEqual({ kind: "carrying", carriedId: 2 });
  });
});
