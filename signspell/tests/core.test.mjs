import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProject, normalizeProject, quantizeBeat, sanitizeLaneLength } from "../js/shared.js";
import { createTonalScene, resolveInstrumentGesture } from "../js/music/index.js";

test("quantizeBeat snaps to the selected musical grid", () => {
  assert.equal(quantizeBeat(1.12, "1/16"), 1);
  assert.equal(quantizeBeat(1.14, "1/8"), 1);
  assert.equal(quantizeBeat(1.27, "1/16"), 1.25);
  assert.equal(quantizeBeat(1.27, "off"), 1.27);
});

test("default project starts with three independent dynamic lanes", () => {
  const project = createDefaultProject();
  assert.equal(project.lanes.length, 3);
  assert.equal(new Set(project.lanes.map((lane) => lane.id)).size, 3);
  const scene = createTonalScene(project.tonalScene);
  const hit = resolveInstrumentGesture({ instrument: "808", gesture: 6, scene, collectionId: "cemeteryTape" });
  assert.equal(hit.presetId, "tapeGrave");
  assert.ok(Number.isFinite(hit.note.frequency));
  assert.equal(project.master.reverb, 0.34);
  assert.equal(project.lanes[0].reverb, 0.18);
  assert.equal(project.lanes[0].letRing, true);
});

test("normalizeProject migrates malformed data without resuming live recording state", () => {
  const project = normalizeProject({ lanes: [{ id: "kept", events: null, armed: true, recording: true, loopOriginBeat: 12 }], tonalScene: { bpm: 999 } });
  assert.equal(project.lanes.length, 3);
  assert.deepEqual(project.lanes[0].events, []);
  assert.equal(project.activeLaneId, "kept");
  assert.equal(project.lanes[0].armed, false);
  assert.equal(project.lanes[0].recording, false);
  assert.equal(project.lanes[0].loopOriginBeat, 0);
  assert.equal(project.master.reverb, 0.34);
  assert.equal(project.lanes[0].reverb, 0.18);
  assert.equal(project.lanes[0].letRing, true);
});

test("supported 16-bar lanes persist while malformed lengths fall back safely", () => {
  assert.equal(sanitizeLaneLength("16"), 16);
  assert.equal(sanitizeLaneLength(3), 2);
  const long = normalizeProject({ activeLaneId: "long", lanes: [{ id: "long", lengthBars: 16, events: [] }] });
  const malformed = normalizeProject({ lanes: [{ lengthBars: -8, events: [] }] });
  assert.equal(long.lanes[0].lengthBars, 16);
  assert.equal(malformed.lanes[0].lengthBars, 2);
});
