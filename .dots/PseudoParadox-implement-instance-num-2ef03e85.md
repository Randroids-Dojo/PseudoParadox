---
title: "implement: instance number tracking (You1, You-1, You-2) (REQ-007)"
status: open
priority: 3
issue-type: task
created-at: "2026-05-08T19:13:47.210309-05:00"
---

Each spawned ghost gets a generation index (You1 is 1, the first ghost recorded is You-1 = -1, the second is You-2 = -2, etc). The active player's index increments after each portal traversal that closes a lifetime. Plan: extend GhostInstance with a generation: number field; track activePlayerGeneration on the lifetime/player; on traversal, set the spawned ghost's generation to the current activePlayerGeneration and increment activePlayerGeneration so the next ghost gets the next number. Foundation for REQ-032 thought-bubble icons that need to identify instances. Tests: new GhostInstance carries a generation; sequential traversals produce ghosts with monotonically incrementing negative generations; the active player's generation is exposed on the player handle for downstream UI. ## Verify: npm run build, npm test, em-dash grep clean.
