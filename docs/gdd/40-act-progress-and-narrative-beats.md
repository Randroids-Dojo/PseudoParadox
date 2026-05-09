# Act Progress and Narrative Beats

**Status:** not_started

The act-progress observer plus the Acts 1-3 narrative beats are the load-bearing layer that turns the time-travel substrate plus the combat surface into a finishable level. Without it the prototype's success criterion ("the prototype is complete when the player can finish Act 3," `docs/gdd/03-story-acts-1-3.md`) cannot be evaluated. This dossier covers the data structure that watches world state for beat completion, the per-beat predicates, the cinematic actor wiring at 12:00, the ship-gate / perf / completability tests, and the regression flips for the five partials still on the ledger.

## 1. Scope

This section is the canonical spec for the not_started rows still on the GDD coverage ledger as of 2026-05-09:

- REQ-004 no-paradox invariant (property assertions across the recording / replay surface).
- REQ-012 Act 1 cinematic at 12:00 (two scripted figures drag a knocked-out body through the North door to the center, fade to black).
- REQ-016 Act 2 first loop (East then West produces a You-1 instance that replays You1's path West).
- REQ-017 Act 2 second loop (knock out You-1 on return to 5:00, drag East to 6:00, You-2 wakes and knocks out You1).
- REQ-018 Act 3 setup (repeat Act 2 to position a knocked-out instance at 6:00; wait for the other instance to wake).
- REQ-019 Act 3 chase beat (running toward the West door while another instance chases pulls both through to 5:00 simultaneously).
- REQ-020 Act 3 team-up beat (two instances at 5:00 coordinate to knock out the 5:00 instance).
- REQ-021 Act 3 mirror beat (drag the knocked-out instance South to 12:00 and place in the center).
- REQ-022 Act 3 second knockout (knock out the instance brought from 6:00 inside the 12:00 timeline).
- REQ-023 Act 3 escape (North door at 12:00 opens with no replay-instance present; running through completes the level).
- REQ-024 beat dependency enforcement (acts cannot be executed out of order; Act 3 requires Act 2 timeline state).
- REQ-028 lit-versus-dark visual state reflects portal availability (visual confirmation pass).
- REQ-037 demo deploys to web (smoke verification of the live Vercel build).
- REQ-038 loads in under 10 seconds on broadband (perf measurement gate).
- REQ-039 runs at 60fps on a 2020-era laptop (perf measurement gate).
- REQ-040 supports full Act 1 to Act 3 without crashes or desync (end-to-end completability test).

Polish pass on the five partials still on the ledger:

- REQ-005 portal fixity (property assertion that `Portal.destinationHours` is readonly across a long simulation).
- REQ-010 dark portal exit semantics (regression that the player capsule cannot enter a dark portal, complementing PR #18 / PR #21).
- REQ-026 player keyboard (regression that WASD plus arrows both produce velocity at the spawn pose).
- REQ-027 four doors render (regression that four Door meshes exist post-construction).
- REQ-030 instance origin tint (regression that a ghost's mesh material color matches `interpolateWarmToCool(ghost.originNormalized)` to within tolerance).

Out of scope for this section (and out of scope for v1 in `docs/gdd/99-out-of-scope.md`):

- Multiplayer.
- Decades-scale narrative or any beat outside Acts 1-3.
- Multiple rooms or multiple levels.
- AI-attribute tracking per instance (anger, energy, strength).
- Portal variability (destinations that change after thresholds).
- Per-beat tutorial text or help overlays. The dossier section 2 below explains why: Pillar 3 (sci-fi diegetic feel) forbids non-diegetic UI beyond the floor ring (REQ-031) and the thought-bubble overlay (REQ-032), and the narrative beats teach themselves through the room and the player's own actions.

## 2. Pillar alignment

Each design decision below cross-references `docs/gdd/01-vision-and-pillars.md`.

- **Pillar 1 (interaction with multiple selves).** The narrative beats ARE the interaction-with-multiple-selves system at scale. REQ-016 to REQ-023 are the prototype's full proof of Pillar 1: every beat is a player choreographing two or more selves across one shared room. The act-progress observer exists to make those interactions legible to the system without intruding into the player's experience.
- **Pillar 2 (no paradoxes, ever).** REQ-004 is the load-bearing property gate for Pillar 2. Translated to testable invariants: input recordings are immutable post-snapshot, ghost behavior at tick K does not depend on input made after tick K, and timeline registry entries do not lose ghosts during the simulation lifecycle (only `hardReset` clears them). The observer itself is also pure (snapshot-in, ActState-out) so reading it cannot induce a paradox by side effect.
- **Pillar 3 (sci-fi diegetic feel).** The act-progress observer is a HEADLESS data structure. It writes nothing to the player's screen; the world remains the only narrative surface. The cinematic at 12:00 (REQ-012) reuses the existing `InputRecorder` plus `GhostInstance` machinery (a recorded ghost IS an actor playing a script) so the cinematic is built from the same substrate the player drives. No new render path is added for narrative content.
- **Pillar 4 (logical puzzles).** Beat completion conditions are pure consequences of "what would actually happen" given the recorded inputs and the timeline state. No artificial state machine drives a beat to completion: the player drags a body to a position, and the predicate over `instances.position` plus `instances.knockoutState` plus `currentTimeline` reads true. Pillar 4 is preserved by construction.

## 3. Act-progress observer (the central data structure)

### 3.1 ActState machine

```ts
type ActState =
  | "not-started"
  | "act-1-spawn"
  | "act-2-loop-1"
  | "act-2-loop-2"
  | "act-3-setup"
  | "act-3-chase"
  | "act-3-team-up"
  | "act-3-mirror"
  | "act-3-final-knockout"
  | "escaped";
```

Order is significant. The observer is monotonic: a transition from `S_i` to `S_j` is allowed iff every state on the path from `S_i` to `S_j` has had its beat predicate read true at some point during the current simulation lifetime. `hardReset` returns the observer to `not-started`. Implementation is a single integer index plus a "highest-index-ever-reached" watermark, which is the simplest representation that supports REQ-024's monotonicity contract.

### 3.2 Pure function shape

```ts
interface ActStateSnapshot {
  registry: TimelineRegistry;
  instances: ReadonlyArray<InstanceSnapshot>;
  bodies: { inFlight: ReadonlyArray<BodyHandle> };
  currentTimeline: TimelineId;
  activePlayer: { instanceId: InstanceId; carrying: CarryState };
  watermark: ActState;
}

function evaluateActState(snapshot: ActStateSnapshot): ActState;
```

The observer reads world state every fixed simulation tick (NOT every render frame, so the result is deterministic and replays match recordings). `evaluateActState` is pure: the same snapshot always returns the same ActState. The host (`src/app.ts`) caches the previous result and only logs / surfaces a transition when the value changes. The result is otherwise invisible to the player; the only player-facing consequence of `state === 'escaped'` is the same fade-to-black overlay used by the Act 1 cinematic.

### 3.3 Snapshot shape

The snapshot is a thin read-only view over the existing systems. No new state lives in the observer:

- `registry` is the existing `TimelineRegistry` from `src/sim/timelineRegistry.ts`.
- `instances` is the active player handle plus every active-timeline ghost flattened to a uniform `InstanceSnapshot` (`{ id, position, consciousness, carrying, recording, tickIndex, originNormalized }`). Inactive-timeline ghosts are NOT included; the observer only sees what is actively playing.
- `bodies.inFlight` is the existing in-flight registry from `src/sim/bodyTraversal.ts`.
- `currentTimeline` mirrors `registry.activeTimeline`.
- `activePlayer` is the existing player handle's relevant fields.
- `watermark` is the highest ActState reached so far; persisted on the host's observer instance, NOT inside the snapshot, but threaded through the call so `evaluateActState` is pure.

### 3.4 Beat completion as composed predicates

Each beat is a single pure predicate `(snapshot) => boolean`. Beats compose: `evaluateActState` walks the linear ActState chain in order, returning the first state whose predicate fails (i.e. the highest state whose predicate succeeds). The watermark guarantees regression is impossible: once `act-2-loop-2` has been reached, even if its predicate later reads false (e.g., the player walks away from 6:00), the observer reports at least `act-2-loop-2` until `hardReset` clears the watermark.

### 3.5 Why a watermark instead of a sliding window

A sliding window would say "I am at `act-3-chase` only while the chase is currently happening." That fails Pillar 4 because Act 3's mirror beat depends on the chase having occurred earlier; the player walking away from the chase does not undo the chase. The watermark matches the GDD's "timelines are written by action" framing: the world remembers what happened, and so does the observer.

## 4. Beat predicates (REQ-016 through REQ-023, plus REQ-012)

Each predicate is a pure function over the snapshot. Predicates are written as pseudocode below; the implementation slice transcribes them into TypeScript with full unit coverage. Constants (door cardinals, threshold distances) reuse the values already in `src/sim/portal.ts`, `src/scene/door.ts`, and `src/sim/portalTrigger.ts`.

### REQ-012 (Act 1 cinematic at 12:00)

```text
beatAct1Cinematic(snapshot):
  // The cinematic is a one-shot at game start; once the player has spawned
  // at 5:00, the cinematic has already been "satisfied." The observer
  // therefore reads the cinematic as complete the first tick the player is
  // at the 5:00 timeline AT or AFTER the scripted-actor recordings have
  // been mounted into the 12:00 bucket as ghosts.
  return snapshot.registry.ghostsFor(12).length >= 3
      && snapshot.currentTimeline === 5;
```

The "3 ghosts in the 12:00 bucket" is the two scripted actors plus the knocked-out body (see section 5 for the actor scripting). The first tick of `act-1-spawn` IS the first tick the cinematic predicate succeeds.

### REQ-016 (Act 2 first loop)

```text
beatAct2Loop1(snapshot):
  // The player has walked East from 5:00 to 6:00 and West back to 5:00,
  // so the 5:00 bucket now holds You1's recording (the East-bound walk)
  // and the 6:00 bucket holds the You-going-West-back recording. On
  // re-entry to 5:00 the You-1 ghost replays You1's path West.
  return snapshot.registry.activeTimeline === 5
      && snapshot.registry.ghostsFor(5).length >= 1
      && snapshot.registry.ghostsFor(6).length >= 1
      && allGhostsAtRest(snapshot.registry.ghostsFor(5));
```

`allGhostsAtRest` is true when every ghost in the bucket has either reached the West portal trigger (verified by the recording's last frame) or has finished its recording (`ghost.tickIndex >= ghost.recording.length`). This is the "and disappears" half of REQ-016: the observer waits for the ghost's recording to resolve before transitioning.

### REQ-017 (Act 2 second loop)

```text
beatAct2Loop2(snapshot):
  // On return to 5:00 the You-1 ghost is in `unconscious` consciousness;
  // a body was carried East via the East portal trigger (the in-flight
  // registry saw a body traverse East at lit-portal `enter`); and the
  // active player's `act-2-loop-2 evidence` watermark records that the
  // active lifetime ended at 6:00 in `unconscious`. The latter is a
  // snapshot-level signal: the active player is currently at 6:00 and
  // unconscious, with at least two ghosts in the 5:00 bucket and one
  // body in the 6:00 bucket.
  return snapshot.currentTimeline === 6
      && snapshot.activePlayer.consciousness === 'unconscious'
      && snapshot.registry.ghostsFor(5).some(g => g.consciousness === 'unconscious')
      && snapshot.registry.ghostsFor(6).length >= 1;
```

Detection of "the body was dragged East" uses the same in-flight-registry traversal hook the throw mechanic ships (REQ-036): a body crossing the East portal trigger as a carried-then-released body fires the same lit-portal `enter` event the observer keys on. (Note: F-007 is a known followup to fully rehome a thrown / carried body across timelines; the predicate above only requires the destination bucket to non-empty, which the in-flight teleport already satisfies.)

### REQ-018 (Act 3 setup)

```text
beatAct3Setup(snapshot):
  // Same shape as Act 2 loop 2, but the player has now repeated the
  // sequence and is back AT 5:00 waiting (i.e. has hard-reset OR
  // continued through; the GDD uses 'fade out' / 'fade in' as the act
  // boundary). The observer reads Act 3 setup as: the watermark has
  // already passed `act-2-loop-2` AND the player is now AT 5:00 AND
  // there is at least one unconscious ghost in 6:00.
  return snapshot.watermark >= 'act-2-loop-2'
      && snapshot.currentTimeline === 5
      && snapshot.registry.ghostsFor(6).some(g => g.consciousness === 'unconscious');
```

### REQ-019 (Act 3 chase beat)

```text
beatAct3Chase(snapshot):
  // Two instances simultaneously cross the West portal trigger at 5:00.
  // Detection uses the trigger set's tick-aligned events: in a single
  // simulation tick, two distinct instances (the active player and a
  // ghost) fire `enter` against the West portal. The observer keeps a
  // small ring buffer of the last 4 simulation ticks of trigger events
  // and asks: did two distinct instance ids both enter West in the
  // same tick OR within a 2-tick window?
  return snapshot.recentWestEntries.distinctInstanceIds(window=2) >= 2
      && snapshot.currentTimeline === 5;
```

The `recentWestEntries` channel is a small append-only buffer the observer keeps from the existing `PortalTriggerSet.onPortalOverlap` callback. This is the only state the observer owns beyond the watermark; it is reset by `hardReset`.

### REQ-020 (Act 3 team-up beat)

```text
beatAct3TeamUp(snapshot):
  // Two instances at 5:00 coordinate to knock out the 5:00 instance.
  // Concretely: the 5:00 active-timeline ghosts now contain at least
  // one in `unconscious` consciousness whose origin timeline is also 5
  // (i.e. the instance that lived at 5:00 was the one knocked out).
  return snapshot.currentTimeline === 5
      && snapshot.registry.ghostsFor(5).some(g =>
           g.consciousness === 'unconscious'
           && timelineIdFromNormalized(g.originNormalized) === 5);
```

### REQ-021 (Act 3 mirror beat)

```text
beatAct3Mirror(snapshot):
  // The player has dragged the knocked-out 5:00 instance South to 12:00
  // and placed the body in the center of the room. The observer reads:
  // the active player is currently at 12:00, with carry state `idle`
  // (just dropped), and there is an unconscious body in the 12:00 bucket
  // within DROP_CENTER_RADIUS_M of the room origin.
  return snapshot.currentTimeline === 12
      && snapshot.activePlayer.carry.kind === 'idle'
      && snapshot.registry.ghostsFor(12).some(g =>
           g.consciousness === 'unconscious'
           && planarDistance(g.body.translation(), { x: 0, z: 0 }) <= DROP_CENTER_RADIUS_M);
```

`DROP_CENTER_RADIUS_M` defaults to 1.0m (Q-014; recommended default). Tight enough that "dropped near a wall" does not satisfy the predicate, loose enough that the player does not need to drop the body at exactly the origin.

### REQ-022 (Act 3 second knockout)

```text
beatAct3FinalKnockout(snapshot):
  // The player knocks out the instance brought from 6:00 inside the 12:00
  // timeline. The observer reads: at 12:00 there are now TWO unconscious
  // bodies, one with origin 5 (mirror beat) and one with origin 6 (the
  // 6:00 instance, just knocked out).
  return snapshot.currentTimeline === 12
      && snapshot.registry.ghostsFor(12).filter(g => g.consciousness === 'unconscious').length >= 2;
```

### REQ-023 (Act 3 escape)

```text
beatAct3Escape(snapshot):
  // The North door at 12:00 is "open" iff no replay-instance is currently
  // staffing the cinematic (i.e. the cinematic actors have completed
  // their recordings). With two scripted actors PLUS the knocked-out body
  // at 12:00 and the player having reached the final knockout watermark,
  // the player crossing the North trigger at 12:00 transitions to
  // `escaped`. The arrivals-rule body for the North door at 12:00 reads:
  // the door is dark while ANY scripted-actor ghost is mid-recording, lit
  // once they have all completed.
  return snapshot.currentTimeline === 12
      && snapshot.activePlayer.position.crossedNorthTriggerSinceWatermark
      && snapshot.watermark >= 'act-3-final-knockout'
      && allCinematicActorsCompleted(snapshot.registry.ghostsFor(12));
```

This is the one beat that requires authoring a non-trivial `BlockedByArrivals` body for the litStateForTimeline seam (PR #21's stub, F-006 followup): the North door at 12:00 should be visually dark while the cinematic actors are in flight, and visually lit once they are done. The arrivals body returns `true` (block) for North-at-12 while any scripted-actor ghost has `tickIndex < recording.length`.

## 5. Cinematic actors for REQ-012

### 5.1 Approach: pre-recorded actor data files

Two scripted actor instances at 12:00 drag a knocked-out body through the North door to the center, then the screen fades to black. The cleanest way to ship this is to express the scripted actors as PRE-RECORDED `InputRecording` data files plus the knocked-out body's seed pose, plus the timing of the fade-to-black.

A scripted actor IS exactly a ghost with a hand-authored recording: `GhostInstance` already replays an `InputRecording` tick-for-tick from a spawn position with whatever consciousness state the host writes. The cinematic uses three ghosts in the 12:00 timeline bucket:

1. Actor A (left-side dragger): `originNormalized = 12 / 24`; recording walks from a spawn pose just inside the North door to the center of the room, with carry state `'carrying'` for the duration of the walk.
2. Actor B (right-side dragger): mirror of Actor A on the other side of the body.
3. Body: an `unconscious` ghost with a near-empty recording (length 1; the recorded velocity is zero). The body is `dynamic` like any other unconscious capsule; it does not own a recording in the gameplay sense, but pre-recording it as a 1-frame ghost lets it ride the same per-timeline registry path the rest of the system uses.

The recordings are TypeScript data files exporting frozen `InputRecording` literals, mounted into the 12:00 bucket at game boot via a one-shot host hook. They are the ONLY ghosts in the 12:00 bucket the player did not produce.

### 5.2 Why not a separate "scripted-actor" system

A standalone scripted-actor type would:

- Add a parallel render path the rest of the system does not use (separate mesh, separate body, separate hide/show pass on timeline switch).
- Not benefit from the existing `TimelineRegistry` reset-on-re-entry semantics; a player visiting 12:00 a second time would need a separate "re-play the cinematic" hook.
- Duplicate the per-tick velocity-write path the ghost replay already owns.

Reusing the recorded-ghost machinery is strictly cheaper. The cost is one design constraint: the actor recordings are authored as `KeyState` sequences plus carry-state flags, so future tweaks to the cinematic require regenerating the recording files. The dossier accepts this constraint; the cinematic is a one-shot beat and the recordings are short.

### 5.3 File location and format

Recordings live under `src/sim/scripts/`:

- `src/sim/scripts/act1Cinematic.ts` exports `ACT1_LEFT_DRAGGER_RECORDING`, `ACT1_RIGHT_DRAGGER_RECORDING`, and `ACT1_KNOCKOUT_BODY_RECORDING` as frozen `InputRecording` objects, plus the spawn poses (`ACT1_LEFT_DRAGGER_SPAWN`, etc.) and the fade timing constants (`ACT1_CINEMATIC_FADE_START_TICK`, `ACT1_CINEMATIC_FADE_DURATION_TICKS`).
- The host (`src/app.ts`) calls a one-shot `mountAct1Cinematic({ registry, scene, world })` at boot which builds three `GhostInstance` objects via `createGhost(...)` and files them into the 12:00 bucket.

The format is a hand-authored `KeyState` array, generated either by hand-tweaking constants (drag duration in ticks, drag velocity in m/s) or by recording a real player run once and freezing the result. The dossier defaults to hand-tweaked constants because the cinematic is short (~ 4 seconds at 60 Hz = 240 ticks) and the trajectory is simple.

### 5.4 Fade-to-black

Q-013 (recommended default below): the fade is a Three.js full-screen plane in front of the camera, opacity ramped from 0 to 1 over `ACT1_CINEMATIC_FADE_DURATION_TICKS` ticks starting at `ACT1_CINEMATIC_FADE_START_TICK`, then ramped back to 0 once the player has spawned at 5:00. The plane is added to a separate `THREE.OrthographicCamera` overlay so it sits on top of the world geometry without depth-fighting. CSS would also work; the Three.js plane is preferred because it co-locates the fade with the existing render pass and does not require touching `index.html`.

### 5.5 Recording the player at 12:00 during the cinematic

Q-015 (recommended default below): the player's actions during the cinematic are NOT recordable. The active player is in a "cinematic" state where input is blocked (Q-016 default: KeyState is read but ignored for the duration of the cinematic) and no `InputRecorder` is open. After the fade-to-black resolves, the active player teleports to the 5:00 spawn pose and a fresh recorder opens at the Act 1 anchor. This makes the cinematic non-recordable and avoids the player accidentally creating a ghost in the 12:00 bucket that conflicts with the scripted actors.

## 6. REQ-028 visual lit/dark verification

REQ-028 is the visual half of REQ-011 (which is `done`). The visual paint path in `src/sim/timelineRoom.ts` (`repaintDoorsForHour`) and in `src/scene/room.ts` (build-time paint) both call `doorLitStateAtHour(hour)` directly today. F-006 captures the eventual unification of paint and gate through `litStateForTimeline`. REQ-028's "fully done" criterion is a regression test that asserts at runtime that the door visuals match the lit/dark predicate at every reachable hour (5, 6, 12).

The slice ships:

1. A regression test that walks the four cardinals at hours 5, 6, 12 and asserts each Door's `applyDoorLitState` was called with the value that `litStateForTimeline(hour, { ghosts: [] })` returns. (Empty ghost list is the default; the cinematic-actor body will need a separate test once REQ-012 lands.)
2. A small visual smoke that opens the dev server and reads each door's mesh material `emissive` value, asserting lit > 0 and dark === 0.
3. The slice does NOT unify the paint path through `litStateForTimeline` (F-006 stays open); it only verifies the current paint matches the gate.

The slice flips REQ-028 from `not_started` to `done` once the regression test is green.

## 7. REQ-004 no-paradox property tests

REQ-004 is the load-bearing assertion for Pillar 2. Translated to testable invariants:

1. **InputRecordings are immutable post-snapshot.** `InputRecorder.snapshot()` returns a deeply frozen recording. The test asserts that any attempt to mutate the returned object (`recording.frames.push(...)`, `recording.frames[0].keys.up = true`, etc.) throws or is silently rejected.
2. **Timeline registry entries do not lose ghosts during the simulation lifecycle.** The test runs a 1000-tick simulation that traverses portals randomly (per Q-017 PRNG seed) and asserts that the total number of ghosts across all buckets is monotonically non-decreasing except across `hardReset`. After `hardReset` the count is zero.
3. **A ghost's recorded behavior at tick K does not depend on any input made AFTER tick K.** The test snapshots a recording at tick K, then continues recording for additional ticks, then asserts `ghost.advanceTick()` from a fresh ghost built from the K-tick snapshot produces identical body translations to the original ghost.
4. **`Portal.destinationHours` is readonly across a 1000-tick simulation.** A property test that builds a portal, runs 1000 ticks of a randomized simulation, and asserts the portal's `destinationHours` value is unchanged. (This also satisfies REQ-005's polish flip.)

Each invariant is implemented as a property-style test using a small hand-rolled fuzz generator (NOT a third-party library, per Rule 3 stack constraints). The generator is a 30-line LCG seeded from the test name, producing a deterministic input sequence per test run. The test asserts the invariant across at least 100 randomized sequences.

The slice flips REQ-004 from `not_started` to `done`.

## 8. REQ-037 ship gate

`pseudo-paradox.vercel.app` is live (the project deploys via Vercel from `main`). REQ-037's "demo deploys to web" criterion is functionally satisfied; the slice is a verification checklist:

1. Confirm the build artifact (`npm run build`) produces a `dist/` directory.
2. Open `https://pseudo-paradox.vercel.app/` in a browser and confirm: the page loads, the canvas renders the 10x10 room, no JavaScript errors fire in the console.
3. Document the verification as a build log entry on this section.

Q-018 default (recommended below): a single Playwright smoke test that hits the live URL, waits for the canvas to mount, and asserts no console errors. This is run once at slice time as evidence; it is NOT added to the standard CI pipeline because Vercel's preview deploy already proves the build is shippable.

The slice flips REQ-037 from `not_started` to `done`.

## 9. REQ-038 / REQ-039 perf gates

### 9.1 REQ-038 (load time)

Acceptance: under 10 seconds on a 5 Mbps broadband profile.

The slice ships two small probes:

- A bundle-size assertion in `tests/perf/bundleSize.test.ts` that reads `dist/` and asserts the total JS payload is below `MAX_BUNDLE_BYTES`. Default `MAX_BUNDLE_BYTES = 5_000_000` (5 MB; at 5 Mbps that downloads in ~8s, leaving headroom for the WASM init).
- A Lighthouse CLI run against the live deploy producing a `time-to-interactive` reading. Logged to the build log; not asserted in CI because Lighthouse is environment-sensitive.

### 9.2 REQ-039 (60fps)

Acceptance: 60 fps = 16.67 ms/frame, sustained over a 5-second sample with 4 ghosts ticking simultaneously.

The slice ships:

- A headless render-loop probe in `tests/perf/frameTime.test.ts` that builds a Rapier world, spawns 4 ghosts running 200-tick recordings, runs 300 fixed steps (5 seconds at 60 Hz), and asserts the 95th-percentile per-step CPU time is below `MAX_FRAME_MS = 16.67`. The probe does NOT measure GPU time (the test runs in a headless harness without a real renderer), but the CPU budget is the typical bottleneck for the prototype's complexity.
- A documented manual frame-time check on the live deploy (open the Performance tab in Chrome DevTools, sample 5 seconds, log the 95th-percentile). Logged to the build log.

Q-019 (recommended default below): the 95th-percentile threshold is the right gate (NOT mean): a single 30 ms frame is acceptable jank, but a sustained > 16.67 ms 95th-percentile fails the criterion.

The slice flips REQ-038 and REQ-039 from `not_started` to `done`.

## 10. REQ-040 end-to-end completability

The single most load-bearing test in the prototype. A scripted Playwright (Q-020 default below) test that:

1. Opens the live build (or a local dev server on port 5173).
2. Drives the player through Acts 1 to 3 by replaying a hand-authored sequence of `keydown` / `keyup` events with sleep gaps tuned to the fixed timestep.
3. Polls the act-progress observer's `ActState` (exposed via a debug-only `window.__pseudoParadoxActState` hook gated on a build-time flag) until it reads `'escaped'`.
4. Asserts `ActState === 'escaped'` within `MAX_TEST_DURATION_MS = 60_000`.

The test is the integration validator for every prior beat slice: if any beat predicate is wrong, the test fails to advance past that beat. A failing E2E run also surfaces timeline desync (REQ-040's other half: "no crashes or timeline desync"); a desync would manifest as the observer never reaching `'escaped'`.

The slice flips REQ-040 from `not_started` to `done`.

## 11. The five partials

Each is a single-PR slice, mostly tests. They land in one PR per slice plan section 12 below.

- **REQ-005 (portal fixity).** A property test asserting `Portal.destinationHours` is readonly across 1000 ticks. Combines with REQ-004's invariant 4 (above). Flips from `partial` to `done`.
- **REQ-010 (dark portal exit semantics).** A regression test that simulates the player walking into a dark portal trigger (the West door at 5:00) and asserts the active player's translation is unchanged after the trigger fires. Combines with `tests/sim/portalTraversal.test.ts > dark portal does not teleport`. Flips from `partial` to `done`.
- **REQ-026 (player keyboard).** A regression test asserting WASD plus arrow keys both produce the same `inputToVelocity` result, and the spawn pose at game start matches `(0, 0)` plus the capsule resting Y. Flips from `partial` to `done`.
- **REQ-027 (four doors render).** A rendering test that builds the room and asserts `room.group` contains exactly four Door meshes (one per cardinal). Flips from `partial` to `done`.
- **REQ-030 (instance origin tint).** A regression test that builds a ghost with `originNormalized = 0.5` and asserts `ghost.mesh.material.color.equals(interpolateWarmToCool(0.5))` to within `1e-6`. Flips from `partial` to `done`.

These can ship in a single tests-mostly PR.

## 12. Implementation order

Slices land in this order. Each is a separate PR; the implementor mode picks them up next iteration. The dot list below mirrors this order.

1. **ActState observer plus all beat predicates as pure functions.** The data structure plus every predicate, fully unit-tested in isolation. No host wiring yet (the observer is exposed but not yet read by `src/app.ts`); this slice unblocks every later beat slice. (REQ-024 partial.)
2. **Five-partials regression bundle.** REQ-005, REQ-010, REQ-026, REQ-027, REQ-030 in one PR. Mostly tests; small amount of plumbing if any partial reveals a real gap.
3. **REQ-028 visual lit/dark verification.** Regression test plus, if needed, a small visual fix.
4. **REQ-004 no-paradox property tests.** The four invariants from section 7. Mostly tests; flips REQ-004 to done.
5. **REQ-012 Act 1 cinematic via scripted actor recordings.** New module `src/sim/scripts/act1Cinematic.ts`, a host hook `mountAct1Cinematic`, and the fade-to-black overlay. Flips REQ-012 to done.
6. **REQ-016 Act 2 first loop.** Wires the observer's `act-2-loop-1` predicate into the host loop and adds an integration test that drives a recorded East-then-West sequence and asserts the observer reaches `act-2-loop-1`. Flips REQ-016 to done.
7. **REQ-017 Act 2 second loop.** Wires `act-2-loop-2`. Flips REQ-017 to done.
8. **REQ-018 Act 3 setup.** Wires `act-3-setup`. Flips REQ-018 to done.
9. **REQ-019 Act 3 chase beat.** Wires `act-3-chase` plus the `recentWestEntries` ring buffer. Flips REQ-019 to done.
10. **REQ-020 Act 3 team-up beat.** Wires `act-3-team-up`. Flips REQ-020 to done.
11. **REQ-021 Act 3 mirror beat.** Wires `act-3-mirror`. Flips REQ-021 to done.
12. **REQ-022 Act 3 second knockout.** Wires `act-3-final-knockout`. Flips REQ-022 to done.
13. **REQ-023 Act 3 escape plus REQ-024 dependency monotonicity.** Wires `escaped` plus the watermark monotonicity contract. Authors the North-at-12 arrivals-rule body in `litStateForTimeline`. Flips REQ-023 and REQ-024 to done.
14. **REQ-040 end-to-end completability plus REQ-037 ship smoke plus REQ-038 / REQ-039 perf gates.** The completability test is the biggest gate; the ship smoke and perf probes ride along because they also exercise the live build. Flips REQ-037, REQ-038, REQ-039, REQ-040 to done.

## 13. Open questions

The spec above resolves to a recommended default for every non-obvious decision. The implementor ships under those defaults. The corresponding `Q-NNN` entries land in `docs/OPEN_QUESTIONS.md` so a future override is one edit away.

- Q-012: where do scripted Act-1-cinematic recordings live? Default: `src/sim/scripts/`.
- Q-013: how is the fade-to-black achieved? Default: a Three.js full-screen plane on a separate orthographic camera.
- Q-014: drop-center radius for the Act 3 mirror beat predicate. Default: 1.0 m.
- Q-015: are the player's actions during the Act 1 cinematic recordable? Default: no.
- Q-016: input handling during the Act 1 cinematic. Default: KeyState read but ignored.
- Q-017: PRNG seed strategy for the no-paradox property tests. Default: a 30-line LCG seeded from the test name.
- Q-018: REQ-037 smoke runtime. Default: a single Playwright smoke run once at slice time, NOT added to CI.
- Q-019: REQ-039 frame-time threshold reading. Default: 95th-percentile.
- Q-020: REQ-040 E2E test runtime. Default: Playwright against the local dev server.
- Q-021: how does Act 1's cinematic record the knocked-out body? Default: a 1-frame `unconscious` ghost in the 12:00 bucket.
- Q-022: REQ-024 enforcement model. Default: observer-only (the watermark is purely informational; the host does not refuse player actions out of order, but the observer reports the highest reachable state).

### Build log

- 2026-05-09: five-partials regression bundle lands (REQ-005, REQ-010, REQ-026, REQ-027, REQ-030 done; section 11 dossier slice). Tests-only slice; the implementations were already in place from prior PRs and the partials were waiting on focused regression coverage. `tests/sim/portal.test.ts` gains a 1000-tick property test that exercises portal destination fixity by attempting frozen-field mutations under a hand-rolled LCG seeded from the test name (Q-017 default). `tests/sim/portalTraversal.test.ts` gains a regression that places the player inside the West dark portal trigger volume at 5:00 (the canonical case from `ACT_ONE_PORTAL_SPECS`) and asserts the player's body translation is unchanged after the trigger fires. `tests/input/keyboard.test.ts` gains a fake-window dispatcher harness plus two regressions that drive both WASD and arrow-key bindings through `createKeyboardState` and assert each cardinal produces the same `inputToVelocity` result. `tests/scene/player.test.ts` gains a spawn pose regression that asserts the player capsule's body translation at construction is `(0, 0, restY)`. `tests/scene/room.test.ts` gains a four-door render regression that filters `room.group.children` on the `door-` mesh-name prefix and asserts exactly four meshes exist with the directions north / south / east / west. `tests/sim/ghostInstance.test.ts` gains a tint regression that builds a ghost with `originNormalized = 0.5` and asserts each color channel of the mesh material is within `1e-6` of `interpolateWarmToCool(0.5)`. NO production code touched. Files: `tests/sim/portal.test.ts`, `tests/sim/portalTraversal.test.ts`, `tests/input/keyboard.test.ts`, `tests/scene/player.test.ts`, `tests/scene/room.test.ts`, `tests/sim/ghostInstance.test.ts`, `docs/gdd/02-time-travel-rules.md`, `docs/gdd/23-prototype-scope.md`, `docs/gdd/40-act-progress-and-narrative-beats.md`, `docs/PROGRESS_LOG.md`, `docs/GDD_COVERAGE.json`. PR pending.
- 2026-05-09: ActState observer plus per-beat pure predicates land (REQ-024 partial). New module `src/sim/actState.ts` exports the `ActState` chain (`'not-started'` through `'escaped'`), the `ACT_STATE_CHAIN` ordered list, the `ActStateSnapshot` data model (registry projection, instances, current timeline, active player, recent-West-entries ring buffer, North-trigger-crossed boolean), the per-beat predicates (`isAct1Spawn`, `isAct2Loop1`, `isAct2Loop2`, `isAct3Setup`, `isAct3Chase`, `isAct3TeamUp`, `isAct3Mirror`, `isAct3FinalKnockout`, `isEscaped`), the pure entry point `evaluateActState(snapshot, watermark?)`, the constants `DROP_CENTER_RADIUS_M = 1.0` (Q-014 default), `CHASE_WINDOW_TICKS = 2`, `RECENT_WEST_ENTRIES_CAPACITY = 4`, the helpers `actStateIndex`, `maxActState`, `planarDistance`, the `ActStateObserver` interface, and the `createActStateObserver()` factory. The observer owns the watermark plus the West-entries ring buffer; `update(snapshot)` walks the chain from highest to lowest, returns the highest passing beat floored by the watermark, and never regresses. `recordWestEntry(entry)` appends to the ring buffer with a capacity cap. `hardReset()` returns the watermark to `'not-started'` and clears the buffer. NO host wiring this slice: the per-beat slices wire each predicate to a host signal in turn. Q-022 default consumed (observer-only enforcement). 48 new unit cases in `tests/sim/actState.test.ts` cover every predicate (positive plus at least one negative each), the chain shape, the constants, `evaluateActState` priority and watermark flooring, terminal-state preservation for `'escaped'`, ring-buffer cap, and an end-to-end valid-sequence walk. Section's `Status:` stays `not_started` until REQ-016 (first beat wiring) ships. Files: `src/sim/actState.ts`, `tests/sim/actState.test.ts`, `docs/gdd/40-act-progress-and-narrative-beats.md`, `docs/gdd/03-story-acts-1-3.md`, `docs/PROGRESS_LOG.md`, `docs/GDD_COVERAGE.json`. PR pending.
- 2026-05-09: research-only iteration (no production code). Authored this section file as the canonical spec for the sixteen `not_started` rows on the GDD coverage ledger plus a polish pass on the five remaining partials. Opened Q-012 through Q-022 in `docs/OPEN_QUESTIONS.md` (eleven new questions). Created fourteen `implement:` dots matching the slice plan in section 12. Section's `Status:` stays `not_started` until the first beat slice ships. Files: `docs/gdd/40-act-progress-and-narrative-beats.md`, `docs/OPEN_QUESTIONS.md`, `docs/PROGRESS_LOG.md`, `.dots/PseudoParadox-implement-*.md`. PR #29.
