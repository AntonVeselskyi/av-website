import assert from "node:assert/strict";
import test from "node:test";

import { LoopTransport } from "../js/looper.js";
import { createDefaultProject } from "../js/shared.js";

test("recording starts immediately when stopped and ends after one loop pass", () => {
  const project = createDefaultProject();
  const lane = project.lanes[0];
  let audioTime = 2;
  const transport = new LoopTransport({ getAudioTime: () => audioTime, scheduleEvent: () => {}, project });
  transport.armLane(lane.id);
  assert.equal(lane.armed, false);
  assert.equal(lane.recording, true);
  assert.equal(lane.recordStartedBeat, 0);
  const captured = transport.captureHit({ digit: 4, velocity: 0.7, source: "keyboard" }, lane.id);
  assert.equal(captured.digit, 4);
  assert.equal(lane.events.length, 1);
  transport.updateRecordStates(lane.lengthBars * 4);
  assert.equal(lane.recording, false);
  transport.stop();
});

test("recording arms for the next bar while transport is already playing", () => {
  const project = createDefaultProject();
  const lane = project.lanes[0];
  const transport = new LoopTransport({ getAudioTime: () => 1, scheduleEvent: () => {}, project });
  transport.playing = true;
  transport.startedAt = 0;
  const armBeat = transport.armLane(lane.id);
  assert.equal(armBeat, 4);
  assert.equal(lane.armed, true);
  assert.equal(lane.recording, false);
  transport.updateRecordStates(4);
  assert.equal(lane.recording, true);
});

test("tempo rebasing preserves the current beat while playback is running", () => {
  const project = createDefaultProject();
  project.tonalScene.bpm = 140;
  let audioTime = 10;
  const transport = new LoopTransport({ getAudioTime: () => audioTime, scheduleEvent: () => {}, project });
  transport.playing = true;
  transport.startedAt = 0;
  const before = transport.currentBeat();
  project.tonalScene.bpm = 100;
  const rebased = transport.rebaseTempo(140);
  assert.ok(Math.abs(rebased - before) < 1e-9);
  assert.ok(Math.abs(transport.currentBeat() - before) < 1e-9);
  audioTime += 0.6;
  assert.ok(Math.abs(transport.currentBeat() - (before + 1)) < 1e-9);
});
