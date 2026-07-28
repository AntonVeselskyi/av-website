/**
 * Landmark utilities shared by the worker and deterministic replays.
 * Input points are MediaPipe-compatible `{x, y, z}` values. All exported
 * calculations are pure so callers can record/replay landmark traces without
 * retaining camera frames.
 */

export const HAND = Object.freeze({
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
});

export const CONTACT_DIGITS = Object.freeze({
  6: HAND.PINKY_TIP,
  7: HAND.RING_TIP,
  8: HAND.MIDDLE_TIP,
  9: HAND.INDEX_TIP,
});

const FINGERS = [
  [HAND.THUMB_MCP, HAND.THUMB_IP, HAND.THUMB_TIP],
  [HAND.INDEX_MCP, HAND.INDEX_PIP, HAND.INDEX_DIP, HAND.INDEX_TIP],
  [HAND.MIDDLE_MCP, HAND.MIDDLE_PIP, HAND.MIDDLE_DIP, HAND.MIDDLE_TIP],
  [HAND.RING_MCP, HAND.RING_PIP, HAND.RING_DIP, HAND.RING_TIP],
  [HAND.PINKY_MCP, HAND.PINKY_PIP, HAND.PINKY_DIP, HAND.PINKY_TIP],
];

const EPSILON = 1e-8;

function point(value) {
  return [Number(value?.x) || 0, Number(value?.y) || 0, Number(value?.z) || 0];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a, multiplier) {
  return [a[0] * multiplier, a[1] * multiplier, a[2] * multiplier];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(a) {
  return Math.sqrt(dot(a, a));
}

function unit(a, fallback = [1, 0, 0]) {
  const magnitude = length(a);
  return magnitude > EPSILON ? scale(a, 1 / magnitude) : fallback;
}

function distance(a, b) {
  return length(sub(a, b));
}

function midpoint(a, b) {
  return scale(add(a, b), 0.5);
}

function angle(a, b, c) {
  const first = unit(sub(a, b));
  const second = unit(sub(c, b));
  return Math.acos(Math.max(-1, Math.min(1, dot(first, second)))) / Math.PI;
}

/**
 * Rotates a hand into palm-local coordinates and mirrors a selected left hand
 * to the same chirality as a right hand. `selectedHandedness` comes from the
 * user calibration choice, not an assumed camera mirroring convention.
 */
export function normalizeLandmarks(landmarks, selectedHandedness = "right") {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null;

  const raw = landmarks.map(point);
  const wrist = raw[HAND.WRIST];
  const indexMcp = raw[HAND.INDEX_MCP];
  const pinkyMcp = raw[HAND.PINKY_MCP];
  const middleMcp = raw[HAND.MIDDLE_MCP];
  const lateral = unit(sub(indexMcp, pinkyMcp));
  const forwardUnprojected = sub(middleMcp, wrist);
  const forward = unit(sub(forwardUnprojected, scale(lateral, dot(forwardUnprojected, lateral))), [0, 1, 0]);
  const normal = unit(cross(lateral, forward), [0, 0, 1]);
  const palmCenter = midpoint(indexMcp, pinkyMcp);
  const palmScale = Math.max(distance(wrist, palmCenter), EPSILON);
  const mirror = String(selectedHandedness).toLowerCase() === "left" ? -1 : 1;

  const points = raw.map((value) => {
    const delta = scale(sub(value, wrist), 1 / palmScale);
    return [dot(delta, lateral) * mirror, dot(delta, forward), dot(delta, normal) * mirror];
  });

  return {
    points,
    raw,
    palmScale,
    palmScreenY: [HAND.WRIST, HAND.INDEX_MCP, HAND.MIDDLE_MCP, HAND.RING_MCP, HAND.PINKY_MCP]
      .reduce((total, index) => total + raw[index][1], 0) / 5,
  };
}

/** A compact, scale/rotation-normalized shape vector for calibrated poses. */
export function poseFeatures(normalized) {
  if (!normalized?.points) return null;
  const points = normalized.points;
  const palm = [0, 0.6, 0];
  const features = [];

  for (const finger of FINGERS) {
    if (finger.length === 3) {
      features.push(angle(points[HAND.THUMB_CMC], points[finger[0]], points[finger[1]]));
      features.push(angle(points[finger[0]], points[finger[1]], points[finger[2]]));
      features.push(distance(points[finger[2]], palm));
      continue;
    }
    features.push(angle(points[finger[0]], points[finger[1]], points[finger[2]]));
    features.push(angle(points[finger[1]], points[finger[2]], points[finger[3]]));
    features.push(distance(points[finger[3]], palm));
  }
  return features;
}

/** Distances used for ASL-inspired thumb-to-fingertip 6–9 contacts. */
export function contactDistances(normalized) {
  if (!normalized?.points) return null;
  const thumb = normalized.points[HAND.THUMB_TIP];
  return Object.fromEntries(Object.entries(CONTACT_DIGITS).map(([digit, tip]) => [digit, distance(thumb, normalized.points[tip])]));
}

export function rawPalmScreenY(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null;
  return [HAND.WRIST, HAND.INDEX_MCP, HAND.MIDDLE_MCP, HAND.RING_MCP, HAND.PINKY_MCP]
    .reduce((total, index) => total + (Number(landmarks[index]?.y) || 0), 0) / 5;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, p * (sorted.length - 1)));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function medianAbsoluteDeviation(values, center = median(values)) {
  return median(values.map((value) => Math.abs(value - center)));
}
