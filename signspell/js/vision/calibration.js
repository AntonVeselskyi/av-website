import { median, percentile } from "./landmarks.js";
import { buildPoseProfile } from "./pose-classifier.js";
import { buildContactProfile } from "./contacts.js";

export const CALIBRATION_SCHEMA_VERSION = 1;

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
  return {
    valid: true,
    neutralVelocity,
    strokeVelocity,
    minDisplacement,
    recoveryDisplacement: Math.max(0.015, minDisplacement * 0.8),
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
  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    createdAt,
    handedness: String(handedness).toLowerCase() === "left" ? "left" : "right",
    valid: errors.length === 0,
    errors,
    pose,
    contacts,
    downstroke: downstroke.valid ? downstroke : null,
  };
}

export function isCalibrationProfile(value) {
  return Boolean(value
    && value.schemaVersion === CALIBRATION_SCHEMA_VERSION
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
