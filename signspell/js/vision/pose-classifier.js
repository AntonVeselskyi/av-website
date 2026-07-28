import { median, medianAbsoluteDeviation } from "./landmarks.js";

const MIN_SPREAD = 0.035;

function vectorDistance(vector, prototype, spread) {
  const squares = vector.map((value, index) => {
    const normalized = (value - prototype[index]) / Math.max(MIN_SPREAD, spread[index]);
    return normalized * normalized;
  });
  return Math.sqrt(squares.reduce((total, value) => total + value, 0) / squares.length);
}

function vectorStats(samples) {
  const width = samples[0].length;
  const center = Array.from({ length: width }, (_, index) => median(samples.map((sample) => sample[index])));
  const spread = Array.from({ length: width }, (_, index) => Math.max(
    MIN_SPREAD,
    1.4826 * (medianAbsoluteDeviation(samples.map((sample) => sample[index]), center[index]) || 0),
  ));
  return { center, spread };
}

/**
 * Creates five personal pose prototypes. Inputs are feature vectors generated
 * by `poseFeatures`; callers may include every captured stable frame.
 */
export function buildPoseProfile(samplesByDigit) {
  const classes = {};
  const errors = [];

  for (const digit of [1, 2, 3, 4, 5]) {
    const samples = (samplesByDigit?.[digit] || []).filter((sample) => Array.isArray(sample) && sample.length);
    if (samples.length < 5) {
      errors.push(`digit ${digit} needs at least five stable samples`);
      continue;
    }
    const { center, spread } = vectorStats(samples);
    const distances = samples.map((sample) => vectorDistance(sample, center, spread));
    classes[digit] = {
      center,
      spread,
      // Generous enough for small performance movement, but bounded so a
      // different digit cannot become an accepted pose merely by being noisy.
      threshold: Math.max(1.35, Math.min(3.5, (Math.max(...distances) || 0) * 1.45 + 0.15)),
    };
  }

  return {
    valid: errors.length === 0,
    errors,
    minSeparation: 0.16,
    classes,
  };
}

/** Returns a candidate on every frame; `accepted` is the safety gate. */
export function classifyPose(profile, featureVector) {
  if (!profile?.valid || !Array.isArray(featureVector)) {
    return { digit: null, accepted: false, confidence: 0, reason: "profile-unavailable" };
  }
  const candidates = Object.entries(profile.classes)
    .filter(([, prototype]) => prototype.center.length === featureVector.length)
    .map(([digit, prototype]) => ({
      digit: Number(digit),
      distance: vectorDistance(featureVector, prototype.center, prototype.spread),
      threshold: prototype.threshold,
    }))
    .sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return { digit: null, accepted: false, confidence: 0, reason: "feature-width" };

  const [best, second = { distance: Infinity }] = candidates;
  const separation = (second.distance - best.distance) / Math.max(second.distance, 0.001);
  const inClass = best.distance <= best.threshold;
  const separated = separation >= (profile.minSeparation ?? 0.16);
  const confidence = Math.max(0, Math.min(1,
    (1 - best.distance / Math.max(best.threshold, 0.001)) * 0.6 + Math.min(1, separation / 0.35) * 0.4,
  ));

  return {
    digit: best.digit,
    accepted: inClass && separated,
    confidence,
    distance: best.distance,
    separation,
    candidates,
    reason: !inClass ? "outside-calibration" : !separated ? "ambiguous-pose" : "accepted",
  };
}
