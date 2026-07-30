import assert from "node:assert/strict";
import test from "node:test";

import { FluidField } from "../js/visual/fluid.js";

const finite = (field) => field.every((value) => Number.isFinite(value));

test("splatting is the only way anything enters the field", () => {
  const fluid = new FluidField({ width: 24, height: 24 });
  assert.equal(fluid.totalDensity(), 0);
  fluid.splat(12, 12, 4, 1, 0.5);
  assert.ok(fluid.totalDensity() > 0);
  // Soft-edged: the centre must carry more than the rim.
  const centre = fluid.density[fluid.index(12, 12)];
  const rim = fluid.density[fluid.index(15, 12)];
  assert.ok(centre > rim && rim > 0);
  // And nothing lands outside the disc.
  assert.equal(fluid.density[fluid.index(20, 12)], 0);
  fluid.reset();
  assert.equal(fluid.totalDensity(), 0);
});

test("projection drives the velocity field toward incompressibility", () => {
  // A curl-free field at four cycles across the domain: entirely removable in
  // principle, and at a wavelength Gauss-Seidel actually clears quickly.
  //
  // Two properties of this scheme are worth knowing and are deliberately not
  // asserted as failures. Gauss-Seidel is a smoother, so it kills local error
  // fast and domain-wide modes only over O(N^2) sweeps — a one-cycle field
  // barely halves in 40 iterations. And at the grid scale (wavelength ~4
  // cells) the collocated central-difference stencil has a null space, the
  // classic checkerboard mode, which no number of iterations can see. Both are
  // inherent to Stam's discretisation, and neither matters here because splats
  // inject divergence at the scale in between.
  const fluid = new FluidField({ width: 32, height: 32 });
  for (let j = 1; j <= 32; j += 1) {
    for (let i = 1; i <= 32; i += 1) {
      fluid.u[fluid.index(i, j)] = Math.sin((2 * Math.PI * 4 * i) / 32) * 2;
      fluid.v[fluid.index(i, j)] = Math.sin((2 * Math.PI * 4 * j) / 32) * 2;
    }
  }
  // Measured away from the walls: the mirrored boundary is a step change by
  // construction and would swamp the reading.
  const before = fluid.maxDivergence(3);
  assert.ok(before > 1);
  fluid.project(20);
  const after = fluid.maxDivergence(3);
  assert.ok(after < before * 0.3, `divergence ${before} -> ${after}`);
});

test("advection moves smoke along the velocity field and roughly conserves it", () => {
  const fluid = new FluidField({ width: 32, height: 32 });
  fluid.splat(10, 16, 3, 1);
  const before = fluid.totalDensity();
  for (let j = 0; j <= 33; j += 1) {
    for (let i = 0; i <= 33; i += 1) fluid.u[fluid.index(i, j)] = 6;
  }
  fluid.density0.set(fluid.density);
  fluid.advect(0, fluid.density, fluid.density0, fluid.u, fluid.v, 1);
  const after = fluid.totalDensity();
  // Semi-Lagrangian advection is diffusive, not conservative — but it must not
  // be creating or destroying smoke wholesale.
  assert.ok(after > before * 0.85 && after < before * 1.15, `${before} -> ${after}`);
  // The centre of mass must have travelled downwind.
  let weighted = 0;
  let total = 0;
  for (let j = 1; j <= 32; j += 1) {
    for (let i = 1; i <= 32; i += 1) {
      const d = fluid.density[fluid.index(i, j)];
      weighted += i * d;
      total += d;
    }
  }
  assert.ok(weighted / total > 13, "smoke should have moved +x");
});

test("buoyancy lifts hot cells and smoke weight pulls cold ones down", () => {
  const fluid = new FluidField({ width: 16, height: 16 });
  const hot = fluid.index(8, 8);
  const cold = fluid.index(4, 8);
  fluid.heat[hot] = 1;
  fluid.density[cold] = 1;
  fluid.applyBuoyancy(1, 2.4, 0.22);
  // The grid runs down the screen, so rising is negative v.
  assert.ok(fluid.v[hot] < 0, "hot smoke must rise");
  assert.ok(fluid.v[cold] > 0, "cold smoke must sink");
});

test("vorticity confinement puts rotation back that advection bleeds away", () => {
  const build = () => {
    const fluid = new FluidField({ width: 32, height: 32 });
    for (let j = 1; j <= 32; j += 1) {
      for (let i = 1; i <= 32; i += 1) {
        // A vortex pair, so |curl| has a real gradient to climb.
        const dx = i - 16;
        const dy = j - 16;
        const r2 = dx * dx + dy * dy + 8;
        fluid.u[fluid.index(i, j)] = -dy / r2 * 12;
        fluid.v[fluid.index(i, j)] = dx / r2 * 12;
      }
    }
    return fluid;
  };
  const peakCurl = (fluid) => {
    let peak = 0;
    for (let j = 2; j < 32; j += 1) {
      for (let i = 2; i < 32; i += 1) {
        const at = fluid.index(i, j);
        const spin = Math.abs(0.5 * ((fluid.v[at + 1] - fluid.v[at - 1]) - (fluid.u[at + fluid.stride] - fluid.u[at - fluid.stride])));
        if (spin > peak) peak = spin;
      }
    }
    return peak;
  };
  const baseline = peakCurl(build());
  // Confinement concentrates rotation rather than manufacturing it: the total
  // |curl| barely moves, but the peak sharpens, and harder with more strength.
  const gentle = build();
  gentle.confineVorticity(1 / 60, 10);
  const fierce = build();
  fierce.confineVorticity(1 / 60, 40);
  assert.ok(peakCurl(gentle) > baseline, "confinement must sharpen the vortex core");
  assert.ok(peakCurl(fierce) > peakCurl(gentle), "more confinement, sharper core");
  // And it must be exactly a no-op when switched off.
  const off = build();
  off.confineVorticity(1 / 60, 0);
  assert.equal(peakCurl(off), baseline);
});

test("the solver stays finite and bounded under abusive forcing and a huge timestep", () => {
  const fluid = new FluidField({ width: 24, height: 28, iterations: 4 });
  const fastest = () => {
    let peak = 0;
    for (let index = 0; index < fluid.cells; index += 1) {
      const speed = Math.hypot(fluid.u[index], fluid.v[index]);
      if (speed > peak) peak = speed;
    }
    return peak;
  };
  const abuse = (frames) => {
    for (let frame = 0; frame < frames; frame += 1) {
      fluid.splat(12, 24, 5, 4, 3, (frame % 7) - 3, -20);
      // Unconditional stability is the entire claim of this scheme; a timestep
      // this large would detonate an explicit solver on the first frame.
      fluid.step(0.5, { vorticity: 60, buoyancy: 12 });
    }
  };

  abuse(120);
  const settled = fastest();
  abuse(120);
  const later = fastest();

  assert.ok(finite(fluid.density), "density went non-finite");
  assert.ok(finite(fluid.u) && finite(fluid.v), "velocity went non-finite");
  assert.ok(fluid.totalDensity() > 0, "all the smoke vanished");
  // Stability means bounded, not small. Forcing this violent genuinely drives
  // fast flow — heat settles near 50 against 0.94 cooling, and buoyancy 12 at
  // dt 0.5 is hundreds of cells per second. What must never happen is that it
  // keeps climbing: after a second run of equal length it must have levelled.
  assert.ok(later < settled * 1.5, `velocity still climbing: ${settled} -> ${later}`);
});

test("dissipation eventually clears the field once sources stop", () => {
  const fluid = new FluidField({ width: 20, height: 20 });
  fluid.splat(10, 15, 4, 2, 1);
  const seeded = fluid.totalDensity();
  for (let frame = 0; frame < 400; frame += 1) fluid.step(1 / 60, { dissipation: 0.95 });
  assert.ok(fluid.totalDensity() < seeded * 0.01, "smoke must not persist forever");
});
