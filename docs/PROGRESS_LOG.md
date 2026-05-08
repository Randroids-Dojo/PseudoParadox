# Progress Log

Newest entries first. Every implementation slice adds an entry. Append-only: never delete, never reorder, never edit a previous entry.

Format for each slice:

```
## YYYY-MM-DD, Short Title

- Branch: `feature/short-name`
- PR: #N (when known)
- Changed: one paragraph naming the user-facing change and the key files / helpers / defaults that landed.
- Verification: dash checks, type-check, relevant unit tests, build, smoke (where applicable). Note any known-tolerated lint warnings or skipped checks.
- Assumptions: assumptions made under a Recommended default. One sentence per assumption.
- GDD coverage: which rows in `docs/GDD_COVERAGE.json` flipped to `partial` or `done`, or which `docs/gdd/*.md` files gained a Build log entry.
- Followups: any new `F-NNN` entries created. Link to them.
```

## 2026-05-08, Audit Remediation: Atomic Coverage Rows

- Branch: `chore/spiral-audit-remediation`
- PR: (pending)
- Changed: replaced the two placeholder rows in `docs/GDD_COVERAGE.json` with 40 atomic requirement rows (REQ-001 through REQ-040) sourced from the five drafted GDD section files (`01-vision-and-pillars.md`, `02-time-travel-rules.md`, `03-story-acts-1-3.md`, `23-prototype-scope.md`, `99-out-of-scope.md`). Resolved Q-001 in `docs/OPEN_QUESTIONS.md` and F-001 in `docs/FOLLOWUPS.md` because the underlying work shipped before the audit ran. Added F-002 (author missing GDD section files), F-003 (specify hard reset UX), and F-004 (consolidate or remove the legacy root `GDD.md`). Stripped pre-existing em-dashes (U+2014) from `README.md` and the legacy `GDD.md` so the AGENTS.md pre-commit grep returns nothing across the working tree; full GDD.md consolidation remains tracked under F-004.
- Verification: em-dash grep across the working tree returned nothing. `git diff --check` clean.
- Assumptions: rewriting the contents of REQ-001 and REQ-002 (rather than appending REQ-003+ alongside the placeholders) is consistent with the append-only ledger rule because those rows were template stubs that the original scaffold entry explicitly marked for replacement before any feature PR opens. The IDs are stable; only the placeholder content was replaced.
- GDD coverage: ledger expanded from 2 placeholder rows to 40 real `not_started` rows. No row flipped to `partial` or `done` (no implementation code shipped this slice).
- Followups: F-002, F-003, F-004 created.

## 2026-05-08, Spiral Scaffold Initialized

- Branch: `setup/spiral`
- Changed: bootstrapped the Pseudo Paradox scaffold using the `spiral` skill. Created `AGENTS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/WORKING_AGREEMENT.md`, `docs/gdd/README.md`, `docs/GDD_COVERAGE.json`, `docs/PROGRESS_LOG.md`, `docs/OPEN_QUESTIONS.md`, `docs/FOLLOWUPS.md`, `docs/PLAYTEST.md`, and `docs/FUN_FACTOR_AUDIT.md`.
- Verification: em-dash grep returned nothing.
- Assumptions: the GDD will be drafted under `docs/gdd/` at requirement granularity per the anti-Flatline guardrail in `docs/gdd/README.md`.
- GDD coverage: ledger created with two example rows; replace these with real requirements before opening any feature PRs.
- Followups: F-001 to draft the first GDD section (vision and pillars).