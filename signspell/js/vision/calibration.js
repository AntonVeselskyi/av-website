import { median, percentile } from "./landmarks.js?v=3";
import { buildPoseProfile } from "./pose-classifier.js?v=5";
import { buildContactProfile } from "./contacts.js?v=5";

export const CALIBRATION_SCHEMA_VERSION = 3;
const LEGACY_SCHEMA_VERSION = 1;
const TRANSLATION_SCHEMA_VERSION = 2;

function thresholdProfile(strokeTrials = []) {
  const valid = strokeTrials.filter((trial) => Number.isFinite(trial?.strokeVelocity));
  const rests = valid.map((trial) => Math.abs(trial.restVelocity ?? 0));
  const strikes = valid.map((trial) => trial.strokeVelocity).filter((value) => value > 0);
  const displacements = valid.map((trial) => trial.displacement).filter((value) => value > 0);
  if (valid.length < 5 || strikes.length < 5 || displacements.length < 5) {
    return { valid: false, error: "five downward-stroke trials are required" };
  }
  const neutralVelocity = Math.max(0.06, (percentile(rests, 0.95) ?? 0) * 1.35);
  const strokeVelocity = Math.max(neutralVelocity + 0.12, (percentile(strikes, 0.15) ?? 0.75) * 0.7);
  const minDisplacement = Math.max(0.018, (percentile(displacements, 0.15) ?? 0.04) * 0.5);
  const readyVerticalities = valid.map((trial) => trial.readyVerticality).filter(Number.isFinite);
  const hitVerticalities = valid.map((trial) => trial.hitVerticality).filter(Number.isFinite);
  const tiltCalibrated = readyVerticalities.length >= 5 && hitVerticalities.length >= 5;
  const readyVerticality = tiltCalibrated ? Math.max(0.45, percentile(readyVerticalities, 0.15) - 0.035) : null;
  const hitVerticality = tiltCalibrated ? Math.min(0.62, percentile(hitVerticalities, 0.85) + 0.045) : null;
  if (tiltCalibrated && readyVerticality - hitVerticality < 0.16) {
    return { valid: false, error: "upright and sideways hand positions need more separation" };
  }
  return {
    valid: true,
    metric: tiltCalibrated ? "palm-tilt" : "screen-y",
    neutralVelocity: tiltCalibrated ? Math.max(0.16, neutralVelocity) : neutralVelocity,
    strokeVelocity: tiltCalibrated ? Math.max(0.55, strokeVelocity * 0.72) : strokeVelocity,
    minDisplacement,
    recoveryDisplacement: Math.max(0.015, minDisplacement * 0.8),
    readyVerticality,
    hitVerticality,
    lockedMissingReleaseMs: tiltCalibrated ? 190 : 320,
    // retained for calibration diagnostics without becoming a runtime gate
    medianStrikeVelocity: median(strikes),
  };
}

/**
 * Creates a JSON-only, versioned profile. Input samples must already be
 * landmark-derived features/distances, never pixels or webcam frames.
 */
export function buildCalibrationProfile({ handedness, poseSamples, contactSamples, strokeTrials, createdAt = Date.now() }) {
  const pose = buildPoseProfile(poseSamples);
  const contacts = buildContactProfile(contactSamples);
  const downstroke = thresholdProfile(strokeTrials);
  const errors = [...pose.errors, ...contacts.errors];
  if (!downstroke.valid) errors.push(downstroke.error);
  const completed = {
    pose: Object.fromEntries([1, 2, 3, 4, 5].map((digit) => [digit, Boolean(pose.classes?.[digit])])),
    contact: Object.fromEntries([6, 7, 8, 9].map((digit) => [digit, Boolean(contacts.contacts?.[digit])])),
    downstroke: Boolean(downstroke.valid),
  };
  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    createdAt,
    handedness: String(handedness).toLowerCase() === "left" ? "left" : "right",
    valid: errors.length === 0,
    errors,
    // This lets the UI retry only incomplete gestures. Successful entries
    // remain usable calibration data even while the whole profile is pending.
    completed,
    pose,
    contacts,
    downstroke: downstroke.valid ? downstroke : null,
  };
}

export function isCalibrationProfile(value) {
  return Boolean(value
    && [CALIBRATION_SCHEMA_VERSION, TRANSLATION_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION].includes(value.schemaVersion)
    && (value.handedness === "left" || value.handedness === "right")
    && value.pose?.valid
    && value.contacts?.valid
    && value.downstroke?.valid !== false);
}

/** Payload helpers deliberately leave persistence policy (e.g. IndexedDB) to the app. */
export function calibrationToStorage(profile) {
  if (!isCalibrationProfile(profile)) throw new Error("Cannot store an invalid calibration profile");
  return JSON.stringify(profile);
}

export function calibrationFromStorage(payload) {
  try {
    const profile = typeof payload === "string" ? JSON.parse(payload) : payload;
    return isCalibrationProfile(profile) ? profile : null;
  } catch {
    return null;
  }
}
