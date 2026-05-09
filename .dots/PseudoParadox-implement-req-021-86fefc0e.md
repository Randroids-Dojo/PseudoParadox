---
title: "implement: REQ-021 Act 3 mirror beat"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:28:00.031787-05:00"
---

Wire the act-3-mirror beat from docs/gdd/40-act-progress-and-narrative-beats.md section 4 REQ-021. The predicate reads true when the active player is at 12:00 with carry state idle, and there is an unconscious ghost in the 12:00 bucket within DROP_CENTER_RADIUS_M = 1.0 (Q-014) of the room origin. Integration test continues from REQ-020's team-up outcome, then drives the player to drag the unconscious 5:00 instance South through the South portal to 12:00 and drops it near the room center. Asserts the observer reaches act-3-mirror. Note: this beat depends on F-007 partial behavior (cross-timeline body rehoming); the predicate uses the in-flight registry's traversal hook to detect the body crossing the South portal trigger. ## Verify - Integration test green. - GDD coverage: REQ-021 from not_started to done. - Build log entry appended.
