import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * REQ-038 bundle-size regression guard.
 * (`docs/gdd/23-prototype-scope.md#definition-of-shippable`.)
 *
 * REQ-038: "Demo build loads in under 10 seconds on a typical broadband
 * connection." A real download-time measurement requires Lighthouse or a
 * synthetic network harness; per RULE 3 (no new core deps) this slice
 * ships a bundle-size regression guard instead. The assertion is on the
 * sum of `dist/assets/*.js` bytes (raw, uncompressed).
 *
 * Q-018 default A consumed: live-deploy verification at
 * `pseudo-paradox.vercel.app` is the de-facto smoke; this test catches
 * sim-side regressions cheaply. The Lighthouse / proper-bandwidth gate
 * is documented as F-008 (see `docs/FOLLOWUPS.md`).
 *
 * Threshold rationale (`MAX_BUNDLE_BYTES = 5_000_000`):
 *
 *   - 5 MB raw JS over a 5 Mbps broadband connection is ~ 8 seconds
 *     uncompressed, comfortably under the 10 s budget. Real-world
 *     transfer is gzipped (~ 3:1 to 4:1 for JS), so the wire size at
 *     5 MB raw is ~ 1.5 MB on the wire, ~ 2.4 s at 5 Mbps. The test's
 *     5 MB threshold is the regression GUARD, not the SLA: if the JS
 *     payload doubles from one slice to the next, the test catches it.
 *   - Current size at REQ-040 land is ~ 2.5 MB (Three.js + Rapier WASM
 *     bundled), so the budget has ~ 2x headroom for legitimate growth
 *     across follow-up slices.
 *
 * Missing-bundle semantics: if `dist/` does not exist (no `npm run build`
 * was run before `npm test`), the test FAILS LOUD with a clear message.
 * Silently passing on a missing bundle would let REQ-038 go green even
 * when nothing was measured, which is the regression mode the gate
 * exists to catch. CI must run `npm run build` before `npm test`; the
 * local verification suite per WORKING_AGREEMENT does the same.
 */

const MAX_BUNDLE_BYTES = 5_000_000;

const repoRoot = resolve(__dirname, "..", "..");
const distAssetsDir = join(repoRoot, "dist", "assets");

const totalJsBytes = (dir: string): number => {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".js")) continue;
    const fullPath = join(dir, name);
    const st = statSync(fullPath);
    total += st.size;
  }
  return total;
};

describe("REQ-038 bundle-size regression guard", () => {
  it(`dist/assets/*.js total stays under ${MAX_BUNDLE_BYTES} bytes (~ 5 MB)`, () => {
    expect(
      existsSync(distAssetsDir),
      `REQ-038 bundle-size guard could not find ${distAssetsDir}; run \`npm run build\` before \`npm test\`.`,
    ).toBe(true);

    const total = totalJsBytes(distAssetsDir);
    if (total >= MAX_BUNDLE_BYTES) {
      // eslint-disable-next-line no-console
      console.error(
        `REQ-038 bundle-size regression: ${total} bytes (budget ${MAX_BUNDLE_BYTES} bytes).`,
      );
    }
    expect(total).toBeLessThan(MAX_BUNDLE_BYTES);
    expect(total).toBeGreaterThan(0);
  });
});
