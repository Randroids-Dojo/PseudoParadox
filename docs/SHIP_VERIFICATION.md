# Ship Verification

REQ-037 ("Demo build deploys to web with no install required") is satisfied by the live Vercel deploy. This doc records the verification artifacts and provides the manual smoke checklist used at slice time.

## Live URL

https://pseudo-paradox.vercel.app

## Last Verified Deploy

- Date: 2026-05-09
- Slice: REQ-040 / REQ-037 / REQ-038 / REQ-039 ship-gate land
- Method: manual browser smoke against the production URL

## Manual Smoke Checklist

Run this before declaring the live deploy healthy. Each step lists the expected observable outcome.

1. Page load: visit https://pseudo-paradox.vercel.app. The HTML page returns 200 OK and the document title is "Pseudo Paradox".
2. Scene render: within 10 seconds of load, the Three.js canvas mounts and the room geometry plus four cardinal doors plus the player capsule are visible. The capsule is tinted with the 5:00 origin color (REQ-013 / REQ-014 Act 1 spawn pose plus REQ-030 origin tint).
3. Console health: the browser DevTools Console shows no red error entries. Yellow warnings from Three.js or Vite are allowed.
4. Player movement: WASD moves the player capsule on the planar axes. Hold W (or Up Arrow) and the capsule walks forward. The mesh tilt does not change while moving (capsule stays upright).
5. Lit-portal traversal: walk into the lit East door at 5:00. The active timeline switches to 6:00, the player teleports to the room center, the origin tint updates to the 6:00 color, and the previously-recorded 5:00 lifetime appears as a ghost replaying the East-bound walk.
6. Hard reset: press R. The world tears down all ghosts, the active player respawns at 5:00, the timeline registry clears every bucket, and the InputRecorder restarts. After reset, pressing W again starts a fresh recording.

If any step fails, log the failure as a P0 followup in `docs/FOLLOWUPS.md` and triage immediately. The live deploy IS the ship gate; a failing smoke means the demo is not shippable.

## Automated Browser Smoke

A Playwright-based automated smoke against the live URL is documented as F-008 in `docs/FOLLOWUPS.md`. Per Q-018 default A, the Vercel preview deploy (which CI already gates on) is the de-facto smoke for every PR; doubling that into a Playwright run in CI is redundant and adds dev-loop cost.

## Bundle / Frame Time Regression Guards

In-repo regression guards live under `tests/perf/`:

- `tests/perf/bundleSize.test.ts` asserts `dist/assets/*.js` is under 5 MB raw (REQ-038 guard).
- `tests/perf/frameTime.test.ts` asserts the simulation's per-step CPU time is under 16.67 ms at the 95th percentile under load (REQ-039 guard).

Both are Vitest tests; the verification suite (`npm run build && npm test`) fires them on every PR.
