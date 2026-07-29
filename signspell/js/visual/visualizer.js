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
  SERIAL_ORBIT: "serial-orbit",
});

const MODE_LABELS = Object.freeze({
  [MODES.WIRED_TUNNEL]: "wired // tunnel",
  [MODES.SPECTRAL_FIRE]: "spectral // fire",
  [MODES.CRUCIFORM_SCOPE]: "cruciform // scope",
  [MODES.WARPED_SHRINE]: "warped // shrine",
  [MODES.SERIAL_ORBIT]: "serial // orbit",
});

// The compact names are the HTML data-mode values.  Keeping them here makes
// the module pleasant to use without leaking rendering terminology into UI.
const MODE_ALIASES = Object.freeze({
  wired: MODES.WIRED_TUNNEL,
  fire: MODES.SPECTRAL_FIRE,
  cruciform: MODES.CRUCIFORM_SCOPE,
  shrine: MODES.WARPED_SHRINE,
  orbit: MODES.SERIAL_ORBIT,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** @param {Uint8Array} values */
function average(values, start = 0, end = values.length) {
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += values[index] || 0;
  return sum / Math.max(1, end - start) / 255;
}

function power(values, start = 0, end = values.length) {
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    const value = (values[index] || 0) / 255;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}

function rotate3D(x, y, z, pitch, yaw, roll) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const py = y * cp - z * sp;
  const pz = y * sp + z * cp;
  const yx = x * cy + pz * sy;
  const yz = -x * sy + pz * cy;
  return { x: yx * cr - py * sr, y: yx * sr + py * cr, z: yz };
}

function project3D(point, width, height, focal, cameraZ = 0) {
  const depth = point.z - cameraZ;
  if (depth < 0.18) return null;
  const scale = focal / depth;
  const x = width * 0.5 + point.x * scale;
  const y = height * 0.5 + point.y * scale;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > width * 4 || Math.abs(y) > height * 4) return null;
  return { x, y, depth, scale };
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
    this.audio = { bass: 0, mid: 0, treble: 0, flux: 0, pulse: 0, energy: 0 };
    this.previousFrequency = new Float32Array(this.frequency.length);
    this.stars = Array.from({ length: 96 }, (_, index) => ({
      x: (((index * 67) % 193) / 193) * 2 - 1,
      y: (((index * 101) % 197) / 197) * 2 - 1,
      z: 0.4 + ((index * 43) % 157) / 24,
      size: 0.4 + (index % 4) * 0.28,
    }));
    this.embers = Array.from({ length: 84 }, (_, index) => ({
      x: ((index * 47) % 83) / 83,
      y: ((index * 29) % 89) / 89,
      speed: 0.0018 + (index % 11) * 0.00034,
      size: 0.6 + (index % 5) * 0.42,
      drift: (index % 2 ? 1 : -1) * (0.002 + (index % 7) * 0.0005),
    }));
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
    this.previousFrequency = new Float32Array(bins);
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
    const count = this.frequency.length;
    const bass = power(this.frequency, 0, Math.max(2, Math.floor(count * 0.075)));
    const mid = power(this.frequency, Math.floor(count * 0.075), Math.floor(count * 0.38));
    const treble = power(this.frequency, Math.floor(count * 0.38), Math.floor(count * 0.86));
    let flux = 0;
    for (let index = 0; index < count; index += 1) {
      const value = this.frequency[index] / 255;
      flux += Math.max(0, value - this.previousFrequency[index]);
      this.previousFrequency[index] = value;
    }
    flux /= Math.max(1, count);
    const smooth = (key, value, attack = 0.52, release = 0.1) => {
      const alpha = value > this.audio[key] ? attack : release;
      this.audio[key] += (value - this.audio[key]) * alpha;
    };
    smooth("bass", bass, 0.62, 0.08);
    smooth("mid", mid, 0.48, 0.09);
    smooth("treble", treble, 0.7, 0.13);
    smooth("flux", Math.min(1, flux * 7), 0.85, 0.16);
    this.audio.pulse = Math.max(this.audio.pulse * 0.86, Math.min(1, flux * 13 + bass * 0.16));
    this.audio.energy = this.audio.bass * 0.46 + this.audio.mid * 0.34 + this.audio.treble * 0.2;
  }

  draw(timestamp) {
    if (!this.running || !this.context) return;
    const delta = Math.min(0.08, (timestamp - this.lastTimestamp || 16.7) / 1000);
    this.lastTimestamp = timestamp;
    if (!this.reducedMotion) this.phase += delta;
    this.readAudio();
    const context = this.context;
    const { width, height } = this.canvas;
    const energy = this.audio.energy;
    context.fillStyle = this.mode === MODES.WIRED_TUNNEL || this.mode === MODES.SERIAL_ORBIT
      ? `rgba(3, 3, 8, ${this.reducedMotion ? 1 : 0.34})`
      : "#050508";
    context.fillRect(0, 0, width, height);
    if (this.mode === MODES.WIRED_TUNNEL) this.drawWiredTunnel(context, width, height, energy);
    if (this.mode === MODES.SPECTRAL_FIRE) this.drawSpectralFire(context, width, height, energy);
    if (this.mode === MODES.CRUCIFORM_SCOPE) this.drawCruciformScope(context, width, height, energy);
    if (this.mode === MODES.WARPED_SHRINE) this.drawWarpedShrine(context, width, height, energy);
    if (this.mode === MODES.SERIAL_ORBIT) this.drawSerialOrbit(context, width, height, energy);
    this.frame = requestAnimationFrame((next) => this.draw(next));
  }

  drawWiredTunnel(context, width, height, energy) {
    const rings = Math.max(9, Math.floor(18 * this.quality));
    const segments = Math.max(14, Math.floor(24 * this.quality));
    const travel = this.reducedMotion ? 0.22 : (this.phase * (0.12 + this.audio.bass * 0.18)) % 1;
    const roll = this.reducedMotion ? 0 : Math.sin(this.phase * 0.37) * 0.13 + this.audio.flux * 0.12;
    const yaw = this.reducedMotion ? 0 : Math.sin(this.phase * 0.21) * 0.17;
    const focal = Math.min(width, height) * 0.82;
    const mesh = [];
    for (let ring = 0; ring < rings; ring += 1) {
      const progress = ((ring / rings - travel) % 1 + 1) % 1;
      const z = 0.32 + progress * 6.2;
      const row = [];
      for (let segment = 0; segment < segments; segment += 1) {
        const theta = segment / segments * Math.PI * 2;
        const bin = this.frequency[Math.floor(segment / segments * Math.max(1, this.frequency.length - 1))] / 255;
        const radius = 0.7
          + Math.sin(theta * 4 + this.phase * 0.7 + ring * 0.28) * 0.07
          + this.audio.bass * Math.sin(theta * 2 + ring * 0.4) * 0.17
          + bin * 0.055;
        const twist = theta + z * 0.19 + (this.reducedMotion ? 0 : this.phase * 0.08);
        const point = rotate3D(
          Math.cos(twist) * radius * 1.12,
          Math.sin(twist) * radius * 0.67,
          z,
          Math.sin(this.phase * 0.17) * 0.035,
          yaw,
          roll,
        );
        row.push(project3D(point, width, height, focal));
      }
      mesh.push({ progress, row });
    }
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let ring = rings - 1; ring >= 0; ring -= 1) {
      const { row, progress } = mesh[ring];
      const alpha = 0.07 + (1 - progress) * 0.42 + this.audio.pulse * 0.18;
      const hue = 112 + this.audio.treble * 92 + progress * 38;
      context.strokeStyle = `hsla(${hue}, 95%, 72%, ${alpha})`;
      context.lineWidth = Math.max(0.65, (1.7 - progress) * this.quality);
      context.beginPath();
      for (let segment = 0; segment <= segments; segment += 1) {
        const point = row[segment % segments];
        if (!point) continue;
        if (segment === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
      }
      context.stroke();
    }
    for (let segment = 0; segment < segments; segment += 1) {
      const bin = this.frequency[Math.floor(segment / segments * Math.max(1, this.frequency.length - 1))] / 255;
      context.strokeStyle = segment % 4 === 0
        ? `rgba(177,140,255,${0.12 + bin * 0.42})`
        : `rgba(165,255,157,${0.055 + bin * 0.22})`;
      context.lineWidth = segment % 4 === 0 ? 1.2 : 0.7;
      context.beginPath();
      let started = false;
      const ordered = mesh.slice().sort((left, right) => right.progress - left.progress);
      for (const ring of ordered) {
        const point = ring.row[segment];
        if (!point) continue;
        if (!started) { context.moveTo(point.x, point.y); started = true; } else context.lineTo(point.x, point.y);
      }
      context.stroke();
    }
    // A restrained 2000s-player HUD: serial blocks and a live lower spectrum.
    context.globalCompositeOperation = "source-over";
    context.fillStyle = `rgba(165,255,157,${0.2 + this.audio.treble * 0.35})`;
    const bars = 28;
    for (let bar = 0; bar < bars; bar += 1) {
      const amp = this.frequency[Math.floor(bar / bars * this.frequency.length)] / 255;
      const barWidth = width * 0.17 / bars;
      context.fillRect(width * 0.04 + bar * barWidth, height * 0.92 - amp * height * 0.09, Math.max(1, barWidth - 1), amp * height * 0.09);
    }
    context.font = `${Math.max(9, width * 0.012)}px monospace`;
    context.fillText(`WIRE://${String(Math.floor(this.phase * 1000) % 100000).padStart(5, "0")}  B${Math.round(this.audio.bass * 99)}  F${Math.round(this.audio.flux * 99)}`, width * 0.04, height * 0.965);
    context.restore();
  }

  drawSpectralFire(context, width, height, energy) {
    const columns = Math.max(18, Math.floor(72 * this.quality));
    const columnWidth = width / columns;
    context.save();
    const bloom = context.createRadialGradient(width * 0.5, height, 0, width * 0.5, height, height * 0.92);
    bloom.addColorStop(0, `rgba(255, 105, 50, ${0.2 + energy * 0.42})`);
    bloom.addColorStop(0.32, `rgba(225, 72, 88, ${0.11 + energy * 0.2})`);
    bloom.addColorStop(0.72, "rgba(80, 20, 62, 0.06)");
    bloom.addColorStop(1, "rgba(5, 5, 8, 0)");
    context.fillStyle = bloom;
    context.fillRect(0, 0, width, height);
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
    // Wide translucent tongues make the spectrum feel like a continuous
    // flame body instead of a row of equalizer bars.
    const tongues = Math.max(7, Math.floor(16 * this.quality));
    for (let tongue = 0; tongue < tongues; tongue += 1) {
      const index = Math.floor((tongue / tongues) * (this.frequency.length * 0.68));
      const amplitude = this.frequency[index] / 255;
      const center = ((tongue + 0.5) / tongues) * width;
      const sway = this.reducedMotion ? 0 : Math.sin(this.phase * (2.8 + tongue * 0.07) + tongue * 1.7) * width * 0.018;
      const flameHeight = height * (0.16 + amplitude * 0.72 + energy * 0.16);
      const half = width / tongues * (0.55 + amplitude * 0.45);
      const gradient = context.createLinearGradient(center, height, center + sway, height - flameHeight);
      gradient.addColorStop(0, "rgba(255, 58, 36, 0.28)"); gradient.addColorStop(0.35, "rgba(255, 136, 54, 0.32)"); gradient.addColorStop(0.72, "rgba(225, 72, 88, 0.2)"); gradient.addColorStop(1, "rgba(177, 140, 255, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(center - half, height);
      context.bezierCurveTo(center - half * 0.55, height - flameHeight * 0.36, center + sway - half * 0.3, height - flameHeight * 0.68, center + sway, height - flameHeight);
      context.bezierCurveTo(center + sway + half * 0.45, height - flameHeight * 0.62, center + half * 0.72, height - flameHeight * 0.25, center + half, height);
      context.closePath(); context.fill();
    }
    for (const ember of this.embers) {
      if (!this.reducedMotion) {
        ember.y -= ember.speed * (1.2 + energy * 5.5);
        ember.x += Math.sin(this.phase * 2.2 + ember.y * 17) * ember.drift;
        if (ember.y < -0.04) { ember.y = 1.02; ember.x = (ember.x * 1.71 + 0.37) % 1; }
        if (ember.x < 0) ember.x += 1;
        if (ember.x > 1) ember.x -= 1;
      }
      const bin = this.frequency[Math.floor(ember.x * Math.max(1, this.frequency.length - 1))] / 255;
      context.fillStyle = `rgba(255, ${105 + Math.floor(bin * 95)}, ${45 + Math.floor(bin * 70)}, ${0.16 + bin * 0.72})`;
      context.beginPath(); context.arc(ember.x * width, ember.y * height, ember.size * (0.7 + bin * 1.5) * this.quality, 0, Math.PI * 2); context.fill();
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

  drawSerialOrbit(context, width, height, energy) {
    const focal = Math.min(width, height) * 1.05;
    const baseTime = this.reducedMotion ? 0.6 : this.phase;
    const pulse = 1 + this.audio.bass * 0.2 + this.audio.pulse * 0.08;
    context.save();
    context.globalCompositeOperation = "lighter";

    // A slow field of data stars gives the polyhedron real depth without a
    // bitmap texture or a GPU dependency.
    for (const star of this.stars) {
      const travel = this.reducedMotion ? star.z : ((star.z - baseTime * 0.42) % 6.5 + 6.5) % 6.5 + 0.3;
      const point = project3D({ x: star.x * 2.2, y: star.y * 1.4, z: travel }, width, height, focal);
      if (!point) continue;
      const alpha = clamp((1 - travel / 7) * (0.18 + this.audio.treble * 0.55), 0.03, 0.7);
      context.fillStyle = `rgba(239,230,208,${alpha})`;
      context.fillRect(point.x, point.y, star.size * point.scale * 0.016, star.size * point.scale * 0.016);
    }

    const vertices = [
      [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
      [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],
    ];
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    const projected = vertices.map(([x, y, z]) => {
      const rotated = rotate3D(x * 0.58 * pulse, y * 0.58 * pulse, z * 0.58 * pulse,
        baseTime * 0.23, baseTime * 0.31, baseTime * 0.17 + this.audio.flux * 0.25);
      rotated.z += 2.45;
      return project3D(rotated, width, height, focal);
    });
    for (let layer = 0; layer < 3; layer += 1) {
      context.strokeStyle = layer === 0
        ? `rgba(225,72,88,${0.2 + energy * 0.5})`
        : layer === 1 ? `rgba(177,140,255,${0.18 + this.audio.mid * 0.5})`
          : `rgba(165,255,157,${0.2 + this.audio.treble * 0.55})`;
      context.lineWidth = (3 - layer) * 0.8;
      context.beginPath();
      for (const [from, to] of edges) {
        const a = projected[from], b = projected[to];
        if (!a || !b) continue;
        const scale = 1 + layer * 0.08;
        const ax = width * 0.5 + (a.x - width * 0.5) * scale;
        const ay = height * 0.5 + (a.y - height * 0.5) * scale;
        const bx = width * 0.5 + (b.x - width * 0.5) * scale;
        const by = height * 0.5 + (b.y - height * 0.5) * scale;
        context.moveTo(ax, ay); context.lineTo(bx, by);
      }
      context.stroke();
    }

    // Counter-rotating orbital ellipses evoke the impossible 3D screensavers
    // and music-player plugins of the era while remaining an original scene.
    for (let orbit = 0; orbit < 7; orbit += 1) {
      context.strokeStyle = `hsla(${105 + orbit * 25 + this.audio.treble * 45},90%,72%,${0.08 + (orbit % 3) * 0.045 + energy * 0.24})`;
      context.lineWidth = orbit % 3 === 0 ? 1.4 : 0.75;
      context.beginPath();
      let started = false;
      for (let step = 0; step <= 72; step += 1) {
        const theta = step / 72 * Math.PI * 2;
        const radius = 0.72 + orbit * 0.105 + Math.sin(theta * 3 + baseTime) * this.audio.mid * 0.045;
        const tilted = rotate3D(Math.cos(theta) * radius, Math.sin(theta) * radius * 0.48, 0,
          orbit * 0.38 + baseTime * (orbit % 2 ? -0.07 : 0.09), orbit * 0.29, baseTime * 0.06);
        tilted.z += 2.55;
        const point = project3D(tilted, width, height, focal);
        if (!point) continue;
        if (!started) { context.moveTo(point.x, point.y); started = true; } else context.lineTo(point.x, point.y);
      }
      context.stroke();
    }
    context.globalCompositeOperation = "source-over";
    context.fillStyle = `rgba(165,255,157,${0.3 + this.audio.flux * 0.45})`;
    context.font = `${Math.max(9, width * 0.012)}px monospace`;
    context.fillText("SERIAL ORBIT / NO CARRIER / AUDIO BODY ONLINE", width * 0.04, height * 0.95);
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
