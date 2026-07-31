/**
 * lava // lamp — a retro-anime lava lamp, plugged in and monitored.
 *
 * Two ideas carry the scene.
 *
 * The wax is metaballs. Soft radial fields are summed additively into an
 * offscreen layer, then that whole layer is composited back through a
 * `blur() contrast()` filter in one draw call. Because the filter runs over the
 * *summed* field rather than over each blob, neighbours fuse into a single
 * hard-edged body — real surface tension, no per-pixel scalar field.
 *
 * The field is kept OPAQUE — white blobs on solid black — because `contrast()`
 * operates on colour channels and leaves alpha untouched. Thresholding a
 * transparent field hardens the colour while the alpha edge stays exactly as
 * soft as it started, and the wax comes out looking like an airbrush. Working
 * in luminance instead, tinting with `multiply` and compositing with `lighter`,
 * keeps the edge as crisp as the filter made it.
 *
 * The cel shading falls out of the same trick for free. Putting a `brightness()`
 * in front of the `contrast()` moves the threshold the silhouette is cut at, so
 * the same field rendered at four brightnesses gives four nested regions. Each
 * contributes a flat increment of colour, so the bands step hard from oxblood at
 * the rim to hot amber at the core, and differencing the outermost two gives the
 * rim light. That is cel animation's actual construction — flat areas bounded by
 * a hard edge — rather than a gradient pretending to be one.
 *
 * Everything cold around it is deliberate: the wax is the only warm, living
 * thing, and it is surrounded by screentone, etched sigils and machine
 * diagnostics measuring it like a specimen.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

const BLOB_COUNT = 16;
const TONE_TILE = 8;

// Cel bands: [brightness applied before the threshold, additive increment].
// Larger brightness cuts a larger silhouette, so these run outermost-first and
// each inner band stacks onto the ones outside it — the core ends up hot amber.
const BANDS = [
  [1.5, "rgb(74, 10, 28)"],
  [1.05, "rgb(84, 28, 20)"],
  [0.76, "rgb(74, 62, 18)"],
  [0.55, "rgb(40, 74, 54)"],
];

function hash01(n) {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

export default class LavaLampScene {
  static id = "lava-lamp";
  static label = "lava // lamp";
  // Flat cel areas show dithering badly, so ordered dither is dialled back and
  // the print grain carries the texture instead.
  static post = { grain: 0.1, scanlines: 0.13, dither: 0.03, vignette: 0.6, bar: 0.03, curve: 0.017 };

  constructor(kit) {
    this.kit = kit;
    // Opaque: the threshold works in luminance, so these carry black, not alpha.
    this.field = new kit.Layer({ scale: 0.45, alpha: false });
    this.scratch = new kit.Layer({ scale: 0.45, alpha: false });
    this.shade = new kit.Layer({ scale: 0.45, alpha: false });
    this.bloom = new kit.Bloom({ scale: 0.3 });

    this.tone = null;
    this.tonePattern = null;
    this.buildTone();

    this.blobs = new Array(BLOB_COUNT);
    for (let i = 0; i < BLOB_COUNT; i += 1) {
      this.blobs[i] = {
        x: 0.5 + (hash01(i * 9 + 1) - 0.5) * 0.5,
        y: 0.62 + hash01(i * 9 + 2) * 0.36,
        vx: 0,
        vy: 0,
        r: 0.055 + hash01(i * 9 + 3) * 0.075,
        heat: hash01(i * 9 + 4),
        wobble: hash01(i * 9 + 5) * 6.28,
        band: i / BLOB_COUNT,
      };
    }

    this.plugged = 1;      // 0..1 warmth of the element; drops when silent
    this.lastBeat = -1;
    this.pinch = 0;
    this.t = 0;
  }

  /** The cached pattern belongs to a context that resizing throws away. */
  resize() { this.tonePattern = null; }

  /** Halftone tile, built once and used as a repeating pattern. */
  buildTone() {
    const surface = this.kit.createSurface(TONE_TILE, TONE_TILE);
    const ctx = surface?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, TONE_TILE, TONE_TILE);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.arc(TONE_TILE * 0.25, TONE_TILE * 0.25, 1.25, 0, Math.PI * 2);
    ctx.arc(TONE_TILE * 0.75, TONE_TILE * 0.75, 1.25, 0, Math.PI * 2);
    ctx.fill();
    this.tone = surface;
  }

  /** The vessel profile, in canvas coordinates. */
  vessel(frame) {
    const { width, height } = frame;
    const cx = width * 0.5;
    const top = height * 0.1;
    const bottom = height * 0.79;
    const halfTop = Math.min(width * 0.1, height * 0.19);
    const halfBottom = Math.min(width * 0.15, height * 0.29);
    return { cx, top, bottom, halfTop, halfBottom, h: bottom - top };
  }

  /** Traces the tapered glass so the wax can be clipped to it. */
  vesselPath(ctx, v, inset = 0) {
    const top = v.top + inset;
    const bottom = v.bottom - inset;
    const ht = v.halfTop - inset;
    const hb = v.halfBottom - inset;
    ctx.beginPath();
    ctx.moveTo(v.cx - ht, top);
    ctx.bezierCurveTo(v.cx - ht * 1.02, top + v.h * 0.4, v.cx - hb * 0.99, bottom - v.h * 0.22, v.cx - hb, bottom);
    ctx.lineTo(v.cx + hb, bottom);
    ctx.bezierCurveTo(v.cx + hb * 0.99, bottom - v.h * 0.22, v.cx + ht * 1.02, top + v.h * 0.4, v.cx + ht, top);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------------
  // Convection
  // ---------------------------------------------------------------------------

  /**
   * Wax convection: heated at the base, cooled at the cap. Blobs rise while
   * hot, flatten and give up heat at the top, then sink down the sides. A lamp
   * whose blobs float straight up at a constant rate is a dead lamp.
   */
  stepBlobs(frame, dt) {
    const { audio, kit } = frame;
    const count = this.blobs.length;
    const drive = 0.35 + audio.bassAtt * 0.4 + this.pinch * 0.5;
    for (let i = 0; i < count; i += 1) {
      const b = this.blobs[i];
      // Heat exchange with the element below and the cap above.
      const nearBase = kit.clamp((b.y - 0.62) / 0.38);
      const nearCap = kit.clamp((0.3 - b.y) / 0.3);
      b.heat += (nearBase * this.plugged * 1.5 - nearCap * 1.7 - 0.12) * dt * 0.55;
      b.heat = kit.clamp(b.heat, 0, 1);

      // Buoyancy, damped; heavy blobs sink even while warm.
      const buoyancy = (b.heat - 0.46) * drive;
      b.vy += (-buoyancy * 0.55 - b.vy * 1.5) * dt;
      // Lateral convection: up the middle, down the walls.
      const toWall = b.x - 0.5;
      b.wobble += dt * 0.6;
      const lateral = Math.sin(b.wobble) * 0.02 + kit.noise2D(b.x * 4, b.y * 4 + this.t * 0.2) - 0.5;
      b.vx += (lateral * 0.09 - toWall * (b.heat > 0.5 ? 0.12 : -0.14) - b.vx * 1.7) * dt;

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // The vessel walls and the meniscus keep everything contained.
      const margin = 0.09 + b.r * 0.5;
      if (b.x < margin) { b.x = margin; b.vx = Math.abs(b.vx) * 0.4; }
      if (b.x > 1 - margin) { b.x = 1 - margin; b.vx = -Math.abs(b.vx) * 0.4; }
      if (b.y < 0.06 + b.r) { b.y = 0.06 + b.r; b.vy = Math.abs(b.vy) * 0.3; }
      if (b.y > 0.97 - b.r * 0.6) { b.y = 0.97 - b.r * 0.6; b.vy = -Math.abs(b.vy) * 0.25; }
    }
  }

  // ---------------------------------------------------------------------------
  // Wax
  // ---------------------------------------------------------------------------

  /** Sums the blob fields; the filter pass downstream turns this into wax. */
  paintField(frame) {
    const layer = this.field;
    if (!layer.ctx) return false;
    layer.match(frame.width, frame.height);
    const ctx = layer.ctx;
    const w = layer.width;
    const h = layer.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const count = Math.max(8, Math.round(BLOB_COUNT * frame.detail));
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
      const b = this.blobs[i];
      // Rising blobs stretch, settling ones flatten — the read on surface
      // tension that a plain circle never gives you.
      const stretch = 1 + Math.max(0, -b.vy) * 1.4;
      const energy = frame.band(b.band);
      const radius = b.r * (0.86 + energy * 0.3 + this.pinch * 0.12) * Math.min(w, h) * 1.5;
      const x = b.x * w;
      const y = b.y * h;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.45, "rgba(255,255,255,0.52)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1 / Math.sqrt(stretch), stretch);
      ctx.translate(-x, -y);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return true;
  }

  /**
   * One cel band: the summed field thresholded at `brightness`, filled flat.
   * `contrast` controls how hard the edge is.
   */
  stampBand(brightness, contrast, fill, blur) {
    const scratch = this.scratch;
    const shade = this.shade;
    if (!scratch.ctx || !shade.ctx) return;
    const ctx = scratch.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.globalAlpha = 1;
    ctx.filter = `blur(${blur.toFixed(2)}px) brightness(${brightness}) contrast(${contrast})`;
    ctx.drawImage(this.field.canvas, 0, 0, scratch.width, scratch.height);
    ctx.filter = "none";
    // Multiply paints the increment inside the silhouette and leaves the
    // surrounding black at black, so `lighter` adds it without a halo.
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, scratch.width, scratch.height);
    shade.ctx.globalCompositeOperation = "lighter";
    shade.ctx.drawImage(scratch.canvas, 0, 0);
  }

  /** Builds the full cel stack plus the ink contour. */
  paintWax(frame) {
    const shade = this.shade;
    const scratch = this.scratch;
    if (!shade.ctx || !scratch.ctx) return;
    shade.match(frame.width, frame.height);
    scratch.match(frame.width, frame.height);
    shade.ctx.setTransform(1, 0, 0, 1, 0, 0);
    shade.ctx.globalCompositeOperation = "source-over";
    shade.ctx.globalAlpha = 1;
    shade.ctx.fillStyle = "#000";
    shade.ctx.fillRect(0, 0, shade.width, shade.height);
    const blur = Math.max(2.5, 5 * frame.detail);
    const contrast = 18 + frame.audio.trebAtt * 4;

    for (const [brightness, fill] of BANDS) this.stampBand(brightness, contrast, fill, blur);

    // Contour: the outermost silhouette minus a marginally tighter one.
    const ctx = scratch.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.filter = `blur(${blur.toFixed(2)}px) brightness(1.62) contrast(${contrast})`;
    ctx.drawImage(this.field.canvas, 0, 0, scratch.width, scratch.height);
    // `difference`, not `destination-out`: the layer is opaque, so an alpha
    // erase would take the whole frame with it. In luminance the difference of
    // the two thresholds is exactly the ring between them.
    ctx.globalCompositeOperation = "difference";
    ctx.filter = `blur(${blur.toFixed(2)}px) brightness(1.24) contrast(${contrast})`;
    ctx.drawImage(this.field.canvas, 0, 0, scratch.width, scratch.height);
    ctx.filter = "none";
    // The ring is the only place the wax reaches bone — a backlit rim rather
    // than an ink line, which is what glass in front of a lamp actually does.
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgb(158, 128, 100)";
    ctx.fillRect(0, 0, scratch.width, scratch.height);
    shade.ctx.globalCompositeOperation = "lighter";
    shade.ctx.drawImage(scratch.canvas, 0, 0);

    // Screentone over the mid band, the way cheap cel work filled its shadows.
    if (this.tone) {
      if (!this.tonePattern) this.tonePattern = shade.ctx.createPattern(this.tone, "repeat");
      if (this.tonePattern) {
        // Multiply only bites where the wax already is; black stays black.
        shade.ctx.globalCompositeOperation = "multiply";
        shade.ctx.globalAlpha = 0.42;
        shade.ctx.fillStyle = this.tonePattern;
        shade.ctx.fillRect(0, 0, shade.width, shade.height);
        shade.ctx.globalAlpha = 1;
        shade.ctx.globalCompositeOperation = "source-over";
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  render(frame) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const reduced = frame.reducedMotion;
    const dt = Math.min(0.05, frame.dt);
    const v = this.vessel(frame);

    if (!reduced) {
      this.t += dt;
      this.pinch = Math.max(0, this.pinch - dt * 1.7);
      if (audio.beat > 0.68 && audio.beatCount !== this.lastBeat) {
        this.lastBeat = audio.beatCount;
        this.pinch = Math.min(1, this.pinch + 0.45);
      }
      // Unplugged wax cools and settles; this is the state a visitor sees.
      this.plugged += ((audio.silent ? 0.12 : 1) - this.plugged) * (1 - Math.exp(-dt / 2.4));
      this.stepBlobs(frame, dt);
    }

    kit.fadeTo(ctx, width, height, palette.void, 1);

    // The room: a cold pool of light on the surface the lamp stands on.
    const room = ctx.createRadialGradient(v.cx, v.bottom, 0, v.cx, v.bottom, Math.max(width, height) * 0.55);
    room.addColorStop(0, `rgba(78, 22, 40, ${(0.16 + audio.sustain * 0.2) * this.plugged})`);
    room.addColorStop(0.45, "rgba(30, 12, 34, 0.09)");
    room.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = room;
    ctx.fillRect(0, 0, width, height);

    // Glass interior, unlit.
    ctx.save();
    this.vesselPath(ctx, v);
    ctx.fillStyle = "rgba(14, 8, 16, 0.92)";
    ctx.fill();
    ctx.restore();

    // Wax, clipped to the vessel so nothing can escape the glass.
    if (this.paintField(frame)) {
      this.paintWax(frame);
      ctx.save();
      this.vesselPath(ctx, v, Math.max(1, frame.ratio));
      ctx.clip();
      // The wax layer is opaque black outside the blobs, so it is added, not
      // painted over — that keeps the glass interior visible around it.
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.55 + this.plugged * 0.45;
      if (this.shade.canvas) ctx.drawImage(this.shade.canvas, 0, 0, width, height);
      ctx.restore();
    }

    this.drawGlass(frame, v);
    this.drawFurniture(frame, v);

    if (this.shade.canvas) {
      this.bloom.apply(ctx, this.shade.canvas, {
        strength: (0.3 + audio.sustain * 0.24) * this.plugged,
        blur: 18 * frame.ratio,
        passes: 2,
      });
    }
    this.drawReadouts(frame, v);
  }

  /** Glass thickness, specular streak and the etched sigils. */
  drawGlass(frame, v) {
    const { ctx, audio, kit, palette } = frame;
    const line = Math.max(1, frame.ratio);

    // Body highlight down one side, shadow the other.
    ctx.save();
    this.vesselPath(ctx, v);
    ctx.clip();
    const sheen = ctx.createLinearGradient(v.cx - v.halfBottom, 0, v.cx + v.halfBottom, 0);
    sheen.addColorStop(0, "rgba(255,255,255,0.09)");
    sheen.addColorStop(0.18, "rgba(255,255,255,0.02)");
    sheen.addColorStop(0.72, "rgba(0,0,0,0.16)");
    sheen.addColorStop(1, "rgba(0,0,0,0.34)");
    ctx.fillStyle = sheen;
    ctx.fillRect(v.cx - v.halfBottom, v.top, v.halfBottom * 2, v.h);
    // A hard specular streak, the anime glass cue.
    ctx.strokeStyle = palette.bone(0.2);
    ctx.lineWidth = line * 2.4;
    ctx.beginPath();
    ctx.moveTo(v.cx - v.halfTop * 0.55, v.top + v.h * 0.08);
    ctx.lineTo(v.cx - v.halfBottom * 0.62, v.top + v.h * 0.52);
    ctx.stroke();
    ctx.restore();

    // Rim.
    ctx.strokeStyle = palette.bone(0.26);
    ctx.lineWidth = line * 1.4;
    this.vesselPath(ctx, v);
    ctx.stroke();

    // Etched sigils on the glass, advancing every eight hits.
    const stage = Math.floor(audio.beatCount / 8);
    ctx.save();
    ctx.strokeStyle = palette.wire(0.14 + audio.beat * 0.12);
    ctx.lineWidth = line;
    for (let s = 0; s < 3; s += 1) {
      const y = v.top + v.h * (0.2 + s * 0.28);
      const size = v.halfTop * 0.26;
      const x = v.cx + (s % 2 ? 1 : -1) * v.halfTop * 0.5;
      ctx.beginPath();
      const spokes = 3 + (stage + s) % 4;
      for (let k = 0; k < spokes; k += 1) {
        const a = (k / spokes) * Math.PI * 2 + stage * 0.6;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
      }
      ctx.arc(x, y, size * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    void kit;
  }

  /** Base, collar, cap — the object has to sit on something. */
  drawFurniture(frame, v) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const line = Math.max(1, frame.ratio);
    const baseTop = v.bottom;
    const baseBottom = Math.min(height * 0.96, v.bottom + v.h * 0.19);
    const halfB = v.halfBottom * 1.34;

    // Collar.
    ctx.fillStyle = "rgba(30, 24, 30, 1)";
    ctx.fillRect(v.cx - v.halfBottom * 1.08, baseTop - line * 2, v.halfBottom * 2.16, v.h * 0.035);
    ctx.strokeStyle = palette.bone(0.2);
    ctx.lineWidth = line;
    ctx.strokeRect(v.cx - v.halfBottom * 1.08, baseTop - line * 2, v.halfBottom * 2.16, v.h * 0.035);

    // Tapered base.
    ctx.beginPath();
    ctx.moveTo(v.cx - v.halfBottom, baseTop + v.h * 0.03);
    ctx.lineTo(v.cx - halfB, baseBottom);
    ctx.lineTo(v.cx + halfB, baseBottom);
    ctx.lineTo(v.cx + v.halfBottom, baseTop + v.h * 0.03);
    ctx.closePath();
    const metal = ctx.createLinearGradient(v.cx - halfB, 0, v.cx + halfB, 0);
    metal.addColorStop(0, "rgba(46, 38, 44, 1)");
    metal.addColorStop(0.22, "rgba(96, 86, 92, 1)");
    metal.addColorStop(0.6, "rgba(26, 22, 28, 1)");
    metal.addColorStop(1, "rgba(12, 10, 14, 1)");
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.strokeStyle = palette.bone(0.16);
    ctx.lineWidth = line;
    ctx.stroke();

    // The element glowing through the vents.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = palette.ember(0.18 * this.plugged + audio.sustain * 0.1);
    for (let i = 0; i < 7; i += 1) {
      const x = v.cx + (i - 3) * halfB * 0.24;
      ctx.fillRect(x - line, baseTop + v.h * 0.07, line * 2, v.h * 0.05);
    }
    ctx.restore();

    // Cap.
    ctx.fillStyle = "rgba(24, 20, 26, 1)";
    ctx.fillRect(v.cx - v.halfTop * 0.92, v.top - v.h * 0.05, v.halfTop * 1.84, v.h * 0.052);
    ctx.strokeStyle = palette.bone(0.18);
    ctx.strokeRect(v.cx - v.halfTop * 0.92, v.top - v.h * 0.05, v.halfTop * 1.84, v.h * 0.052);

    // Stamped label on the base.
    kit.stampText(ctx, "RELIQUARY", v.cx, baseBottom - (baseBottom - baseTop) * 0.3, {
      size: Math.max(11, width * 0.021),
      align: "center",
      ink: palette.bone,
      bruise: palette.blood(0.5),
      rotate: -0.02,
      spread: 1.7 * frame.ratio,
      alpha: 0.5,
      letterSpacing: -0.02,
    });
  }

  /** Cold diagnostics measuring a warm thing. */
  drawReadouts(frame, v) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const small = Math.max(9, 11 * frame.ratio);
    let hottest = 0;
    for (const b of this.blobs) if (b.heat > hottest) hottest = b.heat;
    const lines = [
      `WAX ${this.plugged > 0.4 ? "MOLTEN" : "SET"}  T ${String(Math.round(38 + hottest * 34)).padStart(2, "0")}°C`,
      `MASS ${String(Math.round(audio.midRel * 60 + 40)).padStart(3, "0")}g  VISC 0.${String(Math.round((1 - hottest) * 89)).padStart(2, "0")}`,
      `CONV ${String(Math.round(audio.bassRel * 40)).padStart(3, "0")}  CYCLE ${kit.serialString(this.t * 0.4, 4)}`,
    ];
    lines.forEach((text, i) => {
      kit.machineText(ctx, text, width * 0.04, height * 0.86 + i * small * 1.2, {
        size: small, color: palette.wire(0.32), letterSpacing: 0.06,
      });
    });
    // A measurement bracket around the vessel, observing it.
    kit.reticle(ctx, v.cx, v.top + v.h * 0.5, Math.max(v.halfBottom * 2.4, v.h * 0.6), {
      color: palette.wire(0.12 + audio.beat * 0.1), width: Math.max(1, frame.ratio), arm: 0.1,
    });
  }

  suspend() {
    this.field.release();
    this.scratch.release();
    this.shade.release();
    this.bloom.release();
    this.tonePattern = null;
  }
}
