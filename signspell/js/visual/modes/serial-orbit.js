/**
 * serial // orbit — a 2003 visualization plugin, played entirely straight.
 *
 * Three systems share one camera:
 *
 * 1. A cosmic background. Nebula is fbm sampled into a tiny buffer and
 *    upscaled — recomputed every few frames rather than every frame, because it
 *    drifts far too slowly for anyone to catch the difference. Over it sits a
 *    spiral galaxy with genuine differential rotation: inner radii orbit faster
 *    than outer ones, so the arms wind themselves up over minutes without any
 *    animation curve telling them to.
 * 2. A gravitational particle field. The motes are integrated against a central
 *    mass rather than scrolled, so they accelerate through periapsis and coast
 *    through apoapsis, and the field organises itself into orbits.
 * 3. A family of polyhedra that travel, tumble on independent axes and deform
 *    along their vertex normals with band energy. Edges are depth-sorted and
 *    fogged, and the faces are back-face culled and filled at very low alpha,
 *    which is what makes them read as glass solids rather than wire outlines.
 *
 * Everything is keyed to the self-normalizing measures, so it behaves the same
 * whether the user is playing the instrument or piping in a mastered track.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

// --- geometry -------------------------------------------------------------
// Vertex/edge/face tables live at module scope: built once for the process.

const PHI = (1 + Math.sqrt(5)) / 2;

function normalize(v) {
  const d = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / d, v[1] / d, v[2] / d];
}

const CUBE = {
  v: [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(normalize),
  e: [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]],
  f: [[0,1,2,3],[7,6,5,4],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]],
};

const OCTA = {
  v: [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],
  e: [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[4,3],[3,5],[5,2]],
  f: [[0,2,4],[0,4,3],[0,3,5],[0,5,2],[1,4,2],[1,3,4],[1,5,3],[1,2,5]],
};

const ICOSA = (() => {
  const v = [
    [-1,PHI,0],[1,PHI,0],[-1,-PHI,0],[1,-PHI,0],
    [0,-1,PHI],[0,1,PHI],[0,-1,-PHI],[0,1,-PHI],
    [PHI,0,-1],[PHI,0,1],[-PHI,0,-1],[-PHI,0,1],
  ].map(normalize);
  const f = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];
  const seen = new Set();
  const e = [];
  for (const [a, b, c] of f) {
    for (const [p, q] of [[a,b],[b,c],[c,a]]) {
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      e.push([p, q]);
    }
  }
  return { v, e, f };
})();

/** A spiked form: an octahedron with every face pushed out to a point. */
const STELLA = (() => {
  const v = OCTA.v.map((p) => [...p]);
  const e = [...OCTA.e];
  const f = [];
  for (const [a, b, c] of OCTA.f) {
    const tip = normalize([
      (v[a][0] + v[b][0] + v[c][0]) * 1.9,
      (v[a][1] + v[b][1] + v[c][1]) * 1.9,
      (v[a][2] + v[b][2] + v[c][2]) * 1.9,
    ]).map((n) => n * 1.75);
    const index = v.push(tip) - 1;
    e.push([a, index], [b, index], [c, index]);
    f.push([a, b, index], [b, c, index], [c, a, index]);
  }
  return { v, e, f };
})();

const SOLIDS = [ICOSA, CUBE, STELLA, OCTA];
const MAX_VERTS = Math.max(...SOLIDS.map((s) => s.v.length));

const STAR_COUNT = 420;
const GALAXY_ARMS = 3;
const GALAXY_POINTS = 300;
const NEBULA_W = 96;
const NEBULA_H = 54;
const NEBULA_INTERVAL = 6;      // frames between nebula recomputes

const DESIGNATIONS = ["NGC", "IC", "PGC", "ABELL", "MRK"];
const GALAXY_SHELLS = 3;

/**
 * One galaxy shell of the endless zoom, as a function of travel so it can be
 * reasoned about on its own. `scale` carries the shell's size and `alpha`
 * fades it at both ends of its life, which is what lets a shell be recycled
 * without anything popping. Feeding it negative travel runs the cycle the
 * other way, so the shells grow toward the camera instead of receding.
 */
export function orbitZoomCycle(beatTravel, offset = 0) {
  const phase = ((beatTravel / 8 + offset) % 1 + 1) % 1;
  return {
    phase,
    scale: 1.52 - phase * 1.18,
    alpha: Math.pow(Math.sin(Math.PI * phase), 0.7),
  };
}

/** Sparse enough to remain an atmosphere, dense enough to read as a ribbon. */
export function orbitAuroraSegmentCount(detail = 1) {
  return Math.max(20, Math.min(36, Math.round(28 * Math.max(0.72, Number(detail) || 0))));
}

/**
 * A continuous ribbon through camera space. Keeping this pure makes the
 * aurora's motion testable without coupling it to canvas or the analyser.
 */
export function orbitAuroraPoint(u, ribbon = 0, time = 0, energy = 0) {
  const phase = u * Math.PI * 2 + ribbon * 2.37 + time * (0.055 + ribbon * 0.012);
  const pulse = Math.min(1, Math.max(0, Number(energy) || 0));
  return {
    x: Math.sin(phase) * (1.9 + ribbon * 0.24) + Math.sin(phase * 2.3 + time * 0.08) * (0.18 + pulse * 0.08),
    y: Math.cos(phase * 0.58 + ribbon) * 0.76 + Math.sin(phase * 1.7 - time * 0.04) * 0.18,
    z: 2.15 + u * 1.3 + Math.sin(phase * 0.72 + ribbon) * 0.32,
  };
}

/** Very small opposing RGB edge drift — an optical aura, never a glitch. */
export function orbitAuroraEdgeOffset(time = 0, index = 0, band = 0, ratio = 1) {
  const amount = Math.min(1.6, Math.max(0.35, Number(ratio) || 1) * (0.42 + band * 0.15));
  const angle = time * 0.13 + index * 1.7 + band * 0.71;
  return { dx: Math.cos(angle) * amount, dy: Math.sin(angle) * amount };
}

function hash01(n) {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

export default class SerialOrbitScene {
  static id = "serial-orbit";
  static label = "serial // orbit";
  static post = { grain: 0.07, scanlines: 0.14, dither: 0.06, vignette: 0.56, bar: 0.04, curve: 0.013 };

  constructor(kit) {
    this.kit = kit;
    // Trails belong to the solids alone. Letting the nebula into the feedback
    // loop compounds it every frame until the frame saturates to white.
    this.feedback = new kit.FeedbackWarp({ scale: 1 });
    this.trail = new kit.Layer({ scale: 1, alpha: false });
    this.subFrame = {};
    this.bloom = new kit.Bloom({ scale: 0.3 });
    // The source is only 96×54; a full-resolution intermediate adds memory,
    // not detail. A smaller buffer is safely upscaled with the same soft look.
    this.nebula = new kit.Layer({ scale: 0.35 });
    this.rgb = new kit.RgbSplit({ scale: 0.5 });

    this.nebulaSurface = kit.createSurface(NEBULA_W, NEBULA_H);
    this.nebulaCtx = this.nebulaSurface?.getContext("2d", { alpha: true }) ?? null;
    this.nebulaImage = this.nebulaCtx?.createImageData(NEBULA_W, NEBULA_H) ?? null;
    this.nebulaFrame = -999;

    // Gravitational field. Flat arrays; nothing here is reallocated.
    this.sx = new Float32Array(STAR_COUNT);
    this.sy = new Float32Array(STAR_COUNT);
    this.svx = new Float32Array(STAR_COUNT);
    this.svy = new Float32Array(STAR_COUNT);
    this.sz = new Float32Array(STAR_COUNT);
    this.sSeed = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i += 1) this.seedStar(i, true);

    // Galaxy point cloud. The arm assignment is resolved per shell rather than
    // baked in, so each shell of the zoom can be a different galaxy.
    this.gt = new Float32Array(GALAXY_POINTS);
    this.gr = new Float32Array(GALAXY_POINTS);
    this.gj = new Float32Array(GALAXY_POINTS);
    for (let i = 0; i < GALAXY_POINTS; i += 1) {
      const t = Math.pow(hash01(i * 5 + 3), 0.62);
      this.gt[i] = t;
      this.gr[i] = 0.12 + t * 0.95;
      this.gj[i] = (hash01(i * 5 + 9) - 0.5) * 0.42 * (1 - t * 0.55);
    }
    this.galaxyTravel = 1.7;

    // Project aurora centerlines once, then replay them for the three subtle
    // color passes. Fixed buffers avoid adding a per-frame GC pulse.
    this.auroraX = new Float32Array(2 * 37);
    this.auroraY = new Float32Array(2 * 37);
    this.auroraOk = new Uint8Array(2 * 37);

    // Per-solid state.
    this.bodies = SOLIDS.map((geometry, index) => ({
      geometry,
      scale: 0.34 + hash01(index * 13) * 0.3,
      orbitR: 0.5 + index * 0.42,
      orbitPhase: hash01(index * 13 + 4) * Math.PI * 2,
      orbitSpeed: (index % 2 ? -1 : 1) * (0.06 + hash01(index * 13 + 7) * 0.07),
      tilt: hash01(index * 13 + 2) * 1.2,
      spin: [0.13 + hash01(index * 13 + 1) * 0.2, 0.09 + hash01(index * 13 + 5) * 0.24, 0.05 + hash01(index * 13 + 8) * 0.13],
      phase: [hash01(index * 3) * 6, hash01(index * 3 + 1) * 6, hash01(index * 3 + 2) * 6],
      band: index / SOLIDS.length,
      // A body can be handed a different solid when the set reconfigures, so
      // the scratch is sized to the largest geometry rather than its own.
      px: new Float32Array(MAX_VERTS),
      py: new Float32Array(MAX_VERTS),
      pd: new Float32Array(MAX_VERTS),
      pok: new Uint8Array(MAX_VERTS),
      enter: 1,
      entryAngle: hash01(index * 29) * Math.PI * 2,
      shape: index,
    }));
    // Edge draw order, rebuilt per body per frame without allocating.
    this.edgeOrder = new Int32Array(Math.max(...SOLIDS.map((s) => s.e.length)));
    this.edgeDepth = new Float32Array(this.edgeOrder.length);

    this.dominant = 0;
    this.lastBeat = -1;
    this.axisFlip = 1;
    this.channel = 0;
    this.t = 0;
  }

  /** Places a mote on a plausible orbit around the central mass. */
  seedStar(i, initial) {
    const a = hash01(i * 17 + (initial ? 0 : 991)) * Math.PI * 2;
    const r = 0.25 + Math.pow(hash01(i * 17 + 5 + (initial ? 0 : 991)), 0.7) * 1.5;
    this.sx[i] = Math.cos(a) * r;
    this.sy[i] = Math.sin(a) * r * 0.62;
    // Tangential velocity near the circular-orbit value, with scatter so the
    // field contains ellipses rather than a set of perfect rings.
    const v = Math.sqrt(0.42 / Math.max(0.2, r)) * (0.72 + hash01(i * 17 + 9) * 0.5);
    this.svx[i] = -Math.sin(a) * v;
    this.svy[i] = Math.cos(a) * v * 0.62;
    this.sz[i] = 0.35 + hash01(i * 17 + 11) * 1.3;
    this.sSeed[i] = hash01(i * 17 + 13);
  }

  resize() { this.nebulaFrame = -999; }

  // ---------------------------------------------------------------------------
  // Background
  // ---------------------------------------------------------------------------

  /** Layered fbm gas, refreshed occasionally and upscaled. */
  paintNebula(frame) {
    const { kit } = frame;
    if (!this.nebulaImage || !this.nebulaCtx || !this.nebula.ctx) return;
    if (frame.frameIndex - this.nebulaFrame < NEBULA_INTERVAL && this.nebulaFrame > 0) return;
    this.nebulaFrame = frame.frameIndex;
    this.nebula.match(frame.width, frame.height);
    const data = this.nebulaImage.data;
    const drift = this.t * 0.012;
    const heat = frame.audio.sustain;
    for (let y = 0, o = 0; y < NEBULA_H; y += 1) {
      for (let x = 0; x < NEBULA_W; x += 1, o += 4) {
        const u = x / NEBULA_W;
        const v = y / NEBULA_H;
        const cloud = kit.fbm(u * 3.1 + drift, v * 3.1 - drift * 0.6, 4);
        const veil = kit.fbm(u * 6.4 - drift * 1.7, v * 6.4 + drift, 3);
        const density = Math.max(0, cloud * 0.82 + veil * 0.46 - 0.44);
        // A gentler exponent than a square keeps the faint outer gas visible
        // instead of crushing the whole field to nothing.
        const glow = Math.pow(density, 1.5) * 1.2;
        // Violet gas with a green ionisation front where it is densest.
        data[o] = Math.min(255, glow * 88 + veil * 8);
        data[o + 1] = Math.min(255, glow * 44 + density * 30 * (0.4 + heat));
        data[o + 2] = Math.min(255, glow * 146 + veil * 14);
        data[o + 3] = Math.min(255, glow * 152);
      }
    }
    this.nebulaCtx.putImageData(this.nebulaImage, 0, 0);
    const target = this.nebula.ctx;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, this.nebula.width, this.nebula.height);
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = "high";
    target.drawImage(this.nebulaSurface, 0, 0, this.nebula.width, this.nebula.height);
  }

/**
   * One galaxy, wound by differential rotation. `cycle` identifies which pass of
   * the endless zoom this is, and seeds a different galaxy each time — so
   * falling inward keeps revealing new ones rather than the same one larger.
   */
  drawGalaxyShell(frame, cx, cy, scale, alpha, cycle) {
    const { ctx, audio, palette } = frame;
    if (alpha <= 0.012 || scale <= 1) return;
    // Bigger shells are nearer, so they resolve into more stars. That is the
    // "reveal" — detail arrives as you fall in, instead of a bitmap scaling up.
    const nearness = Math.min(1, scale / (Math.min(frame.width, frame.height) * 0.9));
    const count = Math.min(
      this.gr.length,
      Math.max(70, Math.round(GALAXY_POINTS * frame.detail * (0.4 + nearness * 0.75))),
    );
    const arms = 2 + (cycle % 4);
    const spin = hash01(cycle * 13 + 1) > 0.5 ? 1 : -1;
    const tilt = 0.2 + hash01(cycle * 13 + 5) * 0.55;
    const hue = 250 + hash01(cycle * 13 + 9) * 90;
    const drift = hash01(cycle * 13 + 3) * 6.283;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
      const r = this.gr[i];
      const p = this.gt[i];
      // Flat rotation curve: angular rate falls as 1/r, which is what winds
      // the arms. The galaxy slowly eats its own structure, as it should.
      const omega = 0.42 / Math.max(0.16, r);
      const angle = ((i % arms) / arms) * Math.PI * 2 + p * 2.6 + drift
        + spin * this.t * omega * 0.16 + this.gj[i];
      const rr = r * scale;
      const x = cx + Math.cos(angle) * rr;
      const y = cy + Math.sin(angle) * rr * tilt;
      const bright = (1 - r / 1.1) * (0.5 + Math.min(2, audio.trebRel) * 0.22) * alpha;
      if (bright <= 0.01) continue;
      const size = (0.6 + this.gj[i] * 0.4 + bright * 2 * (0.5 + nearness)) * frame.ratio;
      ctx.fillStyle = i % 11 === 0
        ? palette.wire(Math.min(0.65, bright * 0.68))
        : `hsla(${hue.toFixed(0)}, 84%, 77%, ${Math.min(0.56, bright * 0.55).toFixed(3)})`;
      ctx.fillRect(x, y, size, size);
    }
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(2, scale * 0.3));
    core.addColorStop(0, palette.bone((0.28 + audio.sustain * 0.22) * alpha));
    core.addColorStop(0.4, palette.violet(0.14 * alpha));
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core;
    ctx.fillRect(cx - scale * 0.3, cy - scale * 0.3, scale * 0.6, scale * 0.6);
    ctx.restore();
  }

  /** The endless fall: shells grow past the camera and are replaced behind. */
  drawGalaxies(frame, cx, cy, base) {
    for (let shell = 0; shell < GALAXY_SHELLS; shell += 1) {
      const offset = shell / GALAXY_SHELLS;
      // Negative travel runs the cycle outward, so shells grow toward us.
      const zoom = frame.reducedMotion
        ? { phase: 0.5, scale: 0.93, alpha: shell === 0 ? 1 : 0 }
        : orbitZoomCycle(-this.galaxyTravel, offset);
      const cycle = Math.floor((this.galaxyTravel / 8 + offset)) + shell * 101;
      this.drawGalaxyShell(frame, cx, cy, base * zoom.scale, zoom.alpha, cycle);
    }
  }

  /**
   * Two translucent ribbons inhabit the same projected space as the figures.
   * They sit behind the solids and remain deliberately sparse so the original
   * black field and hard wire geometry keep their authority.
   */
  drawAuroraVeils(frame) {
    const { ctx, width, height, audio, kit } = frame;
    const focal = Math.min(width, height) * 1.05;
    const segments = orbitAuroraSegmentCount(frame.detail);
    const energy = Math.min(1, audio.sustain * 0.55 + audio.trebRel * 0.16);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let ribbon = 0; ribbon < 2; ribbon += 1) {
      const start = ribbon * 37;
      for (let i = 0; i <= segments; i += 1) {
        const source = orbitAuroraPoint(i / segments, ribbon, this.t, energy);
        const point = kit.project3D(source, width, height, focal);
        const slot = start + i;
        this.auroraOk[slot] = point ? 1 : 0;
        if (point) {
          this.auroraX[slot] = point.x;
          this.auroraY[slot] = point.y;
        }
      }
      for (let pass = 0; pass < 3; pass += 1) {
        const shift = pass === 1 ? 0.75 * frame.ratio : pass === 2 ? -0.6 * frame.ratio : 0;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= segments; i += 1) {
          const slot = start + i;
          if (!this.auroraOk[slot]) {
            started = false;
            continue;
          }
          const x = this.auroraX[slot] + shift;
          const y = this.auroraY[slot] + (pass === 2 ? shift * 0.45 : 0);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        if (pass === 0) {
          ctx.strokeStyle = ribbon
            ? `rgba(118,64,255,${(0.026 + energy * 0.018).toFixed(3)})`
            : `rgba(74,255,202,${(0.022 + energy * 0.016).toFixed(3)})`;
          ctx.lineWidth = (6.5 + energy * 4) * frame.ratio;
        } else if (pass === 1) {
          ctx.strokeStyle = `rgba(82,255,220,${(0.045 + energy * 0.025).toFixed(3)})`;
          ctx.lineWidth = 1.1 * frame.ratio;
        } else {
          ctx.strokeStyle = `rgba(190,74,255,${(0.038 + energy * 0.022).toFixed(3)})`;
          ctx.lineWidth = 0.9 * frame.ratio;
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Motes integrated against the central mass. */
  drawField(frame, dt) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const focal = Math.min(width, height) * 1.05;
    const count = Math.max(90, Math.round(STAR_COUNT * frame.detail));
    const pull = 0.42 * (1 + audio.bassAtt * 0.14);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
      if (!frame.reducedMotion) {
        const x = this.sx[i];
        const y = this.sy[i];
        const r2 = x * x + y * y + 0.05;
        const inv = pull / (r2 * Math.sqrt(r2));
        this.svx[i] -= x * inv * dt;
        this.svy[i] -= y * inv * dt;
        this.sx[i] += this.svx[i] * dt;
        this.sy[i] += this.svy[i] * dt;
        // Anything flung out of the system is recycled back onto an orbit.
        if (r2 > 9) this.seedStar(i, false);
      }
      const point = kit.project3D(
        { x: this.sx[i] * 1.7, y: this.sy[i] * 1.7, z: this.sz[i] + 1.1 },
        width, height, focal,
      );
      if (!point) continue;
      const speed = Math.hypot(this.svx[i], this.svy[i]);
      const fade = kit.depthFade(point.depth, 0.8, 4.2);
      if (fade <= 0.02) continue;
      const bright = fade * (0.3 + this.sSeed[i] * 0.62 + audio.trebRel * 0.14);
      const size = Math.max(0.8, (0.6 + this.sSeed[i]) * point.scale * 0.0028 * frame.ratio);
      // Fast motes streak: the trail direction is the actual velocity vector.
      if (speed > 0.85 && !frame.reducedMotion) {
        ctx.strokeStyle = palette.bone(Math.min(0.5, bright * 0.7));
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x - this.svx[i] * 9 * frame.ratio, point.y - this.svy[i] * 9 * frame.ratio);
        ctx.stroke();
      } else {
        ctx.fillStyle = palette.bone(Math.min(0.65, bright));
        ctx.fillRect(point.x, point.y, size, size);
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Solids
  // ---------------------------------------------------------------------------

  drawBody(frame, body, index) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const focal = Math.min(width, height) * 1.05;
    const geometry = body.geometry;
    const verts = geometry.v;
    const dominant = index === this.dominant;

    // Travel along its own inclined orbit rather than sitting at the centre.
    const orbit = body.orbitPhase + this.t * body.orbitSpeed * this.axisFlip;
    let ox = Math.cos(orbit) * body.orbitR;
    let oy = Math.sin(orbit) * body.orbitR * 0.36;
    let oz = 2.9 + Math.sin(orbit * 0.7 + body.tilt) * 0.85;

    // Arrivals slide in from outside the frame and settle onto the orbit.
    // A solid that simply switches shape in place reads as a glitch.
    const ease = body.enter * body.enter * (3 - 2 * body.enter);
    if (ease < 0.999) {
      const far = 4.4;
      ox = kit.lerp(Math.cos(body.entryAngle) * far, ox, ease);
      oy = kit.lerp(Math.sin(body.entryAngle) * far * 0.6, oy, ease);
      oz = kit.lerp(oz + 5.5, oz, ease);
    }

    const pitch = body.phase[0] + this.t * body.spin[0] * this.axisFlip;
    const yaw = body.phase[1] + this.t * body.spin[1];
    const roll = body.phase[2] + this.t * body.spin[2] * this.axisFlip;
    const size = body.scale * (dominant ? 1.5 : 1) * (0.9 + audio.bassAtt * 0.1);

    for (let i = 0; i < verts.length; i += 1) {
      const v = verts[i];
      // Displace along the vertex normal by band energy: the form changes
      // shape rather than size, which is what stops it reading as a meter.
      const band = frame.band(kit.wrap01(body.band + i / verts.length));
      const swell = 1 + band * (dominant ? 0.42 : 0.24) + audio.transient * 0.1;
      const r = kit.rotate3D(v[0] * size * swell, v[1] * size * swell, v[2] * size * swell, pitch, yaw, roll);
      const point = kit.project3D({ x: r.x + ox, y: r.y + oy, z: r.z + oz }, width, height, focal);
      body.pok[i] = point ? 1 : 0;
      if (point) {
        body.px[i] = point.x;
        body.py[i] = point.y;
        body.pd[i] = r.z + oz;
      }
    }

    // Back-face culled glass. Screen-space winding sign gives the facing test
    // for free, with no need for a transformed normal.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const faceAlpha = (dominant ? 0.05 : 0.03) + audio.sustain * 0.05;
    ctx.fillStyle = index % 2 ? palette.violet(faceAlpha) : palette.wire(faceAlpha * 0.8);
    for (const face of geometry.f) {
      let ok = true;
      for (const vi of face) if (!body.pok[vi]) { ok = false; break; }
      if (!ok) continue;
      const [a, b, c] = face;
      const area = (body.px[b] - body.px[a]) * (body.py[c] - body.py[a])
        - (body.px[c] - body.px[a]) * (body.py[b] - body.py[a]);
      if (area <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(body.px[face[0]], body.py[face[0]]);
      for (let k = 1; k < face.length; k += 1) ctx.lineTo(body.px[face[k]], body.py[face[k]]);
      ctx.closePath();
      ctx.fill();
    }

    // Depth-sorted edges, far to near, drawn in three fogged bands so the whole
    // solid costs three strokes instead of one per edge.
    const edges = geometry.e;
    let live = 0;
    for (let i = 0; i < edges.length; i += 1) {
      const [a, b] = edges[i];
      if (!body.pok[a] || !body.pok[b]) continue;
      this.edgeOrder[live] = i;
      this.edgeDepth[live] = (body.pd[a] + body.pd[b]) * 0.5;
      live += 1;
    }
    // Insertion sort: `live` is at most a few dozen and this allocates nothing.
    for (let i = 1; i < live; i += 1) {
      const oi = this.edgeOrder[i];
      const od = this.edgeDepth[i];
      let j = i - 1;
      while (j >= 0 && this.edgeDepth[j] < od) {
        this.edgeOrder[j + 1] = this.edgeOrder[j];
        this.edgeDepth[j + 1] = this.edgeDepth[j];
        j -= 1;
      }
      this.edgeOrder[j + 1] = oi;
      this.edgeDepth[j + 1] = od;
    }

    const hue = 108 + audio.brightness * 120 + index * 18;
    for (let band = 0; band < 3; band += 1) {
      const from = Math.floor((band / 3) * live);
      const to = Math.floor(((band + 1) / 3) * live);
      if (to <= from) continue;
      const near = band / 2;
      const alpha = (0.07 + near * 0.26) * (dominant ? 1 : 0.6)
        * (0.55 + Math.min(2, audio.midRel) * 0.22) * (0.25 + ease * 0.75);
      ctx.strokeStyle = `hsla(${hue.toFixed(0)}, 92%, ${(62 + near * 16).toFixed(0)}%, ${Math.min(0.85, alpha).toFixed(3)})`;
      ctx.lineWidth = (0.6 + near * 1.5) * frame.ratio * (dominant ? 1.2 : 0.85);
      ctx.beginPath();
      for (let i = from; i < to; i += 1) {
        const [a, b] = edges[this.edgeOrder[i]];
        ctx.moveTo(body.px[a], body.py[a]);
        ctx.lineTo(body.px[b], body.py[b]);
      }
      ctx.stroke();
    }

    // Vertex markers on the dominant body only — this is the one place a
    // shadowBlur is affordable.
    if (dominant) {
      ctx.shadowBlur = 8 * frame.ratio;
      ctx.shadowColor = palette.blood(0.8);
      ctx.fillStyle = palette.blood(0.4 + audio.beat * 0.4);
      for (let i = 0; i < verts.length; i += 2) {
        if (!body.pok[i]) continue;
        ctx.fillRect(body.px[i] - frame.ratio, body.py[i] - frame.ratio, frame.ratio * 2, frame.ratio * 2);
      }
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  /**
   * Live optical edge only. This is intentionally drawn after feedback is
   * stored so the cyan/violet fringe cannot accumulate into colored ghosts.
   */
  drawBodyAura(frame, body, index) {
    const { ctx, audio } = frame;
    const edges = body.geometry.e;
    const dominant = index === this.dominant;
    let live = 0;
    for (let i = 0; i < edges.length; i += 1) {
      const [a, b] = edges[i];
      if (!body.pok[a] || !body.pok[b]) continue;
      this.edgeOrder[live] = i;
      this.edgeDepth[live] = (body.pd[a] + body.pd[b]) * 0.5;
      live += 1;
    }
    for (let i = 1; i < live; i += 1) {
      const oi = this.edgeOrder[i];
      const od = this.edgeDepth[i];
      let j = i - 1;
      while (j >= 0 && this.edgeDepth[j] < od) {
        this.edgeOrder[j + 1] = this.edgeOrder[j];
        this.edgeDepth[j + 1] = this.edgeDepth[j];
        j -= 1;
      }
      this.edgeOrder[j + 1] = oi;
      this.edgeDepth[j + 1] = od;
    }
    const ease = body.enter * body.enter * (3 - 2 * body.enter);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let band = 0; band < 3; band += 1) {
      const from = Math.floor((band / 3) * live);
      const to = Math.floor(((band + 1) / 3) * live);
      if (to <= from) continue;
      const near = band / 2;
      const alpha = (0.07 + near * 0.26) * (dominant ? 1 : 0.6)
        * (0.55 + Math.min(2, audio.midRel) * 0.22) * (0.25 + ease * 0.75);
      const aura = orbitAuroraEdgeOffset(this.t, index, band, frame.ratio);
      ctx.lineWidth = (0.6 + near * 1.5) * frame.ratio * (dominant ? 1.2 : 0.85) * 0.72;
      ctx.strokeStyle = `hsla(166, 96%, 72%, ${Math.min(0.08, alpha * 0.15).toFixed(3)})`;
      ctx.beginPath();
      for (let i = from; i < to; i += 1) {
        const [a, b] = edges[this.edgeOrder[i]];
        ctx.moveTo(body.px[a] + aura.dx, body.py[a] + aura.dy);
        ctx.lineTo(body.px[b] + aura.dx, body.py[b] + aura.dy);
      }
      ctx.stroke();
      ctx.strokeStyle = `hsla(286, 96%, 72%, ${Math.min(0.07, alpha * 0.12).toFixed(3)})`;
      ctx.beginPath();
      for (let i = from; i < to; i += 1) {
        const [a, b] = edges[this.edgeOrder[i]];
        ctx.moveTo(body.px[a] - aura.dx * 0.72, body.py[a] - aura.dy * 0.72);
        ctx.lineTo(body.px[b] - aura.dx * 0.72, body.py[b] - aura.dy * 0.72);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  render(frame) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const reduced = frame.reducedMotion;
    const dt = Math.min(0.05, frame.dt);
    if (!reduced) {
      this.t += dt;
      // Tempo drives the fall, so the zoom keeps time with the music.
      this.galaxyTravel += dt * (frame.bpm || 120) / 60;
      for (const body of this.bodies) body.enter = Math.min(1, body.enter + dt / 1.7);
    }

    // Reconfigure on a musical boundary rather than a timer.
    if (!reduced && audio.beat > 0.7 && audio.beatCount !== this.lastBeat) {
      this.lastBeat = audio.beatCount;
      if (audio.beatCount % 16 === 0) {
        this.dominant = (this.dominant + 1) % this.bodies.length;
        this.axisFlip = -this.axisFlip;
        this.channel = (this.channel + 1) % 999;
        // Retire the body furthest along and fly a different solid in behind it.
        const swap = this.bodies[(this.dominant + 2) % this.bodies.length];
        swap.shape = (swap.shape + 1 + Math.floor(hash01(audio.beatCount) * 2)) % SOLIDS.length;
        swap.geometry = SOLIDS[swap.shape];
        swap.entryAngle = hash01(audio.beatCount * 7 + 3) * Math.PI * 2;
        swap.enter = 0;
      }
    }

    kit.fadeTo(ctx, width, height, palette.void, 1);

    this.paintNebula(frame);
    if (this.nebula.canvas && this.nebula.width > 1) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.42;
      ctx.drawImage(this.nebula.canvas, 0, 0, width, height);
      ctx.restore();
    }

    const gx = width * (0.5 + Math.sin(this.t * 0.03) * 0.06);
    const gy = height * (0.46 + Math.cos(this.t * 0.024) * 0.05);
    this.drawGalaxies(frame, gx, gy, Math.min(width, height) * 0.52);
    this.drawAuroraVeils(frame);
    this.drawField(frame, dt);

    // Solids and their light trails, on their own buffer.
    const trail = this.trail;
    if (trail.ctx) {
      trail.match(width, height);
      const inner = this.subFrame;
      Object.assign(inner, frame, { ctx: trail.ctx, width: trail.width, height: trail.height });
      if (reduced) {
        trail.ctx.setTransform(1, 0, 0, 1, 0, 0);
        trail.ctx.globalCompositeOperation = "source-over";
        trail.ctx.fillStyle = "#000";
        trail.ctx.fillRect(0, 0, trail.width, trail.height);
      } else {
        this.feedback.warp(inner, {
          zoom: 1.006 + audio.bassAtt * 0.004,
          rot: 0.0009 * this.axisFlip,
          decay: 0.74,
          background: "rgba(0,0,0,1)",
          echo: audio.sustain > 0.05 ? { zoom: 1.5, alpha: 0.06 + audio.sustain * 0.05, orient: 0 } : null,
        });
      }
      for (let i = 0; i < this.bodies.length; i += 1) this.drawBody(inner, this.bodies[i], i);
      if (!reduced) this.feedback.store(inner);
      for (let i = 0; i < this.bodies.length; i += 1) this.drawBodyAura(inner, this.bodies[i], i);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(trail.canvas, 0, 0, width, height);
      ctx.restore();
    } else {
      for (let i = 0; i < this.bodies.length; i += 1) this.drawBody(frame, this.bodies[i], i);
      for (let i = 0; i < this.bodies.length; i += 1) this.drawBodyAura(frame, this.bodies[i], i);
    }

    kit.darkenCenter(ctx, width, height, 0.26);
    this.bloom.apply(ctx, ctx.canvas, {
      strength: 0.15 + Math.min(2, audio.trebAtt) * 0.06,
      blur: 15 * frame.ratio,
      passes: 2,
    });
    if (!reduced && audio.transient > 0.3) {
      this.rgb.apply(ctx, ctx.canvas, { amount: 0.65 * frame.ratio * audio.transient, alpha: 0.06, angle: this.t * 0.4 });
    }
    this.drawReadouts(frame);
  }

  drawReadouts(frame) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const small = Math.max(9, 11 * frame.ratio);
    const designation = `${DESIGNATIONS[this.channel % DESIGNATIONS.length]} ${kit.serialString(this.channel * 7 + 3, 4)}`;
    const shape = ["ICOSA", "HEXA", "STELLA", "OCTA"][this.bodies[this.dominant].shape] || "ICOSA";
    kit.machineText(ctx, `${designation}  ·  ${shape}`, width * 0.04, height * 0.9, {
      size: small * 1.1, color: palette.wire(0.42), letterSpacing: 0.09,
    });
    kit.machineText(ctx,
      `INC ${String(Math.round(audio.brightness * 89)).padStart(2, "0")}°  ECC 0.${String(Math.round(audio.midRel * 89)).padStart(2, "0")}  PER ${String(Math.round(60 / Math.max(1, audio.bpm) * 1000)).padStart(3, "0")}ms`,
      width * 0.04, height * 0.94, { size: small, color: palette.violet(0.34), letterSpacing: 0.06 });
    kit.machineText(ctx, "NO CARRIER / AUDIO BODY ONLINE", width * 0.04, height * 0.975, {
      size: small, color: palette.dim(0.5 + audio.flux * 0.3), letterSpacing: 0.12,
    });
  }

  setReducedMotion() { this.feedback.release(); }

  suspend() {
    this.feedback.release();
    this.trail.release();
    this.bloom.release();
    this.nebula.release();
    this.rgb.release();
    this.nebulaFrame = -999;
  }
}
