# Open Questions

Questions here block or influence implementation.

> **Critical convention.** Every question must include a `Recommended default:` line. The loop ships under that default and leaves the question open for override. Do not block the loop on dev sign-off. Stress-tested values that survive multiple iterations get frozen.

## How to add a new question

```
## Q-NNN: Short title

- Context: one or two sentences on why this is a decision point.
- Options:
  - A. Option A description.
  - B. Option B description.
  - C. Option C description.
- Recommended default: B. One sentence on the rationale.
- Status: open
- Resolution: (filled in once dev confirms or overrides)
```

Keep `Q-NNN` IDs monotonically increasing. When a question resolves, leave the entry in place and update `Status: resolved` plus the `Resolution:` line. Never delete.

## Open

### Q-002: Key bindings for punch, pickup, and throw

- Context: REQ-033 / REQ-034 / REQ-036 introduce three new player inputs. The keyboard layer in `src/input/keyboard.ts` currently captures only WASD / arrows for movement. The new inputs need binding choices that do not collide with movement and that read naturally on a QWERTY keyboard.
- Options:
  - A. `Space` / `F` / `T` (punch / pickup / throw). Space is a common attack key; F is a common interact key; T is adjacent to F so the carry-then-throw chord is one row.
  - B. `J` / `K` / `L`. Right-hand cluster, far from WASD, but unfamiliar.
  - C. Mouse buttons for punch / throw and `F` for pickup. Adds a mouse dependency the prototype has avoided.
- Recommended default: A. Conventional, single-row reach, no mouse coupling. `Space` does not collide with movement; `F` and `T` are far enough from WASD to avoid mispress.
- Status: open
- Resolution:

### Q-003: Punch range

- Context: REQ-033 hit detection is capsule-vs-capsule proximity. The prototype's player capsule radius is 0.4. A range value too small forces the player to overlap into the recipient (visually awkward and physically impossible because both are dynamic colliders). Too large and the punch hits unintended targets.
- Options:
  - A. `1.2 m`. Roughly the diameter of one capsule plus a contact margin; the puncher and recipient stand "in arm's reach" without overlapping.
  - B. `0.9 m`. Closer to capsule contact distance; requires near-touch.
  - C. `1.5 m`. More forgiving but the action reads less like a punch.
- Recommended default: A (1.2 m). Reads as a punch and does not require collider overlap.
- Status: open
- Resolution:

### Q-004: Pickup input as toggle versus hold

- Context: REQ-034 carry can be implemented as a hold (key down: carry; key up: drop) or as a toggle (tap: pick up; tap again: drop). Hold is naturally "I have the body in my hands"; toggle is naturally "I picked up the body and am now carrying it." Recording-replay determinism is identical either way: both reduce to a per-tick boolean channel.
- Options:
  - A. Toggle. One tap picks up; another tap drops. Simpler to record (one rising-edge per pickup, one rising-edge per drop). Player does not have to keep a key held while moving.
  - B. Hold. Releasing the key drops the body. Higher input load on the player; harder to combine with movement keys mid-drag.
- Recommended default: A (toggle). Pillar 4 (logical puzzles) does not benefit from the held-key tension; the player's attention should be on positioning, not on holding a key.
- Status: open
- Resolution:

### Q-005: Carry speed multiplier

- Context: REQ-034 specifies that the player slows while carrying. Too fast and the carry is invisible. Too slow and the puzzle's traversal cost is annoying.
- Options:
  - A. `0.6` (60% of normal). Visible slowdown, still walkable.
  - B. `0.5`. Half-speed; reads heavy; risks tedium across a 10-meter room.
  - C. `0.75`. Subtle slowdown; risks not reading at all.
- Recommended default: A (0.6). Balances visibility against tedium.
- Status: open
- Resolution:

### Q-006: Collision group for carrier-versus-carried during carry

- Context: While the player carries an unconscious body, the carrier and the carried capsule occupy overlapping space. If both colliders sit in the same Rapier collision group, the integrator fights itself trying to resolve the overlap, producing jitter. Excluding the pair from collision for the duration of the carry is the standard solution.
- Options:
  - A. Excluded collision group during carry; restored on drop. Carrier-vs-world and carried-vs-world stay normal; only carrier-vs-carried is excluded.
  - B. Make the carried body a child rigid body (joint constraint). More accurate but adds joint state to teardown logic.
  - C. Make the carried body kinematic during carry. Avoids the collision fight by removing the carried body from dynamic resolution; restore to dynamic on drop.
- Recommended default: A combined with C: kinematic carried body during carry, excluded collision group during carry, both restored on drop. Belt and suspenders; either alone is sufficient but the combination is the safest.
- Status: open
- Resolution:

### Q-007: Facing default before first movement

- Context: REQ-036 throw direction is the player's last non-zero movement direction. At game start (and after a hard reset) the player has not moved, so facing is undefined. A throw with no defined facing must still resolve to a direction.
- Options:
  - A. North (`{ x: 0, z: -1 }`). Matches the keyboard convention `forward = -z` in `src/input/keyboard.ts`.
  - B. The cardinal direction of the nearest lit door. More puzzle-aware but adds a dependency on the portal layer.
  - C. Throw fails (no-op) until the player has moved at least once.
- Recommended default: A (north). Simplest, deterministic, matches the keyboard layer's intuitive forward.
- Status: open
- Resolution:

### Q-008: Trajectory preservation when a thrown body crosses a portal

- Context: REQ-036 throws can cross a lit portal mid-flight. The body teleports to the destination time. The body's velocity at the moment of teleport is the question: keep it as is, zero it, or rotate it?
- Options:
  - A. Keep linear velocity unchanged (rotate zero degrees). The body continues its arc on the destination side. Reads as "a continuous physical trajectory, just in a different time."
  - B. Zero linear velocity. The body teleports to a stop at the destination. Reads as "the portal is a sticky destination."
  - C. Rotate linvel to match the destination's facing. Only meaningful if destinations have an authored facing; the prototype does not.
- Recommended default: A (preserve linvel). Physically readable and matches the player traversal pipeline's spirit (the player's facing is preserved across the traversal because movement is world-axis-aligned).
- Status: open
- Resolution:

### Q-009: Thrown-body determinism across replay

- Context: REQ-036 thrown bodies do NOT spawn ghosts. On replay, the throw input fires from the recorded `KeyState`, producing a fresh thrown body in the past timeline. Determinism requires the fresh thrown body's trajectory matches the original throw's trajectory tick-for-tick.
- Options:
  - A. Trust Rapier's deterministic step plus identical initial conditions plus identical impulse to produce identical trajectory. Re-evaluate only if a cross-machine determinism failure surfaces.
  - B. Pre-compute the thrown body's trajectory at throw-time and cache the points; on replay drive the body kinematically along the cached points.
  - C. Persist the thrown body's per-tick translation as an additional recording channel and replay translation directly.
- Recommended default: A. Rapier3D is documented as deterministic given identical inputs and identical step order; the prototype already relies on this for ghost replay (REQ-002). Adding a cache or a per-tick translation channel is premature optimization until a failure case appears.
- Status: open
- Resolution:

### Q-012: Where do scripted Act-1-cinematic recordings live?

- Context: REQ-012 needs three pre-authored `InputRecording` data files (two draggers plus a knocked-out body). They are gameplay-system data, but they are also data files (not code in the running-game sense).
- Options:
  - A. `src/sim/scripts/`. Co-located with the rest of the simulation code; imported by `src/app.ts` directly.
  - B. `src/data/`. A separate top-level data directory; cleaner conceptual separation.
  - C. `public/scripts/`. Fetched at runtime as JSON; defers loading to network time.
- Recommended default: A (`src/sim/scripts/`). The recordings are simulation-system data; they import existing types from `src/sim/inputRecorder.ts` and are bundled with the rest of the sim. C is slower (network round-trip) and B introduces a new top-level directory for one feature.
- Status: open
- Resolution:

### Q-013: Fade-to-black implementation for the Act 1 cinematic

- Context: REQ-012's cinematic ends with a fade-to-black before the 5:00 spawn. The fade can live in CSS (an HTML overlay above the canvas) or in Three.js (a full-screen plane on a separate orthographic camera).
- Options:
  - A. Three.js full-screen plane on a separate `OrthographicCamera` overlay. Co-located with the existing render pass; opacity is animated by writing the material's alpha.
  - B. CSS overlay above the canvas. Simpler markup; opacity animated via `style.opacity`.
  - C. Per-pixel post-process pass. Heavier; not necessary for a simple uniform fade.
- Recommended default: A. Keeps the cinematic fully inside the renderer (no `index.html` edits, no DOM coupling); deterministic per-tick opacity changes are trivial.
- Status: open
- Resolution:

### Q-014: Drop-center radius for Act 3 mirror beat predicate

- Context: REQ-021 (Act 3 mirror beat) requires the player to drop the unconscious 5:00 instance "in the center of the room" at 12:00. The predicate uses a tolerance radius around the room origin.
- Options:
  - A. 1.0 m. Tight enough that "dropped near a wall" does not satisfy; loose enough that the player does not need to drop at exactly the origin.
  - B. 0.5 m. Tighter; risks frustration if the player drops slightly off-center.
  - C. 2.0 m. Loose; the puzzle's mirroring of Act 1 reads less precisely.
- Recommended default: A (1.0 m). Balances precision against player frustration.
- Status: open
- Resolution:

### Q-015: Are the player's actions during the Act 1 cinematic recordable?

- Context: REQ-012's cinematic happens at 12:00. If the active player exists during the cinematic and an `InputRecorder` is open, then any input (or even idle) gets recorded into the 12:00 bucket and competes with the scripted-actor recordings.
- Options:
  - A. NOT recordable. The active player either does not exist yet or has no recorder open during the cinematic.
  - B. Recordable. The active player owns a recorder that captures whatever happens during the cinematic; this becomes a fourth ghost in the 12:00 bucket on later visits.
- Recommended default: A. Pillar 4 (logical puzzles) is preserved by keeping the cinematic outside the recording surface; the cinematic is the WORLD telling the player something, not the player acting.
- Status: open
- Resolution:

### Q-016: Player input during the Act 1 cinematic

- Context: REQ-012 plays a cinematic at 12:00. The active player either does not exist yet (cinematic plays first, then spawns at 5:00) or exists but should not be able to move during the cinematic. The simplest model is to read KeyState but ignore it for the duration of the cinematic.
- Options:
  - A. KeyState read but ignored: the keyboard layer keeps recording, but `inputToVelocity` is gated behind a "cinematic active" flag that returns zero during the cinematic.
  - B. KeyState not read: the keyboard listener is unsubscribed for the duration of the cinematic.
  - C. Active player does not exist yet: the cinematic plays without an active player, then the player spawns post-fade at 5:00.
- Recommended default: C. Cleanest separation; the cinematic ghosts are the only inhabitants of the 12:00 bucket during the cinematic, and the active player spawns once the fade resolves at 5:00. (Combined with Q-015's "non-recordable" default this is fully consistent.)
- Status: open
- Resolution:

### Q-017: PRNG seed strategy for no-paradox property tests

- Context: REQ-004's property tests need a deterministic PRNG to drive randomized input sequences. The choice is between using a third-party library (which the stack constraint forbids unless approved) and writing a small generator.
- Options:
  - A. A 30-line hand-rolled LCG seeded from the test name (hash the test description string into a 32-bit seed).
  - B. Pull in `seedrandom` or similar.
  - C. Use Math.random with a fixed `Math.random` override for the test duration.
- Recommended default: A. Stack constraints forbid speculative dependencies; a 30-line LCG is sufficient for these tests' randomness needs.
- Status: open
- Resolution:

### Q-018: REQ-037 ship smoke runtime

- Context: REQ-037 is functionally satisfied by the live Vercel deploy at `pseudo-paradox.vercel.app`. The slice's question is whether to add a Playwright smoke to CI or to verify once and document.
- Options:
  - A. Verify once at slice time with a single Playwright run; do NOT add to CI. Vercel's preview deploy already proves the build is shippable.
  - B. Add a recurring smoke to CI. Catches regressions but adds cost to every PR.
- Recommended default: A. The Vercel preview deploy is the de-facto smoke; doubling it in CI is redundant.
- Status: resolved
- Resolution: A (with refinement). Per RULE 3 the slice did NOT add Playwright as a core devDep. Verification at slice time is a manual browser smoke against `pseudo-paradox.vercel.app` documented in `docs/SHIP_VERIFICATION.md` (page load, scene render, console health, WASD movement, lit-portal traversal, hard reset). The automated Playwright smoke is documented as F-008 for the spillover release if it lands.

### Q-019: REQ-039 frame-time threshold reading

- Context: REQ-039 says 60 fps on a 2020-era laptop. 60 fps = 16.67 ms / frame, but a single dropped frame is acceptable jank. The question is whether to assert the mean, the median, or a percentile.
- Options:
  - A. 95th-percentile. A single 30 ms frame is fine; sustained > 16.67 ms 95th-percentile fails.
  - B. Mean. Smoothes over jank but penalizes stable runs with one bad outlier.
  - C. Maximum. Strict; would fail on any single dropped frame.
- Recommended default: A (95th-percentile). Standard performance-engineering reading; matches the player's perception of "feels smooth."
- Status: resolved
- Resolution: A (95th-percentile). `tests/perf/frameTime.test.ts` measures the simulation's per-step CPU time across N=300 steps with 4 active ghosts and asserts the 95th-percentile is under MAX_FRAME_MS = 16.67. Per RULE 3 this is a Vitest in-process REGRESSION GUARD, not a real-browser frame-budget measurement; the latter is documented as F-008.

### Q-020: REQ-040 end-to-end test runtime

- Context: REQ-040 is the single most load-bearing test. The test needs to drive the player through Acts 1 to 3 and assert `ActState === 'escaped'`. The runtime decision is Playwright vs Vitest plus jsdom.
- Options:
  - A. Playwright against the local dev server. Real browser, real WebGL, real Rapier3D WASM, real key events. Slow (several seconds startup) but the only environment that exercises the full stack.
  - B. Vitest plus jsdom plus a Three.js mock plus a Rapier mock. Fast but requires writing two non-trivial mocks; a passing test does not prove the live build works.
- Recommended default: A. The test fires once per CI run; the slowness is acceptable. Mocks would build a parallel system that drifts from production.
- Status: resolved
- Resolution: Neither A nor B as authored; per RULE 3 (no new core deps) the slice did NOT add Playwright (the option-A blocker). The shipped path is "Vitest in-process with REAL Three.js plus REAL Rapier" (no jsdom, no mocks): `tests/sim/endToEndCompletability.test.ts` drives the full Act 1 to escape sequence using the same primitives `src/app.ts` composes (Three.js scene, Rapier world, InputRecorder, GhostInstance, TimelineRegistry, ActStateObserver, mountAct1Cinematic, wireTraversal, applyKnockout/Carry, etc.). This is a strict subset of option B (no mocks) closer in spirit to option A (real modules). The delta from option A is the WebGL canvas plus the host's per-fixed-step loop wiring; that gap is documented as F-008 for the spillover release.

- Context: REQ-012's cinematic has three "actors" at 12:00: two figures dragging a body. The body itself is unconscious and immobile during the drag. The dossier needs a representation that fits the existing ghost pipeline.
- Options:
  - A. A 1-frame `unconscious` ghost in the 12:00 bucket whose recording is `[{ tick: 0, keys: <all-zero KeyState>, timeOfDay: 12/24 }]`. The body is dragged kinematically by the actors using the existing carry attachment.
  - B. A non-ghost body, separately tracked. Adds a parallel render path the rest of the system does not use.
  - C. A real `GhostInstance` with a hand-authored dragged trajectory baked into its recording's velocity track. The actors then do not need to carry it; the body moves on its own per its recording.
- Recommended default: A. Reuses the existing pipeline and matches the ACTUAL gameplay model (the body is unconscious; the actors drag it; the body's trajectory is a deterministic consequence of the actors' carry inputs).
- Status: open
- Resolution:

### Q-022: REQ-024 dependency enforcement model

- Context: REQ-024 says acts cannot be executed out of order. The act-progress observer is monotonic via a watermark, but the question is whether the observer should also REFUSE player actions that would skip a beat (e.g., teleport the player back to 5:00 if they try to enter the North door at 12:00 before reaching the final-knockout watermark) or whether the observer only OBSERVES.
- Options:
  - A. Observer-only: the observer reports the highest reachable state but never refuses player actions. The world is the only enforcement layer (the North door at 12:00 is only lit once the cinematic actors complete; the player physically cannot enter it earlier).
  - B. Hard-fail: the observer refuses transitions that skip a state. Adds a coupling between the observer and the host's input-routing layer.
  - C. Sliding-window: a hybrid where some beats are watermarked and some are window-based.
- Recommended default: A. The world ALREADY enforces beat order via lit/dark gates and the carry-then-drop physical sequence. The observer is a read-only oracle; tests can drive the observer through valid sequences and assert monotonicity, which is sufficient for REQ-024.
- Status: open
- Resolution:

### Q-023: How does the Act 2 second loop's "wait for another instance to wake up" beat resolve under v1's permanent-unconsciousness rule?

- Context: REQ-017 (Act 2 second loop) per `docs/gdd/03-story-acts-1-3.md` says "Drag the body through the East door to 6:00. Wait for another instance to wake up. That instance (You-2) knocks You1 out." Per REQ-033 done, unconsciousness is permanent in v1: the dossier explicitly forbids the unconscious to conscious transition (`docs/gdd/30-combat-and-interaction.md` section 4: "There is no recovery in v1: once unconscious, the capsule stays tilted until pickup or hard reset"). The literal "wait for the body to wake up" beat is therefore mechanically unstageable in one play session. The integration test for REQ-017 needs a substitute reading of the GDD's intent.
- Options:
  - A. Treat "wake up" as the recorded punch tick firing. The GDD beat is not actually about the body waking but about another instance's recorded sequence playing back a punch against You1 at 6:00. Under REQ-001 / REQ-002 the recording substrate gives this for free on the next loop iteration: any future visit to 6:00 replays this very sequence including the punch. The integration test can model the outcome (You1 goes down at 6:00) by directly applying `applyKnockout` to the active player at 6:00, simulating the recorded punch landing. The carry-then-East-traverse data path is exercised end-to-end; only the punch-replay is short-circuited.
  - B. Add a wake-up transition to the prototype. Contradicts REQ-033 done and the dossier's explicit prohibition.
  - C. Defer REQ-017 until a multi-loop integration harness exists that can stage two iterations of the loop in one test. Higher cost; same final state.
- Recommended default: A. Matches the GDD's intent (the load-bearing beat is "You1 goes down at 6:00 from another instance's punch"; the wake mechanic is narrative dressing under v1). The recording substrate of REQ-001 makes the literal version work on the next loop, and the integration test can pin the outcome state directly without modelling the unstaged literal mechanic.
- Status: open
- Resolution:

### Q-011: Carried body's relationship to the carrier's recording

- Context: REQ-034 / REQ-036 ask whether a carried body's trajectory while held is part of the carrier's recording or has its own independent recording.
- Options:
  - A. The carrier's recording captures the pickup and throw inputs; the body's trajectory is a deterministic consequence of those inputs (the body is attached to the carrier during carry, so its position equals the carrier's offset position; on throw it follows ballistic physics from the carrier's pose at the throw tick). On replay, the recorded inputs reproduce the same trajectory because the same pickup and throw events fire at the same ticks.
  - B. The carried body has its own independent input recording channel that captures its translation per tick. On replay, the body's translation is read directly from its channel rather than computed.
- Recommended default: A. Matches Pillar 2 (no paradoxes): the recording IS the cause; the body's trajectory IS the effect. Adding a per-body translation channel duplicates the determinism burden without buying anything beyond what Q-009 already covers.
- Status: open
- Resolution:

## Resolved

### Q-024: Replay style for goal-oriented ghosts (F-013)

- Context: F-013 changes ghost replay from per-tick `KeyState` playback to milestone-driven steering. Open question is whether to replace the input-replay path entirely (pure path-following) or keep it and overlay path-follower as a fallback when the ghost drifts off course.
- Options:
  - A. Pure straight-line steering: ghost beelines to each milestone position. Loses idle / wandering of the original recording but is deterministic and simple. Wall colliders provide obstacle avoidance for free.
  - B. Hybrid: replay original input until drift exceeds a threshold, then path-follow toward the next milestone, then resume input replay once back on schedule. Preserves the visual feel of the original walk.
- Recommended default: B. Hybrid keeps the natural-looking playback when nothing pushes the ghost off course (the common case) while guaranteeing the load-bearing milestones still land when something does.
- Status: resolved
- Resolution: B. Hybrid replay confirmed by user. Drift threshold (default `0.5 m`), path-follower speed (`PLAYER_SPEED_MPS`), and arrival radius (`0.3 m`) ship as tunables in PR3b.

### Q-025: Skip rule for goal-oriented replay (F-013)

- Context: When a ghost falls behind schedule (its current tick has already passed a milestone's recorded tick), should we skip the milestone, wait for the ghost to catch up, or pick a different rule?
- Options:
  - A. Ticks-behind per weight tier. Each milestone has a budget; `wall_bump` budget is `60` ticks (1 s); `door_traversal` budget is `Infinity`. If `currentTick - milestone.tick > BUDGET[milestone.kind]`, skip the milestone (only milestones with `weight < 5` are skippable). Door is sacred.
  - B. Stuck-detector. Track frames-since-distance-decreased; skip if the ghost makes no progress for 90 ticks.
  - C. Both A and B (skip if either fires).
- Recommended default: A. Deterministic and easy to tune. Budgets can be raised per-milestone if a recording is unusually slow.
- Status: resolved
- Resolution: A. Per the user: "if you really get off track maybe you finally get free. Your main goal should be to get through the door." Door is unskippable; lower-weight milestones get a budget and are skipped past it. Tunables `MILESTONE_BUDGET_TICKS` and the default `WALL_BUMP_BUDGET_TICKS = 60` ship in PR3b.

### Q-026: F-014 timeline tick model (continuous absolute clock)

- Context: F-014 is "stale ghosts fast-forward to active player's tick on timeline arrival." Two readings of the user's spec collapse into one canonical model after clarification: each timeline has a continuous absolute tick clock, ghosts have an absolute `startTick` within the timeline, and door destinations are pinned to (timelineId, tick) pairs. Per the user's worked example: a door whose destination is hour-5 tick 200 lands the player at tick 200 of the hour-5 timeline; ghosts whose recordings cover that tick are positioned at their `position(arrivalTick - startTick)`.
- Options:
  - A. Reading B (resume per-timeline). Each timeline has a saved tick-counter that resumes on re-entry. Ghosts continue from where they paused. Smallest change but does not match the user's "if I bump in one time, looping back I see the bump" determinism contract.
  - B. Reading A (fresh start + skip completed milestones). Each visit resets simulation but ghosts spawn at the position of the latest milestone whose recorded tick has "already happened." Hybrid; messy semantics.
  - C. Reading C (continuous global per-timeline wall-clock). Each timeline has an absolute tick coordinate. Ghosts have `startTick`; their alive interval is `[startTick, startTick + recording.length)` minus any `door_traversal` milestone tick. Doors specify `destinationTick` as an authored field. Cleanest match to the GDD narrative.
- Recommended default: C. Required for the user's "loop back to bump" determinism contract under multi-visit scenarios and for door-destination-tick authoring.
- Status: resolved
- Resolution: C. Confirmed by user worked example: "If we add a door that jumps to tick 200 then of course you would start the past instances at 200 (if they didn't walk through the door by that tick)." Implementation lands across PR3c (registry refactor + ghost `startTick` + `Portal.destinationTick` field) and PR3d (game-design pass authoring specific destination ticks per door).

### Q-027: Initial milestone schema (F-013)

- Context: Which player events qualify as milestones during recording? The minimum viable set covers the two events called out in the user's spec; richer sets (carry pickup, throw fire, punch land, room-edge zone passes) can extend later.
- Options:
  - A. `wall_bump` (weight 1) + `door_traversal` (weight 5) only.
  - B. Add `carry_pickup` / `throw_fire` / `punch_landed` (weight 2-3) for richer interactions.
  - C. Add room-edge zone passes (north-half / south-half boundary) as weight-2 milestones for spatial structure.
- Recommended default: A. Matches the user's stated spec literally. Schema is extensible; additions land as PR3b follow-ups if the milestone budget feels under-used.
- Status: resolved
- Resolution: A. `Milestone` discriminated union shipped in PR3a with `kind: 'wall_bump' | 'door_traversal'`, `tick: number`, `position: { x: number; z: number }`, `weight: number`, plus a kind-specific `meta` (wall direction, door direction).

### Q-010: Thought-bubble lookahead window length

- Context: REQ-032 thought bubbles preview upcoming actions. Too short a window and the player has no time to react. Too long and the bubble shows actions far enough out that the player cannot mentally connect the icon to the eventual event.
- Options:
  - A. 30 ticks (0.5 s at 60 Hz). Half a second of preview reads as "about to do this."
  - B. 60 ticks (1.0 s). Full second; safer for reaction but risks losing the connection between icon and event.
  - C. 15 ticks (0.25 s). Quarter-second; tighter but may not give the player enough preview.
- Recommended default: A (30 ticks). Balances reactivity against legibility.
- Status: resolved
- Resolution: A. `DEFAULT_LOOKAHEAD_TICKS = 30` in `src/sim/thoughtBubblePeek.ts` (PR for REQ-032 thought-bubble overlay slice). The 30-tick window is short enough to read as "about to do this," long enough that the predicted forward integration for door detection stays inside the trigger volume's `PORTAL_TRIGGER_DEPTH = 0.6 m` margin under the prototype's player movement speed and damping. Revisit if playtests show the icon does not give enough reaction time.

### Q-001: First requirement file

- Context: which GDD section to draft first as the seed for the coverage ledger.
- Options:
  - A. `01-vision-and-pillars.md` (the abstract framing).
  - B. The first concrete user-visible feature.
  - C. The data model / persistence layer.
- Recommended default: A. The pillars file is short, drives every subsequent decision, and unblocks the rest.
- Status: resolved
- Resolution: drafted A and four additional foundational sections in the same pass: `01-vision-and-pillars.md`, `02-time-travel-rules.md`, `03-story-acts-1-3.md`, `23-prototype-scope.md`, and `99-out-of-scope.md`. Coverage rows REQ-001 through REQ-040 in `docs/GDD_COVERAGE.json` reference these five files.
