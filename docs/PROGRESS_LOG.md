# Progress Log

Newest entries first. Every implementation slice adds an entry. Append-only: never delete, never reorder, never edit a previous entry.

Format for each slice:

```
## YYYY-MM-DD, Short Title

- Branch: `feature/short-name`
- PR: #N (when known)
- Changed: one paragraph naming the user-facing change and the key files / helpers / defaults that landed.
- Verification: dash checks, type-check, relevant unit tests, build, smoke (where applicable). Note any known-tolerated lint warnings or skipped checks.
- Assumptions: assumptions made under a Recommended default. One sentence per assumption.
- GDD coverage: which rows in `docs/GDD_COVERAGE.json` flipped to `partial` or `done`, or which `docs/gdd/*.md` files gained a Build log entry.
- Followups: any new `F-NNN` entries created. Link to them.
```

## 2026-05-08, TimeOfDay Locked To Deterministic Simulation Tick (REQ-029 done)

- Branch: `feature/timeofday-sim-binding-20260508`
- PR: (pending)
- Changed: `TimeOfDay` no longer drifts off render-frame delta. Internal state is now an integer `tickIndex` modulo `ticksPerCycle` (= `cycleSeconds * ticksPerSecond`, default 60 * 60 = 3600 ticks per day). New API: `advanceTicks(n)` (integer, throws on non-integer or non-finite, no-op for n <= 0) and `tick()` (current tick modulo cycle). `setNormalized(n)` and `normalized()` continue to interoperate; positions are snapped to whole ticks so the clock is always tick-aligned. The constructor rejects non-tick-aligned cycles (`cycleSeconds * ticksPerSecond` must be an integer). `src/app.ts` now calls `timeOfDay.advanceTicks(1)` once per fixed physics step inside the existing 60Hz accumulator loop (PR #4) instead of `timeOfDay.advance(deltaMs / 1000)` once per render frame, so the same number of fixed steps always produces the same `normalized()` output regardless of frame rate. The recorder still captures `timeOfDay.normalized()` per fixed step; it now sees the post-advance value of the tick it is recording, which matches the tick any later instance observing this moment from outside will see (REQ-030 setup). Tests rewritten around the new API and extended with: `advanceTicks(N)` and `N x advanceTicks(1)` produce bit-identical state; advancing exactly `ticksPerCycle * cycles` returns to tick 0 with no drift after 1000 cycles; non-integer / non-finite tick deltas throw; non-tick-aligned cycle configurations throw at construction.
- Verification: em-dash and en-dash grep returned nothing across the working tree. `git diff --check` clean. `npm test` 45/45 across the six suites. `npm run build` succeeded (chunk-size warning carried over). The fixed-step accumulator caps catch-up to 5 ticks per render frame; tab pauses therefore drop simulation time on the floor rather than fast-forwarding the clock, which is the correct behavior for a deterministic recording.
- Assumptions: clock advances are integer-only at the `advanceTicks` boundary; there is no float-seconds advance API in this slice (a future slice can add a fractional-accumulator one if a non-fixed-step caller ever needs it). The fixed-step loop calls `advanceTicks(1)` first and then records, so the `timeOfDay` value written into each `InputFrame` is the tick the input was sampled on, not the tick before. This matches what an observing instance from a later loop will see when it walks past this same tick. Default tick rate is 60Hz to match `world.timestep`; the constructor requires `cycleSeconds * ticksPerSecond` to be an exact positive integer (the prototype configuration is 60 * 60 = 3600). Storing the original `cycleSeconds` instead of a rounded variant keeps the public field honest. At `ticksPerCycle = 3600` and 60Hz, `tickIndex` will never approach `Number.MAX_SAFE_INTEGER` in any plausible session, but the wrap on every `advanceTicks` call keeps it bounded anyway.
- GDD coverage: REQ-029 flipped from `partial` to `done`. REQ-001 and REQ-002 implementation refs extended to include `src/sim/timeOfDay.ts` since the recorder's per-frame `timeOfDay` capture is now deterministic across replays. Build log entry added to `docs/gdd/23-prototype-scope.md`.
- Followups: none new.

## 2026-05-08, Per-Tick Input Recording Buffer (REQ-001 / REQ-002 partial)

- Branch: `feature/per-tick-input-recording-20260508-020621`
- PR: (pending)
- Changed: laid the foundation for time-travel ghost replay. Added `src/sim/inputRecorder.ts` exposing `InputRecorder` (a class with `record(keys, timeOfDay)`, `length`, and `snapshot()`), the `InputFrame` and `InputRecording` types, and a pure `replayAtTick(recording, tick)` helper that returns a `PlanarVelocity` derived through `inputToVelocity`. Tick indices are assigned monotonically by the recorder so callers cannot skip or repeat a tick. Snapshots are deeply frozen and defensively copied so subsequent `record` calls cannot retroactively mutate a recording. `replayAtTick` returns a stable `{x, z}` zero vector for ticks past the end of the recording or for negative ticks. Wired the recorder into `src/app.ts`: each fixed physics step now pushes the live `keyboard.state` plus the current `timeOfDay.normalized()` into the active player's recorder before applying the velocity to the body. Added `tests/sim/inputRecorder.test.ts` covering record-then-snapshot round trip, monotonic ticks, defensive copy of live KeyState, snapshot non-mutation, deep freezing, replay mid-recording, replay past end, replay on empty, replay at negative tick, and the stable shape contract.
- Verification: em-dash and en-dash grep returned nothing across the working tree. `git diff --check` clean. `npm test` 39/39 across the six suites. `npm run build` succeeded (chunk-size warning carried over). `npm run dev` smoke booted Vite and `curl http://localhost:5173/` returned HTTP 200.
- Assumptions: the recorder owns tick numbering rather than accepting it from the caller. This trades a small loss of generality for a stronger invariant: a recording is always a contiguous monotonic sequence starting at 0. The recorder is owned by the active player at the app level; future slices that introduce additional instances will give each its own recorder. `replayAtTick` derives the planar velocity through `inputToVelocity` rather than caching it at record time so any later refinement to the input mapping (heading-aware movement, custom speed) replays consistently with live input. Captured time-of-day is stored alongside each frame in anticipation of REQ-030 (instance-color tinting based on origin timestamp), but no consumer reads it yet this slice. The recorder currently captures every tick of a session with no upper bound; bounded buffers and portal-triggered boundaries land with REQ-003.
- GDD coverage: REQ-001 and REQ-002 flipped from `not_started` to `partial` (recordings exist; the permanent-past-instance half lands when the ghost replay capsule ships). Build log entry added to `docs/gdd/02-time-travel-rules.md`.
- Followups: none new.

## 2026-05-08, Warm-to-Cool Room Background Tint (REQ-029 partial)

- Branch: `feature/req-029-color-tint-20260508-015106`
- PR: (pending)
- Changed: room background now tints across a warm-to-cool spectrum over time. Added `src/sim/timeOfDay.ts` exposing `TimeOfDay` (a small clock with `advance(dt)`, `normalized()`, `setNormalized(n)`, `cycleSeconds`) and `DEFAULT_CYCLE_SECONDS = 60`. Added `src/render/colorTint.ts` exposing `WARM_ANCHOR_HEX = 0xf6c084`, `COOL_ANCHOR_HEX = 0x5a78b8`, and a pure `interpolateWarmToCool(t)` that lerps between the two anchors and returns a fresh `THREE.Color`. Wired the loop in `src/app.ts` to advance the clock by frame delta and assign the interpolated color to `sceneCtx.scene.background` each render frame. Added `tests/sim/timeOfDay.test.ts` (default state, proportional advance, exact-cycle wrap, mid-cycle overshoot wrap, setNormalized wrap of negative and >1 inputs, zero/negative dt no-op, non-positive cycle rejection) and `tests/render/colorTint.test.ts` (t=0 returns warm, t=1 returns cool, t=0.5 channelwise midpoint, clamping at both ends, fresh-instance isolation).
- Verification: em-dash and en-dash grep returned nothing across the working tree. `git diff --check` clean. `npm test` 26/26 passing across the five suites. `npm run build` succeeded (chunk-size warning carried over). `npm run dev` smoke booted Vite and `curl http://localhost:5173/` returned HTTP 200.
- Assumptions: cycle length picked at 60 seconds real time per full day. Long enough to read the warm-to-cool sweep over a typical playtest, short enough that REQ-029's success criterion ("tints over time") is visibly satisfied within a few seconds. The clock currently ticks off render-frame delta, not the deterministic physics step. That is sufficient for the visual tint but is NOT sufficient for REQ-001 timeline recording, which needs a sim-locked clock; a follow-up dot tracks that finishing pass. Anchor colors `#f6c084` (warm) and `#5a78b8` (cool) chosen as muted late-afternoon and pre-dawn analogs that keep the room geometry, doors, and player capsule readable at any t. `interpolateWarmToCool` clamps out-of-range t values rather than wrapping; the renderer never feeds out-of-range inputs but the clamp keeps the function total for REQ-030 reuse.
- GDD coverage: REQ-029 flipped from `not_started` to `partial` (warm-to-cool tint visible; deterministic-clock binding deferred). Build log entry added to `docs/gdd/23-prototype-scope.md`.
- Followups: none new.

## 2026-05-08, Four Doors Render at Wall Midpoints (REQ-027 partial)

- Branch: `feature/req-027-four-doors-20260508-013623`
- PR: #5
- Changed: added `src/scene/door.ts` exposing `DOOR_DIMENSIONS`, `createDoor(direction, roomWidth, roomDepth)`, and `createFourDoors(roomWidth, roomDepth)`. Each door is a thin BoxGeometry slab (1.2 wide x 2.2 tall x 0.12 deep) in a warm placeholder color, positioned at the midpoint of its wall, base on the floor, inset by half the door depth so it sits flush with the inner face of the wall and does not z-fight. East and west doors rotate 90 degrees about Y so their wide face runs along the wall. Wired the doors into `src/scene/room.ts` so `buildRoom()` adds all four to the room group. Added `tests/scene/door.test.ts` covering dimensions, per-direction placement, rotation, scaling against non-square room dimensions, and the four-door factory order. Updated `tests/scene/room.test.ts` child-count assertion to 9 (1 floor + 4 walls + 4 doors). Bundled housekeeping: added `.dots/archive/` and `.claude/scheduled_tasks.lock` to `.gitignore` and removed the stale `.dots/PseudoParadox-implement-keyboard-6ada13d3.md` from the index since archived dots are local-only state.
- Verification: em-dash and en-dash grep returned nothing across the working tree. `git diff --check` clean. `npm test` 13/13 across `tests/scene/room.test.ts`, `tests/input/keyboard.test.ts`, `tests/scene/door.test.ts`. `npm run build` succeeded (chunk-size warning carried over). `npm run dev` smoke booted Vite at `http://localhost:5173` and served the HTML shell.
- Assumptions: doors are visual-only this slice. The walls behind them remain solid colliders, so the player capsule cannot actually walk into a door from inside the room. REQ-001 (timeline persistence) and REQ-005 (fixed door destinations) will revisit `src/scene/door.ts` to add portal trigger volumes; REQ-028 will swap the placeholder warm color for a state-driven lit/dark material. Door size 1.2 x 2.2 picked so the door reads against the player capsule (~1.8 tall) without visually consuming the wall.
- GDD coverage: REQ-027 flipped from `not_started` to `partial`. Build log entry added to `docs/gdd/23-prototype-scope.md`.
- Followups: none new.

## 2026-05-08, Player Capsule + Keyboard Movement (REQ-026 partial)

- Branch: `feature/player-capsule`
- PR: (pending)
- Changed: spawned a keyboard-controllable player capsule at the room center. Added `src/input/keyboard.ts` (pure `inputToVelocity` mapping plus a DOM-bound `createKeyboardState` for WASD and arrow keys, default speed `PLAYER_SPEED_MPS = 4`). Added `src/scene/player.ts` (`createPlayer` builds a Three.js `CapsuleGeometry` mesh plus a Rapier dynamic capsule rigid body with capsule collider, locked pitch and roll, linear damping 8.0, exposes `setPlanarVelocity` and `syncMeshFromBody`). Wired the player into `src/app.ts`: input is sampled once per fixed physics step, target velocity is written to the body, mesh syncs to body translation each render frame. Added `tests/input/keyboard.test.ts` covering zero state, single-axis mappings, diagonal normalization, opposing-key cancellation, and custom speed.
- Verification: em-dash and en-dash grep returns nothing across the working tree. `git diff --check` clean. `npm run type-check` passed. `npm test` passed (8/8 across `tests/scene/room.test.ts` and `tests/input/keyboard.test.ts`). `npm run build` produced `dist/` (chunk-size warning carried over from the scaffold slice; code-splitting still deferred).
- Assumptions: WASD plus arrow keys both mapped to the same four directions because the prototype scope does not yet specify a binding scheme. Movement speed picked at 4 m/s by feel: a brisk walk that crosses the 10 m room in roughly 2.5 seconds. Yaw rotation is left enabled at the body level because future heading-aware slices may want it; the input layer ignores yaw for now. Linear damping 8.0 chosen so the capsule decelerates immediately when keys release (kinematic-feel) without drifting.
- GDD coverage: REQ-026 flipped from `not_started` to `partial`. Build log entry added to `docs/gdd/23-prototype-scope.md`.
- Followups: none new.

## 2026-05-08, Vite + TS + Three.js + Rapier3D Scaffold

- Branch: `feature/vite-scaffold`
- PR: (pending)
- Changed: bootstrapped the runtime stack. Added `package.json` (vite, vitest, typescript, three, @dimforge/rapier3d-compat, @types/three), `tsconfig.json` (strict ES2022 bundler resolution), `vite.config.ts`, `index.html`, `.gitignore`, and `docs/VERIFY.md`. Created the source tree under `src/`: `main.ts` mounts the app, `app.ts` initializes Rapier WASM and runs a fixed-step physics tick alongside `requestAnimationFrame`, `render/renderer.ts` builds the WebGL renderer with auto-resize, `scene/scene.ts` composes the placeholder scene, and `scene/room.ts` exposes `ROOM_DIMENSIONS` plus a placeholder floor + four-wall room. Added `tests/scene/room.test.ts` covering the room dimension contract and child count.
- Verification: `grep -rnP '[\x{2014}\x{2013}]'` returned nothing; `git diff --check` clean; `npm run type-check` passed; `npm test` passed (2/2); `npm run build` produced `dist/` (chunk-size warning noted but acceptable for the prototype shell, code-splitting deferred to a polish slice).
- Assumptions: chose `@dimforge/rapier3d-compat` (single bundled WASM) over the wasm-pack flavor to keep Vite config trivial. Picked a 10x10x4 unit room as the placeholder footprint; door placement and final scale will be revisited when REQ-027 lands. The fixed step is 1/60s with a 5-step max catch-up to prevent tab-restore physics explosions.
- GDD coverage: no REQ rows flipped this slice. The scaffold is foundational: no user-visible requirement is yet satisfied, but every subsequent prototype slice depends on this shell. Build log entry added to `docs/gdd/23-prototype-scope.md`.
- Followups: none new.

## 2026-05-08, Audit Remediation: Atomic Coverage Rows

- Branch: `chore/spiral-audit-remediation`
- PR: (pending)
- Changed: replaced the two placeholder rows in `docs/GDD_COVERAGE.json` with 40 atomic requirement rows (REQ-001 through REQ-040) sourced from the five drafted GDD section files (`01-vision-and-pillars.md`, `02-time-travel-rules.md`, `03-story-acts-1-3.md`, `23-prototype-scope.md`, `99-out-of-scope.md`). Resolved Q-001 in `docs/OPEN_QUESTIONS.md` and F-001 in `docs/FOLLOWUPS.md` because the underlying work shipped before the audit ran. Added F-002 (author missing GDD section files), F-003 (specify hard reset UX), and F-004 (consolidate or remove the legacy root `GDD.md`). Stripped pre-existing em-dashes (U+2014) from `README.md` and the legacy `GDD.md` so the AGENTS.md pre-commit grep returns nothing across the working tree; full GDD.md consolidation remains tracked under F-004.
- Verification: em-dash grep across the working tree returned nothing. `git diff --check` clean.
- Assumptions: rewriting the contents of REQ-001 and REQ-002 (rather than appending REQ-003+ alongside the placeholders) is consistent with the append-only ledger rule because those rows were template stubs that the original scaffold entry explicitly marked for replacement before any feature PR opens. The IDs are stable; only the placeholder content was replaced.
- GDD coverage: ledger expanded from 2 placeholder rows to 40 real `not_started` rows. No row flipped to `partial` or `done` (no implementation code shipped this slice).
- Followups: F-002, F-003, F-004 created.

## 2026-05-08, Spiral Scaffold Initialized

- Branch: `setup/spiral`
- Changed: bootstrapped the Pseudo Paradox scaffold using the `spiral` skill. Created `AGENTS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/WORKING_AGREEMENT.md`, `docs/gdd/README.md`, `docs/GDD_COVERAGE.json`, `docs/PROGRESS_LOG.md`, `docs/OPEN_QUESTIONS.md`, `docs/FOLLOWUPS.md`, `docs/PLAYTEST.md`, and `docs/FUN_FACTOR_AUDIT.md`.
- Verification: em-dash grep returned nothing.
- Assumptions: the GDD will be drafted under `docs/gdd/` at requirement granularity per the anti-Flatline guardrail in `docs/gdd/README.md`.
- GDD coverage: ledger created with two example rows; replace these with real requirements before opening any feature PRs.
- Followups: F-001 to draft the first GDD section (vision and pillars).