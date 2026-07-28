import {
  GAMMAS,
  HARMONY_MODES,
  INSTRUMENTS,
  MusicEngine,
  VIBE_COLLECTIONS,
  createTonalScene,
  createWavBlob,
  generateLoopRecipe,
  noteName,
  renderOfflineProject,
  resolveInstrumentGesture,
} from "./music/index.js?v=5";
import { LoopTransport } from "./looper.js?v=6";
import { digitFromKeyEvent } from "./input.js?v=1";
import { BEATS_PER_BAR, clamp, normalizeProject, quantizeBeat, sanitizeBpm } from "./shared.js?v=4";
import {
  clearCalibrationDraft,
  createAutosaver,
  loadCalibration,
  loadCalibrationDraft,
  loadProject,
  saveCalibration,
  saveCalibrationDraft,
  saveProject,
} from "./storage.js?v=4";
import { createSpellVisualizer } from "./visual/visualizer.js";

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const COLLECTION_REFERENCES = Object.freeze({
  wiltedBedroom: "LIL PEEP-INSPIRED",
  cemeteryTape: "$UICIDEBOY$-INSPIRED",
  redlineWound: "XXXTENTACION-INSPIRED",
  ironChapel: "ZILLAKAMI-INSPIRED",
});
const RECIPE_FAMILY = Object.freeze({ "808": "bass", piano: "piano", eerieLead: "melody", percussion: "drums", pad: "melody" });
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const dom = {
  boot: $("#boot-screen"), workstation: $("#workstation"), start: $("#start-app"), status: $("#system-status"), statusLight: $("#system-light"), toast: $("#toast"),
  video: $("#camera-feed"), overlay: $("#hand-overlay"), cameraStage: $("#camera-stage"), cameraHome: $("#camera-stage-home"), cameraMessage: $("#camera-message"), cameraToggle: $("#camera-toggle"), hand: $("#handedness-select"),
  diagnostics: $("#hand-diagnostics"), diagnosticStatus: $("#hand-diagnostic-status"), diagnosticPose: $("#hand-diagnostic-pose"), diagnosticContact: $("#hand-diagnostic-contact"), diagnosticStroke: $("#hand-diagnostic-stroke"), diagnosticFrame: $("#hand-diagnostic-frame"),
  gestureDigit: $("#gesture-digit"), gestureState: $("#gesture-state"), gestureConfidence: $("#gesture-confidence"), latency: $("#latency-readout"),
  play: $("#transport-play"), stop: $("#transport-stop"), bpm: $("#bpm-input"), tap: $("#tap-tempo"), quantization: $("#quantization-select"), position: $("#transport-position"),
  collection: $("#collection-select"), instrument: $("#instrument-select"), root: $("#root-select"), gamma: $("#gamma-select"), harmony: $("#harmony-select"), gestureMap: $("#gesture-map"),
  master: $("#master-volume"), sub: $("#sub-boost"), grit: $("#distortion"), generate: $("#generate-loop"), lanes: $("#loop-lanes"), laneTemplate: $("#lane-template"),
  focusedPanel: $(".focused-editor-panel"), focusedSummary: $("#focused-lane-summary"), focusedRoll: $("#focused-lane-roll"), focusedEmpty: $("#focused-roll-empty"), focusedLength: $("#focused-roll-length"), focusedRecord: $("#focused-record"), focusedOverdub: $("#focused-overdub"), focusedMute: $("#focused-mute"), focusedSolo: $("#focused-solo"), focusedClear: $("#focused-clear"),
  export: $("#export-wav"), visualCanvas: $("#visualizer-canvas"), visualLabel: $("#visualizer-label"), fullVisual: $("#fullscreen-visualizer"), reduceMotion: $("#reduced-motion"),
  calibrationButton: $("#calibrate-button"), calibrationDialog: $("#calibration-dialog"), calibrationCameraMount: $("#calibration-camera-mount"), calibrationDiagnosticMount: $("#calibration-diagnostic-mount"), calibrationHeading: $("#calibration-heading"), calibrationInstruction: $("#calibration-instruction"), calibrationOrientation: $("#calibration-orientation"), calibrationGlyph: $("#calibration-glyph"), calibrationStatus: $("#calibration-status"), calibrationCount: $("#calibration-count"), calibrationProgress: $("#calibration-progress"), calibrationChecklist: $("#calibration-checklist"), calibrationBack: $("#calibration-back"), calibrationReset: $("#calibration-reset"), calibrationNext: $("#calibration-next"),
};

let project = normalizeProject(await loadProject());
let audioContext = null;
let music = null;
let analyser = null;
let visualizer = null;
let transport = null;
let cameraStream = null;
let cameraGeneration = 0;
let visionWorker = null;
let frameInFlight = false;
let cameraLoopHandle = 0;
let calibrationProfile = await loadCalibration();
let calibrationDraft = await loadCalibrationDraft();
let calibrationSession = null;
let calibrationTimeout = 0;
let lastHitAt = 0;
let toastTimer = 0;
let tapTimes = [];
let focusedMappingBar = -1;
const heldNotes = new Map();
let visionGateWatchdog = 0;

if (calibrationDraft?.handedness === "left" || calibrationDraft?.handedness === "right") {
  dom.hand.value = calibrationDraft.handedness;
}

const autosave = createAutosaver(async (next) => {
  // Keep the live object identity stable. The transport holds this reference;
  // replacing it after every save left playback reading an old project until
  // the next page load.
  await saveProject(next);
  setStatus("AUTOSAVED", "ok", 900);
});

function scene() {
  return createTonalScene(project.tonalScene);
}

function activeLane() {
  return project.lanes.find((lane) => lane.id === project.activeLaneId) || project.lanes[0];
}

function showToast(message, timeout = 2600) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  toastTimer = setTimeout(() => dom.toast.classList.remove("visible"), timeout);
}

function setStatus(text, state = "idle", resetAfter = 0) {
  dom.status.textContent = text;
  dom.statusLight.parentElement.dataset.state = state === "ok" ? "active" : state;
  if (resetAfter) setTimeout(() => setStatus(cameraStream ? "SIGNAL CONNECTED" : "CAMERA DORMANT", cameraStream ? "ok" : "idle"), resetAfter);
}

function markChanged({ renderLanes = false, renderMap = false } = {}) {
  transport?.setProject(project);
  if (renderLanes) drawLanes();
  if (renderMap) drawGestureMap();
  drawFocusedLane();
  autosave(project);
}

function populateControls() {
  dom.collection.innerHTML = Object.entries(VIBE_COLLECTIONS).map(([id, item]) => `<option value="${id}">${item.title} // ${COLLECTION_REFERENCES[id]}</option>`).join("");
  dom.instrument.innerHTML = Object.values(INSTRUMENTS).map((item) => `<option value="${item.id}">${item.label.toUpperCase()}</option>`).join("");
  dom.root.innerHTML = ROOTS.map((root) => `<option value="${root}">${root}</option>`).join("");
  dom.gamma.innerHTML = Object.values(GAMMAS).map((gamma) => `<option value="${gamma.id}">${gamma.label.toUpperCase()}</option>`).join("");
  syncControls();
}

function syncControls() {
  const lane = activeLane();
  dom.collection.value = lane.collectionId in VIBE_COLLECTIONS ? lane.collectionId : "wiltedBedroom";
  dom.instrument.value = lane.instrumentFamily in INSTRUMENTS ? lane.instrumentFamily : "808";
  dom.root.value = typeof project.tonalScene.root === "string" ? project.tonalScene.root : ROOTS[project.tonalScene.root % 12];
  dom.gamma.value = project.tonalScene.gamma;
  dom.harmony.value = project.tonalScene.harmonyMode;
  dom.bpm.value = sanitizeBpm(project.tonalScene.bpm);
  dom.quantization.value = project.quantization;
  dom.master.value = project.master.volume;
  dom.sub.value = project.master.subBoost;
  dom.grit.value = project.master.distortion;
  updateFaderOutputs();
  drawGestureMap();
}

function updateFaderOutputs() {
  for (const input of [dom.master, dom.sub, dom.grit]) {
    const output = input.parentElement.querySelector("output");
    if (output) output.value = Math.round(input.value * 100);
  }
}

function drawGestureMap() {
  const lane = activeLane();
  let currentScene;
  try { currentScene = scene(); } catch { return; }
  dom.gestureMap.innerHTML = "";
  for (let digit = 1; digit <= 9; digit += 1) {
    const command = resolveInstrumentGesture({ instrument: lane.instrumentFamily, gesture: digit, scene: currentScene, velocity: 0.8, collectionId: lane.collectionId });
    const label = command.kind === "percussion" ? command.voice.replace(/([A-Z])/g, " $1") : command.note.note;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.dataset.digit = digit;
    cell.innerHTML = `<b>${digit}</b><span>${label.toUpperCase()}</span>`;
    cell.addEventListener("click", () => triggerHit({ digit, velocity: 0.78, confidence: 1, source: "screen-pad" }));
    dom.gestureMap.append(cell);
  }
}

function laneEventsForExport() {
  return project.lanes.map((lane) => ({
    ...lane,
    events: lane.events.map((event) => ({
      ...event,
      startBeat: event.beat,
      gesture: event.digit,
      instrument: lane.instrumentFamily,
      collectionId: lane.collectionId,
      durationBeat: event.duration,
    })),
  }));
}

function scheduleLoopEvent(event, when) {
  if (!music) return;
  try {
    music.triggerGesture({
      instrument: event.lane.instrumentFamily,
      collectionId: event.lane.collectionId,
      groupId: event.lane.id,
      gesture: event.digit,
      scene: scene(),
      bar: Math.floor(event.eventBeat / BEATS_PER_BAR),
      velocity: clamp(event.velocity * event.lane.gain, 0.02, 1),
      durationBeat: event.duration,
    }, when);
  } catch (error) {
    console.warn("Loop event rejected", error);
  }
}

async function initAudio() {
  if (audioContext) {
    await audioContext.resume();
    return;
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Web Audio is not supported in this browser.");
  audioContext = new AudioContextCtor({ latencyHint: "interactive" });
  await audioContext.resume();
  music = new MusicEngine(audioContext, project.master);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.76;
  music.master.output.connect(analyser);
  visualizer = createSpellVisualizer(dom.visualCanvas, { analyser, mode: project.ui.visualizerMode, reducedMotion: project.ui.reducedMotion });
  visualizer.start();
  transport = new LoopTransport({ getAudioTime: () => audioContext.currentTime, scheduleEvent: scheduleLoopEvent, project });
  transport.addEventListener("tick", (event) => {
    updateTransportPosition(event.detail.beat);
    updatePlayheads(event.detail.beat);
  });
  transport.addEventListener("transport", (event) => dom.play.classList.toggle("active", event.detail.playing));
  applyMasterSettings();
}

function applyMasterSettings() {
  music?.master?.setTone(project.master);
  document.documentElement.style.setProperty("--live-sub", project.master.subBoost);
  document.documentElement.style.setProperty("--live-grit", project.master.distortion);
}

// Loop events are made into AudioNodes slightly ahead of their beat.  When a
// lane's instrument or collection changes while playing, that small lookahead
// would otherwise leave the old voice ringing and make the new choice feel as
// though it only took effect after a restart.  Replace just this lane's audio
// group and audition its next event with the new mapping; the regular
// scheduler will use the same updated lane object from the following tick.
function reflectLiveLaneSound(lane, label = "") {
  if (!music || !transport?.playing) return;
  const soloed = project.lanes.some((item) => item.solo);
  if (lane.muted || (soloed && !lane.solo)) return;

  const loopBeats = Math.max(1, Number(lane.lengthBars) || 1) * BEATS_PER_BAR;
  const localBeat = transport.localBeatForLane(lane);
  const nextEvent = [...lane.events]
    .sort((left, right) => left.beat - right.beat)
    .find((event) => event.beat >= localBeat) || lane.events[0];
  const digit = Number(nextEvent?.digit) || 1;

  releaseHeldNotes((held) => held.laneId === lane.id);
  music.stopGroup?.(lane.id);
  try {
    music.triggerGesture({
      instrument: lane.instrumentFamily,
      collectionId: lane.collectionId,
      groupId: lane.id,
      gesture: digit,
      scene: scene(),
      bar: Math.floor(transport.currentBeat() / BEATS_PER_BAR),
      velocity: clamp(nextEvent?.velocity ?? 0.72, 0.05, 1),
      durationBeat: nextEvent?.duration ?? (lane.instrumentFamily === "pad" ? 1.5 : lane.instrumentFamily === "808" ? 0.75 : 0.32),
    }, audioContext?.currentTime + 0.015);
    if (label) showToast(`${lane.name}: ${label} LIVE`, 2200);
  } catch (error) {
    console.warn("Live lane reflection rejected", error);
  }
}

function setProjectBpm(value) {
  const previousBpm = sanitizeBpm(project.tonalScene.bpm);
  const nextBpm = sanitizeBpm(value);
  project.tonalScene.bpm = nextBpm;
  if (transport?.playing && nextBpm !== previousBpm) {
    releaseHeldNotes();
    music?.stopAllGroups?.();
    transport.rebaseTempo(previousBpm);
  }
  return nextBpm;
}

function triggerHit(hit) {
  const now = performance.now();
  if (!music || now - lastHitAt < 28) return;
  lastHitAt = now;
  const lane = activeLane();
  try {
    const mapped = music.triggerGesture({
      instrument: lane.instrumentFamily,
      collectionId: lane.collectionId,
      groupId: lane.id,
      gesture: Number(hit.digit),
      scene: scene(),
      bar: transport ? Math.floor(transport.currentBeat() / BEATS_PER_BAR) : 0,
      velocity: clamp(hit.velocity ?? 0.78, 0.05, 1),
      durationBeat: lane.instrumentFamily === "pad" ? 1.5 : lane.instrumentFamily === "808" ? 0.75 : 0.32,
    });
    const captured = transport?.captureHit({ ...hit, digit: Number(hit.digit), velocity: mapped.velocity, duration: lane.instrumentFamily === "pad" ? 1.5 : 0.32 });
    flashGesture(hit);
    if (captured) markChanged({ renderLanes: true });
  } catch (error) {
    showToast(error.message);
  }
}

function setHeldVisual(digit, held) {
  const anyHeld = [...heldNotes.values()].some((note) => note.digit === Number(digit));
  if (held && !anyHeld) return;
  const cell = dom.gestureMap.querySelector(`[data-digit="${digit}"]`);
  cell?.classList.toggle("held", held ? true : anyHeld);
  for (const row of $$(".focused-roll-row", dom.focusedRoll)) {
    if (Number(row.dataset.digit) === Number(digit)) $(".focused-roll-key", row)?.classList.toggle("held", held ? true : anyHeld);
  }
}

function beginHeldNote({ gateId, digit, velocity = 0.78, confidence = 1, source = "hold" }) {
  if (!music || heldNotes.has(gateId)) return heldNotes.get(gateId) || null;
  const lane = activeLane();
  if (!lane) return null;
  try {
    const mapped = music.startGestureGate({
      instrument: lane.instrumentFamily,
      collectionId: lane.collectionId,
      groupId: lane.id,
      gesture: Number(digit),
      scene: scene(),
      bar: transport ? Math.floor(transport.currentBeat() / BEATS_PER_BAR) : 0,
      velocity: clamp(velocity, 0.05, 1),
    }, { gateId });
    const capture = transport?.beginHeldCapture({ digit: Number(digit), velocity: mapped.velocity, source }, lane.id) || null;
    const held = { gateId, digit: Number(digit), laneId: lane.id, source, capture };
    heldNotes.set(gateId, held);
    flashGesture({ digit, velocity: mapped.velocity, confidence, source });
    setHeldVisual(digit, true);
    dom.gestureState.textContent = `${source.replaceAll("-", " ").toUpperCase()} / HELD`;
    if (capture) markChanged({ renderLanes: true });
    return held;
  } catch (error) {
    showToast(error.message);
    return null;
  }
}

function endHeldNote(gateId, { render = true } = {}) {
  const held = heldNotes.get(gateId);
  if (!held) return false;
  const endedBeat = transport?.currentBeat() ?? 0;
  music?.releaseGate?.(gateId);
  const captured = transport?.finishHeldCapture(held.capture, endedBeat) || null;
  heldNotes.delete(gateId);
  if (![...heldNotes.values()].some((note) => note.source.startsWith("vision-"))) {
    clearTimeout(visionGateWatchdog);
    visionGateWatchdog = 0;
  }
  setHeldVisual(held.digit, false);
  dom.gestureState.textContent = `${held.source.replaceAll("-", " ").toUpperCase()} / RELEASED`;
  if (captured && render) markChanged({ renderLanes: true });
  return Boolean(captured);
}

function refreshVisionGateWatchdog() {
  clearTimeout(visionGateWatchdog);
  visionGateWatchdog = 0;
  if (![...heldNotes.values()].some((held) => held.source.startsWith("vision-"))) return;
  visionGateWatchdog = setTimeout(() => {
    visionGateWatchdog = 0;
    releaseHeldNotes((held) => held.source.startsWith("vision-"));
  }, 350);
}

function releaseHeldNotes(predicate = () => true) {
  let changed = false;
  for (const [gateId, held] of [...heldNotes]) {
    if (predicate(held)) changed = endHeldNote(gateId, { render: false }) || changed;
  }
  if (changed) markChanged({ renderLanes: true });
}

function syncVisionHeldNotes(diagnostic) {
  if (!diagnostic?.hand?.detected) {
    releaseHeldNotes((held) => held.source.startsWith("vision-"));
    return;
  }
  const contacts = diagnostic.fingertips?.contacts || {};
  for (const [gateId, held] of [...heldNotes]) {
    if (held.source === "vision-contact" && !contacts[held.digit]?.latched) endHeldNote(gateId);
    if (held.source === "vision-downstroke" && diagnostic.downstroke?.state !== "locked") endHeldNote(gateId);
  }
}

function handleRecognizedHit(hit) {
  if (dom.calibrationDialog.open) return;
  if (hit?.source === "contact") {
    releaseHeldNotes((held) => held.source === "vision-downstroke");
    beginHeldNote({ gateId: `vision:contact:${hit.digit}`, ...hit, source: "vision-contact" });
    refreshVisionGateWatchdog();
    return;
  }
  if (hit?.source === "downstroke") {
    if ([...heldNotes.values()].some((held) => held.source === "vision-contact")) return;
    beginHeldNote({ gateId: "vision:downstroke", ...hit, source: "vision-downstroke" });
    refreshVisionGateWatchdog();
    return;
  }
  triggerHit(hit);
}

function flashGesture(hit) {
  dom.gestureDigit.value = hit.digit;
  dom.gestureState.textContent = hit.source === "contact" ? "CONTACT HIT" : hit.source === "downstroke" ? "DOWNSTROKE" : "MANUAL HIT";
  dom.gestureConfidence.value = clamp(hit.confidence ?? 1, 0, 1);
  dom.gestureDigit.classList.remove("hit");
  void dom.gestureDigit.offsetWidth;
  dom.gestureDigit.classList.add("hit");
  const cell = dom.gestureMap.querySelector(`[data-digit="${hit.digit}"]`);
  if (cell) { cell.classList.add("hit"); setTimeout(() => cell.classList.remove("hit"), 130); }
}

function drawLanes() {
  dom.lanes.innerHTML = "";
  project.lanes.forEach((lane, index) => {
    const fragment = dom.laneTemplate.content.cloneNode(true);
    const row = $(".loop-lane", fragment);
    row.dataset.laneId = lane.id;
    row.classList.toggle("active", lane.id === project.activeLaneId);
    row.setAttribute("aria-current", lane.id === project.activeLaneId ? "true" : "false");
    row.classList.toggle("recording", lane.recording);
    row.classList.toggle("armed", lane.armed);
    $(".lane-number", row).textContent = String(index + 1).padStart(2, "0");
    $(".lane-name", row).textContent = lane.name;
    $(".lane-instrument", row).textContent = `${VIBE_COLLECTIONS[lane.collectionId]?.title || "CUSTOM"} / ${INSTRUMENTS[lane.instrumentFamily]?.label || lane.instrumentFamily}`;
    const record = $(".lane-record", row); record.classList.toggle("active", lane.armed || lane.recording); record.textContent = lane.recording ? "REC" : lane.armed ? "WAIT" : "●"; record.setAttribute("aria-pressed", String(lane.armed || lane.recording)); record.setAttribute("aria-label", lane.recording ? "Stop recording" : lane.armed ? "Cancel queued recording" : "Record lane");
    const overdub = $(".lane-overdub", row); overdub.classList.toggle("active", lane.overdub);
    const mute = $(".lane-mute", row); mute.classList.toggle("active", lane.muted);
    const solo = $(".lane-solo", row); solo.classList.toggle("active", lane.solo);
    const length = $(".lane-length select", row); length.value = lane.lengthBars;
    const gain = $(".lane-gain", row); gain.value = lane.gain;
    const eventArea = $(".lane-events", row);
    drawLaneEvents(eventArea, lane);
    $(".lane-select", row).addEventListener("click", () => selectLane(lane.id));
    record.addEventListener("click", () => {
      releaseHeldNotes();
      transport?.toggleRecord(lane.id);
      project.activeLaneId = lane.id;
      if ((lane.recording || lane.armed) && !lane.overdub) music?.stopGroup?.(lane.id);
      if (lane.recording) showToast(`${lane.name} RECORDING NOW — GESTURE OR PRESS 1-9; ONE LOOP PASS`, 4800);
      else if (lane.armed) showToast(`${lane.name} ARMED — GESTURE OR PRESS 1-9 WHEN REC APPEARS AT THE NEXT BAR`, 4800);
      else showToast(`${lane.name} RECORDING STOPPED`);
      drawLanes();
      syncControls();
      markChanged();
    });
    overdub.addEventListener("click", () => { lane.overdub = !lane.overdub; markChanged({ renderLanes: true }); });
    mute.addEventListener("click", () => { lane.muted = !lane.muted; if (lane.muted) { releaseHeldNotes((held) => held.laneId === lane.id); music?.stopGroup?.(lane.id); } markChanged({ renderLanes: true }); });
    solo.addEventListener("click", () => {
      lane.solo = !lane.solo;
      if (lane.solo) project.lanes.filter((item) => item.id !== lane.id).forEach((item) => { releaseHeldNotes((held) => held.laneId === item.id); music?.stopGroup?.(item.id); });
      markChanged({ renderLanes: true });
    });
    length.addEventListener("change", () => { releaseHeldNotes((held) => held.laneId === lane.id); lane.lengthBars = Number(length.value); lane.events = lane.events.filter((item) => item.beat < lane.lengthBars * BEATS_PER_BAR); markChanged({ renderLanes: true }); });
    gain.addEventListener("input", () => { lane.gain = Number(gain.value); markChanged(); });
    $(".lane-undo", row).addEventListener("click", () => { if (Array.isArray(lane.undoSnapshot)) { releaseHeldNotes((held) => held.laneId === lane.id); lane.events = lane.undoSnapshot.map((event) => ({ ...event })); lane.loopOriginBeat = Number.isFinite(lane.undoLoopOriginBeat) ? lane.undoLoopOriginBeat : lane.loopOriginBeat; music?.stopGroup?.(lane.id); markChanged({ renderLanes: true }); } });
    $(".lane-clear", row).addEventListener("click", () => { releaseHeldNotes((held) => held.laneId === lane.id); lane.undoSnapshot = lane.events.map((event) => ({ ...event })); lane.undoLoopOriginBeat = lane.loopOriginBeat; lane.events = []; music?.stopGroup?.(lane.id); showToast(`${lane.name} CLEARED AND SILENCED`); markChanged({ renderLanes: true }); });
    dom.lanes.append(fragment);
  });
}

function drawLaneEvents(area, lane) {
  const lengthBeats = lane.lengthBars * BEATS_PER_BAR;
  for (const event of lane.events) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "loop-event";
    node.dataset.eventId = event.id;
    node.style.left = `${(event.beat / lengthBeats) * 100}%`;
    node.style.top = `${((9 - event.digit) / 8) * 72 + 8}%`;
    node.style.width = `${Math.max(1.2, (event.duration / lengthBeats) * 100)}%`;
    node.style.opacity = 0.42 + event.velocity * 0.58;
    node.textContent = event.digit;
    node.setAttribute("aria-label", `Sign ${event.digit}, beat ${event.beat.toFixed(2)}, velocity ${Math.round(event.velocity * 100)} percent`);
    node.addEventListener("pointerdown", (pointerEvent) => beginEventDrag(pointerEvent, area, lane, event));
    node.addEventListener("keydown", (keyboardEvent) => editEventWithKeyboard(keyboardEvent, lane, event));
    area.append(node);
  }
}

function focusedGestureLabel(lane, digit, bar) {
  const command = resolveInstrumentGesture({
    instrument: lane.instrumentFamily,
    gesture: digit,
    scene: scene(),
    bar,
    velocity: 0.8,
    collectionId: lane.collectionId,
  });
  return command.kind === "percussion"
    ? command.voice.replace(/([A-Z])/g, " $1").trim().toUpperCase()
    : command.note.note.toUpperCase();
}

function drawFocusedMapping(lane, bar = 0) {
  if (!dom.focusedRoll || !lane) return;
  for (const row of $$(".focused-roll-row", dom.focusedRoll)) {
    const digit = Number(row.dataset.digit);
    let label = `GESTURE ${digit}`;
    try { label = focusedGestureLabel(lane, digit, bar); } catch { /* keep fallback */ }
    $(".focused-roll-note", row).textContent = label;
    $(".focused-roll-key", row).setAttribute("aria-label", `Play gesture ${digit}, ${label}`);
    row.classList.toggle("sharp", label.includes("#"));
  }
  focusedMappingBar = bar;
}

function updateFocusedControls(lane) {
  if (!lane || !dom.focusedRecord) return;
  dom.focusedRecord.textContent = lane.recording ? "REC" : lane.armed ? "WAIT" : "●";
  dom.focusedRecord.setAttribute("aria-pressed", String(lane.recording || lane.armed));
  dom.focusedRecord.setAttribute("aria-label", lane.recording ? "Stop selected line recording" : lane.armed ? "Cancel selected line recording" : "Record selected line");
  dom.focusedOverdub.setAttribute("aria-pressed", String(lane.overdub));
  dom.focusedMute.setAttribute("aria-pressed", String(lane.muted));
  dom.focusedSolo.setAttribute("aria-pressed", String(lane.solo));
}

function drawFocusedLane() {
  if (!dom.focusedRoll) return;
  const lane = activeLane();
  if (!lane) return;
  const laneIndex = project.lanes.indexOf(lane) + 1;
  const collection = VIBE_COLLECTIONS[lane.collectionId]?.title || "CUSTOM";
  const instrument = INSTRUMENTS[lane.instrumentFamily]?.label || lane.instrumentFamily;
  const lengthBeats = lane.lengthBars * BEATS_PER_BAR;
  const bar = transport?.playing ? Math.floor(transport.currentBeat() / BEATS_PER_BAR) : 0;
  dom.focusedSummary.textContent = `LINE ${String(laneIndex).padStart(2, "0")} / ${collection} / ${instrument}`;
  dom.focusedLength.textContent = `${lane.lengthBars} BAR${lane.lengthBars === 1 ? "" : "S"}`;
  dom.focusedEmpty.textContent = lane.events.length
    ? `${lane.events.length} HIT${lane.events.length === 1 ? "" : "S"} — DRAG TO RETIME; ARROWS MOVE NOTES`
    : "EMPTY — ARM ●, GESTURE, PRESS 1–9, OR CLICK A NOTE KEY";

  for (const row of $$(".focused-roll-row", dom.focusedRoll)) {
    const digit = Number(row.dataset.digit);
    const track = $(".focused-roll-track", row);
    track.querySelectorAll(".focused-roll-event,.focused-roll-playhead").forEach((node) => node.remove());
    const playhead = document.createElement("i");
    playhead.className = "focused-roll-playhead";
    playhead.setAttribute("aria-hidden", "true");
    track.append(playhead);
    for (const loopEvent of lane.events.filter((event) => Number(event.digit) === digit)) {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "focused-roll-event";
      node.dataset.eventId = loopEvent.id;
      node.dataset.source = loopEvent.source || "manual";
      node.style.left = `${(loopEvent.beat / lengthBeats) * 100}%`;
      node.style.width = `${Math.max(1.4, (loopEvent.duration / lengthBeats) * 100)}%`;
      node.style.opacity = 0.5 + loopEvent.velocity * 0.5;
      node.textContent = digit;
      node.setAttribute("aria-label", `Gesture ${digit}, beat ${loopEvent.beat.toFixed(2)}, velocity ${Math.round(loopEvent.velocity * 100)} percent`);
      node.addEventListener("pointerdown", (pointerEvent) => beginFocusedEventDrag(pointerEvent, track, lane, loopEvent));
      node.addEventListener("keydown", (keyboardEvent) => editEventWithKeyboard(keyboardEvent, lane, loopEvent));
      track.append(node);
    }
  }
  drawFocusedMapping(lane, bar);
  updateFocusedControls(lane);
  updateFocusedPlayhead(transport?.playing ? transport.currentBeat() : 0);
}

function beginFocusedEventDrag(pointerEvent, track, lane, loopEvent) {
  pointerEvent.preventDefault();
  const target = pointerEvent.currentTarget;
  target.setPointerCapture(pointerEvent.pointerId);
  const move = (moveEvent) => {
    const rect = track.getBoundingClientRect();
    const relativeX = clamp((moveEvent.clientX - rect.left) / rect.width, 0, 0.9999);
    loopEvent.beat = quantizeBeat(relativeX * lane.lengthBars * BEATS_PER_BAR, project.quantization);
    target.style.left = `${relativeX * 100}%`;
  };
  const end = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
    lane.events.sort((left, right) => left.beat - right.beat);
    reflectLiveLaneSound(lane);
    markChanged({ renderLanes: true });
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

function updateFocusedPlayhead(beat = 0) {
  const lane = activeLane();
  if (!lane || !dom.focusedRoll) return;
  const localBeat = transport?.localBeatForLane(lane, beat) ?? (beat % (lane.lengthBars * BEATS_PER_BAR));
  const percent = (localBeat / (lane.lengthBars * BEATS_PER_BAR)) * 100;
  for (const playhead of $$(".focused-roll-playhead", dom.focusedRoll)) playhead.style.left = `${percent}%`;
}

function beginEventDrag(pointerEvent, area, lane, event) {
  pointerEvent.preventDefault();
  const target = pointerEvent.currentTarget;
  target.setPointerCapture(pointerEvent.pointerId);
  const move = (moveEvent) => {
    const rect = area.getBoundingClientRect();
    const relativeX = clamp((moveEvent.clientX - rect.left) / rect.width, 0, 0.9999);
    const relativeY = clamp((moveEvent.clientY - rect.top) / rect.height, 0, 0.9999);
    event.beat = quantizeBeat(relativeX * lane.lengthBars * BEATS_PER_BAR, project.quantization);
    event.digit = clamp(9 - Math.round(relativeY * 8), 1, 9);
    target.style.left = `${relativeX * 100}%`;
    target.style.top = `${relativeY * 72 + 8}%`;
    target.textContent = event.digit;
  };
  const end = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
    lane.events.sort((a, b) => a.beat - b.beat);
    reflectLiveLaneSound(lane);
    markChanged({ renderLanes: true });
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

function editEventWithKeyboard(event, lane, loopEvent) {
  const step = project.quantization === "off" ? 0.125 : ({ "1/8": 0.5, "1/16": 0.25, "1/32": 0.125 }[project.quantization] || 0.25);
  if (event.key === "Delete" || event.key === "Backspace") lane.events = lane.events.filter((item) => item.id !== loopEvent.id);
  else if (event.key === "ArrowLeft") loopEvent.beat = Math.max(0, loopEvent.beat - step);
  else if (event.key === "ArrowRight") loopEvent.beat = Math.min(lane.lengthBars * BEATS_PER_BAR - step, loopEvent.beat + step);
  else if (event.key === "ArrowUp") loopEvent.digit = Math.min(9, loopEvent.digit + 1);
  else if (event.key === "ArrowDown") loopEvent.digit = Math.max(1, loopEvent.digit - 1);
  else return;
  event.preventDefault();
  reflectLiveLaneSound(lane);
  markChanged({ renderLanes: true });
}

function selectLane(laneId) {
  releaseHeldNotes();
  project.activeLaneId = laneId;
  drawLanes();
  syncControls();
  markChanged();
  requestAnimationFrame(() => dom.focusedPanel?.scrollIntoView({ behavior: project.ui.reducedMotion ? "auto" : "smooth", block: "center" }));
}

function updateTransportPosition(beat = 0) {
  const bar = Math.floor(beat / BEATS_PER_BAR) + 1;
  const within = Math.floor(beat % BEATS_PER_BAR) + 1;
  dom.position.value = `${String(bar).padStart(3, "0")}:${String(within).padStart(2, "0")}`;
}

function updatePlayheads(beat = 0) {
  for (const row of $$(".loop-lane", dom.lanes)) {
    const lane = project.lanes.find((item) => item.id === row.dataset.laneId);
    if (!lane) continue;
    const localBeat = transport?.localBeatForLane(lane, beat) ?? (beat % (lane.lengthBars * BEATS_PER_BAR));
    const percent = (localBeat / (lane.lengthBars * BEATS_PER_BAR)) * 100;
    const playhead = $(".lane-playhead", row);
    if (playhead) playhead.style.left = `${percent}%`;
    row.classList.toggle("recording", lane.recording);
    row.classList.toggle("armed", lane.armed);
    const record = $(".lane-record", row);
    if (record) {
      record.classList.toggle("active", lane.armed || lane.recording);
      record.setAttribute("aria-pressed", String(lane.armed || lane.recording));
      record.textContent = lane.recording ? "REC" : lane.armed ? "WAIT" : "●";
      record.setAttribute("aria-label", lane.recording ? "Stop recording" : lane.armed ? "Cancel queued recording" : "Record lane");
    }
  }
  const lane = activeLane();
  const bar = Math.floor(beat / BEATS_PER_BAR);
  updateFocusedPlayhead(beat);
  updateFocusedControls(lane);
  if (bar !== focusedMappingBar) drawFocusedMapping(lane, bar);
}

function applyCollection(collectionId) {
  const collection = VIBE_COLLECTIONS[collectionId];
  if (!collection) return;
  const lane = activeLane();
  lane.collectionId = collectionId;
  project.tonalScene = {
    ...project.tonalScene,
    root: ROOTS[collection.tonal.root],
    gamma: collection.tonal.gamma,
    harmonyMode: HARMONY_MODES.STRICT_CHORD,
    progression: [...collection.tonal.progression],
  };
  setProjectBpm(collection.tonal.bpm);
  reflectLiveLaneSound(lane, `${collection.title} COLLECTION`);
  syncControls();
  markChanged({ renderLanes: true, renderMap: true });
}

function generateIntoActiveLane() {
  const lane = activeLane();
  releaseHeldNotes((held) => held.laneId === lane.id);
  music?.stopGroup?.(lane.id);
  const recipeFamily = RECIPE_FAMILY[lane.instrumentFamily];
  const recipe = generateLoopRecipe({ collectionId: lane.collectionId, seed: Date.now(), bars: lane.lengthBars, include: [recipeFamily] });
  const source = recipe.lanes[0];
  lane.events = source.events.map((event) => ({
    id: `${lane.id}-${event.startBeat}-${event.gesture}-${Math.random().toString(36).slice(2, 6)}`,
    beat: event.startBeat,
    digit: event.gesture,
    degree: event.gesture,
    velocity: event.velocity,
    duration: event.durationBeat,
    source: "generated",
  }));
  if (transport && !transport.playing) transport.start();
  else if (music && source.events.length) {
    const first = lane.events[0];
    music.triggerGesture({
      instrument: lane.instrumentFamily,
      collectionId: lane.collectionId,
      groupId: lane.id,
      gesture: first.digit,
      scene: scene(),
      bar: 0,
      velocity: first.velocity,
      durationBeat: first.duration,
    });
  }
  showToast(`${lane.name}: ${source.events.length} EVENTS CONJURED — PLAYBACK ACTIVE`, 4200);
  markChanged({ renderLanes: true });
}

async function exportWav() {
  dom.export.disabled = true;
  dom.export.textContent = "RENDERING…";
  try {
    const maxBars = Math.max(...project.lanes.filter((lane) => !lane.muted && lane.events.length).map((lane) => lane.lengthBars), 1);
    const buffer = await renderOfflineProject({ scene: scene(), lanes: laneEventsForExport(), lengthBeats: maxBars * BEATS_PER_BAR, volume: project.master.volume });
    const url = URL.createObjectURL(createWavBlob(buffer));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sign-spell-${Date.now()}.wav`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("WAV EXPORTED");
  } catch (error) {
    showToast(`EXPORT FAILED: ${error.message}`, 5000);
  } finally {
    dom.export.disabled = false;
    dom.export.textContent = "EXPORT WAV";
  }
}

async function startCamera() {
  if (cameraStream) return stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is unavailable. Use HTTPS in Chrome or Edge.");
  const generation = ++cameraGeneration;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 60, min: 24 } }, audio: false });
  if (generation !== cameraGeneration) { stream.getTracks().forEach((track) => track.stop()); return; }
  cameraStream = stream;
  dom.video.srcObject = stream;
  await dom.video.play();
  if (generation !== cameraGeneration || cameraStream !== stream) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  dom.cameraMessage.hidden = true;
  dom.cameraToggle.textContent = "CAMERA ON";
  setStatus("INITIALIZING VISION", "busy");
  initVisionWorker();
  queueCameraFrame(generation, stream);
}

function stopCamera() {
  releaseHeldNotes((held) => held.source.startsWith("vision-"));
  cameraGeneration += 1;
  cancelAnimationFrame(cameraLoopHandle);
  frameInFlight = false;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  dom.video.srcObject = null;
  dom.cameraMessage.hidden = false;
  dom.cameraMessage.textContent = "Camera offline. Keyboard digits remain playable.";
  dom.cameraToggle.textContent = "CAMERA OFF";
  resetHandDiagnostics();
  clearHandOverlay();
  setStatus("CAMERA DORMANT", "idle");
}

function initVisionWorker() {
  if (visionWorker) return;
  try {
    visionWorker = new Worker("js/vision/vision-worker.js?v=4", { type: "module" });
    visionWorker.addEventListener("message", handleVisionMessage);
    visionWorker.addEventListener("error", (event) => { releaseHeldNotes((held) => held.source.startsWith("vision-")); frameInFlight = false; showToast(`VISION WORKER: ${event.message}`); });
    visionWorker.postMessage({
      type: "init",
      handedness: dom.hand.value,
      profile: calibrationProfile,
      detectorConfig: {
        moduleUrl: new URL("./vision/mediapipe-adapter.js", import.meta.url).href,
        options: { delegate: "GPU" },
      },
    });
  } catch (error) {
    showToast(`Vision unavailable: ${error.message}`);
  }
}

function queueCameraFrame(generation = cameraGeneration, stream = cameraStream) {
  if (!stream || generation !== cameraGeneration || cameraStream !== stream) return;
  const send = async (now) => {
    if (generation !== cameraGeneration || cameraStream !== stream) return;
    if (!frameInFlight && visionWorker && dom.video.readyState >= 2) {
      frameInFlight = true;
      try {
        const bitmap = await createImageBitmap(dom.video);
        visionWorker.postMessage({ type: "frame", frame: bitmap, timestamp: now }, [bitmap]);
      } catch { frameInFlight = false; }
    }
    if (generation === cameraGeneration && cameraStream === stream) queueCameraFrame(generation, stream);
  };
  if (dom.video.requestVideoFrameCallback) dom.video.requestVideoFrameCallback((now) => send(now));
  else cameraLoopHandle = requestAnimationFrame(send);
}

function handleVisionMessage(event) {
  const message = event.data || {};
  if (message.type === "diagnostic") {
    syncVisionHeldNotes(message.diagnostic);
    refreshVisionGateWatchdog();
    updateHandDiagnostics(message.diagnostic);
    return;
  }
  if (message.type === "frame-ready" || message.type === "frame-dropped") { frameInFlight = false; return; }
  if (message.type === "ready") {
    if (calibrationDraft) visionWorker?.postMessage({ type: "calibration-import", draft: calibrationDraft });
    setStatus(calibrationProfile ? "SIGNAL CONNECTED" : "CALIBRATION REQUIRED", calibrationProfile ? "ok" : "busy");
    return;
  }
  if (message.type === "error") {
    releaseHeldNotes((held) => held.source.startsWith("vision-"));
    frameInFlight = false;
    setStatus("VISION ERROR", "error");
    showToast(message.message || "Vision initialization failed", 5000);
    return;
  }
  if (message.type === "recognition") {
    const payload = message;
    if (payload.landmarks) drawHand(payload.landmarks); else clearHandOverlay();
    const confidence = payload.confidence ?? payload.diagnostics?.pose?.confidence ?? 0;
    dom.gestureConfidence.value = clamp(confidence, 0, 1);
    dom.gestureState.textContent = payload.diagnostics?.reason || payload.diagnostics?.downstroke?.state || (payload.landmarks ? "TRACKING" : "NO HAND");
    if (payload.hit) handleRecognizedHit(payload.hit);
    if (payload.metrics) dom.latency.textContent = `VISION ${Math.round(payload.metrics.inferenceMs || 0)}ms / AUDIO ${Math.round((audioContext?.baseLatency || 0) * 1000)}ms`;
  }
  if (message.type === "hit") handleRecognizedHit(message.hit);
  if (message.type === "calibration-progress") updateCalibrationProgress(message);
  if (message.type === "calibration-sample") finishCalibrationStep(message);
  if (message.type === "calibration-draft") persistCalibrationDraft(message.draft);
  if (message.type === "calibration-imported" && calibrationSession) {
    calibrationSession.statuses = statusesFromDraft(calibrationDraft);
    selectFirstIncompleteCalibrationStep();
    renderCalibrationStep();
  }
  if (message.type === "calibration-profile") completeCalibration(message.profile, message.completed);
}

function drawHand(landmarks) {
  const canvas = dom.overlay;
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) { canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio); }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  context.strokeStyle = "rgba(165,255,157,.72)";
  context.lineWidth = 1.5;
  for (const [from, to] of CONNECTIONS) {
    const a = landmarks[from], b = landmarks[to]; if (!a || !b) continue;
    context.beginPath(); context.moveTo((1 - a.x) * rect.width, a.y * rect.height); context.lineTo((1 - b.x) * rect.width, b.y * rect.height); context.stroke();
  }
  context.fillStyle = "#efe6d0";
  for (const point of landmarks) { context.beginPath(); context.arc((1 - point.x) * rect.width, point.y * rect.height, 2.4, 0, Math.PI * 2); context.fill(); }
}

function clearHandOverlay() {
  const context = dom.overlay.getContext("2d");
  context?.setTransform(1, 0, 0, 1, 0, 0);
  context?.clearRect(0, 0, dom.overlay.width, dom.overlay.height);
}

const DIAGNOSTIC_FINGERS = Object.freeze({ index: 9, middle: 8, ring: 7, pinky: 6 });

function resetHandDiagnostics() {
  if (!dom.diagnostics) return;
  dom.diagnostics.dataset.state = "idle";
  dom.diagnosticStatus.value = "NO SIGNAL";
  dom.diagnosticPose.value = "--";
  dom.diagnosticContact.value = "--";
  dom.diagnosticStroke.value = "--";
  dom.diagnosticFrame.value = "--";
  for (const output of $$('[id^="tip-"]', dom.diagnostics)) output.value = "--";
  for (const cell of $$(".finger-diagnostic", dom.diagnostics)) cell.dataset.state = "idle";
}

function updateHandDiagnostics(diagnostic) {
  if (!dom.diagnostics || !diagnostic) return;
  const detected = Boolean(diagnostic.hand?.detected);
  if (!detected) {
    resetHandDiagnostics();
    dom.diagnosticStatus.value = "SCANNING / NO HAND";
    dom.diagnosticFrame.value = Number.isFinite(diagnostic.latency?.totalMs) ? `${diagnostic.latency.totalMs.toFixed(1)}MS` : "--";
    return;
  }

  const contacts = diagnostic.fingertips?.contacts || {};
  const entries = Object.entries(contacts)
    .map(([digit, state]) => ({ digit: Number(digit), ...state }))
    .filter((state) => Number.isFinite(state.distance));
  const nearest = entries.slice().sort((left, right) => left.distance - right.distance)[0] || null;
  const touching = entries.filter((state) => state.latched || state.withinThreshold === true);
  const activeContact = touching.slice().sort((left, right) => left.distance - right.distance)[0] || null;
  const confidence = Math.round(clamp(diagnostic.hand?.confidence ?? 0, 0, 1) * 100);
  dom.diagnostics.dataset.state = activeContact ? "contact" : "tracking";
  dom.diagnosticStatus.value = activeContact ? `CONTACT / SIGN ${activeContact.digit}` : `HAND ACQUIRED / ${confidence}%`;

  const pose = diagnostic.pose || {};
  dom.diagnosticPose.value = pose.digit
    ? `${pose.digit}${pose.accepted ? " OK" : " ?"} ${Math.round(clamp(pose.confidence ?? 0, 0, 1) * 100)}%`
    : String(pose.reason || diagnostic.reason || "TRACKING").replaceAll("-", " ").toUpperCase();
  dom.diagnosticContact.value = activeContact ? `${activeContact.digit} TOUCH Δ${activeContact.distance.toFixed(3)}`
    : nearest ? `NEAR ${nearest.digit} Δ${nearest.distance.toFixed(3)}` : "NO TIP DATA";
  const stroke = diagnostic.downstroke || {};
  dom.diagnosticStroke.value = `${String(stroke.state || "UNAVAILABLE").replaceAll("-", " ").toUpperCase()} / V${Number(stroke.velocity || 0).toFixed(2)}`;
  dom.diagnosticFrame.value = Number.isFinite(diagnostic.latency?.totalMs) ? `${diagnostic.latency.totalMs.toFixed(1)}MS` : "--";

  const thumb = $("#tip-thumb", dom.diagnostics);
  const facing = diagnostic.orientation?.cameraFacing;
  thumb.value = Number.isFinite(facing) ? `VIEW ${facing >= 0 ? "+" : ""}${facing.toFixed(2)}` : "ANCHOR";
  thumb.closest(".finger-diagnostic").dataset.state = "active";
  for (const [finger, digit] of Object.entries(DIAGNOSTIC_FINGERS)) {
    const output = $(`#tip-${finger}`, dom.diagnostics);
    const state = contacts[digit] || {};
    output.value = Number.isFinite(state.distance) ? `Δ ${state.distance.toFixed(3)}` : "--";
    output.closest(".finger-diagnostic").dataset.state = activeContact?.digit === digit ? "contact" : "active";
  }
}

const POSE_TEXT = Object.freeze({
  1: "Index finger only; fold the thumb and remaining fingers.",
  2: "Index and middle fingers; fold the thumb, ring and pinky.",
  3: "Your 3: use the thumb + pointer/index shape you want to play, and repeat it consistently.",
  4: "All four fingers extended; keep the thumb folded.",
  5: "All five fingers extended, including the thumb.",
});
const CONTACT_FINGERS = Object.freeze({ 6: "pinky", 7: "ring", 8: "middle", 9: "index" });
const CALIBRATION_STEPS = Object.freeze([
  ...[1,2,3,4,5].map((digit) => ({
    id: `pose-${digit}`, label: `${digit} BACK`, glyph: String(digit), kind: "pose", digit,
    orientation: "KNUCKLES / BACK OF HAND TOWARD CAMERA",
    text: POSE_TEXT[digit], durationMs: 3600,
  })),
  ...[6,7,8,9].flatMap((digit) => ([
    {
      id: `contact-${digit}-open`, label: `${digit} OPEN`, glyph: String(digit), kind: "contact", digit, phase: "open",
      orientation: "ROTATE: PALM TOWARD CAMERA",
      text: `Keep thumb and ${CONTACT_FINGERS[digit]} fingertip clearly apart. Hold the open shape steady.`, durationMs: 3000,
    },
    {
      id: `contact-${digit}-closed`, label: `${digit} TOUCH`, glyph: String(digit), kind: "contact", digit, phase: "closed",
      orientation: "PALM TOWARD CAMERA",
      text: `Touch thumb to the ${CONTACT_FINGERS[digit]} fingertip for sign ${digit}, then hold that contact steady.`, durationMs: 3200,
    },
  ])),
  {
    id: "downstroke", label: "DOWN HITS", glyph: "↓", kind: "downstroke",
    orientation: "KNUCKLES TOWARD CAMERA / SHORT DOWNWARD HITS",
    text: "Hold any calibrated 1-5 pose and make at least five clear downward strikes, returning upward between hits.", durationMs: 8000,
  },
]);

function blankCalibrationStatuses() {
  return Object.fromEntries(CALIBRATION_STEPS.map((step) => [step.id, "pending"]));
}

function statusesFromDraft(draft) {
  const statuses = blankCalibrationStatuses();
  const data = draft?.data;
  for (const digit of [1,2,3,4,5]) {
    const checked = data?.completed?.pose?.[digit];
    if (checked === true || (checked == null && (data?.poseSamples?.[digit]?.length || 0) >= 5)) statuses[`pose-${digit}`] = "passed";
  }
  for (const digit of [6,7,8,9]) {
    const validated = data?.completed?.contactPhase?.[digit];
    if (validated?.open === true || (validated?.open == null && (data?.contactSamples?.[digit]?.open?.length || 0) >= 5)) statuses[`contact-${digit}-open`] = "passed";
    if (validated?.closed === true || (validated?.closed == null && (data?.contactSamples?.[digit]?.closed?.length || 0) >= 5)) statuses[`contact-${digit}-closed`] = "passed";
  }
  if (data?.completed?.downstroke) statuses.downstroke = "passed";
  const saved = draft?.uiStatuses;
  if (saved && typeof saved === "object") {
    for (const step of CALIBRATION_STEPS) if (["passed", "failed"].includes(saved[step.id])) statuses[step.id] = saved[step.id];
  }
  return statuses;
}

function allPassedStatuses() {
  return Object.fromEntries(CALIBRATION_STEPS.map((step) => [step.id, "passed"]));
}

function selectFirstIncompleteCalibrationStep(from = 0) {
  if (!calibrationSession) return false;
  const ordered = [...CALIBRATION_STEPS.slice(from), ...CALIBRATION_STEPS.slice(0, from)];
  const next = ordered.find((step) => calibrationSession.statuses[step.id] !== "passed");
  if (!next) return false;
  calibrationSession.step = CALIBRATION_STEPS.indexOf(next);
  return true;
}

function mountCalibrationCamera() {
  if (dom.cameraStage && dom.calibrationCameraMount && dom.cameraStage.parentElement !== dom.calibrationCameraMount) {
    dom.calibrationCameraMount.append(dom.cameraStage);
  }
  if (dom.diagnostics && dom.calibrationDiagnosticMount && dom.diagnostics.parentElement !== dom.calibrationDiagnosticMount) {
    dom.calibrationDiagnosticMount.append(dom.diagnostics);
  }
}

function restoreCameraTerminal() {
  if (dom.cameraStage && dom.cameraHome && dom.cameraStage.parentElement !== dom.cameraHome) dom.cameraHome.append(dom.cameraStage);
  if (dom.diagnostics && dom.cameraHome && dom.diagnostics.parentElement !== dom.cameraHome.parentElement) dom.cameraHome.after(dom.diagnostics);
}

function closeCalibrationSession() {
  if (calibrationSession?.capturing) {
    clearTimeout(calibrationTimeout);
    const step = CALIBRATION_STEPS[calibrationSession.step];
    visionWorker?.postMessage({ type: "calibration-cancel", captureId: calibrationSession.captureId || null });
    calibrationSession.capturing = false;
    calibrationSession.statuses[step.id] = calibrationSession.capturePreviousState || "pending";
    calibrationSession.captureId = null;
    calibrationSession.capturePreviousState = null;
    renderCalibrationStep();
  }
  restoreCameraTerminal();
}

function openCalibration() {
  releaseHeldNotes();
  const statuses = calibrationDraft ? statusesFromDraft(calibrationDraft)
    : calibrationProfile?.valid ? allPassedStatuses() : blankCalibrationStatuses();
  calibrationSession = { step: 0, statuses, capturing: false };
  const hasIncomplete = selectFirstIncompleteCalibrationStep();
  renderCalibrationStep();
  if (!hasIncomplete && calibrationProfile?.valid) {
    dom.calibrationInstruction.textContent = "Your active profile is complete. Choose any saved section below if you want to recapture only that part.";
  }
  mountCalibrationCamera();
  dom.calibrationDialog.showModal();
  if (!cameraStream) startCamera().catch((error) => showToast(error.message, 5000));
}

function renderCalibrationChecklist() {
  dom.calibrationChecklist.innerHTML = "";
  CALIBRATION_STEPS.forEach((step, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${calibrationSession.statuses[step.id] === "passed" ? "✓" : calibrationSession.statuses[step.id] === "failed" ? "!" : "·"} ${step.label}`;
    button.dataset.state = calibrationSession.statuses[step.id];
    button.dataset.current = String(index === calibrationSession.step);
    button.disabled = calibrationSession.capturing;
    button.addEventListener("click", () => {
      calibrationSession.step = index;
      calibrationSession.forceCapture = calibrationSession.statuses[step.id] === "passed" ? step.id : null;
      renderCalibrationStep();
    });
    item.append(button);
    dom.calibrationChecklist.append(item);
  });
}

function renderCalibrationStep() {
  if (!calibrationSession) return;
  const step = CALIBRATION_STEPS[calibrationSession.step];
  const state = calibrationSession.statuses[step.id] || "pending";
  const passed = Object.values(calibrationSession.statuses).filter((value) => value === "passed").length;
  dom.calibrationHeading.textContent = `CALIBRATION ${String(calibrationSession.step + 1).padStart(2, "0")} / ${CALIBRATION_STEPS.length}`;
  dom.calibrationInstruction.textContent = step.text;
  dom.calibrationOrientation.textContent = step.orientation;
  dom.calibrationGlyph.textContent = step.glyph;
  dom.calibrationStatus.textContent = state === "passed" ? "PASSED / SAVED" : state === "failed" ? "RETRY THIS PART" : "NOT CAPTURED";
  dom.calibrationStatus.dataset.state = state;
  dom.calibrationCount.textContent = state === "passed" ? "good samples retained" : "waiting for capture";
  dom.calibrationProgress.value = (passed / CALIBRATION_STEPS.length) * 100;
  const allPassed = passed === CALIBRATION_STEPS.length && calibrationSession.forceCapture !== step.id;
  dom.calibrationNext.dataset.action = allPassed ? calibrationProfile?.valid ? "done" : "build" : "capture";
  dom.calibrationNext.textContent = allPassed ? calibrationProfile?.valid ? "DONE" : "BUILD PROFILE"
    : state === "passed" ? "RECAPTURE" : state === "failed" ? "RETRY" : `CAPTURE ${Math.round(step.durationMs / 100) / 10}s`;
  dom.calibrationNext.disabled = calibrationSession.capturing;
  dom.calibrationBack.disabled = calibrationSession.capturing || calibrationSession.step === 0;
  dom.calibrationReset.disabled = calibrationSession.capturing;
  renderCalibrationChecklist();
}

function captureCalibrationStep() {
  if (dom.calibrationNext.dataset.action === "done") { dom.calibrationDialog.close(); return; }
  if (dom.calibrationNext.dataset.action === "build") {
    if (!visionWorker) { showToast("START THE CAMERA ONCE TO LOAD THE VISION WORKER"); return; }
    dom.calibrationNext.disabled = true;
    dom.calibrationInstruction.textContent = "Building your private recognition profile from the saved sections…";
    visionWorker.postMessage({ type: "calibration-build", handedness: dom.hand.value });
    return;
  }
  if (!visionWorker || !cameraStream) { showToast("START THE CAMERA BEFORE CALIBRATING"); return; }
  const step = CALIBRATION_STEPS[calibrationSession.step];
  clearTimeout(calibrationTimeout);
  calibrationSession.forceCapture = null;
  calibrationSession.capturePreviousState = calibrationSession.statuses[step.id];
  calibrationSession.captureId = `${step.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  calibrationSession.capturing = true;
  calibrationSession.statuses[step.id] = "capturing";
  dom.calibrationStatus.textContent = "CAPTURING / HOLD STEADY";
  dom.calibrationStatus.dataset.state = "capturing";
  dom.calibrationCount.textContent = "waiting for valid hand frames";
  dom.calibrationInstruction.textContent = `${step.text} Keep the full hand inside the frame.`;
  dom.calibrationNext.disabled = true;
  dom.calibrationBack.disabled = true;
  dom.calibrationReset.disabled = true;
  renderCalibrationChecklist();
  visionWorker.postMessage({
    type: "calibration-capture",
    step: step.id,
    captureId: calibrationSession.captureId,
    glyph: step.glyph,
    phase: step.phase,
    durationMs: step.durationMs,
    replace: true,
  });
  calibrationTimeout = setTimeout(() => {
    if (!calibrationSession?.capturing || calibrationSession.statuses[step.id] !== "capturing") return;
    visionWorker?.postMessage({ type: "calibration-cancel", captureId: calibrationSession.captureId || null });
    calibrationSession.capturing = false;
    calibrationSession.statuses[step.id] = "failed";
    calibrationSession.captureId = null;
    calibrationSession.capturePreviousState = null;
    dom.calibrationInstruction.textContent = "No completed capture arrived. Check that the camera sees one full hand, then retry only this part.";
    renderCalibrationStep();
  }, step.durationMs + 4500);
}

function stepPassed(summary, step) {
  if (step.phase) return Boolean(summary?.phases?.[step.phase]?.complete);
  return Boolean(summary?.complete);
}

function updateCalibrationProgress(message) {
  if (!calibrationSession?.capturing || !message.latest) return;
  if (message.captureId && message.captureId !== calibrationSession.captureId) return;
  const step = CALIBRATION_STEPS[calibrationSession.step];
  const phaseSummary = step.phase ? message.latest.phases?.[step.phase] : message.latest;
  if (!phaseSummary) return;
  dom.calibrationCount.textContent = `${phaseSummary.count || 0} valid / ${phaseSummary.minimum || message.latest.minimum || 5} minimum`;
}

function finishCalibrationStep(message) {
  if (!calibrationSession?.capturing) return;
  if (message.captureId && message.captureId !== calibrationSession.captureId) return;
  const index = CALIBRATION_STEPS.findIndex((step) => step.id === String(message.step));
  if (index < 0) return;
  clearTimeout(calibrationTimeout);
  const step = CALIBRATION_STEPS[index];
  const passed = stepPassed(message.summary, step);
  calibrationSession.capturing = false;
  calibrationSession.captureId = null;
  calibrationSession.capturePreviousState = null;
  calibrationSession.statuses[step.id] = passed ? "passed" : "failed";
  calibrationSession.step = index;
  if (!passed) {
    visionWorker?.postMessage({ type: "calibration-export" });
    renderCalibrationStep();
    dom.calibrationInstruction.textContent = message.summary?.reason
      ? `This part needs a focused retry: ${message.summary.reason}. Everything already passed is still saved.`
      : `This part needs more clean frames (${message.summary?.count || 0} captured). Everything already passed is still saved.`;
    return;
  }
  const hasNext = selectFirstIncompleteCalibrationStep(index + 1);
  if (hasNext) {
    visionWorker?.postMessage({ type: "calibration-export" });
    renderCalibrationStep();
    dom.calibrationInstruction.textContent = `Previous part passed and was saved. ${CALIBRATION_STEPS[calibrationSession.step].text}`;
    return;
  }
  dom.calibrationInstruction.textContent = "All sections captured. Building your private recognition profile…";
  dom.calibrationNext.disabled = true;
  calibrationSession.buildAfterDraft = true;
  visionWorker?.postMessage({ type: "calibration-export" });
}

async function persistCalibrationDraft(draft) {
  if (!draft) return;
  try {
    calibrationDraft = await saveCalibrationDraft({ ...draft, uiStatuses: calibrationSession?.statuses || calibrationDraft?.uiStatuses });
  } catch (error) {
    showToast(`CALIBRATION PROGRESS COULD NOT BE SAVED: ${error.message}`, 5000);
  } finally {
    if (calibrationSession?.buildAfterDraft) {
      calibrationSession.buildAfterDraft = false;
      visionWorker?.postMessage({ type: "calibration-build", handedness: dom.hand.value });
    }
  }
}

async function resetCalibrationProgress() {
  if (!calibrationSession || !window.confirm("Clear every unfinished calibration section? Your currently active profile will remain usable.")) return;
  clearTimeout(calibrationTimeout);
  visionWorker?.postMessage({ type: "calibration-reset" });
  await clearCalibrationDraft();
  calibrationDraft = null;
  calibrationSession = { step: 0, statuses: blankCalibrationStatuses(), capturing: false };
  renderCalibrationStep();
  dom.calibrationInstruction.textContent = "Progress cleared. Start again from pose 1; the old active profile is unchanged until a replacement succeeds.";
}

async function completeCalibration(profile, completed = profile?.completed) {
  if (!calibrationSession) return;
  if (!profile?.valid) {
    for (const digit of [1,2,3,4,5]) if (!completed?.pose?.[digit]) calibrationSession.statuses[`pose-${digit}`] = "failed";
    for (const digit of [6,7,8,9]) if (!completed?.contact?.[digit]) calibrationSession.statuses[`contact-${digit}-closed`] = "failed";
    if (!completed?.downstroke) calibrationSession.statuses.downstroke = "failed";
    selectFirstIncompleteCalibrationStep();
    renderCalibrationStep();
    const failed = Object.values(calibrationSession.statuses).filter((value) => value === "failed").length;
    dom.calibrationInstruction.textContent = `Profile needs ${failed || 1} focused retry. Passed sections remain saved. ${(profile?.errors || []).join("; ")}`;
    visionWorker?.postMessage({ type: "calibration-export" });
    return;
  }
  calibrationProfile = await saveCalibration(profile);
  await clearCalibrationDraft();
  calibrationDraft = null;
  visionWorker?.postMessage({ type: "set-profile", profile: calibrationProfile });
  calibrationSession.statuses = allPassedStatuses();
  calibrationSession.capturing = false;
  dom.calibrationProgress.value = 100;
  dom.calibrationInstruction.textContent = "Profile sealed. No images or video were stored.";
  dom.calibrationStatus.textContent = "ALL SECTIONS PASSED";
  dom.calibrationStatus.dataset.state = "passed";
  dom.calibrationCount.textContent = "ready for live gestures";
  dom.calibrationNext.disabled = false;
  dom.calibrationNext.textContent = "DONE";
  dom.calibrationNext.dataset.action = "done";
  renderCalibrationChecklist();
  setStatus("SIGNAL CONNECTED", "ok");
}

function stopTransport() {
  releaseHeldNotes();
  transport?.stop();
  music?.stopAllGroups?.();
  updateTransportPosition(0);
  updatePlayheads(0);
  drawLanes();
  markChanged();
}

function clickActiveLaneControl(selector) {
  const row = $$(".loop-lane", dom.lanes).find((item) => item.dataset.laneId === activeLane()?.id);
  if (row) $(selector, row)?.click();
}

function isEditableTarget(target) {
  return Boolean(target?.matches?.("input,select,textarea,[contenteditable='true']"));
}

function wireEvents() {
  dom.start.addEventListener("click", async () => {
    dom.start.disabled = true;
    try {
      await initAudio();
      dom.boot.hidden = true;
      dom.workstation.hidden = false;
      visualizer?.resize();
      await startCamera().catch((error) => { showToast(error.message, 5000); stopCamera(); });
    } catch (error) {
      showToast(error.message, 5000);
      dom.start.disabled = false;
    }
  });
  dom.play.addEventListener("click", async () => { await initAudio(); transport.start(); });
  dom.stop.addEventListener("click", stopTransport);
  dom.bpm.addEventListener("change", () => { dom.bpm.value = setProjectBpm(dom.bpm.value); markChanged(); });
  dom.tap.addEventListener("click", () => { const now = performance.now(); tapTimes = [...tapTimes.filter((time) => now - time < 2500), now].slice(-5); if (tapTimes.length > 1) { const intervals = tapTimes.slice(1).map((time, index) => time - tapTimes[index]); dom.bpm.value = setProjectBpm(60000 / (intervals.reduce((a,b) => a + b, 0) / intervals.length)); markChanged(); } });
  dom.quantization.addEventListener("change", () => { project.quantization = dom.quantization.value; markChanged(); });
  dom.collection.addEventListener("change", () => applyCollection(dom.collection.value));
  dom.instrument.addEventListener("change", () => {
    const lane = activeLane();
    lane.instrumentFamily = dom.instrument.value;
    reflectLiveLaneSound(lane, `${INSTRUMENTS[lane.instrumentFamily]?.label || lane.instrumentFamily} INSTRUMENT`);
    markChanged({ renderLanes: true, renderMap: true });
  });
  dom.root.addEventListener("change", () => { project.tonalScene.root = dom.root.value; markChanged({ renderMap: true }); });
  dom.gamma.addEventListener("change", () => { project.tonalScene.gamma = dom.gamma.value; markChanged({ renderMap: true }); });
  dom.harmony.addEventListener("change", () => { project.tonalScene.harmonyMode = dom.harmony.value; markChanged({ renderMap: true }); });
  for (const input of [dom.master, dom.sub, dom.grit]) input.addEventListener("input", () => { project.master.volume = Number(dom.master.value); project.master.subBoost = Number(dom.sub.value); project.master.distortion = Number(dom.grit.value); updateFaderOutputs(); applyMasterSettings(); markChanged(); });
  dom.generate.addEventListener("click", generateIntoActiveLane);
  for (const row of $$(".focused-roll-row", dom.focusedRoll)) {
    $(".focused-roll-key", row).addEventListener("click", () => triggerHit({ digit: Number(row.dataset.digit), velocity: 0.78, confidence: 1, source: "piano-key" }));
  }
  dom.focusedRecord.addEventListener("click", () => clickActiveLaneControl(".lane-record"));
  dom.focusedOverdub.addEventListener("click", () => clickActiveLaneControl(".lane-overdub"));
  dom.focusedMute.addEventListener("click", () => clickActiveLaneControl(".lane-mute"));
  dom.focusedSolo.addEventListener("click", () => clickActiveLaneControl(".lane-solo"));
  dom.focusedClear.addEventListener("click", () => clickActiveLaneControl(".lane-clear"));
  dom.export.addEventListener("click", exportWav);
  dom.cameraToggle.addEventListener("click", () => startCamera().catch((error) => showToast(error.message, 5000)));
  dom.hand.addEventListener("change", async () => {
    visionWorker?.postMessage({ type: "handedness", handedness: dom.hand.value });
    if (!calibrationDraft) return;
    visionWorker?.postMessage({ type: "calibration-reset" });
    await clearCalibrationDraft();
    calibrationDraft = null;
    if (calibrationSession) {
      calibrationSession = { step: 0, statuses: blankCalibrationStatuses(), capturing: false };
      renderCalibrationStep();
    }
    showToast("CALIBRATION PROGRESS RESET FOR THE SELECTED HAND", 4200);
  });
  dom.calibrationButton.addEventListener("click", openCalibration);
  dom.calibrationDialog.addEventListener("close", closeCalibrationSession);
  dom.calibrationNext.addEventListener("click", captureCalibrationStep);
  dom.calibrationBack.addEventListener("click", () => { if (calibrationSession?.step > 0) { calibrationSession.step -= 1; renderCalibrationStep(); } });
  dom.calibrationReset.addEventListener("click", resetCalibrationProgress);
  for (const button of $$(".visual-mode")) button.addEventListener("click", () => { $$(".visual-mode").forEach((item) => item.classList.remove("active")); button.classList.add("active"); visualizer?.setMode(button.dataset.mode); project.ui.visualizerMode = button.dataset.mode; markChanged(); });
  dom.fullVisual.addEventListener("click", () => $(".visualizer-panel")?.requestFullscreen?.());
  dom.reduceMotion.addEventListener("click", () => { project.ui.reducedMotion = !project.ui.reducedMotion; dom.reduceMotion.setAttribute("aria-pressed", String(project.ui.reducedMotion)); document.body.classList.toggle("reduced-motion", project.ui.reducedMotion); visualizer?.setReducedMotion(project.ui.reducedMotion); markChanged(); });
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.repeat || isEditableTarget(event.target)) return;
    if (event.ctrlKey || event.altKey || event.metaKey || dom.calibrationDialog.open || !dom.boot.hidden) return;
    if (event.code === "Space" && !event.target?.matches?.("button")) { event.preventDefault(); transport?.playing ? stopTransport() : transport?.start(); return; }
    const digit = digitFromKeyEvent(event);
    if (!digit) return;
    event.preventDefault();
    beginHeldNote({ gateId: `keyboard:${event.code || event.key}`, digit, velocity: 0.78, confidence: 1, source: "keyboard" });
  });
  window.addEventListener("keyup", (event) => {
    const gateId = `keyboard:${event.code || event.key}`;
    if (!heldNotes.has(gateId)) return;
    event.preventDefault();
    endHeldNote(gateId);
  });
  window.addEventListener("blur", () => releaseHeldNotes((held) => held.source === "keyboard"));
  window.addEventListener("beforeunload", () => { releaseHeldNotes(); if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop()); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { releaseHeldNotes(); frameInFlight = false; visionWorker?.postMessage({ type: "reset" }); } });
}

populateControls();
drawLanes();
drawFocusedLane();
wireEvents();
document.body.classList.toggle("reduced-motion", project.ui.reducedMotion);
dom.reduceMotion.setAttribute("aria-pressed", String(project.ui.reducedMotion));
