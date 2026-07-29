import assert from "node:assert/strict";
import test from "node:test";

import {
  SPELL_VISUALIZER_MODE_ALIASES,
  SPELL_VISUALIZER_MODE_LABELS,
  SPELL_VISUALIZER_MODES,
} from "../js/visual/visualizer.js";

test("visualizer exposes the projected wired and serial orbit scenes", () => {
  assert.equal(SPELL_VISUALIZER_MODE_ALIASES.wired, SPELL_VISUALIZER_MODES.WIRED_TUNNEL);
  assert.equal(SPELL_VISUALIZER_MODE_ALIASES.orbit, SPELL_VISUALIZER_MODES.SERIAL_ORBIT);
  assert.match(SPELL_VISUALIZER_MODE_LABELS[SPELL_VISUALIZER_MODES.SERIAL_ORBIT], /orbit/);
});
