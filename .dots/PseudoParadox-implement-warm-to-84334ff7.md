---
title: "implement: warm-to-cool room color tint over time (REQ-029)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T01:09:40.565361-05:00"
---

Add a virtual time-of-day clock in src/sim/time.ts. Tint the room (walls, hemisphere light, or fog) along a warm-to-cool spectrum based on the clock. Make the spectrum config-driven so REQ-030 (instance tint frozen at travel time) can read the same lookup. Tests: pure color lookup at known time values.
