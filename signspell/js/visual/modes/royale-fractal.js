/**
 * royale // fractal — an endless fall through card suits.
 *
 * The structure is a Droste zoom. Suits sit on concentric rings whose radii
 * grow by a fixed ratio, and the whole field is scaled by that same ratio over
 * one cycle. When the cycle wraps, every ring has landed exactly where its
 * neighbour was, so the sequence continues with no seam and the descent never
 * ends. Rings fade in at the rim and out at the centre.
 *
 * The suits genuinely morph. Cross-fading one suit into another looks like two
 * pictures fighting, because nothing about a spade travels toward a heart — the
 * ink just swaps. So each suit is instead defined as a union of primitives
 * (circles and polygons) and sampled as a support radius at a fixed set of
 * angles. Every suit therefore produces the same number of points at the same
 * angles, which gives exact point correspondence, and the morph is a plain
 * interpolation of radii: the spade's shoulders actually swell into the heart's
 * lobes and its stem retracts. `royaleSuitTransition` supplies the mix, so the
 * shape is continuous across every wrap of the stack.
 *
 * Around that sits the rest of the table, in the idiom of the title sequence:
 * a roulette ring of alternating red and black pockets, cards fanned and
 * cascading out of the centre, and guilloche lattice printed over everything.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

const RING_RATIO = 2.15;      // radius multiplier between consecutive rings
const RINGS = 9;
const SUITS_PER_RING = 7;
const BASE_RADIUS = 0.055;    // innermost ring, as a fraction of the short side
const OUTLINE_STEPS = 72;     // samples per suit outline

const SUIT_NAMES = ["SPADE", "HEART", "DIAMOND", "CLUB"];
const SUIT_GLYPH = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7"];
const HANDS = [
  "ROYAL FLUSH", "STRAIGHT FLUSH", "FOUR OF A KIND", "FULL HOUSE",
  "FLUSH", "STRAIGHT", "THREE OF A KIND", "TWO PAIR",
];

function hash01(n) {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/**
 * Continuous suit identity along the logarithmic descent. At integer ring
 * boundaries the outgoing suit has fully become the incoming one, so wrapping
 * the Droste stack cannot replace the whole field in a single frame.
 */
export function royaleSuitTransition(level) {
  const base = Math.floor(level);
  const phase = level - base;
  const mix = phase * phase * phase * (phase * (phase * 6 - 15) + 10);
  const modulo = (value) => ((value % 4) + 4) % 4;
  return {
    from: modulo(base),
    to: modulo(base + 1),
    fromAlpha: 1 - mix,
    toAlpha: mix,
    warp: Math.sin(Math.PI * phase),
  };
}

/** Keeps ring ornament identity attached to geometry when the stack wraps. */
export function royaleRingIdentity(cycle, ring) {
  const logical = ring - cycle;
  return ((logical % 4096) + 4096) % 4096;
}

/** Continuous audio-band and rotation assignment for a travelling ring. */
export function royaleRingStyle(level, ringCount = RINGS) {
  const transition = royaleSuitTransition(level);
  const spinAt = (index) => {
    const direction = ((index % 2) + 2) % 2 ? -1 : 1;
    const family = ((index % 3) + 3) % 3;
    return direction * (0.4 + family * 0.22);
  };
  const denominator = Math.max(1, ringCount - 1);
  return {
    bandPosition: Math.min(0.85, Math.max(0, (level / denominator) * 0.85)),
    spinCoefficient: spinAt(Math.floor(level)) * transition.fromAlpha
      + spinAt(Math.floor(level) + 1) * transition.toAlpha,
  };
}

// ---------------------------------------------------------------------------
// Suit geometry
// ---------------------------------------------------------------------------

/**
 * Each suit is a union of primitives. Sampling the union's support radius at a
 * fixed angle set is what makes every suit produce corresponding points, and
 * corresponding points are what make the morph read as one shape becoming
 * another rather than as a dissolve.
 */
const STEM = { polygon: [[-0.44, 1.0], [-0.1, 0.16], [0.1, 0.16], [0.44, 1.0]] };

const SUIT_SHAPES = [
  // Spade: two shoulders and a point, standing on a stem.
  [
    { circle: [-0.5, 0.16, 0.52] },
    { circle: [0.5, 0.16, 0.52] },
    { polygon: [[0, -1.02], [0.95, 0.3], [-0.95, 0.3]] },
    STEM,
  ],
  // Heart: the same body inverted, cusped at the top, no stem.
  [
    { circle: [-0.5, -0.34, 0.54] },
    { circle: [0.5, -0.34, 0.54] },
    { polygon: [[-1.0, -0.2], [1.0, -0.2], [0, 1.02]] },
  ],
  // Diamond.
  [
    { polygon: [[0, -1.05], [0.78, 0], [0, 1.05], [-0.78, 0]] },
  ],
  // Club: three lobes on a stem.
  [
    { circle: [0, -0.46, 0.44] },
    { circle: [-0.46, 0.18, 0.44] },
    { circle: [0.46, 0.18, 0.44] },
    STEM,
  ],
];

/** Distance from the origin to a circle's far side along a unit direction. */
function circleSupport(cx, cy, r, dx, dy) {
  const along = cx * dx + cy * dy;
  const perp = cx * dy - cy * dx;
  const inside = r * r - perp * perp;
  if (inside <= 0) return 0;
  const hit = along + Math.sqrt(inside);
  return hit > 0 ? hit : 0;
}

/** Distance to a polygon's boundary along a unit direction from the origin. */
function polygonSupport(points, dx, dy) {
  let best = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const ex = bx - ax;
    const ey = by - ay;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-9) continue;
    // Ray from the origin against this edge segment.
    const t = (ax * ey - ay * ex) / denominator;
    if (t <= 0) continue;
    const u = Math.abs(ex) > Math.abs(ey)
      ? (t * dx - ax) / ex
      : (t * dy - ay) / ey;
    if (u < 0 || u > 1) continue;
    if (t > best) best = t;
  }
  return best;
}

/** Radii of every suit at the shared sample angles, computed once. */
const SUIT_RADII = SUIT_SHAPES.map((shape) => {
  const radii = new Float32Array(OUTLINE_STEPS);
  for (let step = 0; step < OUTLINE_STEPS; step += 1) {
    const angle = (step / OUTLINE_STEPS) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = 0;
    for (const part of shape) {
      const value = part.circle
        ? circleSupport(part.circle[0], part.circle[1], part.circle[2], dx, dy)
        : polygonSupport(part.polygon, dx, dy);
      if (value > best) best = value;
    }
    radii[step] = best;
  }
  return radii;
});

export default class RoyaleFractalScene {
  static id = "royale-fractal";
  static label = "royale // fractal";
  // Printed card stock, not a tube: grain runs high, interlace and curvature low.
  static post = { grain: 0.11, scanlines: 0.09, dither: 0.05, vignette: 0.62, bar: 0.025, curve: 0.01 };

  constructor(kit) {
    this.kit = kit;
    this.bloom = new kit.Bloom({ scale: 0.3 });
    this.feedback = new kit.FeedbackWarp({ scale: 0.55 });
    // One morphed outline is shared by every suit on a ring.
    this.morphX = new Float32Array(OUTLINE_STEPS);
    this.morphY = new Float32Array(OUTLINE_STEPS);

    this.phase = 0;        // 0..1 within one ring-to-ring descent
    this.cycle = 0;        // how many rings have passed the camera
    this.spin = 0;
    this.deal = 0;         // beat envelope
    this.lastBeat = -1;
    this.hand = 0;
    this.t = 0;
  }

  // ---------------------------------------------------------------------------
  // Ornament
  // ---------------------------------------------------------------------------

  /**
   * Guilloche: the interlocking arc lattice printed on a card back and on
   * banknotes.
   */
  drawGuilloche(frame, cx, cy, radius, alpha, seed) {
    const { ctx, palette } = frame;
    if (alpha <= 0.01 || radius < 8) return;
    const lobes = 5 + (seed % 4);
    const steps = Math.max(48, Math.round(120 * frame.detail));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = palette.amber(alpha);
    ctx.lineWidth = Math.max(0.6, frame.ratio * 0.7);
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / steps) * Math.PI * 2;
      const r = radius * (0.82 + 0.18 * Math.cos(a * lobes + this.spin * 1.4));
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The wheel: alternating red and black pockets with fret ticks, turning
   * against the descent. It reads as the table the whole fall happens over.
   */
  drawWheel(frame, cx, cy, radius, alpha) {
    const { ctx, palette, audio } = frame;
    if (alpha <= 0.015 || radius < 20) return;
    const pockets = 18;
    const turn = -this.spin * 0.5 + audio.brightness * 0.4;
    const inner = radius * 0.86;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let pocket = 0; pocket < pockets; pocket += 1) {
      const a0 = (pocket / pockets) * Math.PI * 2 + turn;
      const a1 = ((pocket + 1) / pockets) * Math.PI * 2 + turn;
      const lit = frame.band(pocket / pockets);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, a0, a1);
      ctx.arc(cx, cy, inner, a1, a0, true);
      ctx.closePath();
      // Red and black alternate; a lit pocket is one the spectrum is in.
      ctx.fillStyle = pocket % 2
        ? palette.blood(alpha * (0.16 + lit * 0.4))
        : palette.void(alpha * 0.5);
      ctx.fill();
    }
    ctx.strokeStyle = palette.amber(alpha * 0.35);
    ctx.lineWidth = Math.max(0.7, frame.ratio * 0.8);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.moveTo(cx + inner, cy);
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.stroke();
    // Frets between pockets.
    ctx.beginPath();
    for (let pocket = 0; pocket < pockets; pocket += 1) {
      const a = (pocket / pockets) * Math.PI * 2 + turn;
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Cards thrown out of the centre, fanned and falling away. */
  drawFan(frame, cx, cy, radius, alpha) {
    const { ctx, palette, audio } = frame;
    if (alpha <= 0.02 || radius < 14) return;
    const cards = Math.max(4, Math.round(9 * frame.detail));
    const w = radius * 0.3;
    const h = radius * 0.44;
    ctx.save();
    for (let card = 0; card < cards; card += 1) {
      const seed = hash01(this.cycle * 13 + card);
      const spread = (card / (cards - 1) - 0.5) * (1.5 + audio.sustain * 0.5);
      const a = spread + this.spin * 0.3 + seed * 0.2;
      const reach = radius * (0.62 + seed * 0.5 + this.deal * 0.12);
      const x = cx + Math.cos(a - Math.PI * 0.5) * reach;
      const y = cy + Math.sin(a - Math.PI * 0.5) * reach;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + Math.sin(this.t * 0.5 + card) * 0.25);
      ctx.globalAlpha = alpha * (0.28 + seed * 0.4);
      ctx.fillStyle = palette.void(0.9);
      ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
      ctx.strokeStyle = palette.bone(0.55);
      ctx.lineWidth = Math.max(0.7, frame.ratio * 0.8);
      ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
      // A single pip, in the suit this ring is becoming.
      ctx.fillStyle = card % 2 ? palette.blood(0.8) : palette.bone(0.5);
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1, w * 0.13), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Builds the morphed outline for a suit pair into the shared scratch arrays.
   * `warp` swells the shape mid-transition so the change of state is felt.
   */
  buildMorph(from, to, mix, size, warp) {
    const a = SUIT_RADII[from];
    const b = SUIT_RADII[to];
    for (let step = 0; step < OUTLINE_STEPS; step += 1) {
      const angle = (step / OUTLINE_STEPS) * Math.PI * 2;
      const radius = (a[step] + (b[step] - a[step]) * mix)
        * (1 + warp * 0.06 * Math.sin(angle * 3 + this.spin));
      this.morphX[step] = Math.cos(angle) * radius * size;
      this.morphY[step] = Math.sin(angle) * radius * size;
    }
  }

  /** Traces the prepared outline. */
  traceMorph(ctx) {
    ctx.beginPath();
    ctx.moveTo(this.morphX[0], this.morphY[0]);
    for (let step = 1; step < OUTLINE_STEPS; step += 1) ctx.lineTo(this.morphX[step], this.morphY[step]);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  render(frame) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const reduced = frame.reducedMotion;
    const dt = Math.min(0.05, frame.dt);
    const cx = width * 0.5;
    const cy = height * 0.5;
    const short = Math.min(width, height);

    if (!reduced) {
      this.t += dt;
      const rate = 0.1 + kit.clamp(audio.bassAtt, 0, 2.5) * 0.075 + this.deal * 0.12;
      this.phase += dt * rate;
      while (this.phase >= 1) { this.phase -= 1; this.cycle += 1; }
      this.spin += dt * (0.16 + kit.clamp(audio.midRel, 0, 2) * 0.08);
      this.deal = Math.max(0, this.deal - dt * 2.4);
      if (audio.beat > 0.68 && audio.beatCount !== this.lastBeat) {
        this.lastBeat = audio.beatCount;
        this.deal = Math.min(1, this.deal + 0.55);
        if (audio.beatCount % 8 === 0) this.hand = (this.hand + 1) % HANDS.length;
      }
    }

    kit.fadeTo(ctx, width, height, palette.void, 1);
    const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, short * 0.78);
    pool.addColorStop(0, `rgba(96, 14, 26, ${(0.12 + audio.sustain * 0.18).toFixed(3)})`);
    pool.addColorStop(0.45, "rgba(44, 8, 20, 0.07)");
    pool.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, width, height);

    if (!reduced) {
      this.feedback.warp(frame, {
        zoom: 1.004 + this.deal * 0.006,
        rot: 0.0012,
        decay: 0.8,
        background: "rgba(0,0,0,0)",
      });
    }

    this.drawRings(frame, cx, cy, short);

    if (!reduced) this.feedback.store(frame);

    this.bloom.apply(ctx, ctx.canvas, {
      strength: 0.16 + Math.min(2, audio.trebAtt) * 0.05,
      blur: 14 * frame.ratio,
      passes: 2,
    });
    this.drawTable(frame, cx, cy, short);
  }

  /** The Droste stack itself. */
  drawRings(frame, cx, cy, short) {
    const { ctx, audio, palette, kit } = frame;
    const detail = frame.detail;
    const suitsPerRing = Math.max(5, Math.round(SUITS_PER_RING * detail));
    const maxR = Math.hypot(cx, cy) * 1.15;

    for (let ring = 0; ring < RINGS; ring += 1) {
      const level = ring + this.phase;
      const radius = short * BASE_RADIUS * Math.pow(RING_RATIO, level);
      if (radius > maxR * 1.6) continue;

      const near = kit.clamp(1 - (radius - maxR * 0.55) / (maxR * 0.9));
      const far = kit.clamp(radius / (short * 0.1));
      const presence = Math.min(near, far);
      if (presence <= 0.02) continue;

      const identity = royaleRingIdentity(this.cycle, ring);
      const style = royaleRingStyle(level, RINGS);
      const transition = royaleSuitTransition(level + this.cycle);
      const band = frame.band(style.bandPosition);
      const ringSpin = this.spin * style.spinCoefficient;
      const size = radius * 0.22 * (0.86 + band * 0.26 + this.deal * 0.07);

      this.drawGuilloche(frame, cx, cy, radius, presence * (0.05 + band * 0.13), identity);
      // Every third ring carries the wheel, so the table is present at several
      // depths at once without becoming a stack of concentric dials.
      if (identity % 3 === 0) this.drawWheel(frame, cx, cy, radius * 1.14, presence * 0.5);
      if (identity % 4 === 1) this.drawFan(frame, cx, cy, radius, presence * 0.5);

      // The suit is a genuine blend of two shapes, not two suits stacked.
      this.buildMorph(transition.from, transition.to, transition.toAlpha, size, transition.warp);

      // Colour follows the morph too: the red suits are blood, the black ones
      // bone-on-void, and the transition crosses between them continuously.
      const redness = (transition.from === 1 || transition.from === 2 ? transition.fromAlpha : 0)
        + (transition.to === 1 || transition.to === 2 ? transition.toAlpha : 0);
      const lift = presence * (0.16 + band * 0.32 + this.deal * 0.1);
      const red = palette.blood(Math.min(0.55, lift));
      const black = palette.bone(Math.min(0.4, lift * 0.66));
      const edgeRed = palette.amber(presence * 0.24);
      const edgeBlack = palette.violet(presence * 0.2);

      for (let i = 0; i < suitsPerRing; i += 1) {
        const a = (i / suitsPerRing) * Math.PI * 2 + ringSpin;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (x < -size * 2 || x > frame.width + size * 2 || y < -size * 2 || y > frame.height + size * 2) continue;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + Math.PI * 0.5 + Math.sin(this.t * 0.4 + i) * 0.05);
        this.traceMorph(ctx);
        // Two fills rather than two shapes: the silhouette is already single
        // and continuous, so only its colour has to cross over.
        ctx.globalAlpha = 1 - redness;
        ctx.fillStyle = black;
        ctx.fill();
        ctx.globalAlpha = redness;
        ctx.fillStyle = red;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = redness > 0.5 ? edgeRed : edgeBlack;
        ctx.lineWidth = Math.max(0.6, frame.ratio * 0.8);
        ctx.stroke();
        ctx.restore();
      }
    }
    void audio;
  }

  /** Table furniture: the hand, the stake, the machine watching the table. */
  drawTable(frame, cx, cy, short) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const small = Math.max(9, 11 * frame.ratio);

    const seed = this.cycle * 4 + this.hand;
    let hand = "";
    for (let card = 0; card < 5; card += 1) {
      const rank = RANKS[Math.floor(hash01(seed * 7 + card) * RANKS.length)];
      const suit = SUIT_GLYPH[Math.floor(hash01(seed * 11 + card * 3) * 4)];
      hand += `${rank}${suit} `;
    }
    kit.stampText(ctx, HANDS[this.hand], width * 0.04, height * 0.885, {
      size: Math.max(14, width * 0.028),
      ink: palette.bone,
      bruise: palette.blood(0.45),
      rotate: -0.028,
      spread: 1.9 * frame.ratio,
      alpha: 0.4 + this.deal * 0.35,
      letterSpacing: -0.025,
    });
    kit.machineText(ctx, hand.trim(), width * 0.04, height * 0.925, {
      size: small * 1.25, color: palette.blood(0.55), letterSpacing: 0.12,
    });
    kit.machineText(ctx,
      `STAKE ${String(Math.round(audio.bassRel * 4000)).padStart(5, "0")}  ·  DEPTH ${String(this.cycle % 1000).padStart(3, "0")}  ·  ${SUIT_NAMES[this.cycle % 4]}`,
      width * 0.04, height * 0.962, { size: small, color: palette.amber(0.4), letterSpacing: 0.07 });

    kit.reticle(ctx, cx, cy, short * (0.2 + this.deal * 0.05), {
      color: palette.wire(0.1 + audio.beat * 0.14),
      width: Math.max(1, frame.ratio),
      crosshair: true,
    });
  }

  suspend() {
    this.bloom.release();
    this.feedback.release();
  }
}
