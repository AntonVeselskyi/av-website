/** Pure note-off policy for camera-held gates. */
export function shouldReleaseVisionGate(held, diagnostic) {
  if (!held?.source?.startsWith("vision-")) return false;
  if (held.source === "vision-contact") {
    return !diagnostic?.hand?.detected
      || !diagnostic?.fingertips?.contacts?.[held.digit]?.latched;
  }
  if (held.source === "vision-downstroke") {
    return diagnostic?.downstroke?.state !== "locked";
  }
  return false;
}
