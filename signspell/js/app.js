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
} from "./music/index.js";
import { LoopTransport } from "./looper.js";
import { BEATS_PER_BAR, clamp, normalizeProject, quantizeBeat, sanitizeBpm } from "./shared.js";
import { createAutosaver, loadCalibration, loadProject, saveCalibration, saveProject } from "./storage.js";
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
  video: $("#camera-feed"), overlay: $("#hand-overlay"), cameraMessage: $("#camera-message"), cameraToggle: $("#camera-toggle"), hand: $("#handedness-select"),
  gestureDigit: $("#gesture-digit"), gestureState: $("#gesture-state"), gestureConfidence: $("#gesture-confidence"), latency: $("#latency-readout"),
  play: $("#transport-play"), stop: $("#transport-stop"), bpm: $("#bpm-input"), tap: $("#tap-tempo"), quantization: $("#quantization-select"), position: $("#transport-position"),
  collection: $("#collection-select"), instrument: $("#instrument-select"), root: $("#root-select"), gamma: $("#gamma-select"), harmony: $("#harmony-select"), gestureMap: $("#gesture-map"),
  master: $("#master-volume"), sub: $("#sub-boost"), grit: $("#distortion"), generate: $("#generate-loop"), lanes: $("#loop-lanes"), laneTemplate: $("#lane-template"),
  export: $("#export-wav"), visualCanvas: $("#visualizer-canvas"), visualLabel: $("#visualizer-label"), fullVisual: $("#fullscreen-visualizer"), reduceMotion: $("#reduced-motion"),
  calibrationButton: $("#calibrate-button"), calibrationDialog: $("#calibration-dialog"), calibrationHeading: $("#calibration-heading"), calibrationInstruction: $("#calibration-instruction"), calibrationGlyph: $("#calibration-glyph"), calibrationProgress: $("#calibration-progress"), calibrationBack: $("#calibration-back"), calibrationNext: $("#calibration-next"),
};

let project = normalizeProject(await loadProject());
let audioContext = null;
let music = null;
let analyser = null;
let visualizer = null;
let transport = null;
let cameraStream = null;
let visionWorker = null;
let frameInFlight = false;
let cameraLoopHandle = 0;
let calibrationProfile = await loadCalibration();
let calibrationSession = null;
let lastHitAt = 0;
let toastTimer = 0;
let tapTimes = [];

const autosave = createAutosaver(async (next) => {
  project = await saveProject(next);
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
  if (renderLanes) drawLanes();
  if (renderMap) drawGestureMap();
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

function triggerHit(hit) {
  const now = performance.now();
  if (!music || now - lastHitAt < 28) return;
  lastHitAt = now;
  const lane = activeLane();
  try {
    const mapped = music.triggerGesture({
      instrument: lane.instrumentFamily,
      collectionId: lane.collectionId,
      gesture: Number(hit.digit),
      scene: scene(),
      bar: transport ? Math.floor(transport.currentBeat() / BEATS_PER_BAR) : 0,
      velocity: clamp(hit.velocity ?? 0.78, 0.05, 1),
      durationBeat: lane.instrumentFamily === "pad" ? 1.5 : lane.instrumentFamily === "808" ? 0.75 : 0.32,
    });
    transport?.captureHit({ ...hit, digit: Number(hit.digit), velocity: mapped.velocity, duration: lane.instrumentFamily === "pad" ? 1.5 : 0.32 });
    flashGesture(hit);
    drawLanes();
    markChanged();
  } catch (error) {
    showToast(error.message);
  }
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
    row.classList.toggle("recording", lane.recording);
    row.classList.toggle("armed", lane.armed);
    $(".lane-number", row).textContent = String(index + 1).padStart(2, "0");
    $(".lane-name", row).textContent = lane.name;
    $(".lane-instrument", row).textContent = `${VIBE_COLLECTIONS[lane.collectionId]?.title || "CUSTOM"} / ${INSTRUMENTS[lane.instrumentFamily]?.label || lane.instrumentFamily}`;
    const record = $(".lane-record", row); record.classList.toggle("active", lane.armed || lane.recording); record.title = lane.recording ? "Stop recording" : "Arm for next bar";
    const overdub = $(".lane-overdub", row); overdub.classList.toggle("active", lane.overdub);
    const mute = $(".lane-mute", row); mute.classList.toggle("active", lane.muted);
    const solo = $(".lane-solo", row); solo.classList.toggle("active", lane.solo);
    const length = $(".lane-length select", row); length.value = lane.lengthBars;
    const gain = $(".lane-gain", row); gain.value = lane.gain;
    const eventArea = $(".lane-events", row);
    drawLaneEvents(eventArea, lane);
    $(".lane-select", row).addEventListener("click", () => selectLane(lane.id));
    record.addEventListener("click", () => { transport?.toggleRecord(lane.id); project.activeLaneId = lane.id; drawLanes(); syncControls(); markChanged(); });
    overdub.addEventListener("click", () => { lane.overdub = !lane.overdub; markChanged({ renderLanes: true }); });
    mute.addEventListener("click", () => { lane.muted = !lane.muted; markChanged({ renderLanes: true }); });
    solo.addEventListener("click", () => { lane.solo = !lane.solo; markChanged({ renderLanes: true }); });
    length.addEventListener("change", () => { lane.lengthBars = Number(length.value); lane.events = lane.events.filter((item) => item.beat < lane.lengthBars * BEATS_PER_BAR); markChanged({ renderLanes: true }); });
    gain.addEventListener("input", () => { lane.gain = Number(gain.value); markChanged(); });
    $(".lane-undo", row).addEventListener("click", () => { if (Array.isArray(lane.undoSnapshot)) { lane.events = lane.undoSnapshot.map((event) => ({ ...event })); markChanged({ renderLanes: true }); } });
    $(".lane-clear", row).addEventListener("click", () => { lane.undoSnapshot = lane.events.map((event) => ({ ...event })); lane.events = []; markChanged({ renderLanes: true }); });
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
    node.title = `Sign ${event.digit} · beat ${event.beat.toFixed(2)} · velocity ${Math.round(event.velocity * 100)}`;
    node.addEventListener("pointerdown", (pointerEvent) => beginEventDrag(pointerEvent, area, lane, event));
    node.addEventListener("keydown", (keyboardEvent) => editEventWithKeyboard(keyboardEvent, lane, event));
    area.append(node);
  }
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
  markChanged({ renderLanes: true });
}

function selectLane(laneId) {
  project.activeLaneId = laneId;
  drawLanes();
  syncControls();
  markChanged();
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
    const percent = ((beat % (lane.lengthBars * BEATS_PER_BAR)) / (lane.lengthBars * BEATS_PER_BAR)) * 100;
    const playhead = $(".lane-playhead", row);
    if (playhead) playhead.style.left = `${percent}%`;
  }
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
    bpm: collection.tonal.bpm,
  };
  syncControls();
  markChanged({ renderLanes: true, renderMap: true });
}

function generateIntoActiveLane() {
  const lane = activeLane();
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
  showToast(`${lane.name}: ${source.events.length} ORIGINAL EVENTS CONJURED`);
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
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 60, min: 24 } }, audio: false });
  dom.video.srcObject = cameraStream;
  await dom.video.play();
  dom.cameraMessage.hidden = true;
  dom.cameraToggle.textContent = "CAMERA ON";
  setStatus("INITIALIZING VISION", "busy");
  initVisionWorker();
  queueCameraFrame();
}

function stopCamera() {
  cancelAnimationFrame(cameraLoopHandle);
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  dom.video.srcObject = null;
  dom.cameraMessage.hidden = false;
  dom.cameraMessage.textContent = "Camera offline. Keyboard digits remain playable.";
  dom.cameraToggle.textContent = "CAMERA OFF";
  setStatus("CAMERA DORMANT", "idle");
}

function initVisionWorker() {
  if (visionWorker) return;
  try {
    visionWorker = new Worker("js/vision/vision-worker.js", { type: "module" });
    visionWorker.addEventListener("message", handleVisionMessage);
    visionWorker.addEventListener("error", (event) => { frameInFlight = false; showToast(`VISION WORKER: ${event.message}`); });
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

function queueCameraFrame() {
  if (!cameraStream) return;
  const send = async (now) => {
    if (!frameInFlight && visionWorker && dom.video.readyState >= 2) {
      frameInFlight = true;
      try {
        const bitmap = await createImageBitmap(dom.video);
        visionWorker.postMessage({ type: "frame", frame: bitmap, timestamp: now }, [bitmap]);
      } catch { frameInFlight = false; }
    }
    queueCameraFrame();
  };
  if (dom.video.requestVideoFrameCallback) dom.video.requestVideoFrameCallback((now) => send(now));
  else cameraLoopHandle = requestAnimationFrame(send);
}

function handleVisionMessage(event) {
  const message = event.data || {};
  if (message.type === "frame-ready" || message.type === "frame-dropped") { frameInFlight = false; return; }
  if (message.type === "ready") {
    setStatus(calibrationProfile ? "SIGNAL CONNECTED" : "CALIBRATION REQUIRED", calibrationProfile ? "ok" : "busy");
    return;
  }
  if (message.type === "error") {
    frameInFlight = false;
    setStatus("VISION ERROR", "error");
    showToast(message.message || "Vision initialization failed", 5000);
    return;
  }
  if (message.type === "recognition") {
    const payload = message;
    if (payload.landmarks) drawHand(payload.landmarks);
    const confidence = payload.confidence ?? payload.diagnostics?.pose?.confidence ?? 0;
    dom.gestureConfidence.value = clamp(confidence, 0, 1);
    dom.gestureState.textContent = payload.diagnostics?.reason || payload.diagnostics?.downstroke?.state || (payload.landmarks ? "TRACKING" : "NO HAND");
    if (payload.hit) triggerHit(payload.hit);
    if (payload.metrics) dom.latency.textContent = `VISION ${Math.round(payload.metrics.inferenceMs || 0)}ms / AUDIO ${Math.round((audioContext?.baseLatency || 0) * 1000)}ms`;
    if (calibrationSession && payload.calibrationSample) acceptCalibrationSample(payload.calibrationSample);
  }
  if (message.type === "hit") triggerHit(message.hit);
  if (message.type === "calibration-profile") completeCalibration(message.profile);
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

function openCalibration() {
  calibrationSession = { step: 0, samples: [] };
  dom.calibrationNext.dataset.action = "capture";
  dom.calibrationProgress.value = 0;
  renderCalibrationStep();
  dom.calibrationDialog.showModal();
}

const CALIBRATION_STEPS = [
  { glyph: "REST", text: "Hold your selected hand relaxed and centered for two seconds." },
  ...[1,2,3,4,5].map((digit) => ({ glyph: String(digit), text: `Hold number pose ${digit} steady. Keep the palm visible.` })),
  ...[6,7,8,9].map((digit) => ({ glyph: String(digit), text: `Touch and release the finger for ${digit} several times.` })),
  { glyph: "↓", text: "Make ten comfortable downward strokes while holding poses 1–5." },
];

function renderCalibrationStep() {
  const step = CALIBRATION_STEPS[calibrationSession?.step || 0];
  dom.calibrationHeading.textContent = `CALIBRATION ${String((calibrationSession?.step || 0) + 1).padStart(2, "0")} / ${CALIBRATION_STEPS.length}`;
  dom.calibrationInstruction.textContent = step.text;
  dom.calibrationGlyph.textContent = step.glyph;
  dom.calibrationProgress.value = ((calibrationSession?.step || 0) / CALIBRATION_STEPS.length) * 100;
  dom.calibrationNext.textContent = calibrationSession?.step ? "CAPTURE" : "BEGIN";
}

function captureCalibrationStep() {
  if (dom.calibrationNext.dataset.action === "done") { dom.calibrationDialog.close(); return; }
  if (dom.calibrationNext.dataset.action === "restart") {
    calibrationSession = { step: 0, samples: [] };
    dom.calibrationNext.dataset.action = "capture";
    renderCalibrationStep();
    return;
  }
  if (!visionWorker) { showToast("START THE CAMERA BEFORE CALIBRATING"); return; }
  const step = CALIBRATION_STEPS[calibrationSession.step];
  dom.calibrationNext.disabled = true;
  dom.calibrationInstruction.textContent = `${step.text} Capturing…`;
  visionWorker.postMessage({ type: "calibration-capture", step: calibrationSession.step, glyph: step.glyph, durationMs: step.glyph === "↓" ? 5000 : 1800 });
  setTimeout(() => {
    if (!calibrationSession) return;
    calibrationSession.step += 1;
    dom.calibrationNext.disabled = false;
    if (calibrationSession.step >= CALIBRATION_STEPS.length) {
      dom.calibrationInstruction.textContent = "Building your private landmark profile…";
      visionWorker.postMessage({ type: "calibration-build", handedness: dom.hand.value });
    } else renderCalibrationStep();
  }, step.glyph === "↓" ? 5200 : 2000);
}

function acceptCalibrationSample(sample) {
  calibrationSession?.samples.push(sample);
}

async function completeCalibration(profile) {
  if (!profile?.valid) {
    dom.calibrationInstruction.textContent = `Calibration needs another pass: ${(profile?.errors || ["insufficient clean samples"]).join("; ")}`;
    dom.calibrationNext.disabled = false;
    dom.calibrationNext.textContent = "RESTART";
    dom.calibrationNext.dataset.action = "restart";
    return;
  }
  calibrationProfile = await saveCalibration(profile);
  visionWorker?.postMessage({ type: "set-profile", profile: calibrationProfile });
  calibrationSession = null;
  dom.calibrationProgress.value = 100;
  dom.calibrationInstruction.textContent = "Profile sealed. No images or video were stored.";
  dom.calibrationNext.disabled = false;
  dom.calibrationNext.textContent = "DONE";
  dom.calibrationNext.dataset.action = "done";
  setStatus("SIGNAL CONNECTED", "ok");
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
  dom.stop.addEventListener("click", () => { transport?.stop(); updateTransportPosition(0); updatePlayheads(0); drawLanes(); markChanged(); });
  dom.bpm.addEventListener("change", () => { project.tonalScene.bpm = sanitizeBpm(dom.bpm.value); dom.bpm.value = project.tonalScene.bpm; transport?.setProject(project); markChanged(); });
  dom.tap.addEventListener("click", () => { const now = performance.now(); tapTimes = [...tapTimes.filter((time) => now - time < 2500), now].slice(-5); if (tapTimes.length > 1) { const intervals = tapTimes.slice(1).map((time, index) => time - tapTimes[index]); project.tonalScene.bpm = sanitizeBpm(60000 / (intervals.reduce((a,b) => a + b, 0) / intervals.length)); dom.bpm.value = project.tonalScene.bpm; markChanged(); } });
  dom.quantization.addEventListener("change", () => { project.quantization = dom.quantization.value; markChanged(); });
  dom.collection.addEventListener("change", () => applyCollection(dom.collection.value));
  dom.instrument.addEventListener("change", () => { activeLane().instrumentFamily = dom.instrument.value; markChanged({ renderLanes: true, renderMap: true }); });
  dom.root.addEventListener("change", () => { project.tonalScene.root = dom.root.value; markChanged({ renderMap: true }); });
  dom.gamma.addEventListener("change", () => { project.tonalScene.gamma = dom.gamma.value; markChanged({ renderMap: true }); });
  dom.harmony.addEventListener("change", () => { project.tonalScene.harmonyMode = dom.harmony.value; markChanged({ renderMap: true }); });
  for (const input of [dom.master, dom.sub, dom.grit]) input.addEventListener("input", () => { project.master.volume = Number(dom.master.value); project.master.subBoost = Number(dom.sub.value); project.master.distortion = Number(dom.grit.value); updateFaderOutputs(); applyMasterSettings(); markChanged(); });
  dom.generate.addEventListener("click", generateIntoActiveLane);
  dom.export.addEventListener("click", exportWav);
  dom.cameraToggle.addEventListener("click", () => startCamera().catch((error) => showToast(error.message, 5000)));
  dom.hand.addEventListener("change", () => visionWorker?.postMessage({ type: "handedness", handedness: dom.hand.value }));
  dom.calibrationButton.addEventListener("click", openCalibration);
  dom.calibrationNext.addEventListener("click", captureCalibrationStep);
  dom.calibrationBack.addEventListener("click", () => { if (calibrationSession?.step > 0) { calibrationSession.step -= 1; renderCalibrationStep(); } });
  for (const button of $$(".visual-mode")) button.addEventListener("click", () => { $$(".visual-mode").forEach((item) => item.classList.remove("active")); button.classList.add("active"); visualizer?.setMode(button.dataset.mode); project.ui.visualizerMode = button.dataset.mode; markChanged(); });
  dom.fullVisual.addEventListener("click", () => $(".visualizer-panel")?.requestFullscreen?.());
  dom.reduceMotion.addEventListener("click", () => { project.ui.reducedMotion = !project.ui.reducedMotion; dom.reduceMotion.setAttribute("aria-pressed", String(project.ui.reducedMotion)); document.body.classList.toggle("reduced-motion", project.ui.reducedMotion); visualizer?.setReducedMotion(project.ui.reducedMotion); markChanged(); });
  window.addEventListener("keydown", (event) => { if (event.repeat || event.target.matches("input,select,textarea,button")) return; const digit = Number(event.key); if (digit >= 1 && digit <= 9) triggerHit({ digit, velocity: 0.78, confidence: 1, source: "keyboard" }); if (event.code === "Space") { event.preventDefault(); transport?.playing ? transport.stop() : transport?.start(); } });
  window.addEventListener("beforeunload", () => { if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop()); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { frameInFlight = false; visionWorker?.postMessage({ type: "reset" }); } });
}

populateControls();
drawLanes();
wireEvents();
document.body.classList.toggle("reduced-motion", project.ui.reducedMotion);
dom.reduceMotion.setAttribute("aria-pressed", String(project.ui.reducedMotion));
