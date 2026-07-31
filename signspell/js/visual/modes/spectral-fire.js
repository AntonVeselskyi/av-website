/**
 * spectral // fire — the spectrum used as fuel rather than drawn as spikes.
 *
 * The flame is an actual simulation, not decorated bars.  A coarse heat grid is
 * seeded along its bottom row from the mel bands, so the spectrum *injects fuel*
 * into the fire and the burning shape is whatever the physics does with it.
 * Each step pulls heat upward from the row below with a lateral offset sampled
 * from a scrolling noise field; that advection is what makes it lick and curl
 * like a liquid instead of rising as a gradient.
 *
 * The grid is deliberately tiny (176x99).  Mapping it through a pre-computed
 * palette into a small ImageData and letting `drawImage` do a bilinear upscale
 * costs almost nothing and hands back smooth, molten edges for free — the one
 * place in this codebase where per-pixel work earns its keep.
 *
 * Layered around it: a dull heat wall far behind, accumulated smoke drifting up
 * on its own feedback buffer, a ruined colonnade held out as pure negative space
 * for the fire to backlight, and embers riding the same noise field as the
 * flame so the whole scene agrees about which way the air is moving.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

const GRID_W = 176;
const GRID_H = 99;
const SEED_ROWS = 3;
const EMBER_COUNT = 120;
const LUT_SIZE = 256;

// Column -> mel position, cached once.  The fuel bed should read as a spectrum
// laid out the way a listener hears it, not the way the FFT hands it over.
const COLUMN_MEL = new Float32Array(GRID_W);

/** Allocation-free hash; `mulberry32` builds a closure per call. */
function hash01(n) {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

export default class SpectralFireScene {
  static id = "spectral-fire";
  static label = "spectral // fire";
  // The fire supplies its own light and haze, so the shared vignette stays
  // moderate and the interlace sits low — heavy scanlines fight the upscale.
  static post = { grain: 0.075, scanlines: 0.11, dither: 0.05, vignette: 0.52, bar: 0.03, curve: 0.014 };

  constructor(kit) {
    this.kit = kit;

    // Two buffers, swapped each step: reading and writing one grid in place
    // smears the advection into a diagonal shear.
    this.heat = new Float32Array(GRID_W * GRID_H);
    this.next = new Float32Array(GRID_W * GRID_H);
    this.seed = new Float32Array(GRID_W);

    this.surface = kit.createSurface(GRID_W, GRID_H);
    this.surfaceCtx = this.surface?.getContext("2d", { alpha: true }) ?? null;
    this.image = this.surfaceCtx?.createImageData(GRID_W, GRID_H) ?? null;

    this.lut = new Uint8ClampedArray(LUT_SIZE * 4);
    this.buildPalette();

    // Smoke rides its own low-resolution feedback buffer so it accumulates
    // across frames; per-frame puffs alone never look like smoke.
    this.smoke = new kit.Layer({ scale: 0.34 });
    this.smokeFeedback = new kit.FeedbackWarp({ scale: 0.34 });
    this.bloom = new kit.Bloom({ scale: 0.3 });
    this.fireLayer = new kit.Layer({ scale: 0.5 });

    this.embers = new Array(EMBER_COUNT);
    for (let i = 0; i < EMBER_COUNT; i += 1) {
      this.embers[i] = {
        x: hash01(i * 7 + 1),
        y: 0.6 + hash01(i * 7 + 2) * 0.5,
        vx: 0,
        vy: -(0.03 + hash01(i * 7 + 3) * 0.07),
        size: 0.4 + hash01(i * 7 + 4) * 1.5,
        heat: hash01(i * 7 + 5),
        life: hash01(i * 7 + 6),
      };
    }

    for (let x = 0; x < GRID_W; x += 1) COLUMN_MEL[x] = kit.melPosition(x / (GRID_W - 1));

    this.smokeSeed = 0;    // rolling cursor for smoke puff placement
    this.flare = 0;        // beat-triggered pressure envelope
    this.idleWarm = 1;     // holds a low flame when nothing is playing
    this.lastBeat = -1;
    this.settled = false;  // reduced-motion still is simulated once, then held
    this.t = 0;
  }

  /**
   * Heat -> colour, computed once.  Deep blood at the base through ember and
   * amber to bone white only at the very tips, with alpha ramping in fast so
   * the flame has a defined edge rather than a soft wash.
   */
  buildPalette() {
    const stops = [
      [0.00, 6, 3, 8, 0],
      [0.06, 46, 7, 20, 34],
      [0.16, 124, 20, 40, 130],
      [0.30, 214, 62, 78, 214],
      [0.42, 255, 118, 46, 244],
      [0.55, 246, 176, 98, 252],
      [0.72, 252, 224, 168, 255],
      [1.00, 246, 242, 230, 255],
    ];
    for (let i = 0; i < LUT_SIZE; i += 1) {
      const t = i / (LUT_SIZE - 1);
      let a = stops[0];
      let b = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s += 1) {
        if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
      }
      const span = b[0] - a[0] || 1;
      const k = (t - a[0]) / span;
      const o = i * 4;
      this.lut[o] = a[1] + (b[1] - a[1]) * k;
      this.lut[o + 1] = a[2] + (b[2] - a[2]) * k;
      this.lut[o + 2] = a[3] + (b[3] - a[3]) * k;
      this.lut[o + 3] = a[4] + (b[4] - a[4]) * k;
    }
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  /** Loads the fuel bed from the mel bands plus any beat flare. */
  loadSeed(frame) {
    const { audio, kit } = frame;
    const idle = this.idleWarm;
    for (let x = 0; x < GRID_W; x += 1) {
      const band = frame.band(COLUMN_MEL[x]);
      const peak = frame.bandPeaks[Math.min(frame.bandPeaks.length - 1,
        Math.round(COLUMN_MEL[x] * (frame.bandPeaks.length - 1)))] || 0;
      // A little peak-hold under the live value keeps the bed from strobing
      // between frames on percussive material.
      const fuel = band * 0.78 + peak * 0.34;
      // Break the bed up with noise so the fire never looks like a bar chart,
      // and roll the noise sideways so the hot spots wander.
      const grain = kit.fbm(x * 0.06, this.t * 0.55, 3);
      const edge = Math.sin((x / GRID_W) * Math.PI);          // taper at the walls
      const value = (fuel * (0.55 + grain * 0.85) + idle * 0.055 + this.flare * 0.5) * (0.35 + edge * 0.85);
      this.seed[x] = kit.clamp(value * (0.85 + audio.bassAtt * 0.35), 0, 1.25);
    }
  }

  /**
   * One propagation step.  Heat moves up and sideways; cooling grows with
   * height so the flame always has a finite reach and can never run away.
   */
  step(frame) {
    const { kit } = frame;
    const heat = this.heat;
    const next = this.next;
    const drift = this.t * 0.75;

    // Seed rows.
    for (let row = 0; row < SEED_ROWS; row += 1) {
      const base = (GRID_H - 1 - row) * GRID_W;
      const falloff = 1 - row / (SEED_ROWS + 1);
      for (let x = 0; x < GRID_W; x += 1) next[base + x] = this.seed[x] * falloff;
    }

    for (let y = GRID_H - 1 - SEED_ROWS; y >= 0; y -= 1) {
      const rowOut = y * GRID_W;
      const rowA = (y + 1) * GRID_W;
      const rowB = Math.min(GRID_H - 1, y + 2) * GRID_W;
      const height = 1 - y / GRID_H;                    // 1 at the base, 0 at the top
      // Cooling rises toward the top; the +0.004 floor guarantees decay even
      // when the bed is saturated, which is what stops a white-out.
      const cool = 0.009 + (1 - height) * 0.044 + 0.003;
      // Lateral advection from the flow field, in cells.
      const swirl = kit.flowAngle(y * 0.035, drift * 0.35, 1.15);
      const lean = Math.cos(swirl) * (1.1 + (1 - height) * 2.6);

      for (let x = 0; x < GRID_W; x += 1) {
        const local = kit.noise2D(x * 0.11 + drift * 1.6, y * 0.09 - drift * 2.4) - 0.5;
        const shift = lean + local * 3.4 * (1 - height);
        const sx = x + shift;
        const i0 = Math.floor(sx);
        const frac = sx - i0;
        const a0 = i0 < 0 || i0 >= GRID_W ? 0 : heat[rowA + i0];
        const a1 = i0 + 1 < 0 || i0 + 1 >= GRID_W ? 0 : heat[rowA + i0 + 1];
        const centre = a0 + (a1 - a0) * frac;
        const left = x > 0 ? heat[rowA + x - 1] : 0;
        const right = x < GRID_W - 1 ? heat[rowA + x + 1] : 0;
        const below = heat[rowB + x];
        // Weighted toward the advected sample: that is the licking motion.
        let value = centre * 0.52 + left * 0.17 + right * 0.17 + below * 0.14;
        value -= cool * (0.6 + local * 0.5 + 0.4);
        next[rowOut + x] = value > 0 ? (value < 1.6 ? value : 1.6) : 0;
      }
    }

    this.heat = next;
    this.next = heat;
  }

  /** Writes the grid through the palette and blits it, upscaled and smoothed. */
  paintFire(ctx, width, height) {
    if (!this.image || !this.surfaceCtx) return;
    const data = this.image.data;
    const heat = this.heat;
    const lut = this.lut;
    for (let i = 0, o = 0; i < heat.length; i += 1, o += 4) {
      const v = heat[i];
      const index = (v >= 1 ? LUT_SIZE - 1 : (v * (LUT_SIZE - 1)) | 0) * 4;
      data[o] = lut[index];
      data[o + 1] = lut[index + 1];
      data[o + 2] = lut[index + 2];
      data[o + 3] = lut[index + 3];
    }
    this.surfaceCtx.putImageData(this.image, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(this.surface, 0, 0, width, height);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Scene
  // ---------------------------------------------------------------------------

  render(frame) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const reduced = frame.reducedMotion;
    const dt = Math.min(0.05, frame.dt);

    if (!reduced) {
      this.t += dt;
      this.flare = Math.max(0, this.flare - dt * 2.6);
      if (audio.beat > 0.6 && audio.beatCount !== this.lastBeat) {
        this.lastBeat = audio.beatCount;
        // A pressure wave injected into the bed, then propagated by the sim —
        // far more physical than flashing the whole frame.
        this.flare = Math.min(1.2, this.flare + 0.5 + audio.transient * 0.5);
      }
      this.idleWarm += ((audio.silent ? 1 : 0.32) - this.idleWarm) * (1 - Math.exp(-dt / 1.6));
    }

    kit.fadeTo(ctx, width, height, palette.void, 1);

    // Heat wall: the dull red glow of a much larger fire somewhere behind.
    const wall = ctx.createRadialGradient(
      width * 0.5, height * 1.02, 0,
      width * 0.5, height * 1.02, Math.max(1, height * (1.05 + kit.clamp(audio.bassAtt, 0, 4) * 0.12)),
    );
    const wallHeat = 0.03 + audio.sustain * 0.55 + this.flare * 0.12;
    wall.addColorStop(0, `rgba(150, 34, 30, ${(0.1 + wallHeat * 0.62).toFixed(3)})`);
    wall.addColorStop(0.35, `rgba(96, 18, 34, ${(0.05 + wallHeat * 0.3).toFixed(3)})`);
    wall.addColorStop(0.7, "rgba(40, 10, 32, 0.07)");
    wall.addColorStop(1, "rgba(6, 5, 8, 0)");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, width, height);

    // Advance the fire.  Under reduced motion it is stepped once into a calm
    // settled pose and then held.
    if (!reduced) {
      this.loadSeed(frame);
      this.step(frame);
    } else if (!this.settled) {
      for (let warm = 0; warm < 90; warm += 1) { this.loadSeed(frame); this.step(frame); this.t += 0.016; }
      this.settled = true;
    }
    if (!reduced) this.settled = false;

    // The flame goes down through a half-resolution layer so the bloom pass has
    // a clean source containing only the hot material.
    const fire = this.fireLayer;
    if (fire.ctx) {
      fire.match(width, height);
      fire.clear();
      this.paintFire(fire.ctx, fire.width, fire.height);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(fire.canvas, 0, 0, width, height);
      ctx.restore();
    } else {
      this.paintFire(ctx, width, height);
    }

    this.drawSmoke(frame);
    this.drawSilhouette(frame);
    this.drawEmbers(frame, dt);

    if (fire.ctx) {
      this.bloom.apply(ctx, fire.canvas, {
        strength: 0.72 + audio.trebAtt * 0.2,
        blur: 22 * frame.ratio,
        passes: 2,
      });
    }

    this.drawType(frame);
  }

  /** Accumulated smoke, drifting up on its own feedback buffer. */
  drawSmoke(frame) {
    const { ctx, width, height, audio } = frame;
    const layer = this.smoke;
    if (!layer.ctx) return;
    layer.match(width, height);
    const inner = { ctx: layer.ctx, width: layer.width, height: layer.height };

    if (frame.reducedMotion) {
      layer.clear();
    } else {
      this.smokeFeedback.warp(inner, {
        zoom: 1.008,
        dy: -0.0075 - audio.sustain * 0.006,
        dx: Math.sin(this.t * 0.21) * 0.0016,
        decay: 0.955,
        background: "rgba(0,0,0,1)",
      });
      // New smoke is born where the flame is actually hot, so the column sits
      // over the fire rather than floating independently of it.
      const smokeCtx = layer.ctx;
      smokeCtx.save();
      smokeCtx.globalCompositeOperation = "lighter";
      const puffs = Math.max(3, Math.round(9 * frame.detail));
      const row = Math.floor(GRID_H * 0.55) * GRID_W;
      for (let p = 0; p < puffs; p += 1) {
        this.smokeSeed += 1;
        const gx = Math.floor(hash01(this.smokeSeed) * GRID_W);
        const hot = this.heat[row + gx];
        if (hot < 0.12) continue;
        const x = (gx / GRID_W) * layer.width;
        const y = layer.height * (0.5 + hash01(gx * 3 + frame.frameIndex) * 0.16);
        const radius = layer.height * (0.03 + hot * 0.07);
        const gradient = smokeCtx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(120, 58, 74, ${(0.05 + hot * 0.1).toFixed(3)})`);
        gradient.addColorStop(0.6, "rgba(58, 30, 58, 0.03)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        smokeCtx.fillStyle = gradient;
        smokeCtx.beginPath();
        smokeCtx.arc(x, y, radius, 0, Math.PI * 2);
        smokeCtx.fill();
      }
      smokeCtx.restore();
      this.smokeFeedback.store(inner);
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.72;
    ctx.drawImage(layer.canvas, 0, 0, width, height);
    ctx.restore();
  }

  /**
   * A ruined colonnade punched out of the fire as true black.  Silhouette
   * against flame is the cheapest honest depth cue there is, and it gives the
   * fire something to be burning.
   */
  drawSilhouette(frame) {
    const { ctx, width, height, audio, kit } = frame;
    const baseY = height * 1.02;
    const sway = frame.reducedMotion ? 0 : Math.sin(this.t * 0.12) * width * 0.004;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";

    const columns = 5;
    for (let c = 0; c < columns; c += 1) {
      const t = (c + 0.5) / columns;
      const x = width * (0.08 + t * 0.84) + sway * (c - 2);
      const w = width * (0.038 + hash01(c * 17) * 0.022);
      const h = height * (0.3 + hash01(c * 17 + 3) * 0.26 + audio.bassAtt * 0.01);
      // Broken tops: each column loses a different amount of its crown.
      const broken = height * hash01(c * 17 + 9) * 0.09;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, baseY);
      ctx.lineTo(x - w * 0.5, baseY - h);
      ctx.lineTo(x - w * 0.16, baseY - h - broken * 0.6);
      ctx.lineTo(x + w * 0.2, baseY - h + broken * 0.35);
      ctx.lineTo(x + w * 0.5, baseY - h + broken * 0.1);
      ctx.lineTo(x + w * 0.5, baseY);
      ctx.closePath();
      ctx.fill();
      // Plinth.
      ctx.fillRect(x - w * 0.78, baseY - height * 0.055, w * 1.56, height * 0.06);
    }

    // The idol: a mass with a hollow where a head should be.
    const ix = width * 0.5;
    const iy = baseY - height * 0.06;
    const iw = width * 0.13;
    const ih = height * 0.42;
    ctx.beginPath();
    ctx.moveTo(ix - iw * 0.5, iy);
    ctx.lineTo(ix - iw * 0.42, iy - ih * 0.72);
    ctx.lineTo(ix - iw * 0.78, iy - ih * 0.82);
    ctx.lineTo(ix - iw * 0.3, iy - ih);
    ctx.lineTo(ix + iw * 0.3, iy - ih * 0.96);
    ctx.lineTo(ix + iw * 0.74, iy - ih * 0.78);
    ctx.lineTo(ix + iw * 0.4, iy - ih * 0.68);
    ctx.lineTo(ix + iw * 0.5, iy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // A cold rim where the fire catches the stone edges.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = kit.palette.amber(0.06 + audio.sustain * 0.16);
    ctx.lineWidth = Math.max(1, frame.ratio);
    ctx.beginPath();
    ctx.moveTo(ix - iw * 0.3, iy - ih);
    ctx.lineTo(ix + iw * 0.3, iy - ih * 0.96);
    ctx.stroke();
    ctx.restore();
  }

  /** Embers riding the same flow field as the flame. */
  drawEmbers(frame, dt) {
    const { ctx, width, height, audio, kit } = frame;
    const reduced = frame.reducedMotion;
    const count = Math.max(24, Math.round(EMBER_COUNT * frame.detail));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
      const e = this.embers[i];
      if (!reduced) {
        const angle = kit.flowAngle(e.x * 2.4, e.y * 2.4 - this.t * 0.5, 1.1);
        e.vx += Math.cos(angle) * 0.06 * dt;
        e.vy -= (0.05 + e.heat * 0.09) * dt * (0.8 + audio.bassAtt * 0.5);
        e.vx *= 0.985;
        e.vy = Math.max(-0.55, e.vy);
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.life -= dt * (0.18 + e.heat * 0.2);
        if (e.y < -0.05 || e.life <= 0) {
          // Respawn in the hot part of the bed rather than uniformly.
          e.x = 0.16 + hash01(frame.frameIndex * 31 + i) * 0.68;
          e.y = 0.94 + hash01(frame.frameIndex * 31 + i + 7) * 0.1;
          e.vx = 0;
          e.vy = -(0.03 + hash01(i * 3 + frame.frameIndex) * 0.09);
          e.life = 0.6 + hash01(i * 5 + frame.frameIndex) * 0.7;
          e.heat = hash01(i * 11 + frame.frameIndex);
        }
      }
      // Fade in and out so nothing pops at the recycle boundary.
      const fade = Math.min(1, e.life * 2.4) * Math.min(1, (1 - e.y) * 6);
      if (fade <= 0.01) continue;
      const glow = 0.2 + e.heat * 0.7;
      ctx.fillStyle = `rgba(255, ${(120 + e.heat * 110) | 0}, ${(48 + e.heat * 70) | 0}, ${(fade * glow).toFixed(3)})`;
      const r = e.size * frame.ratio * (0.6 + e.heat * 0.9);
      ctx.beginPath();
      ctx.arc(e.x * width, e.y * height, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Mixtape furniture: a bruised stamp at the base and a thin readout. */
  drawType(frame) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const size = Math.max(15, width * 0.032);
    kit.stampText(ctx, "BURN THE SIGNAL", width * 0.04, height * 0.885, {
      size,
      ink: palette.bone,
      bruise: palette.blood(0.42),
      rotate: -0.035,
      spread: 2.1 * frame.ratio,
      alpha: 0.34 + audio.sustain * 0.3,
      letterSpacing: -0.03,
    });
    kit.machineText(ctx,
      `FUEL ${String(Math.round(audio.bassRel * 40)).padStart(3, "0")}  FLARE ${String(Math.round(this.flare * 99)).padStart(2, "0")}  ${kit.serialString(frame.time * 1.7, 5)}`,
      width * 0.04, height * 0.945, {
        size: Math.max(9, 12 * frame.ratio),
        color: palette.amber(0.36),
        letterSpacing: 0.06,
      });
  }

  suspend() {
    this.smoke.release();
    this.smokeFeedback.release();
    this.fireLayer.release();
    this.bloom.release();
  }
}
