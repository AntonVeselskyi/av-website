/** Pure tonal rules for the $IGN⸸$PELL gesture instruments. */

export const GAMMAS = Object.freeze({
  minorPentatonic: Object.freeze({ id: 'minorPentatonic', label: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] }),
  aeolian: Object.freeze({ id: 'aeolian', label: 'Aeolian / Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] }),
  phrygian: Object.freeze({ id: 'phrygian', label: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] }),
  harmonicMinor: Object.freeze({ id: 'harmonicMinor', label: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] }),
});

export const HARMONY_MODES = Object.freeze({
  STRICT_CHORD: 'strictChord',
  SAFE_SCALE: 'safeScale',
  FREE_SCALE: 'freeScale',
});

const PITCH_CLASSES = Object.freeze({ C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 });
const SHARP_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
const DEFAULT_PROGRESSION = Object.freeze([1]);

function positiveModulo(value, divisor) { return ((value % divisor) + divisor) % divisor; }
function assertGesture(gesture) {
  if (!Number.isInteger(gesture) || gesture < 1 || gesture > 9) throw new RangeError('Gesture must be an integer from 1 through 9.');
}

export function pitchClass(value) {
  if (Number.isInteger(value)) return positiveModulo(value, 12);
  if (typeof value === 'string' && PITCH_CLASSES[value] !== undefined) return PITCH_CLASSES[value];
  throw new TypeError(`Unknown root note: ${String(value)}`);
}

export function noteName(midi) {
  if (!Number.isFinite(midi)) throw new TypeError('MIDI note must be finite.');
  return `${SHARP_NAMES[positiveModulo(Math.round(midi), 12)]}${Math.floor(Math.round(midi) / 12) - 1}`;
}

export function midiToFrequency(midi) { return 440 * 2 ** ((midi - 69) / 12); }

export function createTonalScene(overrides = {}) {
  const gammaId = overrides.gamma ?? 'minorPentatonic';
  if (!GAMMAS[gammaId]) throw new RangeError(`Unknown gamma: ${gammaId}`);
  const harmonyMode = overrides.harmonyMode ?? HARMONY_MODES.STRICT_CHORD;
  if (!Object.values(HARMONY_MODES).includes(harmonyMode)) throw new RangeError(`Unknown harmony mode: ${harmonyMode}`);
  const progression = overrides.progression ?? DEFAULT_PROGRESSION;
  if (!Array.isArray(progression) || !progression.length || progression.some((degree) => !Number.isInteger(degree) || degree < 1)) {
    throw new TypeError('Progression must contain one-based positive scale degrees.');
  }
  const requestedBpm = Number(overrides.bpm ?? 140);
  const requestedBaseMidi = Number(overrides.baseMidi ?? 36);
  if (!Number.isFinite(requestedBpm) || !Number.isFinite(requestedBaseMidi)) throw new TypeError('BPM and base MIDI must be finite numbers.');
  return Object.freeze({
    root: pitchClass(overrides.root ?? 'E'), gamma: gammaId, harmonyMode, progression: Object.freeze([...progression]),
    bpm: Math.min(200, Math.max(60, requestedBpm)), baseMidi: Math.round(requestedBaseMidi),
  });
}

export function gammaIntervals(scene) { return GAMMAS[scene.gamma].intervals; }

export function chordForBar(scene, bar = 0) {
  const scale = gammaIntervals(scene);
  const degree = scene.progression[positiveModulo(Math.floor(bar), scene.progression.length)] - 1;
  const degreeInterval = scale[positiveModulo(degree, scale.length)] + 12 * Math.floor(degree / scale.length);
  // Every chord is derived from the selected gamma. The three tones are the only
  // tones used in strict mode, so arbitrary simultaneous gestures remain consonant.
  const intervals = [0, 2, 4].map((offset) => {
    const index = degree + offset;
    return scale[positiveModulo(index, scale.length)] - scale[positiveModulo(degree, scale.length)] + 12 * (Math.floor(index / scale.length) - Math.floor(degree / scale.length));
  });
  return Object.freeze({ degree: degree + 1, rootInterval: degreeInterval, intervals: Object.freeze(intervals) });
}

function scaleIntervalAt(scale, index) { return scale[positiveModulo(index, scale.length)] + 12 * Math.floor(index / scale.length); }

function lowBassSteps(scaleLength) {
  // Seven-note gammas can climb through nine distinct scale positions. For a
  // pentatonic gamma, turn back after its octave instead of sending 8/9 up
  // another octave; every sign still has a deliberate, playable bass note.
  if (scaleLength >= 7) return [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const peak = scaleLength;
  return [0, 1, 2, 3, 4, 5, 4, 3, 2].map((step) => Math.min(step, peak));
}

/**
 * Nine low-register, gamma-safe bass positions for an instrument such as an
 * 808. The active progression chord supplies the tonal centre, while its
 * octave is normalised to C1–F1 so gestures stay below G2 rather than climbing
 * into the G3+ register of the generic nine-note layout.
 */
export function resolveLowBassGestureNote(gesture, scene, { bar = 0, baseMidi = 24 } = {}) {
  assertGesture(gesture);
  const scale = gammaIntervals(scene);
  const chord = chordForBar(scene, bar);
  const chordIndex = chord.degree - 1;
  const steps = lowBassSteps(scale.length);
  const rootScaleInterval = scaleIntervalAt(scale, chordIndex);
  let rootMidi = Math.round(baseMidi + scene.root + rootScaleInterval);
  while (rootMidi > 29) rootMidi -= 12;
  while (rootMidi < 24) rootMidi += 12;
  const scaleDegreeIndex = chordIndex + steps[gesture - 1];
  const interval = scaleIntervalAt(scale, scaleDegreeIndex) - rootScaleInterval;
  const midi = Math.round(rootMidi + interval);
  return Object.freeze({
    gesture, midi, note: noteName(midi), frequency: midiToFrequency(midi), interval,
    scaleDegree: positiveModulo(scaleDegreeIndex, scale.length) + 1,
    mode: HARMONY_MODES.SAFE_SCALE, chordDegree: chord.degree,
  });
}

export function resolveGestureNote(gesture, scene, { bar = 0, mode = scene.harmonyMode, baseMidi = scene.baseMidi } = {}) {
  assertGesture(gesture);
  const chord = chordForBar(scene, bar);
  const scale = gammaIntervals(scene);
  const index = gesture - 1;
  let interval;
  let scaleDegree;
  if (mode === HARMONY_MODES.STRICT_CHORD) {
    interval = chord.rootInterval + chord.intervals[index % 3] + 12 * Math.floor(index / 3);
    scaleDegree = (index % 3) * 2 + 1;
  } else if (mode === HARMONY_MODES.SAFE_SCALE) {
    // Pentatonic-like ordering avoids the more abrasive semitone colours in the full gamma.
    const safeIndexes = [0, 2, 3, 4, 0, 2, 3, 4, 0];
    const octave = index >= 4 ? 1 : 0;
    interval = scaleIntervalAt(scale, safeIndexes[index]) + 12 * octave;
    scaleDegree = safeIndexes[index] + 1;
  } else if (mode === HARMONY_MODES.FREE_SCALE) {
    interval = scaleIntervalAt(scale, index);
    scaleDegree = positiveModulo(index, scale.length) + 1;
  } else {
    throw new RangeError(`Unknown harmony mode: ${mode}`);
  }
  const midi = Math.round(baseMidi + scene.root + interval);
  return Object.freeze({ gesture, midi, note: noteName(midi), frequency: midiToFrequency(midi), interval, scaleDegree, mode, chordDegree: chord.degree });
}

export function quantizeBeat(beat, division = 16) {
  if (!Number.isFinite(beat) || !Number.isFinite(division) || division <= 0) throw new TypeError('Beat and division must be positive finite values.');
  return Math.round(beat * division) / division;
}

export function beatsPerBar() { return 4; }
export function barAtBeat(beat) { return Math.floor(beat / beatsPerBar()); }
