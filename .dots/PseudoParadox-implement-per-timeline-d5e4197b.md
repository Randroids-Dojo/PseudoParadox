---
title: "implement: per-timeline ghost bookkeeping (REQ-001 deepening / REQ-003 done)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T19:13:24.699275-05:00"
---

Track which ghost belongs to which timeline so a recorded instance is only visible when the player is in the timeline it was recorded in. Currently every spawned ghost stays in the scene regardless of current timeline; the GDD specifies that recorded actions of an instance in timeline T should ONLY appear when re-entering T. Plan: extend GhostInstance with a timelineNormalized field (set on spawn from lifetime.originNormalized), maintain a Set<number> of all known timelines, and on every traversal hide ghosts whose timelineNormalized != currentTimelineNormalized (e.g. via mesh.visible = false and freezing the body's velocity, or by removing/re-adding to scene). The active timeline is the rounded current TimeOfDay normalized at hour resolution (or the destination of the last lit-portal traversal). Tests: ghost recorded at 5:00 is hidden after East-traversal to 6:00, and visible again after West-traversal back to 5:00; ghosts recorded in different timelines do not bleed across. This is the load-bearing piece for Act 2's 'East then back to 5:00 sees You-1' beat. ## Verify: npm run build, npm test, em-dash grep clean, dev smoke shows ghost only in its origin timeline.
