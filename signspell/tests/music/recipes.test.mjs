import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLoopRecipe } from '../../js/music/recipes.js';
import { occurrencesBetween } from '../../js/music/transport.js';

test('loop recipes are deterministic and editable event data', () => {
  const first = generateLoopRecipe({ collectionId: 'cemeteryTape', seed: 77, bars: 2 }); const again = generateLoopRecipe({ collectionId: 'cemeteryTape', seed: 77, bars: 2 });
  assert.deepEqual(first, again); assert.ok(first.lanes.flatMap((lane) => lane.events).every((event) => Number.isFinite(event.startBeat) && event.gesture >= 1 && event.gesture <= 9));
});

test('scheduler occurrence helper repeats a one-bar lane without duplicating boundary hits', () => {
  const events = occurrencesBetween([{ id: 'x', lengthBars: 1, events: [{ startBeat: 0, gesture: 1 }] }], 0, 8);
  assert.deepEqual(events.map((event) => event.beat), [0, 4]);
});
