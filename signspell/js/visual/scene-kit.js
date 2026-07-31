/**
 * scene-kit.js — the shared rendering toolkit behind every $IGN⸸$PELL scene.
 *
 * Every visualizer mode is an original canvas scene, but they all share the
 * same physical vocabulary: photocopied stamp type, surveillance overlays,
 * bloom that behaves like a CRT phosphor, dirty film grain and cheap-but-real
 * 3D projection.  Those primitives live here so the modes stay readable and so
 * the whole instrument looks like one object instead of six demos.
 *
 * Constraints that shaped this file:
 * - No external assets.  Textures are generated once into offscreen surfaces.
 * - Nothing at module scope may touch `document`; the Node test suite imports
 *   the visualizer for its constants.  Surfaces are allocated lazily.
 * - Target is desktop Chrome/Edge, so `ctx.filter` blur is fair game and is by
 *   far the cheapest way to get honest bloom out of a 2D context.
 */

export const TAU = Math.PI * 2;

export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrap01 = (value) => ((value % 1) + 1) % 1;
export const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach.  `rate` is per second. */
export const approach = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** Deterministic PRNG so particle fields look designed instead of random. */
export function mulberry32(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

const NOISE_DIM = 256;
const NOISE_MASK = NOISE_DIM - 1;
const NOISE_TABLE = (() => {
  const random = mulberry32(0x515e11);
  const table = new Float32Array(NOISE_DIM * NOISE_DIM);
  for (let index = 0; index < table.length; index += 1) table[index] = random();
  return table;
})();

const noiseAt = (x, y) => NOISE_TABLE[((y & NOISE_MASK) << 8) + (x & NOISE_MASK)];

/** Smooth value noise in the 0..1 range. */
export function noise2D(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = noiseAt(xi, yi);
  const b = noiseAt(xi + 1, yi);
  const c = noiseAt(xi, yi + 1);
  const d = noiseAt(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Fractal noise.  Four octaves is plenty for smoke, plasma and drift. */
export function fbm(x, y, octaves = 4, gain = 0.5, lacunarity = 2.03) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise2D(x, y) * amplitude;
    total += amplitude;
    amplitude *= gain;
    x *= lacunarity;
    y *= lacunarity;
  }
  return sum / (total || 1);
}

/** Curl-ish 2D flow direction sampled from the noise field. */
export function flowAngle(x, y, scale = 1) {
  return (fbm(x * scale, y * scale, 3) - 0.5) * TAU * 1.6;
}

// ---------------------------------------------------------------------------
// Palette + type
// ---------------------------------------------------------------------------

const rgba = (r, g, b) => (alpha = 1) => `rgba(${r},${g},${b},${alpha})`;

/**
 * The instrument's ink set, matching the CSS custom properties.  Each entry is
 * a callable so scenes read as `palette.wire(0.4)` instead of string soup.
 */
export const palette = Object.freeze({
  void: rgba(8, 7, 9),
  ink: rgba(21, 17, 23),
  bone: rgba(239, 230, 208),
  muted: rgba(166, 157, 150),
  dim: rgba(103, 96, 105),
  wire: rgba(165, 255, 157),
  violet: rgba(177, 140, 255),
  blood: rgba(225, 72, 88),
  amber: rgba(233, 168, 91),
  ember: rgba(255, 118, 46),
  hues: Object.freeze({ wire: 114, violet: 262, blood: 353, amber: 33, ember: 21 }),
});

export const FONTS = Object.freeze({
  stamp: '"Rubik Dirt", "Arial Black", Impact, system-ui, sans-serif',
  mono: 'VT323, "Share Tech Mono", "Cascadia Mono", Consolas, monospace',
  display: '"UnifrakturCook", "Old English Text MT", Georgia, serif',
});

/** Fake machine numerals for surveillance overlays. */
export function serialString(seed, length = 6) {
  const random = mulberry32(Math.floor(seed) + 7);
  let out = "";
  for (let index = 0; index < length; index += 1) out += Math.floor(random() * 10);
  return out;
}

export const hexString = (seed, length = 4) =>
  Math.floor(Math.abs(seed) * 0xffffff).toString(16).toUpperCase().padStart(length, "0").slice(-length);

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** Allocates the best available offscreen surface for the platform. */
export function createSurface(width = 1, height = 1) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

/**
 * A resizable offscreen render target.  Scenes composite through these to get
 * trails, bloom and warp without ever reading pixels back on the main thread.
 */
export class Layer {
  /** @param {{ scale?: number, alpha?: boolean }} [options] */
  constructor(options = {}) {
    this.scale = options.scale ?? 1;
    this.alpha = options.alpha ?? true;
    this.canvas = createSurface(1, 1);
    this.ctx = this.canvas?.getContext("2d", { alpha: this.alpha }) ?? null;
    this.width = 1;
    this.height = 1;
  }

  /** Resizes to `width * scale` and reports whether the buffer was rebuilt. */
  match(width, height) {
    const target = { w: Math.max(1, Math.round(width * this.scale)), h: Math.max(1, Math.round(height * this.scale)) };
    if (!this.canvas || (this.canvas.width === target.w && this.canvas.height === target.h)) {
      this.width = this.canvas?.width ?? 1;
      this.height = this.canvas?.height ?? 1;
      return false;
    }
    this.canvas.width = target.w;
    this.canvas.height = target.h;
    this.width = target.w;
    this.height = target.h;
    this.ctx?.setTransform(1, 0, 0, 1, 0, 0);
    return true;
  }

  clear() {
    if (!this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /** Bleeds the previous frame away — the trail engine for every scene. */
  fade(color, alpha = 0.2, composite = "source-over") {
    if (!this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalCompositeOperation = composite;
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = typeof color === "function" ? color(alpha) : color;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.globalCompositeOperation = "source-over";
  }

  /** Frees the backing store while a mode is off screen. */
  release() {
    if (!this.canvas) return;
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.width = 1;
    this.height = 1;
  }
}

// ---------------------------------------------------------------------------
// Post processing
// ---------------------------------------------------------------------------

/**
 * Phosphor bloom.  A self-multiply pass approximates a luminance threshold
 * without ever touching ImageData, then a blurred additive composite puts the
 * halo back over the scene.
 */
export class Bloom {
  constructor(options = {}) {
    this.scale = options.scale ?? 0.34;
    this.bright = new Layer({ scale: this.scale });
    this.scratch = new Layer({ scale: this.scale });
  }

  /**
   * @param {CanvasRenderingContext2D} ctx destination
   * @param {HTMLCanvasElement|OffscreenCanvas} source already-rendered scene
   */
  apply(ctx, source, options = {}) {
    const strength = options.strength ?? 0.85;
    const blur = options.blur ?? 16;
    const passes = options.passes ?? 2;
    const threshold = options.threshold ?? 1;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    if (!this.bright.ctx || !this.scratch.ctx || strength <= 0) return;
    this.bright.match(width, height);
    this.scratch.match(width, height);
    const bright = this.bright.ctx;
    const scratch = this.scratch.ctx;

    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.globalCompositeOperation = "copy";
    scratch.globalAlpha = 1;
    scratch.filter = "none";
    scratch.drawImage(source, 0, 0, this.scratch.width, this.scratch.height);

    bright.setTransform(1, 0, 0, 1, 0, 0);
    bright.globalCompositeOperation = "copy";
    bright.globalAlpha = 1;
    bright.filter = "none";
    bright.drawImage(this.scratch.canvas, 0, 0);
    // Squaring the layer crushes the mids and leaves the hot cores glowing.
    for (let pass = 0; pass < threshold; pass += 1) {
      bright.globalCompositeOperation = "multiply";
      bright.drawImage(this.scratch.canvas, 0, 0);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = options.composite ?? "lighter";
    for (let pass = 0; pass < passes; pass += 1) {
      const spread = blur * (pass + 1) / passes;
      ctx.filter = `blur(${spread.toFixed(2)}px)`;
      ctx.globalAlpha = clamp(strength / (pass + 1), 0, 1);
      ctx.drawImage(this.bright.canvas, 0, 0, width, height);
    }
    ctx.filter = "none";
    ctx.restore();
  }

  release() {
    this.bright.release();
    this.scratch.release();
  }
}

/**
 * Channel separation.  Two tinted copies of the scene are offset and screened
 * back over it — the lens error that sells a degraded broadcast.
 */
export class RgbSplit {
  constructor(options = {}) {
    this.scale = options.scale ?? 0.6;
    this.red = new Layer({ scale: this.scale });
    this.blue = new Layer({ scale: this.scale });
  }

  apply(ctx, source, options = {}) {
    const amount = options.amount ?? 3;
    const alpha = options.alpha ?? 0.42;
    if (!this.red.ctx || !this.blue.ctx || amount <= 0 || alpha <= 0) return;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    this.red.match(width, height);
    this.blue.match(width, height);
    const angle = options.angle ?? 0;
    const dx = Math.cos(angle) * amount;
    const dy = Math.sin(angle) * amount;

    for (const [layer, tint] of [[this.red, "#ff2b2b"], [this.blue, "#2bc4ff"]]) {
      const target = layer.ctx;
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.filter = "none";
      target.globalAlpha = 1;
      target.globalCompositeOperation = "copy";
      target.drawImage(source, 0, 0, layer.width, layer.height);
      target.globalCompositeOperation = "multiply";
      target.fillStyle = tint;
      target.fillRect(0, 0, layer.width, layer.height);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.red.canvas, dx, dy, width, height);
    ctx.drawImage(this.blue.canvas, -dx, -dy, width, height);
    ctx.restore();
  }

  release() {
    this.red.release();
    this.blue.release();
  }
}

/**
 * Pre-baked grain tiles cycled as a pattern.  Generating noise per frame is
 * the classic way to lose the frame budget; four tiles look identical in
 * motion and cost one fillRect.
 */
export class Grain {
  constructor(options = {}) {
    this.tileSize = options.tileSize ?? 128;
    this.tiles = options.tiles ?? 5;
    this.contrast = options.contrast ?? 1;
    this.surfaces = [];
    this.patterns = [];
  }

  build(ctx) {
    if (this.surfaces.length) return;
    const random = mulberry32(0x9e37);
    for (let tile = 0; tile < this.tiles; tile += 1) {
      const surface = createSurface(this.tileSize, this.tileSize);
      const target = surface?.getContext("2d");
      if (!target) return;
      const image = target.createImageData(this.tileSize, this.tileSize);
      for (let index = 0; index < image.data.length; index += 4) {
        // Slightly clustered noise reads as photocopy toner, not TV static.
        const base = random();
        const value = clamp(0.5 + (base - 0.5) * (1.35 + this.contrast * 0.9)) * 255;
        image.data[index] = value;
        image.data[index + 1] = value;
        image.data[index + 2] = value;
        image.data[index + 3] = 26 + random() * 60;
      }
      target.putImageData(image, 0, 0);
      this.surfaces.push(surface);
      this.patterns.push(ctx.createPattern(surface, "repeat"));
    }
  }

  apply(ctx, width, height, options = {}) {
    const alpha = options.alpha ?? 0.09;
    if (alpha <= 0) return;
    this.build(ctx);
    const pattern = this.patterns[(options.frame ?? 0) % Math.max(1, this.patterns.length)];
    if (!pattern) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = options.composite ?? "overlay";
    ctx.globalAlpha = alpha;
    const offsetX = -Math.floor((options.jitter ?? 0) * this.tileSize);
    const offsetY = -Math.floor((options.jitter ?? 0) * this.tileSize * 0.7);
    ctx.translate(offsetX, offsetY);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width - offsetX, height - offsetY);
    ctx.restore();
  }

  release() {
    this.surfaces.length = 0;
    this.patterns.length = 0;
  }
}

/** Ordered 4x4 Bayer dither, cached as a pattern.  Cheap 2000s desktop feel. */
export class Dither {
  constructor(options = {}) {
    this.cell = options.cell ?? 2;
    this.pattern = null;
  }

  build(ctx) {
    if (this.pattern) return;
    const matrix = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const size = 4 * this.cell;
    const surface = createSurface(size, size);
    const target = surface?.getContext("2d");
    if (!target) return;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        target.fillStyle = `rgba(0,0,0,${(matrix[y * 4 + x] / 16) * 0.85})`;
        target.fillRect(x * this.cell, y * this.cell, this.cell, this.cell);
      }
    }
    this.pattern = ctx.createPattern(surface, "repeat");
  }

  apply(ctx, width, height, alpha = 0.16) {
    if (alpha <= 0) return;
    this.build(ctx);
    if (!this.pattern) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = this.pattern;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  release() { this.pattern = null; }
}

/** Interlace / CRT line structure.  Cached gradient-free, so it is one draw. */
export function scanlines(ctx, width, height, options = {}) {
  const alpha = options.alpha ?? 0.18;
  if (alpha <= 0) return;
  const period = Math.max(2, options.period ?? 3);
  const offset = options.offset ?? 0;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = options.composite ?? "multiply";
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = (offset % period + period) % period; y < height; y += period) {
    ctx.fillRect(0, y, width, 1);
  }
  ctx.restore();
}

/** A slow bright band rolling down the tube. */
export function rollingBar(ctx, width, height, position, options = {}) {
  const thickness = options.thickness ?? height * 0.18;
  const alpha = options.alpha ?? 0.05;
  if (alpha <= 0) return;
  const y = wrap01(position) * (height + thickness) - thickness;
  const gradient = ctx.createLinearGradient(0, y, 0, y + thickness);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.5, `rgba(220,255,215,${alpha})`);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y, width, thickness);
  ctx.restore();
}

export function vignette(ctx, width, height, options = {}) {
  const strength = options.strength ?? 0.55;
  if (strength <= 0) return;
  const inner = options.inner ?? 0.42;
  const gradient = ctx.createRadialGradient(
    width * 0.5, height * 0.5, Math.min(width, height) * inner,
    width * 0.5, height * 0.5, Math.max(width, height) * (options.outer ?? 0.78),
  );
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.65, `rgba(2,2,4,${strength * 0.4})`);
  gradient.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * Horizontal tape tears.  Slices of the source are re-drawn offset, which is
 * the honest way to fake a tracking error without a shader.
 */
export function tapeTear(ctx, source, width, height, options = {}) {
  const count = options.count ?? 0;
  if (count <= 0) return;
  const random = mulberry32(Math.floor(options.seed ?? 0));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  for (let slice = 0; slice < count; slice += 1) {
    const y = random() * height;
    const sliceHeight = Math.max(2, random() * height * (options.thickness ?? 0.045));
    const shift = (random() - 0.5) * width * (options.amount ?? 0.06);
    ctx.globalAlpha = 0.55 + random() * 0.45;
    ctx.drawImage(source, 0, y, width, sliceHeight, shift, y, width, sliceHeight);
    if (random() > 0.72) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = random() > 0.5 ? "rgba(225,72,88,0.5)" : "rgba(165,255,157,0.4)";
      ctx.fillRect(shift, y, width, 1);
    }
  }
  ctx.restore();
}

/**
 * Codec breakdown: displaced macroblocks, quantization collapse and dropped
 * blocks.  Tape tearing is analogue and slides whole scanlines; this is the
 * digital failure — the picture survives in square lumps that no longer agree
 * with each other about what frame they belong to.
 *
 * `source` must be a snapshot of the destination taken this frame.
 */
export function blockGlitch(ctx, source, width, height, options = {}) {
  const strength = clamp(options.strength ?? 0, 0, 1);
  if (strength <= 0 || !source) return;
  const unit = Math.max(8, options.size ?? 28);
  const count = Math.round((options.count ?? 22) * strength);
  if (count <= 0) return;
  const random = mulberry32(Math.floor(options.seed ?? 0) + 977);
  const slide = (options.slide ?? 0.09) * width * strength;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.imageSmoothingEnabled = false;

  for (let block = 0; block < count; block += 1) {
    const bw = unit * (1 + Math.floor(random() * 4));
    const bh = unit * (1 + Math.floor(random() * 2));
    const sx = Math.floor(random() * Math.max(1, width - bw) / unit) * unit;
    const sy = Math.floor(random() * Math.max(1, height - bh) / unit) * unit;
    const roll = random();

    if (roll < 0.18) {
      // Lost block: the decoder had nothing to draw here.
      ctx.globalAlpha = 0.5 + random() * 0.4;
      ctx.fillStyle = random() > 0.5 ? "rgba(9,8,12,1)" : "rgba(28,10,26,1)";
      ctx.fillRect(sx, sy, bw, bh);
      continue;
    }

    if (roll < 0.46) {
      // Quantization collapse: down to a handful of samples and back up with
      // smoothing off, which is what a starved bitrate actually looks like.
      const qw = Math.max(1, Math.floor(bw / (4 + random() * 8)));
      const qh = Math.max(1, Math.floor(bh / (4 + random() * 8)));
      ctx.globalAlpha = 1;
      ctx.drawImage(source, sx, sy, bw, bh, sx, sy, qw, qh);
      ctx.drawImage(ctx.canvas, sx, sy, qw, qh, sx, sy, bw, bh);
      continue;
    }

    // Motion-vector error: the block is copied from the wrong place.
    const dx = sx + Math.round((random() - 0.5) * slide / unit) * unit;
    const dy = sy + Math.round((random() - 0.5) * 3) * unit;
    ctx.globalAlpha = 0.7 + random() * 0.3;
    ctx.drawImage(source, sx, sy, bw, bh, dx, dy, bw, bh);
  }

  ctx.restore();
}

/**
 * Cheap CRT bulge.  The source is recomposited as horizontal bands, each
 * scaled by its distance from the tube centre.
 */
export function curveWarp(ctx, source, width, height, options = {}) {
  const amount = options.amount ?? 0.018;
  const bands = Math.max(6, Math.round(options.bands ?? 28));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "copy";
  const bandHeight = height / bands;
  for (let band = 0; band < bands; band += 1) {
    const sourceY = band * bandHeight;
    const centred = (band + 0.5) / bands * 2 - 1;
    const bulge = 1 + amount * (1 - centred * centred);
    const drawWidth = width * bulge;
    const drawHeight = bandHeight * bulge + 1;
    ctx.drawImage(
      source,
      0, sourceY, width, bandHeight,
      (width - drawWidth) * 0.5, sourceY - (drawHeight - bandHeight) * 0.5, drawWidth, drawHeight,
    );
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/** Fills the frame, optionally as a translucent trail wash. */
export function fadeTo(ctx, width, height, color, alpha = 1) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = typeof color === "function" ? color(alpha) : color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** A stroke with a phosphor halo baked in via shadowBlur. */
export function glowStroke(ctx, path, options = {}) {
  const color = options.color ?? palette.wire(0.8);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = options.width ?? 1.2;
  ctx.lineCap = options.cap ?? "round";
  ctx.lineJoin = options.join ?? "round";
  if (options.glow) {
    ctx.shadowBlur = options.glow;
    ctx.shadowColor = options.glowColor ?? color;
  }
  if (typeof path === "function") { ctx.beginPath(); path(ctx); } else ctx.beginPath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Bootleg stamp lettering: the same word printed several times with tiny
 * offsets so the edges bruise like a photocopy of a photocopy.
 */
export function stampText(ctx, text, x, y, options = {}) {
  const size = options.size ?? 24;
  const font = options.font ?? FONTS.stamp;
  const ink = options.ink ?? palette.bone;
  const seed = options.seed ?? text.length;
  const random = mulberry32(Math.floor(seed * 97 + 13));
  ctx.save();
  ctx.font = `${options.weight ?? 400} ${size}px ${font}`;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = options.baseline ?? "alphabetic";
  ctx.translate(x, y);
  if (options.rotate) ctx.rotate(options.rotate);
  if (options.letterSpacing !== undefined && "letterSpacing" in ctx) ctx.letterSpacing = `${options.letterSpacing}em`;
  const passes = options.passes ?? 3;
  for (let pass = passes - 1; pass >= 0; pass -= 1) {
    const spread = (options.spread ?? 1.6) * (pass / Math.max(1, passes - 1));
    const jx = (random() - 0.5) * spread * 2;
    const jy = (random() - 0.5) * spread * 2;
    ctx.globalAlpha = (options.alpha ?? 1) * (pass === 0 ? 1 : 0.24);
    ctx.fillStyle = pass === 0 ? (typeof ink === "function" ? ink(1) : ink) : (options.bruise ?? palette.blood(0.5));
    ctx.fillText(text, jx, jy);
  }
  if (options.strike) {
    const metrics = ctx.measureText(text);
    ctx.globalAlpha = options.alpha ?? 1;
    ctx.fillStyle = typeof ink === "function" ? ink(0.7) : ink;
    ctx.fillRect(0, -size * 0.32, metrics.width, Math.max(1, size * 0.06));
  }
  ctx.restore();
}

/** Terminal-style machine text.  Small, tight, unglamorous. */
export function machineText(ctx, text, x, y, options = {}) {
  const size = options.size ?? 12;
  ctx.save();
  ctx.font = `${size}px ${options.font ?? FONTS.mono}`;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = options.baseline ?? "alphabetic";
  if (options.letterSpacing !== undefined && "letterSpacing" in ctx) ctx.letterSpacing = `${options.letterSpacing}em`;
  if (options.shadow !== false) {
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillText(text, x + 1, y + 1);
  }
  ctx.fillStyle = options.color ?? palette.wire(0.72);
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Surveillance corner brackets, the Lain landmark frame. */
export function reticle(ctx, x, y, size, options = {}) {
  const arm = size * (options.arm ?? 0.28);
  ctx.save();
  ctx.strokeStyle = options.color ?? palette.wire(0.5);
  ctx.lineWidth = options.width ?? 1;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = x + sx * size * 0.5;
    const cy = y + sy * size * 0.5;
    ctx.moveTo(cx - sx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy - sy * arm);
  }
  ctx.stroke();
  if (options.crosshair) {
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(x - arm * 0.4, y); ctx.lineTo(x + arm * 0.4, y);
    ctx.moveTo(x, y - arm * 0.4); ctx.lineTo(x, y + arm * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------------

export function rotate3D(x, y, z, pitch, yaw, roll) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const py = y * cp - z * sp;
  const pz = y * sp + z * cp;
  const yx = x * cy + pz * sy;
  const yz = -x * sy + pz * cy;
  return { x: yx * cr - py * sr, y: yx * sr + py * cr, z: yz };
}

/**
 * Perspective projection.  Returns null behind the near plane or when the
 * result would land absurdly far off canvas, which keeps every scene's line
 * loops free of `Infinity` artefacts.
 */
export function project3D(point, width, height, focal, camera = { x: 0, y: 0, z: 0 }) {
  const depth = point.z - (camera.z ?? 0);
  if (depth < 0.14) return null;
  const scale = focal / depth;
  const x = width * 0.5 + (point.x - (camera.x ?? 0)) * scale;
  const y = height * 0.5 + (point.y - (camera.y ?? 0)) * scale;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > width * 6 || Math.abs(y) > height * 6) return null;
  return { x, y, depth, scale };
}

/** Depth cue used across the 3D scenes so fog reads consistently. */
export const depthFade = (depth, near = 0.6, far = 7) => clamp(1 - (depth - near) / (far - near));

// ---------------------------------------------------------------------------
// Feedback / frame warping
// ---------------------------------------------------------------------------

/**
 * A frame-to-frame feedback buffer with decay and warping.
 *
 * This is the architecture the WMP-era visualizers were built on: keep the
 * previous frame, redraw it slightly zoomed/rotated/rippled, darken it, then
 * paint the new geometry on top.  Motion accumulates into tunnels, plasma and
 * smoke trails that no amount of per-frame drawing can imitate, and the whole
 * thing costs one composite instead of thousands of particles.
 *
 * ```js
 * this.feedback.warp(frame, { zoom: 1.014, rot: 0.003, decay: 0.94 });
 * // ...draw this frame's geometry on top...
 * this.feedback.store(frame);
 * ```
 */
export class FeedbackWarp {
  constructor(options = {}) {
    this.layer = new Layer({ scale: options.scale ?? 1, alpha: false });
    this.primed = false;
  }

  /**
   * Paints the decayed, warped previous frame into the destination context.
   * When nothing has been stored yet it lays down `background` instead.
   *
   * @param {{ctx: CanvasRenderingContext2D, width: number, height: number}} frame
   * @param {{
   *   zoom?: number, rot?: number, dx?: number, dy?: number,
   *   sx?: number, sy?: number, cx?: number, cy?: number,
   *   decay?: number, warp?: number, warpScale?: number, warpPhase?: number,
   *   grid?: number, background?: string|Function,
   *   echo?: {zoom: number, alpha: number, orient?: number},
   * }} [options]
   */
  warp(frame, options = {}) {
    const { ctx, width, height } = frame;
    const background = options.background ?? palette.void;
    if (!this.layer.ctx || !this.primed) {
      fadeTo(ctx, width, height, background, 1);
      return;
    }
    const zoom = options.zoom ?? 1.01;
    const rot = options.rot ?? 0;
    const sx = (options.sx ?? 1) * zoom;
    const sy = (options.sy ?? 1) * zoom;
    const cx = (options.cx ?? 0.5) * width;
    const cy = (options.cy ?? 0.5) * height;
    const dx = (options.dx ?? 0) * width;
    const dy = (options.dy ?? 0) * height;
    const decay = clamp(options.decay ?? 0.94, 0, 1);
    const source = this.layer.canvas;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "copy";
    ctx.imageSmoothingQuality = "high";

    const warpAmount = options.warp ?? 0;
    if (warpAmount > 0) {
      // Mesh warp: the frame is resampled as a coarse grid whose cells are
      // displaced by the noise field.  Overlapping the source cells by a pixel
      // keeps the seams from showing as a lattice.
      fadeTo(ctx, width, height, background, 1);
      ctx.globalCompositeOperation = "source-over";
      const grid = Math.max(4, Math.round(options.grid ?? 14));
      const rows = Math.max(3, Math.round(grid * height / Math.max(1, width)));
      const cellW = width / grid;
      const cellH = height / rows;
      const scale = options.warpScale ?? 2.2;
      const phase = options.warpPhase ?? 0;
      for (let column = 0; column < grid; column += 1) {
        for (let row = 0; row < rows; row += 1) {
          const u = (column + 0.5) / grid;
          const v = (row + 0.5) / rows;
          const angle = flowAngle(u * scale + phase, v * scale - phase * 0.6, 1) ;
          const push = warpAmount * Math.min(cellW, cellH);
          const ox = Math.cos(angle) * push;
          const oy = Math.sin(angle) * push;
          // Source rect, expanded by the zoom/stretch around the centre.
          const dxCell = cx + ((column * cellW) - cx) / sx - dx;
          const dyCell = cy + ((row * cellH) - cy) / sy - dy;
          ctx.drawImage(
            source,
            clamp(dxCell, -cellW, width) * (this.layer.width / width),
            clamp(dyCell, -cellH, height) * (this.layer.height / height),
            (cellW / sx) * (this.layer.width / width) + 1,
            (cellH / sy) * (this.layer.height / height) + 1,
            column * cellW + ox, row * cellH + oy, cellW + 1, cellH + 1,
          );
        }
      }
    } else {
      ctx.translate(cx + dx, cy + dy);
      if (rot) ctx.rotate(rot);
      ctx.scale(sx, sy);
      ctx.translate(-cx, -cy);
      ctx.drawImage(source, 0, 0, width, height);
    }
    ctx.restore();

    // Uniform grey multiply is an exact `out *= decay`, which keeps additive
    // scenes from blowing out to white after a few hundred frames.
    if (decay < 1) {
      const level = Math.round(decay * 255);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgb(${level},${level},${level})`;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    if (options.echo && options.echo.alpha > 0) {
      const { zoom: echoZoom = 1.4, alpha = 0.3, orient = 0 } = options.echo;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha;
      ctx.translate(width * 0.5, height * 0.5);
      ctx.scale(echoZoom * (orient & 1 ? -1 : 1), echoZoom * (orient & 2 ? -1 : 1));
      ctx.drawImage(source, -width * 0.5, -height * 0.5, width, height);
      ctx.restore();
    }
  }

  /** Captures the finished frame so the next tick can warp it. */
  store(frame) {
    const { ctx, width, height } = frame;
    if (!this.layer.ctx) return;
    this.layer.match(width, height);
    this.layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.layer.ctx.globalAlpha = 1;
    this.layer.ctx.globalCompositeOperation = "copy";
    this.layer.ctx.drawImage(ctx.canvas, 0, 0, this.layer.width, this.layer.height);
    this.primed = true;
  }

  release() {
    this.layer.release();
    this.primed = false;
  }
}

/**
 * Nonlinear tone shaping, in the spirit of the classic darken / brighten /
 * invert composite toggles.
 *
 * `darken` squares the frame (crushes mids, deepens blacks) and `brighten` is
 * its screen counterpart; both need `copy` to be a snapshot of the destination
 * taken this frame — pass a Layer canvas you have already stored. `invert`
 * needs no copy.  Solarize is deliberately absent: it cannot be expressed
 * exactly with the available composite operations, and the near-misses all
 * collapse to black.
 *
 * @param {"darken"|"brighten"|"invert"} mode
 */
export function tone(ctx, copy, mode, amount = 1) {
  if (amount <= 0) return;
  if (mode !== "invert" && !copy) return;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = clamp(amount);
  if (mode === "invert") {
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.globalCompositeOperation = mode === "brighten" ? "screen" : "multiply";
    ctx.drawImage(copy, 0, 0, width, height);
  }
  ctx.restore();
}

/** Radial centre darkening — stops feedback tunnels saturating in the middle. */
export function darkenCenter(ctx, width, height, amount = 0.3) {
  if (amount <= 0) return;
  const gradient = ctx.createRadialGradient(
    width * 0.5, height * 0.5, 0,
    width * 0.5, height * 0.5, Math.min(width, height) * 0.5,
  );
  gradient.addColorStop(0, `rgba(0,0,0,${amount})`);
  gradient.addColorStop(0.7, `rgba(0,0,0,${amount * 0.25})`);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Signal analysis helpers for scenes
// ---------------------------------------------------------------------------

/** Mean of a byte array slice, normalized to 0..1. */
export function average(values, start = 0, end = values.length) {
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += values[index] || 0;
  return sum / Math.max(1, end - start) / 255;
}

/** RMS of a byte array slice, normalized to 0..1. */
export function power(values, start = 0, end = values.length) {
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    const value = (values[index] || 0) / 255;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}

/**
 * Mel-scale mapping.  Linear FFT bins put nearly everything musical in the
 * first eighth of the array, so scenes that lay out one element per bin end up
 * with a dead right-hand side.  `melPosition(t)` converts an even 0..1 layout
 * position into the 0..1 spectrum position a listener would call "evenly
 * spaced", using the standard mel curve.
 */
export function melPosition(t, nyquist = 24000) {
  const maxMel = 2595 * Math.log10(1 + nyquist / 700);
  const mel = clamp(t) * maxMel;
  const hz = 700 * (Math.pow(10, mel / 2595) - 1);
  return clamp(hz / nyquist);
}

/** Samples a byte array at a normalized 0..1 position with interpolation. */
export function sampleBand(values, position) {
  const max = values.length - 1;
  if (max < 1) return 0;
  const scaled = clamp(position) * max;
  const index = Math.floor(scaled);
  const next = Math.min(max, index + 1);
  return lerp(values[index] / 255, values[next] / 255, scaled - index);
}

export default {
  TAU, clamp, lerp, wrap01, smoothstep, approach, mulberry32,
  noise2D, fbm, flowAngle, palette, FONTS, serialString, hexString,
  createSurface, Layer, Bloom, RgbSplit, Grain, Dither,
  scanlines, rollingBar, vignette, tapeTear, curveWarp, blockGlitch,
  FeedbackWarp, tone, darkenCenter,
  fadeTo, glowStroke, stampText, machineText, reticle,
  rotate3D, project3D, depthFade, average, power, sampleBand, melPosition,
};
