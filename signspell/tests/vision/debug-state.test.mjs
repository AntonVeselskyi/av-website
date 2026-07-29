import assert from "node:assert/strict";
import test from "node:test";

import { resolveLiveGestureDebugState } from "../../js/vision/debug-state.js";

const base = {
  hand: { detected: true, confidence: 0.9 },
  fingertips: { contacts: {} },
  downstroke: { state: "armed" },
};

test("live debug exposes a 1-5 pose before any downstroke hit", () => {
  const state = resolveLiveGestureDebugState({ ...base, pose: { digit: 3, accepted: true, confidence: 0.82 } });
  assert.equal(state.digit, "3");
  assert.equal(state.state, "SIGN 3 / READY – DIP");
  assert.equal(state.kind, "pose");
});

test("live debug names a static 6-9 contact as its sign", () => {
  const state = resolveLiveGestureDebugState({
    ...base,
    pose: { digit: 1, accepted: false, confidence: 0.1 },
    fingertips: { contacts: { 7: { distance: 0.1, withinThreshold: true, phase: "contact", intentConfidence: 0.8 } } },
  });
  assert.equal(state.digit, "7");
  assert.equal(state.state, "SIGN 7 / TOUCH");
  assert.equal(state.kind, "contact");
});

test("wrong-view contacts do not override the visible pose candidate", () => {
  const state = resolveLiveGestureDebugState({
    ...base,
    pose: { digit: 4, accepted: true, confidence: 0.75 },
    fingertips: { contacts: { 9: { distance: 0.1, withinThreshold: true, phase: "wrong-view", intentConfidence: 0.9 } } },
  });
  assert.equal(state.digit, "4");
  assert.equal(state.kind, "pose");
});

test("a rejected closest pose says shape mismatch and preserves held feedback", () => {
  const state = resolveLiveGestureDebugState({
    ...base,
    pose: { digit: 2, accepted: false, confidence: 0.31, reason: "outside-calibration" },
    downstroke: { state: "locked" },
  });
  assert.equal(state.digit, "2?");
  assert.equal(state.state, "CLOSEST 2 / HOLDING / SHAPE MISMATCH");
});
