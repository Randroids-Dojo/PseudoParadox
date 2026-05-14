# Out of Scope (v1)

**Status:** not_started

This file is the explicit fence for the v1 prototype. Anything listed here has been considered and rejected for now. The loop must not scope-creep into these items without explicit user approval. If a slice tries to add code that implements an out-of-scope feature, that slice is wrong.

Items listed here can be revisited after the prototype ships. Each entry includes a one-line rationale so the future revisit has the original reasoning.

## Out for v1

- **Multiplayer (splitscreen or online).** Rationale: the single-player core loop is unproven. Multiplayer multiplies design surface and breaks the deterministic-replay model.
- **Multi-room or multi-level levels.** Rationale: the prototype's job is to prove a single-room puzzle works. Multi-room is a design problem for v2.
- **AI state tracking per instance (anger, energy, strength).** Rationale: rich. Adds simulation cost and design complexity before the core mechanic is proven fun.
- **Decades-scale narrative.** Rationale: the original concept gestures at older versions of the player meeting younger versions across years. This is post-prototype.
- **Portal variability (destinations that change after time thresholds).** Rationale: flagged in the original concept as a high-confusion-risk feature. Revisit only after the core fixed-portal loop is proven legible.
- **Killing or permanent removal of instances.** Rationale: knockouts are the only allowed disabling mechanic. Killing breaks the recorded-replay rule.
- **Save/load of in-progress timelines.** Rationale: a single prototype session is short. Hard reset is the only state operation in v1.
- **Localization beyond English.** Rationale: the game is largely text-free by design (diegetic UI). Localization is trivial when needed.
- **Mobile-first product scope beyond implemented touch controls.** Rationale: touch controls now exist for the web prototype, but phone-specific layout polish, mobile-only QA, and native mobile packaging remain post-v1.
- **Gamepad or controller input.** Rationale: keyboard and touch already cover the v1 web prototype's primary supported input surfaces. Gamepad adds a second focus, action mapping, and menu-navigation QA matrix that should wait until after the single-room puzzle is validated.
- **Custom level editor.** Rationale: only one level exists. Editor is not justified.

## Revisit triggers

Each item above gets revisited when at least one of:

1. The prototype is fully shipped and the playtest gate has resolved positively.
2. A user override explicitly authorizes the work.
3. A new design constraint forces the scope to expand (rare).

### Build log

- 2026-05-14: F-026 gamepad scope decision. Gamepad and controller input are explicitly deferred out of v1, while keyboard and touch remain the supported input surfaces for the prototype release. Files: `docs/gdd/99-out-of-scope.md`, `docs/PLAYTEST.md`, `docs/FOLLOWUPS.md`, `docs/PROGRESS_LOG.md`. PR #83.
