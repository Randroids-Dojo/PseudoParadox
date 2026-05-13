import { describe, expect, it } from "vitest";
import {
  AMBIENT_GAIN_DEFAULT,
  BELL_DECAY_SEC,
  BELL_MAX_INTERVAL_SEC,
  BELL_MIN_INTERVAL_SEC,
  DRONE_DETUNE_CENTS,
  DRONE_FILTER_LFO_HZ,
  DRONE_ROOT_HZ,
  DRONE_SUB_FREQ_HZ,
  ESCAPE_ARPEGGIO_HZ,
  PHRYGIAN_INTERVALS,
  SFX_GAIN_DEFAULT,
  midiToFreq,
  phrygianMidi,
} from "../../src/render/audioConstants.ts";

describe("midiToFreq (F-018)", () => {
  it("returns 440 Hz at A4 (MIDI 69) per the standard 12-TET reference", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 4);
  });

  it("returns 880 Hz one octave above A4 (MIDI 81)", () => {
    expect(midiToFreq(81)).toBeCloseTo(880, 4);
  });

  it("returns 220 Hz one octave below A4 (MIDI 57)", () => {
    expect(midiToFreq(57)).toBeCloseTo(220, 4);
  });

  it("returns ~261.63 Hz at C4 (MIDI 60), the standard middle C", () => {
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 2);
  });
});

describe("phrygianMidi (F-018)", () => {
  it("returns the root MIDI at degree 0 with octaveShift 0", () => {
    expect(phrygianMidi(69, 0, 0)).toBe(69);
  });

  it("returns root + 1 semitone at degree 1 (b2, the haunted interval)", () => {
    expect(phrygianMidi(69, 1, 0)).toBe(70);
  });

  it("returns root + 12 at degree 0 with octaveShift +1", () => {
    expect(phrygianMidi(69, 0, 1)).toBe(81);
  });

  it("returns root - 12 at degree 0 with octaveShift -1", () => {
    expect(phrygianMidi(69, 0, -1)).toBe(57);
  });

  it("wraps degrees past the scale length so callers can pass any integer", () => {
    // Phrygian has 7 degrees, so degree 7 wraps to 0.
    expect(phrygianMidi(69, 7, 0)).toBe(69);
    expect(phrygianMidi(69, 8, 0)).toBe(70);
  });

  it("wraps negative degrees the same way (mod 7)", () => {
    expect(phrygianMidi(69, -7, 0)).toBe(69);
    // -1 mod 7 = 6, which is the b7 (Phrygian interval 10).
    expect(phrygianMidi(69, -1, 0)).toBe(79);
  });
});

describe("PHRYGIAN_INTERVALS (F-018)", () => {
  it("is the canonical Phrygian pattern: 1 b2 b3 4 5 b6 b7", () => {
    expect(PHRYGIAN_INTERVALS).toEqual([0, 1, 3, 5, 7, 8, 10]);
  });

  it("has 7 degrees", () => {
    expect(PHRYGIAN_INTERVALS.length).toBe(7);
  });
});

describe("audio bus gains (F-018)", () => {
  it("ambient gain is subtle (well below 0.5 unity, ~6% scale)", () => {
    expect(AMBIENT_GAIN_DEFAULT).toBeLessThan(0.1);
    expect(AMBIENT_GAIN_DEFAULT).toBeGreaterThan(0);
  });

  it("sfx gain is louder than ambient so triggers cut through the drone", () => {
    expect(SFX_GAIN_DEFAULT).toBeGreaterThan(AMBIENT_GAIN_DEFAULT);
  });
});

describe("haunted drone tuning (F-018)", () => {
  it("root is A1 (~55 Hz) for physiological 'presence' without rumble", () => {
    expect(DRONE_ROOT_HZ).toBeCloseTo(55, 1);
  });

  it("sub octave is A0 (~27.5 Hz), one octave below the root", () => {
    expect(DRONE_SUB_FREQ_HZ).toBeCloseTo(DRONE_ROOT_HZ / 2, 1);
  });

  it("detune is small enough to produce a slow beat (< 12 cents)", () => {
    expect(DRONE_DETUNE_CENTS).toBeGreaterThan(0);
    expect(DRONE_DETUNE_CENTS).toBeLessThan(12);
  });

  it("filter LFO is sub-hertz so it does not feel rhythmic", () => {
    expect(DRONE_FILTER_LFO_HZ).toBeLessThan(1);
  });
});

describe("haunted bell scheduling (F-018)", () => {
  it("min interval is longer than the bell decay so notes do not pile up", () => {
    expect(BELL_MIN_INTERVAL_SEC).toBeGreaterThan(BELL_DECAY_SEC);
  });

  it("max interval is longer than min so the range is non-empty", () => {
    expect(BELL_MAX_INTERVAL_SEC).toBeGreaterThan(BELL_MIN_INTERVAL_SEC);
  });
});

describe("escape sting (F-018)", () => {
  it("ascends through an A minor triad spelled in ascending order", () => {
    // A2, C3, E3, A3: each subsequent note is higher than the last.
    for (let i = 1; i < ESCAPE_ARPEGGIO_HZ.length; i++) {
      expect(ESCAPE_ARPEGGIO_HZ[i]).toBeGreaterThan(ESCAPE_ARPEGGIO_HZ[i - 1]);
    }
  });

  it("spans approximately one octave from A2 (~110 Hz) to A3 (~220 Hz)", () => {
    expect(ESCAPE_ARPEGGIO_HZ[0]).toBeCloseTo(110, 1);
    expect(ESCAPE_ARPEGGIO_HZ.at(-1)).toBeCloseTo(220, 1);
  });
});
