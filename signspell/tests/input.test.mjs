import assert from "node:assert/strict";
import test from "node:test";

import { digitFromKeyEvent } from "../js/input.js";

test("manual note input maps top-row and numpad keys by physical code", () => {
  assert.equal(digitFromKeyEvent({ code: "Digit9", key: "(" }), 9);
  assert.equal(digitFromKeyEvent({ code: "Numpad9", key: "PageUp" }), 9);
  assert.equal(digitFromKeyEvent({ code: "Numpad1", key: "End" }), 1);
  assert.equal(digitFromKeyEvent({ code: "KeyA", key: "a" }), null);
});
