/**
 * Procedural one-shot sound effects for Pseudo Paradox (F-018).
 *
 * Three triggers: `playPunchSfx`, `playDoorSfx`, `playEscapeSfx`.
 * All synthesis is `OscillatorNode` + `BufferSource` (white noise) +
 * `BiquadFilterNode` + `GainNode` chained to the engine's sfxBus.
 *
 * Design choices anchored in the 2026-05-12 fun-factor audit:
 *
 *   - Punch sounds "weightless" today. The fix is to give it WEIGHT
 *     without giving it cheer. Low sine sweep + noise burst, no
 *     transient snap. The player hears the impact land in their
 *     body, not in a cartoon.
 *   - Door traverse needs to feel like crossing into another time.
 *     A small detune on a minor-3rd ring carries the threshold
 *     mood; lowpass keeps it from sounding like a doorbell.
 *   - Escape sting is the climactic moment. NOT a triumphant
 *     fanfare. A slow ascending minor triad with a slowly opening
 *     filter reads as "the spirit finally rests" rather than
 *     "ding! you won!"
 *
 * Each trigger is a fire-and-forget call; the host doesn't track
 * voices. Nodes self-disconnect after their envelope finishes via
 * `OscillatorNode.stop()` + `AudioBufferSourceNode.stop()`. Browsers
 * GC the disconnected graph.
 *
 * No external assets, no new dependency.
 */

import {
  DOOR_ATTACK_SEC,
  DOOR_DECAY_SEC,
  DOOR_DETUNE_CENTS,
  DOOR_GAIN,
  DOOR_LOWPASS_HZ,
  DOOR_ROOT_HZ,
  DOOR_THIRD_HZ,
  ESCAPE_ARPEGGIO_HZ,
  ESCAPE_FILTER_END_HZ,
  ESCAPE_FILTER_START_HZ,
  ESCAPE_GAIN,
  ESCAPE_NOTE_ATTACK_SEC,
  ESCAPE_NOTE_DECAY_SEC,
  ESCAPE_STEP_INTERVAL_SEC,
  PUNCH_FREQ_END_HZ,
  PUNCH_FREQ_START_HZ,
  PUNCH_GAIN,
  PUNCH_NOISE_DURATION_SEC,
  PUNCH_NOISE_LOWPASS_HZ,
  PUNCH_OSC_DURATION_SEC,
} from "./audioConstants.ts";
import type { AudioEngine } from "./audioEngine.ts";

/**
 * White-noise buffer cache. One buffer reused across every noise-
 * based SFX trigger; allocating a fresh buffer per shot would churn
 * GC for no audible benefit (the noise content is statistically
 * indistinguishable shot-to-shot).
 */
const noiseBufferCache = new WeakMap<AudioContext, AudioBuffer>();

function getOrMakeNoiseBuffer(context: AudioContext): AudioBuffer {
  const cached = noiseBufferCache.get(context);
  if (cached) return cached;
  const seconds = 1;
  const buffer = context.createBuffer(
    1,
    context.sampleRate * seconds,
    context.sampleRate,
  );
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i++) {
    channel[i] = Math.random() * 2 - 1;
  }
  noiseBufferCache.set(context, buffer);
  return buffer;
}

/**
 * Low muffled thud + tight noise burst. The two layers land on the
 * same tick: the sine carries the body of the hit, the noise sells
 * the contact. Total duration ~80 ms so it does not smear the next
 * action (pickup, throw) the player may take immediately after.
 */
export function playPunchSfx(engine: AudioEngine): void {
  const { context, sfxBus } = engine;
  const t = context.currentTime;

  // Body: descending sine. setValueAtTime + linearRampToValueAtTime
  // gives a deterministic glide; exponentialRamp would refuse the
  // target value 50 if start is 0.
  const osc = context.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(PUNCH_FREQ_START_HZ, t);
  osc.frequency.linearRampToValueAtTime(
    PUNCH_FREQ_END_HZ,
    t + PUNCH_OSC_DURATION_SEC,
  );
  const oscGain = context.createGain();
  oscGain.gain.setValueAtTime(0, t);
  oscGain.gain.linearRampToValueAtTime(PUNCH_GAIN, t + 0.005);
  oscGain.gain.exponentialRampToValueAtTime(
    0.001,
    t + PUNCH_OSC_DURATION_SEC,
  );
  osc.connect(oscGain).connect(sfxBus);
  osc.start(t);
  osc.stop(t + PUNCH_OSC_DURATION_SEC + 0.05);

  // Contact: short noise burst through a low lowpass so it sells
  // impact without sounding like a cymbal crash.
  const noise = context.createBufferSource();
  noise.buffer = getOrMakeNoiseBuffer(context);
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.value = PUNCH_NOISE_LOWPASS_HZ;
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0, t);
  noiseGain.gain.linearRampToValueAtTime(PUNCH_GAIN * 0.6, t + 0.003);
  noiseGain.gain.exponentialRampToValueAtTime(
    0.001,
    t + PUNCH_NOISE_DURATION_SEC,
  );
  noise.connect(noiseFilter).connect(noiseGain).connect(sfxBus);
  noise.start(t);
  noise.stop(t + PUNCH_NOISE_DURATION_SEC + 0.02);
}

/**
 * Two-tone bell ring with shimmer. Root + minor 3rd, slightly
 * detuned, soft long tail. The player hears a doorway opening into
 * another time rather than a doorbell announcing a visitor.
 */
export function playDoorSfx(engine: AudioEngine): void {
  const { context, sfxBus } = engine;
  const t = context.currentTime;
  const total = DOOR_ATTACK_SEC + DOOR_DECAY_SEC;

  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = DOOR_LOWPASS_HZ;

  const sumGain = context.createGain();
  sumGain.gain.setValueAtTime(0, t);
  sumGain.gain.linearRampToValueAtTime(DOOR_GAIN, t + DOOR_ATTACK_SEC);
  sumGain.gain.exponentialRampToValueAtTime(0.001, t + total);

  filter.connect(sumGain).connect(sfxBus);

  // Two voices: root + minor 3rd, each with a small detune for the
  // beat shimmer that gives the chord life.
  for (const [freq, detune] of [
    [DOOR_ROOT_HZ, -DOOR_DETUNE_CENTS],
    [DOOR_THIRD_HZ, DOOR_DETUNE_CENTS],
  ] as const) {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + total + 0.05);
  }
}

/**
 * Slow ascending minor triad with a filter that opens across the
 * whole phrase. Four notes (root, b3, 5, octave) at 400 ms apart,
 * triangle wave for warmth. Total phrase ~1.6 s + decay tail.
 */
export function playEscapeSfx(engine: AudioEngine): void {
  const { context, sfxBus } = engine;
  const t0 = context.currentTime;
  const noteCount = ESCAPE_ARPEGGIO_HZ.length;
  const totalSec =
    (noteCount - 1) * ESCAPE_STEP_INTERVAL_SEC + ESCAPE_NOTE_DECAY_SEC;

  // Shared filter sweep across the phrase. Notes flow through this
  // one filter so the whole arpeggio "opens up" together rather than
  // each note opening its own filter.
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(ESCAPE_FILTER_START_HZ, t0);
  filter.frequency.linearRampToValueAtTime(
    ESCAPE_FILTER_END_HZ,
    t0 + totalSec,
  );
  filter.Q.value = 1.2; // small resonance peak so each note rings
  filter.connect(sfxBus);

  ESCAPE_ARPEGGIO_HZ.forEach((freq, idx) => {
    const t = t0 + idx * ESCAPE_STEP_INTERVAL_SEC;
    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(ESCAPE_GAIN, t + ESCAPE_NOTE_ATTACK_SEC);
    gain.gain.exponentialRampToValueAtTime(0.001, t + ESCAPE_NOTE_DECAY_SEC);
    osc.connect(gain).connect(filter);
    osc.start(t);
    osc.stop(t + ESCAPE_NOTE_DECAY_SEC + 0.05);
  });
}
