import assert from "node:assert/strict";
import test from "node:test";

import { DiagnosticLog } from "../js/diagnostic-log.js";

test("diagnostic log sanitizes, bounds, and throttles local summary events", () => {
  let now = new Date("2026-07-28T12:34:56").getTime();
  const log = new DiagnosticLog({ limit: 2, now: () => now });
  assert.equal(log.add("camera", "started\nno media copied", { key: "camera", throttleMs: 1000 }), true);
  assert.match(log.text(), /\[12:34:56\] CAMERA  started no media copied/);
  assert.equal(log.add("camera", "duplicate", { key: "camera", throttleMs: 1000 }), false);
  now += 1000;
  log.add("worker", "ready");
  log.add("detector", "gpu requested");
  assert.equal(log.text().split("\n").length, 2);
  assert.equal(log.text().includes("started"), false);
});

test("diagnostic state events only record transitions and clear removes all data", () => {
  const log = new DiagnosticLog({ now: () => 0 });
  assert.equal(log.state("hand", "count=0"), true);
  assert.equal(log.state("hand", "count=0"), false);
  assert.equal(log.state("hand", "count=1"), true);
  log.clear();
  assert.equal(log.text(), "");
});
