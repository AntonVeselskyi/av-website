import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalibrationProfile,
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
  assert.equal(stroke.update({ timestamp: 420, palmY: 0.45, pose: rejected }).state, "neutral");
});

test("a missing locked hand expires after the reacquisition window", () => {
  const stroke = new DownstrokeRecognizer({ stableFrames: 3, stableMs: 40, maxReacquireMs: 460 });
  const pose = { digit: 1, accepted: true, confidence: 0.9 };
  for (const timestamp of [0, 20, 40, 60, 80]) stroke.update({ timestamp, palmY: 0.5, pose });
  stroke.update({ timestamp: 116, palmY: 0.82, pose });
  assert.equal(stroke.markMissing(140).state, "locked");
  const expired = stroke.markMissing(620);
  assert.equal(expired.state, "neutral");
  assert.equal(expired.reason, "hand-gap-timeout");
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
