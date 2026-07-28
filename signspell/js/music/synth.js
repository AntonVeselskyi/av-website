import { resolveInstrumentGesture } from './collections.js';

function clamp(value, low = 0, high = 1) { return Math.max(low, Math.min(high, value)); }
function now(context, when) { return Math.max(context.currentTime, when ?? context.currentTime); }
function makeDistortionCurve(amount = 55) { const curve = new Float32Array(256); for (let i = 0; i < curve.length; i += 1) { const x = i * 2 / curve.length - 1; curve[i] = ((3 + amount) * x * 20 * Math.PI / 180) / (Math.PI + amount * Math.abs(x)); } return curve; }
function connectVoice(nodes, output) { nodes.slice(1).reduce((previous, node) => (previous.connect(node), node), nodes[0]).connect(output); }

export function createSafeMasterChain(context, { volume = 0.78, subBoost = 0.42, distortion = 0.34 } = {}) {
  const input = context.createGain(); const dcCut = context.createBiquadFilter(); const lowShelf = context.createBiquadFilter(); const saturator = context.createWaveShaper(); const compressor = context.createDynamicsCompressor(); const output = context.createGain();
  dcCut.type = 'highpass'; dcCut.frequency.value = 22; lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 105; saturator.oversample = '2x';
  compressor.threshold.value = -12; compressor.knee.value = 12; compressor.ratio.value = 8; compressor.attack.value = 0.003; compressor.release.value = 0.16;
  const setTone = ({ volume: nextVolume = volume, subBoost: nextSub = subBoost, distortion: nextGrit = distortion } = {}) => {
    const time = context.currentTime;
    output.gain.setTargetAtTime(clamp(nextVolume, 0, 1), time, 0.015);
    lowShelf.gain.setTargetAtTime(clamp(nextSub, 0, 1) * 12, time, 0.02);
    saturator.curve = makeDistortionCurve(8 + clamp(nextGrit, 0, 1) * 92);
  };
  input.connect(dcCut).connect(lowShelf).connect(saturator).connect(compressor).connect(output).connect(context.destination);
  setTone({ volume, subBoost, distortion });
  return Object.freeze({ input, output, lowShelf, saturator, setTone, disconnect: () => { input.disconnect(); output.disconnect(); } });
}

function envelope(gain, time, attack, hold, release, peak) { gain.gain.cancelScheduledValues(time); gain.gain.setValueAtTime(0.0001, time); gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), time + attack); gain.gain.setValueAtTime(Math.max(0.0001, peak), time + attack + hold); gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + hold + release); }
function oscillator(context, type, frequency, time) { const node = context.createOscillator(); node.type = type; node.frequency.setValueAtTime(frequency, time); return node; }
function stopLater(nodes, time) { nodes.forEach((node) => node.stop(time)); }

function play808(context, output, hit, time, duration) {
  const presets = { warmWound: [48, 210, 1.42, 0.75], tapeGrave: [76, 250, 1.58, 0.62], redline: [96, 310, 1.72, 0.5], ironLung: [118, 185, 1.86, 0.82] };
  const [driveAmount, cutoff, pitchDrop, tail] = presets[hit.presetId] || [70, 250, 1.55, 0.62];
  const osc = oscillator(context, hit.presetId === 'ironLung' ? 'triangle' : 'sine', hit.note.frequency * pitchDrop, time); const drive = context.createWaveShaper(); const gain = context.createGain(); const filter = context.createBiquadFilter();
  drive.curve = makeDistortionCurve(driveAmount); drive.oversample = '4x'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(cutoff, time); osc.frequency.exponentialRampToValueAtTime(Math.max(20, hit.note.frequency), time + 0.085);
  envelope(gain, time, 0.004, Math.max(0.04, duration * tail), Math.max(0.08, duration * 0.45), 0.48 * hit.velocity); connectVoice([osc, filter, drive, gain], output); osc.start(time); stopLater([osc], time + duration + 0.6);
}
function playLead(context, output, hit, time, duration) {
  const waveform = hit.presetId === 'razorMono' || hit.presetId === 'blownSpeaker' ? 'sawtooth' : 'triangle';
  const osc = oscillator(context, waveform, hit.note.frequency, time); const filter = context.createBiquadFilter(); const gain = context.createGain(); filter.type = 'bandpass'; filter.frequency.setValueAtTime(hit.note.frequency * (hit.presetId === 'graveBell' ? 3.4 : 2.2), time); filter.Q.value = hit.presetId === 'razorMono' ? 5.2 : 2.4; envelope(gain, time, 0.008, duration * 0.4, duration * 0.5, 0.24 * hit.velocity); connectVoice([osc, filter, gain], output); osc.start(time); stopLater([osc], time + duration + 0.7);
}
function playPiano(context, output, hit, time, duration) {
  const oscillators = [1, 2.01, 3.02]; const end = time + duration + 1.2;
  oscillators.forEach((ratio, index) => { const osc = oscillator(context, 'sine', hit.note.frequency * ratio, time); const gain = context.createGain(); envelope(gain, time, 0.003, 0.04, Math.max(0.3, duration * (1.25 - index * 0.18)), 0.16 * hit.velocity / ratio); connectVoice([osc, gain], output); osc.start(time); osc.stop(end); });
}
function noiseBuffer(context, seconds = 0.25) { const length = Math.max(1, Math.floor(context.sampleRate * seconds)); const buffer = context.createBuffer(1, length, context.sampleRate); const data = buffer.getChannelData(0); for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1; return buffer; }
function playPercussion(context, output, hit, time) {
  if (hit.voice === 'kick') return play808(context, output, { ...hit, note: { frequency: 52 } }, time, 0.16);
  const source = context.createBufferSource(); const filter = context.createBiquadFilter(); const gain = context.createGain(); source.buffer = noiseBuffer(context, hit.voice === 'openHat' ? 0.42 : 0.12); filter.type = hit.voice === 'metal' ? 'bandpass' : 'highpass'; filter.frequency.value = hit.voice === 'snare' || hit.voice === 'clap' ? 1300 : 6200; filter.Q.value = hit.voice === 'metal' ? 12 : 0.8;
  envelope(gain, time, 0.001, 0.015, hit.voice === 'openHat' ? 0.3 : 0.08, 0.2 * hit.velocity); connectVoice([source, filter, gain], output); source.start(time); source.stop(time + (hit.voice === 'openHat' ? 0.45 : 0.16));
}
function playPad(context, output, hit, time, duration) {
  const cold = hit.presetId === 'coldChapel';
  hit.notes.forEach((note, index) => { const osc = oscillator(context, cold && index === 1 ? 'sawtooth' : index % 2 ? 'triangle' : 'sine', note.frequency, time); const gain = context.createGain(); const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(cold ? 540 : 850, time); envelope(gain, time, cold ? 0.4 : 0.22, Math.max(0.3, duration), 0.7, 0.07 * hit.velocity); connectVoice([osc, filter, gain], output); osc.start(time); osc.stop(time + duration + 1.2); });
}

function groupKey(groupId) { return groupId == null || groupId === '' ? null : String(groupId); }

function fadeOutGain(gain, context, seconds) {
  const time = context.currentTime;
  const current = Math.max(0.0001, Number(gain.gain.value) || 1);
  gain.gain.cancelScheduledValues?.(time);
  gain.gain.setValueAtTime?.(current, time);
  gain.gain.exponentialRampToValueAtTime?.(0.0001, time + seconds);
}

/** Browser-native, sample-free instrument engine. */
export class MusicEngine {
  constructor(context, options = {}) {
    if (!context?.createOscillator) throw new TypeError('A Web Audio context is required.');
    this.context = context;
    this.master = createSafeMasterChain(context, options);
    this.groups = new Map();
  }
  outputForGroup(groupId) {
    const key = groupKey(groupId);
    if (!key) return this.master.input;
    const existing = this.groups.get(key);
    if (existing) return existing.input;
    const input = this.context.createGain();
    input.gain.value = 1;
    input.connect(this.master.input);
    this.groups.set(key, { input });
    return input;
  }
  /**
   * Fades a lane/group's live tails and drops its routing bus. A later trigger
   * using the same id creates a fresh bus, so clears and mutes are reversible.
   */
  stopGroup(groupId, { fadeSeconds = 0.025 } = {}) {
    const key = groupKey(groupId);
    if (!key) return false;
    const group = this.groups.get(key);
    if (!group) return false;
    this.groups.delete(key);
    const seconds = Math.max(0.005, Number(fadeSeconds) || 0.025);
    fadeOutGain(group.input, this.context, seconds);
    const disconnect = () => { try { group.input.disconnect(); } catch { /* already disconnected */ } };
    const timer = globalThis.setTimeout?.(disconnect, Math.ceil((seconds + 0.04) * 1000));
    // Do not keep a Node/SSR process alive merely to dispose a browser audio bus.
    timer?.unref?.();
    return true;
  }
  stopAllGroups(options) {
    const ids = [...this.groups.keys()];
    ids.forEach((groupId) => this.stopGroup(groupId, options));
    return ids.length;
  }
  trigger(mappedHit, when = this.context.currentTime, durationBeat = 0.25, bpm = 140, groupId = null) {
    const time = now(this.context, when); const duration = Math.max(0.03, durationBeat * 60 / bpm);
    const output = this.outputForGroup(groupId);
    if (mappedHit.kind === 'percussion') playPercussion(this.context, output, mappedHit, time);
    else if (mappedHit.instrument === '808') play808(this.context, output, mappedHit, time, duration);
    else if (mappedHit.instrument === 'eerieLead') playLead(this.context, output, mappedHit, time, duration);
    else if (mappedHit.instrument === 'piano') playPiano(this.context, output, mappedHit, time, duration);
    else if (mappedHit.kind === 'chord') playPad(this.context, output, mappedHit, time, duration);
    return mappedHit;
  }
  triggerGesture(command, when = this.context.currentTime) {
    const hit = resolveInstrumentGesture(command);
    return this.trigger(hit, when, command.durationBeat, command.scene.bpm, command.groupId);
  }
  dispose() { this.stopAllGroups({ fadeSeconds: 0.005 }); this.master.disconnect(); }
}
