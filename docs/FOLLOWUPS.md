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

### F-012: Ghosts despawn on lit-portal traversal during replay

- Priority: blocks-release
- Context: When a ghost replays a recording that included a portal traversal, the ghost currently does not actually traverse. They stay in their originating timeline and continue replaying past the door, sometimes ending up at zero velocity at the end of the recording and "stuck" at the door visually. The user observed: "their body shouldn't be stuck there." Expected behavior: when a ghost's recording-driven body crosses a lit portal trigger, despawn the ghost from the active timeline (mirror what the active player did when they originally walked through the door). The destination timeline already has its own ghost recordings filed separately, so the ghost does not need to "re-appear" anywhere; this is purely a despawn at the door.
- Blocker: needs ghost-vs-portal-trigger detection (the existing `PortalTriggerSet` only tracks the active player's overlap). Either the per-tick loop iterates ghosts through the same trigger set, or a separate ghost-overlap path is added.
- Unblock condition: a slice that wires a ghost's per-tick translation through the portal trigger detector and despawns the ghost (remove from registry, dispose body / mesh) on a lit-portal enter event.
- Resolved: PR #47. New `removeGhost` method on `TimelineRegistry` plus a pure `despawnGhostsAtLitPortals` helper in `src/sim/ghostDespawn.ts` wired into the per-fixed-step loop after `inFlightRegistry.step`. Dark portals are intentionally not despawn triggers; the helper reads the same `bodyLitGate` predicate the in-flight registry uses so the despawn pass and thrown-body traversal share one source of truth.

### F-013: Goal-oriented ghost replay with milestone weights

- Priority: blocks-release
- Context: Ghost replay currently replays per-tick recorded `KeyState` exactly. When the active player or another ghost bumps the replaying ghost, the ghost's position drifts but the recorded inputs keep firing on the original timing, producing visibly broken paths. The user wants ghosts to instead chase weighted MILESTONES recorded at the time of the original lifetime: wall bumps (low weight) and door traversals (high weight). On replay the ghost path-follows toward the next milestone; if too delayed they skip lower-weight milestones to hit the high-weight ones. Tail behavior: see F-014 (which captures the user's "fast-forward stale instances to the time the active player walks in" rule).
- Blocker: requires per-tick wall-bump detection during recording, milestone-targeted pathing during replay, weighted skip logic, and a tail strategy that interacts with the timeline registry's lit-portal model.
- Unblock condition: design plus implementation in a dedicated slice. Likely splits into two steps: (1) milestone capture during recording (wall bumps + door traversals appended to the existing `InputRecorder` or a parallel `MilestoneRecorder`), (2) replay path-follower that consumes milestones and handles weight-based skipping.
- PR / Dot reference (when picked up):

## Nice To Have

### F-014: Stale ghosts fast-forward to active player's tick on timeline arrival

- Priority: nice-to-have
- Context: The user described an advanced scenario for F-013 tail behavior: "If there is an instance who stays in a room/time for hours, then they need to fast-forward to the position they were in at whatever time I am walking into that room." Means: when the active player lands in a timeline at tick T, every ghost whose recording started before T should advance their replay state to tick T (their position, milestone progress) rather than rewinding to tick 0. Otherwise a ghost recorded between hour 2 and hour 9 in a 10-hour timeline would always replay starting from hour 2, even if the player walks in at hour 9.
- Blocker: depends on F-013 milestone replay landing first.
- Unblock condition: ghost spawn / setActiveTimeline path needs a "skip-to-tick" entry point that respects milestone progress (advance through skipped milestones if they are lower-weight) and a "skip-to-position" path that works for ghosts mid-traversal.
- PR / Dot reference (when picked up):

### F-011: Wall colliders compatible with portal trigger volumes

- Priority: nice-to-have
- Context: The static-floor slice (PR after #44) shipped a floor collider but no wall colliders. Two failed approaches were tried first. (1) Walls with door-shaped gaps: the gap let the player walk through dark doors and off the world. (2) Solid walls flush with the wall mesh: the existing portal trigger volumes (centered on the inner wall face, depth 0.6) sat out of reach behind the collider so lit-portal traversal would break (player capsule center cannot enter the trigger zone without colliding with the wall first). The clean answer needs either (a) solid walls plus deeper trigger volumes wired to fire from positions the capsule can reach, or (b) door blockers that mirror the timeline-driven lit state so dark doors are physically blocked while lit doors stay enterable. Either way the room becomes a real bounded play volume.
- Blocker: not blocking; the wide invisible floor apron means the player cannot fall off, and the visual wall mesh still reads as a room boundary even though it does not collide.
- Unblock condition: a slice that picks one of the two strategies above. Strategy (a) is simpler if `PORTAL_TRIGGER_DEPTH` can be widened safely; strategy (b) keeps the trigger geometry untouched but needs a per-tick lit-state read that updates the door blockers when the active timeline changes.
- Resolved: PR #46. The dossier's strategy (a) ended up working without touching `PORTAL_TRIGGER_DEPTH` because the math at the trigger zone for a solid wall already accommodates a 0.4-radius capsule pressed against the wall: the capsule center sits inside the existing trigger band at the moment of collision. Solid full-height walls flush with the visual mesh; no door cutouts; no trigger geometry change.

### F-009: Touch buttons for pickup / throw / punch / hard-reset

- Priority: nice-to-have
- Context: The touch-joystick slice shipped a single-stick movement-only input on mobile. Pickup (F), throw (T), punch (Space), and hard-reset (R) still require a keyboard. Without these the prototype is not fully playable on a phone.
- Blocker: none. The DOM-overlay pattern in `src/render/touchOverlay.ts` already shows the joystick ring; a parallel `actionButtons.ts` module would mount four bottom-right action buttons that flip the same `KeyState` booleans the keyboard handler does.
- Unblock condition: a slice that adds DOM buttons wired to the existing `KeyState.pickup / throw / punch` plus a synthetic `keydown KeyR` for hard reset. Should respect `aria-pressed` and not interfere with the joystick when the user touches them.
- PR / Dot reference (when picked up):

### F-010: Camera pan / zoom / orbit gestures

- Priority: nice-to-have
- Context: The dollhouse camera shipped in the responsive-camera slice is fixed: `OrthographicCamera` with `(width*1.4, height*2.2, depth*1.4)` looking at `(0, height*0.4, 0)` and a contain-fit frustum. The mi-casa renderer this pattern was lifted from also exposes `applyPanDeltaPixels` (drag-to-pan) and `applyZoomScale` (pinch / wheel zoom). Pseudo Paradox does not yet have these; the user explicitly asked about mi-casa-style camera handling and a future slice should let the player pan and zoom into a corner of the room when needed.
- Blocker: not blocking; the fixed dollhouse vantage shows the whole 10x10 room and all four doors so the prototype is playable as-is.
- Unblock condition: a slice that wires `wheel` / pointer-drag (desktop) and pinch / two-finger-drag (mobile) into `OrthographicCamera.zoom` plus a pan offset on the lookAt target, with bounds so the camera never leaves the room region.
- PR / Dot reference (when picked up):

### F-008: Real-browser ship gates (Playwright E2E plus Lighthouse load-time plus 60fps frame budget)

- Priority: nice-to-have
- Context: REQ-037 / REQ-038 / REQ-039 / REQ-040 shipped (PR #43, the final iteration) with Vitest in-process REGRESSION GUARDS rather than real-browser SLAs. The current gates are: (1) `tests/sim/endToEndCompletability.test.ts` drives the Act 1 to escape sequence in-process and asserts ActStateObserver reaches `'escaped'` plus a determinism gate; (2) `tests/perf/bundleSize.test.ts` asserts `dist/assets/*.js` is under 5 MB raw; (3) `tests/perf/frameTime.test.ts` asserts the simulation's per-step CPU time is under 16.67 ms at the 95th percentile. The proper real-browser gates would be: (a) Playwright E2E against the local dev server that drives keydown/keyup events through Acts 1 to 3 and polls `window.__pseudoParadoxActState` (Q-020 default A); (b) a Playwright smoke against `pseudo-paradox.vercel.app` that hits the live URL and asserts no JS errors (Q-018 default A); (c) Lighthouse-based load-time measurement to pin the literal 10 s budget over a 5 Mbps connection (REQ-038); (d) a real-browser frame-budget measurement to pin 60 fps (REQ-039).
- Blocker: per RULE 3, Playwright and Lighthouse are core test-infra dependencies that need explicit user approval. The Vitest in-process guards catch sim-side regressions cheaply and the Vercel preview deploy already gates every PR; the real-browser gates would be redundant in CI today and add dev-loop cost.
- Unblock condition: a spillover release (post-prototype) or explicit user approval to add Playwright plus Lighthouse as devDeps. Then ship four small slices: (1) Playwright E2E against local dev; (2) Playwright live-URL smoke; (3) Lighthouse load-time gate; (4) Real-browser fps measurement.
- PR / Dot reference (when picked up):

### F-007: Rehome a thrown body across timelines on portal traversal

- Priority: nice-to-have
- Context: REQ-036 (PR #27) ships throw with portal traversal. The in-flight registry teleports the body's translation and preserves velocity on a lit-portal enter, but the body remains a `GhostInstance` filed in its source `TimelineRegistry` bucket. Concretely: a thrown body launched at 5:00 across the south door teleports to the room-center spawn pose at 12:00, but the underlying ghost is still bookkept in the 5:00 timeline. When the player switches timelines, the ghost is hidden by `setActiveTimeline`; on return to 5:00 the ghost's `reset()` call snaps it back to the 5:00 spawn position, erasing the thrown trajectory's destination state. The thrown body is therefore not visible in the 12:00 timeline at all. CodeRabbit flagged this on PR #27 as the "Surface timeline transfer when a thrown body traverses" review.
- Blocker: cross-timeline rehoming for a body that is itself a ghost is heavier than the slice scope (the carry layer files thrown bodies as ghost-body references; the in-flight registry would need to either own its own non-ghost flying-body type or call back into the host so the host can rehome the ghost between TimelineRegistry buckets). The thrown-body persistence at the destination timeline is also a gameplay decision: the dossier section 7 says the body "is IN the 12:00 timeline as a body" but does not specify whether subsequent visits to 5:00 still see the body in flight or settled at its destination.
- Unblock condition: dossier amendment specifying the thrown body's persistence semantics across timeline visits (does the destination timeline see the body settle? does the source timeline see the body absent? do both timelines see it depending on when the player visits?), then a slice that either splits in-flight bodies into a new dedicated entity type or wires the in-flight registry's lit-traversal events through to the host's TimelineRegistry for rehoming.
- PR / Dot reference (when picked up):

### F-006: Unify the door-paint path through `litStateForTimeline`

- Priority: nice-to-have
- Context: REQ-011 lands the seed-and-arrivals seam at the runtime gate (`isLitForCurrentTimeline` in `src/sim/portalTraversal.ts`) but leaves the visual paint path (`repaintDoorsForHour` in `src/sim/timelineRoom.ts`, the room-build paint in `src/scene/room.ts`) reading `doorLitStateAtHour(hour)` directly. The two paths agree today because the arrivals stub returns `false`. Once Acts 2-3 introduce a non-trivial arrivals rule (e.g. the West door at 5:00 lighting once a You-1 has arrived from 6:00), the paint path will need the same registry-aware computation or visual and behavior will drift.
- Blocker: none. The unification is straightforward; deferred only because doing it now would be a no-op behavior change and slice discipline says wait for the third repetition.
- Unblock condition: either a slice introduces a non-trivial arrivals rule (Act 2 / Act 3) and routes both call sites through `litStateForTimeline`, or a small refactor slice unifies the two ahead of that.
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

## Polish

(none yet)

## Resolved

### F-001: Draft first GDD section

- Priority: nice-to-have
- Context: scaffold landed; the seed `docs/gdd/01-vision-and-pillars.md` had not been drafted yet at the time the followup was filed.
- Blocker: none.
- Unblock condition: dev provides one paragraph of vision text or approves a draft.
- Resolved: 2026-05-08. Five GDD section files were drafted (`01-vision-and-pillars.md`, `02-time-travel-rules.md`, `03-story-acts-1-3.md`, `23-prototype-scope.md`, `99-out-of-scope.md`) before the audit-remediation slice picked up the followup.
