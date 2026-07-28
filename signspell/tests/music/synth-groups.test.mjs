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
    connect(target) { this.connectedTo = target; return target; },
    disconnect() { this.disconnected = true; },
    start() {}, stop() {},
  };
}

function context() {
  return {
    currentTime: 4,
    destination: node('destination'),
    createGain: () => node('gain'),
    createBiquadFilter: () => node('filter'),
    createWaveShaper: () => node('waveshaper'),
    createDynamicsCompressor: () => node('compressor'),
    createOscillator: () => node('oscillator'),
  };
}

const hit = { instrument: '808', note: { frequency: 55 }, velocity: 1 };

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
