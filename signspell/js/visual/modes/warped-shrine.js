/**
 * warped // shrine — the Dark Pantheon.
 *
 * A one-point-perspective nave: colonnades receding into haze, a gothic vault
 * overhead, flagstone joints converging on the vanishing point, and a
 * monumental idol standing in the middle of it with its head missing.  The
 * whole scene is built around one rule taken from the brief: **the light
 * reacts, the stone does not.**  Monuments do not bounce.
 *
 * Three time scales, deliberately weighted slow:
 *   - a 20-35s camera sway plus dolly, applied to the whole frame,
 *   - per-bar light sweeps down the nave and per-beat brazier flares,
 *   - per-frame flame flicker (noise, never a sine) and dust shimmer.
 *
 * Four things are alive in here, and only four:
 *   - the fire — braziers flanking the plinth throw real tongues, not blobs,
 *     and shed embers that rise and die;
 *   - the shadow the fire throws — the idol's headless silhouette, stretched
 *     up the far end of the nave, leaning and wavering with the flame that
 *     casts it.  It is the largest thing in the frame and it is not stone;
 *   - the crows — perched on the capitals and on the god's own shoulder,
 *     ruffling, and now and then one breaks and comes at the camera;
 *   - the preacher — a cowled celebrant at the foot of the plinth, backlit,
 *     faceless apart from two violet pupils.  He is not always there.  The
 *     readout admits it when he is not.
 *
 * How it fits the frame budget:
 *   - Every piece of stone — piers, arcade, vault ribs, clerestory, floor
 *     joints, carved sigils, wall litany, rubble — is drawn ONCE into `arch`,
 *     a full-resolution Layer, then blitted with a small translate/scale for
 *     the camera drift.  It is rebuilt only on resize or resume.  That single
 *     blit is what pays for the architectural density this scene needs.
 *   - All volumetrics — candle pools, god-rays, incense, the haze the idol is
 *     silhouetted against — live in `aether`, a half-resolution *additive*
 *     Layer driven by FeedbackWarp with a glacial upward drift.  Accumulation
 *     does the work ten thousand particles would, for one composite.
 *   - The idol, the summoning circle, the flames and the dust are the only
 *     geometry re-stroked per frame, and together they are a few dozen paths.
 *
 * Draw order is also the depth order: haze, stone, floor sigil, aether, idol,
 * foreground shaft and dust, machine overlay, bloom.  The idol can be painted
 * over the whole cached colonnade without occlusion errors because it is
 * narrower than the nearest piers and its crown sits below the nearest vault
 * arch — nothing in front of it overlaps it in screen space.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

// --- World units: 1.0 is half the nave's clear width. --------------------
const PIER_IN = 0.79;      // inner face of the piers, i.e. the clear span
const PIER_OUT = 1.05;     // outer face, buried in the wall
const WALL_X = 1.0;        // wall plane (clerestory + litany live here)
const FLOOR_Y = 0.62;      // floor, below the eye
const CAP_Y = -0.55;       // capital / arch springing line
const VAULT_D = 0.34;      // two-centred arch offset -> a pointed vault
const VAULT_R = PIER_IN + VAULT_D;
const VAULT_H = Math.sqrt(VAULT_R * VAULT_R - VAULT_D * VAULT_D);
const APEX_Y = CAP_Y - VAULT_H;
const VAULT_PHI = Math.atan2(VAULT_H, VAULT_D);

const BAY_COUNT = 9;
const BAY_RATIO = 1.215;   // geometric depths read as even spacing under 1/z
const Z_FIRST = 1.0;
const Z_FLOOR_NEAR = 0.56; // floor runs off the bottom of the frame
const Z_FADE = 5.6;        // beyond this the nave is only haze

const IDOL_Z = 2.2;        // front plane of the effigy
const IDOL_BACK = 3.05;
const IDOL_FRONT = 1.95;

const DUST_MAX = 176;
const SPARK_MAX = 84;
const SPRITE = 128;
const STONE_SEED = 0x5b1d3;

const BRAZIER_Z = 1.78;     // in front of the plinth, so the fire can cast
// Far enough forward and to the side that both braziers stay visible past him,
// and low enough in frame to leave the top-left quadrant to the DOM type.
const PREACHER_X = -0.66;
const PREACHER_Z = 1.34;
const PREACHER_H = 0.63;    // head top above the floor, i.e. human beside a god
const PREACHER_CYCLE = 47;  // seconds between arrivals

// [u, v] in half-widths and fractions of PREACHER_H, hem up the left side,
// over the crown and back down the right.
const PREACHER_COWL = [
  [-0.128, 0.14], [-0.108, 0.3], [-0.118, 0.46], [-0.148, 0.62],
  [-0.112, 0.72], [-0.098, 0.82], [-0.086, 0.9], [-0.058, 0.965], [-0.022, 1],
  [0.026, 0.998], [0.062, 0.958], [0.09, 0.895], [0.102, 0.815], [0.116, 0.715],
  [0.152, 0.62], [0.122, 0.46], [0.112, 0.3], [0.132, 0.14], [0.158, 0],
];
// Index ranges into PREACHER_COWL for the two lit edges: [right start, right
// end, left start, left end].  The fire is behind him, so only these catch it.
const PREACHER_CREST = [8, 15, 0, 8];

// [x, y, z, facing].  Kept nearer than 2.2 so that a bird on a capital is
// never behind the effigy in screen space — perched crows are painted after it.
const CROW_PERCHES = [
  [-PIER_IN, CAP_Y - 0.07, 1.476, 1],
  [PIER_IN, CAP_Y - 0.07, 1.794, -1],
  [-PIER_IN, CAP_Y - 0.07, 2.18, 1],
  [0.5, FLOOR_Y - 0.18, 1.96, -1],  // the plinth itself, watching the celebrant
  [0.45, -0.58, IDOL_Z, -1],        // the intact shoulder
  [0.6, -0.7, IDOL_Z, -1],          // the broken arm
];

const INSCRIPTIONS = ["nullus deus", "vox nihil", "tacet", "deus abest", "oratio vacua"];
const LITANY = [
  "qui nihil audit",
  "vox in vacuo",
  "nemo respondet",
  "sine fine sine",
  "ossa · ossa",
  "0x00 orate",
];

const IDOL_BASE_Y = FLOOR_Y - 0.18;

/**
 * The effigy's outline in world units, declared once so the body fill and the
 * cast shadow are guaranteed to be the same object.  A silhouette that does not
 * match its own shadow is the fastest way to make a scene read as flat.
 */
const IDOL_BODY = Float32Array.from([
  -0.33, IDOL_BASE_Y, -0.3, -0.16, -0.27, -0.46,
  -0.43, -0.53,                     // shoulder, broken away
  -0.22, -0.6, -0.11, -0.66,
  -0.1, -0.78, 0.1, -0.78,          // neck stub, where the head was
  0.12, -0.64, 0.29, -0.62,
  0.45, -0.56,                      // intact shoulder
  0.42, -0.42, 0.33, -0.34, 0.36, 0.06, 0.31, IDOL_BASE_Y,
]);
const IDOL_ARM = Float32Array.from([0.4, -0.54, 0.56, -0.72, 0.66, -0.66, 0.52, -0.46]);

/** The gothic cross-section, sampled once in world units and reused forever. */
function vaultProfile(steps = 11) {
  const points = new Float32Array((steps * 2 - 1) * 2);
  let cursor = 0;
  for (let index = 0; index < steps; index += 1) {
    const angle = Math.PI + (index / (steps - 1)) * VAULT_PHI;
    points[cursor] = VAULT_D + VAULT_R * Math.cos(angle);
    points[cursor + 1] = CAP_Y + VAULT_R * Math.sin(angle);
    cursor += 2;
  }
  for (let index = 1; index < steps; index += 1) {
    const angle = -VAULT_PHI + (index / (steps - 1)) * VAULT_PHI;
    points[cursor] = -VAULT_D + VAULT_R * Math.cos(angle);
    points[cursor + 1] = CAP_Y + VAULT_R * Math.sin(angle);
    cursor += 2;
  }
  return points;
}

const smooth01 = (edge0, edge1, value) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0 || 1)));
  return t * t * (3 - 2 * t);
};

/**
 * How present the celebrant is, 0..1, on a fixed 47-second cycle.
 *
 * He is deliberately absent for roughly a third of it.  A figure that is always
 * standing there is set dressing; one that is sometimes simply gone is the
 * point — the readout keeps reporting on him either way.
 */
export function preacherPresence(time) {
  const t = ((time % PREACHER_CYCLE) + PREACHER_CYCLE) % PREACHER_CYCLE;
  return smooth01(6, 10, t) * (1 - smooth01(33, 38.5, t));
}

/**
 * A crow's departure, parameterised on 0..1 from perch to gone.
 *
 * `depth` is 1 at the perch and 0 at the near plane, so the caller lerps its
 * own perch depth toward the camera; the rest is body language.  Pure, because
 * the launch feel is the one thing here worth pinning down in a test.
 */
export function crowFlight(progress) {
  const p = Math.min(1, Math.max(0, progress));
  return {
    depth: 1 - Math.pow(p, 1.7),
    lift: Math.sin(p * Math.PI * 0.86) * 0.92,
    sway: Math.sin(p * 5.1) * (1 - p) * 0.42,
    flap: p * 15.5,
    alpha: smooth01(0, 0.07, p) * (1 - smooth01(0.84, 1, p)),
  };
}

export default class WarpedShrineScene {
  static id = "warped-shrine";
  static label = "warped // shrine";
  // Heavy vignette because the darkness in the vaults is what sells the scale;
  // the rolling bar and tape tears are dialled down — this place is still.
  static post = { grain: 0.075, scanlines: 0.12, dither: 0.05, vignette: 0.66, bar: 0.022, curve: 0.009, tear: false };

  constructor(kit) {
    this.kit = kit;
    const { Layer, FeedbackWarp, Bloom, mulberry32 } = kit;

    this.arch = new Layer({ scale: 1 });                  // cached stone
    this.aether = new Layer({ scale: 0.5, alpha: false }); // additive light + smoke
    this.warm = new Layer({ scale: 1 });                  // votive glow sprite
    this.cool = new Layer({ scale: 1 });                  // sacred glow sprite
    this.feedback = new FeedbackWarp({ scale: 1 });
    this.bloom = new Bloom({ scale: 0.3 });
    this.aetherFrame = { ctx: null, width: 1, height: 1 };

    this.view = { vpx: 0, vpy: 0, focal: 1, span: 1, camX: 0, camY: 0 };
    this.dirty = true;
    this.hazeGradient = null;
    this.hazeKey = "";

    this.bays = new Float32Array(BAY_COUNT);
    for (let bay = 0; bay < BAY_COUNT; bay += 1) this.bays[bay] = Z_FIRST * Math.pow(BAY_RATIO, bay);
    this.vault = vaultProfile();

    // Votive field.  Built once: wall lamps down both aisles, an offering row
    // in front of the plinth, and two braziers flanking the god.
    this.votives = [];
    for (let bay = 1; bay < 7; bay += 1) {
      for (const side of [-1, 1]) {
        this.votives.push({
          x: side * 0.72, y: FLOOR_Y - 0.012, z: this.bays[bay],
          size: 0.055, kind: 0, band: (bay * 2 + (side > 0 ? 1 : 0)) / 13, seed: bay * 7.7 + side * 3.1,
        });
      }
    }
    for (let lamp = 0; lamp < 5; lamp += 1) {
      this.votives.push({
        x: (lamp - 2) * 0.19, y: FLOOR_Y - 0.008, z: 1.72 + (lamp % 2) * 0.06,
        size: 0.05, kind: 0, band: 0.06 + lamp * 0.05, seed: 31.4 + lamp * 2.7,
      });
    }
    // The two braziers sit in FRONT of the plinth.  That is what lets them
    // light the effigy's face and throw its shadow away up the nave; a fire
    // behind the subject only ever gives you a rim.
    for (const side of [-1, 1]) {
      this.votives.push({
        x: side * 0.62, y: FLOOR_Y - 0.085, z: BRAZIER_Z,
        size: 0.098, kind: 1, band: side > 0 ? 0.02 : 0.1, seed: side > 0 ? 91.3 : 57.9,
      });
    }
    this.flare = new Float32Array(this.votives.length);
    this.braziers = [this.votives.length - 2, this.votives.length - 1];

    // Dust field.  x/z are fixed per mote so recycling never pops laterally;
    // only the rise wraps, and it cross-fades at both ends of the column.
    this.dustX = new Float32Array(DUST_MAX);
    this.dustY = new Float32Array(DUST_MAX);
    this.dustZ = new Float32Array(DUST_MAX);
    this.dustRise = new Float32Array(DUST_MAX);
    this.dustSeed = new Float32Array(DUST_MAX);
    const random = mulberry32(0x0d057);
    for (let mote = 0; mote < DUST_MAX; mote += 1) {
      this.dustX[mote] = (random() * 2 - 1) * 0.88;
      this.dustZ[mote] = 0.72 + random() * 4.1;
      this.dustY[mote] = APEX_Y - 1.25 + random() * (FLOOR_Y - APEX_Y + 1.25);
      this.dustRise[mote] = 0.014 + random() * 0.055;
      this.dustSeed[mote] = random() * 90;
    }
    // Three alpha tiers so the whole field costs three batched fills.
    this.dustBins = [new Float32Array(DUST_MAX * 3), new Float32Array(DUST_MAX * 3), new Float32Array(DUST_MAX * 3)];
    this.dustCounts = new Int32Array(3);

    // Embers off the braziers.  A ring buffer, so a spawn never allocates and
    // a heavy passage simply overwrites the oldest ember instead of growing.
    this.sparkX = new Float32Array(SPARK_MAX);
    this.sparkY = new Float32Array(SPARK_MAX);
    this.sparkZ = new Float32Array(SPARK_MAX);
    this.sparkVX = new Float32Array(SPARK_MAX);
    this.sparkVY = new Float32Array(SPARK_MAX);
    this.sparkLife = new Float32Array(SPARK_MAX);
    this.sparkSeed = new Float32Array(SPARK_MAX);
    this.sparkCursor = 0;
    this.sparkRandom = mulberry32(0xe3b0c);

    // The flock.  Perched by default; `flight` is the 0..1 departure clock and
    // -1 means "sitting".  At most two are ever in the air.
    this.crows = CROW_PERCHES.map(([x, y, z, facing], index) => ({
      x, y, z, facing,
      seed: 13.7 + index * 6.31,
      flight: -1,
    }));
    this.crowCooldown = 0;

    this.preacher = { presence: 0, blink: 0, nextBlink: 3.4, glitch: 0, gaze: 0 };

    this.lastBeatCount = -1;
    this.desecrate = 0;   // rare blood accent, every 16 hits
    this.scan = 0;        // machine scan across the idol, every 12 hits
    this.spin = 0;        // summoning circle rotation
    this.sigilStep = 0;
    this.readout = ["", "", "", ""];
    this.wordFade = 1;
    this.lastWord = 0;
  }

  resize() {
    this.dirty = true;
  }

  suspend() {
    this.arch.release();
    this.aether.release();
    this.warm.release();
    this.cool.release();
    this.feedback.release();
    this.bloom.release();
    this.hazeGradient = null;
    this.hazeKey = "";
    this.dirty = true;
  }

  // -- projection ---------------------------------------------------------
  // The whole scene is one-point perspective around a shared view record, so
  // projection reduces to two scalars and never allocates a point object.

  setView(width, height, dolly, camX, camY) {
    const view = this.view;
    view.span = Math.min(width, height * 1.8);
    view.focal = view.span * 0.52 * dolly;
    view.vpx = width * 0.5;
    view.vpy = height * 0.52;
    view.camX = camX;
    view.camY = camY;
  }

  depthScale(z) { return this.view.focal / Math.max(0.3, z); }
  sx(wx, scale) { return this.view.vpx + (wx - this.view.camX) * scale; }
  sy(wy, scale) { return this.view.vpy + (wy - this.view.camY) * scale; }

  /**
   * Aligns the context with one of the side walls so carvings and inscription
   * inherit the wall's foreshortening instead of being pasted on flat.
   * `unit` local units equal one world unit; returns 0 if the basis collapses.
   */
  setWallPlane(ctx, wx, wy, wz, unit = 1) {
    const scale = this.depthScale(wz);
    const x = this.sx(wx, scale);
    const y = this.sy(wy, scale);
    const step = 0.05;
    const ahead = this.depthScale(wz + step);
    const sign = wx < 0 ? 1 : -1;   // text always reads left to right on screen
    const ax = ((this.sx(wx, ahead) - x) / step) * sign;
    const ay = ((this.sy(wy, ahead) - y) / step) * sign;
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || Math.abs(ax) < 1e-6) return 0;
    ctx.setTransform(ax / unit, ay / unit, 0, scale / unit, x, y);
    return scale;
  }

  /** Same idea for the floor plane: glyph tops point away toward the apse. */
  setFloorPlane(ctx, wx, wz, unit = 1) {
    const scale = this.depthScale(wz);
    const x = this.sx(wx, scale);
    const y = this.sy(FLOOR_Y, scale);
    const shearX = ((wx - this.view.camX) * scale) / Math.max(0.3, wz);
    const shearY = ((FLOOR_Y - this.view.camY) * scale) / Math.max(0.3, wz);
    if (!Number.isFinite(shearX) || !Number.isFinite(shearY) || Math.abs(shearY) < 1e-6) return 0;
    ctx.setTransform(scale / unit, 0, shearX / unit, shearY / unit, x, y);
    return scale;
  }

  // -- cached architecture ------------------------------------------------

  ensureStone(frame) {
    const resized = this.arch.match(frame.width, frame.height);
    if (!resized && !this.dirty) return;
    this.dirty = false;
    this.buildStone(frame);
  }

  buildStone(frame) {
    const ctx = this.arch.ctx;
    if (!ctx || this.arch.width < 8) return;
    const { mulberry32 } = this.kit;
    const ratio = frame.ratio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.arch.width, this.arch.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    const random = mulberry32(STONE_SEED);
    this.paintShell(ctx, ratio);
    this.paintFloorPlan(ctx, ratio);
    this.paintVault(ctx, ratio, random);
    this.paintColonnade(ctx, ratio, random);
    this.paintCarvings(ctx, ratio, random);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Walls, floor and aisle darkness: the large tonal masses. */
  paintShell(ctx, ratio) {
    const { palette } = this.kit;
    const nearScale = this.depthScale(Z_FLOOR_NEAR);
    const farScale = this.depthScale(Z_FADE);

    // Floor slab, lifting toward the far end where the haze sits on it.
    const floorNear = this.sy(FLOOR_Y, nearScale);
    const floorFar = this.sy(FLOOR_Y, farScale);
    const floorFill = ctx.createLinearGradient(0, floorNear, 0, floorFar);
    floorFill.addColorStop(0, "rgba(16,14,18,1)");
    floorFill.addColorStop(0.55, "rgba(26,23,29,1)");
    floorFill.addColorStop(1, "rgba(44,38,52,0.92)");
    ctx.fillStyle = floorFill;
    ctx.beginPath();
    ctx.moveTo(this.sx(-PIER_IN, nearScale), floorNear);
    ctx.lineTo(this.sx(PIER_IN, nearScale), floorNear);
    ctx.lineTo(this.sx(PIER_IN, farScale), floorFar);
    ctx.lineTo(this.sx(-PIER_IN, farScale), floorFar);
    ctx.closePath();
    ctx.fill();

    // Side walls up to the clerestory sill.  One gradient per side: cold and
    // near-black at the frame edge, hazier as it recedes.
    const sillY = CAP_Y - 1.32;
    for (const side of [-1, 1]) {
      const nearX = this.sx(side * WALL_X, nearScale);
      const farX = this.sx(side * WALL_X, farScale);
      const wall = ctx.createLinearGradient(nearX, 0, farX, 0);
      wall.addColorStop(0, "rgba(13,12,16,1)");
      wall.addColorStop(0.62, "rgba(22,20,27,0.96)");
      wall.addColorStop(1, "rgba(40,35,50,0.8)");
      ctx.fillStyle = wall;
      ctx.beginPath();
      ctx.moveTo(nearX, this.sy(FLOOR_Y, nearScale));
      ctx.lineTo(nearX, this.sy(sillY, nearScale));
      ctx.lineTo(farX, this.sy(sillY, farScale));
      ctx.lineTo(farX, this.sy(FLOOR_Y, farScale));
      ctx.closePath();
      ctx.fill();
    }

    // Clerestory band: dim glazed rectangles between the piers.  These are the
    // only openings we ever see; the shaft source itself stays off frame.
    for (let bay = 1; bay < BAY_COUNT - 1; bay += 1) {
      const front = this.bays[bay] + 0.14;
      const back = this.bays[bay + 1] - 0.14;
      if (back <= front) continue;
      const frontScale = this.depthScale(front);
      const backScale = this.depthScale(back);
      const fog = this.kit.depthFade(this.bays[bay], 0.9, Z_FADE + 2);
      for (const side of [-1, 1]) {
        const x0 = this.sx(side * WALL_X, frontScale);
        const x1 = this.sx(side * WALL_X, backScale);
        const top0 = this.sy(sillY - 0.02, frontScale);
        const bottom0 = this.sy(CAP_Y - 0.44, frontScale);
        const top1 = this.sy(sillY - 0.02, backScale);
        const bottom1 = this.sy(CAP_Y - 0.44, backScale);
        const glass = ctx.createLinearGradient(x0, top0, x0, bottom0);
        // Light falls from above, so the sill end of the opening is dimmest.
        glass.addColorStop(0, palette.bone(0.15 * fog));
        glass.addColorStop(0.7, palette.bone(0.05 * fog));
        glass.addColorStop(1, palette.bone(0.012 * fog));
        ctx.fillStyle = glass;
        ctx.beginPath();
        ctx.moveTo(x0, top0);
        ctx.lineTo(x1, top1);
        ctx.lineTo(x1, bottom1);
        ctx.lineTo(x0, bottom0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = palette.bone(0.09 * fog);
        ctx.lineWidth = Math.max(1, ratio * 0.8);
        ctx.beginPath();
        ctx.moveTo(x0, top0);
        ctx.lineTo(x1, top1);
        ctx.stroke();
      }
    }
  }

  /** Flagstone joints: transverse rungs plus longitudinals to the vanishing point. */
  paintFloorPlan(ctx, ratio) {
    const { palette, depthFade } = this.kit;
    const farScale = this.depthScale(Z_FADE);
    const nearScale = this.depthScale(Z_FLOOR_NEAR);

    for (let z = Z_FLOOR_NEAR; z < Z_FADE; z *= 1.105) {
      const scale = this.depthScale(z);
      const fog = depthFade(z, 0.5, Z_FADE + 1.4);
      const y = this.sy(FLOOR_Y, scale);
      ctx.strokeStyle = palette.bone(0.03 + 0.1 * fog);
      ctx.lineWidth = Math.max(1, ratio * (0.5 + fog));
      ctx.beginPath();
      ctx.moveTo(this.sx(-PIER_IN, scale), y);
      ctx.lineTo(this.sx(PIER_IN, scale), y);
      ctx.stroke();
    }

    for (const lane of [-PIER_IN, -0.53, -0.26, 0, 0.26, 0.53, PIER_IN]) {
      const joint = ctx.createLinearGradient(
        this.sx(lane, nearScale), this.sy(FLOOR_Y, nearScale),
        this.sx(lane, farScale), this.sy(FLOOR_Y, farScale),
      );
      joint.addColorStop(0, palette.bone(0.13));
      joint.addColorStop(1, palette.bone(0.015));
      ctx.strokeStyle = joint;
      ctx.lineWidth = Math.max(1, ratio * 0.9);
      ctx.beginPath();
      ctx.moveTo(this.sx(lane, nearScale), this.sy(FLOOR_Y, nearScale));
      ctx.lineTo(this.sx(lane, farScale), this.sy(FLOOR_Y, farScale));
      ctx.stroke();
    }
  }

  /** Transverse gothic arches, the ridge and springing lines, one collapse. */
  paintVault(ctx, ratio, random) {
    const { palette, depthFade } = this.kit;
    const profile = this.vault;
    const count = profile.length / 2;
    const collapsed = 4 + Math.floor(random() * 2);

    for (let bay = 0; bay < BAY_COUNT; bay += 1) {
      const z = this.bays[bay];
      const scale = this.depthScale(z);
      const fog = depthFade(z, 0.8, Z_FADE + 2.2);
      if (fog <= 0.02) continue;
      const broken = bay === collapsed;
      ctx.strokeStyle = palette.bone(0.06 + 0.22 * fog);
      ctx.lineWidth = Math.max(1, ratio * (0.7 + 1.5 * fog));
      ctx.beginPath();
      for (let point = 0; point < count; point += 1) {
        // A collapsed bay keeps its two haunches and loses the crown.
        if (broken && point > count * 0.3 && point < count * 0.74) {
          if (point === Math.ceil(count * 0.74)) ctx.moveTo(this.sx(profile[point * 2], scale), this.sy(profile[point * 2 + 1], scale));
          continue;
        }
        const x = this.sx(profile[point * 2], scale);
        const y = this.sy(profile[point * 2 + 1], scale);
        if (point === 0 || (broken && point === Math.ceil(count * 0.74))) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (broken) {
        // Sky through the hole: the only cold light in the upper frame.
        const holeScale = scale;
        ctx.fillStyle = palette.muted(0.05 * fog);
        ctx.beginPath();
        ctx.moveTo(this.sx(-0.34, holeScale), this.sy(APEX_Y + 0.04, holeScale));
        ctx.lineTo(this.sx(0.1, holeScale), this.sy(APEX_Y - 0.12, holeScale));
        ctx.lineTo(this.sx(0.36, holeScale), this.sy(APEX_Y + 0.16, holeScale));
        ctx.lineTo(this.sx(-0.05, holeScale), this.sy(APEX_Y + 0.3, holeScale));
        ctx.closePath();
        ctx.fill();
      }
    }

    // Ridge and springing lines all converge on the vanishing point.
    const nearScale = this.depthScale(this.bays[0]);
    const farScale = this.depthScale(Z_FADE);
    for (const [wx, wy, alpha] of [[0, APEX_Y, 0.16], [-PIER_IN, CAP_Y, 0.2], [PIER_IN, CAP_Y, 0.2]]) {
      const rib = ctx.createLinearGradient(
        this.sx(wx, nearScale), this.sy(wy, nearScale),
        this.sx(wx, farScale), this.sy(wy, farScale),
      );
      rib.addColorStop(0, palette.bone(alpha));
      rib.addColorStop(1, palette.bone(0.02));
      ctx.strokeStyle = rib;
      ctx.lineWidth = Math.max(1, ratio * 1.1);
      ctx.beginPath();
      ctx.moveTo(this.sx(wx, nearScale), this.sy(wy, nearScale));
      ctx.lineTo(this.sx(wx, farScale), this.sy(wy, farScale));
      ctx.stroke();
    }

    // Groin ribs on the near bays only — further back they turn to mush.
    for (let bay = 0; bay < 4; bay += 1) {
      const z = this.bays[bay];
      const mid = (z + this.bays[bay + 1]) * 0.5;
      const scale = this.depthScale(z);
      const midScale = this.depthScale(mid);
      const fog = depthFade(z, 0.8, Z_FADE);
      ctx.strokeStyle = palette.bone(0.05 + 0.09 * fog);
      ctx.lineWidth = Math.max(1, ratio * 0.85);
      ctx.beginPath();
      for (const side of [-1, 1]) {
        ctx.moveTo(this.sx(side * PIER_IN, scale), this.sy(CAP_Y, scale));
        ctx.lineTo(this.sx(0, midScale), this.sy(APEX_Y, midScale));
      }
      ctx.stroke();
    }
  }

  /** Piers as real boxes — front face, lit inner face, capital, plinth, decay. */
  paintColonnade(ctx, ratio, random) {
    const { palette, depthFade } = this.kit;
    const missing = 6;

    for (let bay = BAY_COUNT - 1; bay >= 0; bay -= 1) {
      const z = this.bays[bay];
      const fog = depthFade(z, 0.8, Z_FADE + 2.2);
      if (fog <= 0.02) continue;
      const half = 0.075 + z * 0.012;
      const front = this.depthScale(z - half);
      const back = this.depthScale(z + half);
      const stump = bay === missing;
      const capless = bay === 3 || bay === 7;

      // Arcade opening behind the colonnade: near-black, so the piers read as
      // solid mass against a void rather than as lines on a wall.
      if (bay < BAY_COUNT - 1) {
        const nextZ = this.bays[bay + 1];
        const nextFront = this.depthScale(nextZ - half);
        const spanZ = (nextZ - half) - (z + half);
        if (spanZ > 0.02) {
          const midZ = (z + half + nextZ - half) * 0.5;
          const radius = spanZ * 0.5;
          for (const side of [-1, 1]) {
            ctx.fillStyle = `rgba(6,5,8,${0.82 + 0.14 * fog})`;
            ctx.beginPath();
            ctx.moveTo(this.sx(side * PIER_IN, back), this.sy(FLOOR_Y, back));
            ctx.lineTo(this.sx(side * PIER_IN, back), this.sy(CAP_Y, back));
            for (let step = 0; step <= 9; step += 1) {
              const angle = (step / 9) * Math.PI;
              const az = midZ - Math.cos(angle) * radius;
              const ay = CAP_Y - Math.sin(angle) * radius;
              const arcScale = this.depthScale(az);
              ctx.lineTo(this.sx(side * PIER_IN, arcScale), this.sy(ay, arcScale));
            }
            ctx.lineTo(this.sx(side * PIER_IN, nextFront), this.sy(FLOOR_Y, nextFront));
            ctx.closePath();
            ctx.fill();
            // Arch soffit line over the opening.
            ctx.strokeStyle = palette.bone(0.05 + 0.16 * fog);
            ctx.lineWidth = Math.max(1, ratio * (0.6 + fog));
            ctx.beginPath();
            for (let step = 0; step <= 9; step += 1) {
              const angle = (step / 9) * Math.PI;
              const az = midZ - Math.cos(angle) * radius;
              const ay = CAP_Y - Math.sin(angle) * radius;
              const arcScale = this.depthScale(az);
              const x = this.sx(side * PIER_IN, arcScale);
              const y = this.sy(ay, arcScale);
              if (step === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
      }

      for (const side of [-1, 1]) {
        const top = stump ? FLOOR_Y - 0.34 : CAP_Y;
        // Inner face — the one the candles reach.  A per-pier gradient is free
        // here because the whole colonnade is cached.
        const faceTop = this.sy(top, front);
        const faceBottom = this.sy(FLOOR_Y, front);
        const face = ctx.createLinearGradient(0, faceBottom, 0, faceTop);
        face.addColorStop(0, palette.amber(0.16 * fog));
        face.addColorStop(0.22, palette.bone(0.13 * fog));
        face.addColorStop(1, palette.bone(0.035 * fog));
        ctx.fillStyle = face;
        ctx.beginPath();
        ctx.moveTo(this.sx(side * PIER_IN, front), faceBottom);
        ctx.lineTo(this.sx(side * PIER_IN, front), faceTop);
        ctx.lineTo(this.sx(side * PIER_IN, back), this.sy(top, back));
        ctx.lineTo(this.sx(side * PIER_IN, back), this.sy(FLOOR_Y, back));
        ctx.closePath();
        ctx.fill();

        // Front face, turned away from every light in the room.
        ctx.fillStyle = `rgba(11,10,14,${0.88 + 0.1 * fog})`;
        ctx.beginPath();
        ctx.moveTo(this.sx(side * PIER_IN, front), faceBottom);
        ctx.lineTo(this.sx(side * PIER_IN, front), faceTop);
        ctx.lineTo(this.sx(side * PIER_OUT, front), this.sy(top, front));
        ctx.lineTo(this.sx(side * PIER_OUT, front), faceBottom);
        ctx.closePath();
        ctx.fill();

        // The lit arris — a single heavy highlight is what gives stone volume.
        ctx.strokeStyle = palette.bone(0.1 + 0.34 * fog);
        ctx.lineWidth = Math.max(1, ratio * (0.8 + 1.6 * fog));
        ctx.beginPath();
        ctx.moveTo(this.sx(side * PIER_IN, front), faceBottom);
        ctx.lineTo(this.sx(side * PIER_IN, front), faceTop);
        ctx.stroke();

        // Fluting on the inner face.
        ctx.strokeStyle = palette.bone(0.05 * fog);
        ctx.lineWidth = Math.max(1, ratio * 0.7);
        ctx.beginPath();
        for (let flute = 1; flute < 3; flute += 1) {
          const fz = z - half + (half * 2 * flute) / 3;
          const fs = this.depthScale(fz);
          ctx.moveTo(this.sx(side * PIER_IN, fs), this.sy(FLOOR_Y - 0.03, fs));
          ctx.lineTo(this.sx(side * PIER_IN, fs), this.sy(top + 0.04, fs));
        }
        ctx.stroke();

        if (!stump && !capless) {
          // Capital: a slab oversailing the shaft.
          ctx.fillStyle = palette.bone(0.09 + 0.16 * fog);
          ctx.beginPath();
          ctx.moveTo(this.sx(side * (PIER_IN - 0.07), front), this.sy(CAP_Y, front));
          ctx.lineTo(this.sx(side * (PIER_IN - 0.07), front), this.sy(CAP_Y - 0.07, front));
          ctx.lineTo(this.sx(side * PIER_OUT, front), this.sy(CAP_Y - 0.07, front));
          ctx.lineTo(this.sx(side * PIER_OUT, front), this.sy(CAP_Y, front));
          ctx.closePath();
          ctx.fill();
        } else if (capless) {
          // Sheared capital: a jagged break instead of a moulding.
          ctx.strokeStyle = palette.bone(0.16 * fog);
          ctx.lineWidth = Math.max(1, ratio);
          ctx.beginPath();
          ctx.moveTo(this.sx(side * (PIER_IN - 0.02), front), this.sy(CAP_Y + 0.02, front));
          ctx.lineTo(this.sx(side * (PIER_IN - 0.1), front), this.sy(CAP_Y - 0.05, front));
          ctx.lineTo(this.sx(side * PIER_OUT, front), this.sy(CAP_Y + 0.06, front));
          ctx.stroke();
        }

        // Plinth.
        ctx.fillStyle = palette.bone(0.055 + 0.1 * fog);
        ctx.beginPath();
        ctx.moveTo(this.sx(side * (PIER_IN - 0.05), front), this.sy(FLOOR_Y - 0.07, front));
        ctx.lineTo(this.sx(side * (PIER_IN - 0.05), front), this.sy(FLOOR_Y, front));
        ctx.lineTo(this.sx(side * PIER_OUT, front), this.sy(FLOOR_Y, front));
        ctx.lineTo(this.sx(side * PIER_OUT, front), this.sy(FLOOR_Y - 0.07, front));
        ctx.closePath();
        ctx.fill();

        // Cracks and water stains.  Failure, not texture for its own sake.
        if (random() < 0.55) {
          ctx.strokeStyle = `rgba(4,3,6,${0.7 * fog})`;
          ctx.lineWidth = Math.max(1, ratio * 1.3);
          ctx.beginPath();
          let cz = z - half * 0.6;
          let cy = FLOOR_Y - 0.05 - random() * 0.2;
          let cs = this.depthScale(cz);
          ctx.moveTo(this.sx(side * PIER_IN, cs), this.sy(cy, cs));
          for (let joint = 0; joint < 3; joint += 1) {
            cz += (random() - 0.5) * half * 0.7;
            cy -= 0.12 + random() * 0.22;
            cs = this.depthScale(cz);
            ctx.lineTo(this.sx(side * PIER_IN, cs), this.sy(cy, cs));
          }
          ctx.stroke();
        }
        if (random() < 0.4) {
          const stainScale = this.depthScale(z);
          const stainX = this.sx(side * PIER_IN, stainScale);
          const stainY = this.sy(FLOOR_Y - 0.18, stainScale);
          const radius = Math.max(2, 0.22 * stainScale);
          const stain = ctx.createRadialGradient(stainX, stainY, 0, stainX, stainY, radius);
          stain.addColorStop(0, "rgba(5,6,9,0.5)");
          stain.addColorStop(1, "rgba(5,6,9,0)");
          ctx.fillStyle = stain;
          ctx.fillRect(stainX - radius, stainY - radius, radius * 2, radius * 2);
        }
      }

      if (stump) {
        // Rubble where the pier came down.
        for (const side of [-1, 1]) {
          for (let chunk = 0; chunk < 4; chunk += 1) {
            const cz = z + (random() - 0.5) * 0.5;
            const cx = side * (PIER_IN - random() * 0.32);
            const cs = this.depthScale(cz);
            const size = (0.04 + random() * 0.06) * cs;
            const x = this.sx(cx, cs);
            const y = this.sy(FLOOR_Y, cs);
            ctx.fillStyle = `rgba(9,8,12,0.95)`;
            ctx.beginPath();
            ctx.moveTo(x - size, y);
            ctx.lineTo(x - size * 0.4, y - size * 0.9);
            ctx.lineTo(x + size * 0.8, y - size * 0.5);
            ctx.lineTo(x + size, y);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = palette.bone(0.14 * fog);
            ctx.lineWidth = Math.max(1, ratio * 0.8);
            ctx.beginPath();
            ctx.moveTo(x - size * 0.4, y - size * 0.9);
            ctx.lineTo(x + size * 0.8, y - size * 0.5);
            ctx.stroke();
          }
        }
      }
    }
  }

  /** Carved sigils, the wall litany, and the static outer ring of the circle. */
  paintCarvings(ctx, ratio, random) {
    const { palette, FONTS, depthFade } = this.kit;

    // Wall sigils, cut into the plane of the wall so they lean with it.
    for (let mark = 0; mark < 5; mark += 1) {
      const side = mark % 2 === 0 ? 1 : -1;
      const z = this.bays[2 + mark];
      const fog = depthFade(z, 0.8, Z_FADE);
      const scale = this.setWallPlane(ctx, side * WALL_X, CAP_Y - 0.7, z, 1);
      if (!scale) continue;
      ctx.lineWidth = Math.max(0.8, ratio * 1.1) / scale;
      ctx.strokeStyle = palette.bone(0.1 * fog);
      ctx.beginPath();
      ctx.arc(0, 0, 0.16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = palette.violet(0.13 * fog);
      ctx.beginPath();
      const points = 5 + (mark % 3);
      for (let point = 0; point <= points; point += 1) {
        const angle = ((point * 2) % points) * ((Math.PI * 2) / points) - Math.PI * 0.5;
        const x = Math.cos(angle) * 0.14;
        const y = Math.sin(angle) * 0.14;
        if (point === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Litany: dim, dense, illegible-by-design. Right wall carries most of it
    // so the top-left quadrant stays calm for the DOM type.
    for (let line = 0; line < LITANY.length; line += 1) {
      const side = line < 4 ? 1 : -1;
      const z = 1.55 + line * 0.42;
      const fog = depthFade(z, 0.8, Z_FADE);
      const scale = this.setWallPlane(ctx, side * WALL_X, CAP_Y - 0.24 - (line % 2) * 0.17, z, 100);
      if (!scale) continue;
      ctx.font = `${Math.max(4, 11 * ratio)}px ${FONTS.mono}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = palette.bone(0.11 * fog);
      ctx.fillText(LITANY[line], 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Static glyph ring of the summoning circle.  Baking it means the live
    // rings can rotate over a fixed inscription instead of dragging it along.
    const ringZ = 2.5;
    for (let glyph = 0; glyph < 14; glyph += 1) {
      const angle = (glyph / 14) * Math.PI * 2;
      const gx = Math.sin(angle) * 0.86;
      const gz = ringZ + Math.cos(angle) * 0.86;
      if (gz < 1.2) continue;
      const scale = this.setFloorPlane(ctx, gx, gz, 100);
      if (!scale) continue;
      ctx.font = `${Math.max(7, 20 * ratio)}px ${FONTS.mono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = palette.violet(0.2);
      ctx.fillText(glyph % 3 === 0 ? "†" : String.fromCharCode(48 + ((glyph * 7) % 10)), 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Scattered rubble down the nave, lit on top only.
    for (let chunk = 0; chunk < 14; chunk += 1) {
      const z = 1.1 + random() * 3.2;
      const x = (random() * 2 - 1) * 0.7;
      const scale = this.depthScale(z);
      const fog = depthFade(z, 0.8, Z_FADE);
      const size = (0.02 + random() * 0.045) * scale;
      const px = this.sx(x, scale);
      const py = this.sy(FLOOR_Y, scale);
      ctx.fillStyle = "rgba(8,7,11,0.92)";
      ctx.beginPath();
      ctx.moveTo(px - size, py);
      ctx.lineTo(px - size * 0.5, py - size * 0.8);
      ctx.lineTo(px + size * 0.7, py - size * 0.45);
      ctx.lineTo(px + size, py);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = palette.bone(0.16 * fog);
      ctx.lineWidth = Math.max(1, ratio * 0.75);
      ctx.beginPath();
      ctx.moveTo(px - size * 0.5, py - size * 0.8);
      ctx.lineTo(px + size * 0.7, py - size * 0.45);
      ctx.stroke();
    }
  }

  /** Soft glow sprites, drawn once and blitted — cheaper than live gradients. */
  ensureSprites() {
    for (const [layer, inner, mid] of [
      [this.warm, "rgba(255,214,150,0.95)", "rgba(233,140,60,0.34)"],
      [this.cool, "rgba(206,186,255,0.8)", "rgba(122,96,196,0.26)"],
    ]) {
      if (!layer.match(SPRITE, SPRITE) || !layer.ctx) continue;
      const ctx = layer.ctx;
      const half = SPRITE * 0.5;
      const glow = ctx.createRadialGradient(half, half, 0, half, half, half);
      glow.addColorStop(0, inner);
      glow.addColorStop(0.24, mid);
      glow.addColorStop(0.6, "rgba(40,30,60,0.06)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, SPRITE, SPRITE);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, SPRITE, SPRITE);
    }
  }

  blitGlow(ctx, layer, x, y, radius, alpha) {
    if (!layer.canvas || layer.width < 8 || alpha <= 0.002 || !(radius > 0)) return;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.drawImage(layer.canvas, x - radius, y - radius, radius * 2, radius * 2);
  }

  // -- frame --------------------------------------------------------------

  render(frame) {
    const kit = this.kit;
    const { ctx, width, height, audio, palette, detail } = frame;
    if (!ctx || width < 8 || height < 8) return;
    const { clamp, lerp, smoothstep, noise2D, depthFade, fadeTo, TAU } = kit;
    const still = frame.reducedMotion === true;
    const time = frame.time;
    const dt = clamp(frame.dt, 0, 0.08);
    const ratio = frame.ratio || 1;

    // --- slow structure: a 20-35s sway plus dolly, and nothing faster ----
    const wander = still ? 0 : 1;
    const camX = wander * (Math.sin(time * 0.061) * 0.026 + Math.sin(time * 0.0173 + 1.1) * 0.013);
    const camY = wander * (Math.sin(time * 0.043 + 0.6) * 0.011);
    const dolly = 1 + wander * Math.sin(time * 0.031) * 0.005;

    // Cached stone is built at the nominal camera, then blitted with a small
    // parallax offset — the drift is far too small for the approximation to
    // read, and it saves re-stroking four hundred paths every frame.
    this.setView(width, height, 1, 0, 0);
    this.ensureStone(frame);
    this.ensureSprites();
    this.setView(width, height, dolly, camX, camY);
    const view = this.view;
    const span = view.span;

    // --- envelopes: anticipation and decay, never a live value scaled ----
    const beats = audio.beatCount;
    if (beats !== this.lastBeatCount) {
      const fresh = this.lastBeatCount >= 0;
      this.lastBeatCount = beats;
      if (fresh && !still) {
        if (beats % 4 === 0) {
          // Downbeat lights both braziers; off-beats walk down the aisle.
          for (let index = this.votives.length - 2; index < this.votives.length; index += 1) this.flare[index] = 1;
        } else {
          this.flare[beats % Math.max(1, this.votives.length - 2)] = 1;
        }
        if (beats % 8 === 0) this.sigilStep = (this.sigilStep + 1) % 7;
        if (beats % 12 === 0) this.scan = 1;
        if (beats % 16 === 0) this.desecrate = 1;
        if (beats % 32 === 0) this.wordFade = 0;
        if (beats % 4 === 0) this.spawnSparks(2 + Math.round(clamp(audio.bassAtt, 0, 3)));
        // A crow breaks every twenty-fourth hit, or whenever the signal spikes
        // hard enough that something in the roof would have startled.
        if (beats % 24 === 0 || audio.flux > 0.62) this.launchCrow();
        if (beats % 16 === 0) this.preacher.gaze = 1;
        if (beats % 16 === 0) this.preacher.glitch = 1;
      }
      this.refreshReadout(audio);
    }
    if (!this.readout[0]) this.refreshReadout(audio);
    if (still) {
      this.desecrate = 0;
      this.scan = 0;
      this.wordFade = 1;
      this.preacher.presence = 1;
      this.preacher.blink = 0;
      this.preacher.glitch = 0;
    } else {
      const decay = Math.exp(-dt * 2.6);
      for (let index = 0; index < this.flare.length; index += 1) this.flare[index] *= decay;
      this.desecrate *= Math.exp(-dt * 1.1);
      this.scan *= Math.exp(-dt * 1.5);
      this.wordFade = Math.min(1, this.wordFade + dt * 1.4);
      this.spin += dt * (0.016 + audio.midAtt * 0.012);
      if (this.spin > TAU) this.spin -= TAU;
      this.advanceCrows(dt, audio);
      this.advanceSparks(dt);
      this.advancePreacher(dt, time);
    }

    // Idle life so a silent shrine still breathes: candles and haze run off
    // this instead of the audio envelopes.
    const dormant = audio.silent ? 1 : 0;
    const breath = 0.5 + 0.5 * Math.sin(time * 0.34);
    const sacred = lerp(0.4 + 0.6 * clamp(audio.midAtt * 0.5, 0, 1), 0.34 + breath * 0.2, dormant);
    const heat = lerp(0.55 + 0.45 * clamp(audio.level * 3, 0, 1), 0.5 + breath * 0.16, dormant);

    // --- 1. void, then the light at the end of the nave ------------------
    fadeTo(ctx, width, height, palette.void, 1);
    this.paintDistance(frame, sacred);

    // --- 2. the stone ----------------------------------------------------
    if (this.arch.canvas && this.arch.width > 8) {
      const parallax = view.focal / 2.4;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.translate(view.vpx - camX * parallax, view.vpy - camY * parallax);
      ctx.scale(dolly, dolly);
      ctx.translate(-view.vpx, -view.vpy);
      ctx.drawImage(this.arch.canvas, 0, 0, width, height);
      ctx.restore();
    }

    // --- 3. the summoning circle, drawn in the floor plane ---------------
    this.paintCircle(frame, sacred, still);

    // --- 4. aisle candles (occluded by the plinth, as they should be) ----
    this.paintFlames(frame, heat, still, 0);

    // --- 5. volumetrics --------------------------------------------------
    this.paintAether(frame, sacred, heat, still);

    // --- 6. what the fire cannot get past --------------------------------
    // After the aether, not before it: the shadow has to fall on the haze the
    // braziers just lit, or the glow simply paints back over it.
    this.paintCastShadow(frame, heat, still);

    // --- 7. the god, then whatever is sitting on him ---------------------
    this.paintIdol(frame, heat, sacred, still);
    this.paintPerchedCrows(frame, still);

    // --- 8. the fire in front of the plinth, and what comes off it -------
    this.paintFlames(frame, heat, still, 1);
    this.paintSparks(frame, still);

    // --- 9. the celebrant, backlit by that fire --------------------------
    this.paintPreacher(frame, heat, sacred, still);

    // --- 10. foreground: one shaft in front of the idol, then dust ------
    this.paintNearShaft(frame, sacred);
    this.paintDust(frame, still);
    this.paintFlyingCrows(frame, still);

    // --- 11. machine intrusion + inscription -----------------------------
    this.paintOverlay(frame, span, ratio);

    // --- 9. phosphor ------------------------------------------------------
    if (detail > 0.72 && this.bloom.bright.ctx) {
      this.bloom.apply(ctx, ctx.canvas, {
        strength: 0.42,
        blur: 9 * ratio,
        passes: 2,
        threshold: 1,
      });
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
  }

  refreshReadout(audio) {
    const { hexString, serialString } = this.kit;
    const beats = audio.beatCount;
    // The machine keeps a field for the celebrant whether or not one is there,
    // and it never stops filling it in.  That is the joke and the dread.
    const here = this.preacher.presence > 0.5;
    this.readout[0] = `orison 0x${hexString(0.13 + (beats % 4096) * 0.017, 5)}`;
    this.readout[1] = here
      ? `celebrant .... present · ${serialString(beats + 7, 4)}`
      : "celebrant ..... absent";
    this.readout[2] = `vox ${serialString(beats * 3 + 11, 3)} · nihil`;
    this.readout[3] = `integrity 00.0 · ${audio.silent ? "dormant" : "rite"}`;
  }

  /** The haze the far end of the nave dissolves into. */
  paintDistance(frame, sacred) {
    const { ctx, width, height } = frame;
    const view = this.view;
    const key = `${width}x${height}`;
    if (!this.hazeGradient || this.hazeKey !== key) {
      const radius = Math.max(8, view.span * 0.52);
      const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      // Bright enough that the effigy's shadow has something to cut into.  In
      // a nave this dark the shadow is only visible where the haze is not.
      haze.addColorStop(0, "rgba(96,80,144,0.44)");
      haze.addColorStop(0.32, "rgba(56,47,84,0.22)");
      haze.addColorStop(0.7, "rgba(24,20,34,0.07)");
      haze.addColorStop(1, "rgba(0,0,0,0)");
      this.hazeGradient = haze;
      this.hazeKey = key;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(view.vpx - view.camX * view.focal * 0.32, view.vpy - view.camY * view.focal * 0.32);
    ctx.globalAlpha = 0.55 + sacred * 0.45;
    ctx.fillStyle = this.hazeGradient;
    ctx.fillRect(-width, -height, width * 2, height * 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * Traces an outline as a shadow: world units in, a leaning and elongated
   * screen polygon out.  `dir` is the direction the shadow falls, which is
   * away from whichever brazier is casting it.  No allocation, because this
   * runs six times a frame.
   */
  shadowPath(ctx, points, ox, oy, unit, spread, stretch, lean, dir) {
    ctx.beginPath();
    for (let index = 0; index < points.length; index += 2) {
      const rise = FLOOR_Y - points[index + 1];
      const x = ox + (points[index] * spread + dir * rise * lean) * unit;
      const y = oy - rise * stretch * unit;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /**
   * The god's shadow, thrown up the far end of the nave by the two braziers.
   *
   * This is not a projection through a light position — a flame at floor level
   * a metre from the subject projects a silhouette several storeys high, which
   * is geometrically honest and visually useless.  It is the stage version: the
   * silhouette anchored at the plinth, stretched, sheared away from each fire,
   * and wavering on that fire's own flicker.  Two lights, two shadows, leaning
   * apart, darkest where they cross.
   *
   * It lands on the haze rather than the stone, which is the only thing back
   * there bright enough to be darkened.  Three jittered passes stand in for a
   * blur: a soft edge for the price of two extra polygon fills.
   */
  paintCastShadow(frame, heat, still) {
    const { ctx, detail } = frame;
    const time = still ? 9 : frame.time;
    const unit = this.depthScale(IDOL_BACK);
    const originX = this.sx(0, unit);
    const originY = this.sy(FLOOR_Y, unit);
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) return;
    const passes = detail > 0.7 ? 3 : 1;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    for (let index = 0; index < this.braziers.length; index += 1) {
      const lamp = this.votives[this.braziers[index]];
      const flare = this.flare[this.braziers[index]];
      // The shadow is only as steady as the fire behind it.
      const flicker = this.kit.noise2D(lamp.seed * 0.5 + time * 1.35, lamp.seed);
      const dir = lamp.x > 0 ? -1 : 1;
      const spread = 1.24 + flicker * 0.07;
      const stretch = 1.42 + flicker * 0.13 + flare * 0.06;
      const lean = 0.34 + flicker * 0.09;
      const alpha = (0.58 + heat * 0.22 + flare * 0.16) / passes;
      ctx.fillStyle = `rgba(3,2,5,${alpha.toFixed(3)})`;
      for (let pass = 0; pass < passes; pass += 1) {
        const jitter = (pass - (passes - 1) * 0.5) * 3.5;
        this.shadowPath(ctx, IDOL_BODY, originX + jitter, originY, unit, spread, stretch + pass * 0.004, lean, dir);
        ctx.fill();
        this.shadowPath(ctx, IDOL_ARM, originX + jitter, originY, unit, spread, stretch + pass * 0.004, lean, dir);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Rings, a heptagram and spectral ticks, all projected through the floor
   * plane so the circle is a true perspective conic rather than an ellipse.
   */
  paintCircle(frame, sacred, still) {
    const { ctx, ratio, audio, palette, detail, band } = frame;
    const { melPosition, TAU } = this.kit;
    const centreZ = 2.5;
    const spin = still ? 0 : this.spin;
    const steps = Math.max(20, Math.round(40 * detail));

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "butt";

    for (const [radius, alpha, weight] of [[0.78, 0.3, 1.4], [0.7, 0.15, 0.8]]) {
      ctx.strokeStyle = palette.violet(alpha * (0.35 + sacred * 0.65));
      ctx.lineWidth = Math.max(1, ratio * weight);
      ctx.beginPath();
      for (let step = 0; step <= steps; step += 1) {
        const angle = (step / steps) * TAU + spin;
        const z = centreZ + Math.cos(angle) * radius;
        if (z < 1.15) continue;
        const scale = this.depthScale(z);
        const x = this.sx(Math.sin(angle) * radius, scale);
        const y = this.sy(FLOOR_Y - 0.004, scale);
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Heptagram: its chords pass under the plinth, which occludes them.
    ctx.strokeStyle = palette.violet(0.1 + sacred * 0.14);
    ctx.lineWidth = Math.max(1, ratio * 0.9);
    ctx.beginPath();
    for (let point = 0; point <= 7; point += 1) {
      const angle = ((point * 3) % 7) * (TAU / 7) + spin * 0.6 + this.sigilStep * 0.22;
      const z = centreZ + Math.cos(angle) * 0.7;
      const scale = this.depthScale(Math.max(1.2, z));
      const x = this.sx(Math.sin(angle) * 0.7, scale);
      const y = this.sy(FLOOR_Y - 0.006, scale);
      if (point === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Spectral ticks around the rim — the only place the raw bands appear.
    const ticks = Math.max(10, Math.round(22 * detail));
    ctx.lineWidth = Math.max(1, ratio * 1.6);
    ctx.beginPath();
    for (let tick = 0; tick < ticks; tick += 1) {
      const angle = (tick / ticks) * TAU + spin;
      const z0 = centreZ + Math.cos(angle) * 0.78;
      if (z0 < 1.2) continue;
      const magnitude = band(melPosition(tick / ticks));
      const outer = 0.78 + 0.03 + magnitude * 0.14;
      const zOuter = centreZ + Math.cos(angle) * outer;
      if (zOuter < 1.2) continue;
      const inner = this.depthScale(z0);
      const outerScale = this.depthScale(zOuter);
      ctx.moveTo(this.sx(Math.sin(angle) * 0.78, inner), this.sy(FLOOR_Y - 0.004, inner));
      ctx.lineTo(this.sx(Math.sin(angle) * outer, outerScale), this.sy(FLOOR_Y - 0.004, outerScale));
    }
    ctx.strokeStyle = palette.violet(0.18 + audio.midAtt * 0.16);
    ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * One flame tongue: a spine that wanders on the noise field, widest a third
   * of the way up, closing to a point that leans further than the base does.
   *
   * Both sides are walked from the same spine so the shape stays a tongue
   * rather than a leaf, and the whole thing is one path — three of these
   * stacked is a convincing flame for the price of three fills.
   */
  flameTongue(ctx, px, py, width, height, seed, time, drift) {
    const noise = this.kit.noise2D;
    const STEPS = 6;
    ctx.beginPath();
    ctx.moveTo(px - width * 0.5, py);
    for (let side = 0; side < 2; side += 1) {
      // Up the left edge, then back down the right, so the tip is shared.
      for (let step = 0; step <= STEPS; step += 1) {
        const t = side === 0 ? step / STEPS : 1 - step / STEPS;
        const wander = (noise(seed + t * 2.4, time * 1.9 + t * 3.1) - 0.5) * drift * t * t;
        // Fat low, pinched at the tip: t*(1-t) squared off toward the top.
        const girth = width * (1 - t) * (0.5 + 1.5 * (1 - t) * t * 2.2);
        const edge = side === 0 ? -girth : girth;
        const x = px + wander * height + edge;
        const y = py - t * height;
        if (side === 0 && step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
  }

  /**
   * Flame cores only — the pools and bloom belong to the aether layer.
   *
   * `pass` 0 draws the aisle candles and the offering row, which the plinth is
   * entitled to occlude; `pass` 1 draws the two braziers, which stand in front
   * of it and are drawn after the god for that reason.
   */
  paintFlames(frame, heat, still, pass = 0) {
    const { ctx, ratio, palette, detail } = frame;
    const { noise2D, clamp, depthFade } = this.kit;
    const time = still ? 12 : frame.time;
    const budget = Math.max(0.6, detail);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < this.votives.length; index += 1) {
      const lamp = this.votives[index];
      if ((lamp.kind === 1) !== (pass === 1)) continue;
      if (pass === 0 && index > this.votives.length * budget) continue;
      const scale = this.depthScale(lamp.z);
      const fog = depthFade(lamp.z, 0.8, 6.4);
      if (fog <= 0.03) continue;
      // Noise, not a sine: a sine reads as a machine, noise reads as a flame.
      const flick = noise2D(lamp.seed + time * (lamp.kind ? 5.2 : 7.4), lamp.seed * 0.37);
      const voice = frame.band(lamp.band);
      const flare = this.flare[index];
      const life = (0.55 + flick * 0.45) * heat + voice * 0.5 + flare * 0.8;
      const px = this.sx(lamp.x, scale);
      const py = this.sy(lamp.y, scale);
      // Braziers get the height; the aisle candles stay small so the fire in
      // front of the plinth is unmistakably the loudest light in the room.
      const reach = lamp.size * (lamp.kind ? 1.8 : 0.95) * (0.85 + flick * 0.5 + flare * 0.8 + voice * 0.55);
      const flameH = Math.max(1.5, reach * scale);
      const flameW = Math.max(1, flameH * (lamp.kind ? 0.4 : 0.3));
      const drift = lamp.kind ? 0.5 : 0.34;

      if (lamp.kind) {
        // Brazier bowl, drawn first so the fire sits inside it.
        const bowl = 0.072 * scale;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(9,8,11,0.97)";
        ctx.beginPath();
        ctx.moveTo(px - bowl, py - bowl * 0.2);
        ctx.lineTo(px + bowl, py - bowl * 0.2);
        ctx.lineTo(px + bowl * 0.6, py + bowl * 0.75);
        ctx.lineTo(px - bowl * 0.6, py + bowl * 0.75);
        ctx.closePath();
        ctx.fill();
        // Tripod legs — they read as a stand rather than a bowl on the floor.
        ctx.strokeStyle = "rgba(9,8,11,0.95)";
        ctx.lineWidth = Math.max(1, ratio * 1.6);
        ctx.beginPath();
        for (const foot of [-1, 0, 1]) {
          ctx.moveTo(px + foot * bowl * 0.4, py + bowl * 0.7);
          ctx.lineTo(px + foot * bowl * 0.85, this.sy(FLOOR_Y, scale));
        }
        ctx.stroke();
        ctx.globalCompositeOperation = "lighter";
        // The rim catches its own fire.
        ctx.strokeStyle = palette.ember((0.28 + life * 0.3) * fog);
        ctx.lineWidth = Math.max(1, ratio * 1.3);
        ctx.beginPath();
        ctx.moveTo(px - bowl, py - bowl * 0.2);
        ctx.lineTo(px + bowl, py - bowl * 0.2);
        ctx.stroke();
      }

      // Three nested tongues: a wide ember body, an amber heart, a white core.
      // Each runs on its own slice of the noise field so they slide against
      // each other instead of scaling as one rubber shape.  Additive stacking
      // means the alphas have to stay low or the whole thing clips to white.
      const ink = (lamp.kind ? 1.5 : 0.82) * fog;
      ctx.fillStyle = palette.ember(clamp(0.12 + life * 0.26, 0, 0.58) * ink);
      this.flameTongue(ctx, px, py, flameW * 1.15, flameH, lamp.seed, time, drift);
      ctx.fill();
      ctx.fillStyle = palette.amber(clamp(0.13 + life * 0.28, 0, 0.6) * ink);
      this.flameTongue(ctx, px, py, flameW * 0.66, flameH * 0.74, lamp.seed + 21.5, time * 1.24, drift * 0.8);
      ctx.fill();
      ctx.fillStyle = palette.bone(clamp(0.1 + life * 0.3, 0, 0.62) * ink);
      this.flameTongue(ctx, px, py, flameW * 0.3, flameH * 0.4, lamp.seed + 47.1, time * 1.55, drift * 0.55);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  /** Embers off the braziers, on downbeats and on the fire's own account. */
  spawnSparks(count) {
    const random = this.sparkRandom;
    for (let made = 0; made < count; made += 1) {
      const lamp = this.votives[this.braziers[made % this.braziers.length]];
      const slot = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % SPARK_MAX;
      this.sparkX[slot] = lamp.x + (random() - 0.5) * 0.12;
      this.sparkY[slot] = lamp.y - lamp.size * (0.6 + random() * 0.8);
      this.sparkZ[slot] = lamp.z + (random() - 0.5) * 0.16;
      this.sparkVX[slot] = (random() - 0.5) * 0.055;
      this.sparkVY[slot] = -(0.14 + random() * 0.26);
      this.sparkLife[slot] = 1;
      this.sparkSeed[slot] = random() * 80;
    }
  }

  advanceSparks(dt) {
    for (let index = 0; index < SPARK_MAX; index += 1) {
      const life = this.sparkLife[index];
      if (life <= 0) continue;
      // Embers slow as they cool and wander sideways on the updraught.
      this.sparkVY[index] *= Math.exp(-dt * 0.75);
      this.sparkX[index] += this.sparkVX[index] * dt;
      this.sparkY[index] += this.sparkVY[index] * dt;
      this.sparkVX[index] += (this.kit.noise2D(this.sparkSeed[index], this.sparkY[index] * 4) - 0.5) * dt * 0.22;
      this.sparkLife[index] = Math.max(0, life - dt * (0.35 + this.sparkSeed[index] % 0.24));
    }
  }

  paintSparks(frame, still) {
    if (still) return;
    const { ctx, palette } = frame;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    // The whole pool every frame: live embers land at arbitrary slots in the
    // ring, so a shortened loop would drop the newest ones, not the cheapest.
    for (let index = 0; index < SPARK_MAX; index += 1) {
      const life = this.sparkLife[index];
      if (life <= 0.01) continue;
      const scale = this.depthScale(this.sparkZ[index]);
      const px = this.sx(this.sparkX[index], scale);
      const py = this.sy(this.sparkY[index], scale);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      // An ember cools from white through amber to ember red as it dies.
      const heat = life * life;
      const size = Math.max(1, 0.0095 * scale * (0.4 + heat));
      ctx.fillStyle = heat > 0.55 ? palette.bone(life * 0.85) : palette.ember(life * 0.8);
      ctx.fillRect(px - size * 0.5, py - size * 0.5, size, size * (1 + (1 - heat) * 1.6));
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  // -- the flock ----------------------------------------------------------

  /** Startles one bird off its perch.  Two in the air at once is the ceiling. */
  launchCrow() {
    if (this.crowCooldown > 0) return;
    let airborne = 0;
    for (const crow of this.crows) if (crow.flight >= 0) airborne += 1;
    if (airborne >= 2) return;
    for (const crow of this.crows) {
      if (crow.flight >= 0) continue;
      crow.flight = 0;
      this.crowCooldown = 3.2;
      return;
    }
  }

  advanceCrows(dt) {
    this.crowCooldown = Math.max(0, (this.crowCooldown || 0) - dt);
    for (const crow of this.crows) {
      if (crow.flight < 0) continue;
      crow.flight += dt / 2.7;
      if (crow.flight > 1) crow.flight = -1;
    }
  }

  /**
   * One crow.  A folded silhouette when `flap` is null, wings out when it is
   * not — the same bird either way, which is what stops a departure from
   * looking like one thing vanishing and a different thing appearing.
   */
  drawCrow(ctx, px, py, size, facing, alpha, glint, flap) {
    const { palette } = this.kit;
    const s = size;
    const f = facing;
    ctx.globalAlpha = alpha;

    if (flap !== null) {
      // Wings first, so the body reads as sitting in front of the near one.
      const angle = Math.sin(flap) * 1.02;
      const shoulderX = px + f * s * 0.05;
      const shoulderY = py - s * 0.04;
      ctx.fillStyle = "rgba(4,3,6,0.96)";
      for (const wing of [-1, 1]) {
        const tipX = shoulderX + wing * s * (0.62 + 0.32 * Math.cos(angle));
        const tipY = shoulderY - s * 0.95 * Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(shoulderX, shoulderY);
        ctx.quadraticCurveTo(shoulderX + wing * s * 0.42, shoulderY - s * 0.16 + (tipY - shoulderY) * 0.5, tipX, tipY);
        ctx.quadraticCurveTo(shoulderX + wing * s * 0.34, shoulderY + s * 0.2 + (tipY - shoulderY) * 0.28, shoulderX, shoulderY + s * 0.11);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Body: tail, back, breast.  Perched birds sit up; flying birds lie flat.
    const crouch = flap === null ? 1 : 0.62;
    ctx.fillStyle = "rgba(4,3,6,0.99)";
    ctx.beginPath();
    ctx.moveTo(px + f * -0.6 * s, py - 0.3 * s * crouch);
    ctx.lineTo(px + f * -1.02 * s, py - (flap === null ? 0.15 : 0.34) * s);
    ctx.lineTo(px + f * -0.58 * s, py - 0.15 * s * crouch);
    ctx.lineTo(px + f * 0.06 * s, py - 0.12 * s * crouch);
    ctx.lineTo(px + f * 0.34 * s, py - 0.3 * s * crouch);
    ctx.lineTo(px + f * 0.2 * s, py - 0.5 * s * crouch);
    ctx.lineTo(px + f * -0.2 * s, py - 0.5 * s * crouch);
    ctx.closePath();
    ctx.fill();

    // Head and beak.
    const headX = px + f * 0.3 * s;
    const headY = py - (flap === null ? 0.62 : 0.4) * s;
    ctx.beginPath();
    ctx.arc(headX, headY, s * 0.19, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(headX + f * 0.15 * s, headY - 0.04 * s);
    ctx.lineTo(headX + f * 0.46 * s, headY + 0.01 * s);
    ctx.lineTo(headX + f * 0.14 * s, headY + 0.09 * s);
    ctx.closePath();
    ctx.fill();

    if (flap === null) {
      // Legs, and a bone edge along the back so it does not vanish into stone.
      ctx.strokeStyle = "rgba(4,3,6,0.99)";
      ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.beginPath();
      ctx.moveTo(px + f * 0.02 * s, py - 0.14 * s);
      ctx.lineTo(px + f * 0.02 * s, py);
      ctx.moveTo(px + f * 0.16 * s, py - 0.16 * s);
      ctx.lineTo(px + f * 0.13 * s, py);
      ctx.stroke();
      ctx.strokeStyle = palette.bone(0.15 * alpha);
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(px + f * -0.58 * s, py - 0.3 * s);
      ctx.lineTo(px + f * -0.2 * s, py - 0.5 * s);
      ctx.lineTo(px + f * 0.2 * s, py - 0.5 * s);
      ctx.stroke();
    }

    // The eye takes the fire.  It is the only warm point above the flames.
    if (glint > 0.01 && s > 7) {
      ctx.fillStyle = palette.amber(glint);
      ctx.beginPath();
      ctx.arc(headX + f * 0.06 * s, headY - 0.03 * s, Math.max(0.7, s * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Perched birds: capitals down the aisles, and two on the god himself. */
  paintPerchedCrows(frame, still) {
    const { ctx, detail } = frame;
    const { noise2D, depthFade } = this.kit;
    const time = still ? 3 : frame.time;
    if (detail < 0.62) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    for (const crow of this.crows) {
      if (crow.flight >= 0) continue;
      const scale = this.depthScale(crow.z);
      const fog = depthFade(crow.z, 0.8, 5.4);
      if (fog <= 0.06) continue;
      const size = Math.max(3, 0.075 * scale);
      // Never still, never animated: a slow ruffle and a head that resettles.
      const ruffle = noise2D(crow.seed + time * 0.42, crow.seed * 0.3) - 0.5;
      const px = this.sx(crow.x, scale) + ruffle * size * 0.1;
      const py = this.sy(crow.y, scale) - Math.abs(ruffle) * size * 0.08;
      this.drawCrow(ctx, px, py, size, crow.facing, 0.55 + fog * 0.45, 0.34 * fog, null);
    }
    ctx.restore();
  }

  /** Whatever is currently coming at the camera. */
  paintFlyingCrows(frame, still) {
    if (still) return;
    const { ctx } = frame;
    const { lerp } = this.kit;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    for (const crow of this.crows) {
      if (crow.flight < 0) continue;
      const pose = crowFlight(crow.flight);
      const z = lerp(0.44, crow.z, pose.depth);
      const scale = this.depthScale(z);
      // It leaves the perch, drifts toward the nave axis, and rises as it comes.
      const x = lerp(crow.x * 0.35, crow.x, pose.depth) + pose.sway;
      const y = crow.y - pose.lift * 0.42;
      const px = this.sx(x, scale);
      const py = this.sy(y, scale);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      this.drawCrow(ctx, px, py, Math.max(4, 0.075 * scale), crow.facing, pose.alpha, 0.2, pose.flap);
    }
    ctx.restore();
  }

  /**
   * The additive half-resolution light layer: candle pools, god-rays, incense
   * and the haze the idol stands against.  FeedbackWarp drifts it upward and
   * decays it, which is what turns a dozen gradients into volume.
   */
  paintAether(frame, sacred, heat, still) {
    const { ctx, width, height, audio, detail } = frame;
    const aether = this.aether;
    aether.match(width, height);
    const target = aether.ctx;
    if (!target || aether.width < 8) return;
    const scaleToLayer = aether.width / width;

    this.aetherFrame.ctx = target;
    this.aetherFrame.width = aether.width;
    this.aetherFrame.height = aether.height;
    if (still) {
      aether.fade("#000000", 1);
    } else {
      this.feedback.warp(this.aetherFrame, {
        // Glacial: incense, not wind.  Upward drift plus a breath of expansion.
        zoom: 1.0016,
        dx: Math.sin(frame.time * 0.09) * 0.00028,
        dy: -0.00042 - audio.level * 0.0004,
        cx: 0.5,
        cy: 0.62,
        decay: 0.9,
        warp: detail > 0.85 ? 0.03 : 0,
        warpScale: 1.6,
        warpPhase: frame.time * 0.04,
        grid: 10,
        background: "#000000",
      });
    }

    target.setTransform(scaleToLayer, 0, 0, scaleToLayer, 0, 0);
    target.globalCompositeOperation = "lighter";
    target.globalAlpha = 1;

    // Haze behind the god: this is the silhouette light, and the single most
    // important element in the frame.
    const idolScale = this.depthScale(3.1);
    this.blitGlow(
      target, this.cool,
      this.sx(0.02, idolScale), this.sy(CAP_Y + 0.34, idolScale),
      Math.max(8, 1.7 * idolScale), 0.2 + sacred * 0.24,
    );

    // Candle pools on the floor and the warm wash they throw on the piers.
    // The braziers are held to a tighter, dimmer pool than their flame size
    // implies: they sit close to the camera, and at this range an honest
    // falloff merges both of them into one lit floor and buries the scene.
    for (let index = 0; index < this.votives.length; index += 1) {
      const lamp = this.votives[index];
      const scale = this.depthScale(lamp.z);
      const fog = this.kit.depthFade(lamp.z, 0.8, 6.6);
      if (fog <= 0.03) continue;
      const flick = this.kit.noise2D(lamp.seed + (still ? 12 : frame.time) * 6.1, lamp.seed * 0.71);
      const flare = this.flare[index];
      // A brazier throws a small hot pool; an aisle candle throws a wide weak
      // one.  Driving both off the same falloff is what merges twelve candles
      // into a lit runway down each aisle and flattens the whole floor.
      const spill = lamp.kind ? 2.5 : 3.9;
      const wash = lamp.kind ? 0.115 : 0.05;
      const surge = lamp.kind ? 0.28 : 0.14;
      const radius = Math.max(4, (lamp.size * (spill + flare * 3.4) + 0.08) * scale);
      this.blitGlow(
        target, this.warm,
        this.sx(lamp.x, scale), this.sy(lamp.y - lamp.size * 0.6, scale),
        radius, (wash + flick * 0.035 + flare * surge) * heat * fog,
      );
    }

    // God-rays from the right clerestory, landing left of the nave axis.  The
    // opening itself is off frame — the light has no visible source.
    const rays = Math.max(2, Math.round(3 * Math.max(0.6, detail)));
    target.globalAlpha = 1;
    for (let ray = 0; ray < rays; ray += 1) {
      const z0 = 1.9 + ray * 0.72;
      const z1 = z0 + 0.46;
      const topY = CAP_Y - 1.18;
      const dropX = -1.72;
      const dropZ = 0.5;
      const s0 = this.depthScale(z0);
      const s1 = this.depthScale(z1);
      const f0 = this.depthScale(z0 + dropZ);
      const f1 = this.depthScale(z1 + dropZ);
      const ax = this.sx(WALL_X, s0);
      const ay = this.sy(topY, s0);
      const bx = this.sx(WALL_X, s1);
      const by = this.sy(topY, s1);
      const cx = this.sx(WALL_X + dropX, f1);
      const cy = this.sy(FLOOR_Y, f1);
      const dx = this.sx(WALL_X + dropX, f0);
      const dy = this.sy(FLOOR_Y, f0);
      // Slow independent breathing per shaft; dust density, not a pulse.
      const density = 0.6 + 0.4 * this.kit.noise2D(ray * 5.3, (still ? 4 : frame.time) * 0.11);
      const shaft = target.createLinearGradient(ax, ay, dx, dy);
      shaft.addColorStop(0, `rgba(196,182,224,${0.12 * density * (0.5 + sacred * 0.5)})`);
      shaft.addColorStop(0.45, `rgba(150,138,190,${0.05 * density})`);
      shaft.addColorStop(1, "rgba(90,80,130,0)");
      target.fillStyle = shaft;
      target.beginPath();
      target.moveTo(ax, ay);
      target.lineTo(bx, by);
      target.lineTo(cx, cy);
      target.lineTo(dx, dy);
      target.closePath();
      target.fill();
    }

    // Per-bar light sweep travelling toward the camera: the architecture's
    // musical response is entirely in the lighting.
    if (!still && !audio.silent) {
      const sweepZ = this.kit.lerp(5.4, 1.3, audio.bar);
      const sweepScale = this.depthScale(sweepZ);
      const envelope = Math.sin(audio.bar * Math.PI);
      this.blitGlow(
        target, this.cool,
        this.sx(0, sweepScale), this.sy(FLOOR_Y - 0.3, sweepScale),
        Math.max(6, 1.1 * sweepScale), 0.07 * envelope * (0.4 + audio.midAtt * 0.5),
      );
    }

    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalCompositeOperation = "source-over";
    target.globalAlpha = 1;
    if (!still) this.feedback.store(this.aetherFrame);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(aether.canvas, 0, 0, width, height);
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * The idol.  Geometry only — mass, plinth, shoulders, a missing head under
   * an intact halo, a hollow chest and an armature showing through the break.
   * It breathes from its base on `bassAtt` and otherwise does not move.
   */
  paintIdol(frame, heat, sacred, still) {
    const { ctx, ratio, audio, palette } = frame;
    const { clamp, lerp, TAU } = this.kit;
    const scale = this.depthScale(IDOL_Z);
    const breath = still ? 1 : 1 + clamp(audio.bassAtt, 0, 3) * 0.006;
    const lean = still ? 0 : Math.sin(frame.time * 0.047) * 0.004;
    // A vertical stretch anchored at the floor: the plinth stays planted.
    const wy = (value) => FLOOR_Y + (value - FLOOR_Y) * breath;
    const wx = (value) => value + lean * (FLOOR_Y - wy(value * 0 + FLOOR_Y));
    const px = (value) => this.sx(value + lean, scale);
    const py = (value) => this.sy(wy(value), scale);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineJoin = "miter";

    // Plinth.  A single slab across the middle of the frame reads as a caption
    // bar sitting on top of the scene rather than as stone standing in it — a
    // flat black rectangle with one bright horizontal edge is exactly what a
    // subtitle box looks like.  So the profile is broken into a footing, a die
    // and an oversailing cornice, each with its own top surface receding to the
    // apse and its own lit arris.  Three lit horizontals at three different
    // widths, uplit from the offering row below, with the joints and the
    // dedication cut into the die: a monument, not a bar.
    const frontScale = this.depthScale(IDOL_FRONT);
    const backScale = this.depthScale(IDOL_BACK);
    const FOOTING_Y = FLOOR_Y - 0.048;
    const DIE_Y = FLOOR_Y - 0.152;
    for (const [half, top, bottom, edge] of [
      [0.73, FOOTING_Y, FLOOR_Y, 1],
      [0.575, DIE_Y, FOOTING_Y, 1],
      [0.63, IDOL_BASE_Y, DIE_Y, 1.7],
    ]) {
      const backHalf = half * 0.86;
      const faceTop = this.sy(top, frontScale);
      const faceBottom = this.sy(bottom, frontScale);
      // Top surface, running back toward the apse.
      ctx.fillStyle = palette.bone(0.035 + heat * 0.03);
      ctx.beginPath();
      ctx.moveTo(this.sx(-half, frontScale), faceTop);
      ctx.lineTo(this.sx(-backHalf, backScale), this.sy(top, backScale));
      ctx.lineTo(this.sx(backHalf, backScale), this.sy(top, backScale));
      ctx.lineTo(this.sx(half, frontScale), faceTop);
      ctx.closePath();
      ctx.fill();
      // Front face, and the candlelight climbing it from the floor.
      ctx.beginPath();
      ctx.moveTo(this.sx(-half, frontScale), faceTop);
      ctx.lineTo(this.sx(half, frontScale), faceTop);
      ctx.lineTo(this.sx(half, frontScale), faceBottom);
      ctx.lineTo(this.sx(-half, frontScale), faceBottom);
      ctx.closePath();
      ctx.fillStyle = "rgba(7,6,9,0.99)";
      ctx.fill();
      if (Number.isFinite(faceTop) && Number.isFinite(faceBottom)) {
        const lit = ctx.createLinearGradient(0, faceBottom, 0, faceTop);
        lit.addColorStop(0, palette.amber(0.15 * heat));
        lit.addColorStop(0.65, palette.ember(0.035 * heat));
        lit.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = lit;
        ctx.fill();
      }
      ctx.strokeStyle = palette.bone(0.11 + heat * 0.15);
      ctx.lineWidth = Math.max(1, ratio * edge);
      ctx.beginPath();
      ctx.moveTo(this.sx(-half, frontScale), faceTop);
      ctx.lineTo(this.sx(half, frontScale), faceTop);
      ctx.stroke();
    }

    // Courses of stone across the die.
    ctx.strokeStyle = "rgba(2,2,3,0.85)";
    ctx.lineWidth = Math.max(1, ratio);
    ctx.beginPath();
    for (const joint of [-0.3, 0.3]) {
      ctx.moveTo(this.sx(joint, frontScale), this.sy(FOOTING_Y, frontScale));
      ctx.lineTo(this.sx(joint, frontScale), this.sy(DIE_Y, frontScale));
    }
    ctx.stroke();

    // The dedication, cut into the die.  Dis Manibus — to the shades — of
    // nobody.  It is a tomb inscription with the name left out.
    this.kit.machineText(ctx, "D · M · NVLLI", this.sx(0, frontScale), this.sy(FLOOR_Y - 0.086, frontScale), {
      size: Math.max(7, 0.038 * frontScale),
      align: "center",
      color: palette.bone(0.09 + heat * 0.07),
      letterSpacing: 0.2,
      shadow: false,
    });

    // Body: a tapering mass with the left shoulder sheared off.  Not a figure,
    // only almost one.
    const baseY = FLOOR_Y - 0.18;
    ctx.beginPath();
    ctx.moveTo(px(-0.33), py(baseY));
    ctx.lineTo(px(-0.3), py(-0.16));
    ctx.lineTo(px(-0.27), py(-0.46));
    ctx.lineTo(px(-0.43), py(-0.53));       // shoulder, broken away
    ctx.lineTo(px(-0.22), py(-0.6));
    ctx.lineTo(px(-0.11), py(-0.66));
    ctx.lineTo(px(-0.1), py(-0.78));        // neck stub
    ctx.lineTo(px(0.1), py(-0.78));
    ctx.lineTo(px(0.12), py(-0.64));
    ctx.lineTo(px(0.29), py(-0.62));
    ctx.lineTo(px(0.45), py(-0.56));        // intact shoulder
    ctx.lineTo(px(0.42), py(-0.42));
    ctx.lineTo(px(0.33), py(-0.34));
    ctx.lineTo(px(0.36), py(0.06));
    ctx.lineTo(px(0.31), py(baseY));
    ctx.closePath();
    ctx.fillStyle = "rgba(5,4,7,0.985)";
    ctx.fill();
    // Votive light climbing the lower body — the warm/cold depth cue.
    const glowTop = py(-0.2);
    const glowBottom = py(baseY);
    if (Number.isFinite(glowTop) && Number.isFinite(glowBottom)) {
      const under = ctx.createLinearGradient(0, glowBottom, 0, glowTop);
      under.addColorStop(0, palette.amber(0.16 * heat));
      under.addColorStop(0.5, palette.ember(0.05 * heat));
      under.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = under;
      ctx.fill();
    }
    // Rim on the lit side only.
    ctx.strokeStyle = palette.bone(0.2 + sacred * 0.2);
    ctx.lineWidth = Math.max(1, ratio * 1.5);
    ctx.beginPath();
    ctx.moveTo(px(0.31), py(baseY));
    ctx.lineTo(px(0.36), py(0.06));
    ctx.lineTo(px(0.33), py(-0.34));
    ctx.lineTo(px(0.42), py(-0.42));
    ctx.lineTo(px(0.45), py(-0.56));
    ctx.lineTo(px(0.29), py(-0.62));
    ctx.stroke();
    // Broken shoulder edge, cold and hard.
    ctx.strokeStyle = palette.muted(0.16);
    ctx.lineWidth = Math.max(1, ratio * 1.1);
    ctx.beginPath();
    ctx.moveTo(px(-0.27), py(-0.46));
    ctx.lineTo(px(-0.43), py(-0.53));
    ctx.lineTo(px(-0.22), py(-0.6));
    ctx.stroke();

    // Robe folds.
    ctx.strokeStyle = palette.bone(0.07 + heat * 0.05);
    ctx.lineWidth = Math.max(1, ratio * 0.9);
    ctx.beginPath();
    for (let fold = 0; fold < 4; fold += 1) {
      const fx = -0.2 + fold * 0.13;
      ctx.moveTo(px(fx), py(baseY - 0.01));
      ctx.lineTo(px(fx * 0.86), py(-0.3 - fold * 0.04));
    }
    ctx.stroke();

    // Chest cavity: a recess where something was taken out.
    const cavityTop = py(-0.42);
    const cavityBottom = py(-0.16);
    ctx.beginPath();
    ctx.moveTo(px(-0.1), cavityBottom);
    ctx.lineTo(px(-0.11), py(-0.34));
    ctx.lineTo(px(0), cavityTop);
    ctx.lineTo(px(0.11), py(-0.34));
    ctx.lineTo(px(0.1), cavityBottom);
    ctx.closePath();
    ctx.fillStyle = "rgba(2,2,3,1)";
    ctx.fill();
    if (Number.isFinite(cavityTop) && Number.isFinite(cavityBottom)) {
      const inner = ctx.createLinearGradient(0, cavityBottom, 0, cavityTop);
      inner.addColorStop(0, palette.violet(0.03));
      inner.addColorStop(1, palette.violet(0.16 * (0.4 + sacred * 0.6)));
      ctx.fillStyle = inner;
      ctx.fill();
    }
    ctx.strokeStyle = palette.violet(0.2 * (0.4 + sacred * 0.6));
    ctx.lineWidth = Math.max(1, ratio);
    ctx.stroke();

    // Missing masonry on the lower right, with the armature behind it.  The
    // machine intrusion is deliberately the only wire green in the scene.
    ctx.beginPath();
    ctx.moveTo(px(0.36), py(0.02));
    ctx.lineTo(px(0.14), py(-0.05));
    ctx.lineTo(px(0.2), py(0.18));
    ctx.lineTo(px(0.37), py(0.24));
    ctx.closePath();
    ctx.fillStyle = "rgba(2,2,3,1)";
    ctx.fill();
    ctx.strokeStyle = palette.wire(0.16 + audio.trebAtt * 0.06);
    ctx.lineWidth = Math.max(1, ratio * 0.8);
    ctx.beginPath();
    for (let strand = 0; strand < 3; strand += 1) {
      const sy0 = 0.0 + strand * 0.07;
      ctx.moveTo(px(0.17), py(sy0 - 0.02));
      ctx.lineTo(px(0.31), py(sy0 + 0.04));
    }
    ctx.stroke();

    // Cracks across the mass.
    ctx.strokeStyle = "rgba(2,2,3,1)";
    ctx.lineWidth = Math.max(1, ratio * 1.4);
    ctx.beginPath();
    ctx.moveTo(px(-0.3), py(-0.22));
    ctx.lineTo(px(-0.14), py(-0.12));
    ctx.lineTo(px(-0.2), py(0.05));
    ctx.lineTo(px(-0.05), py(0.2));
    ctx.moveTo(px(0.05), py(-0.5));
    ctx.lineTo(px(0.16), py(-0.4));
    ctx.stroke();
    ctx.strokeStyle = palette.bone(0.1);
    ctx.lineWidth = Math.max(1, ratio * 0.7);
    ctx.beginPath();
    ctx.moveTo(px(-0.29), py(-0.235));
    ctx.lineTo(px(-0.13), py(-0.135));
    ctx.stroke();

    // Raised right arm, broken off above the elbow.
    ctx.beginPath();
    ctx.moveTo(px(0.4), py(-0.54));
    ctx.lineTo(px(0.56), py(-0.72));
    ctx.lineTo(px(0.66), py(-0.66));
    ctx.lineTo(px(0.52), py(-0.46));
    ctx.closePath();
    ctx.fillStyle = "rgba(5,4,7,0.985)";
    ctx.fill();
    ctx.strokeStyle = palette.bone(0.15 + sacred * 0.12);
    ctx.lineWidth = Math.max(1, ratio * 1.2);
    ctx.beginPath();
    ctx.moveTo(px(0.4), py(-0.54));
    ctx.lineTo(px(0.56), py(-0.72));
    ctx.lineTo(px(0.66), py(-0.66));
    ctx.stroke();

    // The halo survives; the head does not.
    const haloX = px(0);
    const haloY = py(-0.95);
    const haloR = Math.max(2, 0.2 * scale * breath);
    if (Number.isFinite(haloX) && Number.isFinite(haloY)) {
      ctx.strokeStyle = palette.violet(0.24 + sacred * 0.3);
      ctx.lineWidth = Math.max(1, ratio * 1.7);
      ctx.beginPath();
      ctx.arc(haloX, haloY, haloR, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = palette.violet(0.09);
      ctx.lineWidth = Math.max(1, ratio * 0.8);
      ctx.beginPath();
      ctx.arc(haloX, haloY, haloR * 1.24, 0, TAU);
      ctx.stroke();
      // Neck break: a hard jagged line where the head was struck off.
      ctx.strokeStyle = palette.muted(0.2);
      ctx.lineWidth = Math.max(1, ratio * 1.2);
      ctx.beginPath();
      ctx.moveTo(px(-0.1), py(-0.78));
      ctx.lineTo(px(-0.03), py(-0.74));
      ctx.lineTo(px(0.03), py(-0.8));
      ctx.lineTo(px(0.1), py(-0.76));
      ctx.stroke();
    }

    // Desecration: rare, blood, and gone within a second.
    if (this.desecrate > 0.01) {
      const mark = this.desecrate * 0.55;
      ctx.strokeStyle = palette.blood(mark);
      ctx.lineWidth = Math.max(1, ratio * 2.2);
      ctx.beginPath();
      ctx.moveTo(px(-0.16), py(-0.44));
      ctx.lineTo(px(0.14), py(-0.16));
      ctx.moveTo(px(0.14), py(-0.44));
      ctx.lineTo(px(-0.16), py(-0.16));
      ctx.stroke();
    }

    // Machine scan sweeping the effigy every twelve hits.
    if (this.scan > 0.02) {
      const travel = 1 - this.scan;
      const lineY = this.kit.lerp(py(-0.9), py(baseY), travel);
      if (Number.isFinite(lineY)) {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = palette.wire(0.3 * this.scan);
        ctx.lineWidth = Math.max(1, ratio);
        ctx.beginPath();
        ctx.moveTo(px(-0.5), lineY);
        ctx.lineTo(px(0.7), lineY);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
    }

    ctx.restore();
    this.idolHalo = { x: haloX, y: haloY, r: haloR };
  }

  // -- the celebrant ------------------------------------------------------

  advancePreacher(dt, time) {
    const preacher = this.preacher;
    preacher.presence = preacherPresence(time);
    preacher.blink = Math.max(0, preacher.blink - dt);
    preacher.nextBlink -= dt;
    if (preacher.nextBlink <= 0) {
      preacher.blink = 0.11;
      // Irregular, and long enough between blinks to be unsettling rather than
      // busy.  A metronomic blink reads as an animation loop.
      preacher.nextBlink = 2.4 + this.kit.noise2D(time * 3.1, 7.7) * 5.6;
    }
    preacher.glitch *= Math.exp(-dt * 7);
    preacher.gaze *= Math.exp(-dt * 0.85);
  }

  /**
   * The preacher.  A cowl, backlit by the braziers he is standing in front of,
   * with nothing inside the hood except two violet pupils.
   *
   * He is human-scaled on purpose: at 1.5 he is a little over half the height
   * of the effigy behind him, which is the only thing in the frame that says
   * how big the god actually is.  Everything about him is dark except the
   * pupils and the fire on his shoulders — there is nothing behind the
   * interface, and he is the interface.
   */
  paintPreacher(frame, heat, sacred, still) {
    const presence = still ? 0.85 : this.preacher.presence;
    if (presence <= 0.02) return;
    const { ctx, ratio, palette, audio } = frame;
    const { clamp, noise2D, TAU } = this.kit;
    const time = still ? 7 : frame.time;
    const scale = this.depthScale(PREACHER_Z);
    if (!(scale > 0)) return;
    // A breath, and a sway so slow it is only detectable against the piers.
    const swayAmount = still ? 0 : Math.sin(time * 0.29) * 0.004 + noise2D(time * 0.11, 4.2) * 0.006 - 0.003;
    const rise = still ? 1 : 1 + clamp(audio.sustain, 0, 1) * 0.012;
    const px = (u) => this.sx(PREACHER_X + u + swayAmount, scale);
    const py = (v) => this.sy(FLOOR_Y - v * rise * PREACHER_H, scale);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = presence;

    // His own shadow, thrown toward the camera because the fire is behind him.
    const castScale = this.depthScale(0.82);
    ctx.fillStyle = `rgba(3,2,5,${(0.34 * heat).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(px(-0.15), py(0));
    ctx.lineTo(px(0.158), py(0));
    ctx.lineTo(this.sx(PREACHER_X + 0.5, castScale), this.sy(FLOOR_Y, castScale));
    ctx.lineTo(this.sx(PREACHER_X - 0.62, castScale), this.sy(FLOOR_Y, castScale));
    ctx.closePath();
    ctx.fill();

    // The cowl: heavy hem, narrow waist, wide shoulders, and a hood that domes
    // over rather than coming to a point — a peak would read as the wrong kind
    // of hood entirely.  Deliberately not symmetrical about the axis.
    ctx.beginPath();
    ctx.moveTo(px(-0.15), py(0));
    for (const [u, v] of PREACHER_COWL) ctx.lineTo(px(u), py(v));
    ctx.closePath();
    ctx.fillStyle = "rgba(3,3,5,0.995)";
    ctx.fill();

    // Firelight from directly behind: hot edges only, never a closed outline.
    // Stroking the whole silhouette is what makes a backlit figure read as a
    // sticker instead of as a shape with a fire behind it.
    const rim = 0.24 + heat * 0.32;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = palette.amber(rim);
    ctx.lineWidth = Math.max(1, ratio * 1.3);
    ctx.beginPath();
    for (let point = PREACHER_CREST[0]; point <= PREACHER_CREST[1]; point += 1) {
      const [u, v] = PREACHER_COWL[point];
      if (point === PREACHER_CREST[0]) ctx.moveTo(px(u), py(v));
      else ctx.lineTo(px(u), py(v));
    }
    ctx.stroke();
    ctx.strokeStyle = palette.ember(rim * 0.6);
    ctx.lineWidth = Math.max(1, ratio);
    ctx.beginPath();
    for (let point = PREACHER_CREST[2]; point <= PREACHER_CREST[3]; point += 1) {
      const [u, v] = PREACHER_COWL[point];
      if (point === PREACHER_CREST[2]) ctx.moveTo(px(u), py(v));
      else ctx.lineTo(px(u), py(v));
    }
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";

    // Robe folds, only where the rim light would find them.
    ctx.strokeStyle = palette.amber(0.07 * heat);
    ctx.lineWidth = Math.max(1, ratio * 0.8);
    ctx.beginPath();
    for (let fold = 0; fold < 3; fold += 1) {
      const fx = -0.055 + fold * 0.058;
      ctx.moveTo(px(fx), py(0.02));
      ctx.lineTo(px(fx * 0.7), py(0.46));
    }
    ctx.stroke();

    // Cupped hands, the one pale thing on him, holding nothing.
    ctx.fillStyle = palette.bone(0.1 + heat * 0.07);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(px(side * 0.03), py(0.44), Math.max(0.8, 0.013 * scale), Math.max(0.6, 0.008 * scale), side * 0.5, 0, TAU);
      ctx.fill();
    }

    // The hood is empty.  This is a hole, not a face.
    const faceX = px(0.006);
    const faceY = py(0.8);
    const faceW = Math.max(1.5, 0.042 * scale);
    const faceH = Math.max(2, 0.055 * scale);
    ctx.fillStyle = "rgba(1,1,2,1)";
    ctx.beginPath();
    ctx.ellipse(faceX, faceY, faceW, faceH, 0, 0, TAU);
    ctx.fill();
    // The leading edge of the cowl, catching a little of the fire behind it.
    // Without this the hole reads as a hole in the canvas rather than a hood.
    ctx.strokeStyle = palette.amber(0.13 + heat * 0.12);
    ctx.lineWidth = Math.max(1, ratio);
    ctx.beginPath();
    ctx.ellipse(faceX, faceY, faceW * 1.12, faceH * 1.1, 0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    // Pupils.  They drift on `gaze`, they double when the signal breaks, and
    // every so often they are simply not there for a tenth of a second.
    if (this.preacher.blink <= 0) {
      const drift = (noise2D(time * 0.5, 11.3) - 0.5) * this.preacher.gaze * 0.9;
      const gap = faceW * 0.42;
      const pupilR = Math.max(0.9, 0.0085 * scale);
      const glow = 0.55 + sacred * 0.45;
      // A ghost pair on hits: the same eyes, one frame out of register.
      if (this.preacher.glitch > 0.05) {
        ctx.fillStyle = palette.violet(0.28 * this.preacher.glitch);
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(faceX + side * gap + this.preacher.glitch * faceW * 0.5, faceY - faceH * 0.1, pupilR, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "lighter";
      for (const side of [-1, 1]) {
        const eyeX = faceX + side * gap + drift * faceW;
        const eyeY = faceY - faceH * 0.1;
        this.blitGlow(ctx, this.cool, eyeX, eyeY, pupilR * 7, 0.4 * glow * presence);
        ctx.globalAlpha = presence;
        ctx.fillStyle = palette.violet(0.72 + sacred * 0.28);
        ctx.beginPath();
        ctx.arc(eyeX, eyeY, pupilR, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** One shaft in front of the idol so something crosses it. */
  paintNearShaft(frame, sacred) {
    const { ctx } = frame;
    const s0 = this.depthScale(1.12);
    const s1 = this.depthScale(1.42);
    const f0 = this.depthScale(1.62);
    const f1 = this.depthScale(1.92);
    const ax = this.sx(WALL_X, s0);
    const ay = this.sy(CAP_Y - 1.15, s0);
    const bx = this.sx(WALL_X, s1);
    const by = this.sy(CAP_Y - 1.15, s1);
    const cx = this.sx(WALL_X - 1.8, f1);
    const cy = this.sy(FLOOR_Y, f1);
    const dx = this.sx(WALL_X - 1.8, f0);
    const dy = this.sy(FLOOR_Y, f0);
    if (!Number.isFinite(ax) || !Number.isFinite(dy)) return;
    const shaft = ctx.createLinearGradient(ax, ay, dx, dy);
    shaft.addColorStop(0, `rgba(198,186,228,${0.07 * (0.5 + sacred * 0.5)})`);
    shaft.addColorStop(0.5, "rgba(150,140,190,0.022)");
    shaft.addColorStop(1, "rgba(90,80,130,0)");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = shaft;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.lineTo(dx, dy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Dust with parallax by depth.  Motes keep their x/z forever and only their
   * rise wraps, cross-faded at both ends, so recycling never pops.  Anything
   * that lands inside the idol's silhouette while standing behind it is
   * dropped, which is cheaper than sorting and reads as occlusion.
   */
  paintDust(frame, still) {
    const { ctx, width, height, audio, detail, palette } = frame;
    const { clamp, smoothstep, noise2D } = this.kit;
    const count = Math.max(40, Math.round(DUST_MAX * detail));
    const dt = clamp(frame.dt, 0, 0.08);
    const ceiling = APEX_Y - 1.25;
    const spanY = FLOOR_Y - ceiling;
    const time = still ? 5 : frame.time;
    const lift = still ? 0 : dt * (0.4 + clamp(audio.midAtt, 0, 2.5) * 0.34);
    const halo = this.idolHalo;
    const bins = this.dustBins;
    this.dustCounts[0] = 0;
    this.dustCounts[1] = 0;
    this.dustCounts[2] = 0;

    for (let mote = 0; mote < count; mote += 1) {
      let y = this.dustY[mote];
      if (lift > 0) {
        y -= this.dustRise[mote] * lift * 6;
        if (y < ceiling) y = FLOOR_Y;
        this.dustY[mote] = y;
      }
      const z = this.dustZ[mote];
      const scale = this.depthScale(z);
      const climb = clamp((FLOOR_Y - y) / spanY, 0, 1);
      const sway = noise2D(this.dustSeed[mote] + time * 0.16, y * 1.6) - 0.5;
      const x = this.dustX[mote] + sway * 0.05;
      const px = this.sx(x, scale);
      const py = this.sy(y, scale);
      if (px < -8 || px > width + 8 || py < -8 || py > height + 8) continue;
      // Slanted light bands stand in for "inside the shaft", cheaply.
      const banding = ((x * 0.9 - y * 1.0) * 0.72 + 8) % 1;
      const lit = 0.45 + 0.85 * smoothstep(0.12, 0.42, banding) * (1 - smoothstep(0.58, 0.86, banding));
      const fade = smoothstep(0, 0.1, climb) * (1 - smoothstep(0.74, 1, climb));
      const shimmer = 0.55 + 0.45 * noise2D(this.dustSeed[mote] * 1.7, time * 2.3);
      const brightness = clamp(lit * fade * shimmer * this.kit.depthFade(z, 0.6, 6.2), 0, 1);
      if (brightness < 0.06) continue;
      if (halo && z > IDOL_Z && Math.abs(px - halo.x) < halo.r * 2.3 && py > halo.y && py < halo.y + halo.r * 9) continue;
      const size = Math.max(0.7, 0.0035 * scale * (0.6 + shimmer));
      const bin = brightness > 0.62 ? 0 : brightness > 0.3 ? 1 : 2;
      const slot = this.dustCounts[bin] * 3;
      if (slot + 2 >= bins[bin].length) continue;
      bins[bin][slot] = px;
      bins[bin][slot + 1] = py;
      bins[bin][slot + 2] = size;
      this.dustCounts[bin] += 1;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (let bin = 0; bin < 3; bin += 1) {
      const total = this.dustCounts[bin];
      if (!total) continue;
      ctx.fillStyle = bin === 0 ? palette.bone(0.5) : bin === 1 ? palette.bone(0.22) : palette.muted(0.11);
      ctx.beginPath();
      const data = bins[bin];
      for (let index = 0; index < total; index += 1) {
        const slot = index * 3;
        const size = data[slot + 2];
        ctx.rect(data[slot] - size * 0.5, data[slot + 1] - size * 0.5, size, size);
      }
      ctx.fill();
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  /** Diagnostics on a holy thing, plus the inscription. */
  paintOverlay(frame, span, ratio) {
    const { ctx, width, height, audio, palette } = frame;
    const { machineText, stampText, reticle, FONTS, clamp } = this.kit;
    const small = Math.max(9, 10.5 * ratio);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    // A surveillance lock on the absent head.  Sparse, and the point of the
    // whole scene: the machine is still measuring something that is not there.
    const halo = this.idolHalo;
    if (halo && Number.isFinite(halo.x) && Number.isFinite(halo.y)) {
      reticle(ctx, halo.x, halo.y, halo.r * 2.6, {
        color: palette.wire(0.16 + audio.beat * 0.16),
        width: Math.max(1, ratio),
        crosshair: true,
      });
      machineText(ctx, "subj//dei", halo.x + halo.r * 1.5, halo.y - halo.r * 1.5, {
        size: small * 0.9, color: palette.wire(0.32), letterSpacing: 0.08,
      });
      machineText(ctx, "no return", halo.x + halo.r * 1.5, halo.y - halo.r * 1.5 + small, {
        size: small * 0.85, color: palette.blood(0.3), letterSpacing: 0.06,
      });
    }

    // A second lock, on the celebrant.  It is drawn whether or not he is
    // standing there — the machine holds the track, reports a serial for it,
    // and has no way of telling you the floor is empty.
    const bodyScale = this.depthScale(PREACHER_Z);
    const headX = this.sx(PREACHER_X, bodyScale);
    const headY = this.sy(FLOOR_Y - 0.8 * PREACHER_H, bodyScale);
    const headR = Math.max(6, 0.062 * bodyScale);
    if (Number.isFinite(headX) && Number.isFinite(headY)) {
      const here = this.preacher.presence > 0.5;
      reticle(ctx, headX, headY, headR * 2.4, {
        color: here ? palette.violet(0.2 + audio.beat * 0.14) : palette.wire(0.12),
        width: Math.max(1, ratio),
        crosshair: !here,
      });
      machineText(ctx, here ? "celebrant" : "no subject", headX + headR * 1.75, headY - headR * 1.5, {
        size: small * 0.85,
        color: here ? palette.violet(0.4) : palette.dim(0.42),
        letterSpacing: 0.07,
      });
      if (here) {
        machineText(ctx, "unresolved", headX + headR * 1.75, headY - headR * 1.5 + small * 0.95, {
          size: small * 0.8, color: palette.blood(0.28), letterSpacing: 0.06,
        });
      }
    }

    // Bottom left is ours; the HUD owns the right edge and bottom right.
    const baseY = height - Math.max(14, 16 * ratio);
    for (let line = 0; line < this.readout.length; line += 1) {
      machineText(ctx, this.readout[line], Math.max(10, 14 * ratio), baseY - (this.readout.length - 1 - line) * small * 1.2, {
        size: small,
        color: line === 1 ? palette.blood(0.26) : palette.dim(0.5),
        letterSpacing: 0.05,
      });
    }

    // Inscription: large, blackletter, and used as carving rather than caption.
    const word = audio.silent
      ? "deus abest"
      : INSCRIPTIONS[Math.floor(Math.max(0, audio.beatCount) / 32) % INSCRIPTIONS.length];
    stampText(ctx, word, width * 0.5, height * 0.955, {
      font: FONTS.display,
      size: Math.max(14, span * 0.058),
      align: "center",
      ink: palette.bone,
      bruise: palette.blood(0.16),
      alpha: (0.1 + audio.sustain * 0.12) * clamp(this.wordFade, 0, 1),
      passes: 2,
      spread: 1.1 * ratio,
      letterSpacing: 0.12,
      seed: word.length * 3,
    });

    ctx.restore();
  }
}
