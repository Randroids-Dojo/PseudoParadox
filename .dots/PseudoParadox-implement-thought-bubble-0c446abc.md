---
title: "implement: thought-bubble icon overlay (REQ-032)"
status: open
priority: 6
issue-type: task
created-at: "2026-05-08T22:21:09.734130-05:00"
---

Spec: docs/gdd/30-combat-and-interaction.md section 8 (Thought bubbles).
Consumes: Q-010 (lookahead window length, default 30 ticks).

Goal: ship REQ-032 end-to-end. Each non-active ghost displays a billboard icon above its head when an upcoming action (door enter, fight, sleep) is within the lookahead window.
Status target: REQ-032 not_started -> done.

Affected files:
- public/icons/door-arrow.png, fist.png, sleep.png, footsteps.png: text-free icon assets. Author as small (64x64 px) PNG sprites in the existing public/ folder. Pillar 3 (sci-fi diegetic) forbids text; icons read as glyphs.
- src/render/thoughtBubble.ts (NEW): createThoughtBubble(ghost) returns a THREE.Sprite child of ghost.mesh anchored at { x: 0, y: PLAYER_CAPSULE_TOTAL_HEIGHT + 0.3, z: 0 }. Exports updateThoughtBubble(bubble, iconKind | null) to swap the visible texture or hide the bubble when null.
- src/sim/lookahead.ts (NEW): scanRecordingForUpcomingActions(recording, fromTick, windowTicks) returns the highest-priority IconKind in the window: 'sleep' (ghost is currently unconscious) > 'fist' (punch input rising edge in window) > 'door-arrow' (any LIT portal trigger entry derivable from the recording in window) > 'footsteps' (idle-to-walking transition in window) > null. Pure function over a recording slice.
- src/sim/ghostInstance.ts: extend GhostInstance with a thoughtBubble field; createGhost now also creates the bubble. The lookahead computation runs from the host once per render frame (not per tick).
- src/app.ts: per render frame, iterate registry.activeGhosts() and call updateThoughtBubble for each based on scanRecordingForUpcomingActions.

Edge cases:
1. Ghost at end of recording (tickIndex >= recording.length): the lookahead window is empty; the bubble shows null unless ghost is unconscious (then 'sleep').
2. Ghost is unconscious: 'sleep' takes priority over upcoming actions in the recording.
3. Multiple actions in the same window: highest priority wins (sleep > fist > door-arrow > footsteps).
4. Anti-spam: door-arrow stays visible for the full lookahead window; once the ghost crosses the trigger, the next frame's scan returns null (the trigger entry has resolved out of the window).
5. Footsteps icon: only fires on idle-to-walking transitions (>= 5 consecutive zero-velocity ticks followed by non-zero); allowed to be invisible most of the time.
6. Active player has no bubble (per spec, the active player does not need a preview of itself).

## Verify

- [ ] npm test: tests/sim/lookahead.test.ts cover priority order, window boundaries, idle-to-walking detection, sleep override.
- [ ] tests/render/thoughtBubble.test.ts: creating a bubble produces a Sprite child of the ghost mesh at the configured offset.
- [ ] tests/sim/ghostInstance.test.ts: a ghost has a thoughtBubble field after createGhost.
- [ ] Visual smoke (manual): dev-server walkthrough confirms an icon visibly appears above a ghost about to enter a door, throw a punch, or while unconscious.
- [ ] grep -rnP '[\x{2014}\x{2013}]' . returns nothing.
- [ ] git diff --check clean.
- [ ] npm run build succeeds.
