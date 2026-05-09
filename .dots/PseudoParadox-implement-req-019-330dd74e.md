---
title: "implement: REQ-019 Act 3 chase beat"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:27:51.434766-05:00"
---

Wire the act-3-chase beat from docs/gdd/40-act-progress-and-narrative-beats.md section 4 REQ-019. Add the recentWestEntries ring buffer to the observer (the ONLY observer state beyond the watermark; reset by hardReset). The buffer captures the last 4 ticks of West-portal-trigger enter events with their instance ids. The predicate reads true when two distinct instance ids both fired enter against the West portal within a 2-tick window. Integration test drives the chase: the player runs toward the West door at 5:00 while the ghost (recorded chasing) also enters; both instances cross the West trigger within 2 ticks. ## Verify - Integration test green; observer reaches act-3-chase. - hardReset clears the ring buffer. - GDD coverage: REQ-019 from not_started to done. - Build log entry appended.
