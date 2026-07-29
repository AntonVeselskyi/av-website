const ENTER_FRAMES = 5;
const ENTER_MS = 90;
const ENTER_RATIO = 1.35;
const HOLD_RATIO = 1.55;
const ENTER_SEPARATION = 0.11;
const HOLD_SEPARATION = 0.05;

function finiteRatio(pose) {
  const threshold = Number(pose?.effectiveThreshold);
  const distance = Number(pose?.distance);
  return Number.isFinite(distance) && Number.isFinite(threshold) && threshold > 0
    ? distance / threshold
    : Infinity;
}

function promotable(pose, ratio, separation) {
  return Number.isInteger(pose?.digit)
    && pose.digit >= 1 && pose.digit <= 5
    && pose.reason === "outside-calibration"
    && ratio <= ENTER_RATIO
    && separation >= ENTER_SEPARATION;
}

function promotedPose(pose, ratio, phase, evidence = {}) {
  const separation = Number(pose.separation) || 0;
  return {
    ...pose,
    accepted: true,
    confidence: Math.max(Number(pose.confidence) || 0, Math.min(0.78, 0.5 + separation * 0.7)),
    rawReason: pose.reason,
    reason: "stable-nearest",
    stabilized: true,
    stabilizationPhase: phase,
    stabilizationEvidenceFrames: evidence.frames ?? null,
    stabilizationEvidenceMs: evidence.ms ?? null,
    thresholdRatio: ratio,
  };
}

/**
 * Adds temporal evidence to a personal pose classifier. A clearly nearest
 * calibrated sign may drift outside its small capture envelope as the wrist
 * rolls or the hand moves closer to the camera. Requiring the same nearest
 * class over multiple frames broadens performance range without weakening the
 * palm/knuckles orientation gate or accepting a genuinely ambiguous class.
 */
export class PoseStabilizer {
  constructor({ enterFrames = ENTER_FRAMES, enterMs = ENTER_MS } = {}) {
    this.enterFrames = enterFrames;
    this.enterMs = enterMs;
    this.reset();
  }

  reset() {
    this.candidateDigit = null;
    this.candidateFrames = 0;
    this.candidateSince = null;
    this.acceptedDigit = null;
  }

  update(pose, timestamp) {
    if (!pose || !Number.isFinite(timestamp)) {
      this.reset();
      return pose;
    }
    if (pose.accepted) {
      this.acceptedDigit = pose.digit;
      this.candidateDigit = null;
      this.candidateFrames = 0;
      this.candidateSince = null;
      return pose;
    }

    const ratio = finiteRatio(pose);
    const separation = Number(pose.separation) || 0;
    if (this.acceptedDigit === pose.digit
      && pose.reason === "outside-calibration"
      && ratio <= HOLD_RATIO
      && separation >= HOLD_SEPARATION) {
      return promotedPose(pose, ratio, "hold");
    }

    if (!promotable(pose, ratio, separation)) {
      this.acceptedDigit = null;
      this.candidateDigit = null;
      this.candidateFrames = 0;
      this.candidateSince = null;
      return pose;
    }

    if (this.candidateDigit !== pose.digit) {
      this.acceptedDigit = null;
      this.candidateDigit = pose.digit;
      this.candidateFrames = 1;
      this.candidateSince = timestamp;
      return { ...pose, stabilizationProgress: 1 / this.enterFrames, thresholdRatio: ratio };
    }
    this.candidateFrames += 1;
    const elapsed = timestamp - this.candidateSince;
    if (this.candidateFrames < this.enterFrames || elapsed < this.enterMs) {
      return {
        ...pose,
        stabilizationProgress: Math.min(1, Math.max(this.candidateFrames / this.enterFrames, elapsed / this.enterMs)),
        thresholdRatio: ratio,
      };
    }
    const evidenceFrames = this.candidateFrames;
    this.acceptedDigit = pose.digit;
    this.candidateDigit = null;
    this.candidateFrames = 0;
    this.candidateSince = null;
    return promotedPose(pose, ratio, "enter", { frames: evidenceFrames, ms: elapsed });
  }
}
