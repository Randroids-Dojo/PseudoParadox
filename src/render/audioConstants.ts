/**
 * Audio tuning constants for the haunted prototype palette (F-018).
 *
 * All values are pure data so they can be unit-tested without
 * instantiating Web Audio. The aesthetic targets are dark, slow,
 * sparse, subtle: nothing punchy or triumphant, nothing on a steady
 * beat grid. Tweak constants here rather than scattering magic
 * numbers across the synth files.
 *
 * Sources for the design choices live in the file comments of
 * `sfx.ts` and `ambientDrone.ts`; this file just holds the numbers.
 */

/**
 * Master gain for the ambient bus. Deliberately subtle (~6% of full
 * scale) so the drone reads as room tone rather than a music cue.
 */
export const AMBIENT_GAIN_DEFAULT = 0.06;

/**
 * Master gain for the SFX bus. Slightly louder than ambient so a
 * punch land or door traverse cuts through the drone without
 * stepping on it.
 */
export const SFX_GAIN_DEFAULT = 0.5;

/**
 * Root frequency for the ambient drone (A1). Low enough to feel
 * physiological ("presence") without rumbling on cheap laptop
 * speakers. The drone also runs a sub-octave at A0 (`SUB_FREQ_HZ`).
 */
export const DRONE_ROOT_HZ = 55;
export const DRONE_SUB_FREQ_HZ = 27.5;

/**
 * Beat detuning between the two drone voices, in cents. 6 cents
 * produces a ~0.4 Hz beating envelope at A1 (5.5 cycles per second
 * minus 5.5 cycles per second times 1.0035 = small beat), which is
 * the canonical "swimmy / unsettling" detune.
 */
export const DRONE_DETUNE_CENTS = 6;

/**
 * Filter LFO for the drone: slow sweep on the cutoff frequency. The
 * filter "breathes" between 400 and 1100 Hz over a 15-second period,
 * so the drone shifts character without ever locking into a rhythm
 * the player can predict.
 */
export const DRONE_FILTER_CENTER_HZ = 750;
export const DRONE_FILTER_SWING_HZ = 350;
export const DRONE_FILTER_LFO_HZ = 1 / 15;

/**
 * Phrygian intervals from a root (semitones). Phrygian (1 b2 b3 4 5
 * b6 b7) carries the unsettled / "haunted folk music" character vs
 * Aeolian (natural minor). Used by the sparse bell scheduler to pick
 * a degree the player will read as eerie but not random.
 */
export const PHRYGIAN_INTERVALS = [0, 1, 3, 5, 7, 8, 10] as const;

/**
 * Sparse bell trigger interval bounds (seconds). The scheduler picks
 * a uniform random delay in `[MIN, MAX]` between notes so the player
 * never gets a metric grid. Long mean (~10 s) keeps the drone
 * dominant.
 */
export const BELL_MIN_INTERVAL_SEC = 6;
export const BELL_MAX_INTERVAL_SEC = 14;

/**
 * Bell envelope timings (seconds). Long decay produces the "ringing
 * in an empty hall" tail; without a convolution reverb, the long
 * exponential gain ramp is the cheapest substitute for room sound.
 */
export const BELL_ATTACK_SEC = 0.05;
export const BELL_DECAY_SEC = 4;

/**
 * Bell gain. Below the drone so the bell reads as a distant echo
 * rather than a melody.
 */
export const BELL_GAIN = 0.04;

/**
 * Octave range for sparse bells (A2 to A4). Picked so notes sit in
 * the midrange where small detunes feel "haunted" rather than
 * "out of tune."
 */
export const BELL_MIN_OCTAVE = 2;
export const BELL_MAX_OCTAVE = 4;

// ---------- SFX ----------

/**
 * Punch land: low muffled thud, NOT a satisfying snap. The dossier
 * for the F-018 audit explicitly framed punch as "weightless" today;
 * the fix is to give it weight without giving it cheer. Sine sweep
 * 90 -> 50 Hz over 80 ms with a tight noise burst.
 */
export const PUNCH_FREQ_START_HZ = 90;
export const PUNCH_FREQ_END_HZ = 50;
export const PUNCH_OSC_DURATION_SEC = 0.08;
export const PUNCH_NOISE_LOWPASS_HZ = 400;
export const PUNCH_NOISE_DURATION_SEC = 0.04;
export const PUNCH_GAIN = 0.6;

/**
 * Door traverse: a two-tone bell ring with a small detune for
 * shimmer, lowpass-filtered so it reads as "muffled / through the
 * door." A minor 3rd (root + 3 semitones) is the most unambiguously
 * unsettling small interval.
 */
export const DOOR_ROOT_HZ = 220; // A3
export const DOOR_THIRD_HZ = 261.63; // C4 (minor 3rd above A3)
export const DOOR_ATTACK_SEC = 0.08;
export const DOOR_DECAY_SEC = 1.2;
export const DOOR_LOWPASS_HZ = 1800;
export const DOOR_DETUNE_CENTS = 4;
export const DOOR_GAIN = 0.25;

/**
 * Escape sting: slow ascending arpeggio on an A minor triad (A2, C3,
 * E3, A3). NOT a triumphant fanfare; the haunted spirit finally
 * resting. Notes 400 ms apart, triangle wave, lowpass slowly opening
 * across the whole phrase.
 */
export const ESCAPE_ARPEGGIO_HZ = [110, 130.81, 164.81, 220] as const;
export const ESCAPE_STEP_INTERVAL_SEC = 0.4;
export const ESCAPE_NOTE_ATTACK_SEC = 0.05;
export const ESCAPE_NOTE_DECAY_SEC = 1.5;
export const ESCAPE_FILTER_START_HZ = 600;
export const ESCAPE_FILTER_END_HZ = 2400;
export const ESCAPE_GAIN = 0.35;

/**
 * Pure helper: convert MIDI note number to frequency in Hz, A4=440.
 * Used by the bell scheduler. Exposed here so unit tests can pin
 * the conversion without pulling in Web Audio.
 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Pure helper: pick a Phrygian degree (0..6) and octave shift, then
 * return the resulting MIDI note relative to a root MIDI. Used by
 * the bell scheduler to keep all bell pitches in the haunted scale.
 * Wraps the degree modulo the scale length so callers can pass any
 * integer.
 */
export function phrygianMidi(
  rootMidi: number,
  degree: number,
  octaveShift: number,
): number {
  const len = PHRYGIAN_INTERVALS.length;
  const wrappedDegree = ((degree % len) + len) % len;
  const semitone = PHRYGIAN_INTERVALS[wrappedDegree];
  return rootMidi + semitone + octaveShift * 12;
}
