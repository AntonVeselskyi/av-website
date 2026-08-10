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
| Hand lost mid-sign on 1–5 | **partly addressed** | see below |
| Fast repeated notes dropped | open | not yet investigated |

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

## Next

- **Fast repeated notes get dropped.** Suspect the stabilizer's consistency
  requirement or the downstroke recovery gate: a second strike arriving before
  the first has recovered may be swallowed. Measure the frame budget between
  two fast notes before changing any threshold.
- **Hand lost mid-sign**, remaining cases. Once variants are in use, check
  whether the losses that remain are classification (distance ratio crossing
  the threshold) or tracking (MediaPipe dropping the hand entirely) — the
  diagnostics bus distinguishes them and they need opposite fixes.
- Consider a geometric fallback keyed on which fingers are extended, for frames
  where the calibrated distance is marginal but the finger pattern is decisive.

## Testing

```bash
npm --prefix signspell test
```

Node 18+ is required (`node --test`). The variant behaviour is covered in
`tests/vision/recognition.test.mjs`: two shapes learned, one shape not split,
neighbours unaffected, and legacy profiles still classifying.
