/** Physical digit mapping keeps the numpad playable even when Num Lock is off. */
export function digitFromKeyEvent(event = {}) {
  const physical = /^(?:Numpad|Digit)([1-9])$/.exec(event.code || "");
  if (physical) return Number(physical[1]);
  return /^[1-9]$/.test(event.key || "") ? Number(event.key) : null;
}
