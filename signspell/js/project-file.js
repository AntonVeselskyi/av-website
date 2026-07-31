import { GAMMAS, HARMONY_MODES, NOTE_ORDERS } from "./music/tonal.js?v=6";
import { INSTRUMENTS, VIBE_COLLECTIONS } from "./music/collections.js?v=9";
import {
  APP_SCHEMA_VERSION,
  BEATS_PER_BAR,
  MAX_LANES,
  QUANTIZATION_STEPS,
  clamp,
  createDefaultProject,
  createId,
  createLane,
  normalizeProject,
  sanitizeBpm,
  sanitizeLaneLength,
} from "./shared.js?v=7";

export const SSPELL_FORMAT = "sign-spell-project";
export const SSPELL_FILE_VERSION = 1;
export const MAX_SSPELL_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_EVENTS_PER_LANE = 4096;

const ROOTS = new Set(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);
const VISUALIZER_MODES = new Set(["wired", "fire", "cruciform", "shrine", "orbit", "lava", "royale"]);

function boundedString(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || fallback;
}

function savedBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function uniqueId(value, prefix, used) {
  let candidate = boundedString(value, "", 96);
  if (!candidate || used.has(candidate)) {
    do candidate = createId(prefix); while (used.has(candidate));
  }
  used.add(candidate);
  return candidate;
}

function portableProject(input) {
  const warnings = [];
  const base = createDefaultProject();
  const laneIds = new Set();
  const originalToPortableId = new Map();
  const rawLanes = Array.isArray(input?.lanes) ? input.lanes : [];
  if (rawLanes.length > MAX_LANES) warnings.push(`Only the first ${MAX_LANES} lines were restored.`);
  const lanes = rawLanes.slice(0, MAX_LANES).map((rawLane, index) => {
    const lane = rawLane && typeof rawLane === "object" && !Array.isArray(rawLane) ? rawLane : {};
    const defaults = createLane(index);
    const id = uniqueId(lane.id, "lane", laneIds);
    if (typeof lane.id === "string" && !originalToPortableId.has(lane.id)) originalToPortableId.set(lane.id, id);
    const lengthBars = sanitizeLaneLength(lane.lengthBars, defaults.lengthBars);
    const loopBeats = lengthBars * BEATS_PER_BAR;
    const collectionId = Object.hasOwn(VIBE_COLLECTIONS, lane.collectionId) ? lane.collectionId : defaults.collectionId;
    const instrumentFamily = Object.hasOwn(INSTRUMENTS, lane.instrumentFamily) ? lane.instrumentFamily : defaults.instrumentFamily;
    if (lane.collectionId && collectionId !== lane.collectionId) warnings.push(`Line ${index + 1}: unknown vibe replaced.`);
    if (lane.instrumentFamily && instrumentFamily !== lane.instrumentFamily) warnings.push(`Line ${index + 1}: unknown instrument replaced.`);
    const eventIds = new Set();
    const rawEvents = Array.isArray(lane.events) ? lane.events : [];
    if (rawEvents.length > MAX_EVENTS_PER_LANE) warnings.push(`Line ${index + 1}: extra notes were omitted.`);
    const events = rawEvents.slice(0, MAX_EVENTS_PER_LANE).flatMap((rawEvent) => {
      if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return [];
      const digit = Number(rawEvent.digit);
      const beat = Number(rawEvent.beat);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9 || !Number.isFinite(beat)) return [];
      const foldedBeat = ((beat % loopBeats) + loopBeats) % loopBeats;
      return [{
        id: uniqueId(rawEvent.id, "event", eventIds),
        beat: foldedBeat,
        digit,
        degree: digit,
        velocity: clamp(Number(rawEvent.velocity) || 0.78, 0.05, 1),
        duration: clamp(Number(rawEvent.duration) || 0.25, 0.05, loopBeats),
        source: boundedString(rawEvent.source, "restored", 32),
      }];
    }).sort((left, right) => left.beat - right.beat);
    return {
      id,
      name: boundedString(lane.name, defaults.name, 48),
      lengthBars,
      events,
      collectionId,
      instrumentFamily,
      instrumentId: typeof lane.instrumentId === "string" ? lane.instrumentId.slice(0, 96) : null,
      gain: clamp(Number(lane.gain ?? defaults.gain), 0, 1),
      reverb: clamp(Number(lane.reverb ?? defaults.reverb), 0, 1),
      letRing: savedBoolean(lane.letRing, defaults.letRing),
      muted: savedBoolean(lane.muted, defaults.muted),
      solo: savedBoolean(lane.solo, defaults.solo),
      overdub: savedBoolean(lane.overdub, defaults.overdub),
      stepCursorBeat: clamp(Number(lane.stepCursorBeat) || 0, 0, Math.max(0, loopBeats - 0.0001)),
    };
  });

  const tonal = input?.tonalScene && typeof input.tonalScene === "object" ? input.tonalScene : {};
  const master = input?.master && typeof input.master === "object" ? input.master : {};
  const ui = input?.ui && typeof input.ui === "object" ? input.ui : {};
  const progression = Array.isArray(tonal.progression)
    ? tonal.progression.slice(0, 16).map(Number).filter((degree) => Number.isInteger(degree) && degree > 0)
    : [];
  const activeLaneId = originalToPortableId.get(input?.activeLaneId) || lanes[0]?.id || null;
  return {
    warnings,
    project: normalizeProject({
      schemaVersion: APP_SCHEMA_VERSION,
      tonalScene: {
        root: ROOTS.has(tonal.root) ? tonal.root : base.tonalScene.root,
        gamma: Object.hasOwn(GAMMAS, tonal.gamma) ? tonal.gamma : base.tonalScene.gamma,
        harmonyMode: Object.values(HARMONY_MODES).includes(tonal.harmonyMode) ? tonal.harmonyMode : base.tonalScene.harmonyMode,
        noteOrder: Object.values(NOTE_ORDERS).includes(tonal.noteOrder) ? tonal.noteOrder : base.tonalScene.noteOrder,
        progression: progression.length ? progression : [...base.tonalScene.progression],
        bpm: sanitizeBpm(tonal.bpm),
      },
      quantization: Object.hasOwn(QUANTIZATION_STEPS, input?.quantization) ? input.quantization : base.quantization,
      master: {
        volume: clamp(Number(master.volume ?? base.master.volume), 0, 1),
        subBoost: clamp(Number(master.subBoost ?? base.master.subBoost), 0, 1),
        distortion: clamp(Number(master.distortion ?? base.master.distortion), 0, 1),
        reverb: clamp(Number(master.reverb ?? base.master.reverb), 0, 1),
      },
      activeLaneId,
      lanes,
      ui: {
        visualizerMode: VISUALIZER_MODES.has(ui.visualizerMode) ? ui.visualizerMode : base.ui.visualizerMode,
        reducedMotion: savedBoolean(ui.reducedMotion, base.ui.reducedMotion),
        stepInput: savedBoolean(ui.stepInput, base.ui.stepInput),
      },
    }),
  };
}

function projectForEnvelope(input) {
  const project = portableProject(input).project;
  return {
    schemaVersion: project.schemaVersion,
    tonalScene: { ...project.tonalScene, progression: [...project.tonalScene.progression] },
    quantization: project.quantization,
    master: { ...project.master },
    activeLaneId: project.activeLaneId,
    lanes: project.lanes.map((lane) => ({
      id: lane.id,
      name: lane.name,
      lengthBars: lane.lengthBars,
      events: lane.events.map((event) => ({
        id: event.id,
        beat: event.beat,
        digit: event.digit,
        degree: event.digit,
        velocity: event.velocity,
        duration: event.duration,
        source: event.source,
      })),
      collectionId: lane.collectionId,
      instrumentFamily: lane.instrumentFamily,
      instrumentId: lane.instrumentId,
      gain: lane.gain,
      reverb: lane.reverb,
      letRing: lane.letRing,
      muted: lane.muted,
      solo: lane.solo,
      overdub: lane.overdub,
      stepCursorBeat: lane.stepCursorBeat,
    })),
    ui: { ...project.ui },
  };
}

export function createProjectFile(project, exportedAt = new Date().toISOString()) {
  return {
    format: SSPELL_FORMAT,
    fileVersion: SSPELL_FILE_VERSION,
    exportedAt,
    project: projectForEnvelope(project),
  };
}

export function serializeProjectFile(project, exportedAt) {
  return `${JSON.stringify(createProjectFile(project, exportedAt), null, 2)}\n`;
}

export function parseProjectFile(source) {
  if (typeof source !== "string" || !source.trim()) throw new TypeError("The .sspell file is empty.");
  let payload;
  try {
    payload = JSON.parse(source);
  } catch {
    throw new TypeError("This is not a readable .sspell project.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Invalid .sspell project envelope.");
  if (payload.format !== SSPELL_FORMAT) throw new TypeError("This file is not a Sign Spell project.");
  if (payload.fileVersion !== SSPELL_FILE_VERSION) throw new RangeError(`Unsupported .sspell version: ${payload.fileVersion ?? "unknown"}.`);
  if (!payload.project || typeof payload.project !== "object" || Array.isArray(payload.project)) throw new TypeError("The .sspell file has no project data.");
  if (!Array.isArray(payload.project.lanes)) throw new TypeError("The .sspell project has no line data.");
  if (Number(payload.project.schemaVersion) > APP_SCHEMA_VERSION) throw new RangeError("This project was made by a newer Sign Spell build.");
  return portableProject(payload.project);
}

export function projectFileName(date = new Date()) {
  const stamp = date.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  return `sign-spell-${stamp}.sspell`;
}
