import { HARMONY_MODES, NOTE_ORDERS, createTonalScene, resolveGestureNote, resolveLowBassGestureNote } from './tonal.js?v=6';

export const INSTRUMENTS = Object.freeze({
  '808': Object.freeze({ id: '808', label: '808', kind: 'pitched', preferredMode: HARMONY_MODES.SAFE_SCALE, bassLayout: 'lowGamma', baseMidi: 24, lowMidi: 24, highMidi: 43 }),
  bass: Object.freeze({ id: 'bass', label: 'Psych Bass', kind: 'pitched', preferredMode: HARMONY_MODES.SAFE_SCALE, baseMidi: 32, lowMidi: 28, highMidi: 55 }),
  // Keep the legacy id so existing saved lanes migrate without intervention.
  eerieLead: Object.freeze({ id: 'eerieLead', label: 'Viby Synth', kind: 'pitched', preferredMode: HARMONY_MODES.SAFE_SCALE, baseMidi: 60, lowMidi: 55, highMidi: 96 }),
  organ: Object.freeze({ id: 'organ', label: 'Dust Organ', kind: 'pitched', preferredMode: HARMONY_MODES.SAFE_SCALE, baseMidi: 48, lowMidi: 43, highMidi: 84 }),
  steelGuitar: Object.freeze({ id: 'steelGuitar', label: 'Steel String', kind: 'pitched', preferredMode: HARMONY_MODES.SAFE_SCALE, baseMidi: 52, lowMidi: 45, highMidi: 88 }),
  violin: Object.freeze({ id: 'violin', label: 'Bleeding Violin', kind: 'pitched', preferredMode: HARMONY_MODES.SAFE_SCALE, baseMidi: 60, lowMidi: 55, highMidi: 96 }),
  piano: Object.freeze({ id: 'piano', label: 'Felt Piano', kind: 'pitched', preferredMode: HARMONY_MODES.SAFE_SCALE, baseMidi: 48, lowMidi: 48, highMidi: 91 }),
  percussion: Object.freeze({ id: 'percussion', label: 'Grit Percussion', kind: 'percussion' }),
  drumKit: Object.freeze({ id: 'drumKit', label: 'Trap Drum Kit', kind: 'percussion' }),
  pad: Object.freeze({ id: 'pad', label: 'Ghost Pad', kind: 'chord', preferredMode: HARMONY_MODES.STRICT_CHORD, baseMidi: 48, lowMidi: 48, highMidi: 83 }),
});

export const PERCUSSION_CELLS = Object.freeze(['kick', 'snare', 'clap', 'closedHat', 'openHat', 'rim', 'metal', 'noise', 'reverse']);

const collection = (id, title, description, tonal, instruments) => Object.freeze({ id, title, description, tonal: createTonalScene(tonal), instruments: Object.freeze(instruments) });

// These are original mood collections, not artist presets and contain no samples.
export const VIBE_COLLECTIONS = Object.freeze({
  wiltedBedroom: collection('wiltedBedroom', 'WILTED BEDROOM', 'Warm, bruised emo-trap: detuned keys, worn plucks and a soft sagging sub.', { root: 'E', gamma: 'aeolian', harmonyMode: HARMONY_MODES.STRICT_CHORD, progression: [1, 6, 3, 7], bpm: 132 }, { '808': 'warmWound', bass: 'softPickBass', eerieLead: 'velvetChorus', organ: 'bedroomReed', steelGuitar: 'oldBronze', violin: 'softRosin', piano: 'feltTape', percussion: 'softRust', drumKit: 'bedroomKit', pad: 'sleepingHall' }),
  cemeteryTape: collection('cemeteryTape', 'CEMETERY TAPE', 'VHS horror-trap: metallic hits, spectral bells and compressed low end.', { root: 'D', gamma: 'harmonicMinor', harmonyMode: HARMONY_MODES.STRICT_CHORD, progression: [1, 6, 4, 5], bpm: 140 }, { '808': 'tapeGrave', bass: 'gravePickBass', eerieLead: 'neonCrypt', organ: 'funeralPipes', steelGuitar: 'graveWire', violin: 'cryptRosin', piano: 'cryptKeys', percussion: 'vhsMetal', drumKit: 'cemeteryKit', pad: 'choirDust' }),
  redlineWound: collection('redlineWound', 'REDLINE WOUND', 'Intimate piano against clipped, close-up bass and sparse impact drums.', { root: 'F', gamma: 'minorPentatonic', harmonyMode: HARMONY_MODES.STRICT_CHORD, progression: [1, 4, 3, 5], bpm: 150 }, { '808': 'redline', bass: 'overdriveBass', eerieLead: 'nightDrive', organ: 'smallChurch', steelGuitar: 'brightScar', violin: 'closeBow', piano: 'bareFelt', percussion: 'impact', drumKit: 'redlineKit', pad: 'roomTone' }),
  ironChapel: collection('ironChapel', 'IRON CHAPEL', 'Industrial half-time trap: scraped metal, detuned organ and severe mono bass.', { root: 'C#', gamma: 'phrygian', harmonyMode: HARMONY_MODES.STRICT_CHORD, progression: [1, 2, 7, 1], bpm: 165 }, { '808': 'ironLung', bass: 'fuzzBass', eerieLead: 'blackGlass', organ: 'ironDrawbar', steelGuitar: 'rustString', violin: 'razorBow', piano: 'brokenOrgan', percussion: 'ironDust', drumKit: 'ironKit', pad: 'coldChapel' }),
  avianChamber: collection('avianChamber', 'BOWED CLOCKWORK', 'Looped violin, chamber plucks and human-scale rhythmic machinery.', { root: 'G', gamma: 'dorian', harmonyMode: HARMONY_MODES.STRICT_CHORD, progression: [1, 4, 2, 5], bpm: 118 }, { '808': 'chamberSub', bass: 'uprightShadow', eerieLead: 'whistleGlass', organ: 'reedChamber', steelGuitar: 'clockworkPluck', violin: 'loopedBow', piano: 'woodRoom', percussion: 'handMachine', drumKit: 'brushKit', pad: 'chamberAir' }),
  psychedelicSun: collection('psychedelicSun', 'PSYCH SUNROOM', 'Compressed psych bass, phaser-coloured synths and sun-bleached live drums.', { root: 'F#', gamma: 'dorian', harmonyMode: HARMONY_MODES.STRICT_CHORD, progression: [1, 3, 7, 4], bpm: 126 }, { '808': 'sunsetSub', bass: 'sunsetCompressor', eerieLead: 'liquidPhase', organ: 'rotarySun', steelGuitar: 'tapeTwelve', violin: 'mellotronBow', piano: 'warpedKeys', percussion: 'tapeDust', drumKit: 'sunroomKit', pad: 'analogCloud' }),
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
  if (!Number.isInteger(gesture) || gesture < 1 || gesture > 9) throw new RangeError('Gesture must be 1 through 9.');
  // Keep the detected/pressed digit intact for the HUD and loop grid. Only
  // reverse its musical position, so 9 becomes the low note when requested.
  const mappedGesture = scene.noteOrder === NOTE_ORDERS.DESCENDING ? 10 - gesture : gesture;
  const rawNote = definition.bassLayout === 'lowGamma'
    ? resolveLowBassGestureNote(mappedGesture, scene, { bar, baseMidi: definition.baseMidi })
    : resolveGestureNote(mappedGesture, scene, { bar, mode: definition.preferredMode, baseMidi: definition.baseMidi });
  const note = transposeIntoRange(rawNote, definition.lowMidi, definition.highMidi);
  if (definition.kind === 'chord') {
    const chord = [mappedGesture, mappedGesture + 2, mappedGesture + 4].map((value) => resolveGestureNote(((value - 1) % 9) + 1, scene, { bar, mode: HARMONY_MODES.STRICT_CHORD, baseMidi: definition.baseMidi }));
    return Object.freeze({ instrument, kind: 'chord', gesture, mappedGesture, note, notes: Object.freeze(chord.map((item) => transposeIntoRange(item, definition.lowMidi, definition.highMidi))), velocity: safeVelocity, collectionId, presetId: collectionPreset });
  }
  return Object.freeze({ instrument, kind: 'pitched', gesture, mappedGesture, note, velocity: safeVelocity, collectionId, presetId: collectionPreset });
}
