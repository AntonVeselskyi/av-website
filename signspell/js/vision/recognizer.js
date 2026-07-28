import { normalizeLandmarks, poseFeatures, contactDistances } from "./landmarks.js?v=2";
import { classifyPose } from "./pose-classifier.js?v=2";
import { DownstrokeRecognizer } from "./downstroke.js";
import { ContactRecognizer } from "./contacts.js?v=3";
import { isCalibrationProfile } from "./calibration.js";

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
  }

  setHandedness(handedness) {
    // A calibrated profile owns its handedness. This only keeps the preflight
    // diagnostic mirror-normalised while somebody is still calibrating.
    if (!this.profile) this.handedness = String(handedness).toLowerCase() === "left" ? "left" : "right";
  }

  reset() {
    this.downstroke?.reset();
    this.contacts?.reset();
  }

  process(frame) {
    const normalized = normalizeLandmarks(frame?.landmarks, this.handedness);
    if (!normalized) {
      this.reset();
      return { hit: null, diagnostics: unavailableDiagnostics("hand-unavailable") };
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
    const pose = classifyPose(this.profile.pose, poseFeatures(normalized), normalized.cameraFacing);
    const contact = this.contacts.update({
      timestamp: frame.timestamp,
      distances,
      view: normalized.cameraFacing,
      confidence,
    });
    const stroke = this.downstroke.update({
      timestamp: frame.timestamp,
      palmY: normalized.palmScreenY,
      pose,
    });
    // Contacts take precedence; a thumb-contact pose must never also strike a
    // 1–5 note from incidental downward movement in the same video frame.
    const hit = contact.hit || stroke.hit;
    return {
      hit: hit ? { ...hit, timestamp: frame.timestamp } : null,
      diagnostics: createDiagnostics({
        reason: hit ? "hit" : pose.reason,
        normalized, confidence, distances, pose, contact, stroke,
        profile: this.profile,
      }),
    };
  }
}

function unavailablePose(reason) { return { digit: null, accepted: false, confidence: 0, reason }; }

function unavailableDiagnostics(reason) {
  return Object.freeze({
    reason,
    hand: Object.freeze({ detected: false, confidence: 0 }),
    orientation: null,
    fingertips: Object.freeze({ distances: null, contacts: Object.freeze({}) }),
    pose: Object.freeze(unavailablePose(reason)),
    contact: Object.freeze({ reason, states: Object.freeze({}) }),
    downstroke: Object.freeze({ state: "unavailable", velocity: 0, reason }),
    palmScreenY: null,
  });
}

/**
 * Derived-only per-frame diagnostics. This is deliberately landmark- and
 * image-free so the app may render a live inspector without retaining webcam
 * content or sending it anywhere.
 */
export function createDiagnostics({ reason, normalized, confidence, distances, pose, contact, stroke, profile = null }) {
  const states = contact?.states || {};
  const contacts = Object.fromEntries([6, 7, 8, 9].map((digit) => {
    const settings = profile?.contacts?.contacts?.[digit] || null;
    const distance = Number.isFinite(distances?.[digit]) ? distances[digit] : null;
    return [digit, Object.freeze({
      distance,
      threshold: Number.isFinite(settings?.threshold) ? settings.threshold : null,
      release: Number.isFinite(settings?.release) ? settings.release : null,
      latched: Boolean(states[digit]),
      withinThreshold: settings && distance != null ? distance <= settings.threshold : null,
    })];
  }));
  return Object.freeze({
    reason,
    hand: Object.freeze({ detected: true, confidence }),
    // This signed, camera-relative normal is intentionally not labelled
    // "palm" or "knuckles": front-camera mirroring differs by device. Its
    // comparison to calibration lives in pose.viewDistance/contact gating.
    orientation: Object.freeze({ cameraFacing: normalized.cameraFacing }),
    fingertips: Object.freeze({ distances: Object.freeze({ ...distances }), contacts: Object.freeze(contacts) }),
    pose: Object.freeze({ ...pose }),
    contact: Object.freeze({ reason: contact?.reason || "profile-unavailable", states: Object.freeze({ ...states }) }),
    downstroke: Object.freeze({
      state: stroke?.state || "unavailable",
      velocity: Number.isFinite(stroke?.velocity) ? stroke.velocity : 0,
      reason: stroke?.reason || "profile-unavailable",
    }),
    palmScreenY: normalized.palmScreenY,
  });
}
