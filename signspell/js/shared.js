export const APP_SCHEMA_VERSION = 1;
export const MAX_LANES = 8;
export const BEATS_PER_BAR = 4;

export const QUANTIZATION_STEPS = Object.freeze({
  off: 0,
  "1/8": 0.5,
  "1/16": 0.25,
  "1/32": 0.125,
});

export const DEFAULT_TONAL_SCENE = Object.freeze({
  root: "E",
  gamma: "minorPentatonic",
  harmonyMode: "strictChord",
  progression: [1, 6, 3, 7],
  bpm: 140,
});

export function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function quantizeBeat(beat, quantization) {
  const step = typeof quantization === "number"
    ? quantization
    : QUANTIZATION_STEPS[quantization] ?? QUANTIZATION_STEPS["1/16"];
  if (!step) return Math.max(0, beat);
  return Math.max(0, Math.round(beat / step) * step);
}

export function sanitizeBpm(value) {
  return clamp(Math.round(Number(value) || 140), 60, 200);
}

export function createLane(index = 0) {
  return {
    id: createId("lane"),
    name: `LINE ${String(index + 1).padStart(2, "0")}`,
    lengthBars: index < 4 ? 2 : 4,
    events: [],
    collectionId: "wiltedBedroom",
    instrumentFamily: index === 1 ? "percussion" : index === 2 ? "pad" : index === 3 ? "piano" : "808",
    instrumentId: null,
    gain: 0.82,
    muted: false,
    solo: false,
    armed: false,
    recording: false,
    overdub: true,
    // Runtime transport phase. It is reset when a project is loaded or a new
    // transport session starts, so absolute audio-clock beats are never
    // resumed from storage.
    loopOriginBeat: 0,
    undoLoopOriginBeat: 0,
  };
}

export function createDefaultProject() {
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    savedAt: Date.now(),
    tonalScene: { ...DEFAULT_TONAL_SCENE, progression: [...DEFAULT_TONAL_SCENE.progression] },
    quantization: "1/16",
    master: { volume: 0.72, subBoost: 0.42, distortion: 0.34 },
    activeLaneId: null,
    lanes: Array.from({ length: MAX_LANES }, (_, index) => createLane(index)),
    ui: { visualizerMode: "wired", reducedMotion: false },
  };
}

export function normalizeProject(input) {
  const base = createDefaultProject();
  if (!input || typeof input !== "object") {
    base.activeLaneId = base.lanes[0].id;
    return base;
  }
  const lanes = Array.isArray(input.lanes)
    ? input.lanes.slice(0, MAX_LANES).map((lane, index) => ({
        ...createLane(index),
        ...lane,
        events: Array.isArray(lane.events) ? lane.events : [],
        // Arm/record are live transport states, never resumable project data.
        armed: false,
        recording: false,
        loopOriginBeat: 0,
        undoLoopOriginBeat: 0,
      }))
    : base.lanes;
  while (lanes.length < MAX_LANES) lanes.push(createLane(lanes.length));
  return {
    ...base,
    ...input,
    schemaVersion: APP_SCHEMA_VERSION,
    tonalScene: { ...base.tonalScene, ...(input.tonalScene || {}) },
    master: { ...base.master, ...(input.master || {}) },
    ui: { ...base.ui, ...(input.ui || {}) },
    lanes,
    activeLaneId: lanes.some((lane) => lane.id === input.activeLaneId) ? input.activeLaneId : lanes[0].id,
  };
}
