# Time Travel Rules

**Status:** not_started

The simulation rules that make the game internally consistent. These rules are non-negotiable. If a feature would require breaking one of these rules, the feature is wrong.

## Core rules

1. **Timelines are written by action.** Once a player has performed actions during a time period, those actions are permanent. They will replay as a past instance any time another instance witnesses that period from outside it.
2. **Past instances replay recorded input exactly.** They cannot be changed. They can only be worked around or physically redirected (knocked out, dragged).
3. **Traveling through a portal does not erase the prior timeline.** It adds to it. The player who steps into a portal continues to exist as a recorded instance in the timeline they just left.
4. **No paradoxes.** A player cannot prevent themselves from having done something they already did. The system must enforce this.
5. **Portals are fixed in location and destination.** A given door always leads to the same other time. Destinations do not change once set.
6. **An unvisited future contains nothing.** A time period that no instance has entered has no recorded events and no instances. Timelines spring into existence the first time they are visited.

## Instance numbering

Each time a new instance enters the room, they are one generation further from the original.

- **You1** is always the first-ever spawn (the seed instance, the one the player starts as in Act 1).
- **You-1** is the instance You1 sees arrive (the first replay).
- **You-2** is the instance You-1 sees arrive (the second-order replay).
- The player always controls the most recently spawned active instance.

## Portal types

- **Lit door.** Enterable. Sends the player to the door's fixed destination time.
- **Dark door.** Spawn-only exit. Other instances emerge from these. The player cannot enter them.

A door's lit/dark state is a function of where instances are arriving from in the recorded timeline, not a discoverable variable. The player learns destinations through experience, not through a label.

## Edge cases that must be addressed

- What happens when two instances enter the same portal in the same frame? (See `OPEN_QUESTIONS.md`.)
- What happens when an instance is unconscious as the recording plays back? (Specified in `09-mechanic-instance-replay.md`.)
- What happens if an instance is killed or removed? (Out of scope for v1; killing is not a mechanic. See `99-out-of-scope.md`.)

### Build log
