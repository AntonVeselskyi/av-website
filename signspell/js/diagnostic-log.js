const DEFAULT_LIMIT = 140;

function clean(value, maxLength = 180) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function timeStamp(now) {
  const date = new Date(now);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/**
 * Small local-only event buffer for support diagnostics. It deliberately accepts
 * summary strings only: callers must never pass frames, landmarks, or media URLs.
 */
export class DiagnosticLog {
  constructor({ limit = DEFAULT_LIMIT, now = () => Date.now(), onChange = () => {} } = {}) {
    this.limit = Math.max(1, Math.floor(limit));
    this.now = now;
    this.onChange = onChange;
    this.entries = [];
    this.lastAt = new Map();
    this.lastState = new Map();
  }

  add(channel, detail, { key = `${channel}:${detail}`, throttleMs = 0 } = {}) {
    const current = this.now();
    const safeChannel = clean(channel, 32).toUpperCase() || "SYSTEM";
    const safeDetail = clean(detail);
    if (!safeDetail) return false;
    const previous = this.lastAt.get(key) ?? -Infinity;
    if (throttleMs > 0 && current - previous < throttleMs) return false;
    this.lastAt.set(key, current);
    this.entries.push(`[${timeStamp(current)}] ${safeChannel.padEnd(7, " ")} ${safeDetail}`);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    this.onChange(this.text());
    return true;
  }

  state(channel, value, { key = channel } = {}) {
    const safeValue = clean(value);
    if (!safeValue || this.lastState.get(key) === safeValue) return false;
    this.lastState.set(key, safeValue);
    return this.add(channel, safeValue, { key: `state:${key}` });
  }

  clear() {
    this.entries = [];
    this.lastAt.clear();
    this.lastState.clear();
    this.onChange("");
  }

  text() {
    return this.entries.join("\n");
  }
}
