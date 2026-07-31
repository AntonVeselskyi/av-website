import assert from "node:assert/strict";
import test from "node:test";

import {
  SPELL_VISUALIZER_MODE_ALIASES,
  SPELL_VISUALIZER_MODE_LABELS,
  SPELL_VISUALIZER_MODES,
} from "../js/visual/visualizer.js";
import { tunnelTempoScale } from "../js/visual/modes/wired-tunnel.js";
import { orbitZoomCycle } from "../js/visual/modes/serial-orbit.js";
import { crowFlight, preacherPresence, spectrumRungs } from "../js/visual/modes/warped-shrine.js";
import { royaleRingIdentity, royaleRingStyle, royaleSuitTransition } from "../js/visual/modes/royale-fractal.js";

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

test("the shrine deals its spectrum across the nave by depth, mirrored", () => {
  // Two sides of the nave at four depths, interleaved as the colonnade records
  // them: same depth must mean same band, near must be low, far must be high.
  const bands = spectrumRungs([1, 1, 2.2, 2.2, 3.5, 3.5, 5, 5]);
  assert.deepEqual(bands, [0, 0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1, 1]);
  // Order of arrival must not matter — only depth does.
  assert.deepEqual(spectrumRungs([5, 1, 2.2]), [1, 0, 0.5]);
  // A single surviving element must not divide by zero.
  assert.deepEqual(spectrumRungs([2.2]), [0]);
  assert.deepEqual(spectrumRungs([]), []);
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

test("royale suit morph remains continuous across every Droste wrap", () => {
  const before = royaleSuitTransition(2.999999);
  const after = royaleSuitTransition(3);
  assert.equal(before.to, after.from);
  assert.ok(before.toAlpha > 0.999999);
  assert.equal(after.fromAlpha, 1);
  assert.equal(after.toAlpha, 0);

  const middle = royaleSuitTransition(5.5);
  assert.equal(middle.from, 1);
  assert.equal(middle.to, 2);
  assert.ok(Math.abs(middle.fromAlpha - middle.toAlpha) < 1e-9);
  assert.ok(middle.warp > 0.99);

  for (let cycle = 0; cycle < 12; cycle += 1) {
    for (let ring = 0; ring < 9; ring += 1) {
      assert.equal(
        royaleRingIdentity(cycle, ring),
        royaleRingIdentity(cycle + 1, ring + 1),
      );
    }
  }

  const styleBefore = royaleRingStyle(2.999999);
  const styleAfter = royaleRingStyle(3);
  assert.ok(Math.abs(styleBefore.bandPosition - styleAfter.bandPosition) < 1e-6);
  assert.ok(Math.abs(styleBefore.spinCoefficient - styleAfter.spinCoefficient) < 1e-9);
});
