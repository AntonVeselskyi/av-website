import { normalizeLandmarks, poseFeatures, contactDistances } from "./landmarks.js?v=3";
import { classifyPose } from "./pose-classifier.js?v=5";
import { PoseStabilizer } from "./pose-stabilizer.js?v=3";
import { DownstrokeRecognizer } from "./downstroke.js?v=9";
import { ContactRecognizer } from "./contacts.js?v=5";
import { isCalibrationProfile } from "./calibration.js?v=6";

/**
 * Browser-independent recognition core. Both the worker and test replays feed
 * it MediaPipe-compatible landmark frames:
 * `{ timestamp, landmarks, handedness?, confidence? }`.
 */
export class SignSpellRecognizer {
  constructor(profile = null) {
    this.handedness = "right";
    this.setProfile(profile);
  }

  setProfile(profile) {
    this.profile = isCalibrationProfile(profile) ? profile : null;
    if (this.profile) this.handedness = this.profile.handedness;
    this.downstroke = this.profile ? new DownstrokeRecognizer(this.profile.downstroke) : null;
    this.contacts = this.profile ? new ContactRecognizer(this.profile.contacts) : null;
    this.poseStabilizer = new PoseStabilizer();
  }

  setHandedness(handedness) {
    // A calibrated profile owns its handedness. This only keeps the preflight
    // diagnostic mirror-normalised while somebody is still calibrating.
    if (!this.profile) this.handedness = String(handedness).toLowerCase() === "left" ? "left" : "right";
  }

  reset() {
    this.poseStabilizer?.reset();
    this.downstroke?.reset();
    this.contacts?.reset();
  }

  process(frame) {
    const normalized = normalizeLandmarks(frame?.landmarks, this.handedness);
    if (!normalized) {
      // Release thumb contacts immediately. Downstrokes retain the last armed
      // palm position so a hand that disappears at impact can commit when it
      // reappears lower in the frame.
      this.contacts?.reset();
      const stroke = this.downstroke?.markMissing(frame?.timestamp) || null;
      return { hit: null, diagnostics: unavailableDiagnostics("hand-unavailable", stroke) };
    }
    const confidence = Number.isFinite(frame.confidence) ? frame.confidence : 1;
    const distances = contactDistances(normalized);
    if (!this.profile) {
      return {
        hit: null,
        diagnostics: createDiagnostics({
          reason: "calibration-required", normalized, confidence, distances,
          pose: unavailablePose("calibration-required"), contact: null, stroke: null,
        }),
      };
    }
    const pose = this.poseStabilizer.update(
      classifyPose(this.profile.pose, poseFeatures(normalized), normalized.cameraFacing),
      frame.timestamp,
    );
    const contact = this.contacts.update({
      timestamp: frame.timestamp,
      distances,
      view: normalized.cameraFacing,
      confidence,
      latencyMs: frame.latencyMs,
    });
    const stroke = this.downstroke.update({
      timestamp: frame.timestamp,
      palmY: normalized.palmScreenY,
      palmTilt: normalized.palmScreenVerticality,
      pose,
      latencyMs: frame.latencyMs,
    });
    // Contacts take precedence; a thumb-contact pose must never also strike a
    // 1–5 note from incidental downward movement in the same video frame.
    const hit = contact.hit || stroke.hit;
    return {
      hit: hit ? { ...hit, timestamp: frame.timestamp } : null,
      diagnostics: createDiagnostics({
        reason: hit ? "hit" : pose.reason,
        normalized, confidence, distances, pose, contact, stroke,
        profile: this.profile, strokeRecognizer: this.downstroke,
      }),
    };
  }
}

function unavailablePose(reason) { return { digit: null, accepted: false, confidence: 0, reason }; }

function unavailableDiagnostics(reason, stroke = null) {
  return Object.freeze({
    reason,
    hand: Object.freeze({ detected: false, confidence: 0 }),
    orientation: null,
    fingertips: Object.freeze({ distances: null, contacts: Object.freeze({}) }),
    pose: Object.freeze(unavailablePose(reason)),
    contact: Object.freeze({ reason, states: Object.freeze({}) }),
    downstroke: Object.freeze({
      state: stroke?.state || "unavailable",
      velocity: Number.isFinite(stroke?.velocity) ? stroke.velocity : 0,
      reason: stroke?.reason || reason,
      missingMs: Number.isFinite(stroke?.missingMs) ? stroke.missingMs : null,
    }),
    palmScreenY: null,
  });
}

/**
 * Derived-only per-frame diagnostics. This is deliberately landmark- and
 * image-free so the app may render a live inspector without retaining webcam
 * content or sending it anywhere.
 */
export function createDiagnostics({ reason, normalized, confidence, distances, pose, contact, stroke, profile = null, strokeRecognizer = null }) {
  const states = contact?.states || {};
  const recoveryThreshold = strokeRecognizer
    ? Math.max(0.025, Number(strokeRecognizer.thresholds?.recoveryDisplacement) || 0)
    : null;
  const returnLine = strokeRecognizer && Number.isFinite(strokeRecognizer.hitY)
    ? Number.isFinite(strokeRecognizer.armY)
      ? Math.min(strokeRecognizer.hitY - recoveryThreshold, strokeRecognizer.armY + strokeRecognizer.thresholds.minDisplacement * 0.35)
      : strokeRecognizer.hitY - recoveryThreshold
    : null;
  const contacts = Object.fromEntries([6, 7, 8, 9].map((digit) => {
    const settings = profile?.contacts?.contacts?.[digit] || null;
    const distance = Number.isFinite(distances?.[digit]) ? distances[digit] : null;
    return [digit, Object.freeze({
      distance,
      threshold: Number.isFinite(settings?.threshold) ? settings.threshold : null,
      release: Number.isFinite(settings?.release) ? settings.release : null,
      latched: Boolean(states[digit]),
      withinThreshold: settings && distance != null ? distance <= settings.threshold : null,
      phase: contact?.predictions?.[digit]?.phase || (states[digit] ? "contact" : "open"),
      predictedDistance: Number.isFinite(contact?.predictions?.[digit]?.predictedDistance)
        ? contact.predictions[digit].predictedDistance : null,
      timeToContact: Number.isFinite(contact?.predictions?.[digit]?.timeToContact)
        ? contact.predictions[digit].timeToContact : null,
      intentConfidence: Number.isFinite(contact?.predictions?.[digit]?.confidence)
        ? contact.predictions[digit].confidence : 0,
    })];
  }));
  return Object.freeze({
    reason,
    hand: Object.freeze({ detected: true, confidence }),
    // This signed, camera-relative normal is intentionally not labelled
    // "palm" or "knuckles": front-camera mirroring differs by device. Its
    // comparison to calibration lives in pose.viewDistance/contact gating.
    orientation: Object.freeze({
      cameraFacing: normalized.cameraFacing,
      palmVerticality: normalized.palmScreenVerticality,
      motionMetric: strokeRecognizer?.thresholds?.metric || "screen-y",
    }),
    fingertips: Object.freeze({ distances: Object.freeze({ ...distances }), contacts: Object.freeze(contacts) }),
    pose: Object.freeze({ ...pose }),
    contact: Object.freeze({ reason: contact?.reason || "profile-unavailable", states: Object.freeze({ ...states }) }),
    downstroke: Object.freeze({
      state: stroke?.state || "unavailable",
      velocity: Number.isFinite(stroke?.velocity) ? stroke.velocity : 0,
      predictedY: Number.isFinite(stroke?.predictedY) ? stroke.predictedY : null,
      predictedVelocity: Number.isFinite(stroke?.predictedVelocity) ? stroke.predictedVelocity : null,
      horizonMs: Number.isFinite(stroke?.horizonMs) ? stroke.horizonMs : null,
      reason: stroke?.reason || "profile-unavailable",
      stableDigit: Number.isInteger(strokeRecognizer?.stableDigit) ? strokeRecognizer.stableDigit : null,
      lockedDigit: Number.isInteger(strokeRecognizer?.lockedDigit) ? strokeRecognizer.lockedDigit : null,
      stableFrames: Number(strokeRecognizer?.stableFrames) || 0,
      stableMs: Number.isFinite(strokeRecognizer?.stableSince) && Number.isFinite(strokeRecognizer?.lastTimestamp)
        ? Math.max(0, strokeRecognizer.lastTimestamp - strokeRecognizer.stableSince) : 0,
      filteredY: Number.isFinite(strokeRecognizer?.filteredY) ? strokeRecognizer.filteredY : null,
      stableStartY: Number.isFinite(strokeRecognizer?.stableStartY) ? strokeRecognizer.stableStartY : null,
      armY: Number.isFinite(strokeRecognizer?.armY) ? strokeRecognizer.armY : null,
      hitY: Number.isFinite(strokeRecognizer?.hitY) ? strokeRecognizer.hitY : null,
      displacement: Number.isFinite(strokeRecognizer?.armY) && Number.isFinite(normalized?.palmScreenY)
        ? normalized.palmScreenY - strokeRecognizer.armY : null,
      recovery: Number.isFinite(strokeRecognizer?.hitY) && Number.isFinite(normalized?.palmScreenY)
        ? strokeRecognizer.hitY - normalized.palmScreenY : null,
      recoveryThreshold,
      recoveryFrames: Number(strokeRecognizer?.recoveryFrames) || 0,
      recoveryFramesRequired: Number(strokeRecognizer?.thresholds?.recoveryFrames) || null,
      recoveryMs: Number.isFinite(strokeRecognizer?.recoverySince) && Number.isFinite(strokeRecognizer?.lastTimestamp)
        ? Math.max(0, strokeRecognizer.lastTimestamp - strokeRecognizer.recoverySince) : 0,
      recoveryMsRequired: Number(strokeRecognizer?.thresholds?.recoveryMs) || null,
      returnLine,
      strokeVelocityRequired: Number(strokeRecognizer?.thresholds?.strokeVelocity) || null,
      strokeDisplacementRequired: Number(strokeRecognizer?.thresholds?.minDisplacement) || null,
      strikeCandidate: Boolean(strokeRecognizer?.strikeCandidate),
      palmVerticality: Number.isFinite(normalized?.palmScreenVerticality) ? normalized.palmScreenVerticality : null,
      readyVerticality: strokeRecognizer?.thresholds?.metric === "palm-tilt"
        ? strokeRecognizer.thresholds.readyVerticality : null,
      hitVerticality: strokeRecognizer?.thresholds?.metric === "palm-tilt"
        ? strokeRecognizer.thresholds.hitVerticality : null,
    }),
    palmScreenY: normalized.palmScreenY,
  });
}
