# Mechanic: Instance Replay

**Status:** done

This section is the canonical rule text for how recorded instances replay, how they can be physically interrupted, and what happens when a replaying instance becomes unconscious.

## Scope

Instance replay covers the behavior of any non-active instance created from an `InputRecording`.

- The recording is immutable once captured.
- The replay session can be affected by physical events in the room.
- Physical events do not rewrite the recording.
- Each timeline visit starts a fresh replay session for every ghost in the entered timeline bucket.

This section refines [02-time-travel-rules.md](02-time-travel-rules.md), especially the rule that past instances cannot be changed, only worked around or physically redirected.

## Core Requirements

- **REQ-041: Recording immutability.** A replaying instance reads from a frozen recording. No collision, knockout, carry, throw, portal traversal, or reset can mutate the captured frames.
- **REQ-042: Replay session state.** Consciousness, position, velocity, visibility, and tick cursor are runtime session state. They can change during a timeline visit and reset on the next entry to that timeline.
- **REQ-043: Physical interruption.** A replaying instance may be knocked out, bumped, carried, dragged, or thrown if the appropriate mechanic targets its body. The interruption affects the current replay session only.
- **REQ-044: No paradox rewrite.** Interrupting a replaying instance does not delete or rewrite the fact that the instance originally performed the recorded inputs.

## Replay Model

An instance recording stores per-tick player input plus the time context needed by replay systems. During playback, the ghost reads the frame at its current tick and writes the corresponding intended planar motion into its Rapier body.

If the tick cursor is past the end of the recording, replay writes zero planar motion. The body remains physical and can still be pushed by Rapier, gravity, throws, or carry systems.

The active timeline registry controls which replay sessions are visible and advancing:

- When the player leaves a timeline, its ghosts are hidden and stilled.
- When the player enters a timeline, each ghost in that timeline bucket resets to its tick-0 pose and starts a fresh replay session.
- Hidden ghosts remain filed in their timeline bucket. They are not deleted unless hard reset clears the run.

## Unconscious During Playback

If a replaying instance becomes unconscious during a replay session:

- Its consciousness flips from `conscious` to `unconscious`.
- Its recorded frames remain intact.
- Its future replay motion for the current session is suppressed to zero planar velocity while unconscious.
- The tick cursor may continue to advance so lookahead, thought bubbles, and replay bookkeeping stay on the same timeline clock.
- The body remains a physical unconscious body that can be picked up, dragged, thrown, and carried through portals by other instances.

The key distinction is recording versus session. The recording still says what the instance tried to do. The session says the body is now unconscious and cannot execute those inputs in this visit.

## Portal Behavior

Voluntary lit-portal traversal by the active player closes that active lifetime and files a new ghost into the source timeline. A replaying ghost does not create another lifetime merely because its recording contains a past traversal. Instead, replay and timeline bookkeeping use the recorded movement plus the active registry rules to present the correct instance in the correct timeline bucket.

If a physical body is carried or thrown through a lit portal, the body movement is owned by the carry or throw mechanic, not by instance replay. Those mechanics decide whether the body is rehomed to a destination timeline bucket or remains attached to a carrier.

## Determinism

Replay determinism depends on three invariants:

1. Captured frames are deeply frozen.
2. The same fixed-step clock advances replay.
3. Runtime interruptions are deterministic consequences of bodies, inputs, and timeline state present at the same tick.

The no-paradox contract only requires that recorded inputs persist. It does not require a ghost to successfully finish every recorded action after the player has physically interrupted the ghost.

## Non-goals

- No AI deviation from recorded inputs.
- No auto-correction back onto the recorded path after a physical interruption.
- No revival from unconscious inside the prototype scope.
- No killing or permanent removal of instances.

### Build log

- 2026-05-14: F-002 spec consolidation. Authored this missing section from the legacy root `GDD.md`, current replay implementation, `02-time-travel-rules.md`, and `30-combat-and-interaction.md`. This is a docs-only slice; runtime behavior is unchanged. Files: `docs/gdd/09-mechanic-instance-replay.md`, `docs/GDD_COVERAGE.json`, `docs/FOLLOWUPS.md`, `docs/PROGRESS_LOG.md`. PR #74.
