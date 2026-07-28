/**
 * Original canvas visualizers for $IGN⸸$PELL.
 *
 * Pass a Web Audio AnalyserNode (or anything with getByteFrequencyData and
 * getByteTimeDomainData), and the visualizer will only read its live data.
 * No audio samples, external art, or visualizer presets are embedded here.
 */

const MODES = Object.freeze({
  WIRED_TUNNEL: "wired-tunnel",
  SPECTRAL_FIRE: "spectral-fire",
  CRUCIFORM_SCOPE: "cruciform-scope",
  WARPED_SHRINE: "warped-shrine",
});

const MODE_LABELS = Object.freeze({
  [MODES.WIRED_TUNNEL]: "wired // tunnel",
  [MODES.SPECTRAL_FIRE]: "spectral // fire",
  [MODES.CRUCIFORM_SCOPE]: "cruciform // scope",
  [MODES.WARPED_SHRINE]: "warped // shrine",
});

// The compact names are the HTML data-mode values.  Keeping them here makes
// the module pleasant to use without leaking rendering terminology into UI.
const MODE_ALIASES = Object.freeze({
  wired: MODES.WIRED_TUNNEL,
  fire: MODES.SPECTRAL_FIRE,
  cruciform: MODES.CRUCIFORM_SCOPE,
  shrine: MODES.WARPED_SHRINE,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** @param {Uint8Array} values */
function average(values, start = 0, end = values.length) {
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += values[index] || 0;
  return sum / Math.max(1, end - start) / 255;
}

export class SpellVisualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ analyser?: AnalyserNode, mode?: string, reducedMotion?: boolean }} [options]
   */
  constructor(canvas, options = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("SpellVisualizer needs a canvas element.");
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.analyser = null;
    this.frequency = new Uint8Array(128);
    this.waveform = new Uint8Array(128);
    this.mode = MODES.WIRED_TUNNEL;
    this.reducedMotion = options.reducedMotion ?? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.quality = 1;
    this.running = false;
    this.frame = 0;
    this.lastTimestamp = 0;
    this.phase = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.setAnalyser(options.analyser ?? null);
    this.setMode(options.mode ?? MODES.WIRED_TUNNEL);
    this.resize();
  }

  static get modes() { return MODES; }

  setAnalyser(analyser) {
    this.analyser = analyser || null;
    const bins = clamp(this.analyser?.frequencyBinCount || 128, 32, 2048);
    this.frequency = new Uint8Array(bins);
    this.waveform = new Uint8Array(bins);
  }

  setMode(mode) {
    mode = MODE_ALIASES[mode] || mode;
    if (!Object.values(MODES).includes(mode)) throw new RangeError(`Unknown visualizer mode: ${mode}`);
    this.mode = mode;
    const parent = this.canvas.closest(".spell-visualizer, .visualizer-panel");
    if (parent) parent.dataset.modeLabel = MODE_LABELS[mode];
    const label = parent?.querySelector?.("#visualizer-label");
    if (label) label.textContent = MODE_LABELS[mode].toUpperCase();
  }

  setQuality(level = 1) { this.quality = clamp(Number(level) || 1, 0.25, 1); this.resize(); }
  setReducedMotion(enabled) { this.reducedMotion = Boolean(enabled); }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.context?.setTransform(1, 0, 0, 1, 0, 0);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.frame = requestAnimationFrame((timestamp) => this.draw(timestamp));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  destroy() {
    this.stop();
    this.resizeObserver.disconnect();
    this.analyser = null;
  }

  readAudio() {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.frequency);
      this.analyser.getByteTimeDomainData(this.waveform);
    } else {
      this.frequency.fill(0);
      this.waveform.fill(128);
    }
  }

  draw(timestamp) {
    if (!this.running || !this.context) return;
    const delta = Math.min(0.08, (timestamp - this.lastTimestamp || 16.7) / 1000);
    this.lastTimestamp = timestamp;
    if (!this.reducedMotion) this.phase += delta;
    this.readAudio();
    const context = this.context;
    const { width, height } = this.canvas;
    const energy = average(this.frequency);
    context.fillStyle = "#050508";
    context.fillRect(0, 0, width, height);
    if (this.mode === MODES.WIRED_TUNNEL) this.drawWiredTunnel(context, width, height, energy);
    if (this.mode === MODES.SPECTRAL_FIRE) this.drawSpectralFire(context, width, height, energy);
    if (this.mode === MODES.CRUCIFORM_SCOPE) this.drawCruciformScope(context, width, height, energy);
    if (this.mode === MODES.WARPED_SHRINE) this.drawWarpedShrine(context, width, height, energy);
    this.frame = requestAnimationFrame((next) => this.draw(next));
  }

  drawWiredTunnel(context, width, height, energy) {
    const cx = width / 2;
    const cy = height / 2;
    const rings = Math.max(6, Math.floor(16 * this.quality));
    const pulse = this.reducedMotion ? 0 : this.phase * 0.8;
    context.save();
    context.translate(cx, cy);
    context.globalCompositeOperation = "lighter";
    for (let ring = 0; ring < rings; ring += 1) {
      const progress = ((ring / rings) + pulse * 0.22) % 1;
      const size = (0.06 + progress * progress * 0.9) * Math.min(width, height);
      const alpha = 0.05 + progress * 0.4 + energy * 0.22;
      context.strokeStyle = `hsla(${108 + ring * 3}, 95%, 72%, ${alpha})`;
      context.lineWidth = Math.max(1, width * 0.0012);
      context.beginPath();
      context.rect(-size * 0.72, -size * 0.44, size * 1.44, size * 0.88);
      context.stroke();
    }
    const rays = Math.max(8, Math.floor(22 * this.quality));
    for (let ray = 0; ray < rays; ray += 1) {
      const angle = (ray / rays) * Math.PI * 2 + Math.sin(this.phase * 0.3) * 0.08;
      const bin = this.frequency[Math.floor((ray / rays) * (this.frequency.length - 1))] / 255;
      context.strokeStyle = `rgba(165, 255, 157, ${0.14 + bin * 0.42})`;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(Math.cos(angle) * width, Math.sin(angle) * height);
      context.stroke();
    }
    context.restore();
  }

  drawSpectralFire(context, width, height, energy) {
    const columns = Math.max(18, Math.floor(72 * this.quality));
    const columnWidth = width / columns;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let column = 0; column < columns; column += 1) {
      const index = Math.floor((column / columns) * (this.frequency.length - 1));
      const amplitude = this.frequency[index] / 255;
      const flicker = this.reducedMotion ? 0 : (Math.sin(this.phase * 7 + column * 1.9) + 1) * 0.025;
      const flameHeight = (amplitude * 0.78 + energy * 0.18 + flicker) * height;
      const x = column * columnWidth;
      const gradient = context.createLinearGradient(x, height, x, height - flameHeight);
      gradient.addColorStop(0, "rgba(225, 72, 88, 0.1)");
      gradient.addColorStop(0.32, "rgba(225, 72, 88, 0.82)");
      gradient.addColorStop(0.7, "rgba(233, 168, 91, 0.76)");
      gradient.addColorStop(1, "rgba(177, 140, 255, 0)");
      context.fillStyle = gradient;
      context.fillRect(x + 1, height - flameHeight, Math.max(1, columnWidth - 2), flameHeight);
    }
    context.strokeStyle = `rgba(239, 230, 208, ${0.12 + energy * 0.25})`;
    context.beginPath();
    context.moveTo(0, height * 0.75);
    for (let index = 0; index < this.waveform.length; index += 1) {
      const x = (index / (this.waveform.length - 1)) * width;
      const y = height * 0.75 + ((this.waveform[index] - 128) / 128) * height * 0.2;
      context.lineTo(x, y);
    }
    context.stroke();
    context.restore();
  }

  drawCruciformScope(context, width, height, energy) {
    const cx = width / 2;
    const cy = height / 2;
    const span = Math.min(width, height) * (0.32 + energy * 0.15);
    context.save();
    context.translate(cx, cy);
    context.globalCompositeOperation = "lighter";
    context.strokeStyle = `rgba(177, 140, 255, ${0.3 + energy * 0.45})`;
    context.lineWidth = Math.max(1, width * 0.003);
    context.beginPath();
    context.moveTo(-span, 0); context.lineTo(span, 0);
    context.moveTo(0, -span * 1.2); context.lineTo(0, span * 1.2);
    context.stroke();
    context.strokeStyle = `rgba(165, 255, 157, ${0.34 + energy * 0.5})`;
    context.lineWidth = Math.max(1, width * 0.0015);
    context.beginPath();
    for (let index = 0; index < this.waveform.length; index += 1) {
      const x = ((index / (this.waveform.length - 1)) - 0.5) * span * 2.2;
      const y = ((this.waveform[index] - 128) / 128) * span * 0.52;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
    context.rotate(this.reducedMotion ? 0 : this.phase * 0.13);
    for (let arm = 0; arm < 4; arm += 1) {
      context.rotate(Math.PI / 2);
      context.strokeStyle = `rgba(225, 72, 88, ${0.08 + average(this.frequency, arm * 8, arm * 8 + 8) * 0.38})`;
      context.beginPath();
      context.arc(0, 0, span * (0.3 + arm * 0.17), -0.7, 0.7);
      context.stroke();
    }
    context.restore();
  }

  drawWarpedShrine(context, width, height, energy) {
    const cx = width / 2;
    const cy = height * 0.56;
    const scale = Math.min(width, height);
    const wobble = this.reducedMotion ? 0 : Math.sin(this.phase * 1.2) * scale * 0.015;
    context.save();
    context.translate(cx, cy);
    context.globalCompositeOperation = "lighter";
    for (let arch = 0; arch < 7; arch += 1) {
      const bin = this.frequency[Math.floor((arch / 7) * (this.frequency.length * 0.55))] / 255;
      const radius = scale * (0.12 + arch * 0.075 + bin * 0.035);
      context.strokeStyle = `hsla(${267 + arch * 5}, 85%, 76%, ${0.07 + bin * 0.45})`;
      context.lineWidth = Math.max(1, scale * 0.002);
      context.beginPath();
      context.ellipse(wobble * (arch - 3), scale * 0.28, radius * 0.58, radius, 0, Math.PI, Math.PI * 2);
      context.stroke();
    }
    const blocks = Math.max(5, Math.floor(13 * this.quality));
    for (let block = 0; block < blocks; block += 1) {
      const amp = this.frequency[Math.floor((block / blocks) * this.frequency.length)] / 255;
      const x = ((block / (blocks - 1)) - 0.5) * scale * 0.78;
      const h = scale * (0.11 + amp * 0.27);
      context.fillStyle = `rgba(239, 230, 208, ${0.025 + amp * 0.15})`;
      context.fillRect(x - scale * 0.027, scale * 0.34 - h, scale * 0.054, h);
    }
    context.strokeStyle = `rgba(165, 255, 157, ${0.22 + energy * 0.52})`;
    context.beginPath();
    context.moveTo(0, -scale * 0.31);
    context.lineTo(0, scale * 0.27);
    context.moveTo(-scale * 0.13, -scale * 0.06);
    context.lineTo(scale * 0.13, -scale * 0.06);
    context.stroke();
    context.restore();
  }
}

/**
 * Concise factory for application code.
 * @param {HTMLCanvasElement|string} target CSS selector or canvas
 * @param {ConstructorParameters<typeof SpellVisualizer>[1]} options
 */
export function createSpellVisualizer(target, options = {}) {
  const canvas = typeof target === "string" ? document.querySelector(target) : target;
  return new SpellVisualizer(canvas, options);
}

export { MODES as SPELL_VISUALIZER_MODES, MODE_LABELS as SPELL_VISUALIZER_MODE_LABELS, MODE_ALIASES as SPELL_VISUALIZER_MODE_ALIASES };
