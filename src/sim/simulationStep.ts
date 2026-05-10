/**
 * Shared simulation-step constants.
 *
 * Both the host loop in `src/app.ts` and the hybrid replay controller's
 * running expected-position integral in `src/sim/ghostInstance.ts` need
 * the SAME fixed step in seconds. Hard-coding the value in two places
 * lets the two drift apart silently if one is tuned without the other,
 * which would break drift detection (the controller would integrate
 * over the wrong dt and decide the ghost has drifted when it has not,
 * or vice versa). One constant, one source of truth.
 */
export const FIXED_STEP_SECONDS = 1 / 60;
