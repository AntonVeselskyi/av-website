/**
 * lava // lamp — cel-shaded metaballs adrift in the void.
 *
 * No vessel, no base, no glass. The lamp furniture made it a picture of an
 * object; without it the blobs are the whole subject and can use the entire
 * frame, which is what the thing was for.
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
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

const BLOB_COUNT = 20;
const TONE_TILE = 8;

// Cel bands: [brightness applied before the threshold, additive increment].
// Larger brightness cuts a larger silhouette, so these run outermost-first and
// each inner band stacks onto the ones outside it — the core ends up hot amber.
const BANDS = [
  [1.5, "rgb(52, 7, 20)"],
  [1.05, "rgb(58, 20, 14)"],
  [0.76, "rgb(52, 43, 13)"],
  [0.55, "rgb(28, 52, 38)"],
];

function hash01(n) {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

export function lavaInternalLightCount(detail = 1, blobCount = BLOB_COUNT) {
  const requested = Math.max(6, Math.round(12 * Math.max(0, Number(detail) || 0)));
  return Math.min(Math.max(0, Math.floor(blobCount)), 12, requested);
}

export function lavaInternalLightPose(blob, time = 0, energy = 0) {
  const phase = Number(time) * (0.34 + (Number(blob?.mass) || 1) * 0.09) + (Number(blob?.wobble) || 0);
  const orbit = 0.12 + (0.5 + 0.5 * Math.sin(phase * 0.73)) * 0.16;
  return {
    dx: Math.cos(phase) * orbit,
    dy: Math.sin(phase * 1.17) * orbit * 0.72,
    radius: 0.2 + Math.min(1, Math.max(0, Number(energy) || 0)) * 0.12,
    alpha: 0.1 + Math.min(2, Math.max(0, Number(energy) || 0)) * 0.07,
  };
}

export default class LavaLampScene {
  static id = "lava-lamp";
  static label = "lava // lamp";
  // Flat cel areas show ordered dither badly, so it is dialled back and the
  // print grain carries the texture instead.
  static post = { grain: 0.1, scanlines: 0.13, dither: 0.03, vignette: 0.58, bar: 0.03, curve: 0.017 };

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
        x: hash01(i * 9 + 1),
        y: hash01(i * 9 + 2),
        vx: (hash01(i * 9 + 6) - 0.5) * 0.05,
        vy: (hash01(i * 9 + 7) - 0.5) * 0.05,
        r: 0.05 + hash01(i * 9 + 3) * 0.085,
        mass: 0.5 + hash01(i * 9 + 8) * 0.9,
        wobble: hash01(i * 9 + 5) * 6.28,
        band: i / BLOB_COUNT,
      };
    }

    this.pinch = 0;
    this.lastBeat = -1;
    this.t = 0;
  }

  /** The cached pattern belongs to a context that resizing throws away. */
  resize() { this.tonePattern = null; }

  /** Halftone tile, built once and used as a repeating pattern. */
  buildTone() {
    const surface = this.kit.createSurface(TONE_TILE, TONE_TILE);
    const ctx = surface?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, TONE_TILE, TONE_TILE);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.arc(TONE_TILE * 0.25, TONE_TILE * 0.25, 1.25, 0, Math.PI * 2);
    ctx.arc(TONE_TILE * 0.75, TONE_TILE * 0.75, 1.25, 0, Math.PI * 2);
    ctx.fill();
    this.tone = surface;
  }

  // ---------------------------------------------------------------------------
  // Drift
  // ---------------------------------------------------------------------------

  /**
   * Free drift on a slow flow field, with a weak mutual attraction so the
   * blobs keep finding each other, fusing and tearing apart again. Without the
   * attraction they spread evenly and stop making shapes.
   */
  stepBlobs(frame, dt) {
    const { audio, kit } = frame;
    const blobs = this.blobs;
    const drive = 0.4 + audio.bassAtt * 0.5 + this.pinch * 0.9;

    for (let i = 0; i < blobs.length; i += 1) {
      const b = blobs[i];
      // Flow field: the whole population shares one current, so the motion
      // reads as a fluid rather than as independent particles.
      const angle = kit.flowAngle(b.x * 1.6 + this.t * 0.03, b.y * 1.6 - this.t * 0.04, 1);
      b.vx += Math.cos(angle) * 0.055 * drive * dt;
      b.vy += Math.sin(angle) * 0.055 * drive * dt;

      // Attractive at range, repulsive on contact — a soft core.
      //
      // These three numbers were tuned against a headless run of this very
      // function that counts overlapping clusters over four simulated minutes.
      // At the old values it was one cluster from five seconds in and never
      // recovered; at much stronger repulsion the population spreads evenly and
      // stops making shapes. Here it cycles between about four and eleven
      // groups indefinitely, which is a lamp.
      //
      // The attraction alone is what made the lamp collapse: nothing opposed it
      // at short range, so every blob converged and the population welded into
      // one mass that never came apart again.  Below the contact distance the
      // sign flips, so blobs still find each other and fuse, and still tear
      // apart afterwards, but can never all end up in the same place.
      //
      // Every blob is now sampled rather than every fourth: a stride of 4 over
      // 20 blobs meant a pair could sit inside each other and simply never test
      // against one another.
      let ax = 0;
      let ay = 0;
      for (let j = 1; j < blobs.length; j += 1) {
        const o = blobs[(i + j) % blobs.length];
        const dx = o.x - b.x;
        const dy = o.y - b.y;
        const d2 = dx * dx + dy * dy + 0.02;
        const dist = Math.sqrt(d2);
        const touch = (b.r + o.r) * 1.45;
        const pull = dist < touch
          ? -0.045 * ((touch - dist) / touch) / d2
          : 0.0001 / d2;
        ax += dx * pull;
        ay += dy * pull;
      }
      b.vx += ax * dt / b.mass;
      b.vy += ay * dt / b.mass;

      b.wobble += dt * (0.4 + b.mass * 0.3);
      b.vx *= 0.985;
      b.vy *= 0.985;
      const speed = Math.hypot(b.vx, b.vy);
      const limit = 0.19;
      if (speed > limit) { b.vx = b.vx / speed * limit; b.vy = b.vy / speed * limit; }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Held on stage. A soft spring at the edges turns a blob back before it
      // leaves, and a very weak pull toward the middle stops the whole
      // population drifting off together and emptying the frame.
      const edge = 0.12;
      if (b.x < edge) b.vx += (edge - b.x) * 2.2 * dt;
      else if (b.x > 1 - edge) b.vx -= (b.x - (1 - edge)) * 2.2 * dt;
      if (b.y < edge) b.vy += (edge - b.y) * 2.2 * dt;
      else if (b.y > 1 - edge) b.vy -= (b.y - (1 - edge)) * 2.2 * dt;
      // Containment, not a constant attractor.  Applied every frame regardless
      // of position, this was a steady inward drift with nothing opposing it —
      // on its own enough to guarantee the population ended up in a pile at the
      // centre.  It now only acts on blobs that have wandered outside the
      // middle third.
      const offX = b.x - 0.5;
      const offY = b.y - 0.5;
      if (Math.hypot(offX, offY) > 0.42) {
        b.vx -= offX * 0.1 * dt;
        b.vy -= offY * 0.1 * dt;
      }
      b.x = Math.min(1.06, Math.max(-0.06, b.x));
      b.y = Math.min(1.06, Math.max(-0.06, b.y));
    }
  }

  // ---------------------------------------------------------------------------
  // Wax
  // ---------------------------------------------------------------------------

  /**
   * The light the wax throws into the room. Drawn under the silhouette and
   * deliberately much wider than it, so the blobs read as lit from within
   * rather than as flat shapes on a dark ground.
   */
  paintHalo(frame) {
    const { ctx, width, height, audio } = frame;
    const short = Math.min(width, height);
    const count = Math.max(8, Math.round(this.blobs.length * frame.detail));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
      const b = this.blobs[i];
      const energy = frame.band(b.band);
      const radius = b.r * (0.8 + energy * 0.38 + this.pinch * 0.14) * short * 1.2;
      const reach = radius * (2.1 + energy * 1.1 + this.pinch * 0.5);
      if (reach < 2) continue;
      const x = b.x * width;
      const y = b.y * height;
      // Cull haloes whose blob is well outside the frame.
      if (x < -reach || x > width + reach || y < -reach || y > height + reach) continue;
      const heat = 0.05 + energy * 0.09 + audio.sustain * 0.05 + this.pinch * 0.03;
      const halo = ctx.createRadialGradient(x, y, radius * 0.35, x, y, reach);
      halo.addColorStop(0, `rgba(255, 156, 74, ${heat.toFixed(3)})`);
      halo.addColorStop(0.34, `rgba(214, 66, 74, ${(heat * 0.5).toFixed(3)})`);
      halo.addColorStop(0.7, `rgba(126, 40, 96, ${(heat * 0.2).toFixed(3)})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
    }
    ctx.restore();
  }

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
    const count = Math.max(10, Math.round(BLOB_COUNT * frame.detail));
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
      const b = this.blobs[i];
      // Stretch along the direction of travel — the read on surface tension a
      // plain circle never gives you.
      const speed = Math.hypot(b.vx, b.vy);
      const stretch = 1 + Math.min(1.1, speed * 5.5);
      const heading = Math.atan2(b.vy, b.vx);
      const energy = frame.band(b.band);
      const radius = b.r * (0.8 + energy * 0.38 + this.pinch * 0.14) * Math.min(w, h) * 1.2;
      const x = b.x * w;
      const y = b.y * h;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.45, "rgba(255,255,255,0.52)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(heading);
      ctx.scale(stretch, 1 / Math.sqrt(stretch));
      ctx.rotate(-heading);
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

  /** Builds the full cel stack plus the rim light. */
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

    // Rim: the outermost silhouette minus a marginally tighter one.
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
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgb(120, 96, 74)";
    ctx.fillRect(0, 0, scratch.width, scratch.height);
    shade.ctx.globalCompositeOperation = "lighter";
    shade.ctx.drawImage(scratch.canvas, 0, 0);

    // Screentone, the way cheap cel work filled its shadows.
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

    this.paintInternalLights(frame);
  }

  /** Warm motes remain geometrically clipped inside their parent wax cells. */
  paintInternalLights(frame) {
    const ctx = this.shade.ctx;
    if (!ctx) return;
    const width = this.shade.width;
    const height = this.shade.height;
    const count = lavaInternalLightCount(frame.detail, this.blobs.length);
    const short = Math.min(width, height);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
      const b = this.blobs[i];
      const speed = Math.hypot(b.vx, b.vy);
      const stretch = 1 + Math.min(1.1, speed * 5.5);
      const heading = Math.atan2(b.vy, b.vx);
      const energy = frame.band(b.band);
      const radius = b.r * (0.8 + energy * 0.38 + this.pinch * 0.14) * short * 1.2;
      const pose = lavaInternalLightPose(b, this.t, energy + frame.audio.sustain * 0.45);
      const x = b.x * width;
      const y = b.y * height;
      const lightX = pose.dx * radius;
      const lightY = pose.dy * radius;
      const lightR = Math.max(2, pose.radius * radius);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(heading);
      ctx.scale(stretch, 1 / Math.sqrt(stretch));
      ctx.beginPath();
      // The cel threshold ends well inside the radial field's mathematical
      // edge; this conservative mask keeps additive light inside visible wax.
      ctx.arc(0, 0, radius * 0.62, 0, Math.PI * 2);
      ctx.clip();

      const glow = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, lightR);
      glow.addColorStop(0, `rgba(255,239,174,${Math.min(0.46, pose.alpha * 2).toFixed(3)})`);
      glow.addColorStop(0.28, `rgba(233,168,91,${Math.min(0.34, pose.alpha * 1.3).toFixed(3)})`);
      glow.addColorStop(0.68, `rgba(177,140,255,${Math.min(0.12, pose.alpha * 0.52).toFixed(3)})`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(lightX - lightR, lightY - lightR, lightR * 2, lightR * 2);

      // Three tiny dispersing cells orbit the main light and dissolve before
      // reaching the wax edge; deterministic phase keeps the cel stable.
      for (let mote = 0; mote < 3; mote += 1) {
        const seed = hash01(i * 19 + mote * 7 + 3);
        const phase = ((this.t * (0.11 + seed * 0.09) + seed + mote / 3) % 1 + 1) % 1;
        const angle = b.wobble + mote * 2.094 + this.t * (0.28 + seed * 0.2);
        const distance = radius * (0.08 + phase * 0.48);
        const alpha = Math.sin(Math.PI * phase) ** 2 * pose.alpha * 0.75;
        const moteR = Math.max(0.8, radius * (0.018 + (1 - phase) * 0.026));
        ctx.fillStyle = `rgba(255,226,150,${Math.min(0.3, alpha * 1.5).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, moteR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
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
      this.pinch = Math.max(0, this.pinch - dt * 1.7);
      if (audio.beat > 0.68 && audio.beatCount !== this.lastBeat) {
        this.lastBeat = audio.beatCount;
        this.pinch = Math.min(1, this.pinch + 0.45);
      }
      this.stepBlobs(frame, dt);
    }

    kit.fadeTo(ctx, width, height, palette.void, 1);

    // A dull thermal wash behind the wax so it is not floating on flat black.
    const wash = ctx.createRadialGradient(
      width * 0.5, height * 0.5, 0,
      width * 0.5, height * 0.5, Math.max(width, height) * 0.62,
    );
    wash.addColorStop(0, `rgba(72, 18, 42, ${(0.16 + audio.sustain * 0.28).toFixed(3)})`);
    wash.addColorStop(0.55, "rgba(32, 12, 34, 0.08)");
    wash.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);

    this.paintHalo(frame);

    if (this.paintField(frame)) {
      this.paintWax(frame);
      if (this.shade.canvas) {
        ctx.save();
        // The wax layer is opaque black outside the blobs, so it is added.
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(this.shade.canvas, 0, 0, width, height);
        ctx.restore();
        this.bloom.apply(ctx, this.shade.canvas, {
          strength: 0.2 + audio.sustain * 0.16,
          blur: 18 * frame.ratio,
          passes: 2,
        });
      }
    }

    this.drawOverlay(frame);
  }

  /** Cold machine furniture tracking warm shapes it does not understand. */
  drawOverlay(frame) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const small = Math.max(9, 11 * frame.ratio);

    // Track the two largest blobs with surveillance brackets.
    const stage = Math.floor(audio.beatCount / 8);
    for (let i = 0; i < 2; i += 1) {
      const b = this.blobs[(stage + i * 7) % this.blobs.length];
      if (b.x < -0.1 || b.x > 1.1 || b.y < -0.1 || b.y > 1.1) continue;
      const size = b.r * Math.min(width, height) * 2.6;
      kit.reticle(ctx, b.x * width, b.y * height, size, {
        color: palette.wire(0.14 + audio.beat * 0.16),
        width: Math.max(1, frame.ratio),
        crosshair: i === 0,
      });
      kit.machineText(ctx, `M${String(i + 1).padStart(2, "0")} ${kit.serialString(stage * 3 + i, 4)}`,
        b.x * width + size * 0.5 + 6 * frame.ratio, b.y * height - size * 0.5 + small, {
          size: small * 0.85, color: palette.wire(0.3), letterSpacing: 0.06,
        });
    }

    const lines = [
      `MASS ${String(Math.round(audio.midRel * 60 + 40)).padStart(3, "0")}g  VISC 0.${String(Math.round((1 - audio.sustain) * 89)).padStart(2, "0")}`,
      `FLOW ${String(Math.round(audio.bassRel * 40)).padStart(3, "0")}  CYCLE ${kit.serialString(this.t * 0.4, 4)}`,
    ];
    lines.forEach((text, i) => {
      kit.machineText(ctx, text, width * 0.04, height * 0.93 + i * small * 1.2, {
        size: small, color: palette.wire(0.3), letterSpacing: 0.06,
      });
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
