/**
 * Web Audio engine for Pseudo Paradox (F-018).
 *
 * Singleton AudioContext + gesture-unlock + two output buses (sfx,
 * music). All sound in this codebase is synthesized at runtime; we ship
 * no audio assets and add no new dependency. The pattern mirrors the
 * viberacer engine (one shared context, separate buses, suspended-on-
 * hidden) but the synthesis tuning is deliberately darker / slower /
 * more sparse to match the haunted prototype aesthetic.
 *
 * Browser autoplay policy: an AudioContext starts in `'suspended'` and
 * cannot make sound until the user interacts with the page. We expose
 * `ensureAudioReady()` which tries `context.resume()` and, if the
 * autoplay gate blocks, installs a one-shot pointerdown/keydown
 * listener that retries on first interaction. The result is that the
 * ambient drone "fades in" the first time the player presses a key or
 * taps the canvas, with no perceived audio gap.
 *
 * Visibility: when the tab is hidden, suspend the context so a
 * backgrounded prototype does not drone silently and waste battery.
 * Resume on visibility change; the resume call is throttled through
 * the same gesture path so the policy is observed.
 *
 * Determinism: audio is rendered from simulation events but does NOT
 * feed back into the simulation. The drone scheduler uses Math.random,
 * which is fine because no sim state reads from it.
 */

import { AMBIENT_GAIN_DEFAULT, SFX_GAIN_DEFAULT } from "./audioConstants.ts";

export interface AudioEngine {
  /** Underlying AudioContext. Tests pass a stub matching the surface. */
  readonly context: AudioContext;
  /** Master output node connected to `context.destination`. */
  readonly master: GainNode;
  /** Bus for one-shot game sounds (punch, door, escape sting). */
  readonly sfxBus: GainNode;
  /** Bus for continuous ambient (drone, sparse haunted bells). */
  readonly musicBus: GainNode;
  /**
   * Resume the context if the browser autoplay gate let us. Returns
   * `true` on success, `false` if a user gesture is still required.
   * Idempotent: subsequent calls after a successful resume return
   * `true` cheaply.
   */
  ensureReady: () => Promise<boolean>;
  /** Detach listeners; intended for app teardown. Idempotent. */
  dispose: () => void;
}

let singleton: AudioEngine | undefined;

/**
 * Lazy singleton accessor. Returns `undefined` in environments that
 * do not expose `AudioContext` (e.g. SSR or older test runners) so
 * callers can degrade gracefully rather than crash.
 */
export function getAudioEngine(): AudioEngine | undefined {
  if (singleton) return singleton;
  if (typeof window === "undefined") return undefined;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return undefined;
  singleton = createEngine(new Ctor());
  return singleton;
}

/** Reset the singleton for tests. Production code never calls this. */
export function __resetAudioEngineForTests(): void {
  singleton?.dispose();
  singleton = undefined;
}

function createEngine(context: AudioContext): AudioEngine {
  const master = context.createGain();
  master.gain.value = 1.0;
  master.connect(context.destination);

  const sfxBus = context.createGain();
  sfxBus.gain.value = SFX_GAIN_DEFAULT;
  sfxBus.connect(master);

  const musicBus = context.createGain();
  musicBus.gain.value = AMBIENT_GAIN_DEFAULT;
  musicBus.connect(master);

  const detachers: Array<() => void> = [];

  const isRunning = (): boolean =>
    (context.state as AudioContextState) === "running";

  const tryResume = async (): Promise<boolean> => {
    if (isRunning()) return true;
    try {
      await context.resume();
      return isRunning();
    } catch {
      return false;
    }
  };

  // Idempotency guard: callers may invoke `ensureReady()` multiple
  // times before the user produces a gesture (e.g. host re-runs init
  // on a hard reset). Without this flag, each call would install a
  // fresh pair of pointerdown / keydown listeners, all racing on the
  // first gesture and leaving orphaned listeners behind.
  let gestureUnlockInstalled = false;
  // Idempotency guard for `dispose()`. The interface contract says
  // dispose is safe to call repeatedly; without this flag a second
  // call would `disconnect()` already-detached nodes and call
  // `context.close()` again, which the Web Audio spec rejects with
  // `InvalidStateError` on an already-closed context.
  let disposed = false;

  const installGestureUnlock = (): void => {
    if (gestureUnlockInstalled) return;
    gestureUnlockInstalled = true;
    const onGesture = async (): Promise<void> => {
      const ok = await tryResume();
      if (ok) detach();
    };
    const detach = (): void => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      gestureUnlockInstalled = false;
    };
    window.addEventListener("pointerdown", onGesture, { once: false });
    window.addEventListener("keydown", onGesture, { once: false });
    detachers.push(detach);
  };

  const installVisibilityHandler = (): void => {
    if (typeof document === "undefined") return;
    const onChange = (): void => {
      if (document.hidden) {
        void context.suspend();
      } else {
        void tryResume();
      }
    };
    document.addEventListener("visibilitychange", onChange);
    detachers.push(() => document.removeEventListener("visibilitychange", onChange));
  };

  installVisibilityHandler();

  const ensureReady = async (): Promise<boolean> => {
    const ok = await tryResume();
    if (!ok) installGestureUnlock();
    return ok;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    while (detachers.length) detachers.pop()?.();
    sfxBus.disconnect();
    musicBus.disconnect();
    master.disconnect();
    // `AudioContext.close()` rejects with `InvalidStateError` on an
    // already-closed context. Skip the call when state is already
    // `"closed"` and swallow any race rejection so dispose is safe
    // to call from teardown paths that cannot prove the context's
    // current state.
    if ((context.state as AudioContextState) !== "closed") {
      void context.close().catch(() => undefined);
    }
  };

  return { context, master, sfxBus, musicBus, ensureReady, dispose };
}
