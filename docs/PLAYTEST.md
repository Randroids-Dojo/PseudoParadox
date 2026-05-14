# Release Playtest Checklist

> **The second gate.** When all coverage rows in `docs/GDD_COVERAGE.json` are `done`, this checklist becomes the active backlog. The loop is not finished until every item here is checked or explicitly deferred to a future release.
>
> This exists because shipping a complete-on-paper system is not the same as shipping a good system. Coverage rows track *systems*; this checklist tracks *experience*. Both gates must close.

## How to use this doc

- Each section captures one experience-level question the systems-level coverage will not catch.
- Items use `[ ]` checkboxes. Check when the experience is verified (live playtest, recorded session, or qualitative review).
- An item that fails review becomes a new `F-NNN` entry in `docs/FOLLOWUPS.md` with `Priority: blocks-release`.
- Re-run the relevant section after any large system lands.

## First 90 seconds

The window where a new player decides whether to keep playing.

Review status, 2026-05-14 qualitative second-gate audit: F-016, F-017, F-018, F-020, F-021, and F-022 address the original first-session polish gaps. Remaining proof that needs a real browser session is tracked by F-025.

- [x] First-time experience does not require external instructions. The user understands the goal within 30 seconds. Verified by the onboarding controls and objective overlay from PR #68.
- [x] First input has a visible, satisfying response (sound, motion, particle, animation). Verified by movement response, audio unlock behavior, and action feedback from PR #70 and PR #72.
- [x] No dead ends, modal dialogs, or auth walls in the first minute. Verified by qualitative review of the current boot path and pause-menu behavior.
- [x] If the user does nothing, the screen still communicates what to do. Verified by the ambient onboarding overlay from PR #68.
- [x] First completion of the core action delivers a clear positive signal. Verified by punch audio and animated knockout feedback from PR #70 and PR #72.

## Core loop fun

The minute-to-minute moment-to-moment quality.

- [x] The core action is satisfying when performed perfectly. Verified by the combined punch sound and knockout animation pass from PR #70 and PR #72.
- [x] The core action is satisfying when performed imperfectly (no harsh punishment for trying). Verified by qualitative review: missed attempts do not punish the player or corrupt the timeline.
- [x] The user can tell, without reading the HUD, whether they are doing well. Verified by lit door state, ghost count / placement, win overlay, and world-state changes. F-024 tracks a required accessibility improvement for non-color door state.
- [ ] Repetition does not become tedious within a 5-minute session. Deferred to F-025 real 15-minute release playtest.
- [x] Difficulty curve has clear progression. Plateaus are intentional. Verified by the authored Act 1 to Act 3 sequence and end-to-end escape regression.

## Variety and surprise

- [x] At least three meaningfully different situations / opponents / states / levels exist. Verified by Act 1, Act 2, and Act 3 state progressions.
- [x] Each variation feels distinct from the others, not a recolor. Verified by different ghost configurations, carried-body beats, chase / mirror / final-knockout beats, and the anonymous astronaut pass from PR #79.
- [x] Random elements (where applicable) produce surprise without producing frustration. Not applicable for v1 because puzzle progression is authored and deterministic.

## Session arc

The length of time a user wants to play in one sitting.

- [x] A session has a clear in / play / out flow. The user can stop cleanly. Verified by onboarding, pause reset confirmation, and win screen flow from PR #68, PR #78, and PR #69.
- [x] Progress persists between sessions (saves, leaderboards, profile, settings). Deferred for v1: `docs/gdd/99-out-of-scope.md` keeps persistence, profiles, and leaderboards out of scope.
- [x] Returning users get a "welcome back" signal (recent items, new options, last-played continuation). Deferred for v1 with the same persistence / profile out-of-scope decision.

## Audio and feel

- [ ] No audio loop is fatiguing after 5 minutes. Deferred to F-025 real 15-minute release playtest.
- [x] Audio reinforces successful actions (positive cues) and warns of failure conditions (negative cues). Verified by punch, door, escape, and ambient audio from PR #70.
- [ ] The user can mute / adjust audio without leaving the experience. Failing, tracked by F-023.

## Performance and reliability

- [ ] Frame rate stays inside acceptable bounds on the lowest target hardware. Deferred to F-025 real 15-minute release playtest. F-008 still tracks optional real-browser automation after dependency approval.
- [ ] No reproducible crash, hang, or visual artifact in 15 minutes of play. Deferred to F-025 real 15-minute release playtest.
- [x] Loading times are acceptable, or are masked by something the user enjoys watching. Verified by current Vercel production smoke and build output; no loading blocker observed.

## Accessibility

- [ ] Text is readable at the smallest target screen size. Deferred to F-025 real 15-minute release playtest across the smallest target viewport.
- [ ] Color is not the sole channel for any critical information. Failing for lit / dark door state, tracked by F-024.
- [ ] Keyboard / gamepad / touch parity is maintained for all primary actions. Keyboard and touch parity are implemented. Gamepad scope is unresolved and tracked by F-026.
- [ ] Motion-sensitive users have a "reduce motion" path. Failing, tracked by F-023.

## Deferred

Items intentionally pushed to a future release. Each one names the release.

- Persistence and returning-user affordances are deferred for v1 by `docs/gdd/99-out-of-scope.md`.
- Random variation checks are not applicable for v1 because puzzle progression is authored and deterministic.
