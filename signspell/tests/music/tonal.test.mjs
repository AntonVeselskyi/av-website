import test from 'node:test';
import assert from 'node:assert/strict';
import { HARMONY_MODES, createTonalScene, pitchClass, resolveGestureNote } from '../../js/music/tonal.js';

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
