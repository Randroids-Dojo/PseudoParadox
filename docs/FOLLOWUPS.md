# Followups

Backlog spillover discovered during implementation. Keep items PR-sized when possible.

> **Critical convention.** Every followup must carry a `Priority:` tag. Three buckets:
> - `blocks-release`: cannot ship v1 without this.
> - `nice-to-have`: improves the product but does not block.
> - `polish`: post-release cleanup.

## How to add a followup

```
## F-NNN: Short title

- Priority: blocks-release | nice-to-have | polish
- Context: one or two sentences on why this came up.
- Blocker (if any): the condition that prevents working on this now.
- Unblock condition: what has to be true to start.
- PR / Dot reference (when picked up): #N or dots-N
```

Keep `F-NNN` IDs monotonically increasing. When a followup ships, leave the entry in place and append a `- Resolved: PR #N` line. Never delete.

## Blocks Release

(none yet)

## Nice To Have

### F-002: Author missing GDD section files

- Priority: nice-to-have
- Context: `docs/gdd/02-time-travel-rules.md` references `09-mechanic-instance-replay.md` and `17-ui-failure-state.md`, neither of which has been authored. Visual and art direction (camera, art style, character, room geometry) and mechanics detail (knockout, pickup, drag, throw) also exist only in the legacy root `GDD.md` and need their own section files at the requirement granularity used by the coverage ledger.
- Blocker: none.
- Unblock condition: pick a GDD section (camera, art style, character design, room geometry, instance replay mechanic, UI failure state) and draft it as `docs/gdd/<NN>-<title>.md`. Add atomic coverage rows to `docs/GDD_COVERAGE.json` once the spec lands.
- PR / Dot reference (when picked up):

### F-003: Specify hard reset UX

- Priority: nice-to-have
- Context: REQ-025 calls for hard reset in the pause menu. Pause menu UX has not been specified yet (input binding, confirmation flow, visual treatment).
- Blocker: pause menu does not yet exist.
- Unblock condition: at least one playable build is shippable end-to-end so reset semantics can be reasoned about against real timeline state.
- PR / Dot reference (when picked up):

### F-004: Consolidate or remove legacy root GDD.md

- Priority: nice-to-have
- Context: `GDD.md` at the repo root is the original monolith. The canonical GDD now lives under `docs/gdd/` as a tree. Keeping the monolith risks drift between two sources of truth.
- Blocker: not all original GDD content has been migrated to tree files yet (camera, art, character, room, mechanics detail).
- Unblock condition: F-002 lands the missing section files. Then either delete `GDD.md` or replace it with a stub that points at `docs/gdd/`.
- PR / Dot reference (when picked up):

## Polish

(none yet)

## Resolved

### F-001: Draft first GDD section

- Priority: nice-to-have
- Context: scaffold landed; the seed `docs/gdd/01-vision-and-pillars.md` had not been drafted yet at the time the followup was filed.
- Blocker: none.
- Unblock condition: dev provides one paragraph of vision text or approves a draft.
- Resolved: 2026-05-08. Five GDD section files were drafted (`01-vision-and-pillars.md`, `02-time-travel-rules.md`, `03-story-acts-1-3.md`, `23-prototype-scope.md`, `99-out-of-scope.md`) before the audit-remediation slice picked up the followup.
