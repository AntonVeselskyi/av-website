import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalibrationProfile,
  calibrationFromStorage,
  calibrationToStorage,
  classifyPose,
  ContactRecognizer,
  contactDistances,
  normalizeLandmarks,
  poseFeatures,
  SignSpellRecognizer,
  createVisionWorkerController,
} from "../../js/vision/index.js";

function hand({ digit = 1, y = 0.6, contact = null } = {}) {
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
  return points;
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

test("contact recognizer fires once, requires release, and rejects ambiguity", () => {
  // Use a direct, deterministic profile here to test the state machine alone.
  const recognizer = new ContactRecognizer({
    valid: true,
    contacts: Object.fromEntries([6, 7, 8, 9].map((digit) => [digit, { threshold: 0.2, release: 0.4, minClosingSpeed: 0.05 }])),
  });
  recognizer.update({ timestamp: 0, distances: { 6: 0.8, 7: 0.8, 8: 0.8, 9: 0.8 } });
  const first = recognizer.update({ timestamp: 20, distances: { 6: 0.1, 7: 0.8, 8: 0.8, 9: 0.8 } });
  assert.equal(first.hit?.digit, 6);
  assert.equal(recognizer.update({ timestamp: 40, distances: { 6: 0.1, 7: 0.8, 8: 0.8, 9: 0.8 } }).hit, null);
  recognizer.update({ timestamp: 60, distances: { 6: 0.6, 7: 0.8, 8: 0.8, 9: 0.8 } });
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

test("worker controller replays landmark frames without a webcam or detector", async () => {
  const messages = [];
  const controller = createVisionWorkerController({ postMessage: (message) => messages.push(message) });
  await controller.handle({ type: "init", profile: profile() });
  await controller.handle({ type: "replay-frame", frame: { timestamp: 0, landmarks: hand({ digit: 1 }) } });
  await controller.handle({ type: "replay-frame", frame: { timestamp: 20, landmarks: hand({ digit: 1, contact: 8 }) } });
  assert.equal(messages.find((message) => message.type === "ready")?.detectorReady, false);
  assert.deepEqual(messages.find((message) => message.type === "hit")?.hit.digit, 8);
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

test("contacts can require the calibrated palm-facing view", () => {
  const recognizer = new ContactRecognizer(descriptorProfile().contacts);
  recognizer.update({ timestamp: 0, view: -1, distances: { 6: 0.8, 7: 0.8, 8: 0.8, 9: 0.8 } });
  assert.equal(recognizer.update({ timestamp: 20, view: -1, distances: { 6: 0.1, 7: 0.8, 8: 0.8, 9: 0.8 } }).hit, null);
  recognizer.update({ timestamp: 40, view: 1, distances: { 6: 0.8, 7: 0.8, 8: 0.8, 9: 0.8 } });
  assert.equal(recognizer.update({ timestamp: 60, view: 1, distances: { 6: 0.1, 7: 0.8, 8: 0.8, 9: 0.8 } }).hit?.digit, 6);
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
