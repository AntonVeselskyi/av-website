# STONKS DEFIED — Design Notes

A *Gravity Defied* tribute where every track is a real stock chart. You throttle,
brake, and shift your weight over terrain built from historical closing prices —
the dot-com bubble, the COVID crash, the GameStop squeeze — and try to reach the
finish flag under par without planting your helmet.

This document covers the four things that make it work: the physics model, the
chart→terrain pipeline, the automated balance methodology, and the arbitrary-ticker
flow. Tone is technical; no marketing.

---

## 1. Physics & controls

The bike is a **two-mass model**: a rear wheel and a front wheel, each a point mass
with position and velocity, integrated with semi-implicit Euler at a fixed
`STEP = 1/60` split into `SUB = 4` substeps (240 Hz effective) for stable contacts.
There is no separate rigid body — the *frame* is a constraint between the two wheels,
and the *rider* is drawn, not simulated (except as crash points). This is exactly the
Gravity Defied trick: two circles and a stick keep the whole thing cheap and readable.

### Wheelbase as spring + damper

The two wheels are held `WHEELBASE = 46` apart by a soft **spring/damper** solved
twice per substep (stiffness `0.4`, damping `0.15`). Softness is deliberate: a rigid
rod transmits every terrain spike into a rotation and makes landings twitchy; a spring
lets the bike *absorb* a bad touchdown and gives the suspension a visible squash. The
bike's orientation is simply `atan2` of the front-minus-rear vector — angle is an
emergent property of where the two masses are, never a stored variable.

### The control-authority problem (why plain torque failed)

The core lesson of the rebuild. A naive implementation applies a fixed angular
impulse when you lean. We measured it: the reachable lean torque produced about
**310 u/s²** of vertical authority at a wheel, while gravity pulls at
**G = 950** (call it ~1100 with the weight-shift budget). You physically *could not
lift a wheel* — no wheelies, no endos, no rotating to meet a landing. Every skill
expression was dead. The fix was to stop modeling lean as a weak torque and instead
give the rider real authority through two dedicated mechanisms:

**Spin-servo lean (air + ground steering of rotation).** When you hold lean, a servo
drives the bike's *relative angular velocity* toward a target `±OMEGA` (`OMEGA = 5.6`
rad/s ≈ 320°/s), at responsiveness `LEAN_RESP = 10` (1/s). It is a velocity servo, not
a torque: it is snappy, flip-capable, and **self-limiting** — you cannot spin up
infinitely, the rotation saturates at OMEGA. Airborne, this is what lets a skilled
rider match the bike to an upcoming slope before touchdown.

**Grounded weight shift (wheelies & endos).** Rotation alone can't beat gravity on the
ground, so when a wheel is in contact and you lean, we *unload one end*: lean back and
the front wheel gets an upward velocity kick of `G * LIFT` with `LIFT = 1.45` (i.e.
1.45 g), plus a small `0.25×` counter-push on the rear. Lean forward and it's mirrored
(endo). This is what makes wheelies pop in **under 0.2 s** and makes endos actually
work — the vertical authority now *exceeds* gravity, which is the whole point.

### Throttle

Gas applies `ENGINE = 1000` tangential acceleration **to both wheels** along the rear
contact tangent (driving only the rear caused the nose to plow). Speed is capped at
`VMAX = 520` measured tangentially, so throttle is binary-simple but never runaway.
A small `WHEELIE = 2.2` nose-up bias is layered on while on the gas for character.

**Air-gas backflip torque.** When *fully airborne* (neither wheel touching), holding
gas applies a backward rotation `applyRot(-10 * h)` — the chain/engine reaction of a
real bike. Hold gas off a big launch and you rotate backward ~ -73° at 0.6 s, enough
for a backflip. It also means you must **feather the gas or lean forward in the air**
to land level, which is the central mid-air skill.

### Asymmetric rotational damping

Rotation is bled off by damping, but the coefficient depends on contact:
**ground 2.6 vs air 0.5**. On the ground the tires kill wobble hard so the bike feels
planted; in the air rotation is nearly free so your lean input dominates and tricks
carry. Crucially the damping is **suppressed while you are actively steering the spin**
(holding lean) — otherwise it would fight the servo and mush the controls.

### Crash model

Two crash probes, both circle-vs-heightmap: the **head/helmet** (`r = 7.5`, offset up
the rider's spine) and a **torso** point (`r = 8`, at `mid + up*17 - axis*5`). The
torso point matters — it catches botched landings that pitch the rider into the slope
*before* the helmet would plant, so a hard nose-in wipes out honestly instead of
sliding. A fall of `maxY + 700` off the map also crashes. Contacts use restitution
`1.15` (slightly springy, keeps the ride lively) with tiny `0.004` rolling resistance.

### Key constants (one-line rationale)

| Constant | Value | Rationale |
|---|---|---|
| `G` | 950 | Floaty, GD-style hang time — long enough airs to trick |
| `ENGINE` | 1000 | Tangential accel, both wheels — brisk without wheelspin plow |
| `VMAX` | 520 | Tangential speed cap — fast but controllable |
| `OMEGA` | 5.6 rad/s | Max lean spin (~320°/s) — full flip in ~1.1 s |
| `LEAN_RESP` | 10 /s | Servo responsiveness — snappy, self-limiting |
| `LIFT` | 1.45 g | Grounded weight-shift — beats gravity so wheelies/endos exist |
| `WHEELIE` | 2.2 | Nose-up bias on gas — character, not control |
| `WHEELBASE` | 46 | Spring rest length between the two masses |
| spring/damp | 0.4 / 0.15 | Soft suspension — absorbs bad landings |
| restitution | 1.15 | Lively, slightly springy ground contact |
| damp air/gnd | 0.5 / 2.6 | Free-spinning air, planted ground |
| air-gas rot | −10·h | Backflip authority + forces mid-air throttle skill |
| `STEP`/`SUB` | 1/60 / 4 | 240 Hz substeps — stable contacts |

---

## 2. Graph → map pipeline

`levels.js buildTerrain(def)` turns an array of real closing prices into a rideable
heightmap. Each step is a lever the level author tunes.

1. **Fetch real closes.** Every preset is a hand-picked window of actual Yahoo Finance
   closes (see the per-level table). The macro silhouette — the bubble, the crash — is
   the historical truth and stays recognizable through the whole pipeline.

2. **Resample to `n` columns** (Catmull-Rom). `n` and `dx` (column spacing) together set
   **feature width**. Fewer, wider columns → chunkier, more Gravity-Defied geometry with
   big rideable faces; more columns → fine, jittery detail. Skill levels sit around
   `n ≈ 88–96`, `dx ≈ 60–66`.

3. **Vertical scale** — `linear | sqrt | log`, chosen by the price *range ratio*.
   A linear axis on a 50× mover (GME 1→80, BTC 400→17k) flattens the entire early era
   into a pixel-thin line with no texture to ride. `log` (GME, AMZN) and `sqrt`
   (BTC, MSTR) compress the blow-off top so the quiet accumulation era still has real
   relief. Steady names (KO, AAPL, SPX, META) stay `linear`.

4. **Optional smoothing.** A 1-2-1 kernel, `smooth` passes. Tutorial levels (KO
   `smooth: 2`) get sanded down into gentle rolling hills; skill levels use `smooth: 0`
   to keep every real wiggle.

5. **Punch (unsharp mask).** The signature move. We blur a copy, then push each point
   *away* from the blur: `v + punch * (v - blurred)`. This exaggerates **local relief**
   — a two-day dip becomes a launchable ledge, a choppy week becomes washboard — while
   the low-frequency macro shape (the famous chart) is untouched. `punch ≈ 1.2–1.9`
   is the difference between "a line you roll along" and "a track with jumps."

6. **Normalize to `amp`.** Scaled values are mapped into a vertical band of `amp`
   pixels (`amp ≈ 300–480`). Higher price = higher ground (smaller y, y-down world).

7. **Asymmetric slope clamp** — the **universal rideability guarantee**. Climbs are
   clamped to `slope * dx` per column, descents to the larger `drop * dx`. Because
   climbs are bounded, *no uphill is ever too steep to power up* — the track is always
   completable. Because descents are allowed to be much steeper (`drop` up to ~3.6),
   **sell-offs become genuine cliffs you launch off of**, which is where the air time
   and the fun live. Applied in both directions over two passes so it's stable.

8. **Flat start/finish platforms.** `PRE = 6` columns before and `POST = 9` after,
   held level, giving a calm IPO ramp to start and a runway to the `$` finish flag.

The terrain object also exposes `groundY(x)`, `priceAt(x)`, `contact(px,py,r)` (the
deepest circle-vs-segment test the physics uses), and `dateAt(x)` — a linear
interpolation from the level's `d0` to `d1` across the chart columns (platforms clamp
to the endpoints), which drives the live date readout in the HUD.

### Per-level parameters (all 10, easy → hard)

| # | Sym | Company | Track | n | dx | amp | slope | drop | punch | scale |
|---|-----|---------|-------|---|----|-----|-------|------|-------|-------|
| 1 | KO | Coca-Cola | Dividend Cruise | (auto) | 54 | 150 | 1.05 | 1.05 | – | linear (smooth 2) |
| 2 | AAPL | Apple | Steady Gains | 100 | 58 | 300 | 1.30 | 2.6 | 1.2 | linear |
| 3 | AMZN | Amazon | Dot-Com Bubble | 92 | 64 | 440 | 1.40 | 3.2 | 1.4 | log |
| 4 | TSLA | Tesla | Volatility Ride | 92 | 66 | 370 | 1.45 | 3.2 | 1.8 | linear |
| 5 | NVDA | NVIDIA | AI Ramp | 88 | 64 | 480 | 1.42 | 3.4 | 1.9 | linear |
| 6 | ^GSPC | S&P 500 | COVID Crash | 90 | 64 | 420 | 1.40 | 3.3 | 1.6 | linear |
| 7 | META | Meta | The Great Canyon | 92 | 64 | 450 | 1.40 | 3.3 | 1.5 | linear |
| 8 | GME | GameStop | The Squeeze | 92 | 66 | 480 | 1.35 | 3.6 | 1.3 | log |
| 9 | BTC-USD | Bitcoin | To The Moon | 94 | 66 | 470 | 1.40 | 3.4 | 1.9 | sqrt |
| 10 | MSTR | MicroStrategy | Saylor Rollercoaster | 94 | 66 | 470 | 1.42 | 3.5 | 1.8 | sqrt |

*(Final `drop`/`punch` values reflect the balance pass below; see the tuning notes.)*

---

## 3. Balance methodology

Balance is not eyeballed — it is measured with two instrumented headless bots
(Playwright + the real engine, `feeltest.js`). The gate is a two-sided proof:

- **DUMB bot** — holds gas, no lean, **one attempt**. It must **fail every skill-tier
  level**. If a hold-the-throttle zombie can clear a track, the track demands no skill.
  This is the direct fix for the original "no-skill hold-forward wins" problem.
- **SMART bot** — holds gas *and* leans in the air to align the bike with the slope it
  is about to land on, **up to 3 attempts**. It must **finish**. This proves the level
  is fair: a rider who reads the terrain and manages rotation gets through.

A level is correctly tuned when **dumb fails and smart finishes**. The two cruiser
intro levels (KO, AAPL) are the deliberate exception — they are *meant* to be passable
by the dumb bot, because their job is to teach throttle and let a new player feel the
bike before the skill tier begins.

### Feel gates (checked once, on the tutorial)

Beyond pass/fail, the harness asserts the controls actually have authority:
- **Air rotation ≥ 250°/s** from a 0.5 s lean hold (the control-authority fix, verified).
- **Wheelie in < 0.7 s** from a standstill (weight-shift works).
- **Endo works** — rear wheel lifts on forward-lean + brake.
- **Cumulative airtime ≥ 3 s** across a skill-tier run (there's real hang time to use).

### Par formula

`par = max(20, ceil(smartBotTime * 1.5 / 5) * 5)`.

The smart bot rides a near-optimal line, so its finish time is the practical floor.
The **1.5× factor** is the human-tight-but-fair headroom, rounded up to the nearest
5 s. Levels whose smart time came from a lucky/aggressive run get an extra +5 s so the
par isn't hostage to a fluke.

### Tier structure

- **2 cruiser levels** (KO, AAPL) — throttle tutorial, dumb-passable by design.
- **8 skill levels** (AMZN → MSTR) — dumb must fail, smart must pass, ordered by
  measured difficulty.
- **GOLDEN BULL** colorscheme unlocks when *all 10* charts are beaten under par
  (`PRESETS.every(beaten)`, so it extends automatically as levels are added).

---

## 4. Arbitrary tickers

Any symbol is rideable via **`?ticker=SYMBOL`** or the ENTER TICKER menu.

**Fetch.** `fetchTicker` requests 1-year weekly closes from Yahoo Finance
(`query1.finance.yahoo.com/v8/finance/chart`). Browsers can't hit Yahoo directly
(CORS), so it walks a **proxy chain** — `corsproxy.io`, then `allorigins.win`, then a
direct attempt — each with a 7 s abort timeout, taking the first that returns ≥ 8
valid closes. It also returns the first/last response timestamps (`ts0`/`ts1`) so the
HUD date readout is real for live charts.

**Auto-parameterization.** A custom chart has no hand-tuned params, so it gets the
fixed **fun-geometry family**: `n: 96, dx: 60, amp: 340, slope: 1.35, drop: 2.8,
punch: 1.3`. The one automatic decision is scale: if `max/min > 12` (a wild mover),
it switches to **log** so the flat era stays textured; otherwise linear.

**The slope clamp is what makes *any* shape rideable.** No matter how vertical a real
chart's move is, the asymmetric clamp caps every climb at a powerable grade while
letting drops stay dramatic. That single guarantee is why an arbitrary, un-playtested
ticker still produces a completable, fun track instead of an impassable wall.

**Offline fallback.** If every proxy fails, `simPrices` generates a **deterministic**
chart: a seeded `mulberry32` random walk whose seed is a hash of the ticker string, so
`ZZTOP` always rides identically. It uses drift + volatility + the occasional
"earnings surprise" jump for realism. Its dates default to today back one year. The
game **labels it honestly** — `WIRE DOWN ▼ SIMULATED CHART` in the dialer and
`SIMULATED CHART` as the level nickname — so a sim is never passed off as real data.
