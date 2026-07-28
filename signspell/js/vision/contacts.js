import { CONTACT_DIGITS, percentile } from "./landmarks.js";

const DIGITS = Object.keys(CONTACT_DIGITS).map(Number);

/**
 * Builds per-finger contact/release thresholds. Sample values are normalized
 * thumb-tip distances. Slow, deliberate contact is supported; closing speed
 * is only a secondary safety gate, not the definition of contact.
 */
export function buildContactProfile(samplesByDigit) {
  const contacts = {};
  const errors = [];
  for (const digit of DIGITS) {
    const source = samplesByDigit?.[digit] || {};
    const open = (source.open || []).filter(Number.isFinite);
    const closed = (source.closed || []).filter(Number.isFinite);
    if (open.length < 5 || closed.length < 5) {
      errors.push(`contact ${digit} needs five open and five closed samples`);
      continue;
    }
    const closedHigh = percentile(closed, 0.9);
    const openLow = percentile(open, 0.1);
    if (!(closedHigh < openLow)) {
      errors.push(`contact ${digit} has no usable open/closed gap`);
      continue;
    }
    const threshold = closedHigh + (openLow - closedHigh) * 0.42;
    const release = closedHigh + (openLow - closedHigh) * 0.72;
    const closingSpeeds = (source.closingSpeeds || []).map(Math.abs).filter(Number.isFinite);
    contacts[digit] = {
      threshold,
      release,
      // A low floor prevents a static accidental near-contact from sounding;
      // calibration may intentionally lower it for a gentle performer.
      minClosingSpeed: Math.max(0.03, Math.min(0.35, (percentile(closingSpeeds, 0.15) ?? 0.08) * 0.45)),
    };
  }
  return { valid: errors.length === 0, errors, contacts };
}

/** One global machine prevents multiple simultaneous 6–9 contacts from guessing. */
export class ContactRecognizer {
  constructor(profile) {
    this.profile = profile;
    this.reset();
  }

  reset() {
    this.lastTimestamp = null;
    this.lastDistances = null;
    this.latched = Object.fromEntries(DIGITS.map((digit) => [digit, false]));
  }

  update({ timestamp, distances, confidence = 1 }) {
    if (!this.profile?.valid || !Number.isFinite(timestamp) || !distances) {
      this.reset();
      return { hit: null, reason: "profile-unavailable", states: this.latched };
    }
    const previousDistances = this.lastDistances;
    const previousTimestamp = this.lastTimestamp;
    const dt = previousTimestamp == null ? null : (timestamp - previousTimestamp) / 1000;
    if (dt != null && (dt <= 0 || dt > 0.12)) {
      this.reset();
      this.lastTimestamp = timestamp;
      this.lastDistances = { ...distances };
      return { hit: null, reason: "sample-gap", states: this.latched };
    }

    const closeDigits = DIGITS.filter((digit) => distances[digit] <= this.profile.contacts[digit].threshold);
    const ambiguous = closeDigits.length > 1;
    const candidates = [];

    for (const digit of DIGITS) {
      const settings = this.profile.contacts[digit];
      const value = distances[digit];
      if (!Number.isFinite(value)) continue;
      if (this.latched[digit] && value >= settings.release) this.latched[digit] = false;
      const wasOpen = !this.latched[digit];
      const closingSpeed = dt && previousDistances
        ? Math.max(0, (previousDistances[digit] - value) / dt)
        : 0;
      if (wasOpen && value <= settings.threshold) {
        this.latched[digit] = true;
        if (!ambiguous && closingSpeed >= settings.minClosingSpeed && confidence >= 0.5) {
          candidates.push({ digit, closingSpeed, settings });
        }
      }
    }
    this.lastTimestamp = timestamp;
    this.lastDistances = { ...distances };

    if (ambiguous) return { hit: null, reason: "ambiguous-contact", states: { ...this.latched } };
    const candidate = candidates.sort((a, b) => b.closingSpeed - a.closingSpeed)[0];
    if (!candidate) return { hit: null, reason: "no-new-contact", states: { ...this.latched } };
    const velocity = Math.max(0, Math.min(1, (candidate.closingSpeed - candidate.settings.minClosingSpeed) / 2));
    return {
      hit: {
        digit: candidate.digit,
        source: "contact",
        velocity: 0.38 + velocity * 0.62,
        confidence,
      },
      reason: "hit",
      states: { ...this.latched },
    };
  }
}
