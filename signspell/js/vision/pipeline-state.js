/**
 * Pure, media-free state helpers for the browser camera -> worker handoff.
 * Keeping this separate makes the readiness gate testable without a DOM,
 * Worker, ImageBitmap, or a camera stream.
 */
export function canSendVisionFrame({ worker = null, ready = false, inFlight = false, videoReadyState = 0 } = {}) {
  return Boolean(worker) && ready === true && inFlight !== true && Number(videoReadyState) >= 2;
}

export function visionPipelineSummary({ worker = null, ready = false, inFlight = false, videoReadyState = 0 } = {}) {
  return `worker=${worker ? "online" : "none"}; detector=${ready ? "ready" : "waiting"}; frame=${inFlight ? "in-flight" : "idle"}; video=${Number(videoReadyState) >= 2 ? "decoded" : "waiting"}`;
}

/** Return a bounded error summary; never include a frame, URL, or landmarks. */
export function bitmapFailureSummary(error) {
  const detail = String(error?.message || error?.name || "unknown capture error")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `camera frame capture failed: ${detail || "unknown capture error"}`;
}

/** A persistent, actionable message for a healthy camera with a failed detector. */
export function visionDetectorFailureMessage(error) {
  const detail = String(error?.message || error || "unknown detector error")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return `Camera is live. Vision detector failed: ${detail || "unknown detector error"}. Press CAMERA RETRY.`;
}
