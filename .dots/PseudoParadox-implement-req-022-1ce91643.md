---
title: "implement: REQ-022 Act 3 second knockout"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:28:07.010780-05:00"
---

Wire the act-3-final-knockout beat from docs/gdd/40-act-progress-and-narrative-beats.md section 4 REQ-022. Predicate reads true when at 12:00 there are at least two unconscious ghosts: one with origin 5 (from the mirror beat) and one with origin 6 (the 6:00 instance, just knocked out at 12:00). Integration test continues from REQ-021's mirror outcome, then drives the player to knock out the 6:00 instance inside the 12:00 timeline. Asserts the observer reaches act-3-final-knockout. ## Verify - Integration test green. - GDD coverage: REQ-022 from not_started to done. - Build log entry appended.
