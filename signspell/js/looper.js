import { BEATS_PER_BAR, MAX_LANES, clamp, createId, quantizeBeat, sanitizeBpm } from "./shared.js?v=4";

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

  rebaseTempo(previousBpm) {
    if (!this.playing) return 0;
    const now = this.getAudioTime();
    const oldSecondsPerBeat = 60 / sanitizeBpm(previousBpm);
    const beat = Math.max(0, (now - this.startedAt) / oldSecondsPerBeat);
    this.startedAt = now - beat * this.secondsPerBeat();
    // Audio scheduled under the previous tempo is invalidated by the caller.
    // Restart lookahead at the preserved musical position.
    this.lastScheduledBeat = beat - 0.00001;
    return beat;
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

  localBeatForLane(lane, absoluteBeat = this.currentBeat()) {
    const loopBeats = Math.max(1, Number(lane?.lengthBars) || 1) * BEATS_PER_BAR;
    const originBeat = Number.isFinite(lane?.loopOriginBeat) ? lane.loopOriginBeat : 0;
    const relativeBeat = (absoluteBeat - originBeat) % loopBeats;
    return relativeBeat < 0 ? relativeBeat + loopBeats : relativeBeat;
  }

  start() {
    if (this.playing) return;
    // Each stopped -> playing transition creates a new transport epoch. Event
    // beats are stored in lane-local coordinates, so every saved line begins
    // from phase zero in the new session.
    for (const lane of this.project.lanes) {
      lane.loopOriginBeat = 0;
      lane.undoLoopOriginBeat = 0;
    }
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
      if (lane.recording && Number.isFinite(lane.recordStartedBeat)
        && beat >= lane.recordStartedBeat + lane.lengthBars * BEATS_PER_BAR) {
        lane.recording = false;
      }
    }
  }

  scheduleRange(fromBeat, toBeat) {
    const soloed = this.project.lanes.some((lane) => lane.solo);
    const secondsPerBeat = this.secondsPerBeat();
    for (const lane of this.project.lanes) {
      if (lane.muted || (soloed && !lane.solo) || !lane.events.length) continue;
      const loopBeats = Math.max(1, Number(lane.lengthBars) || 1) * BEATS_PER_BAR;
      const originBeat = Number.isFinite(lane.loopOriginBeat) ? lane.loopOriginBeat : 0;
      if (toBeat < originBeat) continue;
      const firstCycle = Math.floor(Math.max(0, fromBeat - originBeat) / loopBeats);
      const lastCycle = Math.floor(Math.max(0, toBeat - originBeat) / loopBeats);
      for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
        for (const event of lane.events) {
          const eventBeat = originBeat + cycle * loopBeats + clamp(event.beat, 0, loopBeats - 0.0001);
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
    const wasPlaying = this.playing;
    if (!wasPlaying) this.start();
    const startsFreshLoop = !lane.overdub || !lane.events.length;
    lane.undoSnapshot = lane.events.map((event) => ({ ...event }));
    lane.undoLoopOriginBeat = Number.isFinite(lane.loopOriginBeat) ? lane.loopOriginBeat : 0;
    if (!lane.overdub) lane.events = [];
    if (!wasPlaying) {
      lane.armBeat = 0;
      lane.armed = false;
      lane.recording = true;
      lane.recordStartedBeat = 0;
      return lane.armBeat;
    }
    const beat = this.currentBeat();
    const nextBar = Math.ceil((beat + 0.0001) / BEATS_PER_BAR) * BEATS_PER_BAR;
    lane.armBeat = nextBar + Math.max(0, countInBars - 1) * BEATS_PER_BAR;
    // A replacement/new recording defines a fresh loop whose phase begins at
    // REC, not at transport beat zero. Existing overdubs retain their phase.
    if (startsFreshLoop) lane.loopOriginBeat = lane.armBeat;
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
    const originBeat = Number.isFinite(lane.loopOriginBeat) ? lane.loopOriginBeat : lane.recordStartedBeat;
    const rawBeat = (this.currentBeat() - originBeat) % loopBeats;
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

  beginHeldCapture(hit, laneId = this.project.activeLaneId) {
    const startedBeat = this.currentBeat();
    const event = this.captureHit({ ...hit, duration: 0.05 }, laneId);
    const lane = this.project.lanes.find((item) => item.id === laneId);
    const recordEndBeat = Number(lane?.recordStartedBeat) + Math.max(1, Number(lane?.lengthBars) || 1) * BEATS_PER_BAR;
    return event ? { laneId, eventId: event.id, startedBeat, recordEndBeat } : null;
  }

  finishHeldCapture(capture, endedBeat = this.currentBeat()) {
    if (!capture) return null;
    const lane = this.project.lanes.find((item) => item.id === capture.laneId);
    const event = lane?.events.find((item) => item.id === capture.eventId);
    if (!lane || !event) return null;
    const loopBeats = Math.max(1, Number(lane.lengthBars) || 1) * BEATS_PER_BAR;
    const effectiveEndBeat = Number.isFinite(capture.recordEndBeat)
      ? Math.min(Number(endedBeat), capture.recordEndBeat) : Number(endedBeat);
    const heldBeats = effectiveEndBeat - Number(capture.startedBeat);
    event.duration = clamp(heldBeats, 0.05, loopBeats);
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
