import assert from "node:assert/strict";
import test from "node:test";

import {
  SPELL_VISUALIZER_MODE_ALIASES,
  SPELL_VISUALIZER_MODE_LABELS,
  SPELL_VISUALIZER_MODES,
} from "../js/visual/visualizer.js";
import { tunnelTempoScale } from "../js/visual/modes/wired-tunnel.js";
import { orbitZoomCycle } from "../js/visual/modes/serial-orbit.js";

test("visualizer exposes the projected wired and serial orbit scenes", () => {
  assert.equal(SPELL_VISUALIZER_MODE_ALIASES.wired, SPELL_VISUALIZER_MODES.WIRED_TUNNEL);
  assert.equal(SPELL_VISUALIZER_MODE_ALIASES.orbit, SPELL_VISUALIZER_MODES.SERIAL_ORBIT);
  assert.match(SPELL_VISUALIZER_MODE_LABELS[SPELL_VISUALIZER_MODES.SERIAL_ORBIT], /orbit/);
});

test("wired tunnel travel scales monotonically with workstation tempo", () => {
  assert.equal(tunnelTempoScale(120), 1);
  assert.ok(tunnelTempoScale(80) < tunnelTempoScale(120));
  assert.ok(tunnelTempoScale(180) > tunnelTempoScale(120));
});

test("orbit galaxy shells continuously recede and fade before recycling", () => {
  const near = orbitZoomCycle(1);
  const far = orbitZoomCycle(6);
  assert.ok(near.scale > far.scale);
  assert.ok(near.alpha > 0);
  assert.ok(far.alpha > 0);
  assert.equal(orbitZoomCycle(0).alpha, 0);
});
