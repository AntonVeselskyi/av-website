const TAU = Math.PI * 2;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function smoothingAlpha(cutoff, dt) {
  return 1 / (1 + 1 / (TAU * Math.max(0.01, cutoff) * Math.max(0.001, dt)));
}

/**
 * Causal scalar trajectory decoder for webcam landmarks. It combines a
 * speed-adaptive One Euro filter with a short Theil-Sen-style median slope,
 * which gives us low stationary jitter without paying the usual motion lag.
 * No camera samples are retained outside this small derived-value window.
 */
export class TemporalScalarPredictor {
  constructor(options = {}) {
    this.options = {
      minCutoff: options.minCutoff ?? 3.2,
      beta: options.beta ?? 0.18,
      derivativeCutoff: options.derivativeCutoff ?? 6,
      accelerationCutoff: options.accelerationCutoff ?? 4,
      windowMs: options.windowMs ?? 105,
      maxSamples: options.maxSamples ?? 7,
      maxGapMs: options.maxGapMs ?? 220,
    };
    this.reset();
  }

  reset() {
    this.lastTimestamp = null;
    this.lastRaw = null;
    this.filtered = null;
    this.instantVelocity = 0;
    this.velocity = 0;
    this.acceleration = 0;
    this.history = [];
  }

  update(timestamp, value) {
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
      this.reset();
      return { ready: false, reset: true };
    }
    if (this.lastTimestamp == null) {
      this.lastTimestamp = timestamp;
      this.lastRaw = value;
      this.filtered = value;
      this.history = [{ timestamp, raw: value, value }];
      return this.snapshot({ ready: false, reset: false, rawVelocity: 0, consistency: 0 });
    }
    const gapMs = timestamp - this.lastTimestamp;
    if (gapMs <= 0 || gapMs > this.options.maxGapMs) {
      this.reset();
      this.lastTimestamp = timestamp;
      this.lastRaw = value;
      this.filtered = value;
      this.history = [{ timestamp, raw: value, value }];
      return this.snapshot({ ready: false, reset: true, rawVelocity: 0, consistency: 0 });
    }

    const dt = gapMs / 1000;
    const rawVelocity = (value - this.lastRaw) / dt;
    const derivativeAlpha = smoothingAlpha(this.options.derivativeCutoff, dt);
    const previousInstantVelocity = this.instantVelocity;
    this.instantVelocity += (rawVelocity - this.instantVelocity) * derivativeAlpha;
    const cutoff = this.options.minCutoff + this.options.beta * Math.abs(this.instantVelocity);
    this.filtered += (value - this.filtered) * smoothingAlpha(cutoff, dt);

    this.history.push({ timestamp, raw: value, value: this.filtered });
    const oldest = timestamp - this.options.windowMs;
    this.history = this.history
      .filter((sample) => sample.timestamp >= oldest)
      .slice(-this.options.maxSamples);

    // Median pairwise slopes reject a single bad landmark without adding a
    // full-frame confirmation delay to a genuine fast gesture.
    const slopes = [];
    for (let first = 0; first < this.history.length - 1; first += 1) {
      for (let second = first + 1; second < this.history.length; second += 1) {
        const elapsed = (this.history[second].timestamp - this.history[first].timestamp) / 1000;
        if (elapsed >= 0.008) slopes.push((this.history[second].raw - this.history[first].raw) / elapsed);
      }
    }
    const robustVelocity = slopes.length ? median(slopes) : this.instantVelocity;
    // Keep the robust estimate responsive to a newly accelerating performer.
    this.velocity = robustVelocity * 0.68 + this.instantVelocity * 0.32;
    const rawAcceleration = (this.instantVelocity - previousInstantVelocity) / dt;
    const accelerationAlpha = smoothingAlpha(this.options.accelerationCutoff, dt);
    this.acceleration += (rawAcceleration - this.acceleration) * accelerationAlpha;
    this.acceleration = clamp(this.acceleration, -80, 80);

    const deltas = this.history.slice(1).map((sample, index) => sample.raw - this.history[index].raw);
    const direction = Math.sign(this.velocity);
    const meaningful = deltas.filter((delta) => Math.abs(delta) >= 0.0025);
    const agreeing = meaningful.filter((delta) => Math.sign(delta) === direction).length;
    const consistency = meaningful.length ? agreeing / meaningful.length : 0;

    this.lastTimestamp = timestamp;
    this.lastRaw = value;
    return this.snapshot({ ready: this.history.length >= 3, reset: false, rawVelocity, consistency });
  }

  forecast(horizonMs) {
    if (!Number.isFinite(this.lastRaw)) return null;
    const horizon = clamp(Number(horizonMs) || 0, 0, 80) / 1000;
    const base = this.lastRaw * 0.76 + this.filtered * 0.24;
    // Acceleration is useful at gesture onset but is deliberately capped so
    // one noisy frame cannot launch a prediction through the threshold.
    const accelerationTerm = clamp(0.5 * this.acceleration * horizon * horizon, -0.055, 0.055);
    return base + this.velocity * horizon + accelerationTerm;
  }

  snapshot(extra = {}) {
    return {
      value: this.filtered,
      velocity: this.velocity,
      instantVelocity: this.instantVelocity,
      acceleration: this.acceleration,
      samples: this.history.length,
      ...extra,
    };
  }
}

export function predictionHorizonMs(latencyMs, minimum = 22, maximum = 55) {
  return clamp((Number.isFinite(latencyMs) ? latencyMs : 18) + 12, minimum, maximum);
}
