---
title: "implement: room renders Act 1 spawn pose at 5:00 (REQ-013 / REQ-014)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T18:32:22.864519-05:00"
---

Make the prototype actually open at the canonical Act 1 5:00 state. The room's initial render and the InputRecorder seed should be driven by an explicit 'current time' value (5:00 = 5/24 normalized = 0.20833...). TimeOfDay should construct already at the 5:00 anchor rather than starting at 0; the player capsule's originNormalized should be 5/24; the four-door lit/dark state should be sourced from createActOnePortals(doors) (already lit South/East, dark North/West) which it already is. Add src/sim/actOneAnchor.ts exporting ACT_ONE_HOUR (5) and ACT_ONE_NORMALIZED (5/24) as the single source of truth and consume it in src/app.ts and any tests that need the spawn anchor. Tests: TimeOfDay constructed at the Act 1 anchor returns ACT_ONE_NORMALIZED on tick 0; createPlayer with that origin tints to interpolateWarmToCool(ACT_ONE_NORMALIZED); a room-level test reads the anchor through buildScene end-to-end. Verify: npm run build, npm test, em-dash grep clean, git diff --check clean, dev smoke shows the room opening with a clearly warm tint (5:00 is past the warm anchor at 0 but well before the cool anchor).
