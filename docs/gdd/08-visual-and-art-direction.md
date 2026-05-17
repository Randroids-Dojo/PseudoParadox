# Visual and Art Direction

**Status:** done

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

The shipped visual target is a chunky kid's-playset figurine (Kenney Mini Characters, CC0), loaded as a GLB at boot and cloned per instance. The figure keeps the original capsule collider alignment so physics, replay, and knockout behavior are unchanged; the only visual delta is the body mesh swap. The procedural anonymous-astronaut mesh (capsule body, face-free visor, arms, boots, backpack) remains in the codebase as a synchronous fallback used by tests and by any boot path where the GLB fetch fails. The chunky toy proportions read at isometric scale without giving the character a distinct identity, and the warm-to-cool origin tint multiplies against the figurine's colormap texture so a 5:00 spawn reads amber and a 12:00 spawn reads cool blue without going translucent.

## Flat Graphic Tone

The desired style is flat graphic, close to a graphic novel or paper-doll stage rather than realistic lighting. In practice:

- Prefer clear shapes over surface detail.
- Avoid noisy textures.
- Avoid realism-driven clutter.
- Preserve high contrast between bodies, doors, and the floor.
- Keep gameplay state readable before visual flourish.

The current implementation uses simple Three.js primitives, flat material colors, and high-contrast suit parts. It is intentionally closer to a paper-doll stage prop than a realistic space suit.

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

- 2026-05-17: Reconcile knockout mesh tilt with the GLB die clip. `applyKnockoutBodyResponse` and the host's `knockoutAnimator.start` call site now both skip the 90 degree `rotation.z` tilt when the mesh carries a `characterAnimator` in `userData`. The skeletal `die` clip slumps the figurine on its own, so the prior mesh-level tilt was double-rotating the body. The procedural-capsule fallback still receives the tilt because no die clip exists there. Files: `src/sim/applyKnockoutBody.ts`, `src/app.ts`, `tests/sim/applyKnockoutBody.test.ts`.
- 2026-05-17: State-driven animation clips. `updateCharacterAnimation` now consumes a `{ consciousness, carrying }` state and selects with priority `die` (unconscious) > `holding-both` (carrying) > `walk` (moving) > `idle`. Yaw lerping is suppressed while unconscious so a knockout freezes the facing. A new `triggerPunchAnimation` plays `attack-melee-right` as a one-shot via `CharacterAnimator.triggerOneShot` (`LoopOnce` + `clampWhenFinished`), and locks out base-clip changes until the clip's duration elapses. `src/app.ts` fires the swing for every conscious punch-flag actor each tick, so misses and ghost replays both animate. Resolves F-027. Files: `src/scene/characterModel.ts`, `src/app.ts`, `docs/FOLLOWUPS.md`.
- 2026-05-17: Figure faces travel direction. `updateCharacterAnimation` now also lerps the parent mesh's `rotation.y` toward `Math.atan2(velocity.x, velocity.z)` whenever planar speed exceeds the walk threshold, at `TURN_SPEED_RAD_PER_SEC = 14` rad/sec. Physics yaw is left untouched (the body remains yaw-locked at zero); facing is a purely visual concern read each frame from the body's `linvel`, so ghost replay determinism is preserved without recording a yaw track. While idle the figure freezes at its last-known facing instead of snapping to a default. Files: `src/scene/characterModel.ts`.
- 2026-05-17: Skinned-mesh cloning fix + locomotion animation. The initial figure swap used `Object3D.clone`, which does not rebind a `SkinnedMesh` to a cloned skeleton, so the figurine stayed at world origin even when the parent mesh moved. `cloneCharacterModel` now uses `SkeletonUtils.clone` from `three/examples/jsm/utils/SkeletonUtils.js` so each instance has its own skeleton and bones follow the parent. Each clone also gets a per-instance `AnimationMixer` bound to the same subtree, starts the `idle` clip on construction, and `updateCharacterAnimation` cross-fades to `walk` once planar speed exceeds `WALK_ANIM_SPEED_THRESHOLD = 0.2`. The mixer is advanced in the render-frame loop with the real delta time so animation stays smooth even when physics steps are scarce. F-027 is partial (carry / knockout / punch / interact clips still bind-pose). Files: `src/scene/characterModel.ts`, `src/scene/astronaut.ts`, `src/app.ts`, `docs/FOLLOWUPS.md`.
- 2026-05-17: Character figure swap. Replaced the procedural anonymous-astronaut mesh with the Kenney Mini Characters chunky-toy figurine (CC0, GLB) loaded at boot and cloned per instance. Procedural mesh kept as a synchronous test/offline fallback. `applyInstanceTint` now traverses child meshes so the warm-to-cool origin tint multiplies against the figurine's colormap. Animations from the GLB are not yet wired. Files: `public/models/character-male-a.glb`, `public/models/Textures/colormap.png`, `public/models/LICENSE-kenney-mini-characters.txt`, `src/scene/characterModel.ts`, `src/scene/astronaut.ts`, `src/render/instanceTint.ts`, `src/app.ts`, `docs/gdd/08-visual-and-art-direction.md`.
- 2026-05-14: F-024 non-color door-state affordance pass. Added door child geometry that distinguishes traversable lit doors from blocked dark doors by shape, not color alone: lit doors show a raised ring, and dark doors show a diagonal blocked bar. Files: `src/scene/door.ts`, `tests/scene/door.test.ts`, `tests/scene/doorVisualLit.test.ts`, `docs/FOLLOWUPS.md`, `docs/PLAYTEST.md`, `docs/PROGRESS_LOG.md`. PR #82.
- 2026-05-14: F-021 anonymous astronaut pass. Replaced the plain capsule presentation with a tintable parent capsule plus child visor, arms, boots, and backpack geometry for both the active player and ghosts. Physics colliders and replay behavior are unchanged. Files: `src/scene/astronaut.ts`, `src/scene/player.ts`, `src/sim/ghostInstance.ts`, `tests/scene/astronaut.test.ts`, `tests/scene/player.test.ts`, `tests/sim/ghostInstance.test.ts`, `docs/GDD_COVERAGE.json`, `docs/FOLLOWUPS.md`, `docs/PROGRESS_LOG.md`. PR #79.
- 2026-05-14: F-002 visual migration. Authored this section from the legacy root `GDD.md`, current camera gesture implementation, room geometry, player capsule, and time-tinting helpers. Runtime behavior is unchanged. Status is partial because the shipped capsule placeholder does not yet satisfy the long-term anonymous astronaut suit target, and the current primitive materials do not yet satisfy the final flat illustrated art target. Files: `docs/gdd/08-visual-and-art-direction.md`, `docs/GDD_COVERAGE.json`, `docs/FOLLOWUPS.md`, `docs/PROGRESS_LOG.md`. PR #75.
