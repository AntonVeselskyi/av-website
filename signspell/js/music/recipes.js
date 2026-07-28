import { getVibeCollection } from './collections.js?v=4';
import { quantizeBeat } from './tonal.js?v=4';

export function seededRandom(seed = 1) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createLoopEvent({ laneId, instrument, startBeat, gesture, velocity = 0.8, durationBeat = 0.25 }) {
  return Object.freeze({ laneId, instrument, startBeat: quantizeBeat(startBeat), gesture, velocity: Math.max(0, Math.min(1, velocity)), durationBeat: Math.max(0.03125, durationBeat) });
}

function makeMelody(random, bars, laneId = 'melody') {
  const events = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const slots = [0, 0.75, 1.5, 2.5, 3.25];
    slots.forEach((offset, index) => {
      if (random() > (index === 0 ? 0.05 : 0.34)) events.push(createLoopEvent({ laneId, instrument: 'eerieLead', startBeat: bar * 4 + offset, gesture: 2 + Math.floor(random() * 7), velocity: 0.48 + random() * 0.32, durationBeat: random() > 0.7 ? 0.75 : 0.25 }));
    });
  }
  return events;
}

function makePiano(random, bars, laneId = 'piano') {
  const events = [];
  for (let bar = 0; bar < bars; bar += 1) {
    [0, 1, 2, 3].forEach((offset, index) => events.push(createLoopEvent({ laneId, instrument: 'piano', startBeat: bar * 4 + offset, gesture: 1 + ((bar * 2 + index * 2 + Math.floor(random() * 2)) % 9), velocity: 0.42 + random() * 0.22, durationBeat: 0.68 })));
  }
  return events;
}

function makePercussion(random, bars, laneId = 'drums') {
  const events = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4;
    [0, 2].forEach((offset) => events.push(createLoopEvent({ laneId, instrument: 'percussion', startBeat: start + offset, gesture: 1, velocity: 0.76 + random() * 0.18 })));
    [1, 3].forEach((offset) => events.push(createLoopEvent({ laneId, instrument: 'percussion', startBeat: start + offset, gesture: random() > 0.45 ? 2 : 3, velocity: 0.58 + random() * 0.2 })));
    for (let step = 0; step < 16; step += 1) if (step % 2 === 0 || random() > 0.72) events.push(createLoopEvent({ laneId, instrument: 'percussion', startBeat: start + step / 4, gesture: step % 8 === 7 ? 5 : 4, velocity: 0.22 + random() * 0.22, durationBeat: 0.125 }));
  }
  return events;
}

function makeBass(random, bars, laneId = 'bass') {
  const events = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4;
    events.push(createLoopEvent({ laneId, instrument: '808', startBeat: start, gesture: 1, velocity: 0.82 + random() * 0.16, durationBeat: random() > 0.6 ? 1.5 : 0.75 }));
    if (random() > 0.35) events.push(createLoopEvent({ laneId, instrument: '808', startBeat: start + (random() > 0.5 ? 2.5 : 3), gesture: random() > 0.76 ? 3 : 1, velocity: 0.7 + random() * 0.18, durationBeat: 0.45 }));
  }
  return events;
}

/** Produces editable, original note events; it never loads or encodes audio samples. */
export function generateLoopRecipe({ collectionId = 'wiltedBedroom', seed = 1, bars = 4, include = ['bass', 'piano', 'melody', 'drums'] } = {}) {
  if (!Number.isInteger(bars) || bars < 1 || bars > 32) throw new RangeError('bars must be an integer from 1 through 32.');
  const collection = getVibeCollection(collectionId);
  const random = seededRandom(seed);
  const factories = { bass: makeBass, piano: makePiano, melody: makeMelody, drums: makePercussion };
  const lanes = include.map((id) => ({ id, instrument: id === 'bass' ? '808' : id === 'drums' ? 'percussion' : id === 'melody' ? 'eerieLead' : 'piano', lengthBars: bars, events: Object.freeze((factories[id] ? factories[id](random, bars, id) : []).sort((a, b) => a.startBeat - b.startBeat)) }));
  return Object.freeze({ schemaVersion: 1, collectionId: collection.id, seed: Number(seed) >>> 0, scene: collection.tonal, lengthBars: bars, lanes: Object.freeze(lanes.map(Object.freeze)) });
}
