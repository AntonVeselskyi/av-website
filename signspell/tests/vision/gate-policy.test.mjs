import assert from "node:assert/strict";
import test from "node:test";

import { shouldReleaseVisionGate } from "../../js/vision/gate-policy.js";

const downstroke = { source: "vision-downstroke", digit: 1 };

test("ambiguous and missing-hand diagnostics preserve a physically locked downstroke", () => {
  assert.equal(shouldReleaseVisionGate(downstroke, {
    hand: { detected: true },
    pose: { digit: 2, accepted: false, reason: "outside-calibration" },
    downstroke: { state: "locked", reason: "awaiting-recovery" },
  }), false);
  assert.equal(shouldReleaseVisionGate(downstroke, {
    hand: { detected: false },
    downstroke: { state: "locked", reason: "armed-hand-gap" },
  }), false);
});

test("recovery releases downstrokes and hand loss releases fingertip contacts", () => {
  assert.equal(shouldReleaseVisionGate(downstroke, {
    hand: { detected: true },
    downstroke: { state: "neutral", reason: "recovered" },
  }), true);
  assert.equal(shouldReleaseVisionGate({ source: "vision-contact", digit: 7 }, {
    hand: { detected: false },
    fingertips: { contacts: { 7: { latched: true } } },
  }), true);
});
