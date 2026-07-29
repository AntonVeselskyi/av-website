import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav, prepareOfflineLanes, repeatedLengthBeats, requiredOfflineTailSeconds, resolveOfflineMaster } from '../../js/music/wav.js';
import { occurrencesBetween } from '../../js/music/transport.js';

test('WAV encoder writes a valid PCM header and interleaves channels', () => {
  const channels = [Float32Array.from([0, 1]), Float32Array.from([-1, 0])]; const bytes = encodeWav({ numberOfChannels: 2, length: 2, sampleRate: 8000, getChannelData: (index) => channels[index] }); const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF'); assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), 'WAVE'); assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 8000); assert.equal(view.getInt16(44, true), 0); assert.equal(view.getInt16(46, true), -32768);
});

test('WAV export repeat length is exactly three complete arrangements', () => {
  assert.equal(repeatedLengthBeats(32, 3), 96);
  assert.equal(repeatedLengthBeats(32, 3.8), 96);
  assert.equal(repeatedLengthBeats(0, 0), 1);
});

test('repeated arrangement scheduling has no duplicate event at repeat boundaries', () => {
  const lane = { id: 'bass', lengthBars: 2, events: [{ startBeat: 0, gesture: 1 }, { startBeat: 7.5, gesture: 6 }] };
  const beats = occurrencesBetween([lane], 0, repeatedLengthBeats(8, 3)).map((event) => event.beat);
  assert.deepEqual(beats, [0, 7.5, 8, 15.5, 16, 23.5]);
});

test('offline mix matches live mute, solo, and lane-gain routing', () => {
  const lanes = prepareOfflineLanes([
    { id: 'bass', gain: 0.5, reverb: 0.18, letRing: false, solo: true, events: [{ velocity: 0.8 }] },
    { id: 'pad', gain: 1, solo: false, events: [{ velocity: 0.8 }] },
    { id: 'muted', gain: 1, muted: true, solo: true, events: [{ velocity: 0.8 }] },
  ]);
  assert.deepEqual(lanes.map((lane) => lane.id), ['bass']);
  assert.equal(lanes[0].events[0].velocity, 0.4);
  assert.equal(lanes[0].events[0].reverb, 0.18);
  assert.equal(lanes[0].events[0].letRing, false);
});

test('offline mix carries the live master tone and reserves full long-voice tails', () => {
  assert.deepEqual(resolveOfflineMaster({ master: { volume: 0.61, subBoost: 0.9, distortion: 0.8, reverb: 0.34 } }), {
    volume: 0.61, subBoost: 0.9, distortion: 0.8, reverb: 0.34,
  });
  assert.equal(requiredOfflineTailSeconds({
    scene: { bpm: 120 }, lengthBeats: 4, minimum: 0.2,
    events: [{ mapped: { instrument: '808' }, durationSeconds: 3, when: 1.9 }],
  }), 3.5);
});
