# Story Structure: Acts 1-3

**Status:** not_started

The prototype covers exactly three acts in a single room. Each act is a deterministic, designer-authored sequence the player must reproduce by manipulating their past instances. The prototype is complete when the player can finish Act 3.

## Act 1: Wake up

- Clock reads 12:00.
- Two people drag a knocked-out body in through the open North door and place it in the center of the room.
- Fade to black.
- Fade in. Clock reads 5:00.
- The player is standing in the center of the room.
- The North door is dark (spawn-only).
- The South and East doors are lit (enterable).
- The West door is dark.

Door destinations from 5:00:

- South: 12:00 (entering this door triggers the Act 1 cinematic from the player's first-person perspective; the two people knock the player out).
- East: 6:00 (room is empty; only the West door is lit).
- North: dark.
- West: dark at 5:00.

At 6:00, the West door leads back to 5:00.

## Act 2: Meet yourself

The player goes East to 6:00, then West to 5:00. On returning to 5:00, the player sees another instance of themselves (You-1). You-1 repeats what You1 did: walks to the West door and disappears.

Repeat the loop. This time, when You1 returns to 5:00, knock out You-1. Drag the body through the East door to 6:00. Wait for another instance to wake up. That instance (You-2, in the recording) knocks You1 out.

Fade out.

## Act 3: Escape

Fade in. Clock reads 5:00. Repeat the Act 2 sequence to position a knocked-out instance at 6:00. Wait for the other instance to wake.

This time, run toward the West door as the other instance chases you. Both instances get pulled through and arrive at 5:00. Two other instances of the player are now present in the same scene.

Curiosity beat: the two instances are visibly aware of each other. The player teams up with the instance from 6:00 to knock out the 5:00 instance. Drag that instance South to 12:00. Place the body in the center of the room (mirroring Act 1).

Knock out the instance brought from 6:00.

The North door at 12:00 is now open. No one is left to stop the player.

Run through the North door.

**Level complete.**

## Beat dependencies

The acts cannot be executed out of order. Act 3 requires the timeline state produced by Act 2. Act 2 requires the discovery beat from Act 1. The prototype's main job is to make these state transitions legible to the player without text or tutorial.

## Failure recovery

There is no auto-rewind. If the player gets stuck or makes the puzzle unsolvable, hard reset is available in the pause menu. See `17-ui-failure-state.md`.

### Build log

- 2026-05-08: hard reset lands end-to-end (REQ-025 done). Pressing `r` returns the simulation to a clean Act 1 spawn pose: every ghost in every timeline bucket is torn down (mesh removed from scene, rigid body removed from world), the active player snaps back to the room center with zero linear velocity, `player.originNormalized` and the capsule tint re-stamp to `ACT_ONE_NORMALIZED`, the active lifetime opens a fresh `InputRecorder` keyed at the Act 1 anchor, the time-of-day clock snaps to 5:00, every door's lit/dark visual repaints to the canonical 5:00 table (South lit, East lit, North dark, West dark), and the portal-trigger overlap state clears so the next step call does not fire a stale exit for whatever trigger the player was standing in at reset. The teardown function is pure (`src/sim/hardReset.ts`); the host (`src/app.ts`) only owns the `KeyR` keydown listener. New helpers: `TimelineRegistry.clearAllGhosts(scene, world, nextActiveTimeline)` walks every bucket, removes meshes from the scene, removes bodies from the world (Rapier's `removeRigidBody` cleans up the body's colliders too), clears each bucket, and resets the active timeline to `nextActiveTimeline`. `PortalTriggerSet.resetOverlapState()` flips every per-portal overlap flag back to `false` without firing events. The function is idempotent (safe to call on a clean state) and correctly tears down ghosts in every visited timeline, not just the active one. Pause-menu UI is OUT OF SCOPE; a single key binding is enough to ship the failure-recovery contract and the next slice's UI can call the same function. Files: `src/sim/hardReset.ts`, `src/sim/timelineRegistry.ts`, `src/sim/portalTrigger.ts`, `src/app.ts`, `tests/sim/hardReset.test.ts`. PR pending.
- 2026-05-08: 6:00 timeline state lands end-to-end (REQ-015 done, REQ-006 done). Traversing East from 5:00 now drops the player into a properly empty 6:00 room with West-only lit and West routing back to 5:00. Added `src/sim/timelineRoom.ts` exposing `repaintDoorsForHour(portals, hour)` and `snapClockToHour(timeOfDay, hour)`. Extended `WireTraversalOptions` with an optional `onTimelineEnter(destinationHour)` callback fired AFTER the registry's active timeline switches; the host wires both helpers into the callback in `src/app.ts`. The traversal handler's lit/dark gate now reads `DOOR_STATE_BY_HOUR[activeTimeline][portal.direction]` for authored hours and falls back to `portal.isLit` for unauthored hours, so the West portal (authored DARK at 5:00 in `ACT_ONE_PORTAL_SPECS`) is enterable at 6:00 per the table without any portal-data rewrite. The 6:00-side data (West-only-lit, West routes to 5:00) was forward-authored in PR #12 and PR #16, so no portal data change was needed for this slice. First entry into 6:00 yields an empty active-ghost list (REQ-006). Files: `src/sim/timelineRoom.ts`, `src/sim/portalTraversal.ts`, `src/app.ts`, `tests/sim/timelineRoom.test.ts`, `tests/sim/portalTraversal.test.ts`. PR pending.
- 2026-05-08: Act 1 spawn pose at 5:00 lands end-to-end (REQ-013 / REQ-014 done). Day-arc convention: a 24-hour cycle on `[0, 1)` with `t = 0.0` at midnight, `t = 1.0` wrapping to midnight, and `hourToNormalized(h) = h / 24`. Picked over a tighter [4:00, 8:00] dawn arc because the GDD calls out 5:00, 6:00, and 12:00 explicitly and the 24-hour mapping lets all three sit on the same scalar that `portalDestinationNormalized` already uses. Added `src/sim/actOneAnchor.ts` (`ACT_ONE_HOUR = 5`, `ACT_ONE_NORMALIZED = 5 / 24`) and `src/sim/doorStateAtTime.ts` (`doorLitStateAtHour(5)` returns South lit / East lit / North dark / West dark per the GDD; `doorLitStateAtHour(6)` is forward-authored as West-only-lit for REQ-015). `src/app.ts` seeds `TimeOfDay` with `initialNormalized: ACT_ONE_NORMALIZED` so the room opens at the 5:00 amber tint and the player capsule's `originNormalized` stamps to 5/24. `src/scene/room.ts` now derives door lit/dark from `doorLitStateAtHour(ACT_ONE_HOUR)` rather than reading `portal.isLit` directly. Files: `src/sim/actOneAnchor.ts`, `src/sim/doorStateAtTime.ts`, `src/scene/room.ts`, `src/app.ts`, `tests/sim/actOneAnchor.test.ts`, `tests/sim/doorStateAtTime.test.ts`, `tests/scene/room.test.ts`. PR pending.
- 2026-05-08: portal traversal teleport wires the Act 1 door destinations (REQ-013 / REQ-014 partial). `wireTraversal` (`src/sim/portalTraversal.ts`) reads each portal's `destinationHours` via `portalDestinationNormalized` and, on a lit entry, teleports the active player to the destination spawn pose, re-stamps `player.originNormalized` to the destination's normalized time, and opens a fresh recorder keyed to that timeline. Combined with the canonical Act 1 portal table from PR #12 (South lit to 12:00, East lit to 6:00, North dark, West dark), entering the South door from 5:00 sends the player to 12:00 and entering the East door sends the player to 6:00 end-to-end. Still partial because the 5:00 clock anchor and per-time spawn poses (the player should physically appear at 12:00 or 6:00 with the room tint at the destination's hour) land in the next slice via the pluggable `resolveSpawnPose` resolver. Files: `src/sim/portalTraversal.ts`, `src/app.ts`, `tests/sim/portalTraversal.test.ts`. PR pending.
