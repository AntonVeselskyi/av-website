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
      recoveryFrames: thresholds.recoveryFrames ?? 3,
      recoveryMs: thresholds.recoveryMs ?? 70,
      metric: thresholds.metric === "palm-tilt" ? "palm-tilt" : "screen-y",
      readyVerticality: thresholds.readyVerticality ?? 0.68,
      hitVerticality: thresholds.hitVerticality ?? 0.42,
      lockedMissingReleaseMs: thresholds.lockedMissingReleaseMs ?? 190,
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
    this.stableStartY = null;
    this.armY = null;
    this.hitY = null;
    this.lastAcceptedPose = null;
    this.lastAcceptedPoseAt = null;
    this.lockedDigit = null;
    this.flowDigit = null;
    this.flowFrames = 0;
    this.flowSince = null;
    this.recoveryFrames = 0;
    this.recoverySince = null;
    this.strikeCandidate = false;
    this.lastObservedPalmY = null;
    this.missingSince = null;
    this.missingY = null;
    this.missingDigit = null;
    this.missingReady = false;
    this.palmVerticality = null;
    this.motion = new TemporalScalarPredictor({ minCutoff: 2.8, beta: 0.35, windowMs: 95, maxGapMs: this.thresholds.maxGapMs });
  }

  /** Preserve an armed strike across MediaPipe's usual hand-at-impact dropout. */
  markMissing(timestamp) {
    if (!Number.isFinite(timestamp) || this.lastTimestamp == null) {
      return { state: this.state, velocity: this.velocity, reason: "hand-unavailable" };
    }
    if (this.missingSince == null) {
      this.missingSince = timestamp;
      this.missingY = Math.min(
        Number.isFinite(this.stableStartY) ? this.stableStartY : Infinity,
        Number.isFinite(this.lastObservedPalmY) ? this.lastObservedPalmY : Infinity,
        Number.isFinite(this.filteredY) ? this.filteredY : Infinity,
      );
      if (!Number.isFinite(this.missingY)) this.missingY = null;
      this.missingDigit = this.stableDigit || this.lastAcceptedPose?.digit || null;
      const stableLongEnough = this.stableDigit != null
        && this.stableFrames >= this.thresholds.stableFrames
        && Number.isFinite(this.stableSince)
        && this.lastTimestamp - this.stableSince >= this.thresholds.stableMs;
      const fastCandidateReady = this.strikeCandidate
        && this.stableFrames >= 2
        && Number.isFinite(this.stableSince)
        && this.lastTimestamp - this.stableSince >= 16;
      this.missingReady = this.state === "armed" || stableLongEnough || fastCandidateReady;
    }
    const missingDuration = timestamp - this.missingSince;
    // An already-playing note gets only a short detector grace. Armed hands
    // retain the longer impact-reacquisition window, but taking the hand away
    // must not leave a synth gate hanging.
    if (this.state === "locked" && missingDuration > this.thresholds.lockedMissingReleaseMs) {
      this.reset();
      return { state: this.state, velocity: 0, reason: "held-hand-removed", missingMs: missingDuration };
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
      missingMs: missingDuration,
    };
  }

  update({ timestamp, palmY, palmTilt = null, pose, latencyMs = null }) {
    if (!Number.isFinite(timestamp) || !Number.isFinite(palmY)) {
      this.reset();
      return { hit: null, state: this.state, velocity: 0, reason: "unarmed" };
    }
    const tiltMode = this.thresholds.metric === "palm-tilt";
    if (tiltMode && !Number.isFinite(palmTilt)) {
      this.reset();
      return { hit: null, state: this.state, velocity: 0, reason: "tilt-unavailable" };
    }
    this.palmVerticality = Number.isFinite(palmTilt) ? palmTilt : null;
    const readyOrientation = !tiltMode || palmTilt >= this.thresholds.readyVerticality;
    const hitOrientation = !tiltMode || palmTilt <= this.thresholds.hitVerticality;
    // The existing temporal decoder expects a scalar that grows through a
    // strike. Horizontalness (1 - verticality) has exactly that property.
    palmY = tiltMode ? 1 - palmTilt : palmY;
    const candidateDigit = Number(pose?.digit);
    const candidateReason = String(pose?.reason || "");
    const candidateRatio = Number.isFinite(pose?.thresholdRatio)
      ? pose.thresholdRatio
      : Number(pose?.distance) / Math.max(0.001, Number(pose?.effectiveThreshold));
    const lockedCandidate = this.state === "locked"
      && Number.isInteger(candidateDigit) && candidateDigit >= 1 && candidateDigit <= 5
      && ["outside-calibration", "ambiguous-pose"].includes(candidateReason)
      && Number(pose?.confidence || 0) >= this.thresholds.candidateFlowConfidence
      && Number.isFinite(candidateRatio) && candidateRatio <= 1.35
      && Number(pose?.separation || 0) >= 0.07;
    const strongStrikeCandidate = this.state !== "locked"
      && !pose?.accepted
      && Number.isInteger(candidateDigit) && candidateDigit >= 1 && candidateDigit <= 5
      && candidateReason === "outside-calibration"
      && Number.isFinite(candidateRatio) && candidateRatio <= 1.35
      && Number(pose?.separation || 0) >= 0.14
      && pose?.viewAccepted !== false;
    if (pose?.accepted) {
      this.lastAcceptedPose = pose;
      this.lastAcceptedPoseAt = timestamp;
    } else if (lockedCandidate) {
      // While dipped, a repeatable closest-class candidate may be the user's
      // finger unfolding between signs. It gets a much stricter temporal gate
      // than a calibrated pose, but it must not kill the held note immediately.
      pose = { ...pose, transitionCandidate: true };
    } else if (strongStrikeCandidate) {
      // Downward motion supplies the final evidence for a fast clear nearest
      // sign. This state is deliberately unable to arm while stationary.
      pose = { ...pose, strikeCandidate: true, confidence: Math.max(Number(pose.confidence) || 0, 0.45) };
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
    this.strikeCandidate = Boolean(pose.strikeCandidate);

    const missingDuration = this.missingSince == null ? null : timestamp - this.missingSince;
    const reacquireDisplacement = Number.isFinite(this.missingY) ? palmY - this.missingY : 0;
    const reacquiredStroke = this.missingReady
      && missingDuration >= 0
      && missingDuration <= this.thresholds.maxReacquireMs
      && reacquireDisplacement >= this.thresholds.reacquireDisplacement
      && pose.confidence >= 0.35
      && hitOrientation;
    if (reacquiredStroke) {
      const strikeSeconds = Math.max(0.016, (timestamp - this.lastTimestamp) / 1000);
      const strikeVelocity = reacquireDisplacement / strikeSeconds;
      this.state = "locked";
      this.armY = this.missingY;
      this.hitY = palmY;
      this.lockedDigit = pose.digit;
      this.recoveryFrames = 0;
      this.recoverySince = null;
      this.strikeCandidate = false;
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
      if (pose.accepted) {
        this.lastAcceptedPose = pose;
        this.lastAcceptedPoseAt = timestamp;
      }
      this.motion.update(timestamp, palmY);
      this.stableDigit = pose.digit;
      this.stableFrames = 1;
      this.stableSince = timestamp;
      this.stableStartY = palmY;
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
      this.stableStartY = palmY;
      if (this.state !== "locked") this.state = "neutral";
    } else {
      this.stableFrames += 1;
    }

    if (this.state === "locked") {
      // Recovery is measured from the deepest observed dipped position, not
      // from velocity or a forecast. Small upward bounces remain held.
      this.hitY = Math.max(this.hitY, palmY);
      const recoveryThreshold = Math.max(0.025, this.thresholds.recoveryDisplacement);
      const returnLine = Number.isFinite(this.armY)
        ? Math.min(this.hitY - recoveryThreshold, this.armY + this.thresholds.minDisplacement * 0.35)
        : this.hitY - recoveryThreshold;
      if (palmY <= returnLine && readyOrientation) {
        this.recoveryFrames += 1;
        if (this.recoverySince == null) this.recoverySince = timestamp;
      } else {
        this.recoveryFrames = 0;
        this.recoverySince = null;
      }
      const recoveryMs = this.recoverySince == null ? 0 : timestamp - this.recoverySince;
      if (this.recoveryFrames >= this.thresholds.recoveryFrames && recoveryMs >= this.thresholds.recoveryMs) {
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
        this.stableStartY = palmY;
        this.lockedDigit = null;
        this.flowDigit = null;
        this.flowFrames = 0;
        this.flowSince = null;
        this.recoveryFrames = 0;
        this.recoverySince = null;
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

    const fastStartDisplacement = Number.isFinite(this.stableStartY) ? palmY - this.stableStartY : 0;
    const fastStartHit = this.state === "neutral"
      && this.stableFrames >= 2
      && timestamp - this.stableSince >= 16
      && this.velocity >= this.thresholds.strokeVelocity
      && fastStartDisplacement >= this.thresholds.minDisplacement
      && hitOrientation;
    if (fastStartHit) {
      this.state = "locked";
      this.armY = this.stableStartY;
      this.hitY = this.filteredY;
      this.lockedDigit = pose.digit;
      this.recoveryFrames = 0;
      this.recoverySince = null;
      this.strikeCandidate = false;
      const velocity = Math.max(0, Math.min(1, (this.velocity - this.thresholds.strokeVelocity) / (3 - this.thresholds.strokeVelocity)));
      return {
        hit: {
          digit: pose.digit,
          source: "downstroke",
          velocity: 0.4 + velocity * 0.6,
          confidence: pose.confidence,
          fastStart: true,
          leadMs: 0,
        },
        state: this.state,
        velocity: this.velocity,
        reason: "fast-start-hit",
      };
    }

    if (this.strikeCandidate) {
      return { hit: null, state: this.state, velocity: this.velocity, reason: "tracking-fast-candidate" };
    }

    if (this.state === "neutral") {
      const stable = this.stableFrames >= this.thresholds.stableFrames
        && timestamp - this.stableSince >= this.thresholds.stableMs;
      if (!stable || Math.abs(this.velocity) > this.thresholds.neutralVelocity) {
        return { hit: null, state: this.state, velocity: this.velocity, reason: stable ? "awaiting-rest" : "stabilizing" };
      }
      if (!readyOrientation) {
        return { hit: null, state: this.state, velocity: this.velocity, reason: "awaiting-upright" };
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
    const predictedOrientationHit = !tiltMode || predictedY >= 1 - this.thresholds.hitVerticality;
    const observedHit = this.velocity >= this.thresholds.strokeVelocity
      && displacement >= this.thresholds.minDisplacement
      && hitOrientation;
    const predictedHit = trajectory.ready
      && trajectory.consistency >= 0.66
      && displacement >= this.thresholds.minDisplacement * 0.28
      && predictedDisplacement >= this.thresholds.minDisplacement
      && Math.max(this.velocity, trajectory.velocity) >= this.thresholds.strokeVelocity * 0.58
      && predictedVelocity >= this.thresholds.strokeVelocity * 0.72
      && pose.confidence >= 0.5
      && predictedOrientationHit;
    if (observedHit || predictedHit) {
      this.state = "locked";
      // Forecasts decide when to trigger, but the observed position owns the
      // hold baseline. Using a future predicted Y made the next real frame
      // look like an upward recovery and cut sustained notes immediately.
      this.hitY = this.filteredY;
      this.lockedDigit = pose.digit;
      this.recoveryFrames = 0;
      this.recoverySince = null;
      this.strikeCandidate = false;
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
