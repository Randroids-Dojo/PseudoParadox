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

### F-007: Rehome a thrown body across timelines on portal traversal

- Priority: nice-to-have
- Context: REQ-036 (PR #27) ships throw with portal traversal. The in-flight registry teleports the body's translation and preserves velocity on a lit-portal enter, but the body remains a `GhostInstance` filed in its source `TimelineRegistry` bucket. Concretely: a thrown body launched at 5:00 across the south door teleports to the room-center spawn pose at 12:00, but the underlying ghost is still bookkept in the 5:00 timeline. When the player switches timelines, the ghost is hidden by `setActiveTimeline`; on return to 5:00 the ghost's `reset()` call snaps it back to the 5:00 spawn position, erasing the thrown trajectory's destination state. The thrown body is therefore not visible in the 12:00 timeline at all. CodeRabbit flagged this on PR #27 as the "Surface timeline transfer when a thrown body traverses" review.
- Blocker: cross-timeline rehoming for a body that is itself a ghost is heavier than the slice scope (the carry layer files thrown bodies as ghost-body references; the in-flight registry would need to either own its own non-ghost flying-body type or call back into the host so the host can rehome the ghost between TimelineRegistry buckets). The thrown-body persistence at the destination timeline is also a gameplay decision: the dossier section 7 says the body "is IN the 12:00 timeline as a body" but does not specify whether subsequent visits to 5:00 still see the body in flight or settled at its destination.
- Unblock condition: dossier amendment specifying the thrown body's persistence semantics across timeline visits (does the destination timeline see the body settle? does the source timeline see the body absent? do both timelines see it depending on when the player visits?), then a slice that either splits in-flight bodies into a new dedicated entity type or wires the in-flight registry's lit-traversal events through to the host's TimelineRegistry for rehoming.
- PR / Dot reference (when picked up):

### F-006: Unify the door-paint path through `litStateForTimeline`

- Priority: nice-to-have
- Context: REQ-011 lands the seed-and-arrivals seam at the runtime gate (`isLitForCurrentTimeline` in `src/sim/portalTraversal.ts`) but leaves the visual paint path (`repaintDoorsForHour` in `src/sim/timelineRoom.ts`, the room-build paint in `src/scene/room.ts`) reading `doorLitStateAtHour(hour)` directly. The two paths agree today because the arrivals stub returns `false`. Once Acts 2-3 introduce a non-trivial arrivals rule (e.g. the West door at 5:00 lighting once a You-1 has arrived from 6:00), the paint path will need the same registry-aware computation or visual and behavior will drift.
- Blocker: none. The unification is straightforward; deferred only because doing it now would be a no-op behavior change and slice discipline says wait for the third repetition.
- Unblock condition: either a slice introduces a non-trivial arrivals rule (Act 2 / Act 3) and routes both call sites through `litStateForTimeline`, or a small refactor slice unifies the two ahead of that.
- PR / Dot reference (when picked up):

### F-005: CodeRabbit usage credits exhausted

- Priority: nice-to-have
- Context: PR #4 (`feature/player-capsule`) opened on 2026-05-08 received only an initial walkthrough comment, then CodeRabbit replied with a rate-limit warning indicating "You've run out of usage credits. Purchase more in the billing tab." The status check resolved to SUCCESS without producing any actual line-level review feedback. The autonomous loop merged PR #4 on a CLEAN merge state with no actionable comments outstanding.
- Blocker: paid CodeRabbit usage caps a non-engineering action (billing).
- Unblock condition: top up CodeRabbit credits in `app.coderabbit.ai/settings/subscription`, or accept that reviews on the PRs filed during the rate-limit window were a free-pass.
- PR / Dot reference (when picked up):


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
