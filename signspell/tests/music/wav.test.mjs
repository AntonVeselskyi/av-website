import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../../js/music/wav.js';

test('WAV encoder writes a valid PCM header and interleaves channels', () => {
  const channels = [Float32Array.from([0, 1]), Float32Array.from([-1, 0])]; const bytes = encodeWav({ numberOfChannels: 2, length: 2, sampleRate: 8000, getChannelData: (index) => channels[index] }); const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF'); assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), 'WAVE'); assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 8000); assert.equal(view.getInt16(44, true), 0); assert.equal(view.getInt16(46, true), -32768);
});
