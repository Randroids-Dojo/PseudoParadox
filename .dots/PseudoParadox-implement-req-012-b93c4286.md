---
title: "implement: REQ-012 Act 1 cinematic via scripted actor recordings"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:27:23.694758-05:00"
---

Ship the Act 1 cinematic from docs/gdd/40-act-progress-and-narrative-beats.md section 5. New module src/sim/scripts/act1Cinematic.ts exports ACT1_LEFT_DRAGGER_RECORDING, ACT1_RIGHT_DRAGGER_RECORDING, ACT1_KNOCKOUT_BODY_RECORDING as frozen InputRecording objects, plus the spawn poses ACT1_LEFT_DRAGGER_SPAWN, ACT1_RIGHT_DRAGGER_SPAWN, ACT1_KNOCKOUT_BODY_SPAWN, plus fade timing constants ACT1_CINEMATIC_FADE_START_TICK and ACT1_CINEMATIC_FADE_DURATION_TICKS. Recordings are hand-authored KeyState arrays; total duration ~240 ticks (4 seconds at 60 Hz). New host hook mountAct1Cinematic({ registry, scene, world }) called once at boot in src/app.ts; builds three GhostInstance objects via createGhost(...) and files them into the 12:00 bucket. New module src/render/fadeOverlay.ts exports createFadeOverlay() returning a Three.js full-screen plane on a separate OrthographicCamera with material opacity animated tick-by-tick (Q-013 default). Active player does NOT exist during the cinematic; spawns at 5:00 post-fade (Q-015 / Q-016 defaults). New tests/sim/scripts/act1Cinematic.test.ts pins recording lengths, spawn poses, and that the host hook adds three ghosts to the 12:00 bucket. References docs/gdd/40-act-progress-and-narrative-beats.md sections 5 and 13. Consumes Q-012, Q-013, Q-015, Q-016, Q-021. ## Verify - mountAct1Cinematic produces three ghosts in 12:00 with correct origins. - Fade overlay opacity ramps 0 to 1 to 0 across the cinematic. - npm test green. - GDD coverage: REQ-012 from not_started to done. - Build log entry appended.
