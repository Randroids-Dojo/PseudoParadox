/**
 * Ambient haunted drone for Pseudo Paradox (F-018).
 *
 * Two layers, both continuous, both deliberately subtle:
 *
 *   1. **Drone**: two detuned sine voices at A1 (55 Hz) + a sub
 *      octave at A0 (27.5 Hz). The detune is 6 cents which produces
 *      a slow ~0.4 Hz beating envelope, the canonical "swimmy /
 *      unsettling" sound. A slow LFO modulates the lowpass cutoff
 *      between 400 and 1100 Hz over 15 seconds so the drone shifts
 *      character without locking into a perceivable rhythm.
 *   2. **Sparse haunted bells**: every 6 to 14 seconds, schedule
 *      one Phrygian-scale note in the A2 to A4 octave range,
 *      triangle wave, very long decay. The bell sits below the
 *      drone in gain so it reads as a distant echo rather than a
 *      melody. Phrygian mode (1 b2 b3 4 5 b6 b7) carries the
 *      "haunted folk" character that natural minor doesn't.
 *
 * Aesthetic targets from the 2026-05-12 fun-factor audit: dark,
 * slow, sparse, subtle. NOT a music score. The drone is room tone
 * for a haunted house, not background music for a level.
 *
 * Determinism: the sparse-bell scheduler uses `Math.random`. Audio
 * output does NOT feed back into the simulation, so this is safe.
 * The drone itself is fully deterministic (no random parameters).
 */

import {
  BELL_ATTACK_SEC,
  BELL_DECAY_SEC,
  BELL_GAIN,
  BELL_MAX_INTERVAL_SEC,
  BELL_MAX_OCTAVE,
  BELL_MIN_INTERVAL_SEC,
  BELL_MIN_OCTAVE,
  DRONE_DETUNE_CENTS,
  DRONE_FILTER_CENTER_HZ,
  DRONE_FILTER_LFO_HZ,
  DRONE_FILTER_SWING_HZ,
  DRONE_ROOT_HZ,
  DRONE_SUB_FREQ_HZ,
  PHRYGIAN_INTERVALS,
  midiToFreq,
  phrygianMidi,
} from "./audioConstants.ts";
import type { AudioEngine } from "./audioEngine.ts";

export interface AmbientDroneHandle {
  /** Stop the drone and cancel the next scheduled bell. Idempotent. */
  dispose: () => void;
}

/** A4 = MIDI 69. Used as the bell root so degree 0 = A. */
const BELL_ROOT_MIDI = 69;

/**
 * Start the ambient drone. The drone fades in over `FADE_IN_SEC` so
 * it does not pop. Returns a handle whose `dispose` fades back out
 * and tears the voices down.
 */
export function startAmbientDrone(engine: AudioEngine): AmbientDroneHandle {
  const { context, musicBus } = engine;
  const FADE_IN_SEC = 4;
  const FADE_OUT_SEC = 1;

  const startTime = context.currentTime;
  const dronePeak = 1.0; // bus already attenuated by AMBIENT_GAIN_DEFAULT

  // Drone layer: shared filter, shared gain envelope. Two sine
  // voices detuned around A1 plus one sub-octave sine at A0.
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = DRONE_FILTER_CENTER_HZ;
  filter.Q.value = 0.7;

  const droneGain = context.createGain();
  droneGain.gain.setValueAtTime(0, startTime);
  droneGain.gain.linearRampToValueAtTime(dronePeak, startTime + FADE_IN_SEC);
  filter.connect(droneGain).connect(musicBus);

  const voices: OscillatorNode[] = [];

  const root = context.createOscillator();
  root.type = "sine";
  root.frequency.value = DRONE_ROOT_HZ;
  root.detune.value = -DRONE_DETUNE_CENTS;
  root.connect(filter);
  root.start(startTime);
  voices.push(root);

  const twin = context.createOscillator();
  twin.type = "sine";
  twin.frequency.value = DRONE_ROOT_HZ;
  twin.detune.value = DRONE_DETUNE_CENTS;
  twin.connect(filter);
  twin.start(startTime);
  voices.push(twin);

  const sub = context.createOscillator();
  sub.type = "sine";
  sub.frequency.value = DRONE_SUB_FREQ_HZ;
  // Sub is its own gain branch so it can sit lower than the mid
  // drone without dragging the lowpass with it.
  const subGain = context.createGain();
  subGain.gain.value = 0.5;
  sub.connect(subGain).connect(droneGain);
  sub.start(startTime);
  voices.push(sub);

  // Filter LFO: a slow sine oscillating the cutoff between
  // (center - swing) and (center + swing) Hz. Implemented via a
  // dedicated LFO oscillator + scale gain into the filter's
  // frequency AudioParam, so the modulation is sample-accurate and
  // we don't need a setInterval loop.
  const lfo = context.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = DRONE_FILTER_LFO_HZ;
  const lfoScale = context.createGain();
  lfoScale.gain.value = DRONE_FILTER_SWING_HZ;
  lfo.connect(lfoScale).connect(filter.frequency);
  lfo.start(startTime);
  voices.push(lfo);

  // Sparse bell scheduler: setTimeout chain (not Web Audio's
  // lookahead scheduler) because the timing intentionally varies
  // shot-to-shot and we never need sample-accurate placement.
  let bellTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const scheduleNextBell = (): void => {
    if (disposed) return;
    const range = BELL_MAX_INTERVAL_SEC - BELL_MIN_INTERVAL_SEC;
    const delaySec = BELL_MIN_INTERVAL_SEC + Math.random() * range;
    bellTimer = setTimeout(() => {
      playBell();
      scheduleNextBell();
    }, delaySec * 1000);
  };

  const playBell = (): void => {
    if (disposed) return;
    const degree = Math.floor(Math.random() * PHRYGIAN_INTERVALS.length);
    const octaveRange = BELL_MAX_OCTAVE - BELL_MIN_OCTAVE + 1;
    const octave =
      BELL_MIN_OCTAVE + Math.floor(Math.random() * octaveRange) - 4;
    const midi = phrygianMidi(BELL_ROOT_MIDI, degree, octave);
    const freq = midiToFreq(midi);
    const t = context.currentTime;

    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(BELL_GAIN, t + BELL_ATTACK_SEC);
    gain.gain.exponentialRampToValueAtTime(0.001, t + BELL_DECAY_SEC);
    osc.connect(gain).connect(musicBus);
    osc.start(t);
    osc.stop(t + BELL_DECAY_SEC + 0.05);
  };

  scheduleNextBell();

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (bellTimer !== undefined) clearTimeout(bellTimer);
    const fadeStart = context.currentTime;
    droneGain.gain.cancelScheduledValues(fadeStart);
    droneGain.gain.setValueAtTime(droneGain.gain.value, fadeStart);
    droneGain.gain.linearRampToValueAtTime(0, fadeStart + FADE_OUT_SEC);
    for (const v of voices) {
      try {
        v.stop(fadeStart + FADE_OUT_SEC + 0.05);
      } catch {
        // OscillatorNode.stop throws if called twice; safe to ignore.
      }
    }
  };

  return { dispose };
}
