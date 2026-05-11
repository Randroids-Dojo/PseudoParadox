import RAPIER from "@dimforge/rapier3d-compat";
import { createRenderer } from "./render/renderer.ts";
import { interpolateWarmToCool } from "./render/colorTint.ts";
import { buildScene } from "./scene/scene.ts";
import { createRoomColliders } from "./scene/room.ts";
import { createPlayer } from "./scene/player.ts";
import { createFloorRing, updateFloorRing } from "./scene/floorRing.ts";
import { createKeyboardState, inputToVelocity } from "./input/keyboard.ts";
import { bindTouchControls } from "./input/touch.ts";
import { createTouchOverlay } from "./render/touchOverlay.ts";
import { TimeOfDay } from "./sim/timeOfDay.ts";
import { ACT_ONE_HOUR, ACT_ONE_NORMALIZED } from "./sim/actOneAnchor.ts";
import { InputRecorder } from "./sim/inputRecorder.ts";
import {
  MilestoneRecorder,
  WALL_BUMP_WEIGHT,
} from "./sim/milestone.ts";
import { createWallBumpDetector } from "./sim/wallBumpDetector.ts";
import { INITIAL_INSTANCE_ID } from "./sim/instanceId.ts";
import { createPortalTriggerSet } from "./sim/portalTrigger.ts";
import { despawnGhostsAtLitPortals } from "./sim/ghostDespawn.ts";
import { FIXED_STEP_SECONDS } from "./sim/simulationStep.ts";
import { wireTraversal, type ActiveLifetime } from "./sim/portalTraversal.ts";
import { createTimelineRegistry } from "./sim/timelineRegistry.ts";
import {
  repaintDoorsForHour,
  snapClockToHour,
} from "./sim/timelineRoom.ts";
import { hardReset } from "./sim/hardReset.ts";
import {
  PUNCH_RANGE_M,
  resolvePunches,
  suppressUnconsciousPunches,
  type PunchActor,
} from "./sim/punch.ts";
import { applyKnockout } from "./sim/knockoutState.ts";
import { applyKnockoutBodyResponse } from "./sim/applyKnockoutBody.ts";
import { replayPunchAtTick } from "./sim/inputRecorder.ts";
import {
  PLAYER_CAPSULE,
} from "./scene/player.ts";
import {
  resolveCarryToggle,
  type Carryable,
} from "./sim/carryState.ts";
import {
  applyCarryAttachment,
  applyCarryDrop,
  applyCarryPickup,
  carryTransitionKind,
} from "./sim/applyCarry.ts";
import { tryThrow, type ThrowBodyHandle } from "./sim/throw.ts";
import { createFacingTracker } from "./sim/facing.ts";
import {
  createInFlightRegistry,
  type BodyLitGate,
} from "./sim/bodyTraversal.ts";
import {
  litStateForTimeline,
} from "./sim/litStateForTimeline.ts";
import { isLit as portalAuthoredLit } from "./sim/portal.ts";
import {
  nextQualitativelyDifferentAction,
  type ThoughtPeekKind,
} from "./sim/thoughtBubblePeek.ts";
import { mountAct1Cinematic } from "./sim/scripts/act1Cinematic.ts";
import { createFadeOverlay } from "./render/fadeOverlay.ts";

/**
 * Boots the Pseudo Paradox prototype.
 *
 * Responsibilities of this entry point:
 *   1. Initialize the Rapier3D physics WASM module (async).
 *   2. Build the Three.js renderer and scene.
 *   3. Spin up a fixed-step physics tick alongside the render loop.
 *
 * Subsequent slices will register player input, instance spawn logic, and
 * the timeline recorder against the App returned here.
 */
export async function startApp(container: HTMLElement): Promise<void> {
  await RAPIER.init();

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  const { renderer, onResize } = createRenderer(container);
  const sceneCtx = buildScene();
  // Spawn the static floor and wall colliders so the dynamic player
  // capsule has something to stand on and cannot leak out through the
  // wall meshes. The wall colliders are split with a door-width gap
  // at each midpoint so the player can still walk into the portal
  // trigger volume.
  createRoomColliders(world);
  // Re-fit the orthographic dollhouse frustum on every canvas resize so the
  // room stays fully framed across window resize, device rotation, and
  // initial layout settling. Fires immediately on subscription with the
  // current canvas dimensions.
  onResize((w, h) => sceneCtx.resizeCamera(w, h));
  // REQ-029: warm-to-cool room tint driven by the deterministic simulation
  // tick. The clock is advanced once per fixed physics step below, not per
  // render frame, so REQ-001 timeline recording playback stays frame-exact
  // independent of how many frames render between physics steps.
  // REQ-013 / REQ-014: anchor the opening time at 5:00 on the canonical
  // 24-hour day arc (ACT_ONE_NORMALIZED = 5/24) so the very first frame
  // renders the Act 1 spawn pose: the room tints to the 5:00 amber, the
  // player capsule's tint stamps at the same normalized time, and the door
  // lit/dark state painted in `buildRoom` matches what the GDD specifies
  // for 5:00.
  const timeOfDay = new TimeOfDay({
    ticksPerSecond: 60,
    initialNormalized: ACT_ONE_NORMALIZED,
  });
  // REQ-030: stamp the player capsule with the warm-to-cool tint at its
  // spawn time. The clock starts at the Act 1 5:00 anchor so this lands on
  // the 5:00 hue; a later portal-traversal slice will re-stamp on travel.
  const player = createPlayer(sceneCtx.scene, world, {
    originNormalized: timeOfDay.normalized(),
  });
  // REQ-031: subtle floor ring underneath the active player. This is the
  // prototype's only non-diegetic UI element. The ring is added to the same
  // scene as the player and snapped to the player's planar position each
  // render frame below.
  const floorRing = createFloorRing();
  sceneCtx.scene.add(floorRing);
  updateFloorRing(floorRing, player.body);
  const keyboard = createKeyboardState(window);
  // Touch joystick: float-where-you-tap stick that writes deflection into
  // the same forward/back/left/right booleans the keyboard fills. The
  // physics, recorder, and replay paths all read from `keyboard.state`, so
  // touch and keyboard never conflict and a recording made on one device
  // replays identically on the other. The visible ring/knob is a DOM
  // overlay updated on every state change.
  const touchOverlay = createTouchOverlay(container);
  const touch = bindTouchControls(window, keyboard.state);
  touch.onChange((js) => touchOverlay.update(js));
  // REQ-001 / REQ-002 / REQ-003 foundation: the active player owns a
  // `lifetime` whose `recorder` captures input each fixed step. On portal
  // traversal the lifetime is closed (its recording snapshotted onto a
  // ghost) and a fresh one is opened at the destination time. Holding the
  // lifetime in a `let` keeps the per-frame capture path resolving against
  // the current recorder after a traversal swaps it.
  const playerSpawn = (() => {
    const t = player.body.translation();
    return { x: t.x, z: t.z };
  })();
  const lifetime: ActiveLifetime = {
    startPosition: { ...playerSpawn },
    recorder: new InputRecorder(),
    // F-013 PR3a: parallel milestone recorder. The host records wall_bump
    // milestones below and the wireTraversal handler records the
    // door_traversal milestone immediately before snapshotting on a lit
    // traversal. Reset alongside `recorder` on every lit traversal.
    milestones: new MilestoneRecorder(),
    // F-014: the initial lifetime opens at tick 0 of the Act 1 (5:00)
    // timeline. Subsequent traversals overwrite this with the
    // destination portal's authored `destinationTick`.
    startTick: 0,
    originNormalized: timeOfDay.normalized(),
    // REQ-007: the lifetime opens at the active player's current generation.
    // The first lifetime opens at `INITIAL_INSTANCE_ID = 1` (You1, the GDD's
    // first-ever spawn). On every lit-portal traversal the lifetime advances
    // to `nextInstanceId(previous)` (REQ-008: most-recently-spawned active).
    instanceId: INITIAL_INSTANCE_ID,
  };
  // F-013 PR3a: per-tick wall-bump edge detector. Tracks which walls the
  // player is currently in contact with so a slide along the wall files one
  // milestone, not 60 per second.
  const wallBumpDetector = createWallBumpDetector();

  // REQ-009 deepening: edge-triggered portal overlap detector. Reports an
  // `enter` once per portal when the active player walks into its trigger
  // volume and an `exit` once when leaving. The detector is driven once per
  // fixed simulation step so its tick numbers align with the recorder and
  // ghost replay; lit/dark filtering and the teleport response live in
  // `wireTraversal` below (REQ-009 runtime half / REQ-010).
  const portalTriggers = createPortalTriggerSet(sceneCtx.portals);
  let portalTick = 0;

  // REQ-036: in-flight registry for thrown bodies. The registry walks
  // each thrown body's translation against the SAME trigger volumes the
  // player's detector uses; on a lit-portal enter the body teleports to
  // the destination spawn pose with its velocity preserved (Q-008
  // default). Thrown bodies do NOT spawn ghosts (dossier section 7
  // closed-form decision). A body whose velocity falls below the settle
  // threshold for `IN_FLIGHT_SETTLE_TICKS` consecutive ticks drops out
  // of the registry; settled bodies do not re-traverse portals.
  const inFlightRegistry = createInFlightRegistry({
    triggers: portalTriggers.triggers,
  });

  // REQ-034: rising-edge detection for the pickup toggle. The recorder
  // captures the raw `pickup` flag each tick, but the carry resolver
  // only fires on the rising edge so a held key does not toggle every
  // frame. Initial value is false: a player who is holding F at the
  // start of the simulation does not toggle until they release and
  // press again. The dossier's Q-004 default keeps this semantic
  // consistent with replay (a recorded held flag also produces a
  // single rising edge on the first tick the recording starts true).
  // The capsule height for resting drops is derived from the player's
  // capsule dimensions: `cylinderLength / 2 + radius`.
  let previousPickupHeld = false;
  // REQ-036: rising-edge detection for the throw input. Same model as
  // pickup. The carrier presses `T` to detach and launch the carried
  // body along the player's facing.
  let previousThrowHeld = false;
  const carryRestingY = PLAYER_CAPSULE.cylinderLength / 2 + PLAYER_CAPSULE.radius;

  // REQ-036: the player's facing direction is the last non-zero planar
  // velocity direction (Q-007 default). The tracker is updated each
  // fixed step from the player's actual planar velocity (after carry
  // speed scaling) so a recorded `KeyState` sequence yields a
  // deterministic facing trajectory on replay.
  const facingTracker = createFacingTracker();

  // Per-timeline ghost bookkeeping. Ghosts are filed against the timeline
  // they were RECORDED IN (not the timeline they were spawned during a
  // traversal of). `registry.activeGhosts()` returns only the ghosts in the
  // timeline the active player is currently inside; the per-fixed-step
  // loop below ticks and renders only that bucket. On every lit-portal
  // traversal the registry hides the leaving timeline's ghosts and stamps
  // the entering timeline's tick clock to `portal.destinationTick`,
  // either despawning or fast-forwarding each entering ghost per F-014.
  const registry = createTimelineRegistry({ initialTimeline: ACT_ONE_HOUR });

  // REQ-012: mount the Act 1 cinematic into the 12:00 timeline bucket at
  // boot. Three scripted ghosts (left dragger, right dragger, unconscious
  // body) are filed via `registry.add(12, ghost)`. The active timeline at
  // boot is 5:00, so each cinematic ghost is hidden by `add` and stays
  // hidden until the active player visits 12:00 (entering the South door
  // from 5:00). The South portal's `destinationTick = 0` so on
  // `setActiveTimeline(12, 0)` the legacy reset-to-spawn path fires and
  // each cinematic ghost plays from its tick-0 spawn pose.
  // See `docs/gdd/40-act-progress-and-narrative-beats.md` section 5.
  mountAct1Cinematic({ registry, scene: sceneCtx.scene, world });

  // REQ-012 / Q-013: fade-to-black overlay. The overlay primitive lives
  // here so the cinematic timing can write `setOpacity(t)` once the host
  // wires the per-tick fade ramp; this slice ships the data path and the
  // overlay primitive without driving the ramp from the host loop. The
  // overlay opens at opacity 0 (`visible = false`) so it costs nothing
  // until a future slice triggers it.
  const fadeOverlay = createFadeOverlay();

  // REQ-009 runtime / REQ-013 / REQ-014 partial / REQ-001 / REQ-003: on a
  // lit-portal `enter`, snapshot the lifetime's recording into a ghost from
  // the lifetime's start position, teleport the active player to the
  // destination spawn pose, re-stamp the player's origin tint, open a fresh
  // lifetime at the destination time, and switch the registry's active
  // timeline to the destination so per-timeline ghost visibility updates.
  // Dark portals are filtered (REQ-010).
  wireTraversal({
    detector: portalTriggers,
    player,
    lifetime,
    scene: sceneCtx.scene,
    world,
    registry,
    // REQ-015: on lit traversal, repaint the doors per the destination
    // hour's lit/dark table and snap the time-of-day clock so the room
    // background and the door visuals match the new timeline. The same
    // `doorLitStateAtHour` table that paints here also gates the runtime
    // entry predicate inside `wireTraversal`, so the visual and behavior
    // stay in lockstep.
    onTimelineEnter(destinationHour) {
      repaintDoorsForHour(sceneCtx.portals, destinationHour);
      snapClockToHour(timeOfDay, destinationHour);
    },
  });

  // REQ-025: hard reset on `r` keydown. The pause-menu UI is out of scope
  // for this slice; a single key binding is enough to return the simulation
  // to a clean Act 1 state when the player gets stuck. The handler is bound
  // to `window` (the same target the keyboard movement listeners use) and
  // is intentionally edge-triggered on `keydown` so holding `r` does not
  // continuously re-reset the simulation.
  const onResetKey = (event: KeyboardEvent): void => {
    if (event.code !== "KeyR") return;
    hardReset({
      player,
      lifetime,
      registry,
      scene: sceneCtx.scene,
      world,
      timeOfDay,
      portals: sceneCtx.portals,
      portalTriggers,
      inFlightRegistry,
      facingTracker,
    });
  };
  window.addEventListener("keydown", onResetKey as EventListener);

  // Track the most recent frame time so the physics integrator can use
  // a stable fixed step independent of the browser's vsync jitter. The
  // step rate is shared with the hybrid replay controller via
  // `src/sim/simulationStep.ts` so the two cannot drift apart.
  const fixedStepSeconds = FIXED_STEP_SECONDS;
  world.timestep = fixedStepSeconds;

  let lastFrameMs = performance.now();
  let physicsAccumulatorMs = 0;
  const fixedStepMs = fixedStepSeconds * 1000;
  const maxStepsPerFrame = 5;
  // Bound the accumulator itself (not just per-frame steps). Without this
  // clamp, returning from a long tab pause leaves a massive backlog that
  // drains across many subsequent frames in delayed catch-up mode. Clamping
  // to the per-frame budget means we accept some lost simulation time after
  // a long pause but stay real-time responsive afterward.
  const maxAccumulatorMs = fixedStepMs * maxStepsPerFrame;

  function frame(nowMs: number): void {
    const deltaMs = nowMs - lastFrameMs;
    lastFrameMs = nowMs;

    physicsAccumulatorMs = Math.min(
      physicsAccumulatorMs + deltaMs,
      maxAccumulatorMs,
    );

    let steps = 0;
    while (physicsAccumulatorMs >= fixedStepMs && steps < maxStepsPerFrame) {
      // Advance the time-of-day clock first so the recorder captures the
      // tick-of-arrival's normalized time, matching what any later instance
      // observing this tick from outside will see (REQ-030).
      timeOfDay.advanceTicks(1);
      // F-014: advance the active timeline's tick clock alongside the
      // time-of-day clock. The clock starts at the destination tick of
      // the last portal traversal (or 0 at boot) and increments by one
      // per fixed step. Ghosts filed from the current lifetime will
      // inherit the clock value at their filing moment as their startTick.
      registry.advanceActiveTick();
      // Sample input once per physics step so target velocity reacts at the
      // simulation rate, not the render rate. The mapping is pure; the only
      // mutation is on the rigid body itself. The same KeyState snapshot is
      // also pushed into the recorder so a ghost capsule can later replay
      // this path tick-for-tick.
      lifetime.recorder.record(keyboard.state, timeOfDay.normalized());

      // REQ-033 partial: per-tick punch resolution. Build a PunchActor list
      // from the active player and every ghost in the active timeline, run
      // it through the resolver, and flip each target's `consciousness` to
      // `'unconscious'`. The resolution reads each actor's pre-tick state,
      // so simultaneous mutual punches both land. Unconscious attackers
      // have their `punching` flag suppressed before the resolver so they
      // cannot punch even if their recorded input still has it set this
      // tick. Done BEFORE advancing ghost ticks and BEFORE stepping the
      // world so the punch flag for THIS tick is the ghost's
      // `replayPunchAtTick(recording, tickIndex)` reading.
      const activeGhostsList = registry.activeGhosts();
      const playerTranslation = player.body.translation();
      const punchActors: PunchActor[] = [
        {
          id: player.instanceId,
          position: { x: playerTranslation.x, z: playerTranslation.z },
          punching: keyboard.state.punch,
          consciousness: player.consciousness,
        },
      ];
      for (const ghost of activeGhostsList) {
        const ghostTranslation = ghost.body.translation();
        // The ghost's recording stores one boolean per tick; the punch flag
        // for THIS tick is at `ghost.tickIndex` BEFORE advanceTick runs.
        // Past the end of the recording the helper returns false, so a
        // ghost that has exhausted its recording stops punching.
        const ghostPunching = replayPunchAtTick(
          ghost.recording,
          ghost.tickIndex,
        );
        punchActors.push({
          id: ghost.instanceId,
          position: { x: ghostTranslation.x, z: ghostTranslation.z },
          punching: ghostPunching,
          consciousness: ghost.consciousness,
        });
      }
      const sanitizedActors = suppressUnconsciousPunches(punchActors);
      const resolutions = resolvePunches(sanitizedActors, PUNCH_RANGE_M);
      if (resolutions.length > 0) {
        // REQ-033 finishing pass: each resolution flips the target's
        // consciousness AND applies the body response (bump impulse +
        // damping reduction + mesh tilt). The incoming direction is the
        // planar XZ vector from the attacker's body to the target's, so
        // the recipient is shoved away from the puncher. Helper closures
        // resolve the actor snapshot for direction computation; the
        // resolver already filtered to conscious targets, so each pair
        // here is a fresh knockout (idempotence holds at the resolver).
        const actorById = new Map(sanitizedActors.map((a) => [a.id, a]));
        for (const { attackerId, targetId } of resolutions) {
          const attacker = actorById.get(attackerId);
          const target = actorById.get(targetId);
          const direction =
            attacker !== undefined && target !== undefined
              ? {
                  x: target.position.x - attacker.position.x,
                  z: target.position.z - attacker.position.z,
                }
              : { x: 0, z: 0 };
          if (targetId === player.instanceId) {
            player.consciousness = applyKnockout(player.consciousness);
            applyKnockoutBodyResponse(player.body, player.mesh, direction);
            continue;
          }
          for (const ghost of activeGhostsList) {
            if (ghost.instanceId === targetId) {
              ghost.consciousness = applyKnockout(ghost.consciousness);
              applyKnockoutBodyResponse(ghost.body, ghost.mesh, direction);
              break;
            }
          }
        }
      }

      // REQ-034: per-tick carry resolution. The pickup toggle fires on
      // the rising edge of `keyboard.state.pickup` (one tap picks up the
      // nearest in-range unconscious body, another tap drops). Pickup
      // input is suppressed while the player is unconscious so a
      // knocked-out player cannot pick up. If the player was knocked
      // out THIS tick while already carrying (the punch resolver
      // flipped consciousness above), force a drop transition: the
      // dossier specifies that the body falls in place at the
      // carrier's planar position.
      const pickupRisingEdge =
        player.consciousness === "conscious" &&
        keyboard.state.pickup &&
        !previousPickupHeld;
      const carrierActor = {
        id: player.instanceId,
        position: { x: playerTranslation.x, z: playerTranslation.z },
      };
      const carryCandidates: Carryable[] = activeGhostsList.map((ghost) => {
        const t = ghost.body.translation();
        return {
          id: ghost.instanceId,
          position: { x: t.x, z: t.z },
          consciousness: ghost.consciousness,
        };
      });
      const previousCarry = player.carry;
      // If the player was knocked out while carrying, force a drop. The
      // toggle resolver does not see consciousness, so we short-circuit
      // here: an unconscious-while-carrying player drops the body.
      const knockedOutWhileCarrying =
        player.consciousness === "unconscious" &&
        previousCarry.kind === "carrying";
      const carryAfterToggle: typeof previousCarry = knockedOutWhileCarrying
        ? { kind: "idle" as const }
        : resolveCarryToggle(
            previousCarry,
            pickupRisingEdge,
            carrierActor,
            carryCandidates,
          );
      // REQ-036: throw resolution. The rising-edge throw input fires only
      // while the player is conscious and currently carrying. The
      // `tryThrow` helper resolves the carried body's handle from the
      // active-ghost list, applies the impulse along the facing
      // direction, and returns the post-throw carry state (`'idle'` on
      // a successful throw, unchanged otherwise). On a fire we register
      // the body in the in-flight registry so its portal-traversal
      // detector kicks in next tick.
      // REQ-036: throw is gated on the PRE-toggle carry state (the
      // dossier specifies T is valid "only while carrying"). Gating on
      // `previousCarry` rather than `carryAfterToggle` prevents the
      // same-tick pickup-then-throw chord (pressing F and T in the same
      // frame should pick up a body, not pick up + immediately launch).
      const throwRisingEdge =
        player.consciousness === "conscious" &&
        previousCarry.kind === "carrying" &&
        keyboard.state.throw &&
        !previousThrowHeld;
      const facing = facingTracker.current;
      let thrownGhostId: number | null = null;
      const carryAfterThrow = tryThrow({
        carry: carryAfterToggle,
        throwRisingEdge,
        facing,
        resolveBody: (carriedId): ThrowBodyHandle | null => {
          for (const ghost of activeGhostsList) {
            if (ghost.instanceId === carriedId) {
              thrownGhostId = ghost.instanceId;
              return ghost.body;
            }
          }
          return null;
        },
      });
      const nextCarry = carryAfterThrow;
      player.carry = nextCarry;
      const transition = carryTransitionKind(previousCarry, nextCarry);
      if (transition === "pickup" && nextCarry.kind === "carrying") {
        for (const ghost of activeGhostsList) {
          if (ghost.instanceId === nextCarry.carriedId) {
            applyCarryPickup(ghost.body);
            break;
          }
        }
      } else if (
        transition === "drop" &&
        previousCarry.kind === "carrying"
      ) {
        // REQ-036: a throw fires the same `'carrying' -> 'idle'`
        // transition the toggle drop fires, but the body has already
        // been launched by `tryThrow` (impulse applied, dynamic flip
        // done). We only run `applyCarryDrop` (which snaps the body
        // to the carrier's planar floor pose with zero velocity) when
        // the transition was NOT a throw. The thrown-body branch
        // skips the snap so the impulse actually moves the body.
        const wasThrow = thrownGhostId !== null;
        if (!wasThrow) {
          for (const ghost of activeGhostsList) {
            if (ghost.instanceId === previousCarry.carriedId) {
              applyCarryDrop(player.body, ghost.body, carryRestingY);
              break;
            }
          }
        } else {
          // REQ-036: register the thrown body in the in-flight registry.
          // The body's traversal detector starts on the next tick.
          for (const ghost of activeGhostsList) {
            if (ghost.instanceId === thrownGhostId) {
              inFlightRegistry.register({
                id: ghost.instanceId,
                body: ghost.body,
                mesh: ghost.mesh,
              });
              break;
            }
          }
        }
      }
      previousPickupHeld = keyboard.state.pickup;
      previousThrowHeld = keyboard.state.throw;

      // REQ-033 partial: an unconscious player has its keyboard input
      // suppressed before the planar velocity write so the body stops
      // moving (and its recorded input continues to capture whatever the
      // player presses, which is consistent with the dossier's "input is
      // frozen" semantics: the recorded path stops moving on replay too
      // because the punch resolver flips the recorded ghost when it
      // re-enters this timeline).
      const velocity =
        player.consciousness === "conscious"
          ? inputToVelocity(keyboard.state)
          : { x: 0, z: 0 };
      player.setPlanarVelocity(velocity.x, velocity.z);
      // REQ-036: feed the facing tracker with the player's intended
      // planar velocity. Zero ticks do not overwrite the cache (so a
      // stopped player keeps facing wherever they last walked); first
      // non-zero tick overrides the default north (`{ x: 0, z: -1 }`)
      // from Q-007. Using the input-derived velocity rather than the
      // post-step body velocity keeps the facing deterministic across
      // replay (the recorded inputs reproduce the same velocity, which
      // produces the same facing).
      facingTracker.update(velocity);

      // REQ-034: while carrying, write the carrier's translation +
      // CARRY_OFFSET onto the carried body each tick. The body is
      // kinematic for the duration of the carry, so this is the only
      // path its translation moves. Done AFTER the carrier's velocity
      // write so the carrier's intended motion is what the body
      // follows on the next world.step().
      if (player.carry.kind === "carrying") {
        const carriedId = player.carry.carriedId;
        for (const ghost of activeGhostsList) {
          if (ghost.instanceId === carriedId) {
            applyCarryAttachment(player.body, ghost.body);
            break;
          }
        }
      }
      // Advance every ACTIVE ghost (those filed into the timeline the
      // player is currently in) by one tick BEFORE stepping the world so
      // each ghost's planar velocity is written into the same `world.step()`
      // that consumes the active player's velocity. Ghosts in non-active
      // timelines are hidden by the registry and not iterated here, so
      // they neither tick nor render until the player returns to their
      // timeline (REQ-001 / REQ-003 / REQ-006).
      for (const ghost of activeGhostsList) {
        // REQ-033 finishing pass: an unconscious ghost stops accepting
        // recorded velocity. `advanceTick` writes the recording's
        // velocity onto the body; for unconscious ghosts we capture the
        // pre-tick linvel (the post-impulse, post-damping value from
        // the last world.step), let advanceTick run for tick-counter
        // bookkeeping, and restore the captured velocity. The result is
        // a body that slides under the bump impulse and damping rather
        // than snapping back to the recorded path.
        const wasUnconscious = ghost.consciousness === "unconscious";
        const preAdvanceLinvel = wasUnconscious ? ghost.body.linvel() : null;
        ghost.advanceTick();
        if (preAdvanceLinvel !== null) {
          ghost.body.setLinvel(preAdvanceLinvel, true);
        }
      }
      world.step();
      // REQ-009: evaluate portal-overlap edges AFTER the world step so the
      // detector reads the post-integration translation. The same tick
      // counter advances here regardless of how many ghosts exist.
      const playerPos = player.body.translation();
      // F-013 PR3a: wall-bump milestone capture. Edge-triggered: a walk
      // along a wall produces ONE milestone, not 60 per second. The
      // detector reads the same post-integration translation the portal
      // detector reads, so wall_bump and door_traversal milestones share
      // a tick coordinate. Recorded on the active player's lifetime
      // only; ghost replay does not generate new milestones.
      const wallEnters = wallBumpDetector.step(
        playerPos.x,
        playerPos.z,
        PLAYER_CAPSULE.radius,
      );
      for (const wall of wallEnters) {
        lifetime.milestones.record({
          kind: "wall_bump",
          tick: lifetime.recorder.length,
          position: { x: playerPos.x, z: playerPos.z },
          weight: WALL_BUMP_WEIGHT,
          wall,
        });
      }
      portalTriggers.step(playerPos.x, playerPos.z, portalTick);
      portalTick += 1;
      // REQ-036: step the in-flight registry. Each tracked body's
      // translation is checked against the same trigger volumes the
      // player uses; on a lit-portal enter the body teleports with
      // velocity preserved (Q-008 default). The lit gate reads from
      // the same `litStateForTimeline` table the player's traversal
      // uses, so a body and the player share one source of truth for
      // which doors are enterable in the current timeline.
      const bodyLitGate: BodyLitGate = (portal) => {
        const state = litStateForTimeline(registry.activeTimeline, {
          ghosts: registry.ghostsFor(registry.activeTimeline),
        });
        if (state) return state[portal.direction];
        return portalAuthoredLit(portal);
      };
      inFlightRegistry.step(bodyLitGate);
      // F-012: despawn any ghost in the active timeline whose body has
      // crossed a lit portal trigger this tick. Mirrors what the active
      // player did on the original recording (walked through the door
      // and disappeared from this timeline). The list is snapshotted
      // because `removeGhost` mutates the underlying bucket.
      despawnGhostsAtLitPortals(
        registry.activeGhosts().slice(),
        portalTriggers.triggers,
        bodyLitGate,
        registry,
        sceneCtx.scene,
        world,
      );
      physicsAccumulatorMs -= fixedStepMs;
      steps += 1;
    }

    player.syncMeshFromBody();
    for (const ghost of registry.activeGhosts()) {
      ghost.syncMeshFromBody();
    }
    // REQ-032: per-render-frame thought-bubble update. For each active
    // ghost, run the lookahead scan and feed the result to its bubble's
    // `setIcon` (which is a cheap visibility toggle when the kind has
    // not changed). The bubble is positioned each frame via `update`
    // which writes the world position to the ghost's body translation
    // plus a head offset and orients the group toward the camera.
    // The active player has NO bubble (dossier section 8: only
    // non-active instances carry previews).
    for (const ghost of registry.activeGhosts()) {
      const t = ghost.body.translation();
      const kind: ThoughtPeekKind | null = nextQualitativelyDifferentAction({
        recording: ghost.recording,
        currentTick: ghost.tickIndex,
        isCurrentlyUnconscious: ghost.consciousness === "unconscious",
        currentPosition: { x: t.x, z: t.z },
        triggers: portalTriggers.triggers,
      });
      if (kind !== ghost.thoughtBubble.currentKind) {
        ghost.thoughtBubble.setIcon(kind);
      }
      if (kind !== null) {
        ghost.thoughtBubble.update(t, sceneCtx.camera);
      }
    }
    // REQ-031: keep the active-player floor ring snapped to the player's
    // planar position. Done after `syncMeshFromBody` for symmetry; the ring
    // reads from the body directly so ordering does not matter, but keeping
    // both visual updates adjacent makes the render-frame contract obvious.
    updateFloorRing(floorRing, player.body);
    // Apply the interpolated background color from whatever tick the
    // simulation is currently on. The clock itself is advanced inside the
    // fixed-step loop above, not here, so frame rate cannot affect it.
    sceneCtx.scene.background = interpolateWarmToCool(timeOfDay.normalized());
    renderer.render(sceneCtx.scene, sceneCtx.camera);
    // REQ-012 / Q-013: composite the fade overlay on top of the main pass.
    // The overlay short-circuits if its mesh is hidden (opacity rounds to
    // zero), so this call is free until a future slice triggers the fade.
    fadeOverlay.render(renderer);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
