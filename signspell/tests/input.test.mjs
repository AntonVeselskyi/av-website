import assert from "node:assert/strict";
import test from "node:test";

import { digitFromKeyEvent, loopPedalActionFromKeyEvent } from "../js/input.js";

test("manual note input maps top-row and numpad keys by physical code", () => {
  assert.equal(digitFromKeyEvent({ code: "Digit9", key: "(" }), 9);
  assert.equal(digitFromKeyEvent({ code: "Numpad9", key: "PageUp" }), 9);
  assert.equal(digitFromKeyEvent({ code: "Numpad1", key: "End" }), 1);
  assert.equal(digitFromKeyEvent({ code: "KeyA", key: "a" }), null);
});

test("loop pedal uses the physical A/S/D positions", () => {
  assert.equal(loopPedalActionFromKeyEvent({ code: "KeyA", key: "q" }), "record");
  assert.equal(loopPedalActionFromKeyEvent({ code: "KeyS", key: "s" }), "transport");
  assert.equal(loopPedalActionFromKeyEvent({ code: "KeyD", key: "д" }), "undo");
});

test("loop pedal ignores unrelated and modified shortcuts", () => {
  assert.equal(loopPedalActionFromKeyEvent({ code: "KeyN" }), null);
  assert.equal(loopPedalActionFromKeyEvent({ code: "KeyA", ctrlKey: true }), null);
  assert.equal(loopPedalActionFromKeyEvent({ code: "KeyD", metaKey: true }), null);
});
