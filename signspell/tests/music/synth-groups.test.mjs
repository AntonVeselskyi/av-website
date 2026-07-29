import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicEngine } from '../../js/music/synth.js';

function param(value = 0) {
  return {
    value,
    calls: [],
    setValueAtTime(next, time) { this.value = next; this.calls.push(['set', next, time]); },
    setTargetAtTime(next, time, constant) { this.value = next; this.calls.push(['target', next, time, constant]); },
    exponentialRampToValueAtTime(next, time) { this.value = next; this.calls.push(['ramp', next, time]); },
    cancelScheduledValues(time) { this.calls.push(['cancel', time]); },
  };
}

function node(kind) {
  return {
    kind,
    gain: param(1),
    frequency: param(220),
    Q: param(0),
    threshold: param(0),
    knee: param(0),
    ratio: param(0),
    attack: param(0),
    release: param(0),
    detune: param(0),
    connect(target) { this.connectedTo = target; return target; },
    disconnect() { this.disconnected = true; },
    start(time) { this.startedAt = time; }, stop(time) { this.stoppedAt = time; },
  };
}

function context({ reverb = false } = {}) {
  const audio = {
    currentTime: 4,
    sampleRate: 100,
    destination: node('destination'),
    createGain: () => node('gain'),
    createBiquadFilter: () => node('filter'),
    createWaveShaper: () => node('waveshaper'),
    createDynamicsCompressor: () => node('compressor'),
    createOscillator: () => node('oscillator'),
  };
  if (reverb) {
    audio.createConvolver = () => node('convolver');
    audio.createBuffer = (channels, length) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (channel) => data[channel] };
    };
  }
  return audio;
}

const hit = { instrument: '808', note: { frequency: 55 }, velocity: 1 };

test('master applies its initial export tone before the first scheduled voice', () => {
  const engine = new MusicEngine(context(), { volume: 0.61, subBoost: 0.9, distortion: 0.8 });
  assert.ok(engine.master.output.gain.calls.some(([kind, value]) => kind === 'set' && value === 0.61));
  assert.ok(engine.master.lowShelf.gain.calls.some(([kind, value]) => kind === 'set' && value === 10.8));
  engine.master.setTone({ volume: 0.5 });
  assert.ok(engine.master.output.gain.calls.some(([kind, value]) => kind === 'target' && value === 0.5));
});

test('a stopped group fades its tails and is recreated on the next trigger', () => {
  const engine = new MusicEngine(context());
  engine.trigger(hit, 4, 0.25, 140, 'lane-1');
  const first = engine.groups.get('lane-1');
  assert.ok(first);

  assert.equal(engine.stopGroup('lane-1'), true);
  assert.equal(engine.groups.has('lane-1'), false);
  assert.ok(first.input.gain.calls.some(([kind, value]) => kind === 'ramp' && value === 0.0001));

  engine.trigger(hit, 4, 0.25, 140, 'lane-1');
  assert.notEqual(engine.groups.get('lane-1'), first);
});

test('stopAllGroups leaves direct/manual hits untouched', () => {
  const engine = new MusicEngine(context());
  engine.trigger(hit, 4, 0.25, 140, 'lane-a');
  engine.trigger(hit, 4, 0.25, 140, 'lane-b');
  engine.trigger(hit); // no group: live/manual main output
  assert.equal(engine.stopAllGroups(), 2);
  assert.equal(engine.groups.size, 0);
});

test('a held tonal gate sustains until its matching release', () => {
  const audio = context();
  const oscillators = [];
  audio.createOscillator = () => { const oscillator = node('oscillator'); oscillators.push(oscillator); return oscillator; };
  const engine = new MusicEngine(audio);
  engine.startGate(hit, { gateId: 'keyboard:Numpad1', groupId: 'lane-1' });
  assert.equal(engine.gates.size, 1);
  assert.equal(oscillators.length, 1);
  assert.equal(oscillators[0].stoppedAt, undefined);

  assert.equal(engine.releaseGate('keyboard:Numpad1'), true);
  assert.equal(engine.gates.size, 0);
  assert.ok(oscillators[0].stoppedAt > audio.currentTime);
});

test('stopping a lane group also releases each held gate in that lane', () => {
  const engine = new MusicEngine(context());
  engine.startGate(hit, { gateId: 'one', groupId: 'lane-1' });
  engine.startGate(hit, { gateId: 'two', groupId: 'lane-1' });
  assert.equal(engine.stopGroup('lane-1'), true);
  assert.equal(engine.gates.size, 0);
});

test('global reverb and each saved lane send update independently', () => {
  const audio = context({ reverb: true });
  const engine = new MusicEngine(audio, { reverb: 0.34 });
  assert.ok(Math.abs(engine.reverb.wet.gain.value - 0.2448) < 1e-6);
  engine.trigger(hit, 4, 0.25, 140, 'lane-wet', { reverb: 0.46 });
  assert.equal(engine.groups.get('lane-wet').reverbSend.gain.value, 0.46);
  engine.setGroupReverb('lane-wet', 0.18);
  assert.equal(engine.groups.get('lane-wet').reverbSend.gain.value, 0.18);
  engine.setTone({ reverb: 0.7 });
  assert.ok(Math.abs(engine.reverb.wet.gain.value - 0.504) < 1e-6);
});

test('LET RING off chokes the previous lane bus before a new note', () => {
  const engine = new MusicEngine(context());
  engine.trigger(hit, 4, 0.25, 140, 'lane-choke');
  const first = engine.groups.get('lane-choke');
  engine.trigger(hit, 4.1, 0.25, 140, 'lane-choke', { letRing: false });
  assert.notEqual(engine.groups.get('lane-choke'), first);
  assert.ok(first.input.gain.calls.some(([kind, value]) => kind === 'ramp' && value === 0.0001));
});

test('viby synth, organ, steel string, and violin all create playable voices', () => {
  const audio = context();
  const oscillators = [];
  audio.createOscillator = () => { const voice = node('oscillator'); oscillators.push(voice); return voice; };
  const engine = new MusicEngine(audio);
  for (const instrument of ['bass', 'eerieLead', 'organ', 'steelGuitar', 'violin']) {
    const before = oscillators.length;
    engine.trigger({ instrument, kind: 'pitched', note: { frequency: 220 }, velocity: 0.8, presetId: null }, 4, 0.5, 140, `lane-${instrument}`);
    assert.ok(oscillators.length > before, `${instrument} produced no oscillator voices`);
  }
  const beforeKit = oscillators.length;
  engine.trigger({ instrument: 'drumKit', kind: 'percussion', voice: 'kick', velocity: 0.8, presetId: 'sunroomKit' }, 4, 0.25, 140, 'lane-kit');
  assert.ok(oscillators.length > beforeKit, 'drum kit kick produced no oscillator voice');
});
