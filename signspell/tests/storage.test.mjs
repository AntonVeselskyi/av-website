import assert from "node:assert/strict";
import test from "node:test";

import { createAutosaver } from "../js/storage.js";

test("cancelling autosave prevents old project state from racing a restore", async () => {
  const saved = [];
  const autosave = createAutosaver((value) => saved.push(value), 15);
  autosave("old-project");
  autosave.cancel();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.deepEqual(saved, []);
});
