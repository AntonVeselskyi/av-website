import { getVibeCollection } from './collections.js?v=9';
import { quantizeBeat } from './tonal.js?v=5';

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

function makeRiff(random, bars, laneId = 'riff') {
  const events = [];
  const cells = [0, 0.5, 0.75, 1.5, 2, 2.75, 3.25, 3.5];
  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4;
    cells.forEach((offset, index) => {
      if (index !== 0 && random() < 0.2) return;
      const openAccent = index === cells.length - 1 && bar % 2 === 1;
      events.push(createLoopEvent({
        laneId,
        instrument: 'overdrivenGuitar',
        startBeat: start + offset,
        gesture: 1 + ((bar * 3 + index * 2 + (index > 4 ? 1 : 0)) % 7),
        velocity: openAccent ? 0.9 : 0.58 + random() * 0.22,
        durationBeat: openAccent ? 0.72 : index % 3 === 1 ? 0.12 : 0.22,
      }));
    });
  }
  return events;
}

function makePercussion(random, bars, laneId = 'drums', collection = { id: 'wiltedBedroom' }) {
  const events = [];
  const add = (startBeat, gesture, velocity, durationBeat = 0.125) => events.push(createLoopEvent({ laneId, instrument: 'percussion', startBeat, gesture, velocity, durationBeat }));
  const human = (base, spread = 0.12) => Math.max(0.08, Math.min(1, base + (random() - 0.5) * spread));
  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4;
    if (collection.id === 'wiltedBedroom') {
      add(start, 1, human(0.86)); add(start + 2, 2, human(0.67));
      if (random() > 0.42) add(start + 2.75, 1, human(0.66));
      for (let step = 0; step < 8; step += 1) if (step % 2 === 0 || random() > 0.24) add(start + step * 0.5, step === 7 ? 5 : 4, human(step % 2 ? 0.24 : 0.34, 0.09));
      if (bar % 2 === 1) add(start + 3.75, 6, human(0.28));
    } else if (collection.id === 'cemeteryTape') {
      [0, 1.75, 3.25].forEach((offset, index) => { if (index === 0 || random() > 0.2) add(start + offset, 1, human(0.88 - index * 0.08)); });
      add(start + 2, random() > 0.52 ? 2 : 3, human(0.78));
      for (let step = 0; step < 16; step += 1) if (step % 2 === 0 || random() > 0.38) add(start + step * 0.25, step === 14 ? 5 : 4, human(step % 4 === 0 ? 0.42 : 0.27, 0.12));
      add(start + (bar % 2 ? 3.5 : 0.75), 7, human(0.38));
      if (bar === bars - 1) add(start + 3.75, 9, human(0.35));
    } else if (collection.id === 'redlineWound') {
      [0, 1.5, 2.75].forEach((offset, index) => { if (index !== 1 || random() > 0.32) add(start + offset, 1, human(index === 0 ? 0.96 : 0.79)); });
      add(start + 2, 3, human(0.9)); add(start + 2, 2, human(0.52));
      [0, 0.75, 1.5, 2.25, 3, 3.5, 3.75].forEach((offset, index) => add(start + offset, index === 6 ? 5 : 4, human(index > 4 ? 0.46 : 0.31, 0.1)));
      if (bar % 2 === 0) add(start + 3.25, 8, human(0.34));
    } else if (collection.id === 'ironChapel') {
      [0, 1.5, 3].forEach((offset, index) => add(start + offset, 1, human(index === 0 ? 0.95 : 0.78)));
      add(start + 2, 2, human(0.82));
      [0.75, 2.75].forEach((offset) => add(start + offset, 7, human(0.57)));
      for (let step = 0; step < 8; step += 1) if (step % 2 === 0 || random() > 0.55) add(start + step * 0.5, 4, human(0.3));
      add(start + 3.5, bar % 2 ? 9 : 8, human(0.4));
    } else if (collection.id === 'hollowVoltage') {
      [0, 1.5, 2.25, 3.25].forEach((offset, index) => add(start + offset, 1, human(index === 0 ? 0.98 : 0.82, 0.08)));
      add(start + 1, 2, human(0.92, 0.07)); add(start + 3, 3, human(0.72, 0.08));
      [0, 0.5, 1.25, 2, 2.5, 3.25, 3.75].forEach((offset, index) => add(start + offset, index === 6 ? 5 : 4, human(index % 3 === 0 ? 0.5 : 0.32, 0.1)));
      if (bar % 2 === 1) add(start + 3.5, 7, human(0.58));
    } else if (collection.id === 'avianChamber') {
      add(start, 1, human(0.58)); add(start + 2.5, 1, human(0.46));
      [1, 3].forEach((offset) => add(start + offset, 2, human(0.48)));
      [0.75, 1.75, 2.75, 3.75].forEach((offset, index) => add(start + offset, 6, human(index % 2 ? 0.34 : 0.43)));
      [0.5, 1.5, 2.5, 3.5].forEach((offset) => { if (random() > 0.28) add(start + offset, 8, human(0.2)); });
    } else {
      [0, 1.5, 2.5, 3.5].forEach((offset, index) => { if (index < 2 || random() > 0.18) add(start + offset, 1, human(index === 0 ? 0.88 : 0.68, 0.16)); });
      [1, 3].forEach((offset) => add(start + offset, 2, human(0.74, 0.14)));
      for (let step = 0; step < 8; step += 1) add(start + step * 0.5, step % 2 ? 5 : 4, human(step % 2 ? 0.34 : 0.29, 0.13));
      if (bar % 2 === 1) { add(start + 2.75, 6, human(0.42)); add(start + 3.75, 7, human(0.3)); }
    }
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
  const factories = { bass: makeBass, piano: makePiano, melody: makeMelody, drums: makePercussion, riff: makeRiff };
  const lanes = include.map((id) => ({ id, instrument: id === 'bass' ? '808' : id === 'drums' ? 'percussion' : id === 'melody' ? 'eerieLead' : id === 'riff' ? 'overdrivenGuitar' : 'piano', lengthBars: bars, events: Object.freeze((factories[id] ? factories[id](random, bars, id, collection) : []).sort((a, b) => a.startBeat - b.startBeat)) }));
  return Object.freeze({ schemaVersion: 1, collectionId: collection.id, seed: Number(seed) >>> 0, scene: collection.tonal, lengthBars: bars, lanes: Object.freeze(lanes.map(Object.freeze)) });
}
