---
title: "implement: punch input + knockout state machine (REQ-033 partial)"
status: open
priority: 1
issue-type: task
created-at: "2026-05-08T22:19:15.324706-05:00"
---

Spec: docs/gdd/30-combat-and-interaction.md section 4 (Knockouts).
Consumes: Q-002 (key bindings, default Space for punch), Q-003 (punch range, default 1.2 m).

Goal: ship the data and rules half of REQ-033. No ragdoll body response yet.
Status target: REQ-033 not_started -> partial.

Affected files:
- src/input/keyboard.ts: extend KeyState with punch boolean; map Space to it.
- src/sim/inputRecorder.ts: KeyState already deep-frozen by the recorder; verify the extension carries through snapshot()/replay.
- src/sim/punch.ts (NEW): export PUNCH_RANGE_M = 1.2, isInPunchRange(a, b, range), and applyPunchAtTick(active, recipients, tick) returning the recipient list that transitions to unconscious. Pure helper, no Rapier mutation.
- src/sim/knockoutState.ts (NEW): export KnockoutState type with consciousness flag; helper transitionToUnconscious(state). Pure data.
- src/scene/player.ts: extend Player with consciousness state; expose to traversal/punch.
- src/sim/ghostInstance.ts: extend GhostInstance with consciousness state; on advanceTick, if recording.frames[tickIndex].keys.punch is true, evaluate punch against active player and other ghosts.
- src/app.ts: wire Space keydown into punch input on the active player; per fixed step, evaluate punch against ghosts and other actives.

Edge cases:
1. Simultaneous punches by two instances: process in registry-iteration order; both can land if both have a recipient in range.
2. Punch at a portal trigger volume: independent of traversal pipeline; it just resolves.
3. Punch against an already-unconscious body: no-op (still in unconscious state; no transition fires).
4. Punch with zero recipients in range: no-op; the recording still captures the punch input.
5. Active player punches own ghost in same timeline (Act 3 team-up beat): allowed; the ghost transitions to unconscious.

## Verify

- [ ] npm test: new tests in tests/sim/punch.test.ts (range predicate, no-self-hit guard, multi-recipient broadcast) all pass.
- [ ] tests/sim/inputRecorder.test.ts: a recording captured with punch=true at tick T returns punch=true on replayAtTick equivalent (via the KeyState snapshot path).
- [ ] tests/sim/ghostInstance.test.ts: a ghost advancing through a recording with a punch frame triggers the proximity check and transitions an in-range recipient to unconscious.
- [ ] tests/scene/player.test.ts: createPlayer seeds consciousness=conscious.
- [ ] grep -rnP '[\x{2014}\x{2013}]' . returns nothing.
- [ ] git diff --check clean.
- [ ] npm run build succeeds.
