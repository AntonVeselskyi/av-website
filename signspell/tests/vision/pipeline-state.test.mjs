import assert from "node:assert/strict";
import test from "node:test";

import { canSendVisionFrame, bitmapFailureSummary, visionDetectorFailureMessage, visionPipelineSummary } from "../../js/vision/pipeline-state.js";

test("vision frames wait for a ready detector and decoded video", () => {
  const worker = {};
  assert.equal(canSendVisionFrame({ worker, ready: false, inFlight: false, videoReadyState: 4 }), false);
  assert.equal(canSendVisionFrame({ worker, ready: true, inFlight: true, videoReadyState: 4 }), false);
  assert.equal(canSendVisionFrame({ worker, ready: true, inFlight: false, videoReadyState: 1 }), false);
  assert.equal(canSendVisionFrame({ worker, ready: true, inFlight: false, videoReadyState: 2 }), true);
});

test("pipeline snapshot is media-free and bitmap failures are bounded summaries", () => {
  assert.equal(visionPipelineSummary({ worker: {}, ready: true, inFlight: false, videoReadyState: 4 }), "worker=online; detector=ready; frame=idle; video=decoded");
  const failure = bitmapFailureSummary(new Error(`bad frame\n${"x".repeat(200)}`));
  assert.match(failure, /^camera frame capture failed: bad frame x+/);
  assert.ok(failure.length <= 150);
});

test("detector failures keep the camera state distinct and actionable", () => {
  assert.equal(visionDetectorFailureMessage("ModuleFactory not set"), "Camera is live. Vision detector failed: ModuleFactory not set. Press CAMERA RETRY.");
  assert.match(visionDetectorFailureMessage(new Error("bad\nworker")), /bad worker/);
});
