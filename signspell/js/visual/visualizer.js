/**
 * Original canvas visualizers for $IGN⸸$PELL.
 *
 * Pass a Web Audio AnalyserNode (or anything with getByteFrequencyData and
 * getByteTimeDomainData), and the visualizer will only read its live data.
 * No audio samples, external art, or visualizer presets are embedded here.
 *
 * This module is the orchestrator.  It owns three jobs:
 *
 * 1. Signal analysis — turning the raw analyser bytes into the musical
 *    features every scene wants (bands, peak holds, onsets, tempo, level).
 * 2. The frame contract — one frozen-shape object handed to the active scene
 *    each tick, documented under `MODE_CONTRACT` below.
 * 3. The shared physical treatment — grain, interlace, tube curvature and the
 *    surveillance HUD run here, so all six scenes read as one instrument.
 *
 * Each scene lives in `./modes/<id>.js` and owns its own look completely,
 * including clearing or fading its own frame.
 */

import * as kit from "./scene-kit.js?v=7";
import WiredTunnelScene from "./modes/wired-tunnel.js?v=7";
import SpectralFireScene from "./modes/spectral-fire.js?v=7";
import CruciformScopeScene from "./modes/cruciform-scope.js?v=7";
import WarpedShrineScene from "./modes/warped-shrine.js?v=7";
import SerialOrbitScene from "./modes/serial-orbit.js?v=7";
import LavaLampScene from "./modes/lava-lamp.js?v=7";
import RoyaleFractalScene from "./modes/royale-fractal.js?v=7";

const MODES = Object.freeze({
  WIRED_TUNNEL: "wired-tunnel",
  SPECTRAL_FIRE: "spectral-fire",
  CRUCIFORM_SCOPE: "cruciform-scope",
  WARPED_SHRINE: "warped-shrine",
  SERIAL_ORBIT: "serial-orbit",
  LAVA_LAMP: "lava-lamp",
  ROYALE_FRACTAL: "royale-fractal",
});

const MODE_LABELS = Object.freeze({
  [MODES.WIRED_TUNNEL]: "wired // tunnel",
  [MODES.SPECTRAL_FIRE]: "spectral // fire",
  [MODES.CRUCIFORM_SCOPE]: "cruciform // scope",
  [MODES.WARPED_SHRINE]: "warped // shrine",
  [MODES.SERIAL_ORBIT]: "serial // orbit",
  [MODES.LAVA_LAMP]: "lava // lamp",
  [MODES.ROYALE_FRACTAL]: "royale // fractal",
});

// The compact names are the HTML data-mode values.  Keeping them here makes
// the module pleasant to use without leaking rendering terminology into UI.
const MODE_ALIASES = Object.freeze({
  wired: MODES.WIRED_TUNNEL,
  fire: MODES.SPECTRAL_FIRE,
  cruciform: MODES.CRUCIFORM_SCOPE,
  shrine: MODES.WARPED_SHRINE,
  orbit: MODES.SERIAL_ORBIT,
  lava: MODES.LAVA_LAMP,
  royale: MODES.ROYALE_FRACTAL,
});

const SCENES = Object.freeze({
  [MODES.WIRED_TUNNEL]: WiredTunnelScene,
  [MODES.SPECTRAL_FIRE]: SpectralFireScene,
  [MODES.CRUCIFORM_SCOPE]: CruciformScopeScene,
  [MODES.WARPED_SHRINE]: WarpedShrineScene,
  [MODES.SERIAL_ORBIT]: SerialOrbitScene,
  [MODES.LAVA_LAMP]: LavaLampScene,
  [MODES.ROYALE_FRACTAL]: RoyaleFractalScene,
});

/**
 * MODE_CONTRACT — what a scene receives and what it must honour.
 *
 * ```
 * render(frame) where frame = {
 *   ctx, width, height,          // destination context and pixel size
 *   ratio,                       // device pixels per CSS pixel actually used
 *   px(n),                       // CSS pixels -> device pixels
 *   unit,                        // min(width,height)/1000, for scale-free sizing
 *   time, dt, frameIndex,        // seconds, seconds, integer
 *   bpm,                         // host tempo, then detected tempo, then 120
 *   detail,                      // 0.55..1 budget multiplier for element counts
 *   quality, reducedMotion,
 *   audio: {
 *     sub, bass, lowMid, mid, highMid, treble, air,  // 0..1 smoothed RMS
 *     level, energy, flux, pulse, peak,              // 0..1
 *     beat, beatCount, sinceBeat, bpm, bar,          // onset envelope + tempo
 *     stereoDrift,                                   // slow LFO-ish wander
 *     bassRel, midRel, trebRel,                      // 1 == average for this
 *     bassAtt, midAtt, trebAtt,                      //   track; damped variants
 *     brightness,                                    // spectral centroid 0..1
 *     transient, sustain, silent,                    // percussive vs sustained
 *   },
 *   spectrum, waveform,          // Uint8Array, raw analyser data
 *   bands, bandPeaks,            // Float32Array(32), mel-spaced 0..1
 *   band(position),              // 0..1 position -> interpolated magnitude
 *   kit, palette,                // scene-kit namespace and ink set
 * }
 * ```
 *
 * Prefer the `*Rel` / `*Att` measures for anything whose scale matters (zoom
 * rates, radii, particle counts).  They hold their meaning whether the user is
 * playing the instrument quietly or piping in a mastered track.
 *
 * A scene MUST paint or fade its own background — nothing is cleared for it.
 * A scene SHOULD keep the top-left quadrant visually calm (DOM type sits
 * there) and leave the right edge for the shared HUD.  A scene MAY declare
 * `static post` to tune the shared treatment, and `suspend()` to release
 * offscreen buffers while it is not on screen.
 */

const clamp = kit.clamp;
const { palette } = kit;

const BAND_COUNT = 32;
const FLUX_HISTORY = 48;

const DEFAULT_POST = Object.freeze({
  grain: 0.085,
  scanlines: 0.15,
  dither: 0.07,
  vignette: 0.5,
  bar: 0.045,
  curve: 0.012,
  tear: true,
  hud: true,
});

export class SpellVisualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ analyser?: AnalyserNode, mode?: string, reducedMotion?: boolean, bpm?: number }} [options]
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
    this.frameIndex = 0;
    this.lastTimestamp = 0;
    this.phase = 0;
    this.ratio = 1;

    this.audio = {
      sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0, air: 0,
      level: 0, energy: 0, flux: 0, pulse: 0, peak: 0,
      beat: 0, beatCount: 0, sinceBeat: 9, bpm: 0, bar: 0, stereoDrift: 0,
      // Self-normalizing measures: 1 means "average for whatever is playing".
      bassRel: 1, midRel: 1, trebRel: 1,
      bassAtt: 1, midAtt: 1, trebAtt: 1,
      brightness: 0.5, transient: 0, sustain: 0, silent: true,
    };
    this.previousFrequency = new Float32Array(this.frequency.length);
    this.bands = new Float32Array(BAND_COUNT);
    this.bandPeaks = new Float32Array(BAND_COUNT);
    this.fluxHistory = new Float32Array(FLUX_HISTORY);
    this.fluxCursor = 0;
    this.beatIntervals = [];
    this.lastBeatAt = -9;
    // Long-window means behind the self-normalizing measures.
    this.longTerm = { bass: 0.08, mid: 0.06, treble: 0.04 };
    this.sourceLabel = "INTERNAL";
    this.hostBpm = 0;

    // Render-budget governor: scenes multiply their element counts by
    // `detail`, so a slow machine loses density instead of frame rate.
    this.load = 8;
    this.detail = 1;
    this.lastTearBeat = -1;

    this.scenes = new Map();
    this.grain = new kit.Grain();
    this.dither = new kit.Dither();
    this.tube = new kit.Layer({ scale: 1, alpha: false });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.setAnalyser(options.analyser ?? null);
    this.setBpm(options.bpm ?? 0);
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
    if (mode !== this.mode) this.scenes.get(this.mode)?.suspend?.();
    this.mode = mode;
    const parent = this.canvas.closest(".spell-visualizer, .visualizer-panel");
    if (parent) parent.dataset.modeLabel = MODE_LABELS[mode];
    const label = parent?.querySelector?.("#visualizer-label");
    if (label) label.textContent = MODE_LABELS[mode].toUpperCase();
  }

  setQuality(level = 1) { this.quality = clamp(Number(level) || 1, 0.25, 1); this.resize(); }
  setReducedMotion(enabled) { this.reducedMotion = Boolean(enabled); }

  /** Supplies the workstation tempo. Pass 0 to return to analyser detection. */
  setBpm(value = 0) {
    const bpm = Number(value);
    this.hostBpm = Number.isFinite(bpm) && bpm > 0 ? clamp(bpm, 30, 300) : 0;
  }

  /** Names the signal source in the HUD, e.g. when piping in system audio. */
  setSourceLabel(label) { this.sourceLabel = String(label || "INTERNAL").toUpperCase().slice(0, 18); }

  /** Lazily builds the active scene and keeps it warm for instant switching. */
  activeScene() {
    let scene = this.scenes.get(this.mode);
    if (!scene) {
      const Scene = SCENES[this.mode];
      if (!Scene) return null;
      scene = new Scene(kit);
      this.scenes.set(this.mode, scene);
    }
    scene.resume?.();
    return scene;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    this.ratio = ratio;
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.context?.setTransform(1, 0, 0, 1, 0, 0);
    for (const scene of this.scenes.values()) scene.resize?.(width, height, ratio);
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
    for (const scene of this.scenes.values()) scene.suspend?.();
    this.scenes.clear();
    this.grain.release();
    this.dither.release();
    this.tube.release();
    this.analyser = null;
  }

  readAudio(delta) {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.frequency);
      this.analyser.getByteTimeDomainData(this.waveform);
    } else {
      this.frequency.fill(0);
      this.waveform.fill(128);
    }
    const count = this.frequency.length;
    const slice = (from, to) => kit.power(this.frequency, Math.floor(count * from), Math.max(Math.floor(count * from) + 1, Math.floor(count * to)));
    const sub = slice(0, 0.028);
    const bass = slice(0.028, 0.085);
    const lowMid = slice(0.085, 0.18);
    const mid = slice(0.18, 0.34);
    const highMid = slice(0.34, 0.55);
    const treble = slice(0.55, 0.78);
    const air = slice(0.78, 0.97);

    // Superflux-flavoured spectral flux: each bin is compared against the
    // maximum of its neighbourhood in the previous frame, which stops vibrato
    // and pitch drift from firing false onsets on sustained material.
    let flux = 0;
    let centroidWeighted = 0;
    let centroidTotal = 0;
    for (let index = 0; index < count; index += 1) {
      const value = this.frequency[index] / 255;
      const previous = Math.max(
        this.previousFrequency[index],
        this.previousFrequency[Math.max(0, index - 1)],
        this.previousFrequency[Math.min(count - 1, index + 1)],
      );
      flux += Math.max(0, value - previous);
      centroidWeighted += value * index;
      centroidTotal += value;
      this.previousFrequency[index] = value;
    }
    flux /= Math.max(1, count);
    const centroid = centroidTotal > 0.0001 ? centroidWeighted / centroidTotal / Math.max(1, count - 1) : 0.5;

    let square = 0;
    for (let index = 0; index < this.waveform.length; index += 1) {
      const value = (this.waveform[index] - 128) / 128;
      square += value * value;
    }
    const level = Math.sqrt(square / Math.max(1, this.waveform.length));

    const smooth = (key, value, attack, release) => {
      const alpha = value > this.audio[key] ? attack : release;
      this.audio[key] += (value - this.audio[key]) * alpha;
    };
    smooth("sub", sub, 0.55, 0.07);
    smooth("bass", bass, 0.62, 0.08);
    smooth("lowMid", lowMid, 0.5, 0.085);
    smooth("mid", mid, 0.48, 0.09);
    smooth("highMid", highMid, 0.58, 0.11);
    smooth("treble", treble, 0.7, 0.13);
    smooth("air", air, 0.74, 0.15);
    smooth("level", level, 0.6, 0.1);
    smooth("flux", Math.min(1, flux * 7), 0.85, 0.16);

    this.audio.pulse = Math.max(this.audio.pulse * 0.86, Math.min(1, flux * 13 + bass * 0.16));
    this.audio.energy = this.audio.bass * 0.4 + this.audio.mid * 0.32 + this.audio.treble * 0.18 + this.audio.air * 0.1;
    this.audio.peak = Math.max(this.audio.peak * 0.985, this.audio.energy);
    this.audio.stereoDrift = Math.sin(this.phase * 0.19) * 0.6 + Math.sin(this.phase * 0.07 + 1.3) * 0.4;
    this.audio.brightness += (centroid - this.audio.brightness) * 0.09;

    // Self-normalizing measures.  A visualizer keyed to absolute amplitude
    // dies on quiet material and clips on loud material; dividing by a slow
    // running mean means 1.0 always reads as "normal for this track", which is
    // what lets one scene react musically to anything the user plays.
    const longAlpha = 1 - Math.exp(-delta / 9);
    this.longTerm.bass += (Math.max(bass, 0.004) - this.longTerm.bass) * longAlpha;
    this.longTerm.mid += (Math.max(mid, 0.004) - this.longTerm.mid) * longAlpha;
    this.longTerm.treble += (Math.max(treble, 0.004) - this.longTerm.treble) * longAlpha;
    const relative = (value, mean) => clamp(value / Math.max(0.012, mean), 0, 4);
    this.audio.bassRel = relative(bass, this.longTerm.bass);
    this.audio.midRel = relative(mid, this.longTerm.mid);
    this.audio.trebRel = relative(treble, this.longTerm.treble);
    const attack = 1 - Math.exp(-delta / 0.28);
    this.audio.bassAtt += (this.audio.bassRel - this.audio.bassAtt) * attack;
    this.audio.midAtt += (this.audio.midRel - this.audio.midAtt) * attack;
    this.audio.trebAtt += (this.audio.trebRel - this.audio.trebAtt) * attack;

    // Percussive vs sustained split, so scenes can flash on hits while their
    // slow motion follows the pad underneath.
    this.audio.transient = Math.max(this.audio.transient * Math.exp(-delta * 7), clamp(flux * 11));
    this.audio.sustain += (this.audio.level - this.audio.sustain) * (1 - Math.exp(-delta / 1.4));
    this.audio.silent = this.audio.level < 0.006 && this.audio.energy < 0.01;

    this.updateBands();
    this.detectBeat(flux, delta);
  }

  /**
   * Log-spaced bands with falling peak holds.  Linear FFT bins put almost
   * everything musical in the first eighth of the array; scenes that draw one
   * element per bin end up with a dead right-hand side.
   */
  updateBands() {
    const count = this.frequency.length;
    for (let band = 0; band < BAND_COUNT; band += 1) {
      const from = kit.melPosition(band / BAND_COUNT);
      const to = kit.melPosition((band + 1) / BAND_COUNT);
      const start = Math.min(count - 1, Math.floor(from * count));
      const end = Math.max(start + 1, Math.min(count, Math.ceil(to * count)));
      const value = clamp(kit.power(this.frequency, start, end) * (1 + band / BAND_COUNT * 1.15));
      const previous = this.bands[band];
      this.bands[band] = previous + (value - previous) * (value > previous ? 0.6 : 0.14);
      this.bandPeaks[band] = Math.max(this.bandPeaks[band] * 0.972, this.bands[band]);
    }
  }

  /**
   * Adaptive onset detection.  Spectral flux is compared against the mean of a
   * short rolling window, which tracks loud and quiet passages without any
   * per-instrument tuning.  Interval medians give a usable tempo readout.
   */
  detectBeat(flux, delta) {
    this.fluxHistory[this.fluxCursor] = flux;
    this.fluxCursor = (this.fluxCursor + 1) % FLUX_HISTORY;
    let sum = 0;
    for (let index = 0; index < FLUX_HISTORY; index += 1) sum += this.fluxHistory[index];
    const mean = sum / FLUX_HISTORY;
    const threshold = mean * 1.72 + 0.0016;

    this.audio.beat = Math.max(0, this.audio.beat - delta * 4.4);
    this.audio.sinceBeat += delta;
    if (flux > threshold && this.audio.sinceBeat > 0.11) {
      this.audio.beat = 1;
      this.audio.beatCount += 1;
      const interval = this.phase - this.lastBeatAt;
      if (interval > 0.16 && interval < 1.8) {
        this.beatIntervals.push(interval);
        if (this.beatIntervals.length > 12) this.beatIntervals.shift();
        const sorted = this.beatIntervals.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const bpm = clamp(60 / median, 60, 220);
        this.audio.bpm = this.audio.bpm ? this.audio.bpm + (bpm - this.audio.bpm) * 0.22 : bpm;
      }
      this.lastBeatAt = this.phase;
      this.audio.sinceBeat = 0;
    }
    const beatLength = this.audio.bpm ? 60 / this.audio.bpm : 0.43;
    this.audio.bar = kit.wrap01(this.phase / (beatLength * 4));
  }

  /** Builds the per-frame contract object handed to the active scene. */
  buildFrame(context, width, height, delta) {
    const ratio = this.ratio || 1;
    return {
      ctx: context,
      width,
      height,
      ratio,
      px: (value) => value * ratio,
      unit: Math.min(width, height) / 1000,
      time: this.phase,
      dt: delta,
      frameIndex: this.frameIndex,
      bpm: this.hostBpm || this.audio.bpm || 120,
      detail: this.detail,
      quality: this.quality,
      reducedMotion: this.reducedMotion,
      audio: this.audio,
      spectrum: this.frequency,
      waveform: this.waveform,
      bands: this.bands,
      bandPeaks: this.bandPeaks,
      band: (position) => this.bands[Math.min(BAND_COUNT - 1, Math.max(0, Math.round(clamp(position) * (BAND_COUNT - 1))))],
      kit,
      palette,
    };
  }

  draw(timestamp) {
    if (!this.running || !this.context) return;
    const started = performance.now();
    // Clamped at BOTH ends. A backwards timestamp — a resumed tab, a clock
    // adjustment, a caller driving frames out of order — yields a negative
    // delta, which inverts every `1 - exp(-delta / tau)` smoothing coefficient
    // and makes the followers diverge away from their target instead of toward
    // it. That runs the normalized measures off to absurd values within a few
    // frames and takes the scenes down with it.
    const delta = clamp((timestamp - this.lastTimestamp || 16.7) / 1000, 0, 0.08);
    this.lastTimestamp = timestamp;
    if (!this.reducedMotion) this.phase += delta;
    else this.phase += delta * 0.12;
    this.frameIndex += 1;
    this.readAudio(delta);

    const context = this.context;
    const { width, height } = this.canvas;
    const scene = this.activeScene();
    const frame = this.buildFrame(context, width, height, delta);
    const post = { ...DEFAULT_POST, ...(scene?.constructor?.post ?? {}) };

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.filter = "none";

    if (scene) scene.render(frame);
    else kit.fadeTo(context, width, height, palette.void, 1);

    this.applyPost(frame, post);

    const elapsed = performance.now() - started;
    this.load += (elapsed - this.load) * 0.06;
    // Two frames of headroom at 60fps, then start shedding density.
    const wanted = this.load > 13 ? 0.58 : this.load > 9.5 ? 0.78 : 1;
    this.detail += (wanted - this.detail) * 0.02;
    this.frame = requestAnimationFrame((next) => this.draw(next));
  }

  /**
   * The treatment every scene shares: tube curvature, interlace, toner grain,
   * ordered dither, vignette and the surveillance HUD.  Doing it once here is
   * what makes six different scenes feel like one physical device.
   */
  applyPost(frame, post) {
    const { ctx, width, height } = frame;
    const reduced = this.reducedMotion;
    const audio = this.audio;

    if (!reduced && post.curve > 0 && this.tube.ctx) {
      // Copy out, then recomposite as curved bands.  One extra full-frame blit.
      this.tube.match(width, height);
      this.tube.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.tube.ctx.globalCompositeOperation = "copy";
      this.tube.ctx.drawImage(this.canvas, 0, 0);
      kit.curveWarp(ctx, this.tube.canvas, width, height, {
        amount: post.curve * (1 + audio.bass * 0.7),
        bands: Math.round(26 * this.detail) + 8,
      });
      // Tracking errors land on hits, at most once per onset.  Rolling a die
      // every frame instead reads as noise rather than malfunction.
      if (post.tear && audio.beat > 0.72 && audio.beatCount !== this.lastTearBeat && audio.transient > 0.34) {
        this.lastTearBeat = audio.beatCount;
        if ((audio.beatCount % 4 === 0) || audio.flux > 0.55) {
          kit.tapeTear(ctx, this.tube.canvas, width, height, {
            count: 1 + Math.floor(audio.flux * 3),
            seed: audio.beatCount * 977 + this.frameIndex,
            amount: 0.03 + audio.flux * 0.05,
          });
        }
      }
    }

    if (post.bar > 0 && !reduced) {
      kit.rollingBar(ctx, width, height, this.phase * 0.14, { alpha: post.bar, thickness: height * 0.22 });
    }
    if (post.scanlines > 0) {
      kit.scanlines(ctx, width, height, {
        alpha: post.scanlines * (reduced ? 0.5 : 1),
        period: Math.max(2, Math.round(3 * this.ratio)),
        offset: reduced ? 0 : Math.floor(this.phase * 26) % 4,
      });
    }
    if (post.dither > 0) this.dither.apply(ctx, width, height, post.dither);
    if (post.grain > 0) {
      this.grain.apply(ctx, width, height, {
        alpha: post.grain + audio.flux * 0.03,
        frame: this.frameIndex,
        jitter: reduced ? 0 : (this.frameIndex % 7) / 7,
      });
    }
    if (post.vignette > 0) kit.vignette(ctx, width, height, { strength: post.vignette });
    if (post.hud) this.drawHud(frame);
  }

  /**
   * Machine furniture: corner landmarks, a channel serial, a tick ladder and a
   * timecode.  Deliberately sparse and never in the scene's way — the right
   * edge and the bottom-right corner are HUD territory.
   */
  drawHud(frame) {
    const { ctx, width, height, ratio } = frame;
    const audio = this.audio;
    const small = Math.max(9, 11 * ratio);
    const inset = 10 * ratio;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Corner landmarks.
    ctx.strokeStyle = palette.wire(0.2 + audio.beat * 0.4);
    ctx.lineWidth = Math.max(1, ratio);
    const arm = 16 * ratio;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [width - inset, height - inset, -1, -1],
      [inset, height - inset, 1, -1],
    ]) {
      ctx.moveTo(cx + sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * arm);
    }
    ctx.stroke();

    // Right-edge signal ladder.
    const ladderTop = height * 0.3;
    const ladderHeight = height * 0.4;
    const ticks = 18;
    for (let tick = 0; tick < ticks; tick += 1) {
      const t = tick / (ticks - 1);
      const y = ladderTop + t * ladderHeight;
      const lit = 1 - t < audio.level * 1.6 + audio.beat * 0.2;
      const long = tick % 6 === 0;
      ctx.fillStyle = lit ? palette.wire(0.55) : palette.bone(0.14);
      ctx.fillRect(width - inset - (long ? 11 : 6) * ratio, y, (long ? 11 : 6) * ratio, Math.max(1, ratio));
    }

    // Channel identity, top right.
    const serial = kit.serialString(Math.floor(this.phase * 3.1), 6);
    kit.machineText(ctx, `CH06 · ${serial}`, width - inset - 15 * ratio, inset + small, {
      size: small, align: "right", color: palette.wire(0.42), letterSpacing: 0.08,
    });
    kit.machineText(ctx, MODE_LABELS[this.mode].toUpperCase(), width - inset - 15 * ratio, inset + small * 2.2, {
      size: small * 0.92, align: "right", color: palette.violet(0.35), letterSpacing: 0.1,
    });
    kit.machineText(ctx, `SRC ${this.sourceLabel}${audio.silent ? " · NO SIGNAL" : ""}`, width - inset - 15 * ratio, inset + small * 3.4, {
      size: small * 0.85, align: "right", color: audio.silent ? palette.blood(0.42) : palette.wire(0.3), letterSpacing: 0.08,
    });

    // Timecode block, bottom right.
    const totalFrames = this.frameIndex;
    const seconds = Math.floor(this.phase);
    const timecode = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}:${String(totalFrames % 60).padStart(2, "0")}`;
    const readout = [
      `T ${timecode}`,
      `BPM ${Math.round(frame.bpm)}  HIT ${String(audio.beatCount % 1000).padStart(3, "0")}`,
      `LVL ${String(Math.round(audio.level * 99)).padStart(2, "0")}  LOAD ${String(Math.round(this.load)).padStart(2, "0")}`,
    ];
    readout.forEach((line, index) => {
      kit.machineText(ctx, line, width - inset - 15 * ratio, height - inset - (readout.length - 1 - index) * small * 1.15 - 4 * ratio, {
        size: small, align: "right", color: index === 0 ? palette.amber(0.5) : palette.bone(0.3), letterSpacing: 0.05,
      });
    });

    // On-beat frame flash — the only place the HUD raises its voice.
    if (audio.beat > 0.5 && !this.reducedMotion) {
      ctx.strokeStyle = palette.blood((audio.beat - 0.5) * 0.5);
      ctx.lineWidth = Math.max(1, ratio);
      ctx.strokeRect(inset * 0.5, inset * 0.5, width - inset, height - inset);
    }
    ctx.restore();
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
