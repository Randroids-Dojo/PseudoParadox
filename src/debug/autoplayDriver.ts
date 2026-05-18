import type { KeyState } from "../input/keyboard.ts";

/**
 * `?debug=autoplay` test-mode input driver.
 *
 * The driver mutates `KeyState` in place at the top of every fixed-step
 * before the input recorder samples it. The resulting timeline is the
 * same byte-for-byte as a human pressing the equivalent keys for the
 * same durations: the recorder, the ghost-replay path, and every
 * downstream resolver still see the exact same `keyboard.state`
 * snapshot they would see from a real player.
 *
 * The script intentionally LOOPS forever so leaving the tab open gives
 * me a long observation window for each animation state in turn. The
 * loop covers walk + facing, idle pose, the punch swing one-shot, and
 * (when the player happens to bump a lit door) traversal + ghost
 * spawn + carry / die clips that the resulting choreography produces.
 *
 * This is a development tool, never enabled in production traffic
 * (gated by `?debug=autoplay` in the URL). It is intentionally NOT
 * exposed through a settings UI: a real player tripping it would
 * lose control of the figure mid-run.
 */

export interface AutoplayStep {
  /** Short label rendered in the debug HUD overlay. */
  label: string;
  /** Number of fixed steps the keys stay set as `apply` writes them. */
  ticks: number;
  /** Mutates the live `KeyState` to the inputs the step models. */
  apply: (state: KeyState) => void;
}

/**
 * Clears every input channel. Called by every step before setting its
 * own channels so a step never accidentally inherits the prior step's
 * sticky keys (e.g. punch held across an idle phase).
 */
const clearAll = (state: KeyState): void => {
  state.forward = false;
  state.back = false;
  state.left = false;
  state.right = false;
  state.punch = false;
  state.pickup = false;
  state.throw = false;
};

const FIXED_STEP_PER_SECOND = 60;
const s = (seconds: number): number =>
  Math.max(1, Math.round(seconds * FIXED_STEP_PER_SECOND));

/**
 * Hand-tuned exploration script. Total loop ~25 seconds. The order is:
 *
 * 1. Walk south toward a lit door (the GDD spec has both bottom doors
 *    lit at 5:00). Long enough to either traverse or bounce off a wall.
 * 2. Brief idle so the figure freezes at its last-known facing.
 * 3. Punch swing (one-shot via `attack-melee-right`).
 * 4. Side-step west, then north back toward room center.
 * 5. Pickup attempt then throw attempt (no-op if there is no body in
 *    range, but they let me eyeball the rising-edge handling either
 *    way; if a ghost has been knocked out, the carry / throw clips
 *    light up here).
 * 6. Long idle so the figure returns to the looping `idle` clip.
 *
 * The script loops. Each iteration that successfully traverses the
 * south lit door spawns a fresh ghost, and the next iteration sees
 * the ghost replaying the previous iteration: walking, punching, and
 * (if you stay still) potentially knocking the active player out, which
 * is exactly the choreography I want to visually audit.
 */
export const AUTOPLAY_SCRIPT: AutoplayStep[] = [
  {
    // The lit doors at 5:00 spawn sit at the SW and SE corners, NOT
    // straight south. A pure `back = true` walk parks the figure at
    // the south wall between them; a diagonal `back + left` aim hits
    // the SW corner trigger.
    label: "walk-sw",
    ticks: s(5),
    apply: (state) => {
      clearAll(state);
      state.back = true;
      state.left = true;
    },
  },
  {
    label: "idle",
    ticks: s(1),
    apply: clearAll,
  },
  {
    label: "punch",
    ticks: s(0.6),
    apply: (state) => {
      clearAll(state);
      state.punch = true;
    },
  },
  {
    label: "idle",
    ticks: s(1),
    apply: clearAll,
  },
  {
    label: "walk-ne",
    ticks: s(4),
    apply: (state) => {
      clearAll(state);
      state.forward = true;
      state.right = true;
    },
  },
  {
    label: "idle",
    ticks: s(1),
    apply: clearAll,
  },
  {
    label: "pickup-try",
    ticks: s(0.4),
    apply: (state) => {
      clearAll(state);
      state.pickup = true;
    },
  },
  {
    label: "walk-se",
    ticks: s(3),
    apply: (state) => {
      clearAll(state);
      state.back = true;
      state.right = true;
    },
  },
  {
    label: "throw-try",
    ticks: s(0.4),
    apply: (state) => {
      clearAll(state);
      state.throw = true;
    },
  },
  {
    label: "idle-long",
    ticks: s(4),
    apply: clearAll,
  },
];

export interface AutoplayHandle {
  /**
   * Advance the script one fixed step. Mutates the live `KeyState`
   * before the host's `recorder.record` call samples it.
   */
  advance(): void;
  /** Current step label. Useful for a debug HUD overlay. */
  currentLabel(): string;
  /** Absolute tick index since the driver was created. */
  tickIndex(): number;
}

export function createAutoplayDriver(
  keyboard: { state: KeyState },
  script: AutoplayStep[] = AUTOPLAY_SCRIPT,
): AutoplayHandle {
  const totalTicks = script.reduce((sum, step) => sum + step.ticks, 0);
  let tick = 0;

  const stepAtLoopTick = (loopTick: number): AutoplayStep => {
    let cursor = 0;
    for (const step of script) {
      if (loopTick < cursor + step.ticks) return step;
      cursor += step.ticks;
    }
    return script[script.length - 1];
  };

  return {
    advance(): void {
      const step = stepAtLoopTick(tick % totalTicks);
      step.apply(keyboard.state);
      tick += 1;
    },
    currentLabel(): string {
      // Report the label of the step JUST APPLIED by the most recent
      // `advance` call. Before the first call there is no applied
      // step yet, so we report the first script step's label as the
      // staged-but-unapplied state.
      const appliedTick = tick === 0 ? 0 : (tick - 1) % totalTicks;
      return stepAtLoopTick(appliedTick).label;
    },
    tickIndex(): number {
      return tick;
    },
  };
}

/** Read the `?debug=autoplay` URL flag without touching the window in tests. */
export function autoplayRequestedFromUrl(url: string): boolean {
  try {
    const parsed = new URL(url, "http://placeholder.local/");
    return parsed.searchParams.get("debug") === "autoplay";
  } catch {
    return false;
  }
}
