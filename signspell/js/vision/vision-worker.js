import { SignSpellRecognizer } from "./recognizer.js?v=2";
import { buildCalibrationProfile } from "./calibration.js?v=2";
import { contactDistances, normalizeLandmarks, poseFeatures } from "./landmarks.js?v=2";

/**
 * Worker protocol for app integration:
 *
 * Main -> worker
 * - `init`: `{ detectorConfig?, profile? }`; detectorConfig is optional for
 *   replay-only usage and otherwise is `{ moduleUrl, exportName?, options? }`.
 * - `set-profile`: `{ profile }`
 * - `frame`: `{ timestamp, frame }`, only after a `frame-ready` response.
 * - `replay-frame`: `{ frame: { timestamp, landmarks, handedness?, confidence? } }`
 * - `calibration-capture`: `{ step, glyph, durationMs, phase?, reset? }`,
 *   where `phase` is `open` or `closed` for deliberate 6–9 contact passes.
 * - `calibration-export` / `calibration-import`: JSON-only draft handoff.
 * - `reset` / `dispose`
 *
 * Worker -> main
 * - `ready`, `frame-ready`, `recognition`, `hit`, `calibration-sample`,
 *   `calibration-progress`, `calibration-draft`, or `error`.
 *
 * The externally supplied adapter module must export `createDetector(options)`
 * (or configured exportName) and return `{ detect(frame, timestamp) }` or
 * `{ detectForVideo(frame, timestamp) }`. Its result may use MediaPipe web
 * `landmarks`/`handedness` arrays or a single `landmarks` array. This keeps
 * MediaPipe package/version wiring outside this subsystem.
 */

function firstHand(result) {
  if (!result) return null;
  const landmarks = Array.isArray(result.landmarks?.[0]) ? result.landmarks[0]
    : Array.isArray(result.handLandmarks?.[0]) ? result.handLandmarks[0]
      : Array.isArray(result.landmarks) ? result.landmarks : null;
  if (!landmarks) return null;
  const handednessEntry = Array.isArray(result.handedness?.[0]) ? result.handedness[0][0] : result.handedness?.[0];
  return {
    landmarks,
    handedness: handednessEntry?.categoryName || handednessEntry?.displayName || handednessEntry?.label || null,
    confidence: Number.isFinite(handednessEntry?.score) ? handednessEntry.score : 1,
  };
}

async function defaultLoadDetector(config) {
  if (!config?.moduleUrl) return null;
  const module = await import(config.moduleUrl);
  const factory = module[config.exportName || "createDetector"];
  if (typeof factory !== "function") throw new Error("Detector adapter must export createDetector(options)");
  return factory(config.options || {});
}

export function createVisionWorkerController({ postMessage, loadDetector = defaultLoadDetector } = {}) {
  if (typeof postMessage !== "function") throw new Error("createVisionWorkerController requires postMessage");
  let recognizer = new SignSpellRecognizer();
  let detector = null;
  let busy = false;
  let disposed = false;
  let selectedHandedness = "right";
  let calibrationCapture = null;
  let calibrationFrames = [];
  let calibrationData = freshCalibrationData();

  function freshCalibrationData() {
    return {
      poseSamples: { 1: [], 2: [], 3: [], 4: [], 5: [] },
      contactSamples: {
        6: { values: [], open: [], closed: [] }, 7: { values: [], open: [], closed: [] },
        8: { values: [], open: [], closed: [] }, 9: { values: [], open: [], closed: [] },
      },
      strokeFrames: [],
      completed: { pose: {}, contact: {}, downstroke: false },
    };
  }

  const emit = (type, payload = {}, transfer = undefined) => postMessage({ type, ...payload }, transfer);
  const emitFrameReady = () => emit("frame-ready");
  const derivedStrokeTrials = () => {
    const trials = [];
    const frames = calibrationData.strokeFrames;
    for (let index = 3; index < frames.length; index += 1) {
      const start = frames[index - 3], end = frames[index];
      const dt = (end.timestamp - start.timestamp) / 1000;
      const displacement = end.palmY - start.palmY;
      if (dt > 0 && displacement > 0.012) trials.push({ strokeVelocity: displacement / dt, displacement, restVelocity: 0.02 });
    }
    return trials;
  };
  const calibrationDraft = () => ({
    schemaVersion: 1,
    handedness: selectedHandedness,
    data: calibrationData,
  });
  const isDraft = (draft) => Boolean(draft
    && draft.schemaVersion === 1
    && draft.data?.poseSamples
    && draft.data?.contactSamples
    && Array.isArray(draft.data?.strokeFrames));
  const summarizeCapture = (glyph) => {
    if (/^[1-5]$/.test(glyph)) {
      const count = calibrationData.poseSamples[glyph].length;
      calibrationData.completed.pose[glyph] = count >= 5;
      return { kind: "pose", glyph, count, complete: count >= 5, minimum: 5 };
    }
    if (/^[6-9]$/.test(glyph)) {
      const samples = calibrationData.contactSamples[glyph];
      const open = samples.open.length;
      const closed = samples.closed.length;
      const count = samples.values.length;
      // When phases are provided, require both. The legacy single-pass mode
      // remains available for callers that show touch-and-release together.
      const phased = open > 0 || closed > 0;
      const complete = phased ? open >= 5 && closed >= 5 : count >= 10;
      calibrationData.completed.contact[glyph] = complete;
      return {
        kind: "contact", glyph, count, complete, minimum: phased ? 5 : 10,
        phases: { open: { count: open, complete: open >= 5 }, closed: { count: closed, complete: closed >= 5 } },
      };
    }
    if (glyph === "↓") {
      const count = derivedStrokeTrials().length;
      calibrationData.completed.downstroke = count >= 5;
      return { kind: "downstroke", glyph, count, complete: count >= 5, minimum: 5 };
    }
    return { kind: "rest", glyph, count: 0, complete: true, minimum: 0 };
  };
  const finishCalibrationCapture = () => {
    if (!calibrationCapture) return;
    const finished = calibrationCapture;
    calibrationCapture = null;
    const summary = summarizeCapture(finished.glyph);
    emit("calibration-sample", { step: finished.step, glyph: finished.glyph, frames: calibrationFrames.length, summary });
    emit("calibration-progress", { completed: calibrationData.completed, latest: summary });
    calibrationFrames = [];
  };
  const collectCalibration = (frame) => {
    // Incoming media timestamps are allowed to use a different epoch than a
    // worker. Capture lifetime must use the worker clock, otherwise a valid
    // capture can end before its first frame and force a pointless restart.
    if (!calibrationCapture || performance.now() > calibrationCapture.until) {
      finishCalibrationCapture();
      return;
    }
    const normalized = normalizeLandmarks(frame.landmarks, selectedHandedness);
    if (!normalized) return;
    const glyph = calibrationCapture.glyph;
    if (/^[1-5]$/.test(glyph)) calibrationData.poseSamples[glyph].push({ features: poseFeatures(normalized), view: normalized.cameraFacing });
    else if (/^[6-9]$/.test(glyph)) {
      const sample = { timestamp: frame.timestamp, value: contactDistances(normalized)[glyph], view: normalized.cameraFacing, phase: calibrationCapture.phase };
      const contact = calibrationData.contactSamples[glyph];
      contact.values.push(sample);
      if (calibrationCapture.phase === "open" || calibrationCapture.phase === "closed") contact[calibrationCapture.phase].push(sample);
    }
    else if (glyph === "↓") calibrationData.strokeFrames.push({ timestamp: frame.timestamp, palmY: normalized.palmScreenY });
    calibrationFrames.push(frame.timestamp);
    if (calibrationFrames.length % 12 === 0) emit("calibration-progress", { completed: calibrationData.completed, latest: summarizeCapture(glyph), capturing: true });
  };
  const process = (frame, metrics = null) => {
    collectCalibration(frame);
    const result = recognizer.process(frame);
    emit("recognition", { timestamp: frame.timestamp, diagnostics: result.diagnostics, landmarks: frame.landmarks, confidence: frame.confidence, metrics });
    if (result.hit) emit("hit", { hit: result.hit });
    return result;
  };

  return {
    async handle(message) {
      if (disposed && message?.type !== "init") return;
      try {
        switch (message?.type) {
          case "init": {
            recognizer = new SignSpellRecognizer(message.profile || null);
            selectedHandedness = String(message.handedness || message.profile?.handedness || "right").toLowerCase();
            detector = await loadDetector(message.detectorConfig);
            disposed = false;
            emit("ready", { detectorReady: Boolean(detector), calibrationReady: Boolean(recognizer.profile) });
            emitFrameReady();
            break;
          }
          case "set-profile":
            recognizer.setProfile(message.profile || null);
            selectedHandedness = message.profile?.handedness || selectedHandedness;
            emit("profile-set", { calibrationReady: Boolean(recognizer.profile) });
            break;
          case "handedness":
            selectedHandedness = String(message.handedness || "right").toLowerCase();
            break;
          case "calibration-capture":
            finishCalibrationCapture();
            if (message.replace === true) {
              const glyph = String(message.glyph);
              if (/^[1-5]$/.test(glyph)) calibrationData.poseSamples[glyph] = [];
              else if (/^[6-9]$/.test(glyph)) {
                const target = calibrationData.contactSamples[glyph];
                const phase = message.phase === "open" || message.phase === "closed" ? message.phase : null;
                if (phase) {
                  target[phase] = [];
                  target.values = target.values.filter((sample) => sample.phase !== phase);
                } else calibrationData.contactSamples[glyph] = { values: [], open: [], closed: [] };
              } else if (glyph === "↓") calibrationData.strokeFrames = [];
            }
            calibrationCapture = {
              step: message.step,
              glyph: String(message.glyph),
              phase: message.phase === "open" || message.phase === "closed" ? message.phase : null,
              until: performance.now() + Math.max(500, Number(message.durationMs) || 1800),
            };
            calibrationFrames = [];
            // Do not throw away a clean capture just because a later gesture
            // needs another pass. A caller can explicitly request a reset.
            if (message.reset === true) calibrationData = freshCalibrationData();
            emit("calibration-capture-started", { step: message.step, glyph: message.glyph });
            break;
          case "calibration-reset":
            calibrationCapture = null;
            calibrationFrames = [];
            calibrationData = freshCalibrationData();
            emit("calibration-progress", { completed: calibrationData.completed, reset: true });
            break;
          case "calibration-export":
            finishCalibrationCapture();
            emit("calibration-draft", { draft: calibrationDraft() });
            break;
          case "calibration-import":
            if (!isDraft(message.draft)) throw new Error("Invalid calibration draft");
            calibrationCapture = null;
            calibrationFrames = [];
            calibrationData = message.draft.data;
            selectedHandedness = String(message.draft.handedness || selectedHandedness).toLowerCase() === "left" ? "left" : "right";
            // Drafts from earlier versions did not record completion state.
            calibrationData.completed ||= { pose: {}, contact: {}, downstroke: false };
            emit("calibration-imported", { completed: calibrationData.completed });
            emit("calibration-progress", { completed: calibrationData.completed, imported: true });
            break;
          case "calibration-build": {
            finishCalibrationCapture();
            const contactSamples = {};
            for (const digit of [6, 7, 8, 9]) {
              const source = calibrationData.contactSamples[digit];
              const entries = source.values.filter((item) => Number.isFinite(item.value)).sort((a, b) => a.value - b.value);
              const take = Math.max(5, Math.floor(entries.length * 0.32));
              const closedEntries = source.closed?.length >= 5 ? source.closed : entries.slice(0, take);
              const openEntries = source.open?.length >= 5 ? source.open : entries.slice(-take);
              const chronological = [...source.values].sort((a, b) => a.timestamp - b.timestamp);
              const closingSpeeds = [];
              for (let index = 1; index < chronological.length; index += 1) {
                const dt = (chronological[index].timestamp - chronological[index - 1].timestamp) / 1000;
                const speed = dt > 0 ? (chronological[index - 1].value - chronological[index].value) / dt : 0;
                if (speed > 0) closingSpeeds.push(speed);
              }
              contactSamples[digit] = { open: openEntries.map((item) => ({ value: item.value, view: item.view })), closed: closedEntries.map((item) => ({ value: item.value, view: item.view })), closingSpeeds };
            }
            const strokeTrials = derivedStrokeTrials();
            strokeTrials.sort((a, b) => b.strokeVelocity - a.strokeVelocity);
            const profile = buildCalibrationProfile({ handedness: message.handedness || selectedHandedness, poseSamples: calibrationData.poseSamples, contactSamples, strokeTrials: strokeTrials.slice(0, 20) });
            emit("calibration-profile", { profile, completed: profile.completed });
            break;
          }
          case "reset":
            recognizer.reset();
            emit("reset");
            break;
          case "replay-frame":
            process(message.frame || message);
            break;
          case "frame": {
            if (busy) {
              emit("frame-dropped", { reason: "worker-busy", timestamp: message.timestamp });
              break;
            }
            if (!detector) {
              if (typeof message.frame?.close === "function") message.frame.close();
              emit("error", { code: "detector-unavailable", message: "Initialize a detector before sending camera frames." });
              emitFrameReady();
              break;
            }
            busy = true;
            const input = message.frame;
            try {
              const inferenceStarted = performance.now();
              const raw = detector.detect
                ? await detector.detect(input, message.timestamp)
                : await detector.detectForVideo(input, message.timestamp);
              const inferenceMs = performance.now() - inferenceStarted;
              const hand = firstHand(raw);
              if (hand) process({ timestamp: message.timestamp, ...hand }, { inferenceMs });
              else process({ timestamp: message.timestamp, landmarks: null }, { inferenceMs });
            } finally {
              if (typeof input?.close === "function") input.close();
              busy = false;
              emitFrameReady();
            }
            break;
          }
          case "dispose":
            recognizer.reset();
            await detector?.close?.();
            detector = null;
            disposed = true;
            emit("disposed");
            break;
          default:
            emit("error", { code: "unknown-message", message: `Unknown vision worker message: ${message?.type}` });
        }
      } catch (error) {
        const shouldAcknowledgeFrame = message?.type === "frame" && busy;
        busy = false;
        emit("error", { code: "vision-worker-error", message: error instanceof Error ? error.message : String(error) });
        if (shouldAcknowledgeFrame) emitFrameReady();
      }
    },
  };
}

// Auto-install only in an actual module worker; importing this module in Node
// tests or from app code remains side-effect free.
const isWorkerScope = typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof WorkerGlobalScope;
if (isWorkerScope) {
  const controller = createVisionWorkerController({ postMessage: (message, transfer) => self.postMessage(message, transfer || []) });
  self.addEventListener("message", (event) => { controller.handle(event.data); });
}
