# $IGN⸸$PELL

A browser-native webcam instrument and eight-line loop workstation. It turns calibrated hand gestures into original Web Audio synthesis without uploading camera frames or bundling copyrighted samples.

## Play

Serve the repository over `localhost` or HTTPS, then open `/signspell/` in desktop Chrome or Edge. Click **ENTER THE SIGNAL** to unlock audio and grant camera access.

- Signs 1–5: show the back of the hand/knuckles to the camera, hold the calibrated number pose, then make a short downward strike. The guided poses are 1 index; 2 index + middle; 3 your consistent thumb + pointer/index shape; 4 four fingers without thumb; 5 all five.
- Signs 6–9: rotate the palm toward the camera, then touch thumb to pinky, ring, middle, or index fingertip. A release is required before the next hit.
- Keyboard 1–9 and the on-screen gesture cells provide a camera-free fallback.
- Arm a loop line to record at the next bar; use OVR, undo, mute, solo, length, gain, clear, and draggable event blocks to edit it.
- Harmony Lock confines every gesture to the active chord. Safe Scale and Free Gamma expose wider note sets.
- WAV export renders the current loops with the same native synthesizers used for live playback.

## Sound collections

The four collections are original, sample-free mood palettes inspired by emo trap, horror trap, intimate distorted rap, and industrial trap. Artist names in the selector describe creative reference points only; the app does not claim endorsement or reproduce signature recordings.

## Recognition and privacy

MediaPipe Hand Landmarker runs in a module worker. The first camera use downloads the pinned vision runtime and hand model; after that, recognition is performed in-browser. Calibration stores only derived numeric thresholds and pose statistics in IndexedDB (with localStorage fallback), never images or video frames.

Calibration is saved per pose and per contact phase. A failed section can be retried without repeating sections that already passed, and an unfinished draft resumes after reloading the page.

## Tests

With Node 22 or newer:

```sh
npm --prefix signspell test
```

The suite covers tonal safety, loop scheduling, WAV encoding, project migration, pose classification, fingertip contacts, downstroke recovery, and worker replay.
