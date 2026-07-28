import { resolveInstrumentGesture } from './collections.js';
import { MusicEngine } from './synth.js';
import { occurrencesBetween, secondsPerBeat } from './transport.js';

function writeString(view, offset, value) { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); }

/** Encodes an AudioBuffer-like object into stereo/interleaved 16-bit little-endian PCM WAV. */
export function encodeWav(audioBuffer) {
  const channels = Math.max(1, Math.min(2, audioBuffer.numberOfChannels)); const frames = audioBuffer.length; const sampleRate = audioBuffer.sampleRate; const bytes = 44 + frames * channels * 2; const buffer = new ArrayBuffer(bytes); const view = new DataView(buffer);
  writeString(view, 0, 'RIFF'); view.setUint32(4, bytes - 8, true); writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); writeString(view, 36, 'data'); view.setUint32(40, frames * channels * 2, true);
  let offset = 44; for (let frame = 0; frame < frames; frame += 1) for (let channel = 0; channel < channels; channel += 1) { const value = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[frame] || 0)); view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7FFF, true); offset += 2; }
  return new Uint8Array(buffer);
}

export function createWavBlob(audioBuffer) { return new Blob([encodeWav(audioBuffer)], { type: 'audio/wav' }); }

/** Renders loop-event data with the exact same native instruments used live. */
export async function renderOfflineProject({ OfflineAudioContextCtor = globalThis.OfflineAudioContext, scene, lanes, lengthBeats, sampleRate = 44100, tailSeconds = 2, volume = 0.72 }) {
  if (!OfflineAudioContextCtor) throw new Error('OfflineAudioContext is not supported in this browser.');
  const seconds = lengthBeats * secondsPerBeat(scene.bpm) + tailSeconds; const context = new OfflineAudioContextCtor(2, Math.ceil(seconds * sampleRate), sampleRate); const engine = new MusicEngine(context, { volume });
  for (const event of occurrencesBetween(lanes, 0, lengthBeats)) {
    const mapped = resolveInstrumentGesture({ instrument: event.instrument, gesture: event.gesture, scene, bar: event.bar, velocity: event.velocity, collectionId: event.collectionId });
    engine.trigger(mapped, event.beat * secondsPerBeat(scene.bpm), event.durationBeat, scene.bpm);
  }
  const result = await context.startRendering(); engine.dispose(); return result;
}
