# GDD: Pseudo Paradox

> **Anti-Flatline guardrail.** This GDD is a directory tree, not a single file. Each requirement is its own file. Coverage rows in `docs/GDD_COVERAGE.json` are written at requirement granularity, NOT chapter granularity. A multi-week project should produce on the order of 100+ rows, not 11. If you only have a dozen rows, your coverage is too coarse and the loop will self-terminate before the product is good.

Project pitch: Single-room time travel puzzle game where you escape by manipulating your own past selves

## How to use this directory

- Each `docs/gdd/<n>-<title>.md` file is one requirement or one tightly-scoped section.
- Each file starts with a `Status:` line: `Status: not_started` | `Status: partial` | `Status: done`
- Once a file's work ships, append a `### Build log` section with what landed, the key files, and any non-obvious decisions. Build logs grow with the code.
- Keep file names short and stable. The file path is referenced from `GDD_COVERAGE.json`.

## Conventions

- One requirement, one file, one row in the coverage ledger.
- File names: `<NN>-<kebab-title>.md`, e.g. `05-vehicle-physics.md`, `12-leaderboard-submit.md`.
- Cross-references between sections use relative links.
- The em-dash ban applies here.

## Index

Add entries below as sections are drafted. Each entry: filename + one-line description. This index is the human-readable map; the machine-readable map is `docs/GDD_COVERAGE.json`.

- `01-vision-and-pillars.md`: what Pseudo Paradox is and what it is not.
- `02-time-travel-rules.md`: permanent timeline, portal, numbering, and no-paradox rules.
- `03-story-acts-1-3.md`: playable Act 1 through Act 3 sequence and narrative beats.
- `08-visual-and-art-direction.md`: camera, room, character, tinting, and flat graphic visual direction.
- `09-mechanic-instance-replay.md`: recorded-instance replay, physical interruption, and unconscious playback rules.
- `17-ui-failure-state.md`: dead-end, hard-reset, and win-state recovery rules.
- `23-prototype-scope.md`: shippable prototype boundaries.
- `30-combat-and-interaction.md`: knockouts, pickup, drag, throw, and thought-bubble rules.
- `40-act-progress-and-narrative-beats.md`: act-state gates and narrative beat predicates.
- `99-out-of-scope.md`: explicit v1 scope fence.

## Out of scope

A dedicated `docs/gdd/99-out-of-scope.md` file is the explicit fence. List anything that has been considered and rejected for v1, with a one-line rationale. The loop must not scope-creep into items listed there without approval.
