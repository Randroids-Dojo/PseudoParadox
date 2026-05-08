---
title: "implement: floor ring under active player (REQ-031)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T02:53:20.197847-05:00"
---

Add a thin disc or billboard ring under the active player capsule that follows position each render frame. Use a torus or RingGeometry with a soft warm color and slight transparency so it reads as a UI hint not an environment object. The ring belongs to the active player only (future ghost-replay capsules do NOT show one); for now there is one player so the wiring is direct. Add src/scene/floorRing.ts with createFloorRing(player) returning an object with an updatePosition() called from the render frame. Tests: ring mesh exists in the scene after createFloorRing; updatePosition copies the player's x/z translation; ring sits at y near 0.01 (just above the floor). Verify: npm test, npm run build, em-dash grep, git diff --check, dev smoke.
