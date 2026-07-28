/* Delayed help for the dense instrument UI. Event delegation also covers lanes,
   gesture pads, and calibration steps created after startup. */
const WAIT = 1500;
const FOCUS_WAIT = 650;
const tooltip = document.createElement("div");
tooltip.id = "spell-hint";
tooltip.className = "spell-hint";
tooltip.role = "tooltip";
tooltip.hidden = true;
document.body.append(tooltip);

let timer = 0;
let activeTarget = null;
let pointer = { x: innerWidth / 2, y: innerHeight / 2 };

const staticHints = {
  "start-app": "Unlocks audio and opens the instrument workstation.",
  "transport-play": "Starts loop playback from the current position.",
  "transport-stop": "Stops loop playback, silences sounding tails, and returns to the first beat.",
  "tap-tempo": "Tap repeatedly to set the BPM from your rhythm.",
  "calibrate-button": "Opens the saved, step-by-step hand calibration ritual.",
  "camera-toggle": "Turns webcam hand tracking on or off. Video stays on this device.",
  "fullscreen-visualizer": "Expands the visualizer to fill the screen.",
  "generate-loop": "Writes an eerie pattern into the outlined line and starts playback immediately.",
  "export-wav": "Renders the current loops to a downloadable WAV file.",
  "reduced-motion": "Reduces moving visual effects for comfort.",
  "calibration-back": "Returns to the previous calibration checkpoint.",
  "calibration-reset": "Clears unfinished calibration captures. Your active profile remains safe.",
  "calibration-next": "Captures this calibration checkpoint, or builds the profile when complete."
};

function hintFor(target) {
  if (target.dataset.hint) return target.dataset.hint;
  if (staticHints[target.id]) return staticHints[target.id];
  if (target.matches(".visual-mode")) return `Switches the visualizer to ${target.textContent.trim().toLowerCase()} mode.`;
  if (target.matches(".dialog-close")) return "Closes this dialog without discarding already saved calibration sections.";
  if (target.matches(".lane-select")) return "Selects and outlines this line. Gestures, keyboard digits, and Conjure Loop target the selected line.";
  if (target.matches(".lane-record")) return "Records three loop passes: immediately if stopped, or from the next bar if playing. Each pass folds into the same editable loop; press again to stop early.";
  if (target.matches(".lane-overdub")) return "Keeps existing events and adds a new recording pass on top.";
  if (target.matches(".lane-mute")) return "Silences this line during playback without deleting its events.";
  if (target.matches(".lane-solo")) return "Plays only this line while solo is active.";
  if (target.matches(".lane-undo")) return "Restores this line to the state before its latest record or clear pass.";
  if (target.matches(".lane-clear")) return "Immediately silences this line and removes all its events. Undo restores the previous event pass.";
  if (target.matches(".lane-events")) return "Shows recorded hits. Drag a hit left or right to change its timing.";
  if (target.matches(".loop-event")) return "Recorded note. Drag it left or right to retime it, or press Delete to remove it.";
  if (target.matches(".focused-roll-key")) return `Plays gesture ${target.closest(".focused-roll-row")?.dataset.digit || target.textContent.trim()} on the selected line.`;
  if (target.matches(".focused-roll-event")) return "Selected-line note. Drag left or right to retime it; arrow keys change timing or note, and Delete removes it.";
  if (target.closest("#gesture-map")) return `Plays gesture ${target.dataset.digit || target.textContent.trim()} as a sound preview.`;
  if (target.closest("#calibration-checklist")) return "Jumps to this saved calibration checkpoint. Passed parts do not need to be repeated.";
  if (target.matches("button")) return `${target.textContent.trim() || "This"} control.`;
  return "";
}

function position() {
  const pad = 10;
  const rect = tooltip.getBoundingClientRect();
  const maxX = innerWidth - rect.width - pad;
  const maxY = innerHeight - rect.height - pad;
  tooltip.style.left = `${Math.max(pad, Math.min(pointer.x + 14, maxX))}px`;
  tooltip.style.top = `${Math.max(pad, Math.min(pointer.y + 18, maxY))}px`;
}

function show(target) {
  const message = hintFor(target);
  if (!message || !target.isConnected) return;
  clearTimeout(timer);
  activeTarget = target;
  tooltip.textContent = message;
  tooltip.hidden = false;
  target.setAttribute("aria-describedby", tooltip.id);
  if (!Number.isFinite(pointer.x)) {
    const rect = target.getBoundingClientRect();
    pointer = { x: rect.left + rect.width / 2, y: rect.bottom };
  }
  position();
}

function hide(target = activeTarget) {
  clearTimeout(timer);
  if (target?.getAttribute("aria-describedby") === tooltip.id) target.removeAttribute("aria-describedby");
  activeTarget = null;
  tooltip.hidden = true;
}

function eligible(eventTarget) {
  return eventTarget instanceof Element ? eventTarget.closest("button, [data-hint]") : null;
}

document.addEventListener("pointermove", (event) => { pointer = { x: event.clientX, y: event.clientY }; }, { passive: true });
document.addEventListener("pointerover", (event) => {
  const target = eligible(event.target);
  if (!target || target.disabled) return;
  const from = eligible(event.relatedTarget);
  if (from === target) return;
  hide();
  timer = setTimeout(() => show(target), WAIT);
});
document.addEventListener("pointerout", (event) => {
  const target = eligible(event.target);
  if (!target || eligible(event.relatedTarget) === target) return;
  if (activeTarget === target) hide(target); else clearTimeout(timer);
});
document.addEventListener("focusin", (event) => {
  const target = eligible(event.target);
  if (!target || target.disabled) return;
  const rect = target.getBoundingClientRect();
  pointer = { x: rect.left + rect.width / 2, y: rect.bottom };
  hide();
  timer = setTimeout(() => show(target), FOCUS_WAIT);
});
document.addEventListener("focusout", (event) => {
  const target = eligible(event.target);
  if (target) hide(target);
});
window.addEventListener("resize", () => { if (!tooltip.hidden) position(); }, { passive: true });
window.addEventListener("scroll", () => { if (!tooltip.hidden) position(); }, { passive: true });
