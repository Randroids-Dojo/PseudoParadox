---
title: "implement: ActState observer + beat predicates as pure functions (REQ-024 partial)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:26:34.811607-05:00"
---

Ship the central act-progress data structure described in docs/gdd/40-act-progress-and-narrative-beats.md section 3 plus the per-beat pure predicates from section 4. The ActState chain is not-started, act-1-spawn, act-2-loop-1, act-2-loop-2, act-3-setup, act-3-chase, act-3-team-up, act-3-mirror, act-3-final-knockout, escaped. Add a new module src/sim/actState.ts exporting the ActState union, the ActStateSnapshot interface, evaluateActState(snapshot) as a pure function, and one predicate function per beat. The observer keeps a watermark plus a small recentWestEntries ring buffer. Wire NOTHING into src/app.ts this slice (host wiring lands with the per-beat slices). Comprehensive unit coverage: every predicate tested in isolation with hand-built snapshots; the watermark monotonicity contract tested across a sequence of valid transitions and across an attempted skip; hardReset returns the observer to not-started. Consumes Q-022 (observer-only enforcement default), Q-014 (DROP_CENTER_RADIUS_M = 1.0 m). References docs/gdd/40-act-progress-and-narrative-beats.md sections 3 and 4. ## Verify - new module src/sim/actState.ts compiles. - tests/sim/actState.test.ts covers every predicate plus the watermark contract. - npm test green; previous 402/402 grows by the new cases. - Em-dash and en-dash grep clean. - Build log entry appended to docs/gdd/40-act-progress-and-narrative-beats.md and docs/gdd/03-story-acts-1-3.md. - GDD coverage: REQ-024 from not_started to partial.
