import { normalizeLandmarks, poseFeatures, contactDistances } from "./landmarks.js";
import { classifyPose } from "./pose-classifier.js";
import { DownstrokeRecognizer } from "./downstroke.js";
import { ContactRecognizer } from "./contacts.js";
import { isCalibrationProfile } from "./calibration.js";

/**
 * Browser-independent recognition core. Both the worker and test replays feed
 * it MediaPipe-compatible landmark frames:
 * `{ timestamp, landmarks, handedness?, confidence? }`.
 */
export class SignSpellRecognizer {
  constructor(profile = null) {
    this.setProfile(profile);
  }

  setProfile(profile) {
    this.profile = isCalibrationProfile(profile) ? profile : null;
    this.downstroke = this.profile ? new DownstrokeRecognizer(this.profile.downstroke) : null;
    this.contacts = this.profile ? new ContactRecognizer(this.profile.contacts) : null;
  }

  reset() {
    this.downstroke?.reset();
    this.contacts?.reset();
  }

  process(frame) {
    if (!this.profile) return { hit: null, diagnostics: { reason: "calibration-required" } };
    const normalized = normalizeLandmarks(frame?.landmarks, this.profile.handedness);
    if (!normalized) {
      this.reset();
      return { hit: null, diagnostics: { reason: "hand-unavailable" } };
    }
    const confidence = Number.isFinite(frame.confidence) ? frame.confidence : 1;
    const pose = classifyPose(this.profile.pose, poseFeatures(normalized));
    const contact = this.contacts.update({
      timestamp: frame.timestamp,
      distances: contactDistances(normalized),
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
      diagnostics: {
        pose,
        contact: { reason: contact.reason, states: contact.states },
        downstroke: { state: stroke.state, velocity: stroke.velocity, reason: stroke.reason },
        palmScreenY: normalized.palmScreenY,
      },
    };
  }
}
