/**
 * cruciform // scope — laboratory instrumentation that is also an altar.
 *
 * The defining trick here is phosphor persistence.  A real oscilloscope trace
 * is not redrawn each frame, it is *burned* into the tube and left to fade, so
 * the beam paints bright where it lingers and dim where it moves fast.  That is
 * a feedback buffer with zoom exactly 1 and no rotation: the geometry stays
 * dimensionally honest — it has to, or it stops reading as measurement — while
 * the decay does all the work.
 *
 * The frame is composited in the order a real instrument is built:
 *
 *   1. the decayed phosphor,
 *   2. this frame's beam paths, drawn additively,
 *   3. a snapshot taken *here*, so only the beam persists,
 *   4. the graticule, printed on the faceplate in front of the tube,
 *   5. type, sigils and the standing cruciform.
 *
 * Taking the snapshot before the faceplate is what stops the graticule from
 * accumulating into a solid white grid over a few hundred frames.
 *
 * Four channels run at once: the time-domain beam, an X/Y phase figure that
 * draws real closed curves as harmonic content shifts, a polar spectrum rose,
 * and a slow chart-recorder trace along the bottom.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

const HISTORY = 256;          // chart-recorder ring buffer
const ROSE_POINTS = 128;
const DIV_X = 10;             // graticule divisions
const DIV_Y = 8;
const SIGIL_SLOTS = 4;

const CHANNEL_FAULTS = ["SIGNAL LOST", "NO TRIGGER", "OVERRANGE", "PROBE OPEN"];
const LITANY = [
  "MEMORY IS A LOOP",
  "NOTHING BEHIND THE INTERFACE",
  "THE HAND IS THE INSTRUMENT",
  "NO GOD IN THE BUFFER",
];

function hash01(n) {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

export default class CruciformScopeScene {
  static id = "cruciform-scope";
  static label = "cruciform // scope";
  // A tube, so the curvature runs a little hot and the interlace is pronounced.
  // Grain stays low: the phosphor already supplies the texture.
  static post = { grain: 0.06, scanlines: 0.19, dither: 0.06, vignette: 0.54, bar: 0.05, curve: 0.02 };

  constructor(kit) {
    this.kit = kit;
    this.phosphor = new kit.FeedbackWarp({ scale: 1 });
    this.graticule = new kit.Layer({ scale: 1 });
    this.bloom = new kit.Bloom({ scale: 0.3 });
    this.graticuleKey = "";

    this.history = new Float32Array(HISTORY);
    this.historyPeak = new Float32Array(HISTORY);
    this.cursor = 0;

    this.lock = 1;             // trigger lock, 0..1
    this.lockDrop = 0;         // loss-of-lock envelope
    this.faultUntil = -1;      // beatCount at which the current fault clears
    this.faultIndex = 0;
    this.deadChannel = -1;
    this.lastBeat = -1;
    this.rollOffset = 0;
    this.litany = 0;
    this.t = 0;
    this.sweep = 0;
  }

  resize() { this.graticuleKey = ""; }

  // ---------------------------------------------------------------------------
  // Faceplate
  // ---------------------------------------------------------------------------

  /**
   * The graticule is static, so it is stroked once into its own layer and
   * blitted thereafter.  Rebuilding ~200 tick paths every frame is precisely
   * the cost this scene cannot afford, and it never changes.
   */
  buildGraticule(frame) {
    const { width, height, ratio, kit, palette } = frame;
    const key = `${width}x${height}`;
    if (this.graticuleKey === key) return;
    const layer = this.graticule;
    if (!layer.ctx) return;
    layer.match(width, height);
    layer.clear();
    const ctx = layer.ctx;
    const inset = Math.min(width, height) * 0.09;
    const left = inset * 1.6;
    const right = width - inset * 1.6;
    const top = inset;
    const bottom = height - inset * 1.35;
    const w = right - left;
    const h = bottom - top;
    this.plot = { left, right, top, bottom, w, h, cx: (left + right) / 2, cy: (top + bottom) / 2 };

    // Minor ticks: one path for the whole lattice.
    ctx.strokeStyle = palette.wire(0.075);
    ctx.lineWidth = Math.max(1, ratio * 0.7);
    ctx.beginPath();
    for (let i = 0; i <= DIV_X * 5; i += 1) {
      const x = left + (i / (DIV_X * 5)) * w;
      ctx.moveTo(x, this.plot.cy - h * 0.012);
      ctx.lineTo(x, this.plot.cy + h * 0.012);
    }
    for (let i = 0; i <= DIV_Y * 5; i += 1) {
      const y = top + (i / (DIV_Y * 5)) * h;
      ctx.moveTo(this.plot.cx - w * 0.008, y);
      ctx.lineTo(this.plot.cx + w * 0.008, y);
    }
    ctx.stroke();

    // Major divisions.
    ctx.strokeStyle = palette.wire(0.13);
    ctx.lineWidth = Math.max(1, ratio * 0.8);
    ctx.beginPath();
    for (let i = 1; i < DIV_X; i += 1) {
      const x = left + (i / DIV_X) * w;
      ctx.moveTo(x, top); ctx.lineTo(x, bottom);
    }
    for (let i = 1; i < DIV_Y; i += 1) {
      const y = top + (i / DIV_Y) * h;
      ctx.moveTo(left, y); ctx.lineTo(right, y);
    }
    ctx.stroke();

    // Datum axes and the screen border.
    ctx.strokeStyle = palette.wire(0.3);
    ctx.lineWidth = Math.max(1, ratio);
    ctx.beginPath();
    ctx.moveTo(left, this.plot.cy); ctx.lineTo(right, this.plot.cy);
    ctx.moveTo(this.plot.cx, top); ctx.lineTo(this.plot.cx, bottom);
    ctx.strokeRect(left, top, w, h);
    ctx.stroke();

    // Corner brackets — the surveillance landmark, printed on the glass.
    ctx.strokeStyle = palette.wire(0.34);
    ctx.lineWidth = Math.max(1, ratio * 1.4);
    const arm = Math.min(w, h) * 0.05;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [
      [left, top, 1, 1], [right, top, -1, 1],
      [right, bottom, -1, -1], [left, bottom, 1, -1],
    ]) {
      ctx.moveTo(x + sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * arm);
    }
    ctx.stroke();

    // Faceplate legends.
    const small = Math.max(9, 11 * ratio);
    kit.machineText(ctx, "1.00 V/DIV", left, top - small * 0.5, { size: small, color: palette.muted(0.5), shadow: false });
    kit.machineText(ctx, "2.00 ms/DIV", left + w * 0.34, top - small * 0.5, { size: small, color: palette.muted(0.5), shadow: false });
    kit.machineText(ctx, "AC · 1MΩ · x10", left + w * 0.68, top - small * 0.5, { size: small, color: palette.muted(0.5), shadow: false });
    for (let i = 1; i < DIV_X; i += 1) {
      kit.machineText(ctx, String((i - DIV_X / 2) * 2), left + (i / DIV_X) * w, bottom + small * 1.1, {
        size: small * 0.85, color: palette.dim(0.7), align: "center", shadow: false,
      });
    }
    this.graticuleKey = key;
  }

  // ---------------------------------------------------------------------------
  // Beams
  // ---------------------------------------------------------------------------

  /** CH1 — the time-domain beam across the horizontal datum. */
  drawWaveform(frame, alpha) {
    const { ctx, waveform, kit, palette, audio } = frame;
    const p = this.plot;
    if (this.deadChannel === 0) return;
    const count = waveform.length;
    const step = Math.max(1, Math.round(count / (p.w / Math.max(1, frame.ratio)) / 1.5));
    const gain = p.h * 0.34 * (1 + audio.level * 1.6);
    const roll = this.rollOffset * p.w;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // Two passes: a wide dim core and a tight bright filament.  A single stroke
    // width is the reason the old version read as a line drawing, not a beam.
    for (let pass = 0; pass < 2; pass += 1) {
      ctx.strokeStyle = palette.wire(pass === 0 ? alpha * 0.22 : alpha * 0.9);
      ctx.lineWidth = (pass === 0 ? 4.2 : 1.25) * frame.ratio;
      ctx.beginPath();
      for (let i = 0, n = 0; i < count; i += step, n += 1) {
        const x = p.left + ((i / (count - 1)) * p.w + roll) % p.w;
        const y = p.cy + ((waveform[i] - 128) / 128) * gain;
        if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    void kit;
  }

  /**
   * CH2 — X/Y phase figure.  Plotting the signal against a delayed copy of
   * itself draws real Lissajous curves whose shape follows harmonic content,
   * which is the classic vector-scope look and costs one path.
   */
  drawPhase(frame, alpha) {
    const { ctx, waveform, palette, audio } = frame;
    if (this.deadChannel === 1) return;
    const p = this.plot;
    const count = waveform.length;
    const delay = Math.max(3, Math.round(count * (0.02 + audio.brightness * 0.06)));
    const radius = Math.min(p.w, p.h) * 0.3 * (0.7 + audio.midRel * 0.22);
    const step = Math.max(1, Math.round(count / 220));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (let pass = 0; pass < 2; pass += 1) {
      ctx.strokeStyle = palette.violet(pass === 0 ? alpha * 0.16 : alpha * 0.72);
      ctx.lineWidth = (pass === 0 ? 3.4 : 1) * frame.ratio;
      ctx.beginPath();
      for (let i = 0, n = 0; i < count - delay; i += step, n += 1) {
        const x = p.cx + ((waveform[i] - 128) / 128) * radius;
        const y = p.cy + ((waveform[i + delay] - 128) / 128) * radius;
        if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** CH3 — polar spectrum rose around the datum. */
  drawRose(frame, alpha) {
    const { ctx, palette, audio, kit } = frame;
    if (this.deadChannel === 2) return;
    const p = this.plot;
    const inner = Math.min(p.w, p.h) * 0.11;
    const reach = Math.min(p.w, p.h) * 0.32;
    const points = Math.max(48, Math.round(ROSE_POINTS * frame.detail));
    const spin = this.t * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = palette.amber(alpha * 0.5);
    ctx.lineWidth = Math.max(1, frame.ratio);
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const t = i / points;
      const theta = t * Math.PI * 2 + spin;
      // Mirrored so the rose is symmetric — asymmetric polar spectra read as
      // an error rather than a measurement.
      const band = frame.band(Math.abs(t * 2 - 1));
      const r = inner + band * reach;
      const x = p.cx + Math.cos(theta) * r;
      const y = p.cy + Math.sin(theta) * r * 0.82;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    // Peak-hold ghost sitting outside the live rose.
    ctx.strokeStyle = palette.amber(alpha * 0.16);
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const t = i / points;
      const theta = t * Math.PI * 2 + spin;
      const idx = Math.round(Math.abs(t * 2 - 1) * (frame.bandPeaks.length - 1));
      const r = inner + (frame.bandPeaks[idx] || 0) * reach;
      const x = p.cx + Math.cos(theta) * r;
      const y = p.cy + Math.sin(theta) * r * 0.82;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    void audio; void kit;
  }

  /** CH4 — chart recorder: a slow envelope history scrolling along the base. */
  drawChart(frame, alpha) {
    const { ctx, palette } = frame;
    if (this.deadChannel === 3) return;
    const p = this.plot;
    const baseY = p.bottom - p.h * 0.055;
    const span = p.h * 0.11;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = palette.bone(alpha * 0.34);
    ctx.lineWidth = Math.max(1, frame.ratio * 0.9);
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i += 1) {
      const idx = (this.cursor + i) % HISTORY;
      const x = p.left + (i / (HISTORY - 1)) * p.w;
      ctx.lineTo(x, baseY - this.history[idx] * span);
    }
    ctx.stroke();
    ctx.strokeStyle = palette.blood(alpha * 0.28);
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i += 1) {
      const idx = (this.cursor + i) % HISTORY;
      const x = p.left + (i / (HISTORY - 1)) * p.w;
      ctx.lineTo(x, baseY - this.historyPeak[idx] * span);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Monument
  // ---------------------------------------------------------------------------

  /**
   * The cruciform, built as a double-line construction with a bevel so it reads
   * as a heavy standing object rather than two crossed strokes.  It breathes on
   * the damped bass and holds still otherwise; the graticule never moves, and
   * that contrast — fixed instrument, moving icon — is the whole idea.
   */
  drawCross(frame) {
    const { ctx, palette, audio, kit } = frame;
    const p = this.plot;
    const scale = Math.min(p.w, p.h);
    const breath = frame.reducedMotion ? 1 : 1 + Math.sin(this.t * 0.42) * 0.012 + audio.bassAtt * 0.016;
    const armH = scale * 0.34 * breath;   // half-height of the vertical
    const armW = scale * 0.17 * breath;   // half-width of the crossbar
    const thick = scale * 0.026;
    const crossY = p.cy - armH * 0.28;
    const glow = 0.28 + audio.sustain * 0.5;

    ctx.save();
    ctx.translate(p.cx, p.cy);
    if (!frame.reducedMotion) ctx.rotate(Math.sin(this.t * 0.11) * 0.012);
    ctx.translate(-p.cx, -p.cy);

    // Halo behind the monument.
    const halo = ctx.createRadialGradient(p.cx, crossY, 0, p.cx, crossY, scale * 0.42);
    halo.addColorStop(0, palette.violet(0.1 + audio.sustain * 0.12));
    halo.addColorStop(0.5, palette.violet(0.035));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = halo;
    ctx.fillRect(p.left, p.top, p.w, p.h);

    const outline = (inset) => {
      ctx.beginPath();
      ctx.moveTo(p.cx - thick + inset, p.cy - armH + inset);
      ctx.lineTo(p.cx + thick - inset, p.cy - armH + inset);
      ctx.lineTo(p.cx + thick - inset, crossY - thick + inset);
      ctx.lineTo(p.cx + armW - inset, crossY - thick + inset);
      ctx.lineTo(p.cx + armW - inset, crossY + thick - inset);
      ctx.lineTo(p.cx + thick - inset, crossY + thick - inset);
      ctx.lineTo(p.cx + thick - inset, p.cy + armH - inset);
      ctx.lineTo(p.cx - thick + inset, p.cy + armH - inset);
      ctx.lineTo(p.cx - thick + inset, crossY + thick - inset);
      ctx.lineTo(p.cx - armW + inset, crossY + thick - inset);
      ctx.lineTo(p.cx - armW + inset, crossY - thick + inset);
      ctx.lineTo(p.cx - thick + inset, crossY - thick + inset);
      ctx.closePath();
    };

    // Mass, then the bevel line inside it, then the bright contour.
    ctx.fillStyle = palette.violet(0.06 + audio.sustain * 0.05);
    outline(0);
    ctx.fill();
    ctx.strokeStyle = palette.violet(glow * 0.4);
    ctx.lineWidth = Math.max(1, frame.ratio * 0.8);
    outline(thick * 0.38);
    ctx.stroke();
    ctx.strokeStyle = palette.violet(glow);
    ctx.lineWidth = Math.max(1, frame.ratio * 1.5);
    outline(0);
    ctx.stroke();

    // Engraved rungs down the shaft.
    ctx.strokeStyle = palette.violet(glow * 0.32);
    ctx.lineWidth = Math.max(1, frame.ratio * 0.7);
    ctx.beginPath();
    for (let i = 1; i <= 6; i += 1) {
      const y = crossY + thick + (i / 7) * (p.cy + armH - crossY - thick);
      ctx.moveTo(p.cx - thick * 0.7, y);
      ctx.lineTo(p.cx + thick * 0.7, y);
    }
    ctx.stroke();
    ctx.restore();

    // Sigils locked to the graticule, advancing every eight hits.
    const stage = Math.floor(audio.beatCount / 8);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let s = 0; s < SIGIL_SLOTS; s += 1) {
      const angle = (s / SIGIL_SLOTS) * Math.PI * 2 + stage * 0.4;
      const r = scale * 0.44;
      const x = p.cx + Math.cos(angle) * r;
      const y = p.cy + Math.sin(angle) * r * 0.62;
      const size = scale * 0.035 * (1 + (hash01(stage * 7 + s) - 0.5) * 0.3);
      kit.reticle(ctx, x, y, size * 2, { color: palette.wire(0.16 + audio.beat * 0.2), crosshair: true, width: frame.ratio });
      ctx.strokeStyle = palette.blood(0.14 + hash01(stage + s) * 0.2);
      ctx.lineWidth = Math.max(1, frame.ratio * 0.8);
      ctx.beginPath();
      const spokes = 3 + (stage + s) % 4;
      for (let k = 0; k < spokes; k += 1) {
        const a = (k / spokes) * Math.PI * 2 + stage * 0.7;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
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
    this.buildGraticule(frame);
    if (!this.plot) return;

    if (!reduced) {
      this.t += dt;
      this.sweep += dt;
      // Measurement failure, scheduled by beat structure.  Rolling a die every
      // frame reads as noise; losing lock on a downbeat reads as malfunction.
      if (audio.beat > 0.7 && audio.beatCount !== this.lastBeat) {
        this.lastBeat = audio.beatCount;
        if (audio.beatCount % 16 === 0) {
          this.lockDrop = 1;
          this.faultIndex = Math.floor(hash01(audio.beatCount) * CHANNEL_FAULTS.length);
          this.deadChannel = Math.floor(hash01(audio.beatCount * 3 + 1) * 4);
          this.faultUntil = audio.beatCount + 2;
          this.litany = Math.floor(hash01(audio.beatCount * 5) * LITANY.length);
        }
        if (audio.beatCount >= this.faultUntil) this.deadChannel = -1;
      }
      this.lockDrop = Math.max(0, this.lockDrop - dt * 1.5);
      this.lock = 1 - this.lockDrop;
      this.rollOffset = this.lockDrop > 0 ? kit.wrap01(this.rollOffset + dt * 1.9) : this.rollOffset * 0.86;

      this.cursor = (this.cursor + 1) % HISTORY;
      this.history[this.cursor] = audio.level;
      this.historyPeak[this.cursor] = audio.peak;
    } else {
      this.deadChannel = -1;
      this.lockDrop = 0;
      this.rollOffset = 0;
    }

    // 1 + 2: decayed phosphor, then this frame's beams on top of it.
    if (reduced) {
      kit.fadeTo(ctx, width, height, palette.void, 1);
    } else {
      this.phosphor.warp(frame, {
        zoom: 1, rot: 0, decay: 0.9 - audio.transient * 0.03,
        background: palette.void,
      });
    }

    const alpha = 0.55 + audio.level * 0.5;
    this.drawWaveform(frame, alpha);
    this.drawPhase(frame, alpha);
    this.drawRose(frame, alpha * 0.8);
    this.drawChart(frame, alpha);

    // 3: snapshot — only the beam persists into the next frame.
    if (!reduced) this.phosphor.store(frame);

    // 4: the faceplate, printed in front of the tube.
    if (this.graticule.canvas) ctx.drawImage(this.graticule.canvas, 0, 0, width, height);

    // 5: monument, readouts, fault state.
    this.drawCross(frame);
    this.drawReadouts(frame);

    this.bloom.apply(ctx, ctx.canvas, {
      strength: 0.34 + audio.trebAtt * 0.1,
      blur: 13 * frame.ratio,
      passes: 2,
    });
  }

  /** Dense mono furniture, bottom-left and bottom-centre only. */
  drawReadouts(frame) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const p = this.plot;
    const small = Math.max(9, 11 * frame.ratio);
    const lines = [
      `CH1 WAVE  ${this.deadChannel === 0 ? "----" : "LOCK"}  ${String(Math.round(audio.level * 999)).padStart(3, "0")}mV`,
      `CH2 X/Y   ${this.deadChannel === 1 ? "----" : "LOCK"}  Φ ${String(Math.round(audio.brightness * 359)).padStart(3, "0")}°`,
      `CH3 ROSE  ${this.deadChannel === 2 ? "----" : "LOCK"}  ${String(Math.round(audio.midRel * 99)).padStart(2, "0")}dB`,
      `CH4 CHART ${this.deadChannel === 3 ? "----" : "LOCK"}  ${kit.serialString(frame.time * 0.7, 6)}`,
    ];
    lines.forEach((line, i) => {
      const dead = this.deadChannel === i;
      kit.machineText(ctx, line, p.left, p.bottom + small * (1.6 + i * 1.15), {
        size: small,
        color: dead ? palette.blood(0.6) : palette.wire(0.4),
        letterSpacing: 0.05,
      });
    });

    // Trigger state, centre-bottom.
    const triggered = this.lock > 0.55;
    kit.machineText(ctx, triggered ? "TRIG ▶ AUTO" : CHANNEL_FAULTS[this.faultIndex], p.cx, p.top - small * 0.5, {
      size: small,
      align: "center",
      color: triggered ? palette.wire(0.5) : palette.blood(0.75),
      letterSpacing: 0.1,
    });

    // A single line of scripture, dim, under the plot.
    kit.machineText(ctx, LITANY[this.litany], p.cx, height - small * 0.9, {
      size: small * 0.95,
      align: "center",
      color: palette.dim(0.55),
      letterSpacing: 0.22,
    });
    void width;
  }

  suspend() {
    this.phosphor.release();
    this.graticule.release();
    this.bloom.release();
    this.graticuleKey = "";
  }
}
