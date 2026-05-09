---
title: "implement: REQ-040 end-to-end completability + REQ-037 ship smoke + REQ-038 / REQ-039 perf gates"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:28:29.299210-05:00"
---

The biggest gate. Three perf / smoke / E2E sub-slices in one PR. (1) REQ-040 end-to-end completability: Playwright test (Q-020 default) at tests/e2e/completability.spec.ts that opens the local dev server, drives the player through Acts 1 to 3 by replaying a hand-authored sequence of keydown/keyup events, polls window.__pseudoParadoxActState (a debug-only build-flag-gated hook on src/app.ts) until escaped, asserts within MAX_TEST_DURATION_MS = 60000. (2) REQ-037 ship smoke: a single Playwright run (Q-018 default; not added to CI) that hits pseudo-paradox.vercel.app, waits for the canvas to mount, asserts no JS errors. Documented as a build log entry. (3) REQ-038 / REQ-039 perf gates: tests/perf/bundleSize.test.ts asserts dist/ JS payload is below MAX_BUNDLE_BYTES = 5_000_000 (~ 8s download at 5 Mbps). tests/perf/frameTime.test.ts builds a Rapier world, spawns 4 ghosts running 200-tick recordings, runs 300 fixed steps, asserts 95th-percentile per-step CPU time below MAX_FRAME_MS = 16.67 (Q-019 default). References docs/gdd/40-act-progress-and-narrative-beats.md sections 8, 9, 10. Consumes Q-018, Q-019, Q-020. ## Verify - Playwright E2E reaches escaped. - Bundle-size test green. - Frame-time test green. - Manual production smoke documented in build log. - GDD coverage: REQ-037, REQ-038, REQ-039, REQ-040 from not_started to done. - Build log entry appended.
