---
title: "implement: REQ-016 Act 2 first loop (You-1 replay)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:27:33.659190-05:00"
---

Wire the act-2-loop-1 beat into the host loop. Builds on the ActState observer (dot 1). Adds a per-tick observer.evaluate(snapshot) call in src/app.ts that updates the watermark. Adds an integration test (tests/sim/actStateIntegration.test.ts) that drives a recorded East-then-West sequence: spawn at 5:00, walk East (entering the East portal triggers a traversal to 6:00), walk West (entering the West portal triggers a traversal back to 5:00); assert the observer reaches act-2-loop-1 once the You-1 ghost in 5:00 finishes its replay and reaches the West portal. Predicate body documented in docs/gdd/40-act-progress-and-narrative-beats.md section 4 REQ-016. ## Verify - Integration test green. - Observer reaches act-2-loop-1 within the recorded sequence. - GDD coverage: REQ-016 from not_started to done. - Build log entry appended to both 40-act-progress-and-narrative-beats.md and 03-story-acts-1-3.md.
