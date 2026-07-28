/**
 * Stateful 1–5 trigger recognizer. Screen Y grows downward, so a positive
 * velocity is a downward strike. A completed strike needs an upward recovery
 * before it can fire again.
 */
export class DownstrokeRecognizer {
  constructor(thresholds = {}) {
    this.thresholds = {
      neutralVelocity: thresholds.neutralVelocity ?? 0.12,
      strokeVelocity: thresholds.strokeVelocity ?? 0.75,
      minDisplacement: thresholds.minDisplacement ?? 0.035,
      recoveryDisplacement: thresholds.recoveryDisplacement ?? 0.028,
      stableFrames: thresholds.stableFrames ?? 3,
      stableMs: thresholds.stableMs ?? 65,
      maxGapMs: thresholds.maxGapMs ?? 100,
    };
    this.reset();
  }

  reset() {
    this.state = "neutral";
    this.lastTimestamp = null;
    this.lastY = null;
    this.filteredY = null;
    this.velocity = 0;
    this.stableDigit = null;
    this.stableFrames = 0;
    this.stableSince = null;
    this.armY = null;
    this.hitY = null;
  }

  update({ timestamp, palmY, pose }) {
    if (!Number.isFinite(timestamp) || !Number.isFinite(palmY) || !pose?.accepted) {
      this.reset();
      return { hit: null, state: this.state, velocity: 0, reason: "unarmed" };
    }
    const previousTimestamp = this.lastTimestamp;
    const gap = previousTimestamp == null ? 0 : timestamp - previousTimestamp;
    if (gap <= 0 || gap > this.thresholds.maxGapMs) {
      this.reset();
      this.lastTimestamp = timestamp;
      this.lastY = palmY;
      this.filteredY = palmY;
      return { hit: null, state: this.state, velocity: 0, reason: "sample-gap" };
    }

    const dt = gap / 1000;
    const alpha = Math.min(0.78, Math.max(0.28, dt * 18));
    this.filteredY += (palmY - this.filteredY) * alpha;
    this.velocity = (this.filteredY - this.lastY) / dt;
    this.lastY = this.filteredY;
    this.lastTimestamp = timestamp;

    if (pose.digit !== this.stableDigit) {
      this.stableDigit = pose.digit;
      this.stableFrames = 1;
      this.stableSince = timestamp;
      if (this.state !== "locked") this.state = "neutral";
    } else {
      this.stableFrames += 1;
    }

    if (this.state === "locked") {
      if (this.filteredY <= this.hitY - this.thresholds.recoveryDisplacement || this.velocity < -this.thresholds.neutralVelocity) {
        this.state = "neutral";
        // The recovery swipe is intentionally abrupt. Rebase the smoother on
        // the recovered hand position so its residual velocity cannot prevent
        // an otherwise steady sign from arming for the next strike.
        this.filteredY = palmY;
        this.lastY = palmY;
        this.velocity = 0;
        this.stableFrames = 1;
        this.stableSince = timestamp;
      }
      return { hit: null, state: this.state, velocity: this.velocity, reason: "awaiting-recovery" };
    }

    if (this.state === "neutral") {
      const stable = this.stableFrames >= this.thresholds.stableFrames
        && timestamp - this.stableSince >= this.thresholds.stableMs;
      if (!stable || Math.abs(this.velocity) > this.thresholds.neutralVelocity) {
        return { hit: null, state: this.state, velocity: this.velocity, reason: stable ? "awaiting-rest" : "stabilizing" };
      }
      this.state = "armed";
      this.armY = this.filteredY;
      return { hit: null, state: this.state, velocity: this.velocity, reason: "armed" };
    }

    const displacement = this.filteredY - this.armY;
    if (this.velocity >= this.thresholds.strokeVelocity && displacement >= this.thresholds.minDisplacement) {
      this.state = "locked";
      this.hitY = this.filteredY;
      const velocity = Math.max(0, Math.min(1, (this.velocity - this.thresholds.strokeVelocity) / (3 - this.thresholds.strokeVelocity)));
      return {
        hit: { digit: pose.digit, source: "downstroke", velocity: 0.35 + velocity * 0.65, confidence: pose.confidence },
        state: this.state,
        velocity: this.velocity,
        reason: "hit",
      };
    }
    return { hit: null, state: this.state, velocity: this.velocity, reason: "armed" };
  }
}
