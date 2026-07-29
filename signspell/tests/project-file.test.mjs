import assert from "node:assert/strict";
import test from "node:test";

import {
  SSPELL_FILE_VERSION,
  parseProjectFile,
  projectFileName,
  serializeProjectFile,
} from "../js/project-file.js";
import { createDefaultProject } from "../js/shared.js";

test(".sspell round trip preserves musical project state and excludes runtime state", () => {
  const source = createDefaultProject();
  const lane = source.lanes[0];
  source.activeLaneId = lane.id;
  source.tonalScene = { ...source.tonalScene, root: "F#", gamma: "dorian", noteOrder: "descending", bpm: 126 };
  source.master = { volume: 0.61, subBoost: 0.77, distortion: 0.24, reverb: 0.48 };
  Object.assign(lane, {
    collectionId: "psychedelicSun",
    instrumentFamily: "bass",
    gain: 0.68,
    reverb: 0.31,
    letRing: false,
    muted: true,
    solo: true,
    armed: true,
    recording: true,
    loopOriginBeat: 99,
    undoSnapshot: [{ id: "private-runtime-copy" }],
    events: [{ id: "note-a", beat: 1.25, digit: 9, velocity: 0.83, duration: 0.75, source: "gesture" }],
  });

  const serialized = serializeProjectFile(source, "2026-07-29T12:00:00.000Z");
  const envelope = JSON.parse(serialized);
  assert.equal(envelope.fileVersion, SSPELL_FILE_VERSION);
  assert.equal(envelope.exportedAt, "2026-07-29T12:00:00.000Z");
  assert.equal("armed" in envelope.project.lanes[0], false);
  assert.equal("recording" in envelope.project.lanes[0], false);
  assert.equal("loopOriginBeat" in envelope.project.lanes[0], false);
  assert.equal("undoSnapshot" in envelope.project.lanes[0], false);

  const { project, warnings } = parseProjectFile(serialized);
  assert.deepEqual(warnings, []);
  assert.equal(project.tonalScene.root, "F#");
  assert.equal(project.tonalScene.noteOrder, "descending");
  assert.equal(project.master.reverb, 0.48);
  assert.equal(project.activeLaneId, lane.id);
  assert.equal(project.lanes[0].collectionId, "psychedelicSun");
  assert.equal(project.lanes[0].instrumentFamily, "bass");
  assert.equal(project.lanes[0].letRing, false);
  assert.equal(project.lanes[0].muted, true);
  assert.equal(project.lanes[0].solo, true);
  assert.deepEqual(project.lanes[0].events[0], {
    id: "note-a", beat: 1.25, digit: 9, degree: 9, velocity: 0.83, duration: 0.75, source: "gesture",
  });
  assert.equal(project.lanes[0].armed, false);
  assert.equal(project.lanes[0].recording, false);
});

test(".sspell restore rejects unrelated and future files", () => {
  assert.throws(() => parseProjectFile("not json"), /not a readable/i);
  assert.throws(() => parseProjectFile(JSON.stringify({ format: "other", fileVersion: 1, project: {} })), /not a Sign Spell/i);
  assert.throws(() => parseProjectFile(JSON.stringify({ format: "sign-spell-project", fileVersion: 99, project: {} })), /Unsupported/i);
  assert.throws(() => parseProjectFile(JSON.stringify({ format: "sign-spell-project", fileVersion: 1, project: { schemaVersion: 99, lanes: [] } })), /newer Sign Spell/i);
});

test(".sspell restore repairs unsafe IDs and drops invalid notes", () => {
  const payload = {
    format: "sign-spell-project",
    fileVersion: 1,
    project: {
      schemaVersion: 1,
      activeLaneId: "same",
      lanes: [
        { id: "same", collectionId: "toString", instrumentFamily: "__proto__", events: [{ id: "x", beat: 1, digit: 2 }, { id: "x", beat: 2, digit: 3 }, { beat: "bad", digit: 10 }] },
        { id: "same", events: [] },
      ],
    },
  };
  const { project, warnings } = parseProjectFile(JSON.stringify(payload));
  assert.equal(new Set(project.lanes.map((lane) => lane.id)).size, project.lanes.length);
  assert.equal(new Set(project.lanes[0].events.map((event) => event.id)).size, 2);
  assert.equal(project.lanes[0].events.length, 2);
  assert.equal(project.lanes[0].collectionId, "wiltedBedroom");
  assert.equal(project.lanes[0].instrumentFamily, "808");
  assert.equal(project.activeLaneId, "same");
  assert.ok(warnings.length >= 2);
});

test("projectFileName uses the .sspell extension", () => {
  assert.equal(projectFileName(new Date("2026-07-29T12:34:00.000Z")), "sign-spell-2026-07-29-1234.sspell");
});
