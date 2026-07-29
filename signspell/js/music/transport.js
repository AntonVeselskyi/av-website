import { barAtBeat, beatsPerBar, quantizeBeat } from './tonal.js?v=5';

export function secondsPerBeat(bpm) { return 60 / bpm; }
export function loopLengthBeats(lane) { return Math.max(1, Math.round(lane.lengthBars ?? 1)) * beatsPerBar(); }

export function normalizeLoopEvent(event, quantization = 16) {
  return Object.freeze({ ...event, startBeat: quantizeBeat(event.startBeat, quantization), durationBeat: Math.max(1 / quantization, Number(event.durationBeat ?? 0.25)) });
}

/** Lists each event occurrence in [fromBeat, toBeat), accounting for independent lane lengths. */
export function occurrencesBetween(lanes, fromBeat, toBeat) {
  const result = [];
  for (const lane of lanes) {
    if (lane.muted || !lane.events?.length) continue;
    const length = loopLengthBeats(lane);
    const firstCycle = Math.floor((fromBeat - length) / length);
    const lastCycle = Math.ceil(toBeat / length);
    for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
      for (const event of lane.events) {
        const beat = event.startBeat + cycle * length;
        if (beat >= fromBeat && beat < toBeat) result.push(Object.freeze({ ...event, laneId: lane.id, beat, bar: barAtBeat(beat) }));
      }
    }
  }
  return result.sort((a, b) => a.beat - b.beat);
}

/** Small audio-clock scheduler. Its callback should schedule voices immediately, not wait for UI frames. */
export class LoopScheduler {
  constructor(audioContext, onEvent, { lookAheadSeconds = 0.1, intervalMs = 25 } = {}) {
    if (!audioContext?.currentTime && audioContext?.currentTime !== 0) throw new TypeError('An AudioContext-like clock is required.');
    this.context = audioContext; this.onEvent = onEvent; this.lookAheadSeconds = lookAheadSeconds; this.intervalMs = intervalMs;
    this.lanes = []; this.scene = null; this.running = false; this.timer = null; this.startTime = 0; this.lastScheduledBeat = 0;
  }
  setProject({ lanes, scene }) { this.lanes = lanes ?? []; this.scene = scene; }
  start(atTime = this.context.currentTime + 0.05) { this.startTime = atTime; this.lastScheduledBeat = 0; this.running = true; this.tick(); this.timer = setInterval(() => this.tick(), this.intervalMs); }
  stop() { this.running = false; if (this.timer) clearInterval(this.timer); this.timer = null; }
  beatAt(time = this.context.currentTime) { return Math.max(0, (time - this.startTime) / secondsPerBeat(this.scene?.bpm ?? 140)); }
  tick() {
    if (!this.running || !this.scene) return;
    const untilBeat = this.beatAt(this.context.currentTime + this.lookAheadSeconds);
    for (const event of occurrencesBetween(this.lanes, this.lastScheduledBeat, untilBeat + 0.000001)) {
      const when = this.startTime + event.beat * secondsPerBeat(this.scene.bpm);
      this.onEvent(event, when, this.scene);
    }
    this.lastScheduledBeat = untilBeat + 0.000001;
  }
}
