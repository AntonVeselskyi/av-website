const PACKAGE_VERSION = "0.10.35";
const PACKAGE_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${PACKAGE_VERSION}`;
const PACKAGE_MODULE = `${PACKAGE_ROOT}/vision_bundle.mjs`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/**
 * MediaPipe Tasks adapter for the window thread.
 *
 * The upstream WASM loader injects a classic script which defines
 * `self.ModuleFactory`. That mechanism is incompatible with module workers,
 * so the page owns inference and sends only derived landmarks to recognition.
 */
export async function createDetector(options = {}) {
  const { FilesetResolver, HandLandmarker } = await import(PACKAGE_MODULE);
  const fileset = await FilesetResolver.forVisionTasks(`${PACKAGE_ROOT}/wasm`);
  let detector;
  const base = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: options.delegate || "GPU" },
    runningMode: "VIDEO",
    numHands: 1,
    // Back-of-hand number signs occlude curled fingertips. Lower presence and
    // tracking gates keep the same hand alive while the pose classifier uses
    // the more reliable straight-finger joints.
    minHandDetectionConfidence: 0.4,
    minHandPresenceConfidence: 0.34,
    minTrackingConfidence: 0.35,
  };
  try {
    detector = await HandLandmarker.createFromOptions(fileset, base);
  } catch (error) {
    if (base.baseOptions.delegate !== "GPU") throw error;
    detector = await HandLandmarker.createFromOptions(fileset, { ...base, baseOptions: { ...base.baseOptions, delegate: "CPU" } });
  }
  return {
    detect(frame, timestamp) { return detector.detectForVideo(frame, timestamp); },
    close() { detector.close(); },
  };
}
