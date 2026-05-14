# Visual and Art Direction

**Status:** partial

This section is the canonical visual contract for the prototype camera, room, character presentation, and time tinting. It migrates the legacy root `GDD.md` visual direction into the GDD tree while accounting for shipped camera and rendering behavior.

## Scope

Visual direction covers:

- Camera framing and user camera gestures.
- Room shape, wall treatment, and door readability.
- Character readability and identity.
- Flat graphic tone.
- Time tinting for the room and instances.

It does not cover audio, detailed animation polish, or production asset sourcing.

## Core Requirements

- **REQ-050: Dollhouse camera.** The game uses an orthographic, open-top dollhouse camera that keeps the single room legible.
- **REQ-051: Controlled camera gestures.** Camera orientation stays fixed, but the player may use bounded pan and zoom controls for inspection.
- **REQ-052: Single-room geometry.** The playable space is one open rectangular room with four wall-mounted doors, one per cardinal wall, and no ceiling occluding the view.
- **REQ-053: Time tinting.** Room, door, and instance colors use warm-to-cool time language so timeline origin and current time are readable.
- **REQ-054: Anonymous self silhouette.** Player and past instances must remain anonymous, face-free, and readable at isometric scale.
- **REQ-055: Flat graphic tone.** The final visual style should read as flat, graphic, and lightly illustrated rather than physically realistic.

## Camera

The default camera is orthographic, high, and angled into the room. The room should read like a cutaway stage:

- The camera sees the floor and the useful wall faces.
- No ceiling is rendered.
- The whole room fits in frame at default zoom.
- Camera orientation does not rotate during gameplay.

The legacy GDD says the camera never moves. The shipped prototype refines this: the orientation remains fixed, but the user can pan and zoom within bounded limits for inspection. This keeps the room readable while supporting touch and desktop comfort.

Current gesture contract:

- Mouse wheel zooms on desktop.
- Two-finger pinch zooms on touch devices.
- Right-click drag pans on desktop.
- Two-finger drag pans on touch devices.
- Pan is bounded to the room half-width.
- Left-click drag remains free for future gameplay UI.

## Room

The room is intentionally simple:

- One open space, no separate rooms or corridors.
- Four doors, one centered on each wall.
- No ceiling.
- Sparse spaceship context only, so puzzle state stays readable.

The legacy GDD asks for a slightly rectangular room. The current implementation uses a 10 x 10 meter prototype footprint because the door, trigger, and act-state tests were authored against a symmetric room. A future art pass may stretch the presentation subtly if it does not disturb portal timing or collision tests.

## Character Presentation

The narrative requires the player not to know who they are, and the puzzle requires multiple versions of the same person to remain readable. Characters therefore must be:

- Anonymous.
- Face-free.
- Strongly silhouetted.
- Tintable by time of origin.
- Readable at small isometric scale.

The long-term art target is an anonymous astronaut suit. The shipped prototype uses tintable capsule bodies as a mechanical placeholder. That placeholder satisfies anonymity, silhouette, and tint readability, but does not yet satisfy the astronaut-suit art target.

## Flat Graphic Tone

The desired style is flat graphic, close to a graphic novel or paper-doll stage rather than realistic lighting. In practice:

- Prefer clear shapes over surface detail.
- Avoid noisy textures.
- Avoid realism-driven clutter.
- Preserve high contrast between bodies, doors, and the floor.
- Keep gameplay state readable before visual flourish.

The current implementation uses simple Three.js primitives and flat material colors. That is acceptable for prototype readability, but it is not the final illustrated art style.

## Time Tinting

Time tinting does three jobs:

1. It signals the current timeline.
2. It identifies the origin time of an instance.
3. It changes the room mood as time changes.

The active player and ghosts carry an origin tint stamped from their timeline origin. A warm instance in a cooler room should read as temporally displaced at a glance.

Tinting must remain secondary to legibility. If a tint makes a door state, body, thought bubble, or HUD unreadable, gameplay readability wins.

## Non-goals

- No orbit camera in v1.
- No first-person or over-the-shoulder camera in v1.
- No realistic material pass in v1.
- No detailed facial animation.
- No production asset pipeline decision in this section.

### Build log

- 2026-05-14: F-002 visual migration. Authored this section from the legacy root `GDD.md`, current camera gesture implementation, room geometry, player capsule, and time-tinting helpers. Runtime behavior is unchanged. Status is partial because the shipped capsule placeholder does not yet satisfy the long-term anonymous astronaut suit target, and the current primitive materials do not yet satisfy the final flat illustrated art target. Files: `docs/gdd/08-visual-and-art-direction.md`, `docs/GDD_COVERAGE.json`, `docs/FOLLOWUPS.md`, `docs/PROGRESS_LOG.md`. PR TBD.
