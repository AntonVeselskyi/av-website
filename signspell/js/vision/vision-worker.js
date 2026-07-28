import { SignSpellRecognizer } from "./recognizer.js";
import { buildCalibrationProfile } from "./calibration.js";
import { contactDistances, normalizeLandmarks, poseFeatures } from "./landmarks.js";

/**
 * Worker protocol for app integration:
 *
 * Main -> worker
 * - `init`: `{ detectorConfig?, profile? }`; detectorConfig is optional for
 *   replay-only usage and otherwise is `{ moduleUrl, exportName?, options? }`.
 * - `set-profile`: `{ profile }`
 * - `frame`: `{ timestamp, frame }`, only after a `frame-ready` response.
 * - `replay-frame`: `{ frame: { timestamp, landmarks, handedness?, confidence? } }`
 * - `reset` / `dispose`
 *
 * Worker -> main
 * - `ready`, `frame-ready`, `recognition`, `hit`, or `error`.
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
        6: { values: [] }, 7: { values: [] }, 8: { values: [] }, 9: { values: [] },
      },
      strokeFrames: [],
    };
  }

  const emit = (type, payload = {}, transfer = undefined) => postMessage({ type, ...payload }, transfer);
  const emitFrameReady = () => emit("frame-ready");
  const collectCalibration = (frame) => {
    if (!calibrationCapture || frame.timestamp > calibrationCapture.until) {
      if (calibrationCapture) {
        emit("calibration-sample", { step: calibrationCapture.step, glyph: calibrationCapture.glyph, frames: calibrationFrames.length });
        calibrationCapture = null;
        calibrationFrames = [];
      }
      return;
    }
    const normalized = normalizeLandmarks(frame.landmarks, selectedHandedness);
    if (!normalized) return;
    const glyph = calibrationCapture.glyph;
    if (/^[1-5]$/.test(glyph)) calibrationData.poseSamples[glyph].push(poseFeatures(normalized));
    else if (/^[6-9]$/.test(glyph)) calibrationData.contactSamples[glyph].values.push({ timestamp: frame.timestamp, value: contactDistances(normalized)[glyph] });
    else if (glyph === "↓") calibrationData.strokeFrames.push({ timestamp: frame.timestamp, palmY: normalized.palmScreenY });
    calibrationFrames.push(frame.timestamp);
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
            calibrationCapture = { step: message.step, glyph: String(message.glyph), until: performance.now() + Math.max(500, Number(message.durationMs) || 1800) };
            calibrationFrames = [];
            if (Number(message.step) === 0) calibrationData = freshCalibrationData();
            emit("calibration-capture-started", { step: message.step, glyph: message.glyph });
            break;
          case "calibration-build": {
            const contactSamples = {};
            for (const digit of [6, 7, 8, 9]) {
              const entries = calibrationData.contactSamples[digit].values.filter((item) => Number.isFinite(item.value)).sort((a, b) => a.value - b.value);
              const take = Math.max(5, Math.floor(entries.length * 0.32));
              const closedEntries = entries.slice(0, take);
              const openEntries = entries.slice(-take);
              const chronological = [...calibrationData.contactSamples[digit].values].sort((a, b) => a.timestamp - b.timestamp);
              const closingSpeeds = [];
              for (let index = 1; index < chronological.length; index += 1) {
                const dt = (chronological[index].timestamp - chronological[index - 1].timestamp) / 1000;
                const speed = dt > 0 ? (chronological[index - 1].value - chronological[index].value) / dt : 0;
                if (speed > 0) closingSpeeds.push(speed);
              }
              contactSamples[digit] = { open: openEntries.map((item) => item.value), closed: closedEntries.map((item) => item.value), closingSpeeds };
            }
            const strokeFrames = calibrationData.strokeFrames;
            const strokeTrials = [];
            for (let index = 3; index < strokeFrames.length; index += 1) {
              const start = strokeFrames[index - 3], end = strokeFrames[index];
              const dt = (end.timestamp - start.timestamp) / 1000;
              const displacement = end.palmY - start.palmY;
              if (dt > 0 && displacement > 0.012) strokeTrials.push({ strokeVelocity: displacement / dt, displacement, restVelocity: 0.02 });
            }
            strokeTrials.sort((a, b) => b.strokeVelocity - a.strokeVelocity);
            const profile = buildCalibrationProfile({ handedness: message.handedness || selectedHandedness, poseSamples: calibrationData.poseSamples, contactSamples, strokeTrials: strokeTrials.slice(0, 20) });
            emit("calibration-profile", { profile });
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
