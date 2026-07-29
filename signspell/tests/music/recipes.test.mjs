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

test('conjured drums use a distinct rhythmic grammar for every vibe preset', () => {
  const ids = ['wiltedBedroom', 'cemeteryTape', 'redlineWound', 'ironChapel', 'avianChamber', 'psychedelicSun'];
  const patterns = ids.map((collectionId) => generateLoopRecipe({ collectionId, seed: 91, bars: 2, include: ['drums'] }).lanes[0].events);
  const signatures = patterns.map((events) => events.map((event) => `${event.startBeat}:${event.gesture}:${event.velocity.toFixed(2)}`).join('|'));
  assert.equal(new Set(signatures).size, ids.length);
  assert.ok(patterns[1].some((event) => event.gesture === 7), 'cemetery pattern needs metallic punctuation');
  assert.ok(patterns[4].some((event) => event.gesture === 6), 'avian pattern needs hand/rim pulse');
  assert.ok(patterns[5].some((event) => event.gesture === 5), 'psych pattern needs open-hat lift');
});
