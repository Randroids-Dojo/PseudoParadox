# Implementation Plan

This document is the main operating loop for Pseudo Paradox implementation. Agents must keep working continuously until the planned scope is complete.

## Loop Contract

Every slice follows the same loop:

1. Read `AGENTS.md`, `README.md`, this plan, `docs/WORKING_AGREEMENT.md`, the relevant `docs/gdd/` files, `docs/PROGRESS_LOG.md`, `docs/OPEN_QUESTIONS.md`, `docs/FOLLOWUPS.md`, `docs/GDD_COVERAGE.json`, and the active backlog.
2. Pick the highest-priority unblocked task from this plan, coverage gaps, followups, the qualitative-gate docs, and the active backlog.
3. Create one branch for one PR-sized slice.
4. Build the slice completely using existing code patterns.
5. Add or update tests for the touched behavior.
6. Update continuity docs and the GDD coverage ledger.
7. Run local verification.
8. Open a PR.
9. Inspect review comments and threaded inline comments.
10. Fix actionable feedback, reply when useful, resolve threads.
11. After every push to the PR branch, wait for any configured bot reviewer to finish its review pass, then re-inspect reviews and threaded comments. The wait is settled only when all required checks are green AND at least 60 seconds have passed since the latest PR branch push or latest bot review activity, whichever is later. If no fresh bot review appears after that, record that no new bot feedback was posted after the push.
12. Wait for CI and preview deploy to pass.
13. Merge only when green and bot review has settled after the latest push.
14. Pull `main`, verify main CI and production deploy, smoke test production.
15. Close the backlog item with the PR number and verification evidence.
16. Immediately start the next slice.

Do not stop after planning, after opening a PR, or after merging. If a task is blocked, log the blocker in `docs/OPEN_QUESTIONS.md` or `docs/FOLLOWUPS.md`, update the backlog item, and move to the next unblocked slice.

## Slice Selection

Priority order:

1. Broken `main`, red CI, broken deploy, or failing required checks.
2. Active P0 or P1 backlog items.
3. Open `docs/OPEN_QUESTIONS.md` entries that block implementation and have enough information to resolve.
4. High-priority `docs/FOLLOWUPS.md` items.
5. `docs/GDD_COVERAGE.json` gaps marked `not_started` or `partial`.
6. GDD requirements with user-visible scope still marked partial.
7. **Once coverage is ≥80% done:** open items in `docs/PLAYTEST.md` and gaps in `docs/FUN_FACTOR_AUDIT.md`. These are the second gate. The loop is not finished until these resolve.
8. Cleanup that removes blockers, stale docs, or brittle test gaps.

Prefer the smallest slice that creates a useful PR. Avoid mixing unrelated work.

## Definition Of Done

A slice is done only when all apply:

- Code, docs, tests, and coverage ledger match the implemented behavior.
- Required local verification passes.
- PR is open and all actionable review comments are handled.
- Bot review has finished after the latest push, or no fresh bot feedback appeared after the settled wait.
- CI and preview deploy are green.
- PR is merged.
- Local `main` is updated from remote.
- Main CI and production deploy are green.
- Production smoke test passes or a blocker is logged.
- The backlog item or followup is closed with the PR number and verification.

## Project Closure

The loop ends when ALL apply:

1. Every row in `docs/GDD_COVERAGE.json` is `done` with implementation and test refs.
2. Every checklist item in `docs/PLAYTEST.md` is checked or explicitly deferred to a follow-up release.
3. `docs/FUN_FACTOR_AUDIT.md` has been re-run after the last system landed and produced no new P0 or P1 gaps.

Closing the loop without all three is the Flatline failure mode: shipping a complete-on-paper system that is not actually good.

## Current Planned Scope

Use `docs/gdd/` as the product scope. The current high-level remaining areas are reflected in `docs/GDD_COVERAGE.json`, with active spillover in `docs/FOLLOWUPS.md`.

## Shipped: Goal-Oriented Replay plus Reading-C Tick Model (F-013, F-014, F-015)

The five-PR sequence (PR3a / PR3b / PR3c / PR3d / PR3e) merged 2026-05-10 across PRs #48 / #49 / #50 / #51 / #52. F-013 (milestone-driven hybrid replay), F-014 (Reading-C per-timeline tick clock), and F-015 (Acts 2-3 test migration plus West.destinationTick = 30) all resolved. See the slice notes below for what each PR shipped; the original "Next Up" framing is preserved verbatim for institutional memory.

### PR3a: Milestone capture during recording

- Add `Milestone` discriminated union (`wall_bump | door_traversal`) plus a `MilestoneRecorder` parallel to `InputRecorder`. Lifetimes carry both.
- Wall-bump detection: scan Rapier contact pairs after `world.step()` for player-vs-wall-collider contacts. Debounce so sliding along a wall is one bump, not 60.
- Door-traversal detection: mirror the existing `portalTriggers.step` enter event for lit portals into the milestone log on the same tick.
- Milestones are captured on the active player's lifetime only; ghost replay does not generate new milestones.
- Snapshot milestones alongside `recording.snapshot()` when filing a ghost on portal traversal. Store on `GhostInstance.milestones` (frozen).
- No replay change yet. Existing ghosts ignore the new field.
- Tests: milestone shape, debounce on wall slide, door milestone fires once per traversal, snapshot freezes.

### PR3b: Hybrid replay using milestones

- Replace `GhostInstance.advanceTick` with a small state machine: `replaying-input` (default, uses existing `replayAtTick`) and `path-following` (steers toward next pending milestone).
- Drift detector: compare ghost body translation to the expected position at `currentTick` (replayed virtually from tick 0). If `distance > DRIFT_THRESHOLD = 0.5`, switch to `path-following`.
- Path-follower: normalize direction to next milestone, write velocity = direction times `PLAYER_SPEED_MPS`. When `distance < ARRIVAL_RADIUS = 0.3`, mark milestone reached and switch back to `replaying-input` if still on schedule, else continue path-following toward the next milestone.
- Skip rule: if `currentTick - milestone.tick > MILESTONE_BUDGET_TICKS[milestone.kind]` and the milestone is skippable (weight less than 5), skip and target the next. `wall_bump` budget is 60 ticks (1 s); `door_traversal` budget is `Infinity`.
- Visits still reset to tick 0 (F-014 lands later).
- Tests: drift triggers switch, path-follower reaches milestone, skip past stale wall_bump, door is unskippable.

### PR3c: Reading-C tick model plus door destination ticks

- `TimelineRegistry` adds a per-timeline `tickClock` map. `setActiveTimeline(next, arrivalTick)` advances the entering timeline's clock to `arrivalTick`.
- `GhostInstance` adds `startTick: number` (absolute tick within its timeline). On creation, `startTick` is set from the active timeline's tick clock at the moment of filing.
- New `GhostInstance.fastForwardTo(absoluteTick)` deterministically replays the recording from `tick 0` to `absoluteTick - startTick` so milestone state and body position match the destination tick.
- `Portal.destinationTick: number` added; defaults to `0` for backwards compatibility.
- `wireTraversal` reads the destination tick and passes it to `setActiveTimeline`.
- Existing tests update from "tick 0 reset" semantics to the new contract; expect ~30 test rewrites in `tests/sim/`. The Acts 1 to 3 cinematic timing constants stay anchored to `tick 0` because all current door destination ticks are 0.
- Tests: tick clock advances on traversal, ghost fast-forwards correctly to mid-recording position, ghost despawns if its recording ended before arrival tick (door milestone before arrival).

### PR3d: Game-design pass authoring door destination ticks

- Per the GDD's Acts 1 to 3 narrative beats, set specific destination ticks for each portal so the loop-back-and-bump scenarios work end-to-end.
- Update `mountAct1Cinematic` and any other scripted ghosts to file with non-zero `startTick` if the script calls for it.
- Smoke test the user's stated invariant: bump an instance in one timeline, traverse a loop, return to that timeline, see the past-self bump replay.

### Knobs and defaults (frozen across PR3a to PR3d)

- `WALL_BUMP_BUDGET_TICKS = 60` (Q-025).
- `DRIFT_THRESHOLD = 0.5` (Q-024).
- `ARRIVAL_RADIUS = 0.3` (Q-024).
- Milestone weights: `wall_bump = 1`, `door_traversal = 5`. Door is unskippable.
- `Portal.destinationTick` defaults to 0.

### Validation gate

The user's load-bearing invariant: "If I bump an instance in one time, when I loop back to that time, I should see an instance of myself bumping that instance." A scripted integration test in PR3d simulates this end-to-end. The test exists alongside the four PRs as a regression guard.