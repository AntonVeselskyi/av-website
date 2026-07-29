import { resolveInstrumentGesture } from './collections.js?v=9';
import { resolveInstrumentStyle } from './instrument-styles.js?v=2';

function clamp(value, low = 0, high = 1) { return Math.max(low, Math.min(high, value)); }
function now(context, when) { return Math.max(context.currentTime, when ?? context.currentTime); }
function makeDistortionCurve(amount = 55) { const curve = new Float32Array(256); for (let i = 0; i < curve.length; i += 1) { const x = i * 2 / curve.length - 1; curve[i] = ((3 + amount) * x * 20 * Math.PI / 180) / (Math.PI + amount * Math.abs(x)); } return curve; }
function connectVoice(nodes, output) { nodes.slice(1).reduce((previous, node) => (previous.connect(node), node), nodes[0]).connect(output); }

function createReverbBus(context, output, amount = 0.34) {
  if (!context.createConvolver || !context.createBuffer) {
    return Object.freeze({ input: null, wet: null, setAmount: () => {}, disconnect: () => {} });
  }
  const input = context.createGain(); const convolver = context.createConvolver(); const wet = context.createGain();
  const seconds = 1.85; const sampleRate = context.sampleRate || 44100; const length = Math.max(1, Math.floor(sampleRate * seconds));
  const impulse = context.createBuffer(2, length, sampleRate);
  let seed = 0x51a7c0de;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const decay = (1 - index / length) ** 2.65;
      data[index] = (random() * 2 - 1) * decay * (channel ? 0.92 : 1);
    }
  }
  convolver.buffer = impulse;
  input.connect(convolver).connect(wet).connect(output);
  let currentAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0.34;
  const setAmount = (value, immediate = false) => {
    if (Number.isFinite(Number(value))) currentAmount = Number(value);
    const next = clamp(currentAmount, 0, 1) * 0.72; const time = context.currentTime;
    if (immediate) wet.gain.setValueAtTime(next, time);
    else wet.gain.setTargetAtTime(next, time, 0.035);
  };
  setAmount(amount, true);
  return Object.freeze({ input, wet, setAmount, disconnect: () => { input.disconnect(); wet.disconnect(); } });
}

export function createSafeMasterChain(context, { volume = 0.78, subBoost = 0.42, distortion = 0.34 } = {}) {
  const input = context.createGain(); const dcCut = context.createBiquadFilter(); const lowShelf = context.createBiquadFilter(); const saturator = context.createWaveShaper(); const compressor = context.createDynamicsCompressor(); const output = context.createGain();
  dcCut.type = 'highpass'; dcCut.frequency.value = 22; lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 105; saturator.oversample = '2x';
  compressor.threshold.value = -12; compressor.knee.value = 12; compressor.ratio.value = 8; compressor.attack.value = 0.003; compressor.release.value = 0.16;
  const setTone = ({ volume: nextVolume = volume, subBoost: nextSub = subBoost, distortion: nextGrit = distortion, immediate = false } = {}) => {
    const time = context.currentTime;
    const outputValue = clamp(nextVolume, 0, 1);
    const shelfValue = clamp(nextSub, 0, 1) * 12;
    if (immediate) {
      output.gain.setValueAtTime(outputValue, time);
      lowShelf.gain.setValueAtTime(shelfValue, time);
    } else {
      output.gain.setTargetAtTime(outputValue, time, 0.015);
      lowShelf.gain.setTargetAtTime(shelfValue, time, 0.02);
    }
    saturator.curve = makeDistortionCurve(8 + clamp(nextGrit, 0, 1) * 92);
  };
  input.connect(dcCut).connect(lowShelf).connect(saturator).connect(compressor).connect(output).connect(context.destination);
  // Avoid a short unprocessed initial transient in offline exports. Fader
  // changes after initialization retain their live smoothing behavior.
  setTone({ volume, subBoost, distortion, immediate: true });
  return Object.freeze({ input, output, lowShelf, saturator, setTone, disconnect: () => { input.disconnect(); output.disconnect(); } });
}

function envelope(gain, time, attack, hold, release, peak) { gain.gain.cancelScheduledValues(time); gain.gain.setValueAtTime(0.0001, time); gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), time + attack); gain.gain.setValueAtTime(Math.max(0.0001, peak), time + attack + hold); gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + hold + release); }
function oscillator(context, type, frequency, time) { const node = context.createOscillator(); node.type = type; node.frequency.setValueAtTime(frequency, time); return node; }
function stopLater(nodes, time) { nodes.forEach((node) => node.stop(time)); }

function play808(context, output, hit, time, duration) {
  const style = resolveInstrumentStyle('808', hit.presetId);
  const osc = oscillator(context, style.wave, hit.note.frequency * style.pitchDrop, time); const overtone = oscillator(context, style.overtoneWave, hit.note.frequency * 2, time); const overtoneMix = context.createGain(); const drive = context.createWaveShaper(); const gain = context.createGain(); const filter = context.createBiquadFilter();
  overtoneMix.gain.value = style.overtoneMix; drive.curve = makeDistortionCurve(style.drive); drive.oversample = '4x'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); filter.Q.value = style.resonance; osc.frequency.exponentialRampToValueAtTime(Math.max(20, hit.note.frequency), time + style.pitchTime);
  osc.connect(filter); overtone.connect(overtoneMix).connect(filter); filter.connect(drive).connect(gain).connect(output);
  envelope(gain, time, 0.004, Math.max(0.04, duration * style.hold), Math.max(0.08, duration * style.release), style.level * hit.velocity); osc.start(time); overtone.start(time); stopLater([osc, overtone], time + duration + 0.7);
}
function playBass(context, output, hit, time, duration) {
  const style = resolveInstrumentStyle(hit.instrument === 'overdrivenBass' ? 'overdrivenBass' : 'bass', hit.presetId);
  const a = oscillator(context, style.waveA, hit.note.frequency, time); const b = oscillator(context, style.waveB, hit.note.frequency * style.ratioB, time); const bMix = context.createGain(); const filter = context.createBiquadFilter(); const drive = context.createWaveShaper(); const gain = context.createGain();
  setDetune(a, -style.detune * 0.35, time); setDetune(b, style.detune, time); bMix.gain.value = style.mixB; filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); filter.Q.value = style.resonance; drive.curve = makeDistortionCurve(style.drive); drive.oversample = '2x';
  a.connect(filter); b.connect(bMix).connect(filter); filter.connect(drive).connect(gain).connect(output);
  envelope(gain, time, style.attack, Math.max(0.05, duration * style.sustain), Math.max(0.18, duration * style.release), (style.level ?? 0.29) * hit.velocity);
  a.start(time); b.start(time); stopLater([a, b], time + duration + style.release + 0.2);
}
function setDetune(osc, cents, time) { osc.detune?.setValueAtTime?.(cents, time); }

function playVibySynth(context, output, hit, time, duration) {
  const style = resolveInstrumentStyle('eerieLead', hit.presetId);
  const a = oscillator(context, style.waveA, hit.note.frequency, time); const b = oscillator(context, style.waveB, hit.note.frequency, time); const lfo = oscillator(context, 'sine', style.vibratoRate, time); const vibrato = context.createGain();
  const aMix = context.createGain(); const bMix = context.createGain(); const filter = context.createBiquadFilter(); const gain = context.createGain();
  setDetune(a, -style.cents, time); setDetune(b, style.cents, time); vibrato.gain.value = style.vibratoDepth; lfo.connect(vibrato); vibrato.connect(a.detune); vibrato.connect(b.detune); aMix.gain.value = 1 - style.mixB; bMix.gain.value = style.mixB;
  filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); filter.Q.value = style.resonance;
  a.connect(aMix).connect(filter); b.connect(bMix).connect(filter); filter.connect(gain).connect(output);
  envelope(gain, time, style.attack, Math.max(0.08, duration * 0.58), Math.max(0.24, duration * style.release), 0.19 * hit.velocity);
  a.start(time); b.start(time); lfo.start(time); stopLater([a, b, lfo], time + duration + style.release + 0.25);
}

function playOrgan(context, output, hit, time, duration) {
  const style = resolveInstrumentStyle('organ', hit.presetId); const drawbars = style.drawbars;
  const ratios = [0.5, 1, 2, 3, 4]; const filter = context.createBiquadFilter(); const gain = context.createGain(); const voices = [];
  filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); filter.Q.value = style.resonance;
  ratios.forEach((ratio, index) => { const osc = oscillator(context, 'sine', hit.note.frequency * ratio, time); const partial = context.createGain(); partial.gain.value = drawbars[index]; osc.connect(partial).connect(filter); osc.start(time); voices.push(osc); });
  filter.connect(gain).connect(output); envelope(gain, time, style.attack, Math.max(0.12, duration * 0.8), style.release, 0.12 * hit.velocity); stopLater(voices, time + duration + style.release + 0.3);
}

function playSteelGuitar(context, output, hit, time, duration) {
  const style = resolveInstrumentStyle('steelGuitar', hit.presetId);
  // A short noise excitation recirculating through a tuned, damped delay is a
  // Karplus–Strong string model. It produces the shifting inharmonic attack
  // and natural decay that stacked oscillators cannot fake.
  if (context.createDelay && context.createBufferSource && context.createBuffer) {
    const period = 1 / Math.max(40, hit.note.frequency); const excitation = context.createBufferSource(); const delay = context.createDelay(0.1); const damping = context.createBiquadFilter(); const feedback = context.createGain(); const body = context.createBiquadFilter(); const gain = context.createGain();
    const buffer = context.createBuffer(1, Math.max(2, Math.ceil(context.sampleRate * period * 1.5)), context.sampleRate); const data = buffer.getChannelData(0); let previous = 0;
    for (let index = 0; index < data.length; index += 1) { const white = Math.random() * 2 - 1; previous = white * 0.72 + previous * 0.28; data[index] = previous; }
    excitation.buffer = buffer; delay.delayTime.setValueAtTime(period, time); damping.type = 'lowpass'; damping.frequency.setValueAtTime(style.damping, time); damping.Q.value = 0.25; feedback.gain.setValueAtTime(style.feedback, time);
    body.type = 'bandpass'; body.frequency.setValueAtTime(Math.min(6200, hit.note.frequency * style.bodyRatio), time); body.Q.value = style.bodyQ;
    excitation.connect(delay); delay.connect(damping).connect(feedback).connect(delay); delay.connect(body).connect(gain).connect(output);
    envelope(gain, time, 0.001, Math.max(0.06, duration * 0.32), Math.max(style.release * 0.55, duration * 1.8), 0.34 * style.brightness * hit.velocity);
    feedback.gain.exponentialRampToValueAtTime(0.0001, time + duration + style.release); excitation.start(time); excitation.stop(time + buffer.length / context.sampleRate + 0.01);
    const disconnect = () => { try { delay.disconnect(); damping.disconnect(); feedback.disconnect(); body.disconnect(); gain.disconnect(); } catch { /* already released */ } };
    const timer = globalThis.setTimeout?.(disconnect, Math.ceil((Math.max(0, time - context.currentTime) + duration + style.release + 0.25) * 1000)); timer?.unref?.();
    return;
  }
  const voices = []; [1, 2, 3, 4, 5].forEach((ratio, index) => {
    const osc = oscillator(context, index < 2 ? 'triangle' : 'sine', hit.note.frequency * ratio, time); const gain = context.createGain();
    setDetune(osc, index % 2 ? style.detune : -style.detune * 0.65, time);
    envelope(gain, time, 0.002, 0.012, Math.max(0.28, duration * (1.5 - index * 0.17)), 0.2 * hit.velocity * style.brightness / (ratio ** 1.12));
    osc.connect(gain).connect(output); osc.start(time); voices.push(osc);
  });
  if (context.createBufferSource && context.createBuffer) {
    const pick = context.createBufferSource(); const pickFilter = context.createBiquadFilter(); const pickGain = context.createGain();
    pick.buffer = noiseBuffer(context, 0.045); pickFilter.type = 'highpass'; pickFilter.frequency.value = 2400;
    envelope(pickGain, time, 0.001, 0.005, 0.035, style.pickNoise * hit.velocity); connectVoice([pick, pickFilter, pickGain], output); pick.start(time); pick.stop(time + 0.06);
  }
  stopLater(voices, time + duration + style.release);
}

function createDrivenGuitarVoice(context, output, hit, time) {
  const style = resolveInstrumentStyle('overdrivenGuitar', hit.presetId);
  const a = oscillator(context, style.waveA, hit.note.frequency, time); const b = oscillator(context, style.waveB, hit.note.frequency, time); const bMix = context.createGain(); const highpass = context.createBiquadFilter(); const drive = context.createWaveShaper(); const cab = context.createBiquadFilter(); const gain = context.createGain();
  setDetune(a, -style.detune, time); setDetune(b, style.detune, time); bMix.gain.value = 0.44; highpass.type = 'highpass'; highpass.frequency.setValueAtTime(style.highpass, time); drive.curve = makeDistortionCurve(style.drive); drive.oversample = '4x'; cab.type = 'lowpass'; cab.frequency.setValueAtTime(style.cutoff, time); cab.Q.value = style.resonance;
  a.connect(highpass); b.connect(bMix).connect(highpass); highpass.connect(drive).connect(cab).connect(gain).connect(output); a.start(time); b.start(time);
  return { style, sources: [a, b], gain };
}

function playOverdrivenGuitar(context, output, hit, time, duration) {
  const voice = createDrivenGuitarVoice(context, output, hit, time); const { style } = voice;
  envelope(voice.gain, time, style.attack, Math.max(0.025, duration * style.sustain), Math.max(0.12, duration * style.release), style.level * hit.velocity);
  stopLater(voice.sources, time + duration + style.release + 0.2);
}

function playViolin(context, output, hit, time, duration) {
  const style = resolveInstrumentStyle('violin', hit.presetId);
  const a = oscillator(context, 'sawtooth', hit.note.frequency, time); const b = oscillator(context, 'sawtooth', hit.note.frequency, time);
  const lfo = oscillator(context, 'sine', 5.3, time); const vibrato = context.createGain(); const aMix = context.createGain(); const bMix = context.createGain(); const body = context.createBiquadFilter(); const gain = context.createGain();
  lfo.frequency.setValueAtTime(style.vibratoRate, time); setDetune(a, style.detuneA, time); setDetune(b, style.detuneB, time); vibrato.gain.value = style.vibratoDepth; lfo.connect(vibrato); vibrato.connect(a.detune); vibrato.connect(b.detune);
  aMix.gain.value = 0.58; bMix.gain.value = 0.42; body.type = 'lowpass'; body.frequency.setValueAtTime(style.cutoff, time); body.Q.value = style.resonance;
  a.connect(aMix).connect(body); b.connect(bMix).connect(body); body.connect(gain).connect(output);
  envelope(gain, time, style.attack, Math.max(0.12, duration * 0.75), style.release, 0.13 * hit.velocity);
  a.start(time); b.start(time); lfo.start(time); stopLater([a, b, lfo], time + duration + style.release + 0.25);
}
function playPiano(context, output, hit, time, duration) {
  const style = resolveInstrumentStyle('piano', hit.presetId); const end = time + duration + style.release + 0.2;
  style.ratios.forEach((ratio, index) => { const osc = oscillator(context, 'sine', hit.note.frequency * ratio, time); const gain = context.createGain(); const filter = context.createBiquadFilter(); setDetune(osc, index === 0 ? 0 : (index % 2 ? style.detune : -style.detune), time); filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); envelope(gain, time, style.attack, style.hold, Math.max(0.3, duration * style.release * (1 - index * 0.12)), 0.16 * hit.velocity * style.levels[index]); connectVoice([osc, filter, gain], output); osc.start(time); osc.stop(end); });
}
function noiseBuffer(context, seconds = 0.25) { const length = Math.max(1, Math.floor(context.sampleRate * seconds)); const buffer = context.createBuffer(1, length, context.sampleRate); const data = buffer.getChannelData(0); for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1; return buffer; }
function playKitKick(context, output, hit, time) {
  const style = resolveInstrumentStyle('drumKit', hit.presetId);
  const osc = oscillator(context, 'sine', style.kickStart, time); const gain = context.createGain();
  osc.frequency.exponentialRampToValueAtTime(style.kickEnd, time + style.kickPitchTime);
  envelope(gain, time, 0.001, 0.04, style.kickRelease, style.kickLevel * hit.velocity); osc.connect(gain).connect(output); osc.start(time); osc.stop(time + style.kickRelease + 0.16);
}
function playPercussion(context, output, hit, time) {
  if (hit.instrument === 'drumKit' && hit.voice === 'kick') return playKitKick(context, output, hit, time);
  const style = resolveInstrumentStyle(hit.instrument, hit.presetId);
  if (hit.voice === 'kick') {
    const osc = oscillator(context, 'triangle', style.bodyPitch * 0.72, time); const gain = context.createGain();
    osc.frequency.exponentialRampToValueAtTime(Math.max(42, style.bodyPitch * 0.26), time + 0.065 * style.decay); envelope(gain, time, 0.001, 0.025, 0.28 * style.decay, 0.42 * style.level * hit.velocity); osc.connect(gain).connect(output); osc.start(time); osc.stop(time + 0.42 * style.decay); return;
  }
  const { brightness, decay: decayScale, level } = style;
  const baseSeconds = hit.voice === 'openHat' ? 0.42 : hit.voice === 'reverse' ? 0.34 : hit.voice === 'snare' || hit.voice === 'clap' ? 0.18 : 0.12;
  const source = context.createBufferSource(); const filter = context.createBiquadFilter(); const gain = context.createGain(); source.buffer = noiseBuffer(context, baseSeconds * decayScale); filter.type = hit.voice === 'metal' ? 'bandpass' : 'highpass'; filter.frequency.value = (hit.voice === 'snare' || hit.voice === 'clap' ? 1300 : hit.voice === 'rim' ? 3100 : 6200) * brightness; filter.Q.value = hit.voice === 'metal' ? style.metalQ : hit.voice === 'rim' ? 3.4 : 0.8;
  const attack = hit.voice === 'reverse' ? 0.09 : 0.001; const release = (hit.voice === 'openHat' ? 0.3 : hit.voice === 'reverse' ? 0.2 : hit.voice === 'snare' ? 0.12 : 0.08) * decayScale;
  envelope(gain, time, attack, 0.015, release, 0.2 * level * hit.velocity); connectVoice([source, filter, gain], output); source.start(time); source.stop(time + baseSeconds * decayScale + 0.04);
  if (hit.voice === 'snare' || hit.voice === 'clap' || hit.voice === 'rim') {
    const body = oscillator(context, 'triangle', style.bodyPitch, time); const bodyGain = context.createGain();
    envelope(bodyGain, time, 0.001, 0.012, 0.11 * decayScale, style.bodyLevel * hit.velocity); body.connect(bodyGain).connect(output); body.start(time); body.stop(time + 0.18 * decayScale);
  }
}
function playPad(context, output, hit, time, duration) {
  const style = resolveInstrumentStyle('pad', hit.presetId);
  hit.notes.forEach((note, index) => { const osc = oscillator(context, style.waves[index % style.waves.length], note.frequency, time); const gain = context.createGain(); const filter = context.createBiquadFilter(); setDetune(osc, (index - 1) * style.detune, time); filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); filter.Q.value = style.resonance; envelope(gain, time, style.attack, Math.max(0.3, duration), style.release, 0.07 * hit.velocity); connectVoice([osc, filter, gain], output); osc.start(time); osc.stop(time + duration + style.release + 0.35); });
}

function heldEnvelope(gain, time, attack, peak, sustain = 0.72) {
  const parameter = gain.gain;
  parameter.cancelScheduledValues(time);
  parameter.setValueAtTime(0.0001, time);
  parameter.exponentialRampToValueAtTime(Math.max(0.0001, peak), time + attack);
  parameter.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain), time + attack + 0.14);
}

function releaseHeldVoice(context, voice, when = context.currentTime, releaseSeconds = null) {
  if (!voice || voice.released) return false;
  voice.released = true;
  const time = now(context, when);
  const release = Math.max(0.025, Number(releaseSeconds) || voice.releaseSeconds || 0.12);
  for (const gain of voice.gains) {
    const parameter = gain.gain;
    if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(time);
    else {
      parameter.cancelScheduledValues(time);
      parameter.setValueAtTime(Math.max(0.0001, Number(parameter.value) || 0.0001), time);
    }
    parameter.exponentialRampToValueAtTime(0.0001, time + release);
  }
  for (const source of voice.sources) {
    try { source.stop(time + release + 0.03); } catch { /* already stopped */ }
  }
  return true;
}

function startHeldVoice(context, output, hit, time) {
  const sources = [];
  const gains = [];
  let releaseSeconds = 0.14;
  if (hit.kind === 'percussion') {
    playPercussion(context, output, hit, time);
    return { sources, gains, releaseSeconds: 0.04, released: false };
  }
  if (hit.instrument === '808') {
    const style = resolveInstrumentStyle('808', hit.presetId); const osc = oscillator(context, style.wave, hit.note.frequency * style.pitchDrop, time); const overtone = oscillator(context, style.overtoneWave, hit.note.frequency * 2, time); const overtoneMix = context.createGain(); const drive = context.createWaveShaper(); const gain = context.createGain(); const filter = context.createBiquadFilter();
    overtoneMix.gain.value = style.overtoneMix; drive.curve = makeDistortionCurve(style.drive); drive.oversample = '4x'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); filter.Q.value = style.resonance;
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, hit.note.frequency), time + style.pitchTime); osc.connect(filter); overtone.connect(overtoneMix).connect(filter); filter.connect(drive).connect(gain).connect(output);
    heldEnvelope(gain, time, 0.004, style.level * hit.velocity, 0.78); osc.start(time); overtone.start(time);
    sources.push(osc, overtone); gains.push(gain); releaseSeconds = Math.max(0.12, style.release * 0.4);
  } else if (hit.instrument === 'bass' || hit.instrument === 'overdrivenBass') {
    const style = resolveInstrumentStyle(hit.instrument, hit.presetId); const a = oscillator(context, style.waveA, hit.note.frequency, time); const b = oscillator(context, style.waveB, hit.note.frequency * style.ratioB, time); const bMix = context.createGain(); const filter = context.createBiquadFilter(); const drive = context.createWaveShaper(); const gain = context.createGain();
    setDetune(a, -style.detune * 0.35, time); setDetune(b, style.detune, time); bMix.gain.value = style.mixB; filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); filter.Q.value = style.resonance; drive.curve = makeDistortionCurve(style.drive); drive.oversample = '2x';
    a.connect(filter); b.connect(bMix).connect(filter); filter.connect(drive).connect(gain).connect(output); heldEnvelope(gain, time, style.attack, (style.level ?? 0.28) * hit.velocity, 0.72); a.start(time); b.start(time);
    sources.push(a, b); gains.push(gain); releaseSeconds = Math.max(0.16, style.release * 0.45);
  } else if (hit.instrument === 'eerieLead') {
    const style = resolveInstrumentStyle('eerieLead', hit.presetId); const a = oscillator(context, style.waveA, hit.note.frequency, time); const b = oscillator(context, style.waveB, hit.note.frequency, time); const lfo = oscillator(context, 'sine', style.vibratoRate, time); const vibrato = context.createGain(); const aMix = context.createGain(); const bMix = context.createGain(); const filter = context.createBiquadFilter(); const gain = context.createGain();
    setDetune(a, -style.cents, time); setDetune(b, style.cents, time); vibrato.gain.value = style.vibratoDepth; lfo.connect(vibrato); vibrato.connect(a.detune); vibrato.connect(b.detune); aMix.gain.value = 1 - style.mixB; bMix.gain.value = style.mixB; filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); filter.Q.value = style.resonance;
    a.connect(aMix).connect(filter); b.connect(bMix).connect(filter); filter.connect(gain).connect(output); heldEnvelope(gain, time, style.attack, 0.19 * hit.velocity, 0.72); a.start(time); b.start(time); lfo.start(time);
    sources.push(a, b, lfo); gains.push(gain); releaseSeconds = Math.max(0.2, style.release * 0.45);
  } else if (hit.instrument === 'organ') {
    const style = resolveInstrumentStyle('organ', hit.presetId); const ratios = [0.5, 1, 2, 3, 4]; const filter = context.createBiquadFilter(); const gain = context.createGain();
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); filter.Q.value = style.resonance;
    ratios.forEach((ratio, index) => { const osc = oscillator(context, 'sine', hit.note.frequency * ratio, time); const partial = context.createGain(); partial.gain.value = style.drawbars[index]; osc.connect(partial).connect(filter); osc.start(time); sources.push(osc); });
    filter.connect(gain).connect(output); heldEnvelope(gain, time, style.attack, 0.12 * hit.velocity, 0.88); gains.push(gain); releaseSeconds = style.release;
  } else if (hit.instrument === 'steelGuitar') {
    const style = resolveInstrumentStyle('steelGuitar', hit.presetId); [1, 2, 3, 4].forEach((ratio, index) => { const osc = oscillator(context, index < 2 ? 'triangle' : 'sine', hit.note.frequency * ratio, time); const partial = context.createGain(); setDetune(osc, index % 2 ? style.detune : -style.detune * 0.65, time); heldEnvelope(partial, time, 0.002, 0.16 * style.brightness * hit.velocity / (ratio ** 1.1), 0.28 / (index + 1)); osc.connect(partial).connect(output); osc.start(time); sources.push(osc); gains.push(partial); });
    releaseSeconds = Math.max(0.3, style.release * 0.35);
  } else if (hit.instrument === 'overdrivenGuitar') {
    const voice = createDrivenGuitarVoice(context, output, hit, time);
    heldEnvelope(voice.gain, time, voice.style.attack, voice.style.level * hit.velocity, Math.max(0.32, voice.style.sustain));
    sources.push(...voice.sources); gains.push(voice.gain); releaseSeconds = Math.max(0.18, voice.style.release);
  } else if (hit.instrument === 'violin') {
    const style = resolveInstrumentStyle('violin', hit.presetId); const a = oscillator(context, 'sawtooth', hit.note.frequency, time); const b = oscillator(context, 'sawtooth', hit.note.frequency, time); const lfo = oscillator(context, 'sine', style.vibratoRate, time); const vibrato = context.createGain(); const aMix = context.createGain(); const bMix = context.createGain(); const body = context.createBiquadFilter(); const gain = context.createGain();
    setDetune(a, style.detuneA, time); setDetune(b, style.detuneB, time); vibrato.gain.value = style.vibratoDepth; lfo.connect(vibrato); vibrato.connect(a.detune); vibrato.connect(b.detune); aMix.gain.value = 0.58; bMix.gain.value = 0.42; body.type = 'lowpass'; body.frequency.setValueAtTime(style.cutoff, time); body.Q.value = style.resonance;
    a.connect(aMix).connect(body); b.connect(bMix).connect(body); body.connect(gain).connect(output); heldEnvelope(gain, time, style.attack, 0.13 * hit.velocity, 0.82); a.start(time); b.start(time); lfo.start(time);
    sources.push(a, b, lfo); gains.push(gain); releaseSeconds = style.release;
  } else if (hit.instrument === 'piano') {
    const style = resolveInstrumentStyle('piano', hit.presetId); style.ratios.forEach((ratio, index) => {
      const osc = oscillator(context, 'sine', hit.note.frequency * ratio, time); const gain = context.createGain(); const filter = context.createBiquadFilter(); setDetune(osc, index === 0 ? 0 : (index % 2 ? style.detune : -style.detune), time); filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time);
      heldEnvelope(gain, time, style.attack, 0.16 * hit.velocity * style.levels[index], Math.max(0.24, 0.48 - index * 0.08)); connectVoice([osc, filter, gain], output); osc.start(time);
      sources.push(osc); gains.push(gain);
    });
    releaseSeconds = Math.max(0.32, style.release * 0.42);
  } else if (hit.kind === 'chord') {
    const style = resolveInstrumentStyle('pad', hit.presetId);
    hit.notes.forEach((note, index) => {
      const osc = oscillator(context, style.waves[index % style.waves.length], note.frequency, time); const gain = context.createGain(); const filter = context.createBiquadFilter(); setDetune(osc, (index - 1) * style.detune, time);
      filter.type = 'lowpass'; filter.frequency.setValueAtTime(style.cutoff, time); filter.Q.value = style.resonance; heldEnvelope(gain, time, style.attack, 0.07 * hit.velocity, 0.86); connectVoice([osc, filter, gain], output); osc.start(time);
      sources.push(osc); gains.push(gain);
    });
    releaseSeconds = style.release;
  }
  return { sources, gains, releaseSeconds, released: false };
}

function groupKey(groupId) { return groupId == null || groupId === '' ? null : String(groupId); }

function fadeOutGain(gain, context, seconds, when = context.currentTime) {
  const time = now(context, when);
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
    this.reverb = createReverbBus(context, this.master.input, options.reverb);
    this.groups = new Map();
    this.gates = new Map();
  }
  outputForGroup(groupId, reverbSend = 0) {
    const key = groupKey(groupId);
    if (!key) return this.master.input;
    const existing = this.groups.get(key);
    if (existing) {
      if (existing.reverbSend) existing.reverbSend.gain.setTargetAtTime(clamp(reverbSend, 0, 1), this.context.currentTime, 0.02);
      return existing.input;
    }
    const input = this.context.createGain();
    input.gain.value = 1;
    input.connect(this.master.input);
    let reverbSendNode = null;
    if (this.reverb.input) {
      reverbSendNode = this.context.createGain();
      reverbSendNode.gain.value = clamp(reverbSend, 0, 1);
      input.connect(reverbSendNode).connect(this.reverb.input);
    }
    this.groups.set(key, { input, reverbSend: reverbSendNode });
    return input;
  }
  setTone(options = {}) { this.master.setTone(options); this.reverb.setAmount(options.reverb); }
  setGroupReverb(groupId, value) {
    const group = this.groups.get(groupKey(groupId));
    if (!group?.reverbSend) return false;
    group.reverbSend.gain.setTargetAtTime(clamp(value, 0, 1), this.context.currentTime, 0.02);
    return true;
  }
  /**
   * Fades a lane/group's live tails and drops its routing bus. A later trigger
   * using the same id creates a fresh bus, so clears and mutes are reversible.
   */
  stopGroup(groupId, { fadeSeconds = 0.025, when = this.context.currentTime } = {}) {
    const key = groupKey(groupId);
    if (!key) return false;
    this.releaseGatesForGroup(key, { releaseSeconds: fadeSeconds, when });
    const group = this.groups.get(key);
    if (!group) return false;
    this.groups.delete(key);
    const seconds = Math.max(0.005, Number(fadeSeconds) || 0.025);
    fadeOutGain(group.input, this.context, seconds, when);
    const disconnect = () => { try { group.input.disconnect(); } catch { /* already disconnected */ } };
    const delay = Math.max(0, now(this.context, when) - this.context.currentTime) + seconds + 0.04;
    const timer = globalThis.setTimeout?.(disconnect, Math.ceil(delay * 1000));
    // Do not keep a Node/SSR process alive merely to dispose a browser audio bus.
    timer?.unref?.();
    return true;
  }
  stopAllGroups(options) {
    const ids = [...this.groups.keys()];
    ids.forEach((groupId) => this.stopGroup(groupId, options));
    return ids.length;
  }
  startGate(mappedHit, { gateId, when = this.context.currentTime, groupId = null, reverb = 0, letRing = true } = {}) {
    const key = String(gateId || '');
    if (!key) throw new TypeError('A gate id is required');
    if (this.gates.has(key)) return mappedHit;
    const time = now(this.context, when);
    if (!letRing) this.stopGroup(groupId, { when: time, fadeSeconds: 0.012 });
    const voice = startHeldVoice(this.context, this.outputForGroup(groupId, reverb), mappedHit, time);
    this.gates.set(key, { groupId: groupKey(groupId), voice });
    return mappedHit;
  }
  startGestureGate(command, options = {}) {
    const hit = resolveInstrumentGesture(command);
    return this.startGate(hit, {
      ...options,
      groupId: command.groupId ?? options.groupId,
      reverb: command.reverb ?? options.reverb,
      letRing: command.letRing ?? options.letRing,
    });
  }
  releaseGate(gateId, { when = this.context.currentTime, releaseSeconds = null } = {}) {
    const key = String(gateId || '');
    const gate = this.gates.get(key);
    if (!gate) return false;
    this.gates.delete(key);
    releaseHeldVoice(this.context, gate.voice, when, releaseSeconds);
    return true;
  }
  releaseGatesForGroup(groupId, options = {}) {
    const key = groupKey(groupId);
    let count = 0;
    for (const [gateId, gate] of [...this.gates]) {
      if (gate.groupId === key && this.releaseGate(gateId, options)) count += 1;
    }
    return count;
  }
  releaseAllGates(options = {}) {
    let count = 0;
    for (const gateId of [...this.gates.keys()]) if (this.releaseGate(gateId, options)) count += 1;
    return count;
  }
  trigger(mappedHit, when = this.context.currentTime, durationBeat = 0.25, bpm = 140, groupId = null, options = {}) {
    const time = now(this.context, when); const duration = Math.max(0.03, durationBeat * 60 / bpm);
    if (options.letRing === false) this.stopGroup(groupId, { when: time, fadeSeconds: 0.012 });
    const output = this.outputForGroup(groupId, options.reverb);
    if (mappedHit.kind === 'percussion') playPercussion(this.context, output, mappedHit, time);
    else if (mappedHit.instrument === '808') play808(this.context, output, mappedHit, time, duration);
    else if (mappedHit.instrument === 'bass' || mappedHit.instrument === 'overdrivenBass') playBass(this.context, output, mappedHit, time, duration);
    else if (mappedHit.instrument === 'eerieLead') playVibySynth(this.context, output, mappedHit, time, duration);
    else if (mappedHit.instrument === 'organ') playOrgan(this.context, output, mappedHit, time, duration);
    else if (mappedHit.instrument === 'steelGuitar') playSteelGuitar(this.context, output, mappedHit, time, duration);
    else if (mappedHit.instrument === 'overdrivenGuitar') playOverdrivenGuitar(this.context, output, mappedHit, time, duration);
    else if (mappedHit.instrument === 'violin') playViolin(this.context, output, mappedHit, time, duration);
    else if (mappedHit.instrument === 'piano') playPiano(this.context, output, mappedHit, time, duration);
    else if (mappedHit.kind === 'chord') playPad(this.context, output, mappedHit, time, duration);
    return mappedHit;
  }
  triggerGesture(command, when = this.context.currentTime) {
    const hit = resolveInstrumentGesture(command);
    return this.trigger(hit, when, command.durationBeat, command.scene.bpm, command.groupId, { reverb: command.reverb, letRing: command.letRing });
  }
  dispose() { this.releaseAllGates({ releaseSeconds: 0.005 }); this.stopAllGroups({ fadeSeconds: 0.005 }); this.reverb.disconnect(); this.master.disconnect(); }
}
