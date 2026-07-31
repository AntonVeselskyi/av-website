/**
 * royale // fractal — an endless fall through card suits.
 *
 * The structure is a Droste zoom. Suits sit on concentric rings whose radii
 * grow by a fixed ratio, and the whole field is scaled by that same ratio over
 * one cycle. When the cycle wraps, every ring has landed exactly where its
 * neighbour was, so the sequence continues with no seam and the descent never
 * ends. Rings fade in at the rim and out at the centre, which is the only thing
 * standing between this and a visible loop.
 *
 * Each suit then contains smaller copies of the other suits, so the image is
 * self-similar at two scales as well as at the ring scale.
 *
 * The suits are `Path2D` objects built once. Rebuilding a dozen bezier curves
 * per suit per frame, several hundred times, is the whole cost of the scene;
 * building them once and paying only for the transform is close to free.
 *
 * Palette is the title-sequence one — blood, bone and gold on black — which is
 * already most of the way to this instrument's own ink.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

const RING_RATIO = 2.15;      // radius multiplier between consecutive rings
const RINGS = 9;
const SUITS_PER_RING = 7;
const BASE_RADIUS = 0.055;    // innermost ring, as a fraction of the short side

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

/**
 * The four suits as unit paths centred on the origin, roughly 2 units across.
 * Built from the same primitives a card printer would use: a heart is two arcs
 * meeting at a point, a spade is that inverted with a stem, a club is three
 * circles, a diamond is a rhombus.
 */
function buildSuits() {
  if (typeof Path2D !== "function") return null;

  const spade = new Path2D();
  spade.moveTo(0, -1);
  spade.bezierCurveTo(0.62, -0.36, 1.02, -0.06, 1.02, 0.28);
  spade.bezierCurveTo(1.02, 0.66, 0.66, 0.82, 0.36, 0.66);
  spade.bezierCurveTo(0.2, 0.57, 0.12, 0.44, 0.1, 0.34);
  spade.bezierCurveTo(0.14, 0.62, 0.26, 0.86, 0.42, 1.0);
  spade.lineTo(-0.42, 1.0);
  spade.bezierCurveTo(-0.26, 0.86, -0.14, 0.62, -0.1, 0.34);
  spade.bezierCurveTo(-0.12, 0.44, -0.2, 0.57, -0.36, 0.66);
  spade.bezierCurveTo(-0.66, 0.82, -1.02, 0.66, -1.02, 0.28);
  spade.bezierCurveTo(-1.02, -0.06, -0.62, -0.36, 0, -1);
  spade.closePath();

  const heart = new Path2D();
  heart.moveTo(0, 1);
  heart.bezierCurveTo(-0.34, 0.62, -1.04, 0.2, -1.04, -0.3);
  heart.bezierCurveTo(-1.04, -0.72, -0.66, -1.0, -0.34, -1.0);
  heart.bezierCurveTo(-0.13, -1.0, 0, -0.84, 0, -0.66);
  heart.bezierCurveTo(0, -0.84, 0.13, -1.0, 0.34, -1.0);
  heart.bezierCurveTo(0.66, -1.0, 1.04, -0.72, 1.04, -0.3);
  heart.bezierCurveTo(1.04, 0.2, 0.34, 0.62, 0, 1);
  heart.closePath();

  const diamond = new Path2D();
  diamond.moveTo(0, -1.05);
  diamond.bezierCurveTo(0.3, -0.44, 0.72, -0.12, 0.78, 0);
  diamond.bezierCurveTo(0.72, 0.12, 0.3, 0.44, 0, 1.05);
  diamond.bezierCurveTo(-0.3, 0.44, -0.72, 0.12, -0.78, 0);
  diamond.bezierCurveTo(-0.72, -0.12, -0.3, -0.44, 0, -1.05);
  diamond.closePath();

  const club = new Path2D();
  club.arc(0, -0.44, 0.42, 0, Math.PI * 2);
  club.closePath();
  club.moveTo(-0.36, 0.24);
  club.arc(-0.44, 0.16, 0.42, 0, Math.PI * 2);
  club.closePath();
  club.moveTo(0.52, 0.16);
  club.arc(0.44, 0.16, 0.42, 0, Math.PI * 2);
  club.closePath();
  club.moveTo(0.12, 0.2);
  club.bezierCurveTo(0.16, 0.56, 0.28, 0.84, 0.42, 1.0);
  club.lineTo(-0.42, 1.0);
  club.bezierCurveTo(-0.28, 0.84, -0.16, 0.56, -0.12, 0.2);
  club.closePath();

  return [spade, heart, diamond, club];
}

export default class RoyaleFractalScene {
  static id = "royale-fractal";
  static label = "royale // fractal";
  // Printed card stock, not a tube: grain runs high, interlace and curvature low.
  static post = { grain: 0.11, scanlines: 0.09, dither: 0.05, vignette: 0.62, bar: 0.025, curve: 0.01 };

  constructor(kit) {
    this.kit = kit;
    this.suits = buildSuits();
    this.bloom = new kit.Bloom({ scale: 0.3 });
    this.feedback = new kit.FeedbackWarp({ scale: 0.55 });
    this.suitLayer = new kit.Layer({ scale: 1 });

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
   * banknotes. Two counter-rotating harmonics traced as one path.
   */
  drawGuilloche(frame, cx, cy, radius, alpha, seed) {
    const { ctx, palette } = frame;
    if (alpha <= 0.01 || radius < 8) return;
    const lobes = 5 + (seed % 4);
    const steps = Math.max(60, Math.round(150 * frame.detail));
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

  /** One suit, plus the smaller suits nested inside it. */
  stampSuit(ctx, suitIndex, size, depth, frame, fill, edge) {
    const suits = this.suits;
    if (!suits) return;
    ctx.save();
    ctx.scale(size, size);
    ctx.fillStyle = fill;
    ctx.fill(suits[suitIndex]);
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.max(0.02, 0.045 / Math.max(0.15, size / 40));
      ctx.stroke(suits[suitIndex]);
    }
    ctx.restore();

    if (depth <= 0 || size < 14) return;
    // Self-similarity: three smaller suits set into the body of this one.
    const child = size * 0.3;
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + this.spin * 0.6;
      const rx = Math.cos(a) * size * 0.36;
      const ry = Math.sin(a) * size * 0.36 + size * 0.08;
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(a * 0.5);
      // The nested suits are punched out of the parent, which is how the card
      // reads as printed rather than as stacked stickers.
      ctx.globalCompositeOperation = "destination-out";
      ctx.scale(child, child);
      ctx.fill(this.suits[(suitIndex + i + 1) % 4]);
      ctx.restore();
    }
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
      // The descent runs on tempo, accelerated by the low end.
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

    // Felt: a deep table green would fight the ink, so the ground is the void
    // with a single warm pool where the light hangs over the table.
    kit.fadeTo(ctx, width, height, palette.void, 1);
    const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, short * 0.78);
    pool.addColorStop(0, `rgba(96, 14, 26, ${(0.12 + audio.sustain * 0.18).toFixed(3)})`);
    pool.addColorStop(0.45, "rgba(44, 8, 20, 0.07)");
    pool.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, width, height);

    if (!reduced) {
      // A slow rotational smear, so the descent leaves a trail like a card
      // sequence flicked past the lens.
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
    const layer = this.suitLayer;
    layer.match(frame.width, frame.height);
    layer.clear();
    const incoming = layer.ctx;
    if (incoming) {
      incoming.setTransform(1, 0, 0, 1, 0, 0);
      incoming.globalAlpha = 1;
      incoming.globalCompositeOperation = "source-over";
    }

    for (let ring = 0; ring < RINGS; ring += 1) {
      // Continuous level: the ring index plus the sub-ring descent. As `phase`
      // completes, every ring has taken its neighbour's place exactly.
      const level = ring + this.phase;
      const radius = short * BASE_RADIUS * Math.pow(RING_RATIO, level);
      if (radius > maxR * 1.6) continue;

      // Fade in from the rim, out toward the vanishing centre.
      const near = kit.clamp(1 - (radius - maxR * 0.55) / (maxR * 0.9));
      const far = kit.clamp(radius / (short * 0.1));
      const presence = Math.min(near, far);
      if (presence <= 0.02) continue;

      const cycleIndex = royaleRingIdentity(this.cycle, ring);
      const transition = royaleSuitTransition(level);
      const ringStyle = royaleRingStyle(level);
      const band = frame.band(ringStyle.bandPosition);
      const ringSpin = this.spin * ringStyle.spinCoefficient;
      const size = radius * 0.22 * (0.86 + band * 0.26 + this.deal * 0.07);

      this.drawGuilloche(frame, cx, cy, radius, presence * (0.05 + band * 0.13), cycleIndex);

      // Red suits are blood, black suits are bone-on-void so they stay legible
      // against the dark; gold is reserved for the ornament.
      const lift = presence * (0.16 + band * 0.32 + this.deal * 0.1);
      const depth = detail > 0.8 && radius > short * 0.12 ? 1 : 0;

      const paint = (suitIndex) => {
        const red = suitIndex === 1 || suitIndex === 2;
        return {
          fill: red ? palette.blood(Math.min(0.55, lift)) : palette.bone(Math.min(0.4, lift * 0.66)),
          edge: red ? palette.amber(presence * 0.24) : palette.violet(presence * 0.2),
        };
      };
      const fromPaint = paint(transition.from);
      const toPaint = paint(transition.to);

      for (let i = 0; i < suitsPerRing; i += 1) {
        const a = (i / suitsPerRing) * Math.PI * 2 + ringSpin;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        // Cull anything comfortably outside the frame before paying for it.
        if (x < -size * 2 || x > frame.width + size * 2 || y < -size * 2 || y > frame.height + size * 2) continue;
        ctx.save();
        ctx.translate(x, y);
        const baseRotation = a + Math.PI * 0.5 + Math.sin(this.t * 0.4 + i) * 0.05;
        const chroma = transition.warp * (0.08 + band * 0.1);

        // A low-opacity chromatic echo blooms only while identities overlap.
        // It makes the morph feel hallucinatory without smearing the stable
        // parts of the descent or introducing random one-frame discontinuity.
        if (incoming && transition.warp > 0.03 && (detail > 0.72 || ((i + ring) & 1) === 0)) {
          incoming.save();
          incoming.translate(x, y);
          incoming.globalCompositeOperation = "lighter";
          incoming.globalAlpha = transition.warp * presence * 0.2;
          incoming.rotate(baseRotation + chroma * 1.7);
          incoming.scale(1 + chroma * 1.8, 1 - chroma * 0.55);
          this.stampSuit(incoming, transition.to, size * 1.06, 0, frame, palette.violet(0.2), palette.wire(0.28));
          incoming.restore();
        }

        if (transition.fromAlpha > 0.004) {
          ctx.save();
          ctx.globalAlpha = transition.fromAlpha;
          ctx.rotate(baseRotation - chroma * 0.75);
          ctx.scale(1 + chroma * 0.7, 1 - chroma * 0.24);
          this.stampSuit(ctx, transition.from, size * (1 + transition.warp * 0.08), depth, frame, fromPaint.fill, fromPaint.edge);
          ctx.restore();
        }
        if (incoming && transition.toAlpha > 0.004) {
          incoming.save();
          incoming.translate(x, y);
          incoming.globalAlpha = transition.toAlpha;
          incoming.rotate(baseRotation + chroma * 0.9);
          incoming.scale(1 - chroma * 0.32, 1 + chroma * 0.82);
          this.stampSuit(incoming, transition.to, size * (0.9 + transition.toAlpha * 0.1), depth, frame, toPaint.fill, toPaint.edge);
          incoming.restore();
        }
        ctx.restore();
      }
    }
    if (incoming) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(layer.canvas, 0, 0, frame.width, frame.height);
      ctx.restore();
    }
    void audio;
  }

  /** Table furniture: the hand, the stake, the machine watching the table. */
  drawTable(frame, cx, cy, short) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const small = Math.max(9, 11 * frame.ratio);

    // The dealt hand, stamped like a mixtape label.
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

    // The eye over the table.
    kit.reticle(ctx, cx, cy, short * (0.2 + this.deal * 0.05), {
      color: palette.wire(0.1 + audio.beat * 0.14),
      width: Math.max(1, frame.ratio),
      crosshair: true,
    });
  }

  suspend() {
    this.bloom.release();
    this.feedback.release();
    this.suitLayer.release();
  }
}
