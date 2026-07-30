/**
 * fluid.js — a real Navier-Stokes smoke solver for $IGN⸸$PELL.
 *
 * This is Jos Stam's Stable Fluids (SIGGRAPH 99 / GDC 03) with the vorticity
 * confinement term from Fedkiw, Stam & Jensen's "Visual Simulation of Smoke"
 * (SIGGRAPH 2001), plus thermal buoyancy.  It is the same algorithm the WebGL
 * fluid demos run; the only difference here is that it runs on the CPU over a
 * coarse grid and is upsampled, because the instrument renders through a 2D
 * canvas and has no GL context to hand.
 *
 * Why this method, specifically:
 *
 * - Semi-Lagrangian advection traces velocity *backwards* and samples where it
 *   lands, which makes it unconditionally stable: no timestep can blow it up,
 *   which matters when the forcing term is somebody's kick drum.
 * - That same scheme is heavily numerically diffusive and smears out the fine
 *   vortices, which is precisely why it looks like smoke — and why vorticity
 *   confinement exists, to find where the curl is highest and push the lost
 *   rotation back in.  Even a small confinement coefficient changes the
 *   character completely.
 * - Viscous diffusion is deliberately NOT solved.  Smoke has effectively no
 *   viscosity, advection is already diffusive enough, and skipping it saves two
 *   linear solves a frame.
 *
 * Per frame: forces (buoyancy, confinement, whatever was splatted) -> project
 * -> advect velocity -> project -> advect the carried scalars -> dissipate.
 * Projection runs twice because advecting a divergent field and then correcting
 * it is not the same as correcting first; Stam's own listing does the same.
 *
 * Nothing here touches the DOM, so the whole solver is exercised in the Node
 * test suite.
 */

/** Grid velocities are in cells per second, so advection needs no rescaling. */
export class FluidField {
  /**
   * @param {{width?: number, height?: number, iterations?: number}} [options]
   */
  constructor(options = {}) {
    this.width = Math.max(4, Math.floor(options.width ?? 64));
    this.height = Math.max(4, Math.floor(options.height ?? 72));
    this.iterations = Math.max(1, Math.floor(options.iterations ?? 10));
    this.stride = this.width + 2;
    const cells = this.stride * (this.height + 2);
    this.cells = cells;

    this.u = new Float32Array(cells);
    this.v = new Float32Array(cells);
    this.u0 = new Float32Array(cells);
    this.v0 = new Float32Array(cells);
    this.density = new Float32Array(cells);
    this.density0 = new Float32Array(cells);
    this.heat = new Float32Array(cells);
    this.heat0 = new Float32Array(cells);
    this.pressure = new Float32Array(cells);
    this.divergence = new Float32Array(cells);
    this.curl = new Float32Array(cells);
  }

  index(i, j) { return i + this.stride * j; }

  reset() {
    this.u.fill(0); this.v.fill(0); this.u0.fill(0); this.v0.fill(0);
    this.density.fill(0); this.density0.fill(0);
    this.heat.fill(0); this.heat0.fill(0);
    this.pressure.fill(0); this.divergence.fill(0); this.curl.fill(0);
  }

  /** Total density in the interior — the quantity advection ought to preserve. */
  totalDensity() {
    let sum = 0;
    for (let j = 1; j <= this.height; j += 1) {
      for (let i = 1; i <= this.width; i += 1) sum += this.density[i + this.stride * j];
    }
    return sum;
  }

  /**
   * Largest |divergence| in the interior — how incompressible the field is.
   *
   * `margin` skips rings next to the wall.  The boundary condition deliberately
   * mirrors velocity across the wall, so the cells adjacent to it carry a step
   * change that reads as divergence no matter how well the solve converged;
   * measuring there tells you about the boundary, not the solver.
   */
  maxDivergence(margin = 1) {
    let worst = 0;
    const inset = Math.max(1, Math.floor(margin));
    for (let j = inset; j <= this.height - inset + 1; j += 1) {
      for (let i = inset; i <= this.width - inset + 1; i += 1) {
        const at = i + this.stride * j;
        const d = Math.abs(
          (this.u[at + 1] - this.u[at - 1]) * 0.5 + (this.v[at + this.stride] - this.v[at - this.stride]) * 0.5,
        );
        if (d > worst) worst = d;
      }
    }
    return worst;
  }

  /**
   * Injects smoke, temperature and momentum into a soft-edged disc.  This is
   * the only way anything ever enters the simulation.
   */
  splat(gx, gy, radius, amount, heat = 0, ax = 0, ay = 0) {
    const reach = Math.max(1, radius);
    const left = Math.max(1, Math.floor(gx - reach));
    const right = Math.min(this.width, Math.ceil(gx + reach));
    const top = Math.max(1, Math.floor(gy - reach));
    const bottom = Math.min(this.height, Math.ceil(gy + reach));
    const falloff = 1 / (reach * reach);
    for (let j = top; j <= bottom; j += 1) {
      for (let i = left; i <= right; i += 1) {
        const dx = i - gx;
        const dy = j - gy;
        const weight = 1 - (dx * dx + dy * dy) * falloff;
        if (weight <= 0) continue;
        // Squared falloff keeps the source core solid and its edge feathered,
        // so the figure holds together instead of boiling at the silhouette.
        const drop = weight * weight;
        const at = i + this.stride * j;
        this.density[at] += amount * drop;
        this.heat[at] += heat * drop;
        this.u[at] += ax * drop;
        this.v[at] += ay * drop;
      }
    }
  }

  /**
   * Boundaries.  `kind` 0 is a scalar (zero-gradient), 1 is the x-velocity and
   * 2 the y-velocity, which reflect at the walls they run into.  The top row is
   * left open in every case so rising smoke leaves instead of stacking up
   * against the ceiling.
   */
  setBoundary(kind, field) {
    const { width: w, height: h, stride } = this;
    for (let i = 1; i <= w; i += 1) {
      const top = i + stride * 0;
      const bottom = i + stride * (h + 1);
      field[top] = field[i + stride * 1];                               // open sky
      field[bottom] = kind === 2 ? -field[i + stride * h] : field[i + stride * h];
    }
    for (let j = 1; j <= h; j += 1) {
      const left = 0 + stride * j;
      const right = (w + 1) + stride * j;
      field[left] = kind === 1 ? -field[1 + stride * j] : field[1 + stride * j];
      field[right] = kind === 1 ? -field[w + stride * j] : field[w + stride * j];
    }
    field[0] = 0.5 * (field[1] + field[stride]);
    field[stride * (h + 1)] = 0.5 * (field[1 + stride * (h + 1)] + field[stride * h]);
    field[w + 1] = 0.5 * (field[w + stride * 0] + field[(w + 1) + stride]);
    field[(w + 1) + stride * (h + 1)] = 0.5 * (field[w + stride * (h + 1)] + field[(w + 1) + stride * h]);
  }

  /** Gauss-Seidel relaxation, in place — Stam's lin_solve. */
  linearSolve(kind, field, source, a, c, iterations) {
    const { width: w, height: h, stride } = this;
    const inverse = 1 / c;
    for (let pass = 0; pass < iterations; pass += 1) {
      for (let j = 1; j <= h; j += 1) {
        for (let i = 1; i <= w; i += 1) {
          const at = i + stride * j;
          field[at] = (source[at] + a * (field[at - 1] + field[at + 1] + field[at - stride] + field[at + stride])) * inverse;
        }
      }
      this.setBoundary(kind, field);
    }
  }

  /**
   * Semi-Lagrangian advection: for each cell, walk backwards down the velocity
   * field and bilinearly sample whatever was there.  Unconditionally stable at
   * any timestep, which is the whole reason this scheme won.
   */
  advect(kind, target, source, u, v, dt) {
    const { width: w, height: h, stride } = this;
    for (let j = 1; j <= h; j += 1) {
      for (let i = 1; i <= w; i += 1) {
        const at = i + stride * j;
        let x = i - dt * u[at];
        let y = j - dt * v[at];
        if (x < 0.5) x = 0.5; else if (x > w + 0.5) x = w + 0.5;
        if (y < 0.5) y = 0.5; else if (y > h + 0.5) y = h + 0.5;
        const i0 = Math.floor(x);
        const j0 = Math.floor(y);
        const i1 = i0 + 1;
        const j1 = j0 + 1;
        const sx1 = x - i0;
        const sx0 = 1 - sx1;
        const sy1 = y - j0;
        const sy0 = 1 - sy1;
        target[at] =
          sx0 * (sy0 * source[i0 + stride * j0] + sy1 * source[i0 + stride * j1]) +
          sx1 * (sy0 * source[i1 + stride * j0] + sy1 * source[i1 + stride * j1]);
      }
    }
    this.setBoundary(kind, target);
  }

  /**
   * Pressure projection.  Solves the Poisson equation for the pressure whose
   * gradient cancels the divergence, then subtracts it — this is what makes the
   * field incompressible, and it is what turns a plume into something that
   * curls around itself instead of simply expanding.
   */
  project(iterations) {
    const { width: w, height: h, stride, u, v, pressure, divergence } = this;
    for (let j = 1; j <= h; j += 1) {
      for (let i = 1; i <= w; i += 1) {
        const at = i + stride * j;
        divergence[at] = -0.5 * (u[at + 1] - u[at - 1] + v[at + stride] - v[at - stride]);
        pressure[at] = 0;
      }
    }
    this.setBoundary(0, divergence);
    this.setBoundary(0, pressure);
    this.linearSolve(0, pressure, divergence, 1, 4, iterations);
    for (let j = 1; j <= h; j += 1) {
      for (let i = 1; i <= w; i += 1) {
        const at = i + stride * j;
        u[at] -= 0.5 * (pressure[at + 1] - pressure[at - 1]);
        v[at] -= 0.5 * (pressure[at + stride] - pressure[at - stride]);
      }
    }
    this.setBoundary(1, u);
    this.setBoundary(2, v);
  }

  /**
   * Vorticity confinement.  Semi-Lagrangian advection bleeds angular momentum
   * away every step; this finds where the curl is strongest, builds the unit
   * vector pointing up that gradient, and pushes the rotation back in along
   * N x omega.  Without it the smoke is a smooth column.  With it, it churns.
   */
  confineVorticity(dt, strength, limit = 30) {
    if (strength <= 0) return;
    const { width: w, height: h, stride, u, v, curl } = this;
    for (let j = 1; j <= h; j += 1) {
      for (let i = 1; i <= w; i += 1) {
        const at = i + stride * j;
        curl[at] = 0.5 * ((v[at + 1] - v[at - 1]) - (u[at + stride] - u[at - stride]));
      }
    }
    // The gradient of |curl| needs a two-cell margin, so the outermost interior
    // ring is skipped rather than reading across the boundary.
    for (let j = 2; j < h; j += 1) {
      for (let i = 2; i < w; i += 1) {
        const at = i + stride * j;
        const nx = (Math.abs(curl[at + 1]) - Math.abs(curl[at - 1])) * 0.5;
        const ny = (Math.abs(curl[at + stride]) - Math.abs(curl[at - stride])) * 0.5;
        const length = Math.sqrt(nx * nx + ny * ny);
        // N is the NORMALISED gradient of |curl|, and it is simply undefined
        // where that gradient vanishes.  Dividing by an epsilon there does not
        // regularise it — it manufactures an enormous force in exactly the
        // cells that have no rotational structure to confine, and since
        // confinement is an explicit force term (the unconditional stability
        // belongs to advection, not to this) that force is free to run away.
        // Where there is no gradient there is nothing to confine: skip.
        if (length < 1e-5) continue;
        const scale = (strength * dt) / length;
        // Confinement is a positive feedback loop by construction: it reads the
        // curl and adds velocity, which raises the curl.  Advection's
        // unconditional stability does not cover it, and the literature keeps
        // the coefficient in single digits for exactly this reason.  Since the
        // strength here is driven from live audio, the per-step contribution is
        // capped so no spike in the signal can start the loop running away.
        let du = ny * curl[at] * scale;
        let dv = -nx * curl[at] * scale;
        if (du > limit) du = limit; else if (du < -limit) du = -limit;
        if (dv > limit) dv = limit; else if (dv < -limit) dv = -limit;
        u[at] += du;
        v[at] += dv;
      }
    }
    this.setBoundary(1, u);
    this.setBoundary(2, v);
  }

  /**
   * Thermal buoyancy: hot cells accelerate upward (negative v, because the grid
   * runs down the screen) and the smoke's own mass pulls down against it, so a
   * cooled plume slumps rather than rising forever.
   */
  applyBuoyancy(dt, rise, weight) {
    const { width: w, height: h, stride, v, heat, density } = this;
    for (let j = 1; j <= h; j += 1) {
      for (let i = 1; i <= w; i += 1) {
        const at = i + stride * j;
        v[at] += dt * (density[at] * weight - heat[at] * rise);
      }
    }
    this.setBoundary(2, v);
  }

  /**
   * One frame.  `dt` is in seconds and is clamped by the caller; the solver is
   * stable at any value but the *look* is only tuned around 60fps.
   */
  step(dt, options = {}) {
    const iterations = Math.max(1, Math.round(options.iterations ?? this.iterations));
    const rise = options.buoyancy ?? 2.4;
    const weight = options.weight ?? 0.22;
    const vorticity = options.vorticity ?? 8;
    const fade = options.dissipation ?? 0.986;
    const cooling = options.cooling ?? 0.94;
    const drag = options.drag ?? 0.998;

    this.applyBuoyancy(dt, rise, weight);
    this.confineVorticity(dt, vorticity, options.confinementLimit ?? 30);
    this.project(iterations);

    this.u0.set(this.u);
    this.v0.set(this.v);
    this.advect(1, this.u, this.u0, this.u0, this.v0, dt);
    this.advect(2, this.v, this.v0, this.u0, this.v0, dt);
    this.project(iterations);

    this.density0.set(this.density);
    this.heat0.set(this.heat);
    this.advect(0, this.density, this.density0, this.u, this.v, dt);
    this.advect(0, this.heat, this.heat0, this.u, this.v, dt);

    // Dissipation, cooling and a little drag.  The top rows fade hard so the
    // open ceiling never accumulates a bright lid.
    const { width: w, height: h, stride, density, heat, u, v } = this;
    const lid = Math.max(2, Math.round(h * 0.16));
    for (let j = 1; j <= h; j += 1) {
      const nearTop = j <= lid ? 0.55 + (0.45 * j) / lid : 1;
      const keep = fade * nearTop;
      const cool = cooling * nearTop;
      for (let i = 1; i <= w; i += 1) {
        const at = i + stride * j;
        density[at] *= keep;
        heat[at] *= cool;
        u[at] *= drag;
        v[at] *= drag;
      }
    }
  }
}

export default FluidField;
