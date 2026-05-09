---
title: "implement: REQ-004 no-paradox property tests"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:27:11.710177-05:00"
---

Ship the four no-paradox property invariants from docs/gdd/40-act-progress-and-narrative-beats.md section 7. (1) InputRecording immutability post-snapshot: tests/sim/inputRecorder.test.ts asserts snapshot() returns a deeply frozen object whose mutation attempts throw. (2) Timeline registry monotonicity: tests/sim/timelineRegistry.test.ts runs a 1000-tick randomized simulation (using the Q-017 LCG seeded from the test name) and asserts total ghost count is monotonically non-decreasing except across hardReset. (3) Ghost recording independence: a property test asserts a ghost built from a recording snapshot at tick K produces identical body translations regardless of additional input recorded after K. (4) Portal fixity: combined with REQ-005 polish (already covered by the partials regression bundle dot). New file tests/sim/noParadox.test.ts that owns the LCG helper and the property runners. The LCG is a 30-line hand-rolled generator (NOT a third-party library, per stack constraints). Each invariant runs at least 100 randomized sequences. References docs/gdd/40-act-progress-and-narrative-beats.md section 7. Consumes Q-017 (LCG seeded from test name). ## Verify - tests/sim/noParadox.test.ts green with 100 randomized sequences per invariant. - Em-dash check clean. - GDD coverage: REQ-004 from not_started to done. - Build log entry appended to docs/gdd/40-act-progress-and-narrative-beats.md and docs/gdd/02-time-travel-rules.md.
