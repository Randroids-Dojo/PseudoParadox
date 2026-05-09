---
title: "implement: REQ-017 Act 2 second loop"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:27:40.060909-05:00"
---

Wire the act-2-loop-2 beat. Predicate body in docs/gdd/40-act-progress-and-narrative-beats.md section 4 REQ-017. The integration test drives the player through the second loop: knock out You-1 on return to 5:00 (use the recorded punch from REQ-033), pick up the unconscious body (REQ-034 carry), drag East to 6:00 through the East portal (carry survives traversal per REQ-035 dossier section 5 edge case 2), wait for You-2 to wake (the recorded path through the East portal becomes a ghost in the 5:00 bucket; the You-2 instance arrives at 6:00). Test asserts the observer transitions act-2-loop-1 -> act-2-loop-2. ## Verify - Integration test green; observer reaches act-2-loop-2. - GDD coverage: REQ-017 from not_started to done. - Build log entry appended.
