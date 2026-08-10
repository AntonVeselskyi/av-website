# Hand recognition — working notes

Running notes on the 1–5 sign path: how it works, what is wrong with it, and
what each increment changed. Kept alongside the code because the failure modes
here are subtle and easy to re-introduce.

## The path a sign takes

```
camera frame
  -> MediaPipe hand landmarker            (js/vision/vision-worker.js)
  -> normalizeLandmarks                   (js/vision/landmarks.js)
       rotates into palm-local space, mirrors a left hand to right chirality
  -> poseFeatures                         15 numbers: per finger, two joint
                                          angles and one fingertip distance
  -> classifyPose                         (js/vision/pose-classifier.js)
       weighted distance to a calibrated prototype, per digit
  -> PoseStabilizer                       (js/vision/pose-stabilizer.js)
  -> DownstrokeRecognizer                 (js/vision/downstroke.js)
       a held pose only becomes a note on a downward strike
  -> note
```

Angles are weighted 1.55 and fingertip positions 0.22, because MediaPipe guesses
a curled fingertip's position when the knuckles hide it, while the joint angles
stay trustworthy. Recognition leans on which fingers are *straight*.

## Known failure modes

| Symptom | Status | Cause |
| --- | --- | --- |
| Three can only be made one way | **fixed** | one prototype per digit |
| Hand lost mid-sign on 1–5 | **improved** | held signs dropped on drift alone |
| Fast repeated notes dropped | **improved** | recovery clock missed by 3ms |

## Increment log

### Multi-shape digits (pose-classifier.js)

A digit is no longer a single prototype. `classes[digit].variants` holds one or
more shapes, and a frame matches the digit if it matches *any* of them.

Why this was needed: three is genuinely made two ways — ASL three is thumb,
index and middle; the other common three is index, middle and ring. Averaging
those into one prototype is worse than picking either, because the centre lands
on a shape nobody makes and the spread widens to cover both. The class then
*simultaneously* stops accepting the real poses and starts bleeding into its
neighbours. That is also why this helps the "loses my hand" symptom: measured on
a two-shape three, matching a variant instead of the pooled centre took the
distance ratio from 0.26 to 0.06, roughly four times more headroom before a
drifting hand falls outside the class.

Variants are discovered automatically during calibration by two-means over the
captured samples, seeded deterministically from the furthest-apart pair so the
result never depends on capture order. To make three work both ways, perform
both shapes while capturing three; a digit performed one way stays one variant.

Two mistakes worth not repeating, both found by measuring rather than reading:

- **Separation must be measured against within-cluster scatter, never the
  pooled spread.** The pooled spread is widened by the very bimodality being
  tested for, so scoring against it is circular — the further apart the two
  shapes sit, the wider the pooled spread grows and the *smaller* the measured
  gap becomes. With two clearly distinct shapes this reported a gap of 0.85
  against a threshold of 1.6 and refused to split.
- **A "does the split tighten the class" test does not work**, because the
  acceptance radius clamps at a floor of 1.35. For any reasonably tight cluster
  both sides sit exactly on the floor, so `1.35 >= 1.35` always held and the
  split was always discarded.

Backward compatible: profiles saved before variants existed have no `variants`
array and are treated as a single variant, so nobody has to recalibrate.

### Fast repeated notes (downstroke.js)

Measured before touching anything, by driving `DownstrokeRecognizer` with a
synthetic performer at a sweep of note periods. The failure was not gradual: at
a 250ms period all eight notes registered, and at 220ms **one** did. It fired
once and then never re-armed.

Tracing the state machine showed why, and it was not what the constants suggest.
The recogniser sat in `awaiting-recovery` forever. `recoveryFrames` reached its
required three on every upstroke — but `recoverySince` starts at the *first*
qualifying frame and the gate then wants another 70ms, so elapsed came to 67ms
and missed by three. The hand began its next descent, the counter reset, and the
same near-miss repeated every cycle. A gate that is 3ms short is indistinguishable
from a gate that is broken.

Two changes, both sized to what a fast upstroke actually affords:

- `recoveryMs` 70 -> 52. The clock starts at the first upward frame, so it is
  already several frames into the recovery before it begins counting.
- The arm-relative recovery target moves from `armY + minDisplacement * 0.35` to
  `* 0.5`. The old target sat just below where the smoother reaches on a quick
  upstroke, so frames counted only intermittently.

Result at both 30fps and 60fps: the cliff moves from a 220ms period to 180ms.
A 200ms period went from 1 note in 8 to 8 in 8. Slow deliberate playing is
unchanged at exactly one note per strike, and long lazy strokes do not double
fire.

Also fixed while in there: the evidence gates read `N frames AND M milliseconds`,
which looks like belt and braces but is not. At 30fps three frames is 100ms, so
the frame count silently overrode the millisecond budget and every gate waited
43% longer than designed. The count is now capped at what the time window
affords — never below two, so one noisy sample still cannot satisfy a gate, and
never above the configured count, so a fast camera keeps all the evidence it can
afford. On its own this moved nothing at 30fps, which is how the recovery clock
turned out to be the real blocker; it does help at 60fps and it removes an
unintended frame-rate dependence.

The remaining 180ms limit is no longer obviously a tuning fault. At that period a
70ms strike plus a 70ms return leaves 40ms of rest, and the arm gate alone wants
`stableMs` 65. Going faster needs the arm gate reconsidered, not nudged.

### Holding a sign through drift (pose-stabilizer.js)

Measured by driving a ring finger slowly out of a three and back — the ordinary
droop that happens while holding a sign — through `classifyPose` into the
stabilizer. The hold broke for 22 of 90 frames, about three quarters of a second
at 30fps, which is exactly the reported symptom.

The reason was not what it looked like. There were no `ambiguous-pose` frames at
all: the hold was released purely because the distance ratio crossed 1.55, while
the runner-up was still 32% further away. Nothing was competing for that frame.
The hand had simply moved.

Distance and separation answer different questions. Distance says how far the
hand has wandered from the calibrated shape; separation says how sure we are it
is still *this* sign rather than another. A fixed distance limit discards a sign
on drift alone even when it is unmistakably the only candidate. The hold
allowance now grows with the separation margin, capped at 2.25, so a sign with
a clear field may drift much further while a sign in a crowded field is held to
the original limit.

This is safe because the held digit must still be the nearest class. Changing
sign makes another digit nearest, which releases the hold on the same frame
regardless of the allowance.

Measured after: the drift holds for 90 of 90 frames; drifting the whole way into
a neighbouring sign is still not held (0 of 10 frames at the peak); and a
deliberate change of sign still releases and re-enters on the new digit.

## Next

- **Below a 180ms note period the arm gate is the wall.** `stableMs` 65 must
  elapse at rest before a strike can arm, which a genuinely fast performance
  never provides. Consider arming on a settled *velocity* rather than a settled
  dwell, so a player who never fully stops can still re-arm.
- **Hand loss from tracking**, not classification. The classification side has
  now been addressed twice; what remains is MediaPipe dropping the hand
  outright. `markMissing` already carries an armed strike across a dropout —
  check against the diagnostics bus whether real losses are landing there or in
  the `maxReacquireMs` timeout.
- Consider a geometric fallback keyed on which fingers are extended, for frames
  where the calibrated distance is marginal but the finger pattern is decisive.

## Testing

```bash
npm --prefix signspell test
```

Node 18+ is required (`node --test`). The variant behaviour is covered in
`tests/vision/recognition.test.mjs`: two shapes learned, one shape not split,
neighbours unaffected, and legacy profiles still classifying.
