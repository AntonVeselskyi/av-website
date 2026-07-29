import { TemporalScalarPredictor, predictionHorizonMs } from "./temporal-predictor.js?v=1";

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
      maxGapMs: thresholds.maxGapMs ?? 220,
      maxReacquireMs: thresholds.maxReacquireMs ?? 460,
      reacquireDisplacement: thresholds.reacquireDisplacement ?? Math.max(0.018, (thresholds.minDisplacement ?? 0.035) * 0.62),
      poseGraceMs: thresholds.poseGraceMs ?? 180,
      flowFrames: thresholds.flowFrames ?? 2,
      flowMs: thresholds.flowMs ?? 28,
      candidateFlowFrames: thresholds.candidateFlowFrames ?? 6,
      candidateFlowMs: thresholds.candidateFlowMs ?? 110,
      candidateFlowConfidence: thresholds.candidateFlowConfidence ?? 0.18,
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
    this.lastAcceptedPose = null;
    this.lastAcceptedPoseAt = null;
    this.lockedDigit = null;
    this.flowDigit = null;
    this.flowFrames = 0;
    this.flowSince = null;
    this.lastObservedPalmY = null;
    this.missingSince = null;
    this.missingY = null;
    this.missingDigit = null;
    this.missingReady = false;
    this.motion = new TemporalScalarPredictor({ minCutoff: 2.8, beta: 0.35, windowMs: 95, maxGapMs: this.thresholds.maxGapMs });
  }

  /** Preserve an armed strike across MediaPipe's usual hand-at-impact dropout. */
  markMissing(timestamp) {
    if (!Number.isFinite(timestamp) || this.lastTimestamp == null) {
      return { state: this.state, velocity: this.velocity, reason: "hand-unavailable" };
    }
    if (this.missingSince == null) {
      this.missingSince = timestamp;
      this.missingY = Number.isFinite(this.lastObservedPalmY) ? this.lastObservedPalmY : this.filteredY;
      this.missingDigit = this.stableDigit || this.lastAcceptedPose?.digit || null;
      const stableLongEnough = this.stableDigit != null
        && this.stableFrames >= this.thresholds.stableFrames
        && Number.isFinite(this.stableSince)
        && this.lastTimestamp - this.stableSince >= this.thresholds.stableMs;
      this.missingReady = this.state === "armed" || stableLongEnough;
    }
    if (timestamp - this.missingSince > this.thresholds.maxReacquireMs) {
      this.reset();
      return { state: this.state, velocity: 0, reason: "hand-gap-timeout" };
    }
    return {
      state: this.state,
      velocity: this.velocity,
      reason: this.missingReady ? "armed-hand-gap" : "hand-unavailable",
      missingSince: this.missingSince,
    };
  }

  update({ timestamp, palmY, pose, latencyMs = null }) {
    if (!Number.isFinite(timestamp) || !Number.isFinite(palmY)) {
      this.reset();
      return { hit: null, state: this.state, velocity: 0, reason: "unarmed" };
    }
    const candidateDigit = Number(pose?.digit);
    const candidateReason = String(pose?.reason || "");
    const candidateRatio = Number.isFinite(pose?.thresholdRatio)
      ? pose.thresholdRatio
      : Number(pose?.distance) / Math.max(0.001, Number(pose?.effectiveThreshold));
    const lockedCandidate = this.state === "locked"
      && Number.isInteger(candidateDigit) && candidateDigit >= 1 && candidateDigit <= 5
      && ["outside-calibration", "ambiguous-pose"].includes(candidateReason)
      && Number(pose?.confidence || 0) >= this.thresholds.candidateFlowConfidence
      && Number.isFinite(candidateRatio) && candidateRatio <= 1.45
      && Number(pose?.separation || 0) >= 0.07;
    if (pose?.accepted) {
      this.lastAcceptedPose = pose;
      this.lastAcceptedPoseAt = timestamp;
    } else if (lockedCandidate) {
      // While dipped, a repeatable closest-class candidate may be the user's
      // finger unfolding between signs. It gets a much stricter temporal gate
      // than a calibrated pose, but it must not kill the held note immediately.
      pose = { ...pose, transitionCandidate: true };
    } else if (this.state === "locked" && this.lastAcceptedPose) {
      // Physical upward recovery owns note-off. Shape ambiguity while fingers
      // change cannot reset a note that is still held at the dipped position.
      pose = this.lastAcceptedPose;
    } else if (this.lastAcceptedPose && timestamp - this.lastAcceptedPoseAt <= this.thresholds.poseGraceMs) {
      pose = this.lastAcceptedPose;
    } else {
      this.reset();
      return { hit: null, state: this.state, velocity: 0, reason: "pose-lost" };
    }

    const missingDuration = this.missingSince == null ? null : timestamp - this.missingSince;
    const reacquireDisplacement = Number.isFinite(this.missingY) ? palmY - this.missingY : 0;
    const reacquiredStroke = this.missingReady
      && missingDuration >= 0
      && missingDuration <= this.thresholds.maxReacquireMs
      && reacquireDisplacement >= this.thresholds.reacquireDisplacement
      && pose.confidence >= 0.35;
    if (reacquiredStroke) {
      const strikeSeconds = Math.max(0.016, (timestamp - this.lastTimestamp) / 1000);
      const strikeVelocity = reacquireDisplacement / strikeSeconds;
      this.state = "locked";
      this.hitY = palmY;
      this.lockedDigit = pose.digit;
      this.filteredY = palmY;
      this.lastY = palmY;
      this.lastObservedPalmY = palmY;
      this.lastTimestamp = timestamp;
      this.velocity = strikeVelocity;
      this.stableDigit = pose.digit;
      this.motion.reset();
      this.motion.update(timestamp, palmY);
      this.missingSince = null;
      this.missingY = null;
      this.missingDigit = null;
      this.missingReady = false;
      const velocity = Math.max(0, Math.min(1, (strikeVelocity - this.thresholds.strokeVelocity * 0.5) / 2.5));
      return {
        hit: {
          digit: pose.digit,
          source: "downstroke",
          velocity: 0.42 + velocity * 0.58,
          confidence: pose.confidence,
          predicted: true,
          reacquired: true,
          leadMs: Math.min(55, missingDuration),
          gapMs: missingDuration,
        },
        state: this.state,
        velocity: strikeVelocity,
        reason: "reacquired-stroke",
      };
    }
    this.missingSince = null;
    this.missingY = null;
    this.missingDigit = null;
    this.missingReady = false;
    const previousTimestamp = this.lastTimestamp;
    const gap = previousTimestamp == null ? 0 : timestamp - previousTimestamp;
    if (gap <= 0 || gap > this.thresholds.maxGapMs) {
      this.reset();
      this.lastTimestamp = timestamp;
      this.lastY = palmY;
      this.filteredY = palmY;
      this.lastObservedPalmY = palmY;
      this.lastAcceptedPose = pose;
      this.lastAcceptedPoseAt = timestamp;
      this.motion.update(timestamp, palmY);
      return { hit: null, state: this.state, velocity: 0, reason: "sample-gap" };
    }

    const trajectory = this.motion.update(timestamp, palmY);
    this.filteredY = trajectory.value;
    this.velocity = trajectory.instantVelocity;
    this.lastY = this.filteredY;
    this.lastObservedPalmY = palmY;
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
        this.motion.reset();
        this.motion.update(timestamp, palmY);
        this.stableFrames = 1;
        this.stableSince = timestamp;
        this.lockedDigit = null;
        this.flowDigit = null;
        this.flowFrames = 0;
        this.flowSince = null;
      } else if (pose.digit !== this.lockedDigit) {
        if (pose.digit !== this.flowDigit) {
          this.flowDigit = pose.digit;
          this.flowFrames = 1;
          this.flowSince = timestamp;
        } else this.flowFrames += 1;
        const requiredFrames = pose.transitionCandidate ? this.thresholds.candidateFlowFrames : this.thresholds.flowFrames;
        const requiredMs = pose.transitionCandidate ? this.thresholds.candidateFlowMs : this.thresholds.flowMs;
        if (this.flowFrames >= requiredFrames && timestamp - this.flowSince >= requiredMs) {
          this.lockedDigit = pose.digit;
          this.lastAcceptedPose = { ...pose, accepted: true, transitionCandidate: false };
          this.lastAcceptedPoseAt = timestamp;
          this.flowDigit = null;
          this.flowFrames = 0;
          this.flowSince = null;
          return {
            hit: { digit: pose.digit, source: "downstroke", flow: true, velocity: 0.72, confidence: pose.confidence },
            state: this.state,
            velocity: this.velocity,
            reason: "flow-note",
          };
        }
      } else {
        this.flowDigit = null;
        this.flowFrames = 0;
        this.flowSince = null;
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
    const horizonMs = predictionHorizonMs(latencyMs);
    const predictedY = this.motion.forecast(horizonMs);
    const predictedDisplacement = predictedY - this.armY;
    const horizonSeconds = horizonMs / 1000;
    const predictedVelocity = trajectory.velocity + trajectory.acceleration * horizonSeconds;
    const observedHit = this.velocity >= this.thresholds.strokeVelocity
      && displacement >= this.thresholds.minDisplacement;
    const predictedHit = trajectory.ready
      && trajectory.consistency >= 0.66
      && displacement >= this.thresholds.minDisplacement * 0.28
      && predictedDisplacement >= this.thresholds.minDisplacement
      && Math.max(this.velocity, trajectory.velocity) >= this.thresholds.strokeVelocity * 0.58
      && predictedVelocity >= this.thresholds.strokeVelocity * 0.72
      && pose.confidence >= 0.5;
    if (observedHit || predictedHit) {
      this.state = "locked";
      this.hitY = predictedHit && !observedHit ? predictedY : this.filteredY;
      this.lockedDigit = pose.digit;
      const strikeVelocity = Math.max(this.velocity, predictedVelocity);
      const velocity = Math.max(0, Math.min(1, (strikeVelocity - this.thresholds.strokeVelocity) / (3 - this.thresholds.strokeVelocity)));
      return {
        hit: {
          digit: pose.digit,
          source: "downstroke",
          velocity: 0.35 + velocity * 0.65,
          confidence: pose.confidence,
          predicted: predictedHit && !observedHit,
          leadMs: predictedHit && !observedHit ? horizonMs : 0,
        },
        state: this.state,
        velocity: this.velocity,
        predictedY,
        predictedVelocity,
        horizonMs,
        reason: predictedHit && !observedHit ? "predicted-hit" : "hit",
      };
    }
    return { hit: null, state: this.state, velocity: this.velocity, predictedY, predictedVelocity, horizonMs, reason: "armed" };
  }
}
