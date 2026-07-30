import assert from "node:assert/strict";
import test from "node:test";

import {
  SPELL_VISUALIZER_MODE_ALIASES,
  SPELL_VISUALIZER_MODE_LABELS,
  SPELL_VISUALIZER_MODES,
} from "../js/visual/visualizer.js";
import { tunnelTempoScale } from "../js/visual/modes/wired-tunnel.js";
import { orbitZoomCycle } from "../js/visual/modes/serial-orbit.js";
import { crowFlight, preacherPresence } from "../js/visual/modes/warped-shrine.js";

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

test("the shrine celebrant arrives and leaves without ever popping", () => {
  assert.equal(preacherPresence(0), 0);
  assert.equal(preacherPresence(20), 1);
  assert.equal(preacherPresence(45), 0);
  // Both edges are ramps, not steps, and the cycle repeats cleanly.
  assert.ok(preacherPresence(8) > 0 && preacherPresence(8) < 1);
  assert.ok(preacherPresence(36) > 0 && preacherPresence(36) < 1);
  assert.equal(preacherPresence(20 + 47 * 3), preacherPresence(20));
  assert.equal(preacherPresence(-27), preacherPresence(20));
});

test("a departing crow closes on the camera and fades at both ends", () => {
  assert.equal(crowFlight(0).depth, 1);
  assert.equal(crowFlight(1).depth, 0);
  assert.ok(crowFlight(0.3).depth > crowFlight(0.7).depth);
  assert.equal(crowFlight(0).alpha, 0);
  assert.equal(crowFlight(1).alpha, 0);
  assert.ok(crowFlight(0.5).alpha > 0.99);
  // It climbs away from the perch rather than sinking off the bottom.
  assert.ok(crowFlight(0.5).lift > 0);
  // Wingbeats only ever accumulate; a flap phase that rewinds reads as a stall.
  assert.ok(crowFlight(0.8).flap > crowFlight(0.2).flap);
});

test("orbit galaxy shells continuously recede and fade before recycling", () => {
  const near = orbitZoomCycle(1);
  const far = orbitZoomCycle(6);
  assert.ok(near.scale > far.scale);
  assert.ok(near.alpha > 0);
  assert.ok(far.alpha > 0);
  assert.equal(orbitZoomCycle(0).alpha, 0);
});
