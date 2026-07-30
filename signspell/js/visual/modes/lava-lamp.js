/**
 * lava // lamp — retro-anime lava lamp.
 *
 * The blobs are metaballs, merged the cheap way: soft radial fields are
 * accumulated additively into an offscreen layer, then that whole layer is
 * composited back through a `blur() contrast()` filter in a single draw call.
 * Because the filter runs over the summed field rather than per blob, nearby
 * blobs fuse into one hard-edged body — the gooey silhouette a lava lamp needs,
 * without a per-pixel scalar field.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

const BLOB_COUNT = 14;

export default class LavaLampScene {
  static id = "lava-lamp";
  static label = "lava // lamp";
  static post = { grain: 0.09, scanlines: 0.17, vignette: 0.55, curve: 0.016 };

  constructor(kit) {
    this.kit = kit;
    this.field = new kit.Layer({ scale: 0.5 });
    const random = kit.mulberry32(0x1a7a);
    this.blobs = Array.from({ length: BLOB_COUNT }, (_, index) => ({
      x: random(),
      y: random(),
      radius: 0.05 + random() * 0.09,
      rise: 0.012 + random() * 0.03,
      sway: 0.3 + random() * 1.6,
      phase: random() * Math.PI * 2,
      band: index / BLOB_COUNT,
    }));
  }

  render(frame) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const reduced = frame.reducedMotion;
    kit.fadeTo(ctx, width, height, palette.void, 1);

    // Warm glass column behind the blobs.
    const glass = ctx.createLinearGradient(0, height, 0, 0);
    glass.addColorStop(0, `rgba(60, 16, 40, ${0.3 + audio.bass * 0.3})`);
    glass.addColorStop(0.55, "rgba(24, 10, 30, 0.22)");
    glass.addColorStop(1, "rgba(8, 7, 9, 0)");
    ctx.fillStyle = glass;
    ctx.fillRect(width * 0.24, 0, width * 0.52, height);

    if (!this.field.ctx) return;
    this.field.match(width, height);
    const target = this.field.ctx;
    const scaleX = this.field.width;
    const scaleY = this.field.height;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, scaleX, scaleY);
    target.globalCompositeOperation = "lighter";

    for (const blob of this.blobs) {
      if (!reduced) {
        blob.y -= blob.rise * frame.dt * (0.6 + audio.bassAtt * 0.7);
        if (blob.y < -0.2) blob.y = 1.2;
        blob.phase += frame.dt * blob.sway * 0.4;
      }
      const wobble = Math.sin(blob.phase) * 0.08 + kit.fbm(blob.x * 3, blob.y * 3 + frame.time * 0.1, 3) * 0.06 - 0.03;
      const energy = frame.band(blob.band);
      const radius = blob.radius * (0.8 + energy * 0.7 + audio.midAtt * 0.18) * Math.min(scaleX, scaleY);
      const cx = (0.5 + (blob.x - 0.5) * 0.52 + wobble) * scaleX;
      const cy = blob.y * scaleY;
      const gradient = target.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
      gradient.addColorStop(0.6, "rgba(200, 200, 200, 0.4)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      target.fillStyle = gradient;
      target.beginPath();
      target.arc(cx, cy, radius, 0, Math.PI * 2);
      target.fill();
    }

    // One filtered composite of the summed field hardens the silhouette.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.filter = `blur(${(3 * frame.ratio).toFixed(1)}px) contrast(${(9 + audio.trebAtt * 4).toFixed(1)})`;
    ctx.drawImage(this.field.canvas, 0, 0, width, height);
    ctx.filter = "none";
    ctx.restore();

    // Lamp furniture: base, cap and a contour highlight down the glass.
    ctx.strokeStyle = palette.amber(0.28 + audio.energy * 0.3);
    ctx.lineWidth = Math.max(1, frame.ratio);
    ctx.beginPath();
    ctx.moveTo(width * 0.24, 0);
    ctx.lineTo(width * 0.24, height);
    ctx.moveTo(width * 0.76, 0);
    ctx.lineTo(width * 0.76, height);
    ctx.stroke();

    kit.machineText(ctx, `LAVA // ${kit.serialString(frame.time * 2, 4)}`, width * 0.04, height * 0.95, {
      size: Math.max(9, 12 * frame.ratio), color: palette.amber(0.4),
    });
  }

  suspend() { this.field.release(); }
}
