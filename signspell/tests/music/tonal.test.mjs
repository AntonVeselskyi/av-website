import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMMAS, HARMONY_MODES, NOTE_ORDERS, createTonalScene, pitchClass, resolveGestureNote, resolveLowBassGestureNote } from '../../js/music/tonal.js';
import { VIBE_COLLECTIONS, resolveInstrumentGesture } from '../../js/music/collections.js';

test('strict harmony maps all nine signs to only the active chord tones', () => {
  const scene = createTonalScene({ root: 'E', gamma: 'aeolian', progression: [1] });
  const pitchClasses = new Set(Array.from({ length: 9 }, (_, index) => resolveGestureNote(index + 1, scene).midi % 12));
  assert.deepEqual([...pitchClasses].sort((a, b) => a - b), [4, 7, 11]); // E minor: E, G, B
});

test('free scale is ascending and changes root aliases correctly', () => {
  const scene = createTonalScene({ root: 'Db', gamma: 'harmonicMinor', harmonyMode: HARMONY_MODES.FREE_SCALE });
  const notes = Array.from({ length: 9 }, (_, index) => resolveGestureNote(index + 1, scene));
  assert.equal(pitchClass('C#'), 1); assert.ok(notes.every((note, index) => index === 0 || note.midi > notes[index - 1].midi));
});

test('low bass layout keeps all nine 808 gestures in the C1–G2 sub register', () => {
  const scene = createTonalScene({ root: 'E', gamma: 'aeolian', progression: [1, 6, 3, 7] });
  const notes = Array.from({ length: 9 }, (_, index) => resolveLowBassGestureNote(index + 1, scene, { bar: 0 }));
  assert.deepEqual(notes.map((note) => note.note), ['E1', 'F#1', 'G1', 'A1', 'B1', 'C2', 'D2', 'E2', 'F#2']);
  assert.ok(notes.every((note) => note.midi >= 24 && note.midi <= 43));
  assert.ok(notes.every((note, index) => index === 0 || note.midi > notes[index - 1].midi));
});

test('808 mapping follows the active progression chord and never reaches G3', () => {
  const scene = createTonalScene({ root: 'E', gamma: 'aeolian', progression: [1, 6, 3, 7] });
  const barZero = resolveInstrumentGesture({ instrument: '808', gesture: 1, scene, bar: 0 });
  const barOne = resolveInstrumentGesture({ instrument: '808', gesture: 1, scene, bar: 1 });
  const all = Array.from({ length: 9 }, (_, index) => resolveInstrumentGesture({ instrument: '808', gesture: index + 1, scene, bar: 1 }));
  assert.equal(barZero.note.note, 'E1');
  assert.equal(barOne.note.note, 'C1');
  assert.ok(all.every((hit) => hit.note.midi <= 43));
});

test('every collection maps every 808 gesture to its gamma inside the sub range', () => {
  for (const collection of Object.values(VIBE_COLLECTIONS)) {
    const allowedPitchClasses = new Set(GAMMAS[collection.tonal.gamma].intervals.map((interval) => (collection.tonal.root + interval) % 12));
    for (let bar = 0; bar < collection.tonal.progression.length; bar += 1) {
      for (let gesture = 1; gesture <= 9; gesture += 1) {
        const hit = resolveInstrumentGesture({ instrument: '808', gesture, scene: collection.tonal, bar, collectionId: collection.id });
        assert.ok(hit.note.midi >= 24 && hit.note.midi <= 43, `${collection.id} bar ${bar} gesture ${gesture}: ${hit.note.note}`);
        assert.ok(allowedPitchClasses.has(hit.note.midi % 12), `${collection.id} produced off-gamma ${hit.note.note}`);
      }
    }
  }
});

test('every track preset exposes independent bass and drum-kit voices', () => {
  for (const collection of Object.values(VIBE_COLLECTIONS)) {
    const bass = resolveInstrumentGesture({ instrument: 'bass', gesture: 4, scene: collection.tonal, collectionId: collection.id });
    const drum = resolveInstrumentGesture({ instrument: 'drumKit', gesture: 1, scene: collection.tonal, collectionId: collection.id });
    assert.equal(typeof bass.presetId, 'string', `${collection.id} bass preset missing`);
    assert.equal(typeof drum.presetId, 'string', `${collection.id} drum kit preset missing`);
    assert.equal(drum.voice, 'kick');
  }
});

test('descending note order makes 9 the lowest pitched note without relabeling the input', () => {
  const ascending = createTonalScene({ root: 'E', gamma: 'aeolian', harmonyMode: HARMONY_MODES.FREE_SCALE });
  const descending = createTonalScene({ root: 'E', gamma: 'aeolian', harmonyMode: HARMONY_MODES.FREE_SCALE, noteOrder: NOTE_ORDERS.DESCENDING });
  const ascendingLow = resolveInstrumentGesture({ instrument: 'piano', gesture: 1, scene: ascending });
  const descendingNine = resolveInstrumentGesture({ instrument: 'piano', gesture: 9, scene: descending });
  const ascendingHigh = resolveInstrumentGesture({ instrument: 'piano', gesture: 9, scene: ascending });
  const descendingOne = resolveInstrumentGesture({ instrument: 'piano', gesture: 1, scene: descending });

  assert.equal(descendingNine.gesture, 9);
  assert.equal(descendingNine.mappedGesture, 1);
  assert.equal(descendingNine.note.midi, ascendingLow.note.midi);
  assert.equal(descendingOne.note.midi, ascendingHigh.note.midi);
});

test('note order does not scramble drum voices', () => {
  const scene = createTonalScene({ noteOrder: NOTE_ORDERS.DESCENDING });
  assert.equal(resolveInstrumentGesture({ instrument: 'drumKit', gesture: 1, scene }).voice, 'kick');
  assert.equal(resolveInstrumentGesture({ instrument: 'drumKit', gesture: 9, scene }).voice, 'reverse');
});

test('tonal scenes reject unknown note orders', () => {
  assert.throws(() => createTonalScene({ noteOrder: 'insideOut' }), /Unknown note order/);
});
