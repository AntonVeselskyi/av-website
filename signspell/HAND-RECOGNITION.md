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
| Three only the way you calibrated it | **fixed** | geometry overrides a rejection |
| Hand lost mid-sign on 1–5 | **fixed for drift** | distance gave up; geometry did not |
| Hand lost to dropouts or blur | **not a fault** | measured healthy, see below |
| Fast repeated notes dropped | **fixed to 140ms** | recovery needed frames it never had |

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

The remaining 180ms limit was written up here as the arm gate. That was wrong,
and tracing it later disproved it — see below.

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

### Geometry as a second opinion (pose-classifier.js)

Before adding anything, three hypotheses about the remaining hand loss were
measured and all three were wrong. The downstroke path is healthy:

- **Dropouts.** A hand lost mid-strike still fires the note for gaps up to about
  270ms at both 30fps and 60fps, and dropouts while resting produce no spurious
  hits. `markMissing` clears its state correctly on the hand's return, so a
  flickering hand does not accumulate a phantom gap.
- **Motion blur.** A strike still fires the correct digit when the pose stops
  being accepted mid-strike, down to a confidence of 0.05, and even when a
  *different* digit becomes nearest for those frames. `poseGraceMs` works.
- **Tremor.** Arming survives a hand shake of 0.022 in palm units at 6Hz, far
  beyond a steady hand.

So what remains is classification, and specifically the case a calibrated
distance cannot handle: the hand moving toward or away from the camera while
making the *same* sign. That changes every fingertip distance in the feature
vector and pushes the pose outside its recorded envelope, even though which
fingers are out has not changed at all.

`fingerExtension` reads straightness per finger straight off the feature
vector, and `digitFromFingers` maps the pattern to a digit. It is listed twice
for three — thumb-index-middle and index-middle-ring — because that is the one
thing no calibrated distance can ever express. The reader identifies all five
signs, and both threes, with no calibration whatsoever.

It is wired in only as a rescue: a pose that is already the nearest class and
already within 1.5x of its threshold may be accepted when the finger pattern
agrees. It cannot override the winner and it cannot reach a pose that is plainly
wrong. Measured on a three held while the hand moves: the tolerated range grows
from 1.48x to 1.72x moving closer, and from 0.53x to 0.41x moving away.

One trap worth recording. A closed fist agrees with the pattern for "one" on
four fingers out of five, and scored 0.8 on it — enough to pass a naive average.
The fingers a pattern says are *out* must genuinely be out before the average
means anything, so the weakest extended finger now gates the whole match. The
fist reads as nothing, which is correct.

### The recovery clock again, at speed (downstroke.js)

The note above blamed the remaining 180ms wall on the arm gate. Tracing a 160ms
performance disproved that immediately: the state machine never reaches `neutral`
at all, so the arm gate is never consulted. It sits in `awaiting-recovery` for
the entire run.

The recovery clock was still the wall, one level deeper than the last fix. The
clock starts at the *first* upward frame and then wants another 52ms, so the
player must keep travelling upward for 52ms after they have already come back.
A fast upstroke lasts about 60ms in total, so the requirement cannot be met and
the note never releases.

The clock exists so a single twitch cannot end a note early, and the frame count
already covers that. A hand that has come a long way back up has finished its
stroke, and waiting out a clock cannot make that more true. So the recovery may
now also complete on displacement: two frames of upward motion plus a return of
two and a half times the recovery threshold releases the stroke immediately.

Measured, with a fixed strike and return and only the gap between notes varying:

| period | 30fps before | 30fps after | 60fps before | 60fps after |
| --- | --- | --- | --- | --- |
| 180ms | 1/10 | 6/10 | 1/10 | 10/10 |
| 160ms | 1/10 | 6/10 | 1/10 | 9/10 |

At 60fps the cliff moves from 180ms to 150ms. At 30fps the same band improves
but does not clear: a 70ms strike and a 70ms return sampled every 33ms is about
four frames for the whole gesture, and the recovery needs two of them to be
upward. That is a sampling limit rather than a threshold, and it will not yield
to tuning.

Deliberate playing is unchanged at exactly one note per strike from 400ms to
900ms, and long lazy strokes do not double fire.

**A measurement trap worth recording.** The first sweep for this change scaled
the strike duration with the note period, which made a 900ms note a 342ms strike
— too slow to exceed the stroke velocity at all. It reported zero hits at slow
tempos and looked like a severe regression, and it also flattered the fast end.
Strike duration is roughly constant for a player; only the rest between notes
varies. The table above uses a fixed strike, which is both realistic and
comparable with the earlier measurements.

### Velocity as recovery evidence (downstroke.js)

The note above closed by saying the 30fps limit was a sampling problem needing
either a faster camera or a recovery test that could work from one frame's
velocity. It was the second one.

The recogniser already computes a smoothed velocity. A decisive upward whip is
as much evidence that a stroke is over as two frames of displacement are, and
unlike them it exists when the camera is slow. Recovery now also completes on a
single frame whose velocity is at least 60% of the stroke threshold upward, with
the hand back past the recovery displacement.

| period | 30fps before | 30fps after |
| --- | --- | --- |
| 180ms | 6/10 | 10/10 |
| 160ms | 6/10 | 10/10 |
| 150ms | 1/10 | 10/10 |
| 140ms | 1/10 | 10/10 |

The 30fps cliff moves from 180ms to 125ms, and 60fps now carries every period
down to 110ms, the end of the sweep. A 140ms period is sixteenths at 107bpm.

The velocity floor is what keeps this safe. It sits far above anything a resting
hand produces: a tremor at 6Hz with amplitudes up to 0.014 in palm units, plus
random noise, releases nothing at all across 300 frames. Deliberate playing is
still exactly one note per strike from 400ms to 900ms, a single strike still
produces exactly one note, and the dropout and motion-blur behaviour measured
earlier is unchanged — gaps up to eight frames still fire, and a strike still
reports the right digit with pose confidence down to 0.05.

### Geometry may overrule a rejection (pose-classifier.js)

The rescue added earlier only fires when the pattern agrees with the nearest
calibrated candidate. That leaves the case it was most needed for untouched: a
performer who calibrated three as thumb-index-middle and then makes it as
index-middle-ring lands nearest to **two**, at three and a half times its
threshold. The pattern reads three correctly, but it was never consulted because
it disagreed with the winner.

So when calibration is going to reject the frame outright and the fingers are
unambiguous, the pattern's answer is taken. The choice there is between nothing
and the geometry, never between the geometry and a good calibrated match — an
override can only ever replace a rejection, so a healthy profile stays in charge
of its own digits. The result carries a deliberately lower confidence, because
it is weaker evidence and the rest of the pipeline should treat it that way.

Measured: whichever three is calibrated, both are now playable — the calibrated
one through calibration at 0.96 confidence, the other through the override at
0.45. Digits one, two, four and five are untouched and still resolve through
calibration. A fist is still nothing.

**A known trade-off, measured rather than argued.** A half-made shape between
two signs can pattern as a clean digit, because half-bent fingers genuinely read
as folded, and no static test can separate that from a real sign. The protection
is temporal and already exists: a pose alone never makes a note. Morphing from
one to three at rest produces zero notes; the same morph with a deliberate
strike produces exactly one, on the correct digit. If spurious notes ever do
appear on transitions, the fix belongs in the stabilizer — promoting an override
only after several consistent frames — not in the classifier.

### Geometry vouches for a held sign (pose-stabilizer.js)

Holding a three while a neighbouring finger creeps out and back still lost the
hand: 81 frames of 90 with the pinky drifting toward four, and 72 of 90 with the
ring relaxing toward two. Two distinct causes, only one of them a fault.

The genuine one: separation collapsing to 0.008, where the two nearest classes
are equally distant. Dropping there is correct — nothing can tell them apart.
The fault: a frame at ratio 1.71 against an allowance of 1.658, missing by five
hundredths, while the finger pattern still read three perfectly clearly.

The stabilizer had never been shown the pattern. It is now: while the pattern
still reads the held digit, the sign survives a distance the calibrated envelope
has given up on — including the case where the *nearest calibrated class has
become the wrong one*, which the previous separation floor could never allow.
No separation floor is needed on that path, because the pattern supplies exactly
the disambiguation separation was there to measure.

It cannot strand a stale digit, and that is the point: the pattern is its own
guard. When the performer really changes sign the pattern changes with them and
the hold ends on that frame.

| holding a three while | before | after |
| --- | --- | --- |
| the pinky creeps toward four | 81/90 | 90/90 |
| the ring relaxes toward two | 72/90 | 90/90 |
| the middle relaxes toward one | — | 88/90 |

And a real change of sign still switches within a frame or two: three is let go
at frame 6 and two arrives at 7, four at 19 after 18, five at 19 after 17.

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
- **Work before calibration at all.** The pattern reader is accurate enough
  standalone, but `SignSpellRecognizer.observe` returns `calibration-required`
  before the classifier is ever reached, so this needs the recogniser to run a
  provisional path with default stroke thresholds — a change to the app's
  gating, not just the classifier.
- **Below about 125ms at 30fps the strike itself is the limit**, not the
  recovery: a 70ms strike sampled every 33ms is two frames, which is the
  minimum the velocity estimate needs. This is the end of what tuning can
  reach on a 30fps camera.
- The pattern now backs the classifier, the rescue, the override and the hold.
  Everything after this needs real camera traces rather than synthetic
  trajectories — the synthetic ones have stopped finding faults.

## Testing

```bash
npm --prefix signspell test
```

Node 18+ is required (`node --test`). The variant behaviour is covered in
`tests/vision/recognition.test.mjs`: two shapes learned, one shape not split,
neighbours unaffected, and legacy profiles still classifying.
