# Pseudo Paradox , Game Design Document

**Original Concept:** May 14, 2015  
**Design Session:** May 2026  
**Status:** Pre-production / Prototype Scope

---

## Table of Contents

1. [Original Concept](#original-concept)
2. [Executive Summary](#executive-summary)
3. [Creative Pillars](#creative-pillars)
4. [Time Travel Rules](#time-travel-rules)
5. [Story Structure](#story-structure)
6. [Mechanics](#mechanics)
7. [UI/UX Design](#uiux-design)
8. [Visual & Art Direction](#visual--art-direction)
9. [Tech Stack](#tech-stack)
10. [Prototype Scope](#prototype-scope)
11. [Future Considerations](#future-considerations)

---

## Original Concept

> *Written May 14, 2015. Preserved verbatim as design foundation.*

A player begins in one room with multiple portals. Player enters the portal and exits in the same room at a different time. The player may encounter his self from a different point in time once the timeline has been written.

**How is a timeline written?**

If the game starts at 5pm and the player travels back to 4pm, the player will see himself spawn after an hour passes in game, because the timeline from the point after the user spawned has been written. The original instance will see the new instance walk into the portal and disappear. If the original instance follows the new instance into this portal a few minutes later, two instances of the player will appear exactly at 4pm in the same location this time. Since this timeline has already been written. But if the original instance then travels to 5pm in a different portal, the player will see a new instance spawn just as before, but he will also see the instance he just left behind (the second instance ever spawned). But he will not see himself because he left that timeline just after 4pm.

**Meaning of the name:**

There will be no paradoxes in this game no matter what the user does. Even though it gets confusing, it will never contradict itself.

---

## Executive Summary

You wake up on the floor of a spaceship. In a slightly rectangular room. You are disoriented. You don't know who you are or how you got there. You look around and see a door on each wall. Do you dare enter?

Pseudo Paradox is a single-room time travel puzzle game. The player manipulates their own past instances , physically knocking them out, dragging their bodies, and coordinating their actions , to escape a room. Every action is deterministic. No paradoxes are possible. The confusion is the puzzle.

---

## Creative Pillars

Prioritized, in order:

1. **Interaction with multiple selves** , The core mechanic. Everything serves this.
2. **No paradoxes, ever** , Timelines are written and immutable. Player trust is non-negotiable.
3. **Sci-fi diegetic feel** , UI lives in the world. The room tells you everything.
4. **Logical puzzles** , Not contrived. Every puzzle is a natural extension of the situation.

---

## Time Travel Rules

- Timelines are **written by action**. Once you have done something in a time period, that action is permanent and will replay as a past instance.
- Past instances **replay recorded input** exactly. They cannot be changed, only worked around or physically redirected.
- Traveling through a portal does not erase your prior timeline , it adds to it.
- There are **no paradoxes**. You cannot prevent yourself from having done something you already did.
- Portals are **fixed in location** and do not change destinations.
- An **unvisited future** (a time period no instance has entered) contains no instances and no written events.

**Instance numbering:**

Each time a new instance enters the room, they are one generation further from the original. You1 is always the first-ever spawn. You-1 is the instance You1 sees arrive. You-2 is the instance You-1 sees arrive, and so on. The player always controls the most recently spawned active instance.

---

## Story Structure

### Act 1

Clock reads 12:00. Two people drag in a knocked-out body from the open North door to the center of the room. Fade to black.

Fade in. Clock reads 5:00. You are standing in the center of the room. The North door is dark (spawn-only). The South and East doors are lit (enterable). South goes back to 12:00 , if you go there, the two people will knock you out. East goes forward to 6:00, where the room is empty and only the West door is lit. The West door returns to 5:00.

### Act 2

Go East to 6:00, then back West to 5:00. You see another instance of yourself. It repeats what you did , it enters the West door and disappears.

Repeat the loop. This time, when you return to 5:00, knock out the other instance. Drag the body through the East door to 6:00. Wait for another instance to wake up. He knocks you out. Fade out.

### Act 3

Fade in. Clock reads 5:00. Repeat the Act 2 sequence to get a knocked-out instance at 6:00. Wait for the other instance to wake. This time, run toward the West door as he chases you. You both get pulled through and arrive at 5:00. Now there are two other instances present.

They are curious about each other. You and the instance from 6:00 team up , knock out the 5:00 instance. Drag him South to 12:00. Place the body in the center of the room, just as was done to you at the start. Knock out the instance you brought from 6:00. Run through the now-open North door , no one is left to stop you.

**Level complete.**

---

## Mechanics

### Core Interactions

| Mechanic | Description |
|---|---|
| Knock out | Fist fight another instance to render them unconscious |
| Pick up | Lift an unconscious instance |
| Drag / throw | Move an unconscious instance to a target location or through a portal |
| Wait | Stand in place while time progresses and instances arrive |
| Run / walk | Free analog movement through the room |

### Portal Interaction

- Walk into a lit door to travel to its fixed destination time.
- Dark doors are spawn-only exits , other instances emerge from them, you cannot enter.
- No destination is displayed. The player learns portal destinations through experience.

### Instance Replay

- Past instances replay previously recorded player input frame-by-frame.
- Their behavior cannot be altered , only physically interrupted (knockouts, repositioning bodies).
- Instances follow their recorded path even if the world around them has changed.

---

## UI/UX Design

Design philosophy: **almost everything is diegetic.** The room tells the player what they need to know. The one exception (floor ring) is minimal.

### Time Awareness

- A **digital readout clock** mounted on the wall displays the current time. Sci-fi appropriate, always visible, no HUD equivalent.
- The **room color** shifts continuously from warm amber (early) through cool blue (late) across the day arc. The room itself is the timeline.

### Instance Identity

- Each instance's **sprite tints to match the room color at the exact moment they last traveled**. Their glow is a living timestamp. A warm-amber instance standing in a cool-blue room is immediately readable as displaced in time.
- The **player's active instance** is indicated by a subtle UI ring on the floor underfoot , the only non-diegetic element.

### Door State

- **Lit doors** are enterable portals.
- **Dark doors** are spawn-only. You cannot enter them; instances only exit through them.
- No labels, no destination hints. Player knowledge is earned.

### Instance Behavior Preview

- A **minimal icon thought bubble** floats above each past instance indicating their immediate next action.
- Icons are simple: door arrow (about to travel), fist (about to fight), sleep symbol (unconscious), etc.
- No text. No timers. Just enough to coordinate without breaking immersion.

### Combat Feedback

- Knockouts are **pure ragdoll physics**. No glow flash, no screen effect. Physically readable, slightly absurd, tonally consistent.

### Failure State

- No warnings. No auto-rewind. No hand-holding.
- **Hard reset** is available in the pause menu only. The player owns their decisions.

---

## Visual & Art Direction

### Camera

- **Fixed isometric, open-top dollhouse view.** No ceiling visible. The room reads as a stage.
- Camera never moves or rotates. The space is always fully legible.

### Art Style

- **Flat graphic / graphic novel aesthetic.** Bold outlines, flat shading. No gradients, no realistic lighting.
- 2D illustrated sprites living in a 3D isometric environment (Paper Mario spatial logic, graphic novel visual language).

### Character Design

- **Anonymous astronaut spacesuit.** No face visible. Serves the narrative (you don't know who you are), removes facial animation requirements, and produces a clean readable silhouette at isometric scale.
- Asset source: Kenney.nl open-source sprite packs or AI-generated, consistent style.

### The Room

- **Slightly rectangular.** Not a perfect square , enough asymmetry to feel like a real space rather than a test chamber.
- One large open room. A door on each wall. Sparse set dressing to establish spaceship context without cluttering the play space.
- **No ceiling.** Open-top dollhouse view only.

### Time Tinting System

The room's color temperature shifts across a warm-to-cool spectrum as time progresses. This system does triple duty:

1. **Time signal** , warm = early, cool = late.
2. **Instance identifier** , each sprite tints to match the room color at their last travel moment.
3. **Environmental mood** , the room feels different at different times.

A warm-amber instance standing in a cool-blue room is visually displaced , their timestamp is visible at a glance.

---

## Tech Stack

**Target platform:** Web browser (no install, agent-codeable from CLI)

```
vite + typescript + three.js + @dimforge/rapier3d-compat
```

| Layer | Choice | Reason |
|---|---|---|
| Build tool | Vite | Instant dev server, hot reload, zero config |
| Language | TypeScript | Prevents agent type drift across sessions |
| Renderer | Three.js | Massive agent training surface, WebGL, isometric camera, billboard sprites |
| Physics | Rapier (WASM) | Rust-compiled, best web physics perf, ragdoll support, good TS bindings |

**Scaffold:**

```bash
npm create vite@latest pseudo-paradox -- --template vanilla-ts
cd pseudo-paradox
npm install three @types/three @dimforge/rapier3d-compat
npm run dev
```

**Why Three.js over Babylon.js:** Agent code generation accuracy scales with training data volume. Three.js has ~160x more weekly downloads than Babylon.js, meaning significantly more examples, patterns, and Stack Overflow coverage in agent training data. The extra assembly cost of wiring Three.js + Rapier disappears when an agent is writing the boilerplate.

---

## Prototype Scope

The prototype covers exactly Acts 1-3 in a single room. Success criteria:

- [ ] Player spawns in room at 5:00
- [ ] Four doors present , lit/dark state correctly reflects portal availability
- [ ] Room color tints across warm-to-cool spectrum over time
- [ ] Traveling through a door records player input and spawns a replaying instance
- [ ] Instances tint to their origin timestamp color
- [ ] Floor ring follows active player instance
- [ ] Thought bubble icons appear above instances before key actions
- [ ] Knockouts produce ragdoll
- [ ] Bodies can be picked up, dragged, and thrown through doors
- [ ] Act 1-3 sequence is completable
- [ ] Hard reset in pause menu

---

## Future Considerations

These were flagged during design but are out of prototype scope:

- **AI state tracking per instance** , Anger, Energy, Strength attributes that persist and shift across timeline generations. Larger instances are weaker or angrier based on what happened to them.
- **Multiplayer** , splitscreen or online, one player time-jumps first, the other follows and hunts the original instance. Mechanics for leaving objects or messages across time periods.
- **Multi-room / multi-level** , different portal configurations, different objectives, different times of day.
- **Decades-scale narrative** , final level revisits the first room with an older version of yourself alongside the younger instance. Prototype is a single room over a single day.
- **Portal variability** , portals that shift destinations after set time thresholds (flagged as high confusion risk, revisit only after core loop is proven).
