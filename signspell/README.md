# $IGN⸸$PELL

A browser-native webcam instrument and eight-line loop workstation. It turns calibrated hand gestures into original Web Audio synthesis without uploading camera frames or bundling copyrighted samples.

## Play

Serve the repository over `localhost` or HTTPS, then open `/signspell/` in desktop Chrome or Edge. Click **ENTER THE SIGNAL** to unlock audio and grant camera access.

- Signs 1–5: show the back of the hand/knuckles to the camera, hold the calibrated number pose, then make a short downward strike. The guided poses are 1 index; 2 index + middle; 3 your consistent thumb + pointer/index shape; 4 four fingers without thumb; 5 all five.
- Signs 6–9: rotate the palm toward the camera, then touch thumb to pinky, ring, middle, or index fingertip. A release is required before the next hit.
- Keyboard 1–9 and the on-screen gesture cells provide a camera-free fallback.
- Click a loop line to select it; the outlined line receives gestures, keyboard hits, pad clicks, and generated loops.
- The selected line opens as a nine-row piano roll directly below the visualizer. Its keys preview all nine mapped notes, event blocks can be retimed, and the local controls operate that line.
- Press its record button to capture one loop pass. Recording begins immediately when stopped, or at the next bar when already playing; gesture, click a pad, or press 1–9 to add notes.
- The physical loop pedal beneath the webcam mirrors the selected line: **A** records/stops and overdubs, **S** plays/stops all loops, and **D** undoes the last take. Hold **D** for 0.8 seconds to clear and silence that line while preserving one undo.
- Conjure Loop replaces the selected line and starts playback. Clear removes and immediately silences that line; Undo restores its previous events.
- Hover any button for 1.5 seconds to see what it does. Use OVR, mute, solo, length, gain, and draggable event blocks for further editing.
- Harmony Lock confines every gesture to the active chord. Safe Scale and Free Gamma expose wider note sets.
- 808 gestures use a dedicated scale-safe sub layout between C1 and G2; they do not climb into G3. Changing a collection or instrument while playing immediately revoices the selected line.
- WAV export renders the current loops with the same native synthesizers used for live playback.

## Sound collections

The four collections are original, sample-free mood palettes inspired by emo trap, horror trap, intimate distorted rap, and industrial trap. Artist names in the selector describe creative reference points only; the app does not claim endorsement or reproduce signature recordings.

## Recognition and privacy

MediaPipe Hand Landmarker runs in a module worker. The first camera use downloads the pinned vision runtime and hand model; after that, recognition is performed in-browser. Calibration stores only derived numeric thresholds and pose statistics in IndexedDB (with localStorage fallback), never images or video frames.

Calibration is saved per pose and per contact phase. A failed section can be retried without repeating sections that already passed, and an unfinished draft resumes after reloading the page.

The hand terminal continuously shows local-only diagnostics for hand presence, camera-facing orientation, thumb-to-fingertip distances, nearest contact, pose state, and vision latency—even before a calibration profile exists. During calibration the existing webcam view and diagnostic bus move into the dialog, then return to the hand terminal when it closes.

Each calibration checkpoint completes on its own timer and is validated independently. Number poses require a steady, consistent knuckles-facing view; contact phases require the opposite palm-facing view and a measurable open/touch gap. Failure messages identify the specific condition to retry while keeping passed checkpoints.

Live notes use press/release gates: keyboard digits and numpad keys sustain until key-up, signs 6–9 sustain while the calibrated thumb contact remains closed, and signs 1–5 sustain from a downward strike until the hand recovers upward. Recorded notes retain the measured held duration; tonal instruments release smoothly while percussion remains a deliberate one-shot.

## Tests

With Node 22 or newer:

```sh
npm --prefix signspell test
```

The suite covers tonal safety, loop scheduling, WAV encoding, project migration, pose classification, fingertip contacts, downstroke recovery, and worker replay.
