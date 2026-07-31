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
  prepareOfflineLanes,
  renderOfflineProject,
  resolveInstrumentGesture,
} from "./music/index.js?v=14";
import { LoopTransport } from "./looper.js?v=10";
import { LOOP_PEDAL_CLEAR_HOLD_MS, digitFromKeyEvent, loopPedalActionFromKeyEvent } from "./input.js?v=2";
import { MAX_SSPELL_FILE_BYTES, parseProjectFile, projectFileName, serializeProjectFile } from "./project-file.js?v=2";
import { DiagnosticLog } from "./diagnostic-log.js?v=1";
import { createDetector } from "./vision/mediapipe-adapter.js?v=3";
import { resolveLiveGestureDebugState } from "./vision/debug-state.js?v=2";
import { shouldReleaseVisionGate } from "./vision/gate-policy.js?v=1";
import { bitmapFailureSummary, canSendVisionFrame, visionDetectorFailureMessage, visionPipelineSummary } from "./vision/pipeline-state.js?v=2";
import { BEATS_PER_BAR, clamp, createId, normalizeProject, quantizeBeat, sanitizeBpm, sanitizeLaneLength } from "./shared.js?v=7";
import {
  clearCalibrationDraft,
  createAutosaver,
  loadCalibration,
  loadCalibrationDraft,
  loadProject,
  saveCalibration,
  saveCalibrationDraft,
  saveProject,
} from "./storage.js?v=7";
import { createSpellVisualizer } from "./visual/visualizer.js?v=9";

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const COLLECTION_REFERENCES = Object.freeze({
  wiltedBedroom: "LIL PEEP-INSPIRED",
  cemeteryTape: "$UICIDEBOY$-INSPIRED",
  redlineWound: "XXXTENTACION-INSPIRED",
  ironChapel: "ZILLAKAMI-INSPIRED",
  avianChamber: "ANDREW BIRD-INSPIRED",
  psychedelicSun: "TAME IMPALA-INSPIRED",
  hollowVoltage: "SOAD-INSPIRED / ORIGINAL",
});
const RECIPE_FAMILY = Object.freeze({ "808": "bass", bass: "bass", overdrivenBass: "bass", piano: "piano", eerieLead: "melody", organ: "melody", steelGuitar: "melody", overdrivenGuitar: "riff", violin: "melody", percussion: "drums", drumKit: "drums", pad: "melody" });
const WAV_EXPORT_REPEATS = 3;
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const dom = {
  boot: $("#boot-screen"), workstation: $("#workstation"), start: $("#start-app"), status: $("#system-status"), statusLight: $("#system-light"), toast: $("#toast"),
  video: $("#camera-feed"), overlay: $("#hand-overlay"), cameraStage: $("#camera-stage"), cameraHome: $("#camera-stage-home"), cameraMessage: $("#camera-message"), cameraToggle: $("#camera-toggle"), hand: $("#handedness-select"),
  diagnostics: $("#hand-diagnostics"), diagnosticStatus: $("#hand-diagnostic-status"), diagnosticPose: $("#hand-diagnostic-pose"), diagnosticContact: $("#hand-diagnostic-contact"), diagnosticStroke: $("#hand-diagnostic-stroke"), diagnosticFrame: $("#hand-diagnostic-frame"),
  serialDiagnostics: $("#serial-diagnostics"), serialLog: $("#serial-diagnostic-log"), serialLogToggle: $("#serial-log-toggle"), serialLogCopy: $("#serial-log-copy"), serialLogClear: $("#serial-log-clear"),
  pedal: $("#loop-pedal"), pedalLine: $("#pedal-line"), pedalState: $("#pedal-state"), pedalRecord: $("#pedal-record"), pedalTransport: $("#pedal-transport"), pedalUndo: $("#pedal-undo"),
  gestureDigit: $("#gesture-digit"), gestureState: $("#gesture-state"), gestureConfidence: $("#gesture-confidence"), latency: $("#latency-readout"),
  play: $("#transport-play"), stop: $("#transport-stop"), bpm: $("#bpm-input"), tap: $("#tap-tempo"), quantization: $("#quantization-select"), position: $("#transport-position"),
  collection: $("#collection-select"), instrument: $("#instrument-select"), root: $("#root-select"), gamma: $("#gamma-select"), harmony: $("#harmony-select"), noteOrder: $("#note-order-select"), gestureMap: $("#gesture-map"),
  master: $("#master-volume"), sub: $("#sub-boost"), grit: $("#distortion"), reverb: $("#master-reverb"), generate: $("#generate-loop"), lanes: $("#loop-lanes"), laneTemplate: $("#lane-template"),
  focusedPanel: $(".focused-editor-panel"), focusedSummary: $("#focused-lane-summary"), focusedRoll: $("#focused-lane-roll"), focusedEmpty: $("#focused-roll-empty"), focusedLength: $("#focused-roll-length"), focusedRecord: $("#focused-record"), stepInput: $("#step-input"), recordNext: $("#record-next"), focusedOverdub: $("#focused-overdub"), focusedMute: $("#focused-mute"), focusedSolo: $("#focused-solo"), focusedClear: $("#focused-clear"),
  laneCount: $("#lane-count"),
  export: $("#export-wav"), exportProject: $("#export-project"), restoreProject: $("#restore-project"), restoreProjectFile: $("#restore-project-file"), visualCanvas: $("#visualizer-canvas"), visualLabel: $("#visualizer-label"), fullVisual: $("#fullscreen-visualizer"), maxVisual: $("#maximize-visualizer"), captureAudio: $("#capture-audio"), reduceMotion: $("#reduced-motion"),
  calibrationButton: $("#calibrate-button"), calibrationDialog: $("#calibration-dialog"), calibrationCameraMount: $("#calibration-camera-mount"), calibrationDiagnosticMount: $("#calibration-diagnostic-mount"), calibrationHeading: $("#calibration-heading"), calibrationInstruction: $("#calibration-instruction"), calibrationOrientation: $("#calibration-orientation"), calibrationGlyph: $("#calibration-glyph"), calibrationStatus: $("#calibration-status"), calibrationCount: $("#calibration-count"), calibrationProgress: $("#calibration-progress"), calibrationChecklist: $("#calibration-checklist"), calibrationBack: $("#calibration-back"), calibrationReset: $("#calibration-reset"), calibrationNext: $("#calibration-next"),
};

let project = normalizeProject(await loadProject());
let audioContext = null;
let music = null;
let analyser = null;
let visualizer = null;
let systemAudio = null;
let transport = null;
let audioInitPromise = null;
let cameraStream = null;
let cameraGeneration = 0;
let visionWorker = null;
let visionDetector = null;
let visionReady = false;
let frameInFlight = false;
let cameraLoopHandle = 0;
let lastBitmapFailureAt = -Infinity;
let visionInitTimeout = 0;
let calibrationProfile = await loadCalibration();
let calibrationDraft = await loadCalibrationDraft();
let calibrationSession = null;
let calibrationTimeout = 0;
let lastHitAt = 0;
let toastTimer = 0;
let tapTimes = [];
let focusedMappingBar = -1;
let recordNextState = null;
let pedalHold = null;
const pedalKeysDown = new Set();
let stepPoseState = { candidate: null, since: 0, latched: null, lastSeenAt: 0 };
let serialLogExpanded = false;
try { serialLogExpanded = localStorage.getItem("sign-spell:serial-log-expanded") === "true"; } catch { /* storage may be unavailable */ }
const heldNotes = new Map();
let visionGateWatchdog = 0;
const diagnosticLog = new DiagnosticLog({
  onChange: (text) => {
    // Keep buffering lightweight derived summaries, but do not churn the DOM
    // while the user has explicitly hidden the support console.
    if (serialLogExpanded && dom.serialLog) dom.serialLog.textContent = text || "[--:--:--] SYSTEM  log cleared";
  },
});
diagnosticLog.add("system", "local summary log initialized; no media or landmarks retained");

function setSerialLogExpanded(expanded, { persist = true } = {}) {
  serialLogExpanded = Boolean(expanded);
  dom.serialDiagnostics?.setAttribute("data-expanded", String(serialLogExpanded));
  dom.serialLogToggle?.setAttribute("aria-expanded", String(serialLogExpanded));
  if (dom.serialLogToggle) dom.serialLogToggle.textContent = serialLogExpanded ? "HIDE LOG" : "SHOW LOG";
  if (serialLogExpanded && dom.serialLog) dom.serialLog.textContent = diagnosticLog.text() || "[--:--:--] SYSTEM  log cleared";
  if (persist) {
    try { localStorage.setItem("sign-spell:serial-log-expanded", String(serialLogExpanded)); } catch { /* storage may be unavailable */ }
  }
}
setSerialLogExpanded(serialLogExpanded, { persist: false });

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

function updateLoopPedal() {
  const lane = activeLane();
  if (!lane || !dom.pedal) return;
  const index = project.lanes.indexOf(lane) + 1;
  const hits = lane.events.length;
  const recording = Boolean(lane.recording || lane.armed);
  const playing = Boolean(transport?.playing);
  dom.pedalLine.textContent = `LINE ${String(index).padStart(2, "0")} / ${hits} HIT${hits === 1 ? "" : "S"}`;
  dom.pedalState.textContent = lane.recording ? "CAPTURING TAKE"
    : lane.armed ? "ARMED / NEXT BAR"
      : playing ? (hits ? "LOOPING / READY" : "PLAYING / EMPTY")
        : (hits ? "STOPPED / SAVED" : "EMPTY / READY");
  dom.pedalRecord.setAttribute("aria-pressed", String(recording));
  dom.pedalRecord.dataset.state = lane.recording ? "recording" : lane.armed ? "armed" : "idle";
  $("strong", dom.pedalRecord).textContent = recording ? "STOP REC" : hits ? "OVERDUB" : "RECORD";
  dom.pedalTransport.setAttribute("aria-pressed", String(playing));
  $("strong", dom.pedalTransport).textContent = playing ? "STOP" : "PLAY";
  dom.pedalUndo.dataset.holding = String(Boolean(pedalHold));
  dom.pedalUndo.setAttribute("aria-pressed", String(Boolean(pedalHold)));
  $("strong", dom.pedalUndo).textContent = pedalHold?.cleared ? "CLEARED" : pedalHold ? "HOLD..." : "UNDO";
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
  dom.noteOrder.value = project.tonalScene.noteOrder || "ascending";
  dom.bpm.value = sanitizeBpm(project.tonalScene.bpm);
  dom.quantization.value = project.quantization;
  dom.master.value = project.master.volume;
  dom.sub.value = project.master.subBoost;
  dom.grit.value = project.master.distortion;
  dom.reverb.value = project.master.reverb;
  for (const button of $$(".visual-mode")) button.classList.toggle("active", button.dataset.mode === project.ui.visualizerMode);
  updateFaderOutputs();
  drawGestureMap();
  updateLoopPedal();
}

function updateFaderOutputs() {
  for (const input of [dom.master, dom.sub, dom.grit, dom.reverb]) {
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
      reverb: lane.reverb,
      letRing: lane.letRing,
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
      reverb: event.lane.reverb,
      letRing: event.lane.letRing,
    }, when);
  } catch (error) {
    console.warn("Loop event rejected", error);
  }
}

async function resumeAudio(context, timeoutMs = 1600) {
  if (context.state === "running") return;
  let timeout = 0;
  try {
    await Promise.race([
      context.resume(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("AUDIO WAITING FOR A PLAY/NOTE GESTURE")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  if (context.state !== "running") throw new Error("AUDIO WAITING FOR A PLAY/NOTE GESTURE");
}

async function initAudio({ timeoutMs = 1600 } = {}) {
  if (music && audioContext) {
    await resumeAudio(audioContext, timeoutMs);
    return music;
  }
  if (audioInitPromise) return audioInitPromise;
  audioInitPromise = (async () => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error("Web Audio is not supported in this browser.");
    audioContext ||= new AudioContextCtor({ latencyHint: "interactive" });
    await resumeAudio(audioContext, timeoutMs);
    if (music) return music;
    music = new MusicEngine(audioContext, project.master);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    // Preserve kick/snare/hat onsets for the visual scenes; the renderer adds
    // its own attack/release smoothing instead of smearing them at the analyser.
    analyser.smoothingTimeConstant = 0.48;
    music.master.output.connect(analyser);
    visualizer = createSpellVisualizer(dom.visualCanvas, { analyser, mode: project.ui.visualizerMode, reducedMotion: project.ui.reducedMotion, bpm: project.tonalScene.bpm });
    visualizer.start();
    transport = new LoopTransport({ getAudioTime: () => audioContext.currentTime, scheduleEvent: scheduleLoopEvent, project });
    transport.addEventListener("tick", (event) => {
      updateTransportPosition(event.detail.beat);
      updatePlayheads(event.detail.beat);
    });
    transport.addEventListener("transport", (event) => {
      dom.play.classList.toggle("active", event.detail.playing);
      updateLoopPedal();
    });
    applyMasterSettings();
    return music;
  })();
  try {
    return await audioInitPromise;
  } finally {
    // A blocked first gesture may be retried by Play, a key, or a pedal.
    audioInitPromise = null;
  }
}

/**
 * Pipes audio already playing on this machine into the visualizer, turning the
 * page into a standalone visualizer for any player.
 *
 * Two constraints shape this.  The capture API refuses an audio-only request,
 * so a throwaway video track is asked for and immediately disabled rather than
 * rendered.  And the captured signal is wired to the analyser *only* — sending
 * it onward to the speakers would echo whatever the user is already hearing.
 */
async function toggleSystemAudioCapture() {
  if (systemAudio) {
    stopSystemAudioCapture("PC AUDIO RELEASED");
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast("THIS BROWSER CANNOT TAP SYSTEM AUDIO — USE DESKTOP CHROME OR EDGE", 4600);
    return;
  }
  try {
    await initAudio();
  } catch (error) {
    showToast(`AUDIO ENGINE OFFLINE: ${error?.message || "unknown error"}`, 4200);
    return;
  }

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: "include",
      monitorTypeSurfaces: "include",
      selfBrowserSurface: "exclude",
    });
  } catch (error) {
    if (error?.name === "NotAllowedError") showToast("PC AUDIO CANCELLED", 2400);
    else showToast(`PC AUDIO FAILED: ${error?.message || "unknown error"}`, 4200);
    return;
  }

  const [track] = stream.getAudioTracks();
  if (!track) {
    for (const other of stream.getTracks()) other.stop();
    showToast("THAT SHARE CARRIED NO AUDIO — RETRY AND TICK THE SHARE-AUDIO BOX", 5400);
    return;
  }
  for (const video of stream.getVideoTracks()) video.enabled = false;

  const source = audioContext.createMediaStreamSource(stream);
  const gain = audioContext.createGain();
  gain.gain.value = 1.4;
  source.connect(gain).connect(analyser);
  systemAudio = { stream, source, gain };
  for (const any of stream.getTracks()) any.addEventListener("ended", () => stopSystemAudioCapture("PC AUDIO ENDED"));

  dom.captureAudio.setAttribute("aria-pressed", "true");
  dom.captureAudio.textContent = "PC AUDIO ●";
  visualizer?.setSourceLabel(track.label ? `PC · ${track.label}` : "PC AUDIO");
  visualizer?.setBpm(0);
  diagnosticLog.state("visual", "external audio attached to analyser (not routed to output)");
  showToast("PC AUDIO LIVE — THE SCENES NOW FOLLOW WHATEVER IS PLAYING", 3800);
}

function stopSystemAudioCapture(message = "") {
  if (!systemAudio) return;
  try { systemAudio.source.disconnect(); } catch { /* already torn down */ }
  try { systemAudio.gain.disconnect(); } catch { /* already torn down */ }
  for (const track of systemAudio.stream.getTracks()) track.stop();
  systemAudio = null;
  dom.captureAudio.setAttribute("aria-pressed", "false");
  dom.captureAudio.textContent = "PC AUDIO";
  visualizer?.setSourceLabel("INTERNAL");
  visualizer?.setBpm(project.tonalScene.bpm);
  diagnosticLog.state("visual", "external audio released");
  if (message) showToast(message);
}

function applyMasterSettings() {
  music?.setTone?.(project.master);
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
      reverb: lane.reverb,
      letRing: lane.letRing,
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
  visualizer?.setBpm(nextBpm);
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
      reverb: lane.reverb,
      letRing: lane.letRing,
    });
    const captured = transport?.captureHit({ ...hit, digit: Number(hit.digit), velocity: mapped.velocity, duration: lane.instrumentFamily === "pad" ? 1.5 : 0.32 });
    flashGesture(hit);
    if (captured) markChanged({ renderLanes: true });
  } catch (error) {
    showToast(error.message);
  }
}

function gridStepBeats() {
  return project.quantization === "off" ? 0.25 : ({ "1/8": 0.5, "1/16": 0.25, "1/32": 0.125 }[project.quantization] || 0.25);
}

function addGridNote(lane, digit, beat, { velocity = 0.78, duration = null, source = "grid" } = {}) {
  const loopBeats = Math.max(1, Number(lane.lengthBars) || 1) * BEATS_PER_BAR;
  const step = gridStepBeats();
  const event = {
    id: createId("event"),
    beat: quantizeBeat(clamp(beat, 0, loopBeats - 0.0001), project.quantization) % loopBeats,
    digit: clamp(Math.round(digit), 1, 9),
    degree: clamp(Math.round(digit), 1, 9),
    velocity: clamp(velocity, 0.05, 1),
    duration: clamp(duration ?? step, 0.05, loopBeats),
    source,
  };
  lane.events.push(event);
  lane.events.sort((left, right) => left.beat - right.beat);
  return event;
}

function captureStepInput(hit) {
  if (!project.ui.stepInput) return null;
  const lane = activeLane();
  if (!lane || lane.recording || lane.armed) return null;
  const loopBeats = lane.lengthBars * BEATS_PER_BAR;
  const beat = Number(lane.stepCursorBeat) || 0;
  const event = addGridNote(lane, hit.digit, beat, { velocity: hit.velocity, source: "gesture-step" });
  lane.stepCursorBeat = (event.beat + gridStepBeats()) % loopBeats;
  showToast(`${lane.name} STEP ${event.digit} @ ${event.beat.toFixed(2)}`, 1100);
  markChanged({ renderLanes: true });
  return event;
}

function updateGestureStepPose(diagnostic) {
  if (!project.ui.stepInput) { stepPoseState = { candidate: null, since: 0, latched: null, lastSeenAt: 0 }; return; }
  const now = performance.now();
  const digit = diagnostic?.hand?.detected && diagnostic?.pose?.accepted ? Number(diagnostic.pose.digit) : null;
  if (!Number.isInteger(digit) || digit < 1 || digit > 5) {
    stepPoseState.candidate = null;
    stepPoseState.since = 0;
    if (now - stepPoseState.lastSeenAt > 260) stepPoseState.latched = null;
    return;
  }
  stepPoseState.lastSeenAt = now;
  if (stepPoseState.candidate !== digit) {
    stepPoseState.candidate = digit;
    stepPoseState.since = now;
    return;
  }
  if (stepPoseState.latched !== digit && now - stepPoseState.since >= 90) {
    stepPoseState.latched = digit;
    captureStepInput({ digit, velocity: diagnostic.pose.confidence || 0.76, source: "pose-step" });
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
      reverb: lane.reverb,
      letRing: lane.letRing,
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

function endHeldNote(gateId, { render = true, reason = "input-ended" } = {}) {
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
  if (held.source.startsWith("vision-")) diagnosticLog.add("gate", `release digit=${held.digit}; source=${held.source}; cause=${reason}`);
  if (captured && render) markChanged({ renderLanes: true });
  return Boolean(captured);
}

function refreshVisionGateWatchdog() {
  clearTimeout(visionGateWatchdog);
  visionGateWatchdog = 0;
  if (![...heldNotes.values()].some((held) => held.source.startsWith("vision-"))) return;
  visionGateWatchdog = setTimeout(() => {
    visionGateWatchdog = 0;
    releaseHeldNotes((held) => held.source.startsWith("vision-"), "watchdog-timeout");
  }, 520);
}

function releaseHeldNotes(predicate = () => true, reason = "bulk-release") {
  let changed = false;
  for (const [gateId, held] of [...heldNotes]) {
    if (predicate(held)) changed = endHeldNote(gateId, { render: false, reason }) || changed;
  }
  if (changed) markChanged({ renderLanes: true });
}

function syncVisionHeldNotes(diagnostic) {
  for (const [gateId, held] of [...heldNotes]) {
    if (shouldReleaseVisionGate(held, diagnostic)) {
      const reason = held.source === "vision-downstroke"
        ? diagnostic?.downstroke?.reason || diagnostic?.downstroke?.state || "stroke-unlocked"
        : diagnostic?.contact?.reason || "contact-open";
      endHeldNote(gateId, { reason });
    }
  }
}

function handleRecognizedHit(hit) {
  if (dom.calibrationDialog.open) return;
  // STEP mode writes 1–5 from a stable displayed pose, without requiring a
  // dip. Contact signs 6–9 still enter on the actual fingertip tap.
  if (hit?.source !== "downstroke") captureStepInput(hit);
  if (hit?.source === "contact") {
    releaseHeldNotes((held) => held.source === "vision-downstroke");
    beginHeldNote({ gateId: `vision:contact:${hit.digit}`, ...hit, source: "vision-contact" });
    refreshVisionGateWatchdog();
    return;
  }
  if (hit?.source === "downstroke") {
    if ([...heldNotes.values()].some((held) => held.source === "vision-contact")) return;
    const flowing = heldNotes.get("vision:downstroke");
    if (flowing && flowing.digit !== Number(hit.digit)) endHeldNote("vision:downstroke");
    beginHeldNote({ gateId: "vision:downstroke", ...hit, source: "vision-downstroke" });
    refreshVisionGateWatchdog();
    return;
  }
  triggerHit(hit);
}

function flashGesture(hit) {
  dom.gestureDigit.value = hit.digit;
  const baseState = hit.source === "contact" ? "CONTACT HIT" : hit.source === "downstroke" ? "DOWNSTROKE" : "MANUAL HIT";
  dom.gestureState.textContent = hit.predicted ? `PRED ${baseState} / ${Math.round(hit.leadMs || 0)}MS` : baseState;
  diagnosticLog.add("gesture", `digit=${Number(hit.digit)}; source=${hit.source || "unknown"}; predicted=${hit.predicted ? 1 : 0}; fast=${hit.fastStart ? 1 : 0}; flow=${hit.flow ? 1 : 0}; reacquired=${hit.reacquired ? 1 : 0}; lead=${Math.round(hit.leadMs || 0)}ms`);
  dom.gestureConfidence.value = clamp(hit.confidence ?? 1, 0, 1);
  dom.gestureDigit.classList.remove("hit");
  void dom.gestureDigit.offsetWidth;
  dom.gestureDigit.classList.add("hit");
  const cell = dom.gestureMap.querySelector(`[data-digit="${hit.digit}"]`);
  if (cell) { cell.classList.add("hit"); setTimeout(() => cell.classList.remove("hit"), 130); }
}

function drawLanes() {
  dom.lanes.innerHTML = "";
  if (dom.laneCount) dom.laneCount.textContent = `${project.lanes.length} DYNAMIC LINE${project.lanes.length === 1 ? "" : "S"} / 8 MAX`;
  project.lanes.forEach((lane, index) => {
    const fragment = dom.laneTemplate.content.cloneNode(true);
    const row = $(".loop-lane", fragment);
    row.dataset.laneId = lane.id;
    row.classList.toggle("active", lane.id === project.activeLaneId);
    row.setAttribute("aria-current", lane.id === project.activeLaneId ? "true" : "false");
    row.classList.toggle("recording", lane.recording);
    row.classList.toggle("armed", lane.armed);
    row.classList.toggle("muted", lane.muted);
    row.classList.toggle("solo", lane.solo);
    $(".lane-number", row).textContent = String(index + 1).padStart(2, "0");
    $(".lane-name", row).textContent = lane.name;
    $(".lane-instrument", row).textContent = `${VIBE_COLLECTIONS[lane.collectionId]?.title || "CUSTOM"} / ${INSTRUMENTS[lane.instrumentFamily]?.label || lane.instrumentFamily}`;
    const record = $(".lane-record", row); record.classList.toggle("active", lane.armed || lane.recording); record.textContent = lane.recording ? "REC" : lane.armed ? "WAIT" : "●"; record.setAttribute("aria-pressed", String(lane.armed || lane.recording)); record.setAttribute("aria-label", lane.recording ? "Stop recording" : lane.armed ? "Cancel queued recording" : "Record one loop pass");
    const overdub = $(".lane-overdub", row); overdub.classList.toggle("active", lane.overdub);
    const mute = $(".lane-mute", row); mute.classList.toggle("active", lane.muted); mute.setAttribute("aria-pressed", String(lane.muted)); mute.setAttribute("aria-label", `${lane.muted ? "Unmute" : "Mute"} ${lane.name}`);
    const solo = $(".lane-solo", row); solo.classList.toggle("active", lane.solo); solo.setAttribute("aria-pressed", String(lane.solo)); solo.setAttribute("aria-label", `${lane.solo ? "Disable solo for" : "Solo"} ${lane.name}`);
    const length = $(".lane-length select", row); length.value = lane.lengthBars;
    const gain = $(".lane-gain", row); gain.value = lane.gain;
    const reverb = $(".lane-reverb", row); reverb.value = lane.reverb;
    gain.parentElement.querySelector("output").value = Math.round(lane.gain * 100);
    reverb.parentElement.querySelector("output").value = Math.round(lane.reverb * 100);
    const ring = $(".lane-ring", row); ring.setAttribute("aria-pressed", String(lane.letRing));
    const eventArea = $(".lane-events", row);
    drawLaneEvents(eventArea, lane);
    $(".lane-select", row).addEventListener("click", () => selectLane(lane.id));
    record.addEventListener("click", () => toggleLaneRecord(lane));
    overdub.addEventListener("click", () => { lane.overdub = !lane.overdub; markChanged({ renderLanes: true }); });
    mute.addEventListener("click", () => { lane.muted = !lane.muted; if (lane.muted) { releaseHeldNotes((held) => held.laneId === lane.id); music?.stopGroup?.(lane.id); } markChanged({ renderLanes: true }); });
    solo.addEventListener("click", () => {
      lane.solo = !lane.solo;
      releaseHeldNotes();
      music?.stopAllGroups?.();
      markChanged({ renderLanes: true });
    });
    length.addEventListener("change", () => {
      const nextBars = sanitizeLaneLength(length.value, lane.lengthBars);
      const nextBeats = nextBars * BEATS_PER_BAR;
      releaseHeldNotes((held) => held.laneId === lane.id);
      music?.stopGroup?.(lane.id);
      lane.lengthBars = nextBars;
      lane.events = lane.events.filter((item) => item.beat < nextBeats);
      lane.stepCursorBeat = (Number(lane.stepCursorBeat) || 0) % nextBeats;
      markChanged({ renderLanes: true });
    });
    gain.addEventListener("input", () => { lane.gain = Number(gain.value); gain.parentElement.querySelector("output").value = Math.round(lane.gain * 100); markChanged(); });
    reverb.addEventListener("input", () => { lane.reverb = Number(reverb.value); reverb.parentElement.querySelector("output").value = Math.round(lane.reverb * 100); music?.setGroupReverb?.(lane.id, lane.reverb); markChanged(); });
    ring.addEventListener("click", () => { lane.letRing = !lane.letRing; ring.setAttribute("aria-pressed", String(lane.letRing)); if (!lane.letRing) music?.stopGroup?.(lane.id); markChanged(); });
    $(".lane-undo", row).addEventListener("click", () => undoLane(lane));
    $(".lane-clear", row).addEventListener("click", () => clearLane(lane));
    dom.lanes.append(fragment);
  });
  updateLoopPedal();
}

function drawLaneEvents(area, lane) {
  const lengthBeats = lane.lengthBars * BEATS_PER_BAR;
  area.style.setProperty("--bar-width", `${100 / lane.lengthBars}%`);
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
  dom.focusedRecord.setAttribute("aria-label", lane.recording ? "Stop selected line recording" : lane.armed ? "Cancel queued recording" : "Record selected line for one loop pass");
  dom.focusedOverdub.setAttribute("aria-pressed", String(lane.overdub));
  dom.focusedMute.setAttribute("aria-pressed", String(lane.muted));
  dom.focusedSolo.setAttribute("aria-pressed", String(lane.solo));
  dom.stepInput?.setAttribute("aria-pressed", String(Boolean(project.ui.stepInput)));
  dom.recordNext?.setAttribute("aria-pressed", String(recordNextState?.laneId === lane.id));
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
    track.style.setProperty("--bar-width", `${100 / lane.lengthBars}%`);
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
      node.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        if (node.dataset.dragged === "true") return;
        lane.events = lane.events.filter((event) => event.id !== loopEvent.id);
        music?.stopGroup?.(lane.id);
        markChanged({ renderLanes: true });
      });
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
  const startX = pointerEvent.clientX;
  const startY = pointerEvent.clientY;
  let moved = false;
  const move = (moveEvent) => {
    if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4) moved = true;
    if (!moved) return;
    const rect = track.getBoundingClientRect();
    const relativeX = clamp((moveEvent.clientX - rect.left) / rect.width, 0, 0.9999);
    loopEvent.beat = quantizeBeat(relativeX * lane.lengthBars * BEATS_PER_BAR, project.quantization);
    target.style.left = `${relativeX * 100}%`;
  };
  const end = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
    target.dataset.dragged = String(moved);
    setTimeout(() => { delete target.dataset.dragged; }, 0);
    if (moved) {
      lane.events.sort((left, right) => left.beat - right.beat);
      reflectLiveLaneSound(lane);
      markChanged({ renderLanes: true });
    }
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

function addFocusedGridNote(pointerEvent) {
  const track = pointerEvent.currentTarget;
  if (pointerEvent.target !== track) return;
  const lane = activeLane();
  if (!lane) return;
  const row = track.closest(".focused-roll-row");
  const rect = track.getBoundingClientRect();
  const beat = clamp((pointerEvent.clientX - rect.left) / rect.width, 0, 0.9999) * lane.lengthBars * BEATS_PER_BAR;
  const event = addGridNote(lane, Number(row.dataset.digit), beat, { source: "piano-roll" });
  try {
    music?.triggerGesture({ instrument: lane.instrumentFamily, collectionId: lane.collectionId, groupId: lane.id, gesture: event.digit, scene: scene(), bar: Math.floor(event.beat / BEATS_PER_BAR), velocity: event.velocity, durationBeat: event.duration, reverb: lane.reverb, letRing: lane.letRing });
  } catch { /* audio may still be locked */ }
  markChanged({ renderLanes: true });
}

function spawnNextLane(sourceLane) {
  const lane = transport?.addLane();
  if (!lane) { showToast("8 LINE LIMIT REACHED"); return null; }
  Object.assign(lane, {
    collectionId: sourceLane.collectionId,
    instrumentFamily: sourceLane.instrumentFamily,
    lengthBars: sourceLane.lengthBars,
    gain: sourceLane.gain,
    reverb: sourceLane.reverb,
    letRing: sourceLane.letRing,
    overdub: true,
  });
  project.activeLaneId = lane.id;
  drawLanes();
  syncControls();
  markChanged();
  showToast(`${sourceLane.name} LOOPING → ${lane.name} READY`, 3600);
  return lane;
}

async function recordThenSpawn() {
  try { await initAudio(); } catch (error) { showToast(error.message || "AUDIO UNAVAILABLE"); return; }
  const lane = activeLane();
  if (!lane) return;
  if (recordNextState?.laneId === lane.id) {
    recordNextState = null;
    updateFocusedControls(lane);
    showToast("REC→NEW CANCELLED");
    return;
  }
  if (project.lanes.length >= 8) { showToast("8 LINE LIMIT REACHED"); return; }
  recordNextState = { laneId: lane.id, started: Boolean(lane.recording) };
  if (!lane.recording && !lane.armed) transport.armLane(lane.id);
  recordNextState.started ||= Boolean(lane.recording);
  drawLanes();
  updateFocusedControls(lane);
  showToast(`${lane.name} REC→NEW ARMED / SHORTCUT N`, 3600);
}

function updateRecordNextState() {
  if (!recordNextState) return;
  const lane = project.lanes.find((item) => item.id === recordNextState.laneId);
  if (!lane) { recordNextState = null; return; }
  if (lane.recording) recordNextState.started = true;
  if (!recordNextState.started && !lane.armed && !lane.recording) { recordNextState = null; return; }
  if (recordNextState.started && !lane.recording && !lane.armed) {
    recordNextState = null;
    spawnNextLane(lane);
  }
}

function updateTransportPosition(beat = 0) {
  const bar = Math.floor(beat / BEATS_PER_BAR) + 1;
  const within = Math.floor(beat % BEATS_PER_BAR) + 1;
  dom.position.value = `${String(bar).padStart(3, "0")}:${String(within).padStart(2, "0")}`;
}

function updatePlayheads(beat = 0) {
  updateRecordNextState();
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
      record.setAttribute("aria-label", lane.recording ? "Stop recording" : lane.armed ? "Cancel queued recording" : "Record lane for one loop pass");
    }
  }
  const lane = activeLane();
  const bar = Math.floor(beat / BEATS_PER_BAR);
  updateFocusedPlayhead(beat);
  updateFocusedControls(lane);
  updateLoopPedal();
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
      reverb: lane.reverb,
      letRing: lane.letRing,
    });
  }
  showToast(`${lane.name}: ${source.events.length} EVENTS CONJURED — PLAYBACK ACTIVE`, 4200);
  markChanged({ renderLanes: true });
}

function exportProjectFile() {
  try {
    const blob = new Blob([serializeProjectFile(project)], { type: "application/vnd.signspell+json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = projectFileName();
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("PROJECT SAVED AS .SSPELL");
  } catch (error) {
    showToast(`PROJECT SAVE FAILED: ${error.message}`, 5000);
  }
}

async function restoreProjectFromFile(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  dom.restoreProject.disabled = true;
  try {
    if (file.size > MAX_SSPELL_FILE_BYTES) throw new RangeError("The .sspell file is larger than 2 MB.");
    const { project: restored, warnings } = parseProjectFile(await file.text());
    if (!window.confirm(`Replace the current project with ${file.name}?\n\nYour calibration stays untouched.`)) return;

    finishPedalUndoHold({ undoIfShort: false });
    releaseHeldNotes();
    transport?.stop();
    music?.stopAllGroups?.();
    autosave.cancel?.();
    recordNextState = null;
    pedalHold = null;
    focusedMappingBar = -1;
    stepPoseState = { candidate: null, since: 0, latched: null, lastSeenAt: 0 };

    project = await saveProject(restored);
    transport?.setProject(project);
    visualizer?.setMode(project.ui.visualizerMode);
    visualizer?.setReducedMotion(project.ui.reducedMotion);
    document.body.classList.toggle("reduced-motion", project.ui.reducedMotion);
    dom.reduceMotion.setAttribute("aria-pressed", String(project.ui.reducedMotion));
    applyMasterSettings();
    drawLanes();
    syncControls();
    drawFocusedLane();
    updateTransportPosition(0);
    updatePlayheads(0);
    showToast(`PROJECT RESTORED / ${project.lanes.length} LINES${warnings.length ? ` / ${warnings.length} REPAIRS` : ""}`, 4200);
  } catch (error) {
    showToast(`RESTORE FAILED: ${error.message}`, 6000);
  } finally {
    input.value = "";
    dom.restoreProject.disabled = false;
  }
}

async function exportWav() {
  dom.export.disabled = true;
  dom.export.textContent = "RENDERING…";
  try {
    const exportLanes = laneEventsForExport();
    const maxBars = Math.max(...prepareOfflineLanes(exportLanes).filter((lane) => lane.events.length).map((lane) => lane.lengthBars), 1);
    const buffer = await renderOfflineProject({ scene: scene(), lanes: exportLanes, lengthBeats: maxBars * BEATS_PER_BAR, repeats: WAV_EXPORT_REPEATS, master: project.master });
    const url = URL.createObjectURL(createWavBlob(buffer));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sign-spell-${Date.now()}.wav`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`WAV EXPORTED — ${WAV_EXPORT_REPEATS}X ARRANGEMENT`);
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
  let stream;
  try {
    diagnosticLog.add("camera", "access requested (video only)");
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 60, min: 24 } }, audio: false });
  } catch (error) {
    diagnosticLog.add("camera", `access failed: ${error?.message || "unknown error"}`);
    throw error;
  }
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
  dom.cameraToggle.dataset.mode = "stop";
  diagnosticLog.state("camera", "stream active");
  setStatus("INITIALIZING VISION", "busy");
  initVisionWorker();
  queueCameraFrame(generation, stream);
}

function stopCamera() {
  releaseHeldNotes((held) => held.source.startsWith("vision-"));
  cameraGeneration += 1;
  cancelAnimationFrame(cameraLoopHandle);
  frameInFlight = false;
  disposeVisionWorker("camera stopped");
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  dom.video.srcObject = null;
  dom.cameraMessage.hidden = false;
  dom.cameraMessage.textContent = "Camera offline. Keyboard digits remain playable.";
  dom.cameraToggle.textContent = "CAMERA OFF";
  dom.cameraToggle.dataset.mode = "start";
  diagnosticLog.state("camera", "stream stopped");
  diagnosticLog.state("hand", "count=0");
  resetHandDiagnostics();
  clearHandOverlay();
  setStatus("CAMERA DORMANT", "idle");
}

function clearVisionInitTimeout() {
  clearTimeout(visionInitTimeout);
  visionInitTimeout = 0;
}

function showVisionDetectorFailure(error, reason = "detector failed") {
  const message = visionDetectorFailureMessage(error);
  releaseHeldNotes((held) => held.source.startsWith("vision-"));
  diagnosticLog.add("detector", `fatal: ${String(error?.message || error || "unknown detector error")}`, { key: `detector-fatal:${reason}`, throttleMs: 1000 });
  disposeVisionWorker(reason);
  // The video stream deliberately stays open: this tells the player that the
  // webcam succeeded and only the local recognition worker needs a retry.
  dom.cameraMessage.hidden = false;
  dom.cameraMessage.textContent = message;
  dom.cameraToggle.textContent = "CAMERA RETRY";
  dom.cameraToggle.dataset.mode = "retry";
  setStatus("VISION DETECTOR FAILED", "error");
  showToast("VISION DETECTOR FAILED — CAMERA IS LIVE — PRESS CAMERA RETRY", 6500);
}

function logVisionPipeline() {
  const summary = visionPipelineSummary({
    worker: visionWorker,
    ready: visionReady,
    inFlight: frameInFlight,
    videoReadyState: dom.video?.readyState ?? 0,
  });
  // Frame idle/in-flight toggles every request and used to bury every useful
  // gesture event. Keep only persistent pipeline health in the state log.
  diagnosticLog.state("pipeline", summary.replace(/; frame=(?:in-flight|idle)/, ""));
}

function disposeVisionWorker(reason = "reset") {
  clearVisionInitTimeout();
  const worker = visionWorker;
  visionWorker = null;
  visionReady = false;
  frameInFlight = false;
  if (worker) {
    try { worker.terminate(); } catch { /* already closed */ }
  }
  if (visionDetector) {
    try { visionDetector.close?.(); } catch { /* already closed */ }
    visionDetector = null;
  }
  diagnosticLog.state("worker", `offline (${reason})`);
  logVisionPipeline();
}

function reportBitmapFailure(error) {
  frameInFlight = false;
  const summary = bitmapFailureSummary(error);
  diagnosticLog.add("camera", summary, { key: "camera:bitmap-failure", throttleMs: 5000 });
  logVisionPipeline();
  const now = performance.now();
  if (now - lastBitmapFailureAt >= 5000) {
    lastBitmapFailureAt = now;
    setStatus("VISION FRAME ERROR", "error", 5000);
    showToast("CAMERA FRAME CAPTURE FAILED — CHECK BROWSER SUPPORT", 5000);
  }
}

async function initVisionWorker() {
  if (visionWorker) return;
  try {
    diagnosticLog.add("worker", "starting vision worker");
    const worker = new Worker("js/vision/vision-worker.js?v=16", { type: "module" });
    visionWorker = worker;
    visionReady = false;
    worker.addEventListener("message", (event) => handleVisionMessage(event, worker));
    worker.addEventListener("error", (event) => {
      if (visionWorker !== worker) return;
      diagnosticLog.add("worker", `error: ${event.message || "unknown error"}`);
      showVisionDetectorFailure(event.message || "worker error", "worker error");
    });
    diagnosticLog.add("detector", "initializing on page; GPU delegate requested");
    logVisionPipeline();
    clearVisionInitTimeout();
    visionInitTimeout = setTimeout(() => {
      if (visionWorker === worker && !visionReady) showVisionDetectorFailure("initialization timed out", "initialization timeout");
    }, 12000);
    const detector = await createDetector({ delegate: "GPU" });
    // Camera stop/retry can happen while the CDN/model promise is pending.
    if (visionWorker !== worker) {
      detector.close?.();
      return;
    }
    visionDetector = detector;
    worker.postMessage({
      type: "init",
      handedness: dom.hand.value,
      profile: calibrationProfile,
      recognitionOnly: true,
    });
  } catch (error) {
    diagnosticLog.add("worker", `startup failed: ${error?.message || "unknown error"}`);
    showVisionDetectorFailure(error, "startup failed");
  }
}

function queueCameraFrame(generation = cameraGeneration, stream = cameraStream) {
  if (!stream || generation !== cameraGeneration || cameraStream !== stream) return;
  const send = async (now) => {
    if (generation !== cameraGeneration || cameraStream !== stream) return;
    if (canSendVisionFrame({ worker: visionWorker, ready: visionReady, inFlight: frameInFlight, videoReadyState: dom.video.readyState }) && visionDetector) {
      frameInFlight = true;
      logVisionPipeline();
      try {
        const inferenceStarted = performance.now();
        const raw = await visionDetector.detect(dom.video, now);
        const inferenceMs = performance.now() - inferenceStarted;
        const landmarks = Array.isArray(raw?.landmarks?.[0]) ? raw.landmarks[0] : null;
        const handednessList = raw?.handednesses || raw?.handedness;
        const handedness = handednessList?.[0]?.[0] || handednessList?.[0] || null;
        if (generation !== cameraGeneration || cameraStream !== stream || !visionReady || !visionWorker) {
          frameInFlight = false;
          logVisionPipeline();
        } else {
          visionWorker.postMessage({
            type: "replay-frame",
            frame: {
              timestamp: now,
              landmarks,
              handedness: handedness?.categoryName || handedness?.displayName || handedness?.label || null,
              confidence: Number.isFinite(handedness?.score) ? handedness.score : 1,
            },
            metrics: { inferenceMs },
          });
          logVisionPipeline();
        }
      } catch (error) { reportBitmapFailure(error); }
    }
    if (generation === cameraGeneration && cameraStream === stream) queueCameraFrame(generation, stream);
  };
  if (dom.video.requestVideoFrameCallback) dom.video.requestVideoFrameCallback((now) => send(now));
  else cameraLoopHandle = requestAnimationFrame(send);
}

function handleVisionMessage(event, sourceWorker = visionWorker) {
  if (sourceWorker !== visionWorker) return;
  const message = event.data || {};
  if (message.type === "diagnostic") {
    diagnosticLog.state("hand", `count=${message.diagnostic?.hand?.detected ? 1 : 0}`);
    logGestureDiagnostics(message.diagnostic);
    syncVisionHeldNotes(message.diagnostic);
    if (message.diagnostic?.hand?.detected) refreshVisionGateWatchdog();
    updateHandDiagnostics(message.diagnostic);
    updateLiveGestureReadout(message.diagnostic);
    updateGestureStepPose(message.diagnostic);
    return;
  }
  if (message.type === "frame-ready" || message.type === "frame-dropped") { frameInFlight = false; logVisionPipeline(); return; }
  if (message.type === "ready") {
    clearVisionInitTimeout();
    visionReady = message.detectorReady === true;
    diagnosticLog.state("worker", "ready");
    diagnosticLog.state("detector", visionReady ? "ready" : "unavailable");
    logVisionPipeline();
    if (!visionReady) {
      releaseHeldNotes((held) => held.source.startsWith("vision-"));
      disposeVisionWorker("detector unavailable");
      setStatus("VISION ERROR", "error");
      showToast("VISION DETECTOR UNAVAILABLE — RETRY CAMERA", 5000);
      return;
    }
    if (calibrationDraft) visionWorker?.postMessage({ type: "calibration-import", draft: calibrationDraft });
    setStatus(calibrationProfile ? "SIGNAL CONNECTED" : "CALIBRATION REQUIRED", calibrationProfile ? "ok" : "busy");
    return;
  }
  if (message.type === "error") {
    releaseHeldNotes((held) => held.source.startsWith("vision-"));
    diagnosticLog.add("detector", `error: ${message.message || "initialization failed"}`);
    disposeVisionWorker(`detector error: ${message.code || "unknown"}`);
    setStatus("VISION ERROR", "error");
    showToast(message.message || "Vision initialization failed", 5000);
    return;
  }
  if (message.type === "recognition") {
    const payload = message;
    diagnosticLog.add("frame", `inference=${Math.round(payload.metrics?.inferenceMs || 0)}ms; hand=${payload.landmarks ? 1 : 0}`, { key: "frame:summary", throttleMs: 2000 });
    if (payload.landmarks) drawHand(payload.landmarks); else clearHandOverlay();
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

function diagnosticNumber(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "--";
}

function logGestureDiagnostics(diagnostic) {
  if (!diagnostic?.hand?.detected) {
    diagnosticLog.state("pose", "no hand", { key: "gesture:pose" });
    const missingStroke = diagnostic?.downstroke || {};
    diagnosticLog.state("stroke", `state=${missingStroke.state || "unavailable"}; reason=${missingStroke.reason || "no-hand"}; gap=${Math.round(missingStroke.missingMs || 0)}ms`, { key: "gesture:stroke" });
    return;
  }
  const pose = diagnostic.pose || {};
  const stroke = diagnostic.downstroke || {};
  const poseMode = pose.stabilized ? `stable-${pose.stabilizationPhase || "nearest"}` : pose.accepted ? "raw" : "candidate";
  diagnosticLog.state("pose", `digit=${pose.digit ?? "-"}; gate=${pose.accepted ? "ready" : "wait"}; mode=${poseMode}; reason=${pose.rawReason || pose.reason || "unknown"}`, { key: "gesture:pose" });
  diagnosticLog.state("stroke", `state=${stroke.state || "unknown"}; digit=${stroke.lockedDigit ?? stroke.stableDigit ?? "-"}; candidate=${stroke.strikeCandidate ? 1 : 0}`, { key: "gesture:stroke" });
  if (!serialLogExpanded) return;
  diagnosticLog.add("motion", `pose=${diagnosticNumber(pose.distance)}/${diagnosticNumber(pose.effectiveThreshold)} r=${diagnosticNumber(pose.thresholdRatio)} sep=${diagnosticNumber(pose.separation)} view=${diagnosticNumber(pose.viewDistance)}; tilt=${diagnosticNumber(stroke.palmVerticality, 3)} ready≥${diagnosticNumber(stroke.readyVerticality, 2)} hit≤${diagnosticNumber(stroke.hitVerticality, 2)}; y=${diagnosticNumber(diagnostic.palmScreenY, 3)} m=${diagnosticNumber(stroke.filteredY, 3)} v=${diagnosticNumber(stroke.velocity)} d=${diagnosticNumber(stroke.displacement, 3)}; recover=${diagnosticNumber(stroke.recovery, 3)}/${diagnosticNumber(stroke.recoveryThreshold, 3)} frames=${stroke.recoveryFrames || 0}/${stroke.recoveryFramesRequired || "-"} ms=${Math.round(stroke.recoveryMs || 0)}/${stroke.recoveryMsRequired || "-"}; reason=${stroke.reason || "unknown"}`, { key: "gesture:motion", throttleMs: 350 });
}

function updateLiveGestureReadout(diagnostic) {
  const live = resolveLiveGestureDebugState(diagnostic);
  dom.gestureDigit.value = live.digit;
  dom.gestureState.textContent = live.state;
  dom.gestureConfidence.value = live.confidence;
  dom.cameraStage.dataset.gestureKind = live.kind;
}

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
  const touching = entries.filter((state) => state.phase !== "wrong-view" && (state.latched || state.withinThreshold === true));
  const activeContact = touching.slice().sort((left, right) => left.distance - right.distance)[0] || null;
  const confidence = Math.round(clamp(diagnostic.hand?.confidence ?? 0, 0, 1) * 100);
  dom.diagnostics.dataset.state = activeContact ? "contact" : "tracking";
  dom.diagnosticStatus.value = activeContact ? `SIGN ${activeContact.digit} / CONTACT` : `HAND ACQUIRED / ${confidence}%`;

  const pose = diagnostic.pose || {};
  const poseReason = String(pose.reason || "uncertain").replace("outside-calibration", "shape-mismatch");
  dom.diagnosticPose.value = pose.digit
    ? `${pose.accepted ? "SIGN" : "CLOSEST"} ${pose.digit} / ${pose.accepted ? "READY" : poseReason.replaceAll("-", " ").toUpperCase()} ${Math.round(clamp(pose.confidence ?? 0, 0, 1) * 100)}%`
    : String(pose.reason || diagnostic.reason || "TRACKING").replaceAll("-", " ").toUpperCase();
  dom.diagnosticContact.value = activeContact ? `${activeContact.digit} TOUCH Δ${activeContact.distance.toFixed(3)}`
    : nearest ? `NEAR ${nearest.digit} Δ${nearest.distance.toFixed(3)}` : "NO TIP DATA";
  const predictedContact = entries
    .filter((state) => state.phase === "approach")
    .sort((left, right) => (right.intentConfidence || 0) - (left.intentConfidence || 0))[0] || null;
  if (!activeContact && predictedContact) {
    const eta = Number.isFinite(predictedContact.timeToContact) ? ` ${Math.round(predictedContact.timeToContact)}MS` : "";
    dom.diagnosticContact.value = `SIGN ${predictedContact.digit} / APPROACH ${Math.round((predictedContact.intentConfidence || 0) * 100)}%${eta}`;
  }
  const stroke = diagnostic.downstroke || {};
  const forecastVelocity = Number.isFinite(stroke.predictedVelocity) ? ` ->${stroke.predictedVelocity.toFixed(2)}` : "";
  dom.diagnosticStroke.value = `${String(stroke.reason || stroke.state || "UNAVAILABLE").replaceAll("-", " ").toUpperCase()} / V${Number(stroke.velocity || 0).toFixed(2)}${forecastVelocity}`;
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
  3: "Thumb, index, and middle fingers extended; fold the ring and pinky.",
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
    id: "downstroke", label: "SIDE DIPS", glyph: "↓", kind: "downstroke",
    orientation: "KNUCKLES TOWARD CAMERA / UPRIGHT → SIDEWAYS",
    text: "Hold any calibrated 1-5 pose upright, rotate the whole hand sideways, hold briefly, then return upright. Complete at least five full rotations.", durationMs: 10000,
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
  if (data?.completed?.downstroke && data?.strokeFrames?.some((frame) => Number.isFinite(frame?.palmVerticality))) statuses.downstroke = "passed";
  const saved = draft?.uiStatuses;
  if (saved && typeof saved === "object") {
    for (const step of CALIBRATION_STEPS) {
      if (step.id === "downstroke" && !data?.strokeFrames?.some((frame) => Number.isFinite(frame?.palmVerticality))) continue;
      if (["passed", "failed"].includes(saved[step.id])) statuses[step.id] = saved[step.id];
    }
  }
  return statuses;
}

function allPassedStatuses() {
  return Object.fromEntries(CALIBRATION_STEPS.map((step) => [step.id, "passed"]));
}

function statusesFromProfile(profile) {
  const statuses = allPassedStatuses();
  if (profile?.downstroke?.metric !== "palm-tilt") statuses.downstroke = "pending";
  return statuses;
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
    diagnosticLog.add("cal", `capture cancelled: ${step.id}`);
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
  diagnosticLog.add("cal", "calibration opened");
  const statuses = calibrationDraft ? statusesFromDraft(calibrationDraft)
    : calibrationProfile?.valid ? statusesFromProfile(calibrationProfile) : blankCalibrationStatuses();
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
    diagnosticLog.add("cal", "building recognition profile from saved summaries");
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
  diagnosticLog.add("cal", `capture started: ${step.id}`);
  calibrationSession.statuses[step.id] = "capturing";
  dom.calibrationStatus.textContent = "CAPTURING / HOLD STEADY";
  dom.calibrationStatus.dataset.state = "capturing";
  dom.calibrationCount.textContent = "waiting for tracked hand frames";
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
    diagnosticLog.add("cal", `capture timed out: ${step.id}`);
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
  const count = phaseSummary.count || 0;
  const minimum = phaseSummary.minimum || message.latest.minimum || 5;
  dom.calibrationCount.textContent = `${count} tracked / ${minimum} minimum`;
  diagnosticLog.add("cal", `${step.id}: ${count}/${minimum} tracked frames`, { key: `cal-progress:${step.id}`, throttleMs: 1250 });
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
  diagnosticLog.add("cal", `${step.id}: ${passed ? "passed" : "retry required"}`);
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
    diagnosticLog.add("cal", `draft save failed: ${error?.message || "unknown error"}`);
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
  diagnosticLog.add("cal", "unfinished calibration cleared");
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
    diagnosticLog.add("cal", `profile rejected; ${failed || 1} section${failed === 1 ? "" : "s"} need retry${profile?.errors?.length ? `: ${profile.errors.join("; ")}` : ""}`);
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
  diagnosticLog.add("cal", "profile sealed; no images or video stored");
  setStatus("SIGNAL CONNECTED", "ok");
}

function stopTransport() {
  releaseHeldNotes();
  transport?.stop();
  music?.stopAllGroups?.();
  updateTransportPosition(0);
  updatePlayheads(0);
  drawLanes();
  updateLoopPedal();
  markChanged();
}

function toggleLaneRecord(lane = activeLane()) {
  if (!lane) return false;
  releaseHeldNotes();
  transport?.toggleRecord(lane.id);
  project.activeLaneId = lane.id;
  if ((lane.recording || lane.armed) && !lane.overdub) music?.stopGroup?.(lane.id);
  if (lane.recording) showToast(`${lane.name} RECORDING NOW — ONE LOOP PASS`, 4800);
  else if (lane.armed) showToast(`${lane.name} ARMED — ONE LOOP PASS BEGINS AT THE NEXT BAR`, 4800);
  else showToast(`${lane.name} RECORDING STOPPED / LOOP SAVED`);
  drawLanes();
  syncControls();
  markChanged();
  return true;
}

function undoLane(lane = activeLane()) {
  if (!lane || !Array.isArray(lane.undoSnapshot)) {
    showToast(`${lane?.name || "ACTIVE LINE"}: NOTHING TO UNDO`);
    return false;
  }
  releaseHeldNotes((held) => held.laneId === lane.id);
  lane.armed = false;
  lane.recording = false;
  lane.events = lane.undoSnapshot.map((event) => ({ ...event }));
  lane.loopOriginBeat = Number.isFinite(lane.undoLoopOriginBeat) ? lane.undoLoopOriginBeat : lane.loopOriginBeat;
  music?.stopGroup?.(lane.id);
  showToast(`${lane.name}: LAST TAKE UNDONE`);
  markChanged({ renderLanes: true });
  return true;
}

function clearLane(lane = activeLane()) {
  if (!lane) return false;
  releaseHeldNotes((held) => held.laneId === lane.id);
  lane.undoSnapshot = lane.events.map((event) => ({ ...event }));
  lane.undoLoopOriginBeat = lane.loopOriginBeat;
  lane.events = [];
  lane.armed = false;
  lane.recording = false;
  music?.stopGroup?.(lane.id);
  showToast(`${lane.name} CLEARED AND SILENCED`);
  markChanged({ renderLanes: true });
  return true;
}

async function activatePedalRecord() {
  try { await initAudio(); } catch (error) { showToast(error.message || "AUDIO UNAVAILABLE"); return; }
  toggleLaneRecord(activeLane());
}

async function activatePedalTransport() {
  try { await initAudio(); } catch (error) { showToast(error.message || "AUDIO UNAVAILABLE"); return; }
  if (transport.playing) stopTransport();
  else transport.start();
  updateLoopPedal();
}

function setPedalPressed(action, pressed) {
  const button = action === "record" ? dom.pedalRecord : action === "transport" ? dom.pedalTransport : dom.pedalUndo;
  button?.classList.toggle("is-pressed", Boolean(pressed));
}

function beginPedalUndoHold() {
  if (pedalHold) return;
  const lane = activeLane();
  if (!lane) return;
  pedalHold = { laneId: lane.id, cleared: false, timer: 0 };
  pedalHold.timer = setTimeout(() => {
    if (!pedalHold) return;
    const heldLane = project.lanes.find((item) => item.id === pedalHold.laneId);
    pedalHold.cleared = true;
    clearLane(heldLane);
    updateLoopPedal();
  }, LOOP_PEDAL_CLEAR_HOLD_MS);
  setPedalPressed("undo", true);
  updateLoopPedal();
}

function finishPedalUndoHold({ undoIfShort = true } = {}) {
  if (!pedalHold) return false;
  const finished = pedalHold;
  clearTimeout(finished.timer);
  pedalHold = null;
  setPedalPressed("undo", false);
  if (undoIfShort && !finished.cleared) {
    const heldLane = project.lanes.find((item) => item.id === finished.laneId);
    undoLane(heldLane);
  }
  updateLoopPedal();
  return true;
}

function clickActiveLaneControl(selector) {
  const row = $$(".loop-lane", dom.lanes).find((item) => item.dataset.laneId === activeLane()?.id);
  if (row) $(selector, row)?.click();
}

function isEditableTarget(target) {
  return Boolean(target?.closest?.("input,select,textarea,[contenteditable]:not([contenteditable='false']),[role='textbox'],[role='combobox']"));
}

async function copyDiagnosticLog() {
  const text = diagnosticLog.text();
  if (!text) { showToast("DIAGNOSTIC LOG IS EMPTY"); return; }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const copyField = document.createElement("textarea");
    copyField.value = text;
    copyField.style.cssText = "left:-9999px;position:fixed;top:0;";
    document.body.append(copyField);
    copyField.select();
    const copied = document.execCommand("copy");
    copyField.remove();
    if (!copied) { showToast("COPY FAILED — SELECT THE LOG MANUALLY", 4200); return; }
  }
  showToast("LOCAL DIAGNOSTIC LOG COPIED");
}

function setVisualizerMaximized(enabled) {
  const panel = $(".visualizer-panel");
  const active = Boolean(enabled && panel);
  panel?.classList.toggle("is-maximized", active);
  document.body.classList.toggle("visualizer-maximized", active);
  dom.maxVisual?.setAttribute("aria-pressed", String(active));
  if (dom.maxVisual) dom.maxVisual.textContent = active ? "RESTORE" : "MAXIMIZE";
  requestAnimationFrame(() => visualizer?.resize());
}

async function toggleVisualizerFullscreen() {
  const panel = $(".visualizer-panel");
  if (!panel?.requestFullscreen) {
    showToast("NATIVE FULLSCREEN IS NOT AVAILABLE IN THIS BROWSER", 3600);
    return;
  }
  const wasMaximized = document.body.classList.contains("visualizer-maximized");
  try {
    if (document.fullscreenElement === panel) await document.exitFullscreen();
    else {
      setVisualizerMaximized(false);
      await panel.requestFullscreen();
    }
  } catch (error) {
    if (wasMaximized) setVisualizerMaximized(true);
    showToast(`FULLSCREEN FAILED: ${error?.message || "REQUEST REJECTED"}`, 4200);
  }
}

function wireEvents() {
  dom.start.addEventListener("click", async () => {
    dom.start.disabled = true;
    // Start the Web Audio unlock inside the actual click task, but never make
    // the workstation UI conditional on a browser-owned resume promise.
    const audioReady = initAudio({ timeoutMs: 1400 });
    dom.boot.hidden = true;
    dom.workstation.hidden = false;
    visualizer?.resize();
    startCamera().catch((error) => { showToast(error.message, 5000); stopCamera(); });
    try {
      await audioReady;
    } catch (error) {
      showToast(`${error.message} — PRESS PLAY OR A NOTE TO RETRY`, 6200);
    } finally {
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
  dom.noteOrder.addEventListener("change", () => {
    releaseHeldNotes();
    project.tonalScene.noteOrder = dom.noteOrder.value;
    showToast(dom.noteOrder.value === "descending" ? "NOTE ORDER: 9 LOW → 1 HIGH" : "NOTE ORDER: 1 LOW → 9 HIGH");
    markChanged({ renderMap: true });
  });
  for (const input of [dom.master, dom.sub, dom.grit, dom.reverb]) input.addEventListener("input", () => { project.master.volume = Number(dom.master.value); project.master.subBoost = Number(dom.sub.value); project.master.distortion = Number(dom.grit.value); project.master.reverb = Number(dom.reverb.value); updateFaderOutputs(); applyMasterSettings(); markChanged(); });
  dom.generate.addEventListener("click", generateIntoActiveLane);
  for (const row of $$(".focused-roll-row", dom.focusedRoll)) {
    $(".focused-roll-key", row).addEventListener("click", () => triggerHit({ digit: Number(row.dataset.digit), velocity: 0.78, confidence: 1, source: "piano-key" }));
    $(".focused-roll-track", row).addEventListener("click", addFocusedGridNote);
  }
  dom.focusedRecord.addEventListener("click", () => clickActiveLaneControl(".lane-record"));
  dom.stepInput?.addEventListener("click", () => {
    project.ui.stepInput = !project.ui.stepInput;
    dom.stepInput.setAttribute("aria-pressed", String(project.ui.stepInput));
    showToast(`GESTURE STEP INPUT ${project.ui.stepInput ? "ON" : "OFF"}`);
    markChanged();
  });
  dom.recordNext?.addEventListener("click", recordThenSpawn);
  dom.focusedOverdub.addEventListener("click", () => clickActiveLaneControl(".lane-overdub"));
  dom.focusedMute.addEventListener("click", () => clickActiveLaneControl(".lane-mute"));
  dom.focusedSolo.addEventListener("click", () => clickActiveLaneControl(".lane-solo"));
  dom.focusedClear.addEventListener("click", () => clickActiveLaneControl(".lane-clear"));
  dom.pedalRecord?.addEventListener("click", activatePedalRecord);
  dom.pedalTransport?.addEventListener("click", activatePedalTransport);
  dom.pedalUndo?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginPedalUndoHold();
  });
  dom.pedalUndo?.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    finishPedalUndoHold();
  });
  dom.pedalUndo?.addEventListener("pointercancel", () => finishPedalUndoHold({ undoIfShort: false }));
  dom.pedalUndo?.addEventListener("click", (event) => {
    // Pointer interaction is resolved on pointerup so a hold can be measured.
    // A zero-detail click is keyboard/switch activation and is a short undo.
    if (event.detail === 0 && !pedalHold) undoLane(activeLane());
  });
  dom.exportProject.addEventListener("click", exportProjectFile);
  dom.restoreProject.addEventListener("click", () => {
    dom.restoreProjectFile.value = "";
    dom.restoreProjectFile.click();
  });
  dom.restoreProjectFile.addEventListener("change", restoreProjectFromFile);
  dom.export.addEventListener("click", exportWav);
  dom.cameraToggle.addEventListener("click", () => {
    if (dom.cameraToggle.dataset.mode === "retry" && cameraStream && !visionWorker) {
      dom.cameraMessage.hidden = true;
      dom.cameraToggle.textContent = "CAMERA ON";
      dom.cameraToggle.dataset.mode = "stop";
      diagnosticLog.add("detector", "manual retry requested");
      setStatus("INITIALIZING VISION", "busy");
      initVisionWorker();
      return;
    }
    startCamera().catch((error) => showToast(error.message, 5000));
  });
  dom.serialLogCopy?.addEventListener("click", copyDiagnosticLog);
  dom.serialLogClear?.addEventListener("click", () => { diagnosticLog.clear(); showToast("DIAGNOSTIC LOG CLEARED"); });
  dom.serialLogToggle?.addEventListener("click", () => setSerialLogExpanded(!serialLogExpanded));
  dom.hand.addEventListener("change", async () => {
    visionWorker?.postMessage({ type: "handedness", handedness: dom.hand.value });
    diagnosticLog.add("detector", `preferred hand set to ${dom.hand.value.toUpperCase()}`);
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
  dom.calibrationButton.addEventListener("click", () => { finishPedalUndoHold({ undoIfShort: false }); openCalibration(); });
  dom.calibrationDialog.addEventListener("close", closeCalibrationSession);
  dom.calibrationNext.addEventListener("click", captureCalibrationStep);
  dom.calibrationBack.addEventListener("click", () => { if (calibrationSession?.step > 0) { calibrationSession.step -= 1; renderCalibrationStep(); } });
  dom.calibrationReset.addEventListener("click", resetCalibrationProgress);
  for (const button of $$(".visual-mode")) button.addEventListener("click", () => { $$(".visual-mode").forEach((item) => item.classList.remove("active")); button.classList.add("active"); visualizer?.setMode(button.dataset.mode); project.ui.visualizerMode = button.dataset.mode; markChanged(); });
  dom.maxVisual?.addEventListener("click", async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    setVisualizerMaximized(!document.body.classList.contains("visualizer-maximized"));
  });
  dom.fullVisual.addEventListener("click", toggleVisualizerFullscreen);
  document.addEventListener("fullscreenchange", () => {
    const active = document.fullscreenElement === $(".visualizer-panel");
    dom.fullVisual.setAttribute("aria-pressed", String(active));
    dom.fullVisual.textContent = active ? "EXIT FULLSCREEN" : "FULLSCREEN";
    requestAnimationFrame(() => visualizer?.resize());
  });
  dom.captureAudio.addEventListener("click", toggleSystemAudioCapture);
  dom.reduceMotion.addEventListener("click", () => { project.ui.reducedMotion = !project.ui.reducedMotion; dom.reduceMotion.setAttribute("aria-pressed", String(project.ui.reducedMotion)); document.body.classList.toggle("reduced-motion", project.ui.reducedMotion); visualizer?.setReducedMotion(project.ui.reducedMotion); markChanged(); });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("visualizer-maximized")) {
      event.preventDefault();
      setVisualizerMaximized(false);
      return;
    }
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    if (event.ctrlKey || event.altKey || event.metaKey || dom.calibrationDialog.open || !dom.boot.hidden) return;
    const pedalAction = loopPedalActionFromKeyEvent(event);
    if (pedalAction) {
      event.preventDefault();
      if (event.repeat || pedalKeysDown.has(pedalAction)) return;
      pedalKeysDown.add(pedalAction);
      setPedalPressed(pedalAction, true);
      if (pedalAction === "record") activatePedalRecord();
      else if (pedalAction === "transport") activatePedalTransport();
      else beginPedalUndoHold();
      return;
    }
    if (event.repeat) return;
    if (event.code === "Space" && !event.target?.matches?.("button")) { event.preventDefault(); transport?.playing ? stopTransport() : transport?.start(); return; }
    if (event.code === "KeyN") { event.preventDefault(); recordThenSpawn(); return; }
    const digit = digitFromKeyEvent(event);
    if (!digit) return;
    event.preventDefault();
    beginHeldNote({ gateId: `keyboard:${event.code || event.key}`, digit, velocity: 0.78, confidence: 1, source: "keyboard" });
  });
  window.addEventListener("keyup", (event) => {
    const pedalAction = loopPedalActionFromKeyEvent(event);
    if (pedalAction && pedalKeysDown.has(pedalAction)) {
      event.preventDefault();
      pedalKeysDown.delete(pedalAction);
      setPedalPressed(pedalAction, false);
      if (pedalAction === "undo") finishPedalUndoHold();
      return;
    }
    const gateId = `keyboard:${event.code || event.key}`;
    if (!heldNotes.has(gateId)) return;
    event.preventDefault();
    endHeldNote(gateId);
  });
  window.addEventListener("blur", () => {
    pedalKeysDown.clear();
    for (const action of ["record", "transport", "undo"]) setPedalPressed(action, false);
    finishPedalUndoHold({ undoIfShort: false });
    releaseHeldNotes((held) => held.source === "keyboard");
  });
  window.addEventListener("beforeunload", () => { releaseHeldNotes(); if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop()); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { pedalKeysDown.clear(); finishPedalUndoHold({ undoIfShort: false }); releaseHeldNotes(); frameInFlight = false; visionWorker?.postMessage({ type: "reset" }); } });
}

populateControls();
drawLanes();
drawFocusedLane();
wireEvents();
updateLoopPedal();
document.body.classList.toggle("reduced-motion", project.ui.reducedMotion);
dom.reduceMotion.setAttribute("aria-pressed", String(project.ui.reducedMotion));
