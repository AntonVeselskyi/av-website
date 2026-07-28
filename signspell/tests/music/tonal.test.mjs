import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMMAS, HARMONY_MODES, createTonalScene, pitchClass, resolveGestureNote, resolveLowBassGestureNote } from '../../js/music/tonal.js';
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
