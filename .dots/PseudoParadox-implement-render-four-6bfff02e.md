---
title: "implement: render four doors per wall (REQ-027)"
status: open
priority: 1
issue-type: task
created-at: "2026-05-08T01:09:33.245768-05:00"
---

Add four door meshes (one per wall) flush with the inside face of each wall in src/scene/room.ts or a new src/scene/doors.ts. Use ROOM_DIMENSIONS to position them. Visually distinct from walls so they read as doors. Update GDD_COVERAGE for REQ-027 to partial (no lit/dark logic yet, REQ-028 is separate).
