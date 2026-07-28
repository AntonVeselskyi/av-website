import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProject, normalizeProject, quantizeBeat } from "../js/shared.js";
import { createTonalScene, resolveInstrumentGesture } from "../js/music/index.js";

test("quantizeBeat snaps to the selected musical grid", () => {
  assert.equal(quantizeBeat(1.12, "1/16"), 1);
  assert.equal(quantizeBeat(1.14, "1/8"), 1);
  assert.equal(quantizeBeat(1.27, "1/16"), 1.25);
  assert.equal(quantizeBeat(1.27, "off"), 1.27);
});

test("default project exposes eight independent lanes", () => {
  const project = createDefaultProject();
  assert.equal(project.lanes.length, 8);
  assert.equal(new Set(project.lanes.map((lane) => lane.id)).size, 8);
  const scene = createTonalScene(project.tonalScene);
  const hit = resolveInstrumentGesture({ instrument: "808", gesture: 6, scene, collectionId: "cemeteryTape" });
  assert.equal(hit.presetId, "tapeGrave");
  assert.ok(Number.isFinite(hit.note.frequency));
});

test("normalizeProject migrates malformed data without resuming live recording state", () => {
  const project = normalizeProject({ lanes: [{ id: "kept", events: null, armed: true, recording: true, loopOriginBeat: 12 }], tonalScene: { bpm: 999 } });
  assert.equal(project.lanes.length, 8);
  assert.deepEqual(project.lanes[0].events, []);
  assert.equal(project.activeLaneId, "kept");
  assert.equal(project.lanes[0].armed, false);
  assert.equal(project.lanes[0].recording, false);
  assert.equal(project.lanes[0].loopOriginBeat, 0);
});
