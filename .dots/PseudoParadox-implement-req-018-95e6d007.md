---
title: "implement: REQ-018 Act 3 setup"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:27:42.050150-05:00"
---

Wire the act-3-setup beat. Predicate body in docs/gdd/40-act-progress-and-narrative-beats.md section 4 REQ-018. After Act 2's loop 2 watermark is set, the player is at 5:00 again with at least one unconscious ghost in 6:00. Integration test continues from REQ-017's setup, then drives the player back to 5:00 and asserts the observer reaches act-3-setup. ## Verify - Integration test green. - GDD coverage: REQ-018 from not_started to done. - Build log entry appended.
