import { median, medianAbsoluteDeviation } from "./landmarks.js?v=3";

const ANGLE_MIN_SPREAD = 0.055;
const TIP_MIN_SPREAD = 0.10;
const THUMB_ANGLE_MIN_SPREAD = 0.12;
const THUMB_TIP_MIN_SPREAD = 0.16;
const MIN_VIEW_SPREAD = 0.08;
const ANGLE_WEIGHT = 1.55;
const TIP_POSITION_WEIGHT = 0.22;

function featureSpreadFloor(index) {
  const isTip = index % 3 === 2;
  const isThumb = index < 3;
  if (isThumb) return isTip ? THUMB_TIP_MIN_SPREAD : THUMB_ANGLE_MIN_SPREAD;
  return isTip ? TIP_MIN_SPREAD : ANGLE_MIN_SPREAD;
}

function vectorDistance(vector, prototype, spread) {
  let totalWeight = 0;
  const squares = vector.map((value, index) => {
    // Every finger contributes two joint angles followed by a fingertip
    // position. The angles remain trustworthy when a curled fingertip is
    // partly hidden by the knuckles; MediaPipe's guessed tip position does
    // not. Bias recognition toward which fingers are actually straight.
    const weight = index % 3 === 2 ? TIP_POSITION_WEIGHT : ANGLE_WEIGHT;
    totalWeight += weight;
    const spreadFloor = featureSpreadFloor(index);
    const normalized = (value - prototype[index]) / Math.max(spreadFloor, Number(spread[index]) || 0);
    return normalized * normalized * weight;
  });
  return Math.sqrt(squares.reduce((total, value) => total + value, 0) / totalWeight);
}

function vectorStats(samples) {
  const width = samples[0].length;
  const center = Array.from({ length: width }, (_, index) => median(samples.map((sample) => sample[index])));
  const spread = Array.from({ length: width }, (_, index) => Math.max(
    featureSpreadFloor(index),
    1.4826 * (medianAbsoluteDeviation(samples.map((sample) => sample[index]), center[index]) || 0),
  ));
  return { center, spread };
}

/** Acceptance radius for a cluster, from how far its own samples scatter. */
function clusterThreshold(distances) {
  return Math.max(1.35, Math.min(3.5, (Math.max(...distances) || 0) * 1.45 + 0.15));
}

function describeCluster(samples) {
  const { center, spread } = vectorStats(samples);
  const distances = samples.map((sample) => vectorDistance(sample, center, spread));
  return { center, spread, threshold: clusterThreshold(distances), samples: samples.length };
}

/**
 * Splits a digit's calibration samples into two shapes when they are genuinely
 * bimodal, and returns a single shape when they are not.
 *
 * One prototype per digit cannot represent a sign that people make in more than
 * one way — three is the obvious case, made either as ASL three (thumb, index,
 * middle) or as index, middle and ring. Averaging those two into one prototype
 * is worse than picking either: the centre lands on a shape the performer never
 * makes, and the spread widens to cover both, so the class simultaneously stops
 * accepting the real poses and starts bleeding into its neighbours. Keeping the
 * modes apart fixes the ambiguity and tightens both classes at once.
 *
 * The split is deterministic: two-means seeded from the furthest-apart pair.
 */
function splitVariants(samples) {
  const whole = describeCluster(samples);
  if (samples.length < 10) return [whole];

  const pooled = vectorStats(samples);
  const metric = (a, b) => vectorDistance(a, b, pooled.spread);

  // Seed on the two most distant samples, so the result never depends on
  // capture order or on a random draw.
  let seedA = samples[0];
  let seedB = samples[1];
  let widest = -1;
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      const gap = metric(samples[i], samples[j]);
      if (gap > widest) { widest = gap; seedA = samples[i]; seedB = samples[j]; }
    }
  }

  let groupA = [];
  let groupB = [];
  for (let pass = 0; pass < 8; pass += 1) {
    groupA = [];
    groupB = [];
    for (const sample of samples) {
      (metric(sample, seedA) <= metric(sample, seedB) ? groupA : groupB).push(sample);
    }
    if (!groupA.length || !groupB.length) return [whole];
    const nextA = vectorStats(groupA).center;
    const nextB = vectorStats(groupB).center;
    const settled = metric(nextA, seedA) < 1e-6 && metric(nextB, seedB) < 1e-6;
    seedA = nextA;
    seedB = nextB;
    if (settled) break;
  }

  // Both shapes must be properly attested.
  const MIN_SAMPLES = 4;
  if (groupA.length < MIN_SAMPLES || groupB.length < MIN_SAMPLES) return [whole];

  const first = describeCluster(groupA);
  const second = describeCluster(groupB);

  // Separation is measured against how much each cluster wobbles on its own,
  // never against the spread of the two combined. The pooled spread is widened
  // by the very bimodality being tested for, so scoring against it is circular:
  // the further apart the two shapes sit, the wider the pooled spread grows and
  // the *smaller* the gap appears. Within-cluster scatter is the honest
  // denominator, and it is what makes the test mean "these are further apart
  // than either one's own jitter".
  const within = first.spread.map((value, index) => Math.max(
    featureSpreadFloor(index),
    (value + second.spread[index]) / 2,
  ));
  const MIN_MODE_GAP = 2.2;
  if (vectorDistance(first.center, second.center, within) < MIN_MODE_GAP) return [whole];
  return [first, second];
}

/** Saved profiles predate variants, so the legacy shape is still a variant. */
function variantsOf(prototype) {
  return Array.isArray(prototype?.variants) && prototype.variants.length
    ? prototype.variants
    : [prototype];
}

function sampleParts(sample) {
  if (Array.isArray(sample)) return { features: sample, view: null };
  if (Array.isArray(sample?.features)) return { features: sample.features, view: Number.isFinite(sample.view) ? sample.view : null };
  return null;
}

function scalarStats(values) {
  const center = median(values);
  const spread = Math.max(MIN_VIEW_SPREAD, 1.4826 * (medianAbsoluteDeviation(values, center) || 0));
  const distances = values.map((value) => Math.abs(value - center) / spread);
  return {
    center,
    spread,
    // Orientation can wobble more than a landmark point, so this is a broad
    // safety rail, not a brittle exact-angle requirement.
    threshold: Math.max(2.2, Math.min(4, (Math.max(...distances) || 0) * 1.5 + 0.45)),
  };
}

/**
 * Creates five personal pose prototypes. Inputs are feature vectors generated
 * by `poseFeatures`; callers may include every captured stable frame.
 */
export function buildPoseProfile(samplesByDigit) {
  const classes = {};
  const errors = [];

  for (const digit of [1, 2, 3, 4, 5]) {
    const descriptors = (samplesByDigit?.[digit] || []).map(sampleParts)
      .filter((sample) => Array.isArray(sample?.features) && sample.features.length);
    const samples = descriptors.map((sample) => sample.features);
    if (samples.length < 5) {
      errors.push(`digit ${digit} needs at least five stable samples`);
      continue;
    }
    const { center, spread } = vectorStats(samples);
    const distances = samples.map((sample) => vectorDistance(sample, center, spread));
    const views = descriptors.map((sample) => sample.view).filter(Number.isFinite);
    // A digit may legitimately be made more than one way; three usually is.
    const variants = splitVariants(samples);
    classes[digit] = {
      center,
      spread,
      // Generous enough for small performance movement, but bounded so a
      // different digit cannot become an accepted pose merely by being noisy.
      threshold: clusterThreshold(distances),
      // Each accepted shape for this digit. The pooled centre above stays for
      // saved profiles and for callers that only read the legacy fields.
      variants,
      // Old profiles and callers that only supply vectors stay supported.
      view: views.length >= 5 ? scalarStats(views) : null,
    };
  }

  return {
    valid: errors.length === 0,
    errors,
    minSeparation: 0.11,
    classes,
  };
}

// A finger is straight when both of its joint angles are near flat. The angle
// helper returns radians over pi, so 1 is a straight joint and a fist is far
// below. Thumbs never straighten as far as fingers do, hence their own floor.
const STRAIGHT_FLOOR = 0.62;
const STRAIGHT_CEIL = 0.88;
const THUMB_STRAIGHT_FLOOR = 0.52;
const THUMB_STRAIGHT_CEIL = 0.80;

/**
 * Which fingers are straight, read directly off the feature vector.
 *
 * This is deliberately independent of calibration. The calibrated distance
 * answers "how close is this to the shape you recorded", which drifts as the
 * wrist rolls or the hand moves toward the camera; the extension pattern
 * answers "which fingers are out", which is what the sign actually is and
 * barely moves at all.
 */
export function fingerExtension(featureVector) {
  if (!Array.isArray(featureVector) || featureVector.length < 15) return null;
  const scores = [];
  for (let finger = 0; finger < 5; finger += 1) {
    const base = finger * 3;
    const straightness = Math.min(featureVector[base], featureVector[base + 1]);
    const floor = finger === 0 ? THUMB_STRAIGHT_FLOOR : STRAIGHT_FLOOR;
    const ceiling = finger === 0 ? THUMB_STRAIGHT_CEIL : STRAIGHT_CEIL;
    scores.push(Math.max(0, Math.min(1, (straightness - floor) / (ceiling - floor))));
  }
  return scores;
}

/**
 * The digit a finger pattern implies, or null when it is not decisive.
 *
 * Three is listed twice on purpose: ASL three is thumb, index and middle, and
 * the other common three is index, middle and ring. Both are three, and no
 * amount of calibration distance will tell you that — only the pattern will.
 */
const FINGER_PATTERNS = [
  { digit: 1, out: [0, 1, 0, 0, 0] },
  { digit: 2, out: [0, 1, 1, 0, 0] },
  { digit: 3, out: [1, 1, 1, 0, 0] },
  { digit: 3, out: [0, 1, 1, 1, 0] },
  { digit: 4, out: [0, 1, 1, 1, 1] },
  { digit: 5, out: [1, 1, 1, 1, 1] },
];

export function digitFromFingers(scores, margin = 0.42) {
  if (!Array.isArray(scores) || scores.length !== 5) return null;
  let best = null;
  let bestScore = -Infinity;
  let runnerUp = -Infinity;
  for (const pattern of FINGER_PATTERNS) {
    // Agreement with the pattern: extended fingers should score high and
    // folded ones low, so a mismatch on either side counts against it.
    // A closed fist agrees with "one" on four of its five fingers, so the
    // fingers the pattern says are out must genuinely be out before the
    // average is worth anything at all.
    let score = 0;
    let weakestExtended = 1;
    for (let finger = 0; finger < 5; finger += 1) {
      score += pattern.out[finger] ? scores[finger] : 1 - scores[finger];
      if (pattern.out[finger]) weakestExtended = Math.min(weakestExtended, scores[finger]);
    }
    score /= 5;
    if (weakestExtended < 0.5) continue;
    if (score > bestScore) { runnerUp = bestScore; bestScore = score; best = pattern.digit; }
    else if (score > runnerUp) runnerUp = score;
  }
  // Decisive only when the winning pattern is clearly ahead and actually good.
  if (bestScore < 0.78 || bestScore - runnerUp < (1 - margin) * 0.08) return null;
  return best;
}

/** Returns a candidate on every frame; `accepted` is the safety gate. */
export function classifyPose(profile, featureVector, view = null) {
  if (!profile?.valid || !Array.isArray(featureVector)) {
    return { digit: null, accepted: false, confidence: 0, reason: "profile-unavailable" };
  }
  const candidates = Object.entries(profile.classes)
    .filter(([, prototype]) => prototype.center.length === featureVector.length)
    .map(([digit, prototype]) => {
      // A digit matches if ANY of its shapes matches. Scoring the best variant
      // rather than a pooled average is what lets three be made two ways
      // without widening the class enough to swallow two or four.
      let best = null;
      variantsOf(prototype).forEach((variant, index) => {
        if (!Array.isArray(variant?.center) || variant.center.length !== featureVector.length) return;
        const distance = vectorDistance(featureVector, variant.center, variant.spread);
        if (!best || distance < best.distance) {
          best = { distance, threshold: variant.threshold ?? prototype.threshold, variant: index };
        }
      });
      if (!best) return null;
      return { digit: Number(digit), distance: best.distance, threshold: best.threshold, variant: best.variant };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return { digit: null, accepted: false, confidence: 0, reason: "feature-width" };

  const [best, second = { distance: Infinity }] = candidates;
  const separation = (second.distance - best.distance) / Math.max(second.distance, 0.001);
  const viewProfile = profile.classes?.[best.digit]?.view;
  const viewDistance = viewProfile && Number.isFinite(view)
    ? Math.abs(view - viewProfile.center) / Math.max(MIN_VIEW_SPREAD, viewProfile.spread)
    : null;
  const viewAccepted = viewDistance == null || viewDistance <= viewProfile.threshold * 1.35;
  // Also relax profiles already saved with the previous, fingertip-heavy
  // classifier so people do not have to repeat calibration.
  const effectiveThreshold = best.threshold * 1.22;
  const withinCalibration = best.distance <= effectiveThreshold;
  // Geometry gets a vote when the calibrated distance is marginal. The pattern
  // of straight fingers is what the sign *is*, and it survives the wrist roll
  // and camera distance that push a hand outside its recorded envelope. It can
  // only rescue a pose that is already nearest and already close — it never
  // overrides the winner, and it cannot reach a pose that is plainly wrong.
  const fingers = fingerExtension(featureVector);
  const patternDigit = digitFromFingers(fingers);
  const patternRescue = !withinCalibration
    && patternDigit === best.digit
    && best.distance <= effectiveThreshold * 1.5;
  const inClass = withinCalibration || patternRescue;
  const separated = separation >= Math.min(profile.minSeparation ?? 0.11, 0.11);
  const confidence = Math.max(0, Math.min(1,
    (1 - best.distance / Math.max(effectiveThreshold, 0.001)) * 0.6 + Math.min(1, separation / 0.35) * 0.4,
  ));

  const calibrationAccepted = inClass && separated && viewAccepted;

  // When calibration is going to reject the frame outright and the fingers are
  // unambiguous, the choice is between nothing and the geometry's answer — so
  // take the geometry. This is the case a per-digit prototype cannot reach at
  // all: a performer who calibrated three as thumb-index-middle and then makes
  // it as index-middle-ring lands nearest to *two*, at three and a half times
  // its threshold, and the sign is simply lost. The pattern reads it correctly
  // without having been told anything.
  //
  // It can only ever replace a rejection, never a calibrated accept, so a good
  // profile is always in charge of its own digits.
  if (!calibrationAccepted && patternDigit != null && patternDigit !== best.digit) {
    const overrideView = profile.classes?.[patternDigit]?.view;
    const overrideViewOk = !overrideView || !Number.isFinite(view)
      || Math.abs(view - overrideView.center) / Math.max(MIN_VIEW_SPREAD, overrideView.spread)
        <= overrideView.threshold * 1.35;
    if (overrideViewOk) {
      return {
        digit: patternDigit,
        accepted: true,
        // Deliberately below a calibrated accept: this is a rescue, and the
        // rest of the pipeline should treat it as the weaker evidence it is.
        confidence: 0.45,
        variant: 0,
        distance: best.distance,
        separation,
        viewDistance,
        threshold: best.threshold,
        effectiveThreshold,
        thresholdRatio: best.distance / Math.max(effectiveThreshold, 0.001),
        inClass: false,
        separated,
        viewAccepted: true,
        candidates,
        fingers,
        patternDigit,
        patternRescue: true,
        patternOverride: true,
        reason: "finger-pattern",
      };
    }
  }

  return {
    digit: best.digit,
    accepted: calibrationAccepted,
    confidence,
    // Which shape of that digit matched, for the diagnostics bus.
    variant: best.variant ?? 0,
    distance: best.distance,
    separation,
    viewDistance,
    threshold: best.threshold,
    effectiveThreshold,
    thresholdRatio: best.distance / Math.max(effectiveThreshold, 0.001),
    inClass,
    separated,
    viewAccepted,
    candidates,
    fingers,
    patternDigit,
    patternRescue,
    reason: !inClass ? "outside-calibration" : !separated ? "ambiguous-pose" : !viewAccepted ? "wrong-hand-side" : patternRescue ? "finger-pattern" : "accepted",
  };
}
