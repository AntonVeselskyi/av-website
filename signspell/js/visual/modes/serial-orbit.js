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
// The corridor the solids travel down, in world units. They are spawned at
// BODY_Z_FAR, stream toward the camera, and are recycled once past BODY_Z_NEAR.
const BODY_Z_FAR = 10.5;
const BODY_Z_NEAR = 0.5;

/**
 * How visible a solid is at a given depth, and how far along its run it is.
 *
 * Nothing may ever pop. A solid fades up out of the far dark, holds through the
 * middle of the corridor, and fades out as it sweeps past the camera — so by
 * the moment it is recycled and handed a new shape it is already invisible and
 * the swap cannot be seen. That fade is the whole trick behind flying past
 * them: the travel is continuous, and the recycling rides for free.
 */
export function orbitBodyTravel(z) {
  const span = BODY_Z_FAR - BODY_Z_NEAR;
  const progress = Math.min(1, Math.max(0, (BODY_Z_FAR - z) / span));
  const rise = Math.min(1, Math.max(0, (BODY_Z_FAR - z) / 2.6));
  const pass = Math.min(1, Math.max(0, (z - BODY_Z_NEAR) / 1.5));
  const smooth = (t) => t * t * (3 - 2 * t);
  return { progress, alpha: smooth(rise) * smooth(pass) };
}

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
      // Spread down the corridor at the start, so the opening seconds are
      // already mid-flight rather than a formation arriving together.
      z: BODY_Z_NEAR + ((index + 0.5) / SOLIDS.length) * (BODY_Z_FAR - BODY_Z_NEAR),
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
        // Six octaves rather than four, so the banks carry structure at every
        // scale instead of reading as one soft smudge.
        const cloud = kit.fbm(u * 2.4 + drift, v * 2.4 - drift * 0.6, 6);
        const veil = kit.fbm(u * 5.8 - drift * 1.7, v * 5.8 + drift, 4);
        const mist = kit.fbm(u * 11.5 + drift * 2.3, v * 11.5 - drift * 1.1, 3);
        // Pushed to the sides. The middle of the frame belongs to the galaxy
        // and the solids coming at us; the gas banks up the left and right
        // edges and thins toward the axis, which is what gives the corridor
        // walls and makes the flight read as going *through* something.
        const flank = Math.pow(Math.abs(u - 0.5) * 2, 1.45);
        // A low floor in the middle, banked hard at the edges. The galaxy and
        // the oncoming solids own the centre of the frame; the gas is the wall
        // of the corridor, not a veil over the whole thing.
        const wall = 0.12 + flank * 1.85;
        const density = Math.max(0, (cloud * 0.86 + veil * 0.4 - 0.42) * wall);
        // A gentler exponent than a square keeps the faint outer gas visible
        // instead of crushing the whole field to nothing.
        const glow = Math.pow(density, 1.35) * 2.1;
        const haze = mist * density * 0.9;
        // Violet gas with a green ionisation front where it is densest, and a
        // warm rim where the thin mist catches the light.
        data[o] = Math.min(255, glow * 104 + veil * 14 + haze * 46);
        data[o + 1] = Math.min(255, glow * 52 + density * 38 * (0.4 + heat) + haze * 20);
        data[o + 2] = Math.min(255, glow * 176 + veil * 22 + haze * 30);
        data[o + 3] = Math.min(255, glow * 205);
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

    const roll = hash01(cycle * 13 + 7) * Math.PI;
    const rollCos = Math.cos(roll);
    const rollSin = Math.sin(roll);
    const wind = 2.4 + hash01(cycle * 13 + 11) * 1.8;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // The disc it all sits in, so the arms have something to be arms of.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(roll);
    ctx.scale(1, tilt);
    const disc = ctx.createRadialGradient(0, 0, 0, 0, 0, scale * 1.05);
    disc.addColorStop(0, `hsla(${hue.toFixed(0)}, 70%, 72%, ${(0.1 * alpha).toFixed(3)})`);
    disc.addColorStop(0.45, `hsla(${hue.toFixed(0)}, 70%, 62%, ${(0.045 * alpha).toFixed(3)})`);
    disc.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(0, 0, scale * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    for (let i = 0; i < count; i += 1) {
      const r = this.gr[i];
      // Logarithmic spiral: the arm's angle grows with the log of the radius,
      // which is the curve real arms follow and the reason this reads as a
      // galaxy rather than as rings of dots. Scatter is kept tight so the
      // arms stay resolvable.
      const omega = 0.42 / Math.max(0.16, r);
      const angle = ((i % arms) / arms) * Math.PI * 2
        + Math.log(Math.max(0.12, r)) * wind + drift
        + spin * this.t * omega * 0.16 + this.gj[i] * 0.42;
      const rr = r * scale;
      let gx = Math.cos(angle) * rr;
      let gy = Math.sin(angle) * rr * tilt;

      // Fractal opening. The same log-spiral rule is applied again at half the
      // scale and twice the winding, and another octave engages each time the
      // shell gets appreciably nearer — so an arm that read as one smooth band
      // from a distance resolves into sub-arms, then into clumps within those,
      // as you fall into it. Detail keeps arriving instead of the same picture
      // being magnified, which is the whole reason to zoom forever.
      const octaves = 1 + Math.floor(nearness * 3.4);
      let amp = 0.15;
      let wind2 = wind * 2.1;
      for (let o = 0; o < octaves; o += 1) {
        const sub = angle * 2 + Math.log(Math.max(0.12, r)) * wind2
          + this.gj[i] * 3.1 + spin * this.t * 0.09 * (o + 1);
        gx += Math.cos(sub) * rr * amp;
        gy += Math.sin(sub) * rr * amp * tilt;
        amp *= 0.52;
        wind2 *= 2.3;
      }

      const x = cx + gx * rollCos - gy * rollSin;
      const y = cy + gx * rollSin + gy * rollCos;
      const bright = (1 - r / 1.1) * (0.5 + Math.min(2, audio.trebRel) * 0.22) * alpha;
      if (bright <= 0.01) continue;
      const size = (0.72 + this.gj[i] * 0.4 + bright * 2.4 * (0.5 + nearness)) * frame.ratio;
      ctx.fillStyle = i % 11 === 0
        ? palette.wire(Math.min(0.9, bright * 0.95))
        : `hsla(${hue.toFixed(0)}, 86%, 79%, ${Math.min(0.8, bright * 0.82).toFixed(3)})`;
      ctx.fillRect(x, y, size, size);
    }
    // Bulge: elongated with the disc, not a round dot pasted on top.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(roll);
    ctx.scale(1, Math.max(0.35, tilt * 1.35));
    const bulge = Math.max(2, scale * 0.26);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, bulge);
    core.addColorStop(0, palette.bone((0.5 + audio.sustain * 0.3) * alpha));
    core.addColorStop(0.35, `hsla(${hue.toFixed(0)}, 80%, 78%, ${(0.3 * alpha).toFixed(3)})`);
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, bulge, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
      // The field used to be entirely bone, capped at 0.65, a pixel across, and
      // streaking only above a speed most motes never reached — so passing
      // through it read as grey static rather than as travel. Brighter, bigger,
      // tinted, and streaking far sooner.
      const bright = fade * (0.42 + this.sSeed[i] * 0.72 + audio.trebRel * 0.2);
      const size = Math.max(1, (0.6 + this.sSeed[i]) * point.scale * 0.0042 * frame.ratio);
      const tinted = this.sSeed[i];
      const ink = tinted > 0.88 ? palette.violet : tinted > 0.76 ? palette.wire : tinted > 0.68 ? palette.amber : palette.bone;
      if (speed > 0.32 && !frame.reducedMotion) {
        // Trail length follows the velocity, so the fastest motes rake past and
        // the slow ones barely smear — the parallax reads as depth.
        const rake = kit.clamp(speed * 6, 4, 15) * frame.ratio;
        ctx.strokeStyle = ink(Math.min(0.72, bright * 0.85));
        ctx.lineWidth = size;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x - this.svx[i] * rake, point.y - this.svy[i] * rake);
        ctx.stroke();
        ctx.lineCap = "butt";
        // A hot head, so a streak still resolves to a star.
        ctx.fillStyle = ink(Math.min(0.95, bright * 1.25));
        ctx.fillRect(point.x - size * 0.5, point.y - size * 0.5, size, size);
      } else {
        ctx.fillStyle = ink(Math.min(0.88, bright));
        ctx.fillRect(point.x - size * 0.5, point.y - size * 0.5, size, size);
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

    // The solid is somewhere down the corridor, coming at us. It still circles
    // the galaxy's axis while it travels, so it reads as something in orbit
    // that we are overhauling rather than as scenery on a conveyor.
    const travel = orbitBodyTravel(body.z);
    if (travel.alpha <= 0.002) return;
    const orbit = body.orbitPhase + this.t * body.orbitSpeed * this.axisFlip;
    // Lateral spread opens up as it nears, which is the parallax that sells
    // passing something rather than watching it shrink.
    const swing = body.orbitR * (0.42 + travel.progress * 0.85);
    const ox = Math.cos(orbit) * swing;
    const oy = Math.sin(orbit) * swing * 0.36 + Math.sin(orbit * 0.7 + body.tilt) * 0.12;
    const oz = body.z;

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
    // Everything the body draws is scaled by its corridor fade, so it can never
    // appear or vanish — it arrives out of the dark and dissolves as it passes.
    ctx.globalAlpha = travel.alpha;
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
      // No fade factor here: ctx.globalAlpha already carries the corridor fade
      // for the whole body, and applying it twice would square it.
      const alpha = (0.07 + near * 0.26) * (dominant ? 1 : 0.6)
        * (0.55 + Math.min(2, audio.midRel) * 0.22);
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
    const travel = orbitBodyTravel(body.z);
    if (travel.alpha <= 0.002) return;
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
    // Was body.enter, the old slide-in easing. The corridor fade replaces it.
    const ease = travel.alpha;
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
      // Perspective scale for the fringe, from the vertex's own depth.
      const fringe = (vertex) => {
        const depth = body.pd[vertex];
        return depth > 0.2 ? Math.min(2.4, 2.9 / depth) : 1;
      };
      ctx.lineWidth = (0.6 + near * 1.5) * frame.ratio * (dominant ? 1.2 : 0.85) * 0.72;
      ctx.strokeStyle = `hsla(166, 96%, 74%, ${Math.min(0.16, alpha * 0.3).toFixed(3)})`;
      ctx.beginPath();
      for (let i = from; i < to; i += 1) {
        const [a, b] = edges[this.edgeOrder[i]];
        const fa = fringe(a);
        const fb = fringe(b);
        ctx.moveTo(body.px[a] + aura.dx * fa, body.py[a] + aura.dy * fa);
        ctx.lineTo(body.px[b] + aura.dx * fb, body.py[b] + aura.dy * fb);
      }
      ctx.stroke();
      ctx.strokeStyle = `hsla(286, 96%, 74%, ${Math.min(0.14, alpha * 0.24).toFixed(3)})`;
      ctx.beginPath();
      for (let i = from; i < to; i += 1) {
        const [a, b] = edges[this.edgeOrder[i]];
        const fa = fringe(a) * 0.72;
        const fb = fringe(b) * 0.72;
        ctx.moveTo(body.px[a] - aura.dx * fa, body.py[a] - aura.dy * fa);
        ctx.lineTo(body.px[b] - aura.dx * fb, body.py[b] - aura.dy * fb);
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
      // Fly the corridor. Bass leans on the throttle, so the pack sweeps past
      // faster when the track drives.
      const closing = dt * (1.15 + kit.clamp(audio.bassAtt, 0, 2.4) * 0.75);
      for (const body of this.bodies) {
        body.z -= closing;
        if (body.z > BODY_Z_NEAR) continue;
        // Overrun. Send it round to the far end with a new shape and a new
        // slot on the axis — invisible, because it is fully faded out here.
        body.z += BODY_Z_FAR - BODY_Z_NEAR;
        body.shape = Math.floor(hash01(this.channel * 31 + body.band * 97 + this.t) * SOLIDS.length) % SOLIDS.length;
        body.geometry = SOLIDS[body.shape];
        body.orbitPhase = hash01(this.t * 13 + body.band * 7) * Math.PI * 2;
        body.orbitR = 0.45 + hash01(this.t * 17 + body.band * 11) * 1.5;
      }
    }

    // Reconfigure on a musical boundary rather than a timer.
    if (!reduced && audio.beat > 0.7 && audio.beatCount !== this.lastBeat) {
      this.lastBeat = audio.beatCount;
      if (audio.beatCount % 16 === 0) {
        this.dominant = (this.dominant + 1) % this.bodies.length;
        this.axisFlip = -this.axisFlip;
        this.channel = (this.channel + 1) % 999;
        // Shapes are no longer swapped on the beat. Doing it here reset a solid
        // that was in full view, which is exactly the disappearing the corridor
        // exists to prevent — replacement now only happens at the far end,
        // behind the fade.
      }
    }

    kit.fadeTo(ctx, width, height, palette.void, 1);

    this.paintNebula(frame);
    if (this.nebula.canvas && this.nebula.width > 1) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      // The gas was being laid in at 0.42 and then buried under everything
      // else. It is the backdrop the whole flight happens inside, so it gets
      // to be visible, and it breathes on the sustained energy.
      ctx.globalAlpha = 0.7 + Math.min(1, audio.sustain * 2) * 0.14;
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
      this.rgb.apply(ctx, ctx.canvas, {
        amount: frame.ratio * (0.55 + audio.transient * 0.7),
        alpha: 0.07 + audio.transient * 0.05,
        angle: this.t * 0.4,
      });
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
