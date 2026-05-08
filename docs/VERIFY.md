# Verification Commands

Run before opening or merging any PR that touches code.

## Required for code changes

```bash
# 1. No em-dashes (U+2014) or en-dashes (U+2013) anywhere.
grep -rnP '[\x{2014}\x{2013}]' . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist
# Must return nothing. Exit 1 from grep means no matches, which is the goal.

# 2. No whitespace errors.
git diff --check

# 3. Type check.
npm run type-check

# 4. Tests.
npm test

# 5. Production build (also runs type check).
npm run build
```

## Local dev

```bash
npm run dev
```

Opens the prototype on http://localhost:5173 by default (or the next free
port if 5173 is in use). The shell currently renders an empty placeholder
room with a hemisphere fill light, a directional key light, and a fixed
isometric camera. Subsequent slices add doors, the player, and the timeline
recorder against this base.

## Smoke test

After `npm run build`, `npm run preview` serves the built bundle. Open the
preview URL and confirm the canvas renders the placeholder room without
console errors. Hard refresh and confirm Rapier WASM loads on each cold
boot.
