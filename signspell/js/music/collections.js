import { HARMONY_MODES, createTonalScene, resolveGestureNote } from './tonal.js';

export const INSTRUMENTS = Object.freeze({
  '808': Object.freeze({ id: '808', label: '808', kind: 'pitched', preferredMode: HARMONY_MODES.STRICT_CHORD, baseMidi: 24, lowMidi: 24, highMidi: 60 }),
  eerieLead: Object.freeze({ id: 'eerieLead', label: 'Eerie Lead', kind: 'pitched', preferredMode: HARMONY_MODES.SAFE_SCALE, baseMidi: 60, lowMidi: 55, highMidi: 100 }),
  piano: Object.freeze({ id: 'piano', label: 'Felt Piano', kind: 'pitched', preferredMode: HARMONY_MODES.SAFE_SCALE, baseMidi: 48, lowMidi: 48, highMidi: 91 }),
  percussion: Object.freeze({ id: 'percussion', label: 'Grit Percussion', kind: 'percussion' }),
  pad: Object.freeze({ id: 'pad', label: 'Ghost Pad', kind: 'chord', preferredMode: HARMONY_MODES.STRICT_CHORD, baseMidi: 48, lowMidi: 48, highMidi: 83 }),
});

export const PERCUSSION_CELLS = Object.freeze(['kick', 'snare', 'clap', 'closedHat', 'openHat', 'rim', 'metal', 'noise', 'reverse']);

const collection = (id, title, description, tonal, instruments) => Object.freeze({ id, title, description, tonal: createTonalScene(tonal), instruments: Object.freeze(instruments) });

// These are original mood collections, not artist presets and contain no samples.
export const VIBE_COLLECTIONS = Object.freeze({
  wiltedBedroom: collection('wiltedBedroom', 'WILTED BEDROOM', 'Warm, bruised emo-trap: detuned keys, worn plucks and a soft sagging sub.', { root: 'E', gamma: 'aeolian', harmonyMode: HARMONY_MODES.STRICT_CHORD, progression: [1, 6, 3, 7], bpm: 132 }, { '808': 'warmWound', eerieLead: 'chorusWisp', piano: 'feltTape', percussion: 'softRust', pad: 'sleepingHall' }),
  cemeteryTape: collection('cemeteryTape', 'CEMETERY TAPE', 'VHS horror-trap: metallic hits, spectral bells and compressed low end.', { root: 'D', gamma: 'harmonicMinor', harmonyMode: HARMONY_MODES.STRICT_CHORD, progression: [1, 6, 4, 5], bpm: 140 }, { '808': 'tapeGrave', eerieLead: 'graveBell', piano: 'cryptKeys', percussion: 'vhsMetal', pad: 'choirDust' }),
  redlineWound: collection('redlineWound', 'REDLINE WOUND', 'Intimate piano against clipped, close-up bass and sparse impact drums.', { root: 'F', gamma: 'minorPentatonic', harmonyMode: HARMONY_MODES.STRICT_CHORD, progression: [1, 4, 3, 5], bpm: 150 }, { '808': 'redline', eerieLead: 'blownSpeaker', piano: 'bareFelt', percussion: 'impact', pad: 'roomTone' }),
  ironChapel: collection('ironChapel', 'IRON CHAPEL', 'Industrial half-time trap: scraped metal, detuned organ and severe mono bass.', { root: 'C#', gamma: 'phrygian', harmonyMode: HARMONY_MODES.STRICT_CHORD, progression: [1, 2, 7, 1], bpm: 165 }, { '808': 'ironLung', eerieLead: 'razorMono', piano: 'brokenOrgan', percussion: 'ironDust', pad: 'coldChapel' }),
});

export function getVibeCollection(id) {
  const result = VIBE_COLLECTIONS[id];
  if (!result) throw new RangeError(`Unknown vibe collection: ${id}`);
  return result;
}

function transposeIntoRange(note, lowMidi, highMidi) {
  let midi = note.midi;
  while (midi < lowMidi) midi += 12;
  while (midi > highMidi) midi -= 12;
  return { ...note, midi, frequency: 440 * 2 ** ((midi - 69) / 12) };
}

/** Maps a gesture to a playable instrument command without starting audio. */
export function resolveInstrumentGesture({ instrument, gesture, scene, bar = 0, velocity = 0.8, collectionId = null }) {
  const definition = INSTRUMENTS[instrument];
  if (!definition) throw new RangeError(`Unknown instrument: ${instrument}`);
  const collectionPreset = collectionId && VIBE_COLLECTIONS[collectionId]
    ? VIBE_COLLECTIONS[collectionId].instruments[instrument]
    : null;
  const safeVelocity = Math.max(0, Math.min(1, Number(velocity)));
  if (definition.kind === 'percussion') {
    if (!Number.isInteger(gesture) || gesture < 1 || gesture > 9) throw new RangeError('Percussion gesture must be 1 through 9.');
    return Object.freeze({ instrument, kind: 'percussion', gesture, voice: PERCUSSION_CELLS[gesture - 1], velocity: safeVelocity, collectionId, presetId: collectionPreset });
  }
  const note = transposeIntoRange(resolveGestureNote(gesture, scene, { bar, mode: definition.preferredMode, baseMidi: definition.baseMidi }), definition.lowMidi, definition.highMidi);
  if (definition.kind === 'chord') {
    const chord = [gesture, gesture + 2, gesture + 4].map((value) => resolveGestureNote(((value - 1) % 9) + 1, scene, { bar, mode: HARMONY_MODES.STRICT_CHORD, baseMidi: definition.baseMidi }));
    return Object.freeze({ instrument, kind: 'chord', gesture, note, notes: Object.freeze(chord.map((item) => transposeIntoRange(item, definition.lowMidi, definition.highMidi))), velocity: safeVelocity, collectionId, presetId: collectionPreset });
  }
  return Object.freeze({ instrument, kind: 'pitched', gesture, note, velocity: safeVelocity, collectionId, presetId: collectionPreset });
}
