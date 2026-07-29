const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, Number(value) || 0));

/**
 * Converts derived recognition diagnostics into a continuous performer-facing
 * sign readout. Recognition and note triggering are intentionally separate:
 * a pose may be visible and READY without a downstroke having happened.
 */
export function resolveLiveGestureDebugState(diagnostic) {
  if (!diagnostic?.hand?.detected) {
    return { digit: "–", state: "NO HAND", confidence: 0, kind: "none" };
  }

  const contacts = Object.entries(diagnostic.fingertips?.contacts || {})
    .map(([digit, value]) => ({ digit: Number(digit), ...value }))
    .filter((value) => Number.isInteger(value.digit) && Number.isFinite(value.distance));
  const touching = contacts
    .filter((value) => value.phase !== "wrong-view" && (value.latched || value.withinThreshold === true))
    .sort((left, right) => left.distance - right.distance)[0] || null;
  if (touching) {
    return {
      digit: String(touching.digit),
      state: `SIGN ${touching.digit} / TOUCH`,
      confidence: clamp(Math.max(touching.intentConfidence || 0, diagnostic.hand.confidence || 0.65)),
      kind: "contact",
    };
  }

  const approaching = contacts
    .filter((value) => value.phase === "approach")
    .sort((left, right) => (right.intentConfidence || 0) - (left.intentConfidence || 0))[0] || null;
  if (approaching) {
    const eta = Number.isFinite(approaching.timeToContact) ? ` / ${Math.max(0, Math.round(approaching.timeToContact))}MS` : "";
    return {
      digit: String(approaching.digit),
      state: `SIGN ${approaching.digit} / APPROACH${eta}`,
      confidence: clamp(approaching.intentConfidence),
      kind: "approach",
    };
  }

  const pose = diagnostic.pose || {};
  if (Number.isInteger(Number(pose.digit)) && Number(pose.digit) >= 1 && Number(pose.digit) <= 5) {
    const digit = Number(pose.digit);
    const strokeState = String(diagnostic.downstroke?.state || "").toUpperCase();
    const ready = pose.accepted && (strokeState === "ARMED" || strokeState === "LOCKED");
    const reason = String(pose.reason || "uncertain");
    const issue = reason === "outside-calibration" ? "SHAPE MISMATCH"
      : reason === "ambiguous-pose" ? "BETWEEN SIGNS"
        : reason === "wrong-hand-side" ? "WRONG HAND SIDE"
          : reason.replaceAll("-", " ").toUpperCase();
    return {
      digit: pose.accepted ? String(digit) : `${digit}?`,
      state: pose.accepted
        ? `SIGN ${digit} / ${ready ? strokeState === "LOCKED" ? "HELD" : "READY – DIP" : "POSE READY"}`
        : `CLOSEST ${digit} / ${strokeState === "LOCKED" ? "HOLDING / " : ""}${issue}`,
      confidence: clamp(pose.confidence),
      kind: pose.accepted ? "pose" : "candidate",
    };
  }

  return {
    digit: "–",
    state: String(diagnostic.reason || "TRACKING").replaceAll("-", " ").toUpperCase(),
    confidence: clamp(diagnostic.hand.confidence),
    kind: "tracking",
  };
}
