import assert from "node:assert/strict";
import test from "node:test";

import {
  SPELL_VISUALIZER_MODE_ALIASES,
  SPELL_VISUALIZER_MODE_LABELS,
  SPELL_VISUALIZER_MODES,
} from "../js/visual/visualizer.js";
import { liveBeatChanged } from "../js/visual/scene-kit.js";
import { tunnelTempoScale, wiredCorruptionProfile } from "../js/visual/modes/wired-tunnel.js";
import {
  orbitAuroraEdgeOffset,
  orbitAuroraPoint,
  orbitAuroraSegmentCount,
  orbitBodyTravel,
  orbitZoomCycle,
} from "../js/visual/modes/serial-orbit.js";
import {
  crowFlight,
  preacherPresence,
  spectrumRungs,
  wallFallBurstSize,
  wallFallFallbackDue,
  wallFallMotion,
  wallFallRungs,
} from "../js/visual/modes/warped-shrine.js";
import { lavaInternalLightCount, lavaInternalLightPose } from "../js/visual/modes/lava-lamp.js";
import { royaleRingIdentity, royaleRingStyle, royaleSuitTransition } from "../js/visual/modes/royale-fractal.js";

test("visualizer exposes the projected wired and serial orbit scenes", () => {
  assert.equal(SPELL_VISUALIZER_MODE_ALIASES.wired, SPELL_VISUALIZER_MODES.WIRED_TUNNEL);
  assert.equal(SPELL_VISUALIZER_MODE_ALIASES.orbit, SPELL_VISUALIZER_MODES.SERIAL_ORBIT);
  assert.match(SPELL_VISUALIZER_MODE_LABELS[SPELL_VISUALIZER_MODES.SERIAL_ORBIT], /orbit/);
});

test("visual scene beats require a live onset, not only a changed counter", () => {
  assert.equal(liveBeatChanged(-1, { beatCount: 0, beat: 1, silent: false }), false);
  assert.equal(liveBeatChanged(-1, { beatCount: 1, beat: 0.8, silent: false }), true);
  assert.equal(liveBeatChanged(4, { beatCount: 9, beat: 0, silent: false }), false);
  assert.equal(liveBeatChanged(4, { beatCount: 5, beat: 1, silent: true }), false);
  assert.equal(liveBeatChanged(4, { beatCount: 5, beat: 0.8, silent: false }), true);
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

test("ritual wall falls are musical, accelerated and bounded", () => {
  assert.equal(wallFallBurstSize({ silent: true, transient: 1, flux: 1 }), 0);
  assert.equal(wallFallBurstSize({ transient: 0.1, flux: 0.1 }), 1);
  assert.equal(wallFallBurstSize({ transient: 0.65, flux: 0.4 }), 2);
  assert.equal(wallFallBurstSize({ transient: 0.9, flux: 0.8 }), 3);
  const early = wallFallMotion(0.2, 1);
  const late = wallFallMotion(0.8, 1);
  assert.ok(late.progress > early.progress);
  assert.ok(late.progress - early.progress > 0.6);
  assert.equal(wallFallMotion(0, 1).alpha, 0);
  assert.equal(wallFallMotion(1, 1).alpha, 0);
  const pierBands = spectrumRungs([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9]);
  const rungs = wallFallRungs(pierBands);
  assert.equal(rungs.length, 9);
  for (const rung of rungs) assert.ok(pierBands.filter((band) => Math.abs(band - rung) < 0.001).length >= 2);
  assert.equal(wallFallFallbackDue({ silent: false, time: 2, lastAt: 1 }), true);
  assert.equal(wallFallFallbackDue({ silent: false, time: 1.5, lastAt: 1 }), false);
  assert.equal(wallFallFallbackDue({ still: true, silent: false, time: 4, lastAt: 1 }), false);
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

test("orbit solids fade in and out of the corridor rather than popping", () => {
  // The recycling point and the spawn point must both be fully invisible, or
  // the swap that happens there is a solid blinking out of existence.
  assert.equal(orbitBodyTravel(0.5).alpha, 0);
  assert.equal(orbitBodyTravel(10.5).alpha, 0);
  assert.equal(orbitBodyTravel(0.2).alpha, 0, "past the camera stays gone");
  assert.equal(orbitBodyTravel(12).alpha, 0, "behind the spawn plane stays gone");
  // Mid-corridor it is fully present.
  assert.ok(orbitBodyTravel(5).alpha > 0.99);
  // And both ends ramp rather than step.
  assert.ok(orbitBodyTravel(9.6).alpha > 0 && orbitBodyTravel(9.6).alpha < 1);
  assert.ok(orbitBodyTravel(1.2).alpha > 0 && orbitBodyTravel(1.2).alpha < 1);
  // Progress runs from nothing at the far plane to one as it sweeps past.
  assert.equal(orbitBodyTravel(10.5).progress, 0);
  assert.equal(orbitBodyTravel(0.5).progress, 1);
  assert.ok(orbitBodyTravel(3).progress > orbitBodyTravel(8).progress);
});

test("orbit galaxy shells continuously recede and fade before recycling", () => {
  const near = orbitZoomCycle(1);
  const far = orbitZoomCycle(6);
  assert.ok(near.scale > far.scale);
  assert.ok(near.alpha > 0);
  assert.ok(far.alpha > 0);
  assert.equal(orbitZoomCycle(0).alpha, 0);
});

test("orbit aurora remains subtle, continuous and in camera space", () => {
  assert.ok(orbitAuroraSegmentCount(0.2) >= 20);
  assert.ok(orbitAuroraSegmentCount(2) <= 36);
  const a = orbitAuroraPoint(0.3, 1, 2, 0.5);
  const b = orbitAuroraPoint(0.31, 1, 2, 0.5);
  for (const value of Object.values(a)) assert.ok(Number.isFinite(value));
  assert.ok(a.z > 1.4);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.5);
  const edge = orbitAuroraEdgeOffset(3, 2, 1, 2);
  assert.ok(Math.hypot(edge.dx, edge.dy) <= 1.61);
});

test("lava internal light remains clipped near its parent blob", () => {
  assert.equal(lavaInternalLightCount(0, 40), 6);
  assert.ok(lavaInternalLightCount(2, 40) <= 12);
  assert.equal(lavaInternalLightCount(2, 4), 4);
  const blob = { seed: 0.37 };
  const a = lavaInternalLightPose(blob, 1, 0.5);
  const b = lavaInternalLightPose(blob, 2, 0.5);
  for (const value of Object.values(a)) assert.ok(Number.isFinite(value));
  assert.ok(Math.hypot(a.dx, a.dy) < 0.5);
  assert.notDeepEqual(a, b);
});

test("wired corruption stays restrained even on hard transients", () => {
  const low = wiredCorruptionProfile(0.2, 0.05);
  const high = wiredCorruptionProfile(3, 2);
  assert.ok(low.strength < high.strength);
  assert.ok(high.strength <= 0.55);
  assert.ok(high.slide <= 0.13);
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
