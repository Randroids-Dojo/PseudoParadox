---
title: "implement: REQ-023 Act 3 escape + REQ-024 dependency monotonicity"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:28:17.728533-05:00"
---

Final beat plus the dependency monotonicity contract. Wire the escaped beat from docs/gdd/40-act-progress-and-narrative-beats.md section 4 REQ-023. Author the North-at-12:00 arrivals-rule body in src/sim/litStateForTimeline.ts (replacing DEFAULT_BLOCKED_BY_ARRIVALS for the (timeline=12, cardinal=North) cell) so the North door at 12:00 is dark while any scripted-actor ghost from REQ-012 has tickIndex < recording.length, and lit once they have all completed. Predicate reads true when the active player crosses the North portal trigger at 12:00 with the watermark at act-3-final-knockout. Per Q-022 default the observer is observer-only; tests assert the watermark monotonicity contract by attempting invalid transitions and confirming the observer does not advance. After this slice REQ-024 flips from not_started (or partial after dot 1) to done. The integration test extends the prior chain with the final North-door run-through and asserts ActState === escaped. Closes F-006 by routing the visual paint path through litStateForTimeline (now that arrivals body has a non-trivial cell). ## Verify - Integration test green; observer reaches escaped. - REQ-024 monotonicity tests in tests/sim/actState.test.ts cover the invalid-transition cases. - F-006 closed. - GDD coverage: REQ-023 from not_started to done; REQ-024 from partial to done. - Build log entry appended.
