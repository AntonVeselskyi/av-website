import { BEATS_PER_BAR, MAX_LANES, clamp, createId, quantizeBeat, sanitizeBpm } from "./shared.js";

export class LoopTransport extends EventTarget {
  constructor({ getAudioTime, scheduleEvent, project }) {
    super();
    this.getAudioTime = getAudioTime;
    this.scheduleEvent = scheduleEvent;
    this.project = project;
    this.playing = false;
    this.startedAt = 0;
    this.lastScheduledBeat = -0.00001;
    this.interval = 0;
    this.lookAheadSeconds = 0.12;
    this.tickMs = 25;
  }

  setProject(project) {
    this.project = project;
  }

  get bpm() {
    return sanitizeBpm(this.project?.tonalScene?.bpm);
  }

  secondsPerBeat() {
    return 60 / this.bpm;
  }

  currentBeat(audioTime = this.getAudioTime()) {
    if (!this.playing) return 0;
    return Math.max(0, (audioTime - this.startedAt) / this.secondsPerBeat());
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.startedAt = this.getAudioTime() + 0.04;
    this.lastScheduledBeat = -0.00001;
    this.interval = setInterval(() => this.tick(), this.tickMs);
    this.tick();
    this.dispatchEvent(new CustomEvent("transport", { detail: { playing: true } }));
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.interval);
    this.interval = 0;
    for (const lane of this.project.lanes) {
      lane.recording = false;
      lane.armed = false;
    }
    this.dispatchEvent(new CustomEvent("transport", { detail: { playing: false } }));
  }

  tick() {
    if (!this.playing) return;
    const now = this.getAudioTime();
    if (now < this.startedAt) return;
    const horizonBeat = this.currentBeat(now + this.lookAheadSeconds);
    this.updateRecordStates(this.currentBeat(now));
    this.scheduleRange(this.lastScheduledBeat, horizonBeat);
    this.lastScheduledBeat = horizonBeat;
    this.dispatchEvent(new CustomEvent("tick", { detail: { beat: this.currentBeat(now) } }));
  }

  updateRecordStates(beat) {
    for (const lane of this.project.lanes) {
      if (lane.armed && Number.isFinite(lane.armBeat) && beat >= lane.armBeat) {
        lane.armed = false;
        lane.recording = true;
        lane.recordStartedBeat = lane.armBeat;
      }
    }
  }

  scheduleRange(fromBeat, toBeat) {
    const soloed = this.project.lanes.some((lane) => lane.solo);
    const secondsPerBeat = this.secondsPerBeat();
    for (const lane of this.project.lanes) {
      if (lane.muted || (soloed && !lane.solo) || !lane.events.length) continue;
      const loopBeats = Math.max(1, Number(lane.lengthBars) || 1) * BEATS_PER_BAR;
      const firstCycle = Math.floor(Math.max(0, fromBeat) / loopBeats);
      const lastCycle = Math.floor(Math.max(0, toBeat) / loopBeats);
      for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
        for (const event of lane.events) {
          const eventBeat = cycle * loopBeats + clamp(event.beat, 0, loopBeats - 0.0001);
          if (eventBeat <= fromBeat || eventBeat > toBeat) continue;
          const audioTime = this.startedAt + eventBeat * secondsPerBeat;
          this.scheduleEvent({ ...event, lane, eventBeat }, audioTime);
        }
      }
    }
  }

  armLane(laneId, { countInBars = 1 } = {}) {
    const lane = this.project.lanes.find((item) => item.id === laneId);
    if (!lane) return null;
    for (const item of this.project.lanes) {
      item.armed = false;
      if (item.id !== laneId) item.recording = false;
    }
    if (!this.playing) this.start();
    lane.undoSnapshot = lane.events.map((event) => ({ ...event }));
    if (!lane.overdub) lane.events = [];
    const beat = this.currentBeat();
    const nextBar = Math.ceil((beat + 0.0001) / BEATS_PER_BAR) * BEATS_PER_BAR;
    lane.armBeat = nextBar + Math.max(0, countInBars - 1) * BEATS_PER_BAR;
    lane.armed = true;
    lane.recording = false;
    return lane.armBeat;
  }

  toggleRecord(laneId) {
    const lane = this.project.lanes.find((item) => item.id === laneId);
    if (!lane) return;
    if (lane.armed || lane.recording) {
      lane.armed = false;
      lane.recording = false;
      return;
    }
    this.armLane(laneId);
  }

  captureHit(hit, laneId = this.project.activeLaneId) {
    const lane = this.project.lanes.find((item) => item.id === laneId);
    if (!lane?.recording) return null;
    const loopBeats = lane.lengthBars * BEATS_PER_BAR;
    const rawBeat = (this.currentBeat() - lane.recordStartedBeat) % loopBeats;
    const beat = quantizeBeat(rawBeat < 0 ? rawBeat + loopBeats : rawBeat, this.project.quantization) % loopBeats;
    const event = {
      id: createId("event"),
      beat,
      digit: clamp(Math.round(hit.digit), 1, 9),
      degree: clamp(Math.round(hit.digit), 1, 9),
      velocity: clamp(hit.velocity ?? 0.8, 0.05, 1),
      duration: clamp(hit.duration ?? 0.25, 0.05, loopBeats),
      source: hit.source || "gesture",
    };
    lane.events.push(event);
    lane.events.sort((a, b) => a.beat - b.beat);
    return event;
  }

  clearLane(laneId) {
    const lane = this.project.lanes.find((item) => item.id === laneId);
    if (lane) lane.events = [];
  }

  addLane() {
    if (this.project.lanes.length >= MAX_LANES) return null;
    return null;
  }
}
