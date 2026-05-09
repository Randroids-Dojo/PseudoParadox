---
title: "implement: REQ-020 Act 3 team-up beat"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:27:54.428096-05:00"
---

Wire the act-3-team-up beat from docs/gdd/40-act-progress-and-narrative-beats.md section 4 REQ-020. The predicate reads true when at least one ghost in the 5:00 bucket is unconscious AND its origin timeline is 5 (i.e., the instance that lived at 5:00 was the one knocked out). Integration test continues from REQ-019's chase outcome, then drives the team-up sequence: the player at 5:00 plus the ghost from 6:00 coordinate to knock out the third instance at 5:00. Asserts the observer reaches act-3-team-up. ## Verify - Integration test green. - GDD coverage: REQ-020 from not_started to done. - Build log entry appended.
