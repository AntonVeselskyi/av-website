import { CONTACT_DIGITS, percentile } from "./landmarks.js?v=2";
import { TemporalScalarPredictor, predictionHorizonMs } from "./temporal-predictor.js?v=1";

const DIGITS = Object.keys(CONTACT_DIGITS).map(Number);
const MIN_VIEW_SPREAD = 0.08;

function contactValues(entries) {
  return entries.map((entry) => Number.isFinite(entry) ? { value: entry, view: null } : entry)
    .filter((entry) => Number.isFinite(entry?.value));
}

function orientationProfile(entries) {
  const views = entries.map((entry) => entry.view).filter(Number.isFinite);
  if (views.length < 5) return null;
  const center = percentile(views, 0.5);
  const deviations = views.map((value) => Math.abs(value - center));
  const spread = Math.max(MIN_VIEW_SPREAD, (percentile(deviations, 0.5) || 0) * 1.4826);
  const maxDistance = Math.max(...views.map((value) => Math.abs(value - center) / spread));
  return { center, spread, threshold: Math.max(2.2, Math.min(4, maxDistance * 1.5 + 0.45)) };
}

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
    const openEntries = contactValues(source.open || []);
    const closedEntries = contactValues(source.closed || []);
    const open = openEntries.map((entry) => entry.value);
    const closed = closedEntries.map((entry) => entry.value);
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
      view: orientationProfile([...openEntries, ...closedEntries]),
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
    this.motion = Object.fromEntries(DIGITS.map((digit) => [digit, new TemporalScalarPredictor({
      minCutoff: 3.8,
      beta: 0.2,
      windowMs: 100,
      maxGapMs: 240,
    })]));
    this.approachFrames = Object.fromEntries(DIGITS.map((digit) => [digit, 0]));
  }

  update({ timestamp, distances, confidence = 1, view = null, latencyMs = null }) {
    if (!this.profile?.valid || !Number.isFinite(timestamp) || !distances) {
      this.reset();
      return { hit: null, reason: "profile-unavailable", states: this.latched };
    }
    const previousDistances = this.lastDistances;
    const previousTimestamp = this.lastTimestamp;
    const dt = previousTimestamp == null ? null : (timestamp - previousTimestamp) / 1000;
    if (dt != null && (dt <= 0 || dt > 0.24)) {
      this.reset();
      this.lastTimestamp = timestamp;
      this.lastDistances = { ...distances };
      return { hit: null, reason: "sample-gap", states: this.latched };
    }

    const inView = (digit) => {
      const orientation = this.profile.contacts[digit].view;
      if (!orientation || !Number.isFinite(view)) return true;
      return Math.abs(view - orientation.center) / Math.max(MIN_VIEW_SPREAD, orientation.spread) <= orientation.threshold;
    };
    const candidates = [];
    const predictions = {};
    const horizonMs = predictionHorizonMs(latencyMs);

    for (const digit of DIGITS) {
      const settings = this.profile.contacts[digit];
      const value = distances[digit];
      if (!Number.isFinite(value)) continue;
      // A full calibration-open distance is too far for fast fingertip taps.
      // Release inside that gap so the same contact can retrigger promptly.
      const quickRelease = settings.threshold + (settings.release - settings.threshold) * 0.55;
      if (this.latched[digit] && value >= quickRelease) this.latched[digit] = false;
      const trajectory = this.motion[digit].update(timestamp, value);
      const closingSpeed = Math.max(0, -trajectory.velocity);
      const instantClosingSpeed = Math.max(0, -trajectory.instantVelocity);
      const opening = trajectory.instantVelocity > settings.minClosingSpeed * 0.45;
      if (trajectory.ready && trajectory.consistency >= 0.66
        && (closingSpeed >= settings.minClosingSpeed * 0.65 || instantClosingSpeed >= settings.minClosingSpeed)) {
        this.approachFrames[digit] += 1;
      } else if (opening || trajectory.consistency < 0.5) this.approachFrames[digit] = 0;
      const predictedDistance = this.motion[digit].forecast(horizonMs);
      const timeToContact = closingSpeed > 0 && value > settings.threshold
        ? ((value - settings.threshold) / closingSpeed) * 1000
        : value <= settings.threshold ? 0 : null;
      const gap = Math.max(0.02, settings.release - settings.threshold);
      const proximity = Math.max(0, Math.min(1, (settings.release - value) / gap));
      const predictedProximity = Number.isFinite(predictedDistance)
        ? Math.max(0, Math.min(1.25, (settings.release - predictedDistance) / gap))
        : 0;
      const intentConfidence = Math.max(0, Math.min(1,
        predictedProximity * 0.45
        + Math.min(1, this.approachFrames[digit] / 3) * 0.25
        + (trajectory.consistency || 0) * 0.2
        + Math.min(1, closingSpeed / Math.max(0.4, settings.minClosingSpeed * 5)) * 0.1,
      )) * Math.max(0, Math.min(1, confidence));
      predictions[digit] = {
        phase: this.latched[digit] ? "contact" : this.approachFrames[digit] >= 2 ? "approach" : "open",
        predictedDistance,
        timeToContact,
        closingSpeed,
        confidence: intentConfidence,
        horizonMs,
      };
      if (!inView(digit)) {
        this.approachFrames[digit] = 0;
        predictions[digit].phase = "wrong-view";
        continue;
      }
      const wasOpen = !this.latched[digit];
      const observedClosingSpeed = dt && previousDistances
        ? Math.max(0, (previousDistances[digit] - value) / dt)
        : 0;
      const actualContact = value <= settings.threshold
        && Math.max(observedClosingSpeed, instantClosingSpeed) >= settings.minClosingSpeed * 0.55
        && confidence >= 0.3;
      const predictiveGate = settings.threshold + gap * 0.48;
      const predictedContact = trajectory.ready
        && this.approachFrames[digit] >= 2
        && value > settings.threshold
        && value <= predictiveGate
        && predictedDistance <= settings.threshold
        && timeToContact != null && timeToContact <= horizonMs * 1.12
        && intentConfidence >= 0.62
        && confidence >= 0.52;
      if (wasOpen && (actualContact || predictedContact)) {
        if (actualContact || predictedContact) {
          const depth = (settings.threshold - value) / Math.max(0.02, settings.release - settings.threshold);
          const predictiveDepth = (settings.threshold - predictedDistance) / gap;
          candidates.push({
            digit,
            closingSpeed: Math.max(observedClosingSpeed, closingSpeed, instantClosingSpeed),
            depth,
            predictiveDepth,
            predicted: !actualContact,
            intentConfidence,
            settings,
          });
        }
      }
    }
    this.lastTimestamp = timestamp;
    this.lastDistances = { ...distances };

    candidates.sort((a, b) => (
      (b.predicted ? b.predictiveDepth : b.depth) + b.closingSpeed * 0.08 + b.intentConfidence * 0.35
    ) - (
      (a.predicted ? a.predictiveDepth : a.depth) + a.closingSpeed * 0.08 + a.intentConfidence * 0.35
    ));
    const [candidate, second] = candidates;
    if (!candidate) return { hit: null, reason: "no-new-contact", states: { ...this.latched }, predictions };
    const candidateScore = (candidate.predicted ? candidate.predictiveDepth : candidate.depth)
      + candidate.closingSpeed * 0.08 + candidate.intentConfidence * 0.35;
    const secondScore = second ? (second.predicted ? second.predictiveDepth : second.depth)
      + second.closingSpeed * 0.08 + second.intentConfidence * 0.35 : -Infinity;
    if (second && candidateScore - secondScore < 0.14) {
      return { hit: null, reason: "ambiguous-contact", states: { ...this.latched }, predictions };
    }
    // Thumb contacts are monophonic: moving directly 6→7→8→9 releases the
    // previous note and starts the clearly dominant new fingertip.
    for (const digit of DIGITS) this.latched[digit] = digit === candidate.digit;
    const velocity = Math.max(0, Math.min(1, (candidate.closingSpeed - candidate.settings.minClosingSpeed) / 2));
    return {
      hit: {
        digit: candidate.digit,
        source: "contact",
        velocity: 0.38 + velocity * 0.62,
        confidence: candidate.predicted ? candidate.intentConfidence : confidence,
        predicted: candidate.predicted,
        leadMs: candidate.predicted ? Math.max(0, Math.min(horizonMs, predictions[candidate.digit].timeToContact || 0)) : 0,
      },
      reason: candidate.predicted ? "predicted-contact" : "hit",
      states: { ...this.latched },
      predictions,
    };
  }
}
