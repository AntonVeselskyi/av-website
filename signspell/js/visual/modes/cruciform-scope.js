/**
 * cruciform // scope — an oscilloscope built on a cross.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

export default class CruciformScopeScene {
  static id = "cruciform-scope";
  static label = "cruciform // scope";
  static post = { grain: 0.08, scanlines: 0.16, vignette: 0.52 };

  constructor(kit) {
    this.kit = kit;
  }

  render(frame) {
    const { ctx, width, height, audio, spectrum, waveform, kit, palette } = frame;
    const energy = audio.energy;
    kit.fadeTo(ctx, width, height, palette.void, 1);

    const span = Math.min(width, height) * (0.32 + energy * 0.15);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = palette.violet(0.3 + energy * 0.45);
    ctx.lineWidth = Math.max(1, width * 0.003);
    ctx.beginPath();
    ctx.moveTo(-span, 0); ctx.lineTo(span, 0);
    ctx.moveTo(0, -span * 1.2); ctx.lineTo(0, span * 1.2);
    ctx.stroke();

    ctx.strokeStyle = palette.wire(0.34 + energy * 0.5);
    ctx.lineWidth = Math.max(1, width * 0.0015);
    ctx.beginPath();
    for (let index = 0; index < waveform.length; index += 1) {
      const x = ((index / (waveform.length - 1)) - 0.5) * span * 2.2;
      const y = ((waveform[index] - 128) / 128) * span * 0.52;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.rotate(frame.reducedMotion ? 0 : frame.time * 0.13);
    for (let arm = 0; arm < 4; arm += 1) {
      ctx.rotate(Math.PI / 2);
      ctx.strokeStyle = palette.blood(0.08 + kit.average(spectrum, arm * 8, arm * 8 + 8) * 0.38);
      ctx.beginPath();
      ctx.arc(0, 0, span * (0.3 + arm * 0.17), -0.7, 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }
}
