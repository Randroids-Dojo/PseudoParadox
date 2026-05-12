# Fun Factor Gap Audit

> **Backlog generator.** Run this audit when `docs/GDD_COVERAGE.json` is ≥80% `done`. Re-run after every major system lands. This is the source of the P0 / P1 polish work that prevents the loop from terminating before the product is good. Each gap identified here becomes a `Q-NNN` open question or an `F-NNN` followup.
>
> This doc exists because the Flatline failure mode is: every coverage row is `done`, every test passes, every checkbox is green, but the product is not actually fun. Coverage rows say a *system* exists. They cannot say the system *delivers experience*. This audit asks the questions coverage cannot.

## How to run an audit

1. Set today's date as the audit header (`## Audit YYYY-MM-DD`).
2. Walk each prompt below. Write a one-sentence answer for each. Be honest. "Yes" answers do not generate work; gaps do.
3. For each gap, decide: is this a question (`Q-NNN`) or a followup (`F-NNN`)?
4. Add the entry. Reference the audit date in the entry's Context line.
5. Save the audit. Do not delete previous audits; let the file grow.

Append-only. Earlier audits are preserved.

## Prompts

### The first session

- Does the first 90 seconds make the player want to keep playing?
- What is the first specific moment that surprises a new user (positive or negative)?
- Where does a new user get stuck or confused?

### The core action

- Does the core action feel good at every skill level (novice, mid, expert)?
- Is there meaningful skill expression? Can two players visibly perform differently at the same task?
- Does the core action have texture (light cues, weight, follow-through), or does it feel binary?

### Variety

- Do the variations within the system feel distinct, or do they feel like recolors?
- If the player picks a "different" option (track / character / mode / layout), do they have a different experience?
- Is there a surprise still waiting for a player who has played for an hour?

### Difficulty arc

- Where is the difficulty too high (frustration without learning)?
- Where is the difficulty too low (boredom)?
- Is there a clear "I want to keep going to get better" pull?

### Stickiness

- What brings a player back the next day?
- What makes a player tell a friend about this?
- What is the smallest change that would meaningfully improve retention?

### Polish you have been postponing

- List up to five "we know this needs work" items you have been quietly avoiding. Be specific.
- For each, name the smallest slice that would meaningfully address it.

## Audit log

### Audit 2026-05-12

First fun-factor audit. Run when `docs/GDD_COVERAGE.json` reached 100% done (all 40 rows shipped). The mechanics substrate (time-loop, ghost replay, knockout, carry, throw, portal traversal, act-state observer, Act 3 escape) is fully landed. This audit asks the next question: does any of it feel good to play?

Method: read the actual shipped code paths from input event to scene mutation. No live playtest yet. The findings below are based on what is in the build at https://pseudo-paradox.vercel.app as of 2026-05-12.

**The first session**

- *Does the first 90 seconds make the player want to keep playing?* No. The player lands on a black background, sees a single warm-amber capsule in a grey room with four doors (two lit). There is no audio, no instruction text, no goal indicator. The only on-screen text is "Pseudo Paradox prototype" in the top-left corner (`index.html:46`). A player who does not already know the rules has no path to discovery.
- *What is the first specific moment that surprises a new user?* Probably negative: walking into a dark portal does nothing. The lit-vs-dark door semantic is invisible at first glance (both look like doors); the player's first traversal attempt silently fails. The first positive surprise lands when a ghost spawns after the first return loop, which is also the first moment the player has feedback that something is happening across time.
- *Where does a new user get stuck or confused?* Three places: (1) discovering the lit / dark portal rule, (2) discovering that punching past-self ghosts is the win mechanic, (3) discovering that escape requires reaching the North door at 12:00. All three are pure discovery; nothing in the build hints at them.

**The core action**

- *Does the core action feel good at every skill level?* No. The punch has no audio, no particle, no screen shake. The knockout tilt animation is instantaneous rather than a flip with anticipation and follow-through. The hit feels weightless even when it lands cleanly. Pickup and throw are similarly instant snaps.
- *Is there meaningful skill expression?* Yes in route-planning: an expert plans multi-loop sequences with knockouts ordered to enable later beats. No in moment-to-moment input: there is no aim, no timing window, no whiff penalty. Punch is binary in-range / out-of-range.
- *Does the core action have texture?* No. Punch has no wind-up frame, no successful-hit feedback beyond the target's instant rotation, no failure-to-connect feedback. Doors have no open / close animation. Portal traversal cuts via fade-to-black overlay only in the Act 3 cinematic; ordinary traversal teleports the player without a transition.

**Variety**

- *Do the variations feel distinct, or like recolors?* The acts are mechanically distinct (Act 1 spawn, Act 2 loop, Act 3 setup / chase / team-up / mirror / final knockout) but visually identical. Acts 1, 2, 3 all render in the same 5:00 AM amber-tinted room with the same capsule meshes and the same door geometry. The room tint does not change between acts even though the time-of-day clock advances; the player infers act progress from ghost behavior alone.
- *Different option = different experience?* N/A. There are no character / track / mode / difficulty options. The game is linear.
- *Surprise still waiting after an hour?* Yes for the puzzle: the multi-loop choreography continues to reveal itself once the player understands the substrate. No for the moment-to-moment: every punch and traversal looks and feels the same as the first one.

**Difficulty arc**

- *Too high?* Yes at the very start, because nothing teaches the rules. The lit / dark rule and the punch-past-self mechanic are discovery-only. A player who does not have the GDD open beside them will probably bounce.
- *Too low?* Once mechanics are understood, the puzzle solution is mostly path memorization rather than execution skill. There is no failure state that re-tests the player; pressing R hard-resets the simulation with no penalty.
- *Clear "I want to keep going to get better" pull?* For puzzle-curious players, yes (the next loop's behavior is interesting to predict). For action-curious players, no (there is no audiovisual reward escalation; the 10th punch feels exactly like the 1st).

**Stickiness**

- *What brings a player back the next day?* Currently nothing. There is no save state, no progress tracking, no daily / leaderboard. Hard reset wipes all state on every page reload. (Save / load is explicitly out of scope per `docs/gdd/99-out-of-scope.md`, so this is intentional for v1.)
- *What makes a player tell a friend about this?* The time-loop concept itself is interesting; the "punch your own past" mechanic is novel. Both are conversational hooks even without polish.
- *Smallest change for retention?* A "you escaped!" end card with a "play again" button. Currently the escape state is silent: the simulation continues running, no UI signals the win, the player must press R unprompted.

**Polish you have been postponing**

Five items, ranked by impact on the first-90-seconds gate first:

1. **Onboarding controls / objective overlay**: corner DOM overlay listing WASD / SPACE / F / T / R + a short objective hint ("escape through a lit door"). Fade or hide after first input. Closes "First-time experience does not require external instructions" and "If the user does nothing, the screen still communicates what to do."
2. **Win screen on escape**: fade-to-white overlay with "You escaped." and a "Play again (R)" prompt when `ActState === 'escaped'`. Closes "A session has a clear in / play / out flow. The user can stop cleanly."
3. **Audio pass (minimum viable)**: three sound effects (punch land, door traverse, escape sting) loaded via a small audio pool. RULE 3 stack-constraint check: HTML5 `<audio>` is built into the platform, so no new dep is needed. Closes "Audio reinforces successful actions" and substantially improves "Core action is satisfying when performed perfectly."
4. **Act-state HUD line**: a small bottom-left line that names the current beat ("Act 1: Spawn", "Act 2: Loop 1", ..., "Act 3: Mirror", ..., "Escaped"). Read from the existing `ActStateObserver`. Closes "The user can tell, without reading the HUD, whether they are doing well" by giving them a HUD to tell them.
5. **Knockout feedback polish**: ease the 90-degree mesh tilt over ~200 ms with a quick anticipation crouch and a small camera shake on the connecting tick. Smallest slice: per-tick interpolation in the existing tween-free pattern. Closes "Core action has texture, weight, follow-through."

Each becomes an `F-NNN` followup. The first four are filed as `nice-to-have` (the prototype is shippable without them); the audit doc spec says PLAYTEST items that fail become `blocks-release`, but the PLAYTEST.md gate is not yet being formally evaluated, so the followups are filed with the priority they actually carry against v1 scope. If the user runs a real playtest and flips any of these to `blocks-release`, the F-NNN entries are already in place to update.

Followups filed: F-016 (onboarding), F-017 (win screen), F-018 (audio pass), F-019 (act-state HUD), F-020 (knockout feedback polish).

### Audit 2026-05-08 (initial)

(populate when first run, after at least one full system has landed and coverage is non-trivial)

### Earlier audits

(append previous audits below this line as they age out, newest above oldest)