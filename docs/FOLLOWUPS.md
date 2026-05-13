# Followups

Backlog spillover discovered during implementation. Keep items PR-sized when possible.

> **Critical convention.** Every followup must carry a `Priority:` tag. Three buckets:
> - `blocks-release`: cannot ship v1 without this.
> - `nice-to-have`: improves the product but does not block.
> - `polish`: post-release cleanup.

## How to add a followup

```
## F-NNN: Short title

- Priority: blocks-release | nice-to-have | polish
- Context: one or two sentences on why this came up.
- Blocker (if any): the condition that prevents working on this now.
- Unblock condition: what has to be true to start.
- PR / Dot reference (when picked up): #N or dots-N
```

Keep `F-NNN` IDs monotonically increasing. When a followup ships, leave the entry in place and append a `- Resolved: PR #N` line. Never delete.

## Blocks Release

(none open)

## Nice To Have

### F-008: Real-browser ship gates (Playwright E2E plus Lighthouse load-time plus 60fps frame budget)

- Priority: nice-to-have
- Context: REQ-037 / REQ-038 / REQ-039 / REQ-040 shipped (PR #43, the final iteration) with Vitest in-process REGRESSION GUARDS rather than real-browser SLAs. The current gates are: (1) `tests/sim/endToEndCompletability.test.ts` drives the Act 1 to escape sequence in-process and asserts ActStateObserver reaches `'escaped'` plus a determinism gate; (2) `tests/perf/bundleSize.test.ts` asserts `dist/assets/*.js` is under 5 MB raw; (3) `tests/perf/frameTime.test.ts` asserts the simulation's per-step CPU time is under 16.67 ms at the 95th percentile. The proper real-browser gates would be: (a) Playwright E2E against the local dev server that drives keydown/keyup events through Acts 1 to 3 and polls `window.__pseudoParadoxActState` (Q-020 default A); (b) a Playwright smoke against `pseudo-paradox.vercel.app` that hits the live URL and asserts no JS errors (Q-018 default A); (c) Lighthouse-based load-time measurement to pin the literal 10 s budget over a 5 Mbps connection (REQ-038); (d) a real-browser frame-budget measurement to pin 60 fps (REQ-039).
- Blocker: per RULE 3, Playwright and Lighthouse are core test-infra dependencies that need explicit user approval. The Vitest in-process guards catch sim-side regressions cheaply and the Vercel preview deploy already gates every PR; the real-browser gates would be redundant in CI today and add dev-loop cost.
- Unblock condition: a spillover release (post-prototype) or explicit user approval to add Playwright plus Lighthouse as devDeps. Then ship four small slices: (1) Playwright E2E against local dev; (2) Playwright live-URL smoke; (3) Lighthouse load-time gate; (4) Real-browser fps measurement.
- PR / Dot reference (when picked up):

### F-005: CodeRabbit usage credits exhausted

- Priority: nice-to-have
- Context: PR #4 (`feature/player-capsule`) opened on 2026-05-08 received only an initial walkthrough comment, then CodeRabbit replied with a rate-limit warning indicating "You've run out of usage credits. Purchase more in the billing tab." The status check resolved to SUCCESS without producing any actual line-level review feedback. The autonomous loop merged PR #4 on a CLEAN merge state with no actionable comments outstanding.
- Blocker: paid CodeRabbit usage caps a non-engineering action (billing).
- Unblock condition: top up CodeRabbit credits in `app.coderabbit.ai/settings/subscription`, or accept that reviews on the PRs filed during the rate-limit window were a free-pass.
- PR / Dot reference (when picked up):


### F-002: Author missing GDD section files

- Priority: nice-to-have
- Context: `docs/gdd/02-time-travel-rules.md` references `09-mechanic-instance-replay.md` and `17-ui-failure-state.md`, neither of which has been authored. Visual and art direction (camera, art style, character, room geometry) and mechanics detail (knockout, pickup, drag, throw) also exist only in the legacy root `GDD.md` and need their own section files at the requirement granularity used by the coverage ledger.
- Blocker: none.
- Unblock condition: pick a GDD section (camera, art style, character design, room geometry, instance replay mechanic, UI failure state) and draft it as `docs/gdd/<NN>-<title>.md`. Add atomic coverage rows to `docs/GDD_COVERAGE.json` once the spec lands.
- PR / Dot reference (when picked up):

### F-003: Specify hard reset UX

- Priority: nice-to-have
- Context: REQ-025 calls for hard reset in the pause menu. Pause menu UX has not been specified yet (input binding, confirmation flow, visual treatment).
- Blocker: pause menu does not yet exist.
- Unblock condition: at least one playable build is shippable end-to-end so reset semantics can be reasoned about against real timeline state.
- PR / Dot reference (when picked up):

### F-004: Consolidate or remove legacy root GDD.md

- Priority: nice-to-have
- Context: `GDD.md` at the repo root is the original monolith. The canonical GDD now lives under `docs/gdd/` as a tree. Keeping the monolith risks drift between two sources of truth.
- Blocker: not all original GDD content has been migrated to tree files yet (camera, art, character, room, mechanics detail).
- Unblock condition: F-002 lands the missing section files. Then either delete `GDD.md` or replace it with a stub that points at `docs/gdd/`.
- PR / Dot reference (when picked up):

### F-016: Onboarding controls and objective overlay

- Priority: nice-to-have
- Context: Surfaced by the 2026-05-12 fun-factor audit. A new player lands on a black background with a single warm-amber capsule in a grey room. There is no audio, no instruction text, no goal indicator (only "Pseudo Paradox prototype" in the top-left corner). The lit-vs-dark portal rule, the punch-past-self mechanic, and the "escape through North door at 12:00" win condition are all discovery-only. The PLAYTEST.md "First-time experience does not require external instructions" and "If the user does nothing, the screen still communicates what to do" items both fail today.
- Blocker: none. The DOM-overlay pattern in `src/render/touchOverlay.ts` and `src/render/actionButtons.ts` is the existing precedent for a no-dep overlay.
- Unblock condition: a slice that mounts a corner DOM overlay listing the key bindings (WASD / SPACE punch / F pickup / T throw / R reset) plus a one-line objective hint ("escape through a lit door"). The overlay should fade or hide after the first non-zero input is recorded so it does not occlude the play area mid-session, and it should respect the responsive layout so mobile (with the joystick + action buttons) is not double-noisy. Should NOT block or modal-overlay the canvas; it is an ambient hint, not a tutorial.
- Resolved: PR #68. New `src/render/onboardingOverlay.ts` mounts a top-right DOM hint with a pure `pickOnboardingContent(isCoarsePointer)` helper that returns the keyboard legend plus goal on fine-pointer devices and the goal line only on coarse-pointer devices (where the action buttons already label themselves). The overlay disposes itself on the first `keydown` or `pointerdown` from `window` (one-shot per page life), with `role="status"` + `aria-live="polite"` + `aria-atomic="true"` so a screen reader announces the hint on mount. Wired into `src/app.ts` after the existing overlay setup. Three unit tests cover the content helper.

### F-017: Win screen on escape state

- Priority: nice-to-have
- Context: Surfaced by the 2026-05-12 fun-factor audit. When the player reaches `ActState === 'escaped'` (active player crossed the North door at 12:00 after the cinematic actors completed and the watermark hit final-knockout), the state is terminal but the build does nothing to acknowledge it. The simulation continues running, no UI signals the win, and the player must press R unprompted to restart. The PLAYTEST.md "A session has a clear in / play / out flow" item fails today.
- Blocker: none. The existing `src/render/fadeOverlay.ts` already implements a full-screen DOM overlay precedent and is wired into the Act 3 cinematic. The `ActStateObserver` already produces the `'escaped'` watermark.
- Unblock condition: a slice that, on the rising edge from non-escaped to escaped, mounts a fade-to-light overlay reading "You escaped." plus a "Play again (R)" prompt. The R key should still trigger the existing hard-reset path; the overlay simply gives the player the prompt. Should respect prefers-reduced-motion (if F-NNN reduce-motion ever ships) by collapsing the fade to an instant swap.
- Resolved: PR #69. New `src/render/winScreen.ts` mounts a warm-wash DOM overlay reading "You escaped." and "Play again (R)" with `role="status"` plus `aria-live="polite"` so screen readers announce the win. The host subscribes a second `portalTriggers.onPortalOverlap` callback in `src/app.ts` BEFORE `wireTraversal` (FIFO subscriber dispatch order, so the callback reads `registry.activeTimeline` pre-mutation by the traversal handler) that fires on the first `enter` event for a north-direction portal while the active timeline is 12 AND `litStateForTimeline(12, ...).north === true`; the lit gate alone guarantees the cinematic-actors-completed precondition (the dossier's stricter Act 3 final-knockout watermark is not yet wired through `ActStateObserver` in the host, but it would tighten the predicate without changing the user-visible outcome). The R-key hard reset (existing handler) tears the win screen down so a fresh session is unoccluded; clicking the overlay dispatches a synthetic `keydown KeyR` so the reset path is single-source. Fade-in over 600 ms; `prefers-reduced-motion: reduce` collapses the fade to instant. Three unit tests cover the content helper.

### F-018: Audio pass (minimum viable: punch, door, escape sting)

- Priority: nice-to-have
- Context: Surfaced by the 2026-05-12 fun-factor audit. Zero audio is wired anywhere in the build. Punch lands silently, doors traverse silently, the escape state arrives silently. Code comments in `src/sim/punch.ts:34` and `src/sim/applyKnockoutBody.ts:51` flag audio as "future scope." The PLAYTEST.md "Audio reinforces successful actions" item fails today; "Core action is satisfying when performed perfectly" is substantially weakened by the absence.
- Blocker: none on the platform side. HTML5 `<audio>` is built into the browser, so no new dependency is required (RULE 3 stack-constraint check passes). Asset sourcing is a small content task: three short MP3 / OGG clips (punch land, door traverse, escape sting). Royalty-free libraries (Freesound, Zapsplat) or hand-recorded clips both work.
- Unblock condition: a slice that adds a small `src/render/sfx.ts` (or similar) audio pool, three asset files committed under a new `public/sfx/` directory, and three wire-ins: rising edge of a punch knockout, rising edge of an active-player lit-portal traversal, rising edge of the escape state. Volume default ~30%; no settings UI yet (F-022 if added later for a mute toggle).
- Resolved: PR (pending merge). Procedural Web Audio instead of asset files. Three new modules: `src/render/audioEngine.ts` (singleton AudioContext + gesture unlock + visibility suspend + two output buses), `src/render/audioConstants.ts` (all tuning parameters as pure data including `midiToFreq` / `phrygianMidi` helpers), `src/render/sfx.ts` (`playPunchSfx`, `playDoorSfx`, `playEscapeSfx`), `src/render/ambientDrone.ts` (continuous detuned-sine drone at A1 + sub octave at A0 + slow filter LFO + sparse Phrygian-scale haunted bells every 6 to 14 s). Scope grew beyond the original F-018 unblock condition to include an ambient drone because the user asked for "more eerie, dark, slow, haunted, subtle" audio rather than three discrete SFX. RULE 3 stack-constraint check passes: zero new dependencies, Web Audio is built into the browser. Wired into `src/app.ts`: engine lazy-init at boot, drone started immediately (silent until user gesture resumes the context), punch SFX fired once per resolution batch (mutual punches collapse to one audible thud), door SFX fired in the `onTimelineEnter` callback on every lit traversal, escape SFX fired at the win-screen mount point. 22 unit tests cover the pure helpers (`midiToFreq`, `phrygianMidi`, gain ordering, scale shape, drone tuning bounds, bell scheduling sanity).

### F-019: Act-state HUD line

- Priority: nice-to-have
- Context: Surfaced by the 2026-05-12 fun-factor audit. The act-state watermark is computed every fixed step by the `ActStateObserver` (`src/sim/actState.ts`) and exposed on `window.__pseudoParadoxActState` (Q-020 default A) but is never surfaced to the player. The player can never tell what beat they're on; progress is inferred entirely from world state. The PLAYTEST.md "The user can tell, without reading the HUD, whether they are doing well" item arguably passes because the player CAN read world state, but giving them a real HUD line closes the discoverability gap.
- Blocker: none. The DOM-overlay pattern already exists; the observer already produces the named beat each tick.
- Unblock condition: a small bottom-left DOM overlay that reads the current `ActState` and renders the human-readable beat name ("Act 1: Spawn", "Act 2: Loop 1", "Act 3: Setup", ..., "Escaped"). Updates per fixed step. No animation needed; text content swap is enough. Should not interfere with the action-button stack on mobile.
- Resolved: PR (pending merge). Two new modules: `src/sim/actStateSnapshot.ts` (pure `projectGhost` + `buildActStateSnapshot(registry, player, options)` helpers, promoted from the inline pattern in `tests/sim/endToEndCompletability.test.ts`) and `src/render/actStateHud.ts` (DOM overlay + pure `pickActStateLabel(state)` helper that maps each `ActState` to a short human-readable label). Wired into `src/app.ts`: a single `createActStateObserver` instance, host-owned `activePlayerCrossedNorthAt12` flag toggled by the same `portalTriggers.onPortalOverlap` callback that already gates the win screen, west-entry recording for the chase predicate input (active player only; ghost positions are not stepped through `portalTriggers` today so the chase beat depends on a future host wiring slice), per-fixed-step `observer.update(buildActStateSnapshot(...))` call at the end of the fixed-step body, HUD label refresh per render frame, and `window.__pseudoParadoxActState` debug hook (Q-020 default A) for future real-browser gates. `hardReset` clears the observer's watermark plus the north-12 flag. The HUD renders blank for the seed `not-started` watermark and a positioned bottom-left label for every other beat. 12 new unit tests cover `pickActStateLabel` (every state plus the seed-blank rule) and `buildActStateSnapshot` (player position projection, recent-west-entries threading, north-12 flag default, currentTimeline mapping, empty buckets).

### F-020: Knockout feedback polish (ease the tilt, add a small camera shake)

- Priority: nice-to-have
- Context: Surfaced by the 2026-05-12 fun-factor audit. The knockout response (`src/sim/applyKnockoutBody.ts`) sets the mesh's Z rotation to ±π/2 in a single tick. The result is an instantaneous flip with no anticipation, no follow-through, no impact emphasis. Combined with the absence of audio (F-018), the core action lands without texture or weight. PLAYTEST.md "Core action is satisfying when performed perfectly" and the audit's "Does the core action have texture?" item both fail today.
- Blocker: none. The fixed-step loop already gives a deterministic place to interpolate; the existing scene mutation pattern can carry an animation-frame counter without a tween library.
- Unblock condition: a slice that (1) eases the knockout tilt over ~12 ticks (200 ms at 60 Hz) with a quick anticipation crouch on tick 0 and a follow-through settle on the last few ticks; (2) optionally adds a single-tick camera shake (offset the camera lookAt by a small random vector then snap back) on the connecting tick. Must remain deterministic: the same input recording must produce the same animation frames so replay byte-identity holds.
- PR / Dot reference (when picked up):

## Polish

(none yet)

## Resolved

### F-001: Draft first GDD section

- Priority: nice-to-have
- Context: scaffold landed; the seed `docs/gdd/01-vision-and-pillars.md` had not been drafted yet at the time the followup was filed.
- Blocker: none.
- Unblock condition: dev provides one paragraph of vision text or approves a draft.
- Resolved: 2026-05-08. Five GDD section files were drafted (`01-vision-and-pillars.md`, `02-time-travel-rules.md`, `03-story-acts-1-3.md`, `23-prototype-scope.md`, `99-out-of-scope.md`) before the audit-remediation slice picked up the followup.

### F-006: Unify the door-paint path through `litStateForTimeline`

- Priority: nice-to-have
- Context: REQ-011 lands the seed-and-arrivals seam at the runtime gate (`isLitForCurrentTimeline` in `src/sim/portalTraversal.ts`) but leaves the visual paint path (`repaintDoorsForHour` in `src/sim/timelineRoom.ts`, the room-build paint in `src/scene/room.ts`) reading `doorLitStateAtHour(hour)` directly. The two paths agree today because the arrivals stub returns `false`. Once Acts 2-3 introduce a non-trivial arrivals rule (e.g. the West door at 5:00 lighting once a You-1 has arrived from 6:00), the paint path will need the same registry-aware computation or visual and behavior will drift.
- Blocker: none. The unification is straightforward; deferred only because doing it now would be a no-op behavior change and slice discipline says wait for the third repetition.
- Unblock condition: either a slice introduces a non-trivial arrivals rule (Act 2 / Act 3) and routes both call sites through `litStateForTimeline`, or a small refactor slice unifies the two ahead of that.
- Resolved: PR #60. `repaintDoorsForHour` now reads through `litStateForTimeline(hour, { ghosts })` instead of the seed-only `doorLitStateAtHour`. All three call sites updated: `src/app.ts`'s `onTimelineEnter` passes `registry.ghostsFor(destinationHour)`, `src/sim/hardReset.ts` passes `registry.ghostsFor(ACT_ONE_HOUR)`, and `src/scene/room.ts` at boot relies on the default empty `ghosts` array (no registry yet so no arrivals to override). The Act 3 cinematic now darkens the painted North door at 12:00 until every cinematic actor completes, matching the runtime traversal gate.

### F-007: Rehome a thrown body across timelines on portal traversal

- Priority: nice-to-have
- Context: REQ-036 (PR #27) ships throw with portal traversal. The in-flight registry teleports the body's translation and preserves velocity on a lit-portal enter, but the body remains a `GhostInstance` filed in its source `TimelineRegistry` bucket. Concretely: a thrown body launched at 5:00 across the south door teleports to the room-center spawn pose at 12:00, but the underlying ghost is still bookkept in the 5:00 timeline. When the player switches timelines, the ghost is hidden by `setActiveTimeline`; on return to 5:00 the ghost's `reset()` call snaps it back to the 5:00 spawn position, erasing the thrown trajectory's destination state. The thrown body is therefore not visible in the 12:00 timeline at all. CodeRabbit flagged this on PR #27 as the "Surface timeline transfer when a thrown body traverses" review.
- Blocker: cross-timeline rehoming for a body that is itself a ghost is heavier than the slice scope (the carry layer files thrown bodies as ghost-body references; the in-flight registry would need to either own its own non-ghost flying-body type or call back into the host so the host can rehome the ghost between TimelineRegistry buckets). The thrown-body persistence at the destination timeline is also a gameplay decision: the dossier section 7 says the body "is IN the 12:00 timeline as a body" but does not specify whether subsequent visits to 5:00 still see the body in flight or settled at its destination.
- Unblock condition: dossier amendment specifying the thrown body's persistence semantics across timeline visits (does the destination timeline see the body settle? does the source timeline see the body absent? do both timelines see it depending on when the player visits?), then a slice that either splits in-flight bodies into a new dedicated entity type or wires the in-flight registry's lit-traversal events through to the host's TimelineRegistry for rehoming.
- Partial: PR #62. Dossier amendment landed (Q-028 resolved as Option A: "one body per recorded throw event across all loops"). The spec specifies a `bodyId = (throwerInstanceId, throwTick)` keyed in the `InFlightRegistry` across timeline buckets, plus rehoming on lit-portal traversal, plus throw-resolver no-op on replay when a body with the same id already exists. See `docs/gdd/30-combat-and-interaction.md` section 7 "Persistence across loops" subsection for the full spec.
- Resolved: PR #63. Implementation lands the full Q-028 model: (1) `InFlightRegistry` gains `bodyId?: string` on `register` plus a `hasBodyForThrow(bodyId)` lookup plus an `onPortalCrossing(bodyId, portal)` callback option. (2) `TimelineRegistry` gains a `rehomeGhost(ghost, destinationTimeline)` method that moves a ghost's bucket placement without touching the mesh or Rapier body (contrast with `removeGhost` which destroys both). (3) `tryThrow` accepts an optional `isThrowAlreadyFired()` predicate and silently consumes the input when the predicate returns `true` (no spawn, no transition, no impulse, no resolveBody lookup). (4) Host (`src/app.ts`) computes `throwBodyId = "${player.instanceId}:${lifetime.recorder.length}"` per throw attempt, passes it through both `tryThrow` and `register`, and wires `onPortalCrossing` to call `registry.rehomeGhost(ghost, destinationHour)` on every lit-portal traversal of a tracked body. 10 new tests covering the dedupe gate, the bodyId/no-bodyId back-compat, the callback firing on lit and not firing on dark, and the rehome path's bookkeeping-only contract. 632 total tests pass (was 622).

### F-009: Touch buttons for pickup / throw / punch / hard-reset

- Priority: nice-to-have
- Context: The touch-joystick slice shipped a single-stick movement-only input on mobile. Pickup (F), throw (T), punch (Space), and hard-reset (R) still require a keyboard. Without these the prototype is not fully playable on a phone.
- Blocker: none. The DOM-overlay pattern in `src/render/touchOverlay.ts` already shows the joystick ring; a parallel `actionButtons.ts` module would mount four bottom-right action buttons that flip the same `KeyState` booleans the keyboard handler does.
- Unblock condition: a slice that adds DOM buttons wired to the existing `KeyState.pickup / throw / punch` plus a synthetic `keydown KeyR` for hard reset. Should respect `aria-pressed` and not interfere with the joystick when the user touches them.
- Resolved: PR #59. New `src/render/actionButtons.ts` mounts four bottom-right buttons (Punch / Pick / Throw / Reset). Press / release events flip the same `KeyState` booleans the keyboard handler would, so the recorder snapshots identical state regardless of input source. The Reset button dispatches a synthetic `keydown KeyR` to fire the existing reset listener. Touch and mouse events both supported; keyboard activation (Enter / Space on focus) preserved; `aria-pressed` reflects state on the three KeyState buttons. Positioned on the bottom-right with a vertical stack; the joystick stays on the bottom-left (one thumb per corner).

### F-010: Camera pan / zoom / orbit gestures

- Priority: nice-to-have
- Context: The dollhouse camera shipped in the responsive-camera slice is fixed: `OrthographicCamera` with `(width*1.4, height*2.2, depth*1.4)` looking at `(0, height*0.4, 0)` and a contain-fit frustum. The mi-casa renderer this pattern was lifted from also exposes `applyPanDeltaPixels` (drag-to-pan) and `applyZoomScale` (pinch / wheel zoom). Pseudo Paradox does not yet have these; the user explicitly asked about mi-casa-style camera handling and a future slice should let the player pan and zoom into a corner of the room when needed.
- Blocker: not blocking; the fixed dollhouse vantage shows the whole 10x10 room and all four doors so the prototype is playable as-is.
- Unblock condition: a slice that wires `wheel` / pointer-drag (desktop) and pinch / two-finger-drag (mobile) into `OrthographicCamera.zoom` plus a pan offset on the lookAt target, with bounds so the camera never leaves the room region.
- Resolved: PR #61. New `src/render/cameraGestures.ts` exports `attachCameraGestures({ container, camera })` plus pure helpers `applyZoomScale`, `applyPanDelta`, `screenDragToWorldPan`. Bindings: wheel = zoom (desktop); right-click drag = pan (desktop, context menu suppressed on the canvas); pinch = zoom (mobile); two-finger drag = pan (mobile). Left-click drag stays free for future bindings. Constants: `ZOOM_MIN = 0.5`, `ZOOM_MAX = 3`, `PAN_LIMIT_M = 5`, `WHEEL_ZOOM_PER_PIXEL = 1.0015`. Single-finger touch still goes to the joystick (the camera handler only engages when 2 touch pointers are active). 15 new pure-helper tests in `tests/render/cameraGestures.test.ts`.

### F-011: Wall colliders compatible with portal trigger volumes

- Priority: nice-to-have
- Context: The static-floor slice (PR after #44) shipped a floor collider but no wall colliders. Two failed approaches were tried first. (1) Walls with door-shaped gaps: the gap let the player walk through dark doors and off the world. (2) Solid walls flush with the wall mesh: the existing portal trigger volumes (centered on the inner wall face, depth 0.6) sat out of reach behind the collider so lit-portal traversal would break (player capsule center cannot enter the trigger zone without colliding with the wall first). The clean answer needs either (a) solid walls plus deeper trigger volumes wired to fire from positions the capsule can reach, or (b) door blockers that mirror the timeline-driven lit state so dark doors are physically blocked while lit doors stay enterable. Either way the room becomes a real bounded play volume.
- Blocker: not blocking; the wide invisible floor apron means the player cannot fall off, and the visual wall mesh still reads as a room boundary even though it does not collide.
- Unblock condition: a slice that picks one of the two strategies above. Strategy (a) is simpler if `PORTAL_TRIGGER_DEPTH` can be widened safely; strategy (b) keeps the trigger geometry untouched but needs a per-tick lit-state read that updates the door blockers when the active timeline changes.
- Resolved: PR #46. The dossier's strategy (a) ended up working without touching `PORTAL_TRIGGER_DEPTH` because the math at the trigger zone for a solid wall already accommodates a 0.4-radius capsule pressed against the wall: the capsule center sits inside the existing trigger band at the moment of collision. Solid full-height walls flush with the visual mesh; no door cutouts; no trigger geometry change.

### F-012: Ghosts despawn on lit-portal traversal during replay

- Priority: blocks-release
- Context: When a ghost replays a recording that included a portal traversal, the ghost currently does not actually traverse. They stay in their originating timeline and continue replaying past the door, sometimes ending up at zero velocity at the end of the recording and "stuck" at the door visually. The user observed: "their body shouldn't be stuck there." Expected behavior: when a ghost's recording-driven body crosses a lit portal trigger, despawn the ghost from the active timeline (mirror what the active player did when they originally walked through the door). The destination timeline already has its own ghost recordings filed separately, so the ghost does not need to "re-appear" anywhere; this is purely a despawn at the door.
- Blocker: needs ghost-vs-portal-trigger detection (the existing `PortalTriggerSet` only tracks the active player's overlap). Either the per-tick loop iterates ghosts through the same trigger set, or a separate ghost-overlap path is added.
- Unblock condition: a slice that wires a ghost's per-tick translation through the portal trigger detector and despawns the ghost (remove from registry, dispose body / mesh) on a lit-portal enter event.
- Resolved: PR #47. New `removeGhost` method on `TimelineRegistry` plus a pure `despawnGhostsAtLitPortals` helper in `src/sim/ghostDespawn.ts` wired into the per-fixed-step loop after `inFlightRegistry.step`. Dark portals are intentionally not despawn triggers; the helper reads the same `bodyLitGate` predicate the in-flight registry uses so the despawn pass and thrown-body traversal share one source of truth.

### F-013: Goal-oriented ghost replay with milestone weights

- Priority: blocks-release
- Context: Ghost replay currently replays per-tick recorded `KeyState` exactly. When the active player or another ghost bumps the replaying ghost, the ghost's position drifts but the recorded inputs keep firing on the original timing, producing visibly broken paths. The user wants ghosts to chase weighted MILESTONES recorded at the time of the original lifetime so that "if I bump an instance in one time, when I loop back to that time I should see an instance of myself bumping that instance." Initial schema (Q-027 default A): `wall_bump` (weight 1) and `door_traversal` (weight 5). On replay the ghost replays original input until drift exceeds threshold, then path-follows toward the next milestone (Q-024 default B: hybrid replay). Lower-weight milestones can be skipped if the ghost is too delayed; the door is unskippable (Q-025 default A: ticks-behind per weight tier with `WALL_BUMP_BUDGET_TICKS = 60`).
- Blocker: requires per-tick wall-bump detection during recording, milestone-targeted pathing during replay, weighted skip logic, and a hybrid replay state machine.
- Unblock condition: PR3a (milestone capture) plus PR3b (hybrid replay) per the slice plan in `docs/IMPLEMENTATION_PLAN.md`. Q-024, Q-025, Q-027 all resolved with concrete defaults; F-014 (the catch-up-on-arrival half) is split into its own slice (PR3c plus PR3d) so this followup can ship without the registry refactor.
- Resolved: PR3a (milestone capture, PR #48) plus PR3b (hybrid replay using milestones). PR3b's `src/sim/replayController.ts` ships the drift detector, path-follower, and ticks-behind skip rule per the resolved knobs (`DRIFT_THRESHOLD = 0.5`, `ARRIVAL_RADIUS = 0.3`, `WALL_BUMP_BUDGET_TICKS = 60`, door unskippable). `GhostInstance.advanceTick` delegates to the controller; existing tests pass because ghosts with empty milestone logs stay in input-replay mode.

### F-014: Continuous per-timeline tick clock plus door destination ticks (Reading C)

- Priority: blocks-release
- Context: The user clarified the timeline tick model in a 2026-05-10 design pass: each timeline has a continuous absolute tick clock, ghosts have an absolute `startTick` within the timeline, and door destinations are pinned to (timelineId, tick) pairs rather than just timeline. Worked example: a door whose destination is hour-5 tick 200 lands the player at tick 200 of the hour-5 timeline; ghosts whose recordings cover that tick are positioned at `position(arrivalTick - startTick)` of their recording. Ghosts whose recording ended before the arrival tick (their `door_traversal` milestone fired earlier) are not visible. Replaces the current "reset every ghost to tick 0 on entry" model. See Q-026 for the worked example and the three reading variants.
- Blocker: requires (1) per-timeline tick clock in `TimelineRegistry`; (2) `startTick` field on `GhostInstance`; (3) `Portal.destinationTick` field added with default 0 for backwards compatibility; (4) `setActiveTimeline(next, arrivalTick)` that fast-forwards each ghost's milestone state and body position to the arrival tick; (5) F-013 milestones landed first so the fast-forward can replay the recording up to `arrivalTick - startTick` deterministically.
- Unblock condition: PR3a (milestones) and PR3b (hybrid replay) merged. Then PR3c lands the registry refactor plus `Portal.destinationTick` plumbing; PR3d does the game-design pass authoring specific destination ticks per door per the GDD.
- Resolved: PR3c (Reading-C tick model). The registry now carries a per-timeline tick clock (`tickFor`, `advanceActiveTick`); `GhostInstance.startTick` plus `fastForwardTo(absoluteTick)` lets the host virtually walk a ghost to any arrival tick; `Portal.destinationTick` (default 0) plus `setActiveTimeline(next, arrivalTick, disposeOptions?)` pins door destinations to (timelineId, tick) pairs and despawns stale ghosts whose `door_traversal` milestone fires before arrival. PR3d will author specific non-zero destination ticks per the GDD and add the end-to-end loop-back-bump smoke.
- PR / Dot reference: #50 (PR3c).

### F-015: Migrate scripted Acts 2-3 tests to 30-plus frame recordings

- Priority: blocks-release
- Context: The thirteen Acts 2-3 integration tests in `tests/sim/act2*.test.ts`, `tests/sim/act3*.test.ts`, and `tests/sim/endToEndCompletability.test.ts` use 4-to-5 frame east-walk recordings as scaffolding (the actual position change is tiny; the test drives the trigger fire via `detector.step` teleports). When these ghosts are filed via `wireTraversal`, their `door_traversal` milestone fires at tick 5. Per the Reading-C semantic from Q-026, any West portal `destinationTick > 5` despawns these ghosts on loop-back at 5:00. PR3d ships the West portal's `destinationTick = 0` so the existing tests keep passing, but the GDD's intended UX (the loop-back-bump where you see your past self mid-walk) needs a non-zero value (the design heuristic suggested 30 ticks). Unblocking that authoring requires migrating the thirteen tests so their east-walk recordings exceed the chosen West destinationTick.
- Blocker: each test has assertions about `recording.length`, `tickIndex` after re-enter, and downstream predicate semantics that bake in the tick-0 reset. A migration slice rewrites the scripted recordings to be longer (e.g. 40 frames) and updates the assertions accordingly.
- Unblock condition: a dedicated slice that walks each test, inflates the east-walk recordings to past the chosen West destinationTick, updates `recording.length` and `tickIndex` assertions, and re-verifies the act predicates still fire on the new shapes.
- Resolved: PR3e. East-walk recordings extended from 5 to 40 frames across all `runLoopOne` helpers (8 files) plus the inline pattern in `act2Loop1.test.ts` plus the single inline byte-identical-replay test bypassed its West traversal via direct `registry.setActiveTimeline(5, 0)` because that test's contract is replay determinism, not traversal mechanics. Two `tickIndex === recording.length` assertions in `act2Loop1.test.ts` and `act2Loop2.test.ts` softened to `toBeGreaterThanOrEqual` to allow the fast-forwarded starting tickIndex. The `ACT_ONE_PORTAL_SPECS` West portal `destinationTick` flipped from 0 to 30 in the same slice so the loop-back-bump UX lands in production. 604 tests pass.
