const PACKAGE_VERSION = "0.10.35";
const PACKAGE_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${PACKAGE_VERSION}`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/** MediaPipe Tasks adapter loaded inside the module worker. Camera pixels stay local. */
export async function createDetector(options = {}) {
  const { FilesetResolver, HandLandmarker } = await import(`${PACKAGE_ROOT}/+esm`);
  const fileset = await FilesetResolver.forVisionTasks(`${PACKAGE_ROOT}/wasm`);
  let detector;
  const base = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: options.delegate || "GPU" },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
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
