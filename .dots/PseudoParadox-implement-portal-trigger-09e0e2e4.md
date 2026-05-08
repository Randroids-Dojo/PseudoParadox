---
title: "implement: portal trigger overlap detection for the active player capsule (REQ-009 deepening)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T18:32:05.457701-05:00"
---

Sense when the active player capsule overlaps a portal trigger zone. Add src/sim/portalTrigger.ts exporting createPortalTrigger(portal, world) which builds a Rapier sensor collider at the door's mesh position sized to a small box just inside the door, plus checkPortalOverlap(triggers, body) which iterates the triggers and returns the first overlapping portal (or null). Wire detection into src/app.ts so the per-frame loop logs/emits portal-overlap events for the active player. Does NOT teleport yet; this slice is detection only. Tests: pure unit tests for AABB-style overlap math given canonical door positions, plus a Rapier integration test that places the player at a door and verifies the overlap fires. Verify: npm run build, npm test, em-dash grep clean, git diff --check clean, dev smoke shows console event when player enters door volume.
