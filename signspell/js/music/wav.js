import { resolveInstrumentGesture } from './collections.js?v=7';
import { MusicEngine } from './synth.js?v=12';
import { occurrencesBetween, secondsPerBeat } from './transport.js?v=5';

function writeString(view, offset, value) { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); }

/** Encodes an AudioBuffer-like object into stereo/interleaved 16-bit little-endian PCM WAV. */
export function encodeWav(audioBuffer) {
  const channels = Math.max(1, Math.min(2, audioBuffer.numberOfChannels)); const frames = audioBuffer.length; const sampleRate = audioBuffer.sampleRate; const bytes = 44 + frames * channels * 2; const buffer = new ArrayBuffer(bytes); const view = new DataView(buffer);
  writeString(view, 0, 'RIFF'); view.setUint32(4, bytes - 8, true); writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); writeString(view, 36, 'data'); view.setUint32(40, frames * channels * 2, true);
  let offset = 44; for (let frame = 0; frame < frames; frame += 1) for (let channel = 0; channel < channels; channel += 1) { const value = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[frame] || 0)); view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7FFF, true); offset += 2; }
  return new Uint8Array(buffer);
}

export function createWavBlob(audioBuffer) { return new Blob([encodeWav(audioBuffer)], { type: 'audio/wav' }); }

/** Length of a repeated offline arrangement, measured in musical beats. */
export function repeatedLengthBeats(lengthBeats, repeats = 1) {
  return Math.max(1, Number(lengthBeats) || 1) * Math.max(1, Math.floor(Number(repeats) || 1));
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

/** Mirrors the live scheduler's mute/solo and per-lane gain rules. */
export function prepareOfflineLanes(lanes = []) {
  const source = Array.isArray(lanes) ? lanes : [];
  const soloed = source.some((lane) => lane?.solo);
  return source
    .filter((lane) => lane && !lane.muted && (!soloed || lane.solo))
    .map((lane) => {
      const gain = Number.isFinite(Number(lane.gain)) ? Number(lane.gain) : 1;
      return {
        ...lane,
        events: (lane.events || []).map((event) => ({
          ...event,
          velocity: clamp((Number.isFinite(Number(event.velocity)) ? Number(event.velocity) : 0.8) * gain, 0.02, 1),
          reverb: Number.isFinite(Number(event.reverb)) ? Number(event.reverb) : Number(lane.reverb) || 0,
          letRing: event.letRing ?? lane.letRing ?? true,
        })),
      };
    });
}

function voiceTailSeconds(hit, durationSeconds) {
  if (hit.kind === 'percussion') return hit.voice === 'openHat' ? 0.45 : hit.voice === 'kick' ? 0.76 : 0.16;
  if (hit.instrument === '808') return durationSeconds + 0.6;
  if (hit.instrument === 'bass') return durationSeconds + 0.55;
  if (hit.instrument === 'eerieLead' || hit.instrument === 'organ' || hit.instrument === 'violin') return durationSeconds + 0.9;
  if (hit.instrument === 'steelGuitar') return durationSeconds + 1.4;
  if (hit.instrument === 'piano' || hit.kind === 'chord') return durationSeconds + 1.2;
  return durationSeconds + 0.3;
}

function resolvedOfflineEvents({ scene, lanes, lengthBeats }) {
  const seconds = secondsPerBeat(scene.bpm);
  return occurrencesBetween(prepareOfflineLanes(lanes), 0, lengthBeats).map((event) => {
    const mapped = resolveInstrumentGesture({ instrument: event.instrument, gesture: event.gesture, scene, bar: event.bar, velocity: event.velocity, collectionId: event.collectionId });
    const durationSeconds = Math.max(0.03, Number(event.durationBeat) * seconds);
    return { event, mapped, durationSeconds, when: event.beat * seconds };
  });
}

export function resolveOfflineMaster({ volume = 0.72, subBoost = 0.42, distortion = 0.34, master = null } = {}) {
  return { volume, subBoost, distortion, ...(master || {}) };
}

/** Returns enough post-loop room for the same voice envelopes used live. */
export function requiredOfflineTailSeconds({ scene, events, lengthBeats, minimum = 2 }) {
  const loopSeconds = lengthBeats * secondsPerBeat(scene.bpm);
  return events.reduce((tail, { mapped, durationSeconds, when }) => Math.max(tail, Math.max(0, when + voiceTailSeconds(mapped, durationSeconds) - loopSeconds)), Math.max(0, Number(minimum) || 0));
}

/** Renders loop-event data with the exact same native instruments used live. */
export async function renderOfflineProject({ OfflineAudioContextCtor = globalThis.OfflineAudioContext, scene, lanes, lengthBeats, repeats = 1, sampleRate = 44100, tailSeconds = 2, volume = 0.72, subBoost = 0.42, distortion = 0.34, master = null }) {
  if (!OfflineAudioContextCtor) throw new Error('OfflineAudioContext is not supported in this browser.');
  const totalBeats = repeatedLengthBeats(lengthBeats, repeats);
  const events = resolvedOfflineEvents({ scene, lanes, lengthBeats: totalBeats });
  const resolvedMaster = resolveOfflineMaster({ volume, subBoost, distortion, master });
  const resolvedTail = requiredOfflineTailSeconds({ scene, events, lengthBeats: totalBeats, minimum: tailSeconds });
  const seconds = totalBeats * secondsPerBeat(scene.bpm) + resolvedTail;
  const context = new OfflineAudioContextCtor(2, Math.ceil(seconds * sampleRate), sampleRate);
  const engine = new MusicEngine(context, resolvedMaster);
  for (const { event, mapped, when } of events) {
    engine.trigger(mapped, when, event.durationBeat, scene.bpm, event.laneId, { reverb: event.reverb, letRing: event.letRing });
  }
  const result = await context.startRendering(); engine.dispose(); return result;
}
