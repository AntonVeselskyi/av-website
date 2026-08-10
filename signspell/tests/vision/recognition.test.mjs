import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalibrationProfile,
  buildPoseProfile,
  digitFromFingers,
  fingerExtension,
  calibrationFromStorage,
  calibrationToStorage,
  classifyPose,
  ContactRecognizer,
  contactDistances,
  DownstrokeRecognizer,
  normalizeLandmarks,
  poseFeatures,
  PoseStabilizer,
  SignSpellRecognizer,
  createVisionWorkerController,
  handViewsMatch,
  handViewsOppose,
} from "../../js/vision/index.js";

test("calibration accepts decisive hand-facing signs without a contradictory magnitude gate", () => {
  assert.equal(handViewsMatch(0.13, 0.13), true);
  assert.equal(handViewsMatch(0.13, -0.13), false);
  assert.equal(handViewsOppose(0.13, -0.13), true);
  assert.equal(handViewsOppose(0.13, 0.13), false);
});

function hand({ digit = 1, y = 0.6, contact = null, facing = "knuckles" } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y, z: 0 }));
  points[0] = { x: 0.5, y, z: 0 };
  points[1] = { x: 0.43, y: y - 0.035, z: 0 };
  points[2] = { x: 0.39, y: y - 0.08, z: 0 };
  points[3] = { x: 0.36, y: y - 0.12, z: 0 };
  points[4] = { x: 0.34, y: y - 0.15, z: 0 };

  const fingers = [
    [5, 6, 7, 8, 0.39],
    [9, 10, 11, 12, 0.48],
    [13, 14, 15, 16, 0.57],
    [17, 18, 19, 20, 0.66],
  ];
  const openFingers = digit === 1 ? 1 : digit === 2 ? 2 : digit === 3 ? 2 : digit === 4 ? 4 : 4;
  for (let position = 0; position < fingers.length; position += 1) {
    const [mcp, pip, dip, tip, x] = fingers[position];
    points[mcp] = { x, y: y - 0.09, z: 0 };
    if (position < openFingers) {
      points[pip] = { x, y: y - 0.20, z: 0 };
      points[dip] = { x, y: y - 0.31, z: 0 };
      points[tip] = { x, y: y - 0.42, z: 0 };
    } else {
      points[pip] = { x, y: y - 0.17, z: 0 };
      points[dip] = { x: x + 0.075, y: y - 0.14, z: 0 };
      points[tip] = { x: x + 0.11, y: y - 0.07, z: 0 };
    }
  }
  // Three opens the thumb, while five also extends it. Calibration learns the
  // actual user's variant rather than assuming this model's convention.
  if (digit === 3 || digit === 5) {
    points[3] = { x: 0.32, y: y - 0.13, z: 0 };
    points[4] = { x: 0.25, y: y - 0.16, z: 0 };
  }
  if (contact) {
    const tips = { 6: 20, 7: 16, 8: 12, 9: 8 };
    points[4] = { ...points[tips[contact]] };
  }
  // A horizontal camera-space reflection flips the signed palm normal while
  // retaining the same finger geometry. The recognizer deliberately learns
  // which sign is the user's knuckles/palm-facing side at calibration time,
  // rather than assuming an absolute sign that breaks on mirrored cameras.
  return facing === "palm" ? points.map((point) => ({ ...point, x: 1 - point.x })) : points;
}

function rotateHandOnScreen(points, radians) {
  const origin = points[0];
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  return points.map((value) => {
    const x = value.x - origin.x, y = value.y - origin.y;
    return { ...value, x: origin.x + x * cosine - y * sine, y: origin.y + x * sine + y * cosine };
  });
}

function profile() {
  const poseSamples = Object.fromEntries([1, 2, 3, 4, 5].map((digit) => [digit,
    Array.from({ length: 6 }, (_, sample) => poseFeatures(normalizeLandmarks(hand({ digit, y: 0.6 + sample * 0.001 })))),
  ]));
  const contactSamples = Object.fromEntries([6, 7, 8, 9].map((digit) => [digit, {
    open: [0.75, 0.72, 0.78, 0.74, 0.76],
    closed: [0.02, 0.03, 0.025, 0.02, 0.03],
    closingSpeeds: [0.4, 0.5, 0.45, 0.42, 0.48],
  }]));
  return buildCalibrationProfile({
    handedness: "right",
    poseSamples,
    contactSamples,
    strokeTrials: Array.from({ length: 6 }, () => ({ restVelocity: 0.01, strokeVelocity: 1.5, displacement: 0.12 })),
    createdAt: 1,
  });
}

function descriptorProfile() {
  const poseSamples = Object.fromEntries([1, 2, 3, 4, 5].map((digit) => [digit,
    Array.from({ length: 6 }, (_, sample) => {
      const normalized = normalizeLandmarks(hand({ digit, y: 0.6 + sample * 0.001 }));
      return { features: poseFeatures(normalized), view: normalized.cameraFacing };
    }),
  ]));
  const contactSamples = Object.fromEntries([6, 7, 8, 9].map((digit) => [digit, {
    open: Array.from({ length: 6 }, () => ({ value: 0.75, view: 1 })),
    closed: Array.from({ length: 6 }, () => ({ value: 0.03, view: 1 })),
    closingSpeeds: [0.4, 0.5, 0.45, 0.42, 0.48],
  }]));
  return buildCalibrationProfile({ handedness: "right", poseSamples, contactSamples,
    strokeTrials: Array.from({ length: 6 }, () => ({ restVelocity: 0.01, strokeVelocity: 1.5, displacement: 0.12 })) });
}

function conventionProfile() {
  const poseSamples = Object.fromEntries([1, 2, 3, 4, 5].map((digit) => [digit,
    Array.from({ length: 6 }, (_, sample) => {
      const normalized = normalizeLandmarks(hand({ digit, y: 0.6 + sample * 0.001, facing: "knuckles" }));
      return { features: poseFeatures(normalized), view: normalized.cameraFacing };
    }),
  ]));
  const contactSamples = Object.fromEntries([6, 7, 8, 9].map((digit) => [digit, {
    open: Array.from({ length: 6 }, (_, sample) => {
      const normalized = normalizeLandmarks(hand({ digit: 1, y: 0.6 + sample * 0.001, facing: "palm" }));
      return { value: contactDistances(normalized)[digit], view: normalized.cameraFacing };
    }),
    closed: Array.from({ length: 6 }, (_, sample) => {
      const normalized = normalizeLandmarks(hand({ digit: 1, contact: digit, y: 0.6 + sample * 0.001, facing: "palm" }));
      return { value: contactDistances(normalized)[digit], view: normalized.cameraFacing };
    }),
    closingSpeeds: [0.4, 0.5, 0.45, 0.42, 0.48],
  }]));
  return buildCalibrationProfile({
    handedness: "right",
    poseSamples,
    contactSamples,
    strokeTrials: Array.from({ length: 6 }, () => ({ restVelocity: 0.01, strokeVelocity: 1.5, displacement: 0.12 })),
  });
}

test("calibrated pose classes separate 1–5 and persist as JSON only", () => {
  const calibration = profile();
  assert.equal(calibration.valid, true, calibration.errors.join(", "));
  for (const digit of [1, 2, 3, 4, 5]) {
    const result = classifyPose(calibration.pose, poseFeatures(normalizeLandmarks(hand({ digit }))));
    assert.equal(result.accepted, true, `digit ${digit}: ${result.reason}`);
    assert.equal(result.digit, digit);
  }
  const payload = calibrationToStorage(calibration);
  assert.equal(payload.includes("landmarks"), false);
  assert.equal(calibrationFromStorage(payload)?.createdAt, 1);
  assert.equal(calibrationFromStorage("not json"), null);
});

test("legacy tight pose spreads tolerate realistic occlusion noise for sign 2", () => {
  const calibration = profile();
  for (const prototype of Object.values(calibration.pose.classes)) {
    prototype.spread = prototype.spread.map(() => 0.035);
    prototype.threshold = 1.35;
  }
  const base = poseFeatures(normalizeLandmarks(hand({ digit: 2 })));
  const varied = base.map((value, index) => {
    if (index % 3 === 2) return value + 0.18;
    if ([3, 4, 6, 7].includes(index)) return value + 0.08;
    return value;
  });
  const result = classifyPose(calibration.pose, varied);
  assert.equal(result.digit, 2);
  assert.equal(result.accepted, true, `${result.reason}: ${result.distance} / ${result.effectiveThreshold}`);
});

test("sign 3 survives a visible-thumb geometry change without becoming sign 2", () => {
  const calibration = profile();
  for (const prototype of Object.values(calibration.pose.classes)) {
    prototype.spread = prototype.spread.map(() => 0.035);
    prototype.threshold = 1.35;
  }
  const base = poseFeatures(normalizeLandmarks(hand({ digit: 3 })));
  const varied = base.map((value, index) => {
    if (index === 0 || index === 1) return value + 0.13;
    if (index === 2) return value + 0.2;
    if ([11, 14].includes(index)) return value + 0.16;
    return value;
  });
  const result = classifyPose(calibration.pose, varied);
  assert.equal(result.digit, 3);
  assert.equal(result.accepted, true, `${result.reason}: ${result.distance} / ${result.effectiveThreshold}`);
});

test("stable nearest pose removes threshold flicker without accepting far or wrong-view candidates", () => {
  const stabilizer = new PoseStabilizer({ enterFrames: 5, enterMs: 90 });
  const near = { digit: 2, accepted: false, confidence: 0.22, reason: "outside-calibration", distance: 1.2, effectiveThreshold: 1, thresholdRatio: 1.2, separation: 0.22 };
  for (const timestamp of [0, 25, 50, 75]) assert.equal(stabilizer.update(near, timestamp).accepted, false);
  const entered = stabilizer.update(near, 100);
  assert.equal(entered.accepted, true);
  assert.equal(entered.reason, "stable-nearest");

  const boundary = { ...near, distance: 1.5, thresholdRatio: 1.5, separation: 0.08 };
  assert.equal(stabilizer.update(boundary, 125).accepted, true);
  const far = { ...near, distance: 1.8, thresholdRatio: 1.8, separation: 0.4 };
  assert.equal(stabilizer.update(far, 150).accepted, false);
  const wrongView = { ...near, reason: "wrong-hand-side", distance: 0.8, thresholdRatio: 0.8 };
  assert.equal(stabilizer.update(wrongView, 175).accepted, false);
});

test("contact recognizer fires once, requires release, and rejects ambiguity", () => {
  // Use a direct, deterministic profile here to test the state machine alone.
  const recognizer = new ContactRecognizer({
    valid: true,
    contacts: Object.fromEntries([6, 7, 8, 9].map((digit) => [digit, { threshold: 0.2, release: 0.4, minClosingSpeed: 0.05 }])),
  });
  recognizer.update({ timestamp: 0, distances: { 6: 0.8, 7: 0.8, 8: 0.8, 9: 0.8 } });
  const first = recognizer.update({ timestamp: 20, distances: { 6: 0.1, 7: 0.8, 8: 0.8, 9: 0.8 } });
  assert.equal(first.hit?.digit, 6);
  assert.equal(first.states[6], true);
  assert.equal(recognizer.update({ timestamp: 40, distances: { 6: 0.1, 7: 0.8, 8: 0.8, 9: 0.8 } }).hit, null);
  assert.equal(recognizer.update({ timestamp: 60, distances: { 6: 0.6, 7: 0.8, 8: 0.8, 9: 0.8 } }).states[6], false);
  assert.equal(recognizer.update({ timestamp: 80, distances: { 6: 0.1, 7: 0.8, 8: 0.8, 9: 0.8 } }).hit?.digit, 6);

  const ambiguous = new ContactRecognizer({
    valid: true,
    contacts: Object.fromEntries([6, 7, 8, 9].map((digit) => [digit, { threshold: 0.2, release: 0.4, minClosingSpeed: 0.01 }])),
  });
  ambiguous.update({ timestamp: 0, distances: { 6: 0.8, 7: 0.8, 8: 0.8, 9: 0.8 } });
  assert.equal(ambiguous.update({ timestamp: 20, distances: { 6: 0.1, 7: 0.1, 8: 0.8, 9: 0.8 } }).reason, "ambiguous-contact");
});

test("replay triggers a calibrated downstroke once and requires upward recovery", () => {
  const recognizer = new SignSpellRecognizer(profile());
  for (const timestamp of [0, 20, 40, 80, 100]) {
    assert.equal(recognizer.process({ timestamp, landmarks: hand({ digit: 1 }) }).hit, null);
  }
  const hit = recognizer.process({ timestamp: 116, landmarks: hand({ digit: 1, y: 0.9 }) }).hit;
  assert.equal(hit?.digit, 1);
  assert.equal(hit?.source, "downstroke");
  assert.equal(recognizer.process({ timestamp: 132, landmarks: hand({ digit: 1, y: 0.93 }) }).hit, null);
  recognizer.process({ timestamp: 160, landmarks: hand({ digit: 1, y: 0.45 }) });
  // Re-stabilize after recovery, then strike again.
  for (const timestamp of [180, 200, 240, 260]) recognizer.process({ timestamp, landmarks: hand({ digit: 1, y: 0.45 }) });
  assert.equal(recognizer.process({ timestamp: 276, landmarks: hand({ digit: 1, y: 0.82 }) }).hit?.digit, 1);
});

test("downstroke survives a brief rejected pose while the hand is moving", () => {
  const stroke = new DownstrokeRecognizer({ stableFrames: 3, stableMs: 40, maxGapMs: 220, poseGraceMs: 180 });
  const accepted = { digit: 4, accepted: true, confidence: 0.9 };
  const rejected = { digit: 4, accepted: false, confidence: 0 };
  for (const timestamp of [0, 20, 40, 60, 80]) {
    assert.equal(stroke.update({ timestamp, palmY: 0.5, pose: accepted }).hit, null);
  }
  assert.equal(stroke.update({ timestamp: 100, palmY: 0.5, pose: rejected }).state, "armed");
  const result = stroke.update({ timestamp: 116, palmY: 0.82, pose: accepted });
  assert.equal(result.hit?.digit, 4);
  assert.equal(result.reason, "hit");
});

test("a strong nearest sign can trigger a fast downstroke but cannot arm while stationary", () => {
  const candidate = { digit: 2, accepted: false, confidence: 0.25, reason: "outside-calibration", thresholdRatio: 1.2, separation: 0.22, viewAccepted: true };
  const fast = new DownstrokeRecognizer({ strokeVelocity: 0.75, minDisplacement: 0.035 });
  assert.equal(fast.update({ timestamp: 0, palmY: 0.5, pose: candidate }).hit, null);
  const hit = fast.update({ timestamp: 20, palmY: 0.57, pose: candidate });
  assert.equal(hit.hit?.digit, 2);
  assert.equal(hit.hit?.fastStart, true);
  assert.equal(hit.reason, "fast-start-hit");

  const still = new DownstrokeRecognizer();
  for (const timestamp of [0, 20, 40, 80, 120, 180]) {
    const result = still.update({ timestamp, palmY: 0.5, pose: candidate });
    assert.equal(result.hit, null);
    assert.notEqual(result.state, "armed");
  }
});

test("a dipped hold ignores micro upward bounce and releases only after a deliberate return", () => {
  const stroke = new DownstrokeRecognizer({ stableFrames: 3, stableMs: 40, recoveryFrames: 3, recoveryMs: 70 });
  const pose = { digit: 4, accepted: true, confidence: 0.9 };
  for (const timestamp of [0, 20, 40, 60, 80]) stroke.update({ timestamp, palmY: 0.5, pose });
  assert.equal(stroke.update({ timestamp: 116, palmY: 0.82, pose }).state, "locked");
  assert.equal(stroke.update({ timestamp: 136, palmY: 0.84, pose }).state, "locked");
  assert.equal(stroke.update({ timestamp: 156, palmY: 0.835, pose }).state, "locked");
  assert.equal(stroke.update({ timestamp: 176, palmY: 0.83, pose }).state, "locked");
  assert.equal(stroke.update({ timestamp: 210, palmY: 0.49, pose }).state, "locked");
  assert.equal(stroke.update({ timestamp: 250, palmY: 0.49, pose }).state, "locked");
  assert.equal(stroke.update({ timestamp: 290, palmY: 0.49, pose }).state, "neutral");
});

test("changing a stable finger pose while dipped flows to the new note", () => {
  const stroke = new DownstrokeRecognizer({ stableFrames: 3, stableMs: 40, flowFrames: 2, flowMs: 28 });
  const pose = (digit) => ({ digit, accepted: true, confidence: 0.9 });
  for (const timestamp of [0, 20, 40, 60, 80]) stroke.update({ timestamp, palmY: 0.5, pose: pose(1) });
  assert.equal(stroke.update({ timestamp: 116, palmY: 0.82, pose: pose(1) }).hit?.digit, 1);
  assert.equal(stroke.update({ timestamp: 132, palmY: 0.82, pose: pose(2) }).hit, null);
  const flowed = stroke.update({ timestamp: 164, palmY: 0.82, pose: pose(2) });
  assert.equal(flowed.hit?.digit, 2);
  assert.equal(flowed.hit?.flow, true);
  assert.equal(flowed.reason, "flow-note");
});

test("a dipped note survives shape mismatch and flows after a persistent closest-sign candidate", () => {
  const stroke = new DownstrokeRecognizer({
    stableFrames: 3, stableMs: 40, candidateFlowFrames: 6, candidateFlowMs: 110,
  });
  const accepted = (digit) => ({ digit, accepted: true, confidence: 0.9, reason: "accepted" });
  const closest = { digit: 2, accepted: false, confidence: 0.31, reason: "outside-calibration", thresholdRatio: 1.2, separation: 0.18 };
  for (const timestamp of [0, 20, 40, 60, 80]) stroke.update({ timestamp, palmY: 0.5, pose: accepted(1) });
  assert.equal(stroke.update({ timestamp: 116, palmY: 0.82, pose: accepted(1) }).hit?.digit, 1);
  for (const timestamp of [140, 165, 190, 215, 240]) {
    const transition = stroke.update({ timestamp, palmY: 0.82, pose: closest });
    assert.equal(transition.hit, null);
    assert.equal(transition.state, "locked");
  }
  const flowed = stroke.update({ timestamp: 265, palmY: 0.82, pose: closest });
  assert.equal(flowed.hit?.digit, 2);
  assert.equal(flowed.hit?.flow, true);
  assert.equal(flowed.state, "locked");
});

test("a far closest candidate cannot flow a dipped note from separation confidence alone", () => {
  const stroke = new DownstrokeRecognizer({ stableFrames: 3, stableMs: 40, candidateFlowFrames: 6, candidateFlowMs: 110 });
  const accepted = { digit: 1, accepted: true, confidence: 0.9, reason: "accepted" };
  const far = { digit: 2, accepted: false, confidence: 0.4, reason: "outside-calibration", thresholdRatio: 2.1, separation: 0.35 };
  for (const timestamp of [0, 20, 40, 60, 80]) stroke.update({ timestamp, palmY: 0.5, pose: accepted });
  assert.equal(stroke.update({ timestamp: 116, palmY: 0.82, pose: accepted }).hit?.digit, 1);
  for (const timestamp of [140, 165, 190, 215, 240, 265, 290]) {
    const result = stroke.update({ timestamp, palmY: 0.82, pose: far });
    assert.equal(result.hit, null);
    assert.equal(result.state, "locked");
  }
});

test("pose ambiguity cannot release a dipped note, but upward recovery still does", () => {
  const stroke = new DownstrokeRecognizer({ stableFrames: 3, stableMs: 40, poseGraceMs: 80 });
  const accepted = { digit: 1, accepted: true, confidence: 0.9 };
  const rejected = { digit: null, accepted: false, confidence: 0, reason: "ambiguous-pose" };
  for (const timestamp of [0, 20, 40, 60, 80]) stroke.update({ timestamp, palmY: 0.5, pose: accepted });
  assert.equal(stroke.update({ timestamp: 116, palmY: 0.82, pose: accepted }).state, "locked");
  for (const timestamp of [180, 260, 340]) {
    assert.equal(stroke.update({ timestamp, palmY: 0.82, pose: rejected }).state, "locked");
  }
  assert.equal(stroke.update({ timestamp: 420, palmY: 0.45, pose: rejected }).state, "locked");
  assert.equal(stroke.update({ timestamp: 455, palmY: 0.45, pose: rejected }).state, "locked");
  assert.equal(stroke.update({ timestamp: 490, palmY: 0.45, pose: rejected }).state, "neutral");
});

test("a missing locked hand expires after the reacquisition window", () => {
  const stroke = new DownstrokeRecognizer({ stableFrames: 3, stableMs: 40, maxReacquireMs: 460 });
  const pose = { digit: 1, accepted: true, confidence: 0.9 };
  for (const timestamp of [0, 20, 40, 60, 80]) stroke.update({ timestamp, palmY: 0.5, pose });
  stroke.update({ timestamp: 116, palmY: 0.82, pose });
  assert.equal(stroke.markMissing(140).state, "locked");
  const expired = stroke.markMissing(620);
  assert.equal(expired.state, "neutral");
  assert.equal(expired.reason, "held-hand-removed");
});

test("a calibrated upright-to-sideways rotation strikes once, holds, and releases upright", () => {
  const stroke = new DownstrokeRecognizer({
    metric: "palm-tilt",
    readyVerticality: 0.76,
    hitVerticality: 0.34,
    neutralVelocity: 0.2,
    strokeVelocity: 0.5,
    minDisplacement: 0.24,
    recoveryDisplacement: 0.2,
    stableFrames: 3,
    stableMs: 40,
    recoveryFrames: 3,
    recoveryMs: 60,
  });
  const pose = { digit: 4, accepted: true, confidence: 0.92 };
  for (const timestamp of [0, 20, 40, 60, 80]) {
    assert.equal(stroke.update({ timestamp, palmY: 0.5, palmTilt: 0.9, pose }).hit, null);
  }
  assert.equal(stroke.state, "armed");
  assert.equal(stroke.update({ timestamp: 100, palmY: 0.5, palmTilt: 0.68, pose }).hit, null);
  const hit = stroke.update({ timestamp: 125, palmY: 0.5, palmTilt: 0.27, pose });
  assert.equal(hit.hit?.digit, 4);
  assert.equal(hit.state, "locked");
  for (const timestamp of [145, 170, 200]) {
    assert.equal(stroke.update({ timestamp, palmY: 0.5, palmTilt: 0.24, pose }).state, "locked");
  }
  assert.equal(stroke.update({ timestamp: 225, palmY: 0.5, palmTilt: 0.88, pose }).state, "locked");
  assert.equal(stroke.update({ timestamp: 260, palmY: 0.5, palmTilt: 0.9, pose }).state, "locked");
  assert.equal(stroke.update({ timestamp: 295, palmY: 0.5, palmTilt: 0.91, pose }).state, "neutral");
});

test("tilt calibration learns separated upright and sideways endpoints", () => {
  const base = profile();
  const calibrated = buildCalibrationProfile({
    handedness: "right",
    poseSamples: Object.fromEntries(Object.entries(base.pose.classes).map(([digit, value]) => [digit, Array.from({ length: 6 }, () => value.center)])),
    contactSamples: Object.fromEntries(Object.keys(base.contacts.contacts).map((digit) => [digit, {
      open: Array.from({ length: 6 }, () => 0.75),
      closed: Array.from({ length: 6 }, () => 0.03),
      closingSpeeds: [0.4, 0.45, 0.5, 0.42, 0.48],
    }])),
    strokeTrials: Array.from({ length: 6 }, (_, index) => ({
      restVelocity: 0.05,
      strokeVelocity: 1.2 + index * 0.03,
      displacement: 0.62,
      readyVerticality: 0.88 + index * 0.002,
      hitVerticality: 0.22 + index * 0.002,
    })),
  });
  assert.equal(calibrated.valid, true, calibrated.errors.join(", "));
  assert.equal(calibrated.downstroke.metric, "palm-tilt");
  assert.ok(calibrated.downstroke.readyVerticality > calibrated.downstroke.hitVerticality + 0.5);
  assert.equal(calibrated.downstroke.lockedMissingReleaseMs, 190);
});

test("one missing detector frame does not disarm a downstroke", () => {
  const recognizer = new SignSpellRecognizer(profile());
  for (const timestamp of [0, 20, 40, 80, 100]) {
    recognizer.process({ timestamp, landmarks: hand({ digit: 2 }) });
  }
  assert.equal(recognizer.process({ timestamp: 108, landmarks: null }).hit, null);
  const reacquired = recognizer.process({ timestamp: 116, landmarks: hand({ digit: 2, y: 0.9 }) }).hit;
  assert.equal(reacquired?.digit, 2);
  assert.equal(reacquired?.reacquired, true);
  assert.equal(reacquired?.source, "downstroke");
});

test("armed palm position survives a longer detector dropout and commits lower on reacquisition", () => {
  const stroke = new DownstrokeRecognizer({
    stableFrames: 3,
    stableMs: 40,
    minDisplacement: 0.08,
    maxGapMs: 100,
    maxReacquireMs: 460,
  });
  const pose = { digit: 5, accepted: true, confidence: 0.9 };
  for (const timestamp of [0, 20, 40, 60, 80]) stroke.update({ timestamp, palmY: 0.5, pose });
  assert.equal(stroke.markMissing(105).reason, "armed-hand-gap");
  stroke.markMissing(180);
  const result = stroke.update({ timestamp: 280, palmY: 0.68, pose });
  assert.equal(result.reason, "reacquired-stroke");
  assert.equal(result.hit?.digit, 5);
  assert.equal(result.hit?.reacquired, true);
});

test("reacquisition does not invent a stroke when the armed hand returns level or higher", () => {
  const stroke = new DownstrokeRecognizer({ stableFrames: 3, stableMs: 40, minDisplacement: 0.08 });
  const pose = { digit: 3, accepted: true, confidence: 0.9 };
  for (const timestamp of [0, 20, 40, 60, 80]) stroke.update({ timestamp, palmY: 0.5, pose });
  stroke.markMissing(100);
  const result = stroke.update({ timestamp: 150, palmY: 0.48, pose });
  assert.equal(result.hit, null);
  assert.notEqual(result.reason, "reacquired-stroke");
});

test("contact landmark replay maps thumb contacts to 6–9", () => {
  const calibration = profile();
  const recognizer = new SignSpellRecognizer(calibration);
  recognizer.process({ timestamp: 0, landmarks: hand({ digit: 1 }) });
  const open = contactDistances(normalizeLandmarks(hand({ digit: 1 })));
  assert.ok(open[6] > calibration.contacts.contacts[6].release);
  const event = recognizer.process({ timestamp: 20, landmarks: hand({ digit: 1, contact: 6 }) }).hit;
  assert.equal(event?.digit, 6);
  assert.equal(event?.source, "contact");
});

test("rapid contacts release early and flow directly between fingertips", () => {
  const recognizer = new ContactRecognizer({
    valid: true,
    contacts: Object.fromEntries([6, 7, 8, 9].map((digit) => [digit, { threshold: 0.2, release: 0.4, minClosingSpeed: 0.05 }])),
  });
  recognizer.update({ timestamp: 0, distances: { 6: 0.8, 7: 0.8, 8: 0.8, 9: 0.8 } });
  assert.equal(recognizer.update({ timestamp: 20, distances: { 6: 0.1, 7: 0.8, 8: 0.8, 9: 0.8 } }).hit?.digit, 6);
  recognizer.update({ timestamp: 35, distances: { 6: 0.34, 7: 0.8, 8: 0.8, 9: 0.8 } });
  assert.equal(recognizer.update({ timestamp: 50, distances: { 6: 0.5, 7: 0.1, 8: 0.8, 9: 0.8 } }).hit?.digit, 7);
  recognizer.update({ timestamp: 65, distances: { 6: 0.8, 7: 0.32, 8: 0.8, 9: 0.8 } });
  assert.equal(recognizer.update({ timestamp: 80, distances: { 6: 0.8, 7: 0.1, 8: 0.8, 9: 0.8 } }).hit?.digit, 7);
});

test("contact trajectory predicts a committed fingertip tap before threshold crossing", () => {
  const recognizer = new ContactRecognizer({
    valid: true,
    contacts: Object.fromEntries([6, 7, 8, 9].map((digit) => [digit, { threshold: 0.2, release: 0.5, minClosingSpeed: 0.05 }])),
  });
  let predicted = null;
  for (const [timestamp, distance] of [[0, 0.7], [16, 0.62], [32, 0.48], [48, 0.34]]) {
    const distances = { 6: distance, 7: 0.8, 8: 0.8, 9: 0.8 };
    const result = recognizer.update({ timestamp, distances, confidence: 0.95, latencyMs: 35 });
    predicted ||= result.hit;
  }
  assert.equal(predicted?.digit, 6);
  assert.equal(predicted?.predicted, true);
  assert.ok(predicted.leadMs > 0 && predicted.leadMs <= 55);
});

test("contact predictor rejects hover jitter and an aborted approach", () => {
  const recognizer = new ContactRecognizer({
    valid: true,
    contacts: Object.fromEntries([6, 7, 8, 9].map((digit) => [digit, { threshold: 0.2, release: 0.5, minClosingSpeed: 0.05 }])),
  });
  const hits = [];
  for (const [timestamp, distance] of [[0, 0.7], [16, 0.61], [32, 0.49], [48, 0.38], [64, 0.41], [80, 0.39], [96, 0.42]]) {
    const result = recognizer.update({
      timestamp,
      distances: { 6: distance, 7: 0.8, 8: 0.8, 9: 0.8 },
      confidence: 0.95,
      latencyMs: 35,
    });
    if (result.hit) hits.push(result.hit);
  }
  assert.deepEqual(hits, []);
});

test("downstroke trajectory can commit on a forecast crossing", () => {
  const recognizer = new DownstrokeRecognizer({
    stableFrames: 3,
    stableMs: 40,
    neutralVelocity: 0.12,
    strokeVelocity: 0.75,
    minDisplacement: 0.08,
  });
  const pose = { digit: 3, accepted: true, confidence: 0.9 };
  let predicted = null;
  for (const [timestamp, palmY] of [[0, 0.5], [20, 0.5], [40, 0.5], [60, 0.5], [80, 0.5], [100, 0.515], [116, 0.54], [132, 0.575], [148, 0.62]]) {
    const result = recognizer.update({ timestamp, palmY, pose, latencyMs: 35 });
    predicted ||= result.hit;
  }
  assert.equal(predicted?.digit, 3);
  assert.equal(predicted?.predicted, true);
  assert.ok(predicted.leadMs > 0 && predicted.leadMs <= 55);
});

test("downstroke predictor does not fire on drift or a shallow aborted dip", () => {
  const recognizer = new DownstrokeRecognizer({
    stableFrames: 3,
    stableMs: 40,
    neutralVelocity: 0.12,
    strokeVelocity: 0.75,
    minDisplacement: 0.08,
  });
  const pose = { digit: 2, accepted: true, confidence: 0.9 };
  const hits = [];
  for (const [timestamp, palmY] of [[0, 0.5], [20, 0.5], [40, 0.5], [60, 0.5], [80, 0.5], [100, 0.506], [120, 0.513], [140, 0.519], [160, 0.516], [180, 0.51]]) {
    const result = recognizer.update({ timestamp, palmY, pose, latencyMs: 35 });
    if (result.hit) hits.push(result.hit);
  }
  assert.deepEqual(hits, []);
});

test("recognizer exposes derived hand, contact, pose, and downstroke diagnostics before calibration", () => {
  const recognizer = new SignSpellRecognizer();
  const result = recognizer.process({ timestamp: 100, confidence: 0.81, landmarks: hand({ digit: 1 }) });
  assert.equal(result.hit, null);
  assert.equal(result.diagnostics.hand.detected, true);
  assert.equal(result.diagnostics.hand.confidence, 0.81);
  assert.ok(Number.isFinite(result.diagnostics.orientation.cameraFacing));
  assert.ok(Number.isFinite(result.diagnostics.fingertips.distances[6]));
  assert.equal(result.diagnostics.pose.reason, "calibration-required");
  assert.equal(result.diagnostics.downstroke.state, "unavailable");
  assert.equal(recognizer.process({ timestamp: 120, landmarks: null }).diagnostics.hand.detected, false);
});

test("gesture diagnostics expose pose ratios and downstroke motion without landmarks", () => {
  const recognizer = new SignSpellRecognizer(profile());
  const result = recognizer.process({ timestamp: 100, confidence: 0.92, landmarks: hand({ digit: 3 }) });
  const { pose, downstroke } = result.diagnostics;
  assert.ok(Number.isFinite(pose.distance));
  assert.ok(Number.isFinite(pose.effectiveThreshold));
  assert.ok(Number.isFinite(pose.thresholdRatio));
  assert.equal(downstroke.stableDigit, 3);
  assert.ok(Number.isFinite(downstroke.filteredY));
  assert.ok(Number.isFinite(downstroke.strokeVelocityRequired));
  assert.equal("landmarks" in result.diagnostics, false);
});

test("worker controller replays landmark frames without a webcam or detector", async () => {
  const messages = [];
  const controller = createVisionWorkerController({ postMessage: (message) => messages.push(message) });
  await controller.handle({ type: "init", profile: profile() });
  await controller.handle({ type: "replay-frame", frame: { timestamp: 0, landmarks: hand({ digit: 1 }) } });
  await controller.handle({ type: "replay-frame", frame: { timestamp: 20, landmarks: hand({ digit: 1, contact: 8 }) } });
  assert.equal(messages.find((message) => message.type === "ready")?.detectorReady, false);
  assert.deepEqual(messages.find((message) => message.type === "hit")?.hit.digit, 8);
  const diagnostic = messages.findLast((message) => message.type === "diagnostic")?.diagnostic;
  assert.equal(diagnostic.hand.detected, true);
  assert.ok(Number.isFinite(diagnostic.fingertips.contacts[8].distance));
  assert.equal(Object.hasOwn(diagnostic, "landmarks"), false);
  assert.ok(Number.isFinite(diagnostic.latency.recognitionMs));
});

test("side-dip calibration counts full upright-sideways-upright cycles, not frame windows", async () => {
  const capture = async (cycles) => {
    const messages = [];
    const controller = createVisionWorkerController({ postMessage: (message) => messages.push(message) });
    await controller.handle({ type: "init" });
    await controller.handle({ type: "calibration-capture", step: "downstroke", glyph: "↓", durationMs: 1200, replace: true });
    let timestamp = 500_000;
    const angles = [0, 0.25, 0.65, 1.1, Math.PI / 2, 1.1, 0.65, 0.25, 0];
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      for (const angle of angles) {
        await controller.handle({ type: "replay-frame", frame: { timestamp, landmarks: rotateHandOnScreen(hand({ digit: 2 }), angle) } });
        timestamp += 42;
      }
    }
    await controller.handle({ type: "calibration-export" });
    return messages.findLast((message) => message.type === "calibration-sample")?.summary;
  };
  const one = await capture(1);
  assert.equal(one.complete, false);
  assert.ok(one.count <= 1);
  const five = await capture(5);
  assert.equal(five.complete, true, five.reason);
  assert.ok(five.count >= 5);
});

test("recognition-only worker initialization never loads a MediaPipe detector", async () => {
  const messages = [];
  const controller = createVisionWorkerController({
    postMessage: (message) => messages.push(message),
    loadDetector: async () => { throw new Error("detector should remain on the page thread"); },
  });
  await controller.handle({ type: "init", recognitionOnly: true, profile: profile() });
  await controller.handle({ type: "replay-frame", frame: { timestamp: 0, landmarks: hand({ digit: 1 }) } });
  assert.equal(messages.find((message) => message.type === "ready")?.detectorReady, true);
  assert.equal(messages.some((message) => message.type === "error"), false);
  assert.equal(messages.some((message) => message.type === "recognition"), true);
});

test("profile reports completed gestures without discarding their usable samples", () => {
  const partial = buildCalibrationProfile({
    handedness: "right",
    poseSamples: { 1: Array.from({ length: 6 }, () => poseFeatures(normalizeLandmarks(hand({ digit: 1 })))) },
    contactSamples: {}, strokeTrials: [],
  });
  assert.equal(partial.valid, false);
  assert.equal(partial.completed.pose[1], true);
  assert.equal(partial.completed.pose[2], false);
  assert.equal(partial.completed.contact[6], false);
  assert.equal(partial.completed.downstroke, false);
});

test("orientation learned in calibration separates knuckles poses from palm-contact poses", () => {
  const calibration = descriptorProfile();
  const front = hand({ digit: 3 });
  const back = front.map((point) => ({ ...point, x: 1 - point.x }));
  const frontNormalized = normalizeLandmarks(front);
  const backNormalized = normalizeLandmarks(back);
  assert.equal(classifyPose(calibration.pose, poseFeatures(frontNormalized), frontNormalized.cameraFacing).accepted, true);
  const rejected = classifyPose(calibration.pose, poseFeatures(backNormalized), backNormalized.cameraFacing);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "wrong-hand-side");
});

test("straight-finger angles outweigh noisy hidden fingertip positions", () => {
  const calibration = profile();
  const noisy = poseFeatures(normalizeLandmarks(hand({ digit: 4 }))).map((value, index) => (
    index % 3 === 2 ? value + 0.1 : value
  ));
  const result = classifyPose(calibration.pose, noisy);
  assert.equal(result.digit, 4);
  assert.equal(result.accepted, true, result.reason);
});

test("contacts can require the calibrated palm-facing view", () => {
  const recognizer = new ContactRecognizer(descriptorProfile().contacts);
  recognizer.update({ timestamp: 0, view: -1, distances: { 6: 0.8, 7: 0.8, 8: 0.8, 9: 0.8 } });
  assert.equal(recognizer.update({ timestamp: 20, view: -1, distances: { 6: 0.1, 7: 0.8, 8: 0.8, 9: 0.8 } }).hit, null);
  recognizer.update({ timestamp: 40, view: 1, distances: { 6: 0.8, 7: 0.8, 8: 0.8, 9: 0.8 } });
  assert.equal(recognizer.update({ timestamp: 60, view: 1, distances: { 6: 0.1, 7: 0.8, 8: 0.8, 9: 0.8 } }).hit?.digit, 6);
});

test("ASL 1–5 knuckles poses and 6–9 palm contacts reject the opposite facing", () => {
  const calibration = conventionProfile();
  assert.equal(calibration.valid, true, calibration.errors.join(", "));

  // The fixture encodes the requested shapes: 3 = thumb + index + middle,
  // 4 = all fingertips but thumb, and 5 = all five fingertips. They must
  // only classify on the learned knuckles-facing side.
  for (const digit of [1, 2, 3, 4, 5]) {
    const knuckles = normalizeLandmarks(hand({ digit, facing: "knuckles" }));
    const palm = normalizeLandmarks(hand({ digit, facing: "palm" }));
    assert.equal(classifyPose(calibration.pose, poseFeatures(knuckles), knuckles.cameraFacing).digit, digit);
    assert.equal(classifyPose(calibration.pose, poseFeatures(knuckles), knuckles.cameraFacing).accepted, true);
    assert.equal(classifyPose(calibration.pose, poseFeatures(palm), palm.cameraFacing).accepted, false);
  }

  for (const digit of [6, 7, 8, 9]) {
    const palmOpen = normalizeLandmarks(hand({ digit: 1, facing: "palm" }));
    const palmClosed = normalizeLandmarks(hand({ digit: 1, contact: digit, facing: "palm" }));
    const knucklesOpen = normalizeLandmarks(hand({ digit: 1, facing: "knuckles" }));
    const knucklesClosed = normalizeLandmarks(hand({ digit: 1, contact: digit, facing: "knuckles" }));

    // Use narrow per-contact thresholds here so the synthetic thumb-to-pinky
    // shape does not also look like a ring contact. This isolates the view
    // gate, which is what this regression protects.
    const contactProfile = {
      valid: true,
      contacts: Object.fromEntries([6, 7, 8, 9].map((candidate) => [candidate, {
        threshold: 0.2,
        release: 0.4,
        minClosingSpeed: 0.05,
        view: { center: palmOpen.cameraFacing, spread: 0.08, threshold: 2.2 },
      }])),
    };
    const correct = new ContactRecognizer(contactProfile);
    correct.update({ timestamp: 0, view: palmOpen.cameraFacing, distances: contactDistances(palmOpen) });
    assert.equal(correct.update({ timestamp: 20, view: palmClosed.cameraFacing, distances: contactDistances(palmClosed) }).hit?.digit, digit);

    const wrongFacing = new ContactRecognizer(contactProfile);
    wrongFacing.update({ timestamp: 0, view: knucklesOpen.cameraFacing, distances: contactDistances(knucklesOpen) });
    assert.equal(wrongFacing.update({ timestamp: 20, view: knucklesClosed.cameraFacing, distances: contactDistances(knucklesClosed) }).hit, null);
  }
});

test("worker retains a successful gesture while a later calibration pass is incomplete", async () => {
  const messages = [];
  const controller = createVisionWorkerController({ postMessage: (message) => messages.push(message) });
  await controller.handle({ type: "init" });
  await controller.handle({ type: "calibration-capture", step: 1, glyph: "1", durationMs: 800, reset: true });
  // Video-frame timestamps belong to the page clock and can be far ahead of
  // the worker clock. They must never expire a worker-owned capture window.
  const first = performance.now() + 100_000;
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: first + index * 10, landmarks: hand({ digit: 1 }) } });
  await controller.handle({ type: "calibration-capture", step: 2, glyph: "2", durationMs: 800 });
  const second = performance.now() + 200_000;
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: second + index * 10, landmarks: hand({ digit: 2 }) } });
  await controller.handle({ type: "calibration-build", handedness: "right" });
  const result = messages.findLast((message) => message.type === "calibration-profile");
  assert.equal(result.profile.completed.pose[1], true);
  assert.equal(result.profile.completed.pose[2], true);
  assert.equal(result.profile.completed.pose[3], false);
  assert.equal(messages.some((message) => message.type === "calibration-progress" && message.latest?.glyph === "1"), true);
});

test("contact phases export, resume, and replace only the retried phase", async () => {
  const messages = [];
  const controller = createVisionWorkerController({ postMessage: (message) => messages.push(message) });
  await controller.handle({ type: "init" });
  await controller.handle({ type: "calibration-capture", step: "contact-6-open", glyph: "6", phase: "open", durationMs: 800, replace: true });
  for (let index = 0; index < 6; index += 1) {
    await controller.handle({ type: "replay-frame", frame: { timestamp: 300_000 + index * 16, landmarks: hand({ digit: 1 }) } });
  }
  await controller.handle({ type: "calibration-capture", step: "contact-6-closed", glyph: "6", phase: "closed", durationMs: 800, replace: true });
  for (let index = 0; index < 6; index += 1) {
    await controller.handle({ type: "replay-frame", frame: { timestamp: 301_000 + index * 16, landmarks: hand({ digit: 1, contact: 6 }) } });
  }
  await controller.handle({ type: "calibration-export" });
  const firstDraft = messages.findLast((message) => message.type === "calibration-draft").draft;
  assert.equal(firstDraft.data.contactSamples[6].open.length, 6);
  assert.equal(firstDraft.data.contactSamples[6].closed.length, 6);
  assert.equal(JSON.stringify(firstDraft).includes("landmarks"), false);

  await controller.handle({ type: "calibration-capture", step: "contact-6-closed", glyph: "6", phase: "closed", durationMs: 800, replace: true });
  for (let index = 0; index < 6; index += 1) {
    await controller.handle({ type: "replay-frame", frame: { timestamp: 302_000 + index * 16, landmarks: hand({ digit: 1, contact: 6 }) } });
  }
  await controller.handle({ type: "calibration-export" });
  const replacedDraft = messages.findLast((message) => message.type === "calibration-draft").draft;
  assert.equal(replacedDraft.data.contactSamples[6].open.length, 6);
  assert.equal(replacedDraft.data.contactSamples[6].closed.length, 6);

  const resumedMessages = [];
  const resumed = createVisionWorkerController({ postMessage: (message) => resumedMessages.push(message) });
  await resumed.handle({ type: "init" });
  await resumed.handle({ type: "calibration-import", draft: replacedDraft });
  await resumed.handle({ type: "calibration-export" });
  const resumedDraft = resumedMessages.findLast((message) => message.type === "calibration-draft").draft;
  assert.equal(resumedDraft.data.contactSamples[6].open.length, 6);
  assert.equal(resumedDraft.data.contactSamples[6].closed.length, 6);
});

test("worker validates a pose checkpoint against the learned number-pose hand side", async () => {
  const messages = [];
  const controller = createVisionWorkerController({ postMessage: (message) => messages.push(message) });
  await controller.handle({ type: "init" });
  await controller.handle({ type: "calibration-capture", step: "pose-1", glyph: "1", durationMs: 900, replace: true });
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: 400_000 + index * 16, landmarks: hand({ digit: 1 }) } });
  await controller.handle({ type: "calibration-capture", step: "pose-2", glyph: "2", durationMs: 900, replace: true });
  const oppositeSide = hand({ digit: 2 }).map((point) => ({ ...point, x: 1 - point.x }));
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: 401_000 + index * 16, landmarks: oppositeSide } });
  await controller.handle({ type: "calibration-capture", step: "pose-3", glyph: "3", durationMs: 900, replace: true });
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: 402_000 + index * 16, landmarks: hand({ digit: 3 }) } });
  await controller.handle({ type: "calibration-export" });

  const samples = messages.filter((message) => message.type === "calibration-sample");
  assert.equal(samples.find((message) => message.step === "pose-1")?.summary.complete, true);
  const second = samples.find((message) => message.step === "pose-2");
  assert.equal(second?.summary.complete, false);
  assert.match(second?.summary.reason || "", /same knuckles-facing side/);
  assert.equal(samples.find((message) => message.step === "pose-3")?.summary.complete, true);
  const draft = messages.findLast((message) => message.type === "calibration-draft").draft;
  assert.equal(draft.data.completed.pose[1], true);
  assert.equal(draft.data.completed.pose[2], false);
  assert.equal(draft.data.completed.pose[3], true);
});

test("worker rejects a touch checkpoint whose saved open and closed positions overlap", async () => {
  const messages = [];
  const controller = createVisionWorkerController({ postMessage: (message) => messages.push(message) });
  await controller.handle({ type: "init" });
  await controller.handle({ type: "calibration-capture", step: "contact-6-open", glyph: "6", phase: "open", durationMs: 900, replace: true });
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: 500_000 + index * 16, landmarks: hand({ digit: 1 }) } });
  await controller.handle({ type: "calibration-capture", step: "contact-6-closed", glyph: "6", phase: "closed", durationMs: 900, replace: true });
  // Deliberately hold the same open shape during the touch pass.
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: 501_000 + index * 16, landmarks: hand({ digit: 1 }) } });
  await controller.handle({ type: "calibration-export" });

  const close = messages.filter((message) => message.type === "calibration-sample").find((message) => message.step === "contact-6-closed");
  assert.equal(close?.summary.phases.closed.complete, false);
  assert.match(close?.summary.reason || "", /overlap/);
  const draft = messages.findLast((message) => message.type === "calibration-draft").draft;
  assert.equal(draft.data.completed.contactPhase[6].open, true);
  assert.equal(draft.data.completed.contactPhase[6].closed, false);
});

test("worker finalizes a single checkpoint on its own timer without requiring another video frame", async () => {
  const messages = [];
  const controller = createVisionWorkerController({ postMessage: (message) => messages.push(message) });
  await controller.handle({ type: "init" });
  await controller.handle({ type: "calibration-capture", step: "pose-1", glyph: "1", durationMs: 500, replace: true });
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: 600_000 + index * 16, landmarks: hand({ digit: 1 }) } });
  await new Promise((resolve) => setTimeout(resolve, 560));
  const sample = messages.findLast((message) => message.type === "calibration-sample");
  assert.equal(sample?.step, "pose-1");
  assert.equal(sample?.summary.complete, true);
});

test("cancelling a recapture restores saved checkpoint data and emits no late sample", async () => {
  const messages = [];
  const controller = createVisionWorkerController({ postMessage: (message) => messages.push(message) });
  await controller.handle({ type: "init" });
  await controller.handle({ type: "calibration-capture", step: "pose-1", captureId: "first", glyph: "1", durationMs: 900, replace: true });
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: 700_000 + index * 16, landmarks: hand({ digit: 1 }) } });
  await controller.handle({ type: "calibration-export" });
  const completedSamples = messages.filter((message) => message.type === "calibration-sample").length;

  await controller.handle({ type: "calibration-capture", step: "pose-1", captureId: "cancel-me", glyph: "1", durationMs: 900, replace: true });
  await controller.handle({ type: "replay-frame", frame: { timestamp: 701_000, landmarks: hand({ digit: 2 }) } });
  await controller.handle({ type: "calibration-cancel", captureId: "cancel-me" });
  await controller.handle({ type: "calibration-export" });

  assert.equal(messages.filter((message) => message.type === "calibration-sample").length, completedSamples);
  const draft = messages.findLast((message) => message.type === "calibration-draft").draft;
  assert.equal(draft.data.poseSamples[1].length, 6);
  assert.equal(draft.data.completed.pose[1], true);
});

test("cancelling just after a recapture settles still restores saved checkpoint data", async () => {
  const messages = [];
  const controller = createVisionWorkerController({ postMessage: (message) => messages.push(message) });
  await controller.handle({ type: "init" });
  await controller.handle({ type: "calibration-capture", step: "pose-1", captureId: "saved", glyph: "1", durationMs: 900, replace: true });
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: 800_000 + index * 16, landmarks: hand({ digit: 1 }) } });
  await controller.handle({ type: "calibration-export" });

  await controller.handle({ type: "calibration-capture", step: "pose-1", captureId: "settled-then-cancelled", glyph: "1", durationMs: 900, replace: true });
  for (let index = 0; index < 6; index += 1) await controller.handle({ type: "replay-frame", frame: { timestamp: 801_000 + index * 16, landmarks: hand({ digit: 2 }) } });
  // Starting another operation settles the active capture synchronously, as
  // the worker timer would, before the queued dialog-close cancellation lands.
  await controller.handle({ type: "calibration-export" });
  await controller.handle({ type: "calibration-cancel", captureId: "settled-then-cancelled" });
  await controller.handle({ type: "calibration-export" });

  const draft = messages.findLast((message) => message.type === "calibration-draft").draft;
  assert.equal(draft.data.poseSamples[1].length, 6);
  assert.equal(draft.data.completed.pose[1], true);
});

test("a digit made two ways is learned as two shapes, and one made one way is not", () => {
  // Three is the sign people genuinely make more than one way: ASL three is
  // thumb, index and middle; the other common three is index, middle and ring.
  const aslThree = [0.9, 0.9, 1.2, 0.1, 0.1, 1.6, 0.1, 0.1, 1.7, 0.8, 0.8, 0.9, 0.9, 0.9, 0.8];
  const openThree = [0.2, 0.2, 0.7, 0.1, 0.1, 1.6, 0.1, 0.1, 1.7, 0.1, 0.1, 1.6, 0.9, 0.9, 0.8];
  const one = [0.2, 0.2, 0.7, 0.1, 0.1, 1.6, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8];
  const two = [0.2, 0.2, 0.7, 0.1, 0.1, 1.6, 0.1, 0.1, 1.7, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8];
  const four = [0.2, 0.2, 0.7, 0.1, 0.1, 1.6, 0.1, 0.1, 1.7, 0.1, 0.1, 1.6, 0.1, 0.1, 1.5];
  const five = [0.9, 0.9, 1.2, 0.1, 0.1, 1.6, 0.1, 0.1, 1.7, 0.1, 0.1, 1.6, 0.1, 0.1, 1.5];
  const spread = (vector, count, amount) => Array.from({ length: count }, (_, step) =>
    vector.map((value, index) => value + Math.sin(step * 7.3 + index * 1.7) * amount));

  const profile = buildPoseProfile({
    1: spread(one, 14, 0.055),
    2: spread(two, 14, 0.055),
    3: [...spread(aslThree, 8, 0.02), ...spread(openThree, 8, 0.02)],
    4: spread(four, 14, 0.055),
    5: spread(five, 14, 0.055),
  });

  assert.equal(profile.valid, true);
  assert.equal(profile.classes[3].variants.length, 2);
  // A digit performed one way, wobble and all, must not be split into two.
  assert.equal(profile.classes[1].variants.length, 1);

  // Both shapes of three are accepted, and each matches its own variant.
  const asl = classifyPose(profile, aslThree);
  const open = classifyPose(profile, openThree);
  assert.equal(asl.digit, 3);
  assert.equal(open.digit, 3);
  assert.ok(asl.accepted && open.accepted);
  assert.notEqual(asl.variant, open.variant);
  // Matching a variant rather than the pooled centre is what buys the headroom
  // that stops a drifting hand falling out of the class.
  assert.ok(asl.thresholdRatio < 0.2);
  assert.ok(open.thresholdRatio < 0.2);

  // The two-shape three must not swallow its neighbours.
  for (const [vector, digit] of [[one, 1], [two, 2], [four, 4], [five, 5]]) {
    const result = classifyPose(profile, vector);
    assert.equal(result.digit, digit);
    assert.equal(result.accepted, true);
  }

  // Profiles saved before variants existed still classify.
  const legacy = JSON.parse(JSON.stringify(profile));
  for (const entry of Object.values(legacy.classes)) delete entry.variants;
  assert.equal(classifyPose(legacy, one).digit, 1);
  assert.equal(classifyPose(legacy, one).accepted, true);
});

test("a fast performance re-arms between strikes", () => {
  // Drives the recognizer with a synthetic performer: strike down, recover up,
  // rest, repeat. The gate that used to fail here was three milliseconds short
  // of its own deadline, which looks exactly like a gate that does not work.
  const play = (periodMs, notes, fps) => {
    const stroke = new DownstrokeRecognizer();
    const step = 1000 / fps;
    const strikeMs = 70;
    const returnMs = 70;
    const restY = 0.4;
    const downY = 0.52;
    let hits = 0;
    for (let time = 0; time < periodMs * notes; time += step) {
      const phase = time % periodMs;
      let palmY = restY;
      if (phase < strikeMs) palmY = restY + (downY - restY) * (phase / strikeMs);
      else if (phase < strikeMs + returnMs) palmY = downY - (downY - restY) * ((phase - strikeMs) / returnMs);
      const result = stroke.update({
        timestamp: time,
        palmY,
        pose: { digit: 3, accepted: true, confidence: 0.9, reason: "accepted" },
      });
      if (result.hit) hits += 1;
    }
    return hits;
  };

  // Eighth notes at 150bpm, on a 30fps camera: every strike must register.
  assert.equal(play(200, 8, 30), 8);
  assert.equal(play(220, 8, 30), 8);
  assert.equal(play(200, 8, 60), 8);
  // Deliberate playing must still be exactly one note per strike, never two.
  assert.equal(play(600, 6, 30), 6);
  assert.equal(play(900, 6, 30), 6);
});

test("evidence gates are capped by their own millisecond budget", () => {
  const stroke = new DownstrokeRecognizer({ stableFrames: 3, stableMs: 65 });
  // A slow camera cannot afford three frames inside 65ms, so the gate asks for
  // the two it can — the millisecond budget governs, not the frame count.
  stroke.frameIntervalMs = 33.3;
  assert.equal(stroke.evidenceFrames(3, 65), 2);
  // A fast camera keeps all the evidence it can afford.
  stroke.frameIntervalMs = 16.7;
  assert.equal(stroke.evidenceFrames(3, 65), 3);
  // Never below two, so a single noisy sample can never satisfy a gate.
  stroke.frameIntervalMs = 80;
  assert.equal(stroke.evidenceFrames(3, 65), 2);
});

test("a held sign survives drift when nothing else is close, and yields when it is", () => {
  const three = [0.2, 0.2, 0.7, 0.1, 0.1, 1.6, 0.1, 0.1, 1.7, 0.1, 0.1, 1.6, 0.9, 0.9, 0.8];
  const two = [0.2, 0.2, 0.7, 0.1, 0.1, 1.6, 0.1, 0.1, 1.7, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8];
  const one = [0.2, 0.2, 0.7, 0.1, 0.1, 1.6, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8];
  const four = [0.2, 0.2, 0.7, 0.1, 0.1, 1.6, 0.1, 0.1, 1.7, 0.1, 0.1, 1.6, 0.1, 0.1, 1.5];
  const five = [0.9, 0.9, 1.2, 0.1, 0.1, 1.6, 0.1, 0.1, 1.7, 0.1, 0.1, 1.6, 0.1, 0.1, 1.5];
  const spread = (vector, count) => Array.from({ length: count }, (_, step) =>
    vector.map((value, index) => value + Math.sin(step * 7.3 + index * 1.7) * 0.03));
  const profile = buildPoseProfile({
    1: spread(one, 14), 2: spread(two, 14), 3: spread(three, 14),
    4: spread(four, 14), 5: spread(five, 14),
  });
  const blend = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);

  // A ring finger relaxing out of a three and returning: real drift, but no
  // other sign ever becomes a serious candidate.
  const stabilizer = new PoseStabilizer();
  let held = 0;
  for (let frame = 0; frame < 90; frame += 1) {
    const drift = 0.5 - 0.5 * Math.cos((frame / 89) * Math.PI * 2);
    const pose = classifyPose(profile, blend(three, two, drift * 0.42));
    if (stabilizer.update(pose, frame * 33.3).accepted) held += 1;
  }
  assert.equal(held, 90);

  // Drifting the whole way into a two must not be held as a three.
  const deep = new PoseStabilizer();
  let heldAsThreeAtPeak = 0;
  for (let frame = 0; frame < 90; frame += 1) {
    const drift = 0.5 - 0.5 * Math.cos((frame / 89) * Math.PI * 2);
    const pose = classifyPose(profile, blend(three, two, drift));
    const result = deep.update(pose, frame * 33.3);
    if (frame >= 40 && frame < 50 && result.accepted && result.digit === 3) heldAsThreeAtPeak += 1;
  }
  assert.equal(heldAsThreeAtPeak, 0);

  // And a deliberate change of sign still switches.
  const changing = new PoseStabilizer();
  let lastThree = null;
  let firstTwo = null;
  for (let frame = 0; frame < 60; frame += 1) {
    const pose = classifyPose(profile, blend(three, two, Math.min(1, frame / 25)));
    const result = changing.update(pose, frame * 33.3);
    if (result.accepted && result.digit === 3) lastThree = frame;
    if (result.accepted && result.digit === 2 && firstTwo === null) firstTwo = frame;
  }
  assert.ok(firstTwo !== null);
  assert.ok(firstTwo > lastThree);
});

test("the finger pattern reads a sign without any calibration, and knows both threes", () => {
  const shape = (thumb, index, middle, ring, pinky) => [
    thumb ? 0.95 : 0.2, thumb ? 0.95 : 0.2, thumb ? 1.2 : 0.6,
    index ? 0.95 : 0.2, index ? 0.95 : 0.2, index ? 1.6 : 0.9,
    middle ? 0.95 : 0.2, middle ? 0.95 : 0.2, middle ? 1.7 : 0.9,
    ring ? 0.95 : 0.2, ring ? 0.95 : 0.2, ring ? 1.6 : 0.9,
    pinky ? 0.95 : 0.2, pinky ? 0.95 : 0.2, pinky ? 1.5 : 0.8,
  ];
  const read = (...fingers) => digitFromFingers(fingerExtension(shape(...fingers)));

  assert.equal(read(0, 1, 0, 0, 0), 1);
  assert.equal(read(0, 1, 1, 0, 0), 2);
  // Both threes, which is the whole point: no calibrated distance can tell you
  // that thumb-index-middle and index-middle-ring are the same sign.
  assert.equal(read(1, 1, 1, 0, 0), 3);
  assert.equal(read(0, 1, 1, 1, 0), 3);
  assert.equal(read(0, 1, 1, 1, 1), 4);
  assert.equal(read(1, 1, 1, 1, 1), 5);
  // A closed fist agrees with "one" on four fingers out of five. It must not
  // be read as a one on that basis.
  assert.equal(read(0, 0, 0, 0, 0), null);
});

test("geometry rescues a drifting sign but never invents one", () => {
  const three = [0.2, 0.2, 0.7, 0.95, 0.95, 1.6, 0.95, 0.95, 1.7, 0.95, 0.95, 1.6, 0.2, 0.2, 0.8];
  const two = [0.2, 0.2, 0.7, 0.95, 0.95, 1.6, 0.95, 0.95, 1.7, 0.2, 0.2, 0.9, 0.2, 0.2, 0.8];
  const one = [0.2, 0.2, 0.7, 0.95, 0.95, 1.6, 0.2, 0.2, 0.9, 0.2, 0.2, 0.9, 0.2, 0.2, 0.8];
  const four = [0.2, 0.2, 0.7, 0.95, 0.95, 1.6, 0.95, 0.95, 1.7, 0.95, 0.95, 1.6, 0.95, 0.95, 1.5];
  const five = [0.9, 0.9, 1.2, 0.95, 0.95, 1.6, 0.95, 0.95, 1.7, 0.95, 0.95, 1.6, 0.95, 0.95, 1.5];
  const spread = (vector, count) => Array.from({ length: count }, (_, step) =>
    vector.map((value, index) => value + Math.sin(step * 7.3 + index * 1.7) * 0.03));
  const profile = buildPoseProfile({
    1: spread(one, 14), 2: spread(two, 14), 3: spread(three, 14),
    4: spread(four, 14), 5: spread(five, 14),
  });

  // The hand moves toward the camera: fingertip distances grow, but the same
  // fingers stay out. Geometry should carry the sign further than distance can.
  const reach = (vector, factor) => vector.map((value, index) => index % 3 === 2 ? value * factor : value);
  const far = classifyPose(profile, reach(three, 1.6));
  assert.equal(far.digit, 3);
  assert.equal(far.accepted, true);
  assert.equal(far.patternRescue, true);
  assert.equal(far.reason, "finger-pattern");

  // Every sign still reads as itself, without needing the rescue.
  for (const [vector, digit] of [[one, 1], [two, 2], [three, 3], [four, 4], [five, 5]]) {
    const result = classifyPose(profile, vector);
    assert.equal(result.digit, digit);
    assert.equal(result.accepted, true);
    assert.equal(result.patternRescue, false);
  }

  // A fist is not close to anything and its pattern is not decisive, so it
  // cannot be rescued into a sign.
  const fist = [0.2, 0.2, 0.5, 0.2, 0.2, 0.6, 0.2, 0.2, 0.6, 0.2, 0.2, 0.6, 0.2, 0.2, 0.6];
  const closed = classifyPose(profile, fist);
  assert.equal(closed.patternDigit, null);
  assert.equal(closed.accepted, false);
});

test("a decisive return ends a stroke without waiting out the recovery clock", () => {
  const pose = { digit: 3, accepted: true, confidence: 0.9, reason: "accepted" };
  // Fixed strike and return, as a player actually performs: the gesture takes
  // the same time and only the gap between notes changes.
  const play = (periodMs, notes, fps) => {
    const stroke = new DownstrokeRecognizer();
    const step = 1000 / fps;
    const strikeMs = Math.min(70, periodMs * 0.45);
    const returnMs = Math.min(70, periodMs * 0.45);
    const restY = 0.4;
    const downY = 0.52;
    let hits = 0;
    for (let time = 0; time < periodMs * notes; time += step) {
      const phase = time % periodMs;
      let palmY = restY;
      if (phase < strikeMs) palmY = restY + (downY - restY) * (phase / strikeMs);
      else if (phase < strikeMs + returnMs) palmY = downY - (downY - restY) * ((phase - strikeMs) / returnMs);
      if (stroke.update({ timestamp: time, palmY, pose }).hit) hits += 1;
    }
    return hits;
  };

  // A 60fps camera carries sixteenths at 100bpm.
  assert.equal(play(180, 10, 60), 10);
  // A 30fps camera still carries a 200ms period exactly.
  assert.equal(play(200, 10, 30), 10);
  // Deliberate playing must remain exactly one note per strike at every tempo,
  // which is what the recovery clock was protecting in the first place.
  for (const period of [400, 500, 600, 700, 900]) {
    assert.equal(play(period, 6, 30), 6);
  }
});

test("a decisive upward whip releases a stroke on a single frame", () => {
  const pose = { digit: 3, accepted: true, confidence: 0.9, reason: "accepted" };
  const play = (periodMs, notes, fps) => {
    const stroke = new DownstrokeRecognizer();
    const step = 1000 / fps;
    const strikeMs = Math.min(70, periodMs * 0.45);
    const returnMs = Math.min(70, periodMs * 0.45);
    const restY = 0.4;
    const downY = 0.52;
    let hits = 0;
    for (let time = 0; time < periodMs * notes; time += step) {
      const phase = time % periodMs;
      let palmY = restY;
      if (phase < strikeMs) palmY = restY + (downY - restY) * (phase / strikeMs);
      else if (phase < strikeMs + returnMs) palmY = downY - (downY - restY) * ((phase - strikeMs) / returnMs);
      if (stroke.update({ timestamp: time, palmY, pose }).hit) hits += 1;
    }
    return hits;
  };

  // A 30fps camera gives about four frames for a strike and its return, which
  // leaves the displacement test too few. Velocity carries it instead.
  for (const period of [180, 160, 150, 140]) {
    assert.equal(play(period, 10, 30), 10);
  }
  // Deliberate playing is still exactly one note per strike.
  for (const period of [400, 600, 900]) {
    assert.equal(play(period, 6, 30), 6);
  }

  // A resting hand with tremor and noise must never release itself into notes:
  // the velocity floor has to sit above anything jitter can produce.
  for (const amplitude of [0.004, 0.008, 0.014]) {
    const stroke = new DownstrokeRecognizer();
    let spurious = 0;
    for (let index = 0, time = 0; index < 300; index += 1, time += 1000 / 30) {
      const palmY = 0.4 + Math.sin((time / 1000) * Math.PI * 2 * 6) * amplitude;
      if (stroke.update({ timestamp: time, palmY, pose }).hit) spurious += 1;
    }
    assert.equal(spurious, 0);
  }
});

test("geometry recovers a sign the profile never saw, without taking over", () => {
  const shape = (thumb, index, middle, ring, pinky) => [
    thumb ? 0.95 : 0.2, thumb ? 0.95 : 0.2, thumb ? 1.2 : 0.6,
    index ? 0.95 : 0.2, index ? 0.95 : 0.2, index ? 1.6 : 0.9,
    middle ? 0.95 : 0.2, middle ? 0.95 : 0.2, middle ? 1.7 : 0.9,
    ring ? 0.95 : 0.2, ring ? 0.95 : 0.2, ring ? 1.6 : 0.9,
    pinky ? 0.95 : 0.2, pinky ? 0.95 : 0.2, pinky ? 1.5 : 0.8,
  ];
  const one = shape(0, 1, 0, 0, 0);
  const two = shape(0, 1, 1, 0, 0);
  const aslThree = shape(1, 1, 1, 0, 0);
  const openThree = shape(0, 1, 1, 1, 0);
  const four = shape(0, 1, 1, 1, 1);
  const five = shape(1, 1, 1, 1, 1);
  const spread = (vector, count) => Array.from({ length: count }, (_, step) =>
    vector.map((value, index) => value + Math.sin(step * 7.3 + index * 1.7) * 0.03));
  const withThree = (three) => buildPoseProfile({
    1: spread(one, 14), 2: spread(two, 14), 3: spread(three, 14),
    4: spread(four, 14), 5: spread(five, 14),
  });

  // Whichever three was calibrated, both are playable. The uncalibrated one
  // lands nearest to *two* and well outside it, so only geometry can save it.
  for (const [calibrated, other] of [[aslThree, openThree], [openThree, aslThree]]) {
    const profile = withThree(calibrated);
    const known = classifyPose(profile, calibrated);
    assert.equal(known.digit, 3);
    assert.equal(known.accepted, true);
    assert.equal(known.reason, "accepted");

    const unknown = classifyPose(profile, other);
    assert.equal(unknown.digit, 3);
    assert.equal(unknown.accepted, true);
    assert.equal(unknown.patternOverride, true);
    // A rescue must carry less weight than a calibrated match.
    assert.ok(unknown.confidence < known.confidence);
  }

  // Every other digit stays owned by its calibration.
  const profile = withThree(aslThree);
  for (const [vector, digit] of [[one, 1], [two, 2], [four, 4], [five, 5]]) {
    const result = classifyPose(profile, vector);
    assert.equal(result.digit, digit);
    assert.equal(result.reason, "accepted");
    assert.equal(!!result.patternOverride, false);
  }

  // A half-made shape can pattern as a clean digit, because half-bent fingers
  // genuinely read as folded. Nothing static can tell that from a real sign —
  // the strike is what does, so changing sign without striking makes no note.
  const blend = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);
  const stroke = new DownstrokeRecognizer();
  let notes = 0;
  for (let frame = 0, time = 0; frame < 90; frame += 1, time += 1000 / 30) {
    const morph = frame < 30 ? 0 : frame > 45 ? 1 : (frame - 30) / 15;
    const pose = classifyPose(profile, blend(one, openThree, morph));
    if (stroke.update({ timestamp: time, palmY: 0.4, pose }).hit) notes += 1;
  }
  assert.equal(notes, 0);
});

test("geometry vouches for a held sign, and lets go the moment it changes", () => {
  const shape = (thumb, index, middle, ring, pinky) => [
    thumb ? 0.95 : 0.2, thumb ? 0.95 : 0.2, thumb ? 1.2 : 0.6,
    index ? 0.95 : 0.2, index ? 0.95 : 0.2, index ? 1.6 : 0.9,
    middle ? 0.95 : 0.2, middle ? 0.95 : 0.2, middle ? 1.7 : 0.9,
    ring ? 0.95 : 0.2, ring ? 0.95 : 0.2, ring ? 1.6 : 0.9,
    pinky ? 0.95 : 0.2, pinky ? 0.95 : 0.2, pinky ? 1.5 : 0.8,
  ];
  const one = shape(0, 1, 0, 0, 0);
  const two = shape(0, 1, 1, 0, 0);
  const three = shape(0, 1, 1, 1, 0);
  const four = shape(0, 1, 1, 1, 1);
  const five = shape(1, 1, 1, 1, 1);
  const spread = (vector, count) => Array.from({ length: count }, (_, step) =>
    vector.map((value, index) => value + Math.sin(step * 7.3 + index * 1.7) * 0.03));
  const profile = buildPoseProfile({
    1: spread(one, 14), 2: spread(two, 14), 3: spread(three, 14),
    4: spread(four, 14), 5: spread(five, 14),
  });
  const blend = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);

  // Holding a three while a neighbouring finger creeps out and back. The
  // calibrated distance gives up part way through; the pattern does not.
  for (const neighbour of [four, two]) {
    const stabilizer = new PoseStabilizer();
    let held = 0;
    for (let frame = 0; frame < 90; frame += 1) {
      const drift = 0.5 - 0.5 * Math.cos((frame / 89) * Math.PI * 2);
      const pose = classifyPose(profile, blend(three, neighbour, drift * 0.55));
      if (stabilizer.update(pose, frame * 33.3).accepted) held += 1;
    }
    assert.equal(held, 90);
  }

  // The pattern is its own guard: a real change of sign changes the pattern,
  // which releases the hold at once rather than stranding the old digit.
  for (const [target, digit] of [[two, 2], [four, 4], [five, 5]]) {
    const stabilizer = new PoseStabilizer();
    let lastThree = null;
    let switched = null;
    for (let frame = 0; frame < 70; frame += 1) {
      const pose = classifyPose(profile, blend(three, target, Math.min(1, frame / 25)));
      const result = stabilizer.update(pose, frame * 33.3);
      if (result.accepted && result.digit === 3) lastThree = frame;
      if (result.accepted && result.digit === digit && switched === null) switched = frame;
    }
    assert.ok(switched !== null);
    assert.ok(switched > lastThree);
    // Within a couple of frames of the old sign being let go, not seconds.
    assert.ok(switched - lastThree <= 3);
  }
});
