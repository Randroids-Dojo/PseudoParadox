---
title: "implement: portal traversal teleport (REQ-009 / REQ-013 / REQ-014 partial)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T18:32:15.656290-05:00"
---

On a portal-overlap event for a LIT portal, freeze the InputRecorder snapshot, spawn a ghost replaying that snapshot at the destination's spawn pose, and reposition the active player to the destination time's spawn pose. Builds on the portal-trigger detection slice and the existing ghost-replay machinery from PR #11. Out of scope: dark-portal arrivals (those are spawn-only and land with REQ-003). Update src/app.ts to consume the overlap event and orchestrate: snapshot recorder, advance TimeOfDay to the destination's normalized hour, spawn a ghost from the snapshot, teleport the player body, clear the recorder, restart recording at the new origin time. Tests: a sim-level test that a lit-portal traversal produces a ghost mirroring the pre-traversal recording at the destination spawn, the player body is at the destination spawn, and a fresh recorder is recording from tick 0. Dark-portal traversal must be a no-op. Verify: npm run build, npm test, em-dash grep clean, git diff --check clean, dev smoke shows traversal end-to-end on player entering a lit door.
