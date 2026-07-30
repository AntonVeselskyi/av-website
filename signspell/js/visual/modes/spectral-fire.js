/**
 * spectral // fire — the spectrum burning upward as a continuous flame body.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

export default class SpectralFireScene {
  static id = "spectral-fire";
  static label = "spectral // fire";
  static post = { grain: 0.09, scanlines: 0.13, vignette: 0.55 };

  constructor(kit) {
    this.kit = kit;
    this.embers = Array.from({ length: 84 }, (_, index) => ({
      x: ((index * 47) % 83) / 83,
      y: ((index * 29) % 89) / 89,
      speed: 0.0018 + (index % 11) * 0.00034,
      size: 0.6 + (index % 5) * 0.42,
      drift: (index % 2 ? 1 : -1) * (0.002 + (index % 7) * 0.0005),
    }));
  }

  render(frame) {
    const { ctx, width, height, audio, spectrum, waveform, kit, palette } = frame;
    const reduced = frame.reducedMotion;
    const energy = audio.energy;
    kit.fadeTo(ctx, width, height, palette.void, 1);

    const columns = Math.max(18, Math.floor(72 * frame.detail));
    const columnWidth = width / columns;
    ctx.save();
    const bloom = ctx.createRadialGradient(width * 0.5, height, 0, width * 0.5, height, height * 0.92);
    bloom.addColorStop(0, `rgba(255, 105, 50, ${0.2 + energy * 0.42})`);
    bloom.addColorStop(0.32, `rgba(225, 72, 88, ${0.11 + energy * 0.2})`);
    bloom.addColorStop(0.72, "rgba(80, 20, 62, 0.06)");
    bloom.addColorStop(1, "rgba(5, 5, 8, 0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    for (let column = 0; column < columns; column += 1) {
      const amplitude = kit.sampleBand(spectrum, column / columns);
      const flicker = reduced ? 0 : (Math.sin(frame.time * 7 + column * 1.9) + 1) * 0.025;
      const flameHeight = (amplitude * 0.78 + energy * 0.18 + flicker) * height;
      const x = column * columnWidth;
      const gradient = ctx.createLinearGradient(x, height, x, height - flameHeight);
      gradient.addColorStop(0, "rgba(225, 72, 88, 0.1)");
      gradient.addColorStop(0.32, "rgba(225, 72, 88, 0.82)");
      gradient.addColorStop(0.7, "rgba(233, 168, 91, 0.76)");
      gradient.addColorStop(1, "rgba(177, 140, 255, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x + 1, height - flameHeight, Math.max(1, columnWidth - 2), flameHeight);
    }

    // Wide translucent tongues make the spectrum feel like a continuous
    // flame body instead of a row of equalizer bars.
    const tongues = Math.max(7, Math.floor(16 * frame.detail));
    for (let tongue = 0; tongue < tongues; tongue += 1) {
      const amplitude = kit.sampleBand(spectrum, (tongue / tongues) * 0.68);
      const center = ((tongue + 0.5) / tongues) * width;
      const sway = reduced ? 0 : Math.sin(frame.time * (2.8 + tongue * 0.07) + tongue * 1.7) * width * 0.018;
      const flameHeight = height * (0.16 + amplitude * 0.72 + energy * 0.16);
      const half = width / tongues * (0.55 + amplitude * 0.45);
      const gradient = ctx.createLinearGradient(center, height, center + sway, height - flameHeight);
      gradient.addColorStop(0, "rgba(255, 58, 36, 0.28)");
      gradient.addColorStop(0.35, "rgba(255, 136, 54, 0.32)");
      gradient.addColorStop(0.72, "rgba(225, 72, 88, 0.2)");
      gradient.addColorStop(1, "rgba(177, 140, 255, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(center - half, height);
      ctx.bezierCurveTo(center - half * 0.55, height - flameHeight * 0.36, center + sway - half * 0.3, height - flameHeight * 0.68, center + sway, height - flameHeight);
      ctx.bezierCurveTo(center + sway + half * 0.45, height - flameHeight * 0.62, center + half * 0.72, height - flameHeight * 0.25, center + half, height);
      ctx.closePath();
      ctx.fill();
    }

    for (const ember of this.embers) {
      if (!reduced) {
        ember.y -= ember.speed * (1.2 + energy * 5.5);
        ember.x += Math.sin(frame.time * 2.2 + ember.y * 17) * ember.drift;
        if (ember.y < -0.04) { ember.y = 1.02; ember.x = (ember.x * 1.71 + 0.37) % 1; }
        if (ember.x < 0) ember.x += 1;
        if (ember.x > 1) ember.x -= 1;
      }
      const bin = kit.sampleBand(spectrum, ember.x);
      ctx.fillStyle = `rgba(255, ${105 + Math.floor(bin * 95)}, ${45 + Math.floor(bin * 70)}, ${0.16 + bin * 0.72})`;
      ctx.beginPath();
      ctx.arc(ember.x * width, ember.y * height, ember.size * (0.7 + bin * 1.5) * frame.ratio, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = palette.bone(0.12 + energy * 0.25);
    ctx.beginPath();
    ctx.moveTo(0, height * 0.75);
    for (let index = 0; index < waveform.length; index += 1) {
      const x = (index / (waveform.length - 1)) * width;
      const y = height * 0.75 + ((waveform[index] - 128) / 128) * height * 0.2;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
