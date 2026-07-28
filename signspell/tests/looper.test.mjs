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

test("a fresh recording replays from the bar where its loop began", () => {
  const project = createDefaultProject();
  project.tonalScene.bpm = 60;
  const lane = project.lanes[0];
  lane.lengthBars = 2;
  lane.overdub = false;
  let audioTime = 3.5;
  const scheduled = [];
  const transport = new LoopTransport({ getAudioTime: () => audioTime, scheduleEvent: (event) => scheduled.push(event.eventBeat), project });
  transport.playing = true;
  transport.startedAt = 0;

  assert.equal(transport.armLane(lane.id), 4);
  assert.equal(lane.loopOriginBeat, 4);
  transport.updateRecordStates(4);
  audioTime = 4.25;
  assert.equal(transport.captureHit({ digit: 3 }, lane.id)?.beat, 0.25);
  assert.equal(transport.localBeatForLane(lane, 12.25), 0.25);

  transport.scheduleRange(8, 8.5);
  assert.deepEqual(scheduled, []);
  transport.scheduleRange(12, 12.5);
  assert.deepEqual(scheduled, [12.25]);
});

test("overdubbed hits retain the existing line phase", () => {
  const project = createDefaultProject();
  project.tonalScene.bpm = 60;
  const lane = project.lanes[0];
  lane.lengthBars = 2;
  lane.overdub = true;
  lane.events = [{ id: "old", beat: 1, digit: 1, velocity: 0.8, duration: 0.25 }];
  let audioTime = 3.5;
  const transport = new LoopTransport({ getAudioTime: () => audioTime, scheduleEvent: () => {}, project });
  transport.playing = true;
  transport.startedAt = 0;

  assert.equal(transport.armLane(lane.id), 4);
  assert.equal(lane.loopOriginBeat, 0);
  transport.updateRecordStates(4);
  audioTime = 4.25;
  assert.equal(transport.captureHit({ digit: 5 }, lane.id)?.beat, 4.25);
  assert.equal(transport.localBeatForLane(lane, 4.25), 4.25);
});

test("a new transport epoch clears live and undo loop origins", () => {
  const project = createDefaultProject();
  const lane = project.lanes[0];
  lane.loopOriginBeat = 8;
  lane.undoLoopOriginBeat = 4;
  const transport = new LoopTransport({ getAudioTime: () => 0, scheduleEvent: () => {}, project });
  transport.start();
  assert.equal(lane.loopOriginBeat, 0);
  assert.equal(lane.undoLoopOriginBeat, 0);
  transport.stop();
});
