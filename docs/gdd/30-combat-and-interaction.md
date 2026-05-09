# Combat and Interaction

**Status:** partial

The combat-and-interaction surface (knockouts, pickup, drag, throw, thought-bubble previews) is the load-bearing system that turns the time-travel substrate into a playable puzzle. Pillar #1 (interaction with multiple selves) is the entire reason this surface exists. Without it the Acts 2-3 narrative beats (REQ-016 through REQ-023) and the Act 1 cinematic (REQ-012) cannot be implemented.

## 1. Scope

This section is the canonical spec for REQ-032 through REQ-036:

- REQ-032: thought-bubble icons appear above past instances before key actions (door enter, fight, sleep).
- REQ-033: knockouts produce ragdoll physics on the receiving instance.
- REQ-034: unconscious bodies can be picked up by the player.
- REQ-035: unconscious bodies can be dragged across the room while held.
- REQ-036: unconscious bodies can be thrown through doors and travel to the door's destination time.

Out of scope for this section (and explicitly out of scope for v1 in `docs/gdd/99-out-of-scope.md`):

- AI tracking (per-instance anger, energy, strength).
- Multiplayer.
- Killing or removing instances.
- Heading-aware movement (movement is world-axis-aligned per `src/input/keyboard.ts`).
- Animated transitions for any of the above (the prototype uses physics-only readability per Combat tone below).

## 2. Pillar alignment

Each design decision below cross-references `docs/gdd/01-vision-and-pillars.md`:

- **Pillar 1 (interaction with multiple selves).** Knockouts, pickup, drag, and throw are the verbs by which the player interacts with their other selves. Thought bubbles are the legibility layer that lets the player anticipate what another self is about to do. Every decision in this file serves Pillar 1 first.
- **Pillar 2 (no paradoxes).** Knockouts are recorded as part of the punching instance's input recording. On replay, the punch lands against whatever instance happens to be in range at the recorded tick (REQ-002 frame-exact). Thrown bodies do NOT spawn ghosts (see section 7 closed-form decision) so the determinism contract for ghost replay (REQ-001 / REQ-002) is not broken.
- **Pillar 3 (sci-fi diegetic feel).** Thought bubbles are the only allowed exception to the "UI lives in the world" rule alongside the floor ring (`docs/gdd/01-vision-and-pillars.md` reserves "one non-diegetic exception"; the floor ring is REQ-031). Thought bubbles are not pure UI: they are a billboard sprite with text-free icons, anchored to a world-space ghost. This sits closer to the diegetic side than a HUD label.
- **Pillar 4 (logical puzzles).** The mechanics are deliberately "what would actually happen": punching transfers force, an unconscious body is dead weight, throwing a body through a portal moves the body. No contrived rules.

## 3. Combat tone

From the original design intent: knockouts are "pure ragdoll physics. No glow flash, no screen effect. Physically readable, slightly absurd, tonally consistent." This is the tonal anchor for every visual decision in this section.

Concretely:

- No screen shake on impact.
- No hit-flash on the recipient.
- No directional indicator on the puncher.
- The visible feedback is the recipient's body changing how it moves (zero player input plus a small bump impulse plus reduced damping).
- Audio is out of scope for the prototype (`docs/gdd/99-out-of-scope.md`).

## 4. Knockouts (REQ-033)

### Hit detection

- **Trigger.** A `punch` input on the active player (default key: `Space`; see Q-002).
- **Detection geometry.** Capsule-vs-capsule proximity at the moment of the punch input. Two instances are "in range" iff the planar (XZ) distance between their body translations is `<= PUNCH_RANGE_M`. Default `PUNCH_RANGE_M = 1.2` (just under twice the player capsule radius `0.4` plus a small margin); see Q-003.
- **Direction.** No direction filter for the prototype. Anyone in range gets hit. Pillar 4 logical-puzzles allows this: the player chooses when to punch and where they are standing, which is sufficient agency for the puzzle.
- **Validity rules.**
  - The active player can punch any other instance (ghost or another active in Act 3).
  - A ghost CAN punch an active player or another ghost iff its recording captured a punch input at the relevant tick (REQ-002 frame-exact).
  - A punch against an already-unconscious body is a no-op (the body is already on the floor; physics still resolve any incidental contact via collider, but the punch input does not transition state).
  - A punch at a portal trigger volume resolves like any other punch; the portal traversal pipeline is independent.

### Recipient state machine

- States: `conscious` (default) and `unconscious`.
- Transition: `conscious -> unconscious` on receiving a punch.
- The reverse transition (`unconscious -> conscious`) does NOT exist in the prototype scope per `docs/gdd/03-story-acts-1-3.md` failure recovery (no auto-rewind, only hard reset).

### Physical effects of `unconscious`

The prototype uses simple Rapier capsules, not jointed ragdolls, so "ragdoll" is interpreted as "physically readable as a knocked-out body":

- Input is frozen. Active player input is ignored while the active instance is unconscious. Ghost replay continues to write zero planar velocity (per `replayAtTick` past-end semantics) for any future ticks of that ghost's recording, but the recording's REMAINING ticks are NOT clipped (see Q-001).
- A bump impulse is applied at the moment of knockout: `KNOCKOUT_IMPULSE_N = 6` along the punch's incoming horizontal direction, plus a small upward component (`KNOCKOUT_UP_IMPULSE_N = 2`) to lift the capsule off its base briefly so it tips.
- Damping is reduced (`UNCONSCIOUS_LINEAR_DAMPING = 0.5`, down from the active `8.0`) so the body slides under residual velocity rather than sticking.
- The capsule's `enabledRotations` is relaxed to free pitch and roll so the body can lie on its side. The active player's locked-pitch / locked-roll constraint is reapplied if the body becomes active again (out of scope; documented for completeness).
- Visual: the mesh stays the same color (combat tone above forbids hit-flash). The capsule rolling onto its side is the entire visual.

### Recording

- A `punch` input is captured by `InputRecorder` as an additional channel. The recorded `KeyState` extends with `punch: boolean`.
- On replay, a recorded `punch == true` at tick `t` runs the same proximity check against every other instance present at the same tick in the same timeline. If a recipient is in range, it transitions to unconscious.
- Determinism: because the recipient instance is itself either an active player at the same tick or a ghost replaying its own recording at the same tick, the proximity check is deterministic. A test fixture pins this contract.

## 5. Pickup (REQ-034)

### Trigger

- A `pickup` input on the active player (default key: `F`; see Q-002). The input is a **toggle**: one tap picks up the nearest unconscious body within `PICKUP_RANGE_M = 1.0`, another tap drops it. See Q-004 for the toggle-vs-hold trade-off.
- The input is captured by `InputRecorder` as an additional channel (`pickup: boolean`, edge-triggered: only the rising edge on a single tick fires).

### Selection

- If multiple unconscious bodies are in range, pick the closest (planar distance). Ties broken by lower `instanceId` (deterministic).

### Constraints while carrying

- The active player's `PLAYER_SPEED_MPS` is multiplied by `CARRY_SPEED_MULTIPLIER = 0.6` (60% of normal). See Q-005 for the multiplier choice.
- The carried body's mesh is reparented to the player mesh (or the player body) at offset `CARRY_OFFSET = { x: 0, y: 1.2, z: 0 }` (head/shoulder height). The carried body's rigid body is set to `kinematic` while held so it does not fight the carrier; on drop it returns to `dynamic`.
- The carried body's collider is excluded from the carrier's collider for the duration of the carry to prevent self-collision jitter (Rapier collision groups; see Q-006).

### Edge cases

1. Picking up while carrying: ignored (one body at a time).
2. Picking up at a portal trigger: allowed; the next portal traversal of the carrier carries the body (see section 7 throw section for the contrast: only THROWN bodies traverse independently; CARRIED bodies traverse with the carrier and remain attached).
3. The carrier is knocked out while carrying: the carry releases. The body drops in place (its translation when released equals the carrier's `CARRY_OFFSET` projected onto the floor: `{ x: carrier.x, y: floor, z: carrier.z }`). Both bodies are now unconscious on the floor.
4. The body picked up was previously thrown and is mid-air: pickup only succeeds when the body is in `unconscious` state AND is within range; the proximity check naturally handles this.
5. Hard reset (REQ-025) while carrying: the carry is torn down as part of `hardReset` (the body would be a ghost in some bucket; `clearAllGhosts` removes it).

## 6. Drag (REQ-035)

Drag is the physical consequence of pickup plus movement: the carried body's mesh moves with the carrier each frame, so dragging is "pickup, then walk."

For determinism this means there is essentially no new mechanic for drag beyond what pickup already specifies. The dot for REQ-035 is therefore a **regression test** dot, not a feature dot:

- Test that the carried body's translation tracks the carrier's translation each tick to within floating-point tolerance.
- Test that dropping the body leaves it at the carrier's current position (not the pickup position).
- Test that walking through a doorway with a carried body moves the body through (the carrier traverses; the body comes along; section 7 throw is the only path that detaches a body during traversal).

Edge case: if the carrier is knocked out mid-drag, the body drops in place per section 5 edge case 3.

## 7. Throw (REQ-036)

### Trigger

- A `throw` input on the active player (default key: `T`; see Q-002), valid only while carrying.
- On throw the carry state ends, the carried body returns to `dynamic`, and an impulse is applied along the thrower's facing direction.

### Aim model

- The fixed isometric camera means there is no mouse-aim. Facing is derived from the player's last non-zero movement direction.
- Default heuristic: `facing = lastNonZeroPlanarVelocityDirection`. Updated each tick the player has non-zero `KeyState`-derived velocity. Zero-velocity ticks do not overwrite facing.
- Edge: at game start (or after a hard reset) the player has not moved yet, so facing is undefined. Default to "north" (`{ x: 0, z: -1 }`) per `src/input/keyboard.ts` convention (forward = -z). See Q-007.

### Throw impulse

- `THROW_IMPULSE_N = 14` along the facing direction.
- `THROW_UP_IMPULSE_N = 4` along world +Y for an arc (so the body goes UP and forward, not just forward).
- The thrown body's `linearDamping` stays at `UNCONSCIOUS_LINEAR_DAMPING = 0.5` so the arc reads naturally.

### Portal interaction

- A thrown body is a `dynamic` Rapier body with the player's capsule collider. It collides with walls.
- If the thrown body's translation crosses a LIT portal trigger volume mid-flight, the body teleports to the destination time (the thrown body's portal traversal mirrors the player's: same `wireTraversal`-style hook, but on a different code path because the body is not a player and does not own a recorder).
- **Trajectory preservation.** On teleport, the body's linear velocity is preserved (rotated zero degrees because the destination spawn pose's facing equals the source's facing in the prototype's world-axis-aligned model). The body continues its arc on the other side. See Q-008.

### Closed-form determinism decision

**Thrown bodies do NOT spawn ghosts.** They are inert moving objects: they move, they collide, they can land, they can be picked up again. They do not record input. This decision is load-bearing for REQ-001 / REQ-002 ghost-replay determinism: only voluntary entries by an instance with its own `lifetime` produce ghosts.

Concretely:

- A thrown body crossing a portal trigger does NOT call `wireTraversal`'s lifetime-snapshot path. It calls a separate body-only teleport path (`wireBodyTraversal` or similar; see implementation slice).
- A thrown body's translation history is NOT recorded as an `InputRecording`.
- A thrown body that lands at 12:00 having been thrown from 5:00 is IN the 12:00 timeline as a body, but it is NOT replayed in the 5:00 timeline. This is intentional: "the active player threw the body" is recorded as part of the active player's recording (the throw input), so the recording replays the throw, which produces a fresh thrown body in the past timeline. The fresh thrown body follows the same physics on replay because Rapier's deterministic step plus identical initial conditions plus identical impulse equals identical trajectory. (See Q-009 for the determinism stress.)

## 8. Thought bubbles (REQ-032)

### Anchoring

- Each non-active instance (ghosts only; the active player does not need a preview of itself) carries a billboard sprite anchored above the capsule's head.
- Anchor offset: `{ x: 0, y: PLAYER_CAPSULE_TOTAL_HEIGHT + 0.3, z: 0 }`.
- The sprite always faces the camera (`THREE.Sprite` does this by default).

### Lookahead window

- Each tick, for each ghost the host inspects the ghost's recording slice `[tickIndex, tickIndex + LOOKAHEAD_TICKS)` where `LOOKAHEAD_TICKS = 30` (0.5s at 60 Hz). See Q-010 for the window choice.
- The slice is scanned for "qualitatively different upcoming actions." Walking is the baseline and not surfaced.

### Icon set (text-free)

Per Pillar 3 (sci-fi diegetic), no text. Icons are billboard sprites loaded as PNG textures from `public/icons/`:

- `door-arrow.png`: an arrow pointing toward the door's cardinal direction. Surface when the upcoming window contains a portal-trigger entry (any LIT door overlap event in the next 30 ticks; same code path as `PortalTriggerSet` but evaluated against the ghost's recorded translation history rather than live).
- `fist.png`: a stylized fist. Surface when the upcoming window contains a `punch` input rising edge.
- `sleep.png`: a Z. Surface when the ghost's instance is `unconscious`.
- `footsteps.png`: defined in spec for completeness, but anti-spam suppresses it (see below).

### Anti-spam rules

- **Walking does not show footsteps every tick.** Footsteps only surface when the ghost transitions from idle (zero velocity for >= 5 consecutive ticks) to walking. In practice this rarely fires; the icon exists for completeness but is allowed to be invisible most of the time.
- **Door entry shows the door arrow at most once per upcoming entry.** Once the bubble is showing for a given upcoming entry, it stays for the entire lookahead until the entry resolves; it does not re-trigger.
- **Punch shows the fist for the lookahead window.** Once the punch resolves, the icon clears.
- **Sleep persists for as long as the ghost is unconscious.**

### Performance

- The thought-bubble update is once per render frame (not per tick). Updating once per tick would be 60 Hz; a sprite update at 60 Hz is wasted work. Update at the render frame rate, reading the most recently advanced tick.
- Number of ghosts is bounded (Acts 1-3 produce at most ~6 ghosts) so per-frame iteration is cheap.

## 9. Open questions

The spec above resolves to a recommended default for every non-obvious decision. The implementor ships under those defaults. The corresponding `Q-NNN` entries land in `docs/OPEN_QUESTIONS.md` so a future override is one edit away.

- Q-002: which keys to use for `punch` / `pickup` / `throw`. Default: `Space` / `F` / `T`.
- Q-003: punch range. Default: 1.2 m.
- Q-004: pickup as toggle vs hold. Default: toggle.
- Q-005: carry speed multiplier. Default: 0.6.
- Q-006: collision group for carrier-vs-carried. Default: separate group during carry; restored on drop.
- Q-007: facing default before first movement. Default: north.
- Q-008: trajectory preservation through portals. Default: linvel rotated zero degrees (trajectory continues unchanged).
- Q-009: thrown-body determinism on replay. Default: rely on Rapier deterministic step plus identical initial conditions; revisit if cross-machine drift appears.
- Q-010: lookahead window length. Default: 30 ticks (0.5s at 60 Hz).
- Q-011: carried body becomes part of the carrier's recording, or independent? Default: part of the carrier's recording (the recording captures pickup/throw inputs; the body's trajectory is a deterministic consequence).

## 10. Implementation order

Slices land in this order (the implementor mode picks them up next iteration):

1. **Knockout state machine and input recording** (REQ-033 partial). Ships `punch` input channel, `unconscious` state, the proximity check, the `KeyState` extension, and the recording-and-replay path. No ragdoll-style body response yet.
2. **Knockout body response** (REQ-033 finishing pass). Ships the bump impulse, damping reduction, rotation lock relaxation, and the visible "tipped over" pose.
3. **Pickup-and-carry** (REQ-034). Ships `pickup` input channel, toggle state machine, attachment, carry speed multiplier, collision group exclusion.
4. **Drag regression test** (REQ-035). Tests-only slice; the feature is a consequence of pickup plus movement.
5. **Throw with portal traversal for ballistic bodies** (REQ-036). Ships `throw` input channel, facing heuristic, throw impulse, body-only portal traversal hook, trajectory preservation.
6. **Thought-bubble icon overlay** (REQ-032). Ships the four billboard sprites, the lookahead scan over ghost recordings, and the anti-spam rules.

### Build log

- 2026-05-08: Punch input channel + knockout state machine landed (REQ-033 partial; section 10 slice 1). `KeyState.punch` extends recorded input alongside the movement axes; `Space` is the default binding (Q-002). `replayPunchAtTick(recording, tick)` is the sibling helper to `replayAtTick`. New module `src/sim/knockoutState.ts` exports the `Consciousness` type, `INITIAL_CONSCIOUSNESS`, `applyKnockout`, and `isConscious`. New module `src/sim/punch.ts` exports `PUNCH_RANGE_M = 1.2` (Q-003), `isInPunchRange`, `suppressUnconsciousPunches`, `resolvePunches`, and the `PunchActor` / `PunchResolution` interfaces. Both `Player` and `GhostInstance` carry a mutable `consciousness` flag; `ghost.reset()` returns it to the seed. The host loop in `src/app.ts` builds a per-tick `PunchActor` snapshot from the active player plus every active-timeline ghost, runs it through suppress + resolve, and applies the resulting knockouts. Movement is gated on consciousness for both the player (zero velocity write) and ghosts (planar velocity zeroed after `advanceTick`). `hardReset` returns the player's consciousness to the seed. Body response (bump impulse, damping reduction, rotation lock relaxation, tipped-over pose) is deferred to the next slice. Files: `src/input/keyboard.ts`, `src/sim/inputRecorder.ts`, `src/sim/knockoutState.ts`, `src/sim/punch.ts`, `src/scene/player.ts`, `src/sim/ghostInstance.ts`, `src/sim/portalTraversal.ts`, `src/sim/hardReset.ts`, `src/app.ts`, `tests/sim/knockoutState.test.ts`, `tests/sim/punch.test.ts`, `tests/sim/inputRecorder.test.ts`, `tests/sim/ghostInstance.test.ts`, `tests/scene/player.test.ts`, `tests/sim/hardReset.test.ts`. PR #N.
- 2026-05-08: Knockout body response landed (REQ-033 done; section 10 slice 2). New module `src/sim/applyKnockoutBody.ts` exports the constants `KNOCKOUT_IMPULSE_N = 6`, `KNOCKOUT_UP_IMPULSE_N = 2`, `UNCONSCIOUS_LINEAR_DAMPING = 0.5`, `ACTIVE_LINEAR_DAMPING = 8.0`, `KNOCKOUT_MESH_TILT_Z = Math.PI / 2`, `KNOCKOUT_FALLBACK_DIRECTION = { x: 1, z: 0 }`, the pure helper `knockoutBodyResponse(direction)` that returns the impulse vector and mesh rotation given an unnormalized incoming direction (zero-vector falls back to world +X), and the side-effecting `applyKnockoutBodyResponse(body, mesh, direction)` / `clearKnockoutBodyResponse(body, mesh)`. The host loop in `src/app.ts` computes the incoming direction per resolution as `target.position - attacker.position` projected XZ and applies the response alongside the `applyKnockout` flip; the unconscious-ghost gate now preserves the pre-`advanceTick` linvel and writes it back so ghosts slide under physics rather than snapping back to the recorded path. The Rapier body itself stays upright; only the mesh's `rotation.z` flips to `Math.PI / 2`, so collisions remain capsule-shaped (documented seam: physics is upright, mesh reads tipped). `hardReset` calls `clearKnockoutBodyResponse` so a knocked-out player walks out of the reset upright with `linearDamping` restored to `8.0`. No recovery in v1: the capsule stays tilted until pickup (REQ-034) or hard reset fires. Files: `src/sim/applyKnockoutBody.ts`, `src/app.ts`, `src/sim/hardReset.ts`, `tests/sim/applyKnockoutBody.test.ts`, `tests/sim/hardReset.test.ts`. PR #N.
