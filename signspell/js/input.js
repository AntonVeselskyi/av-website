/** Physical digit mapping keeps the numpad playable even when Num Lock is off. */
export function digitFromKeyEvent(event = {}) {
  const physical = /^(?:Numpad|Digit)([1-9])$/.exec(event.code || "");
  if (physical) return Number(physical[1]);
  return /^[1-9]$/.test(event.key || "") ? Number(event.key) : null;
}

export const LOOP_PEDAL_KEYS = Object.freeze({
  KeyA: "record",
  KeyS: "transport",
  KeyD: "undo",
});

export const LOOP_PEDAL_CLEAR_HOLD_MS = 800;

/** Physical positions keep the pedal layout stable on non-QWERTY keyboards. */
export function loopPedalActionFromKeyEvent(event = {}) {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  return LOOP_PEDAL_KEYS[event.code] || null;
}
