---
title: "implement: 6:00 timeline state with West-only lit door (REQ-015)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T19:13:12.543202-05:00"
---

When the player traverses East from 5:00, the destination should render the 6:00 timeline state per the GDD: West door is the only lit door, all other cardinals dark, and the clock pins to 6:00. Currently the traversal teleports the player to room center but the room's painted lit/dark state stays at the 5:00 configuration regardless of current time. Plan: use the existing doorLitStateAtHour helper (already authored at hour 6 = West-lit/others-dark) and stamp door materials when the active timeline changes. Wire src/sim/portalTraversal.ts (or a new src/sim/timelineRoom.ts) to: on lit-portal traversal, set timeOfDay to portalDestinationNormalized(portal), then re-paint doors via doorLitStateAtHour(currentHour). The 6:00 timeline's portal table also needs ACT_ONE_PORTAL_SPECS replaced or extended: at 6:00 the West door leads back to 5:00, others are dark with destinations of West=5:00, others=any (unreachable). Tests: traversal of East-from-5:00 leaves the player with timeOfDay reading 6/24, doors painted West=lit/others=dark, room background tint shifted to 6:00; traversal of West-from-6:00 returns to 5:00 timeline state. ## Verify: npm run build, npm test, em-dash grep clean, dev smoke shows the room visibly changing color and door state when entering East.
