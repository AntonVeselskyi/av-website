/**
 * wired // tunnel — the inside of a network trunk, flown at speed.
 *
 * Built as three cooperating layers rather than one wireframe mesh:
 *
 * 1. A feedback buffer zoomed away from the vanishing point.  Every frame is
 *    redrawn slightly larger and darker, so the corridor recedes infinitely and
 *    every stroke leaves a light trail down the walls.  The zoom rate is keyed
 *    to `bassAtt`, which is what makes the tunnel accelerate with the music.
 * 2. The trunk itself: conduit rings on a bending axis, longitudinal cable
 *    runs, clamp brackets, junction boxes bolted to the wall, printed routing
 *    serials.  Everything is fogged by depth, so distance actually reads.
 * 3. A blurred near plane — bundles sweeping past the lens, out of focus and
 *    half out of frame.  That plane is what sells the speed.
 *
 * Traffic rides the cables and is emitted from onsets, so hits fire visible
 * data down the wire.  Degradation is scheduled by beat structure instead of
 * `Math.random()`: the channel re-routes every 8 hits, a fault every 16, a
 * carrier dropout every 32.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

const SEG = 20;               // vertices around the conduit cross-section
const MAX_RINGS = 22;         // depth slices, scaled down by frame.detail
const RING_GAP = 0.62;        // world units between rings
const RING_Z0 = 0.2;
const NEAR_PLANE = 0.17;      // anything nearer is behind the lens
const MAX_PACKETS = 64;
const MAX_NODES = 6;
const NODE_GAP = 2.9;
const ASPECT_X = 1.28;        // a wide trunk reads correctly on 16:9
const ASPECT_Y = 0.82;
const REDUCED_T = 12.5;       // frozen clock for the reduced-motion still

// Longitudinal run families: hairline, violet conduit, floor tray, ceiling spine.
const RUN_WIDTH = [0.75, 1.7, 2.15, 1.15];
const RUN_ALPHA = [0.115, 0.29, 0.4, 0.16];
// Traffic is batched into depth tiers so the whole field costs six strokes.
const TIER_Z = [NEAR_PLANE, 1.35, 3.4, 64];
const TIER_ALPHA = [0.78, 0.46, 0.24];
const TIER_WIDTH = [3.0, 1.8, 1.0];

const FAULT_WORDS = ["NO CARRIER", "PACKET LOSS", "LINE BUSY", "CHECKSUM ERR", "TRACE LOST"];
const WALL_TAGS = ["TRUNK", "SEG", "RELAY", "LINE", "HOP", "DUCT"];

/** Maps tempo to camera travel while keeping 120 BPM as the authored speed. */
export function tunnelTempoScale(bpm = 120) {
  const safe = Number.isFinite(Number(bpm)) ? Number(bpm) : 120;
  return Math.min(1.85, Math.max(0.5, safe / 120));
}

/** Keeps the authored codec failure legible without overwhelming the tunnel. */
export function wiredCorruptionProfile(corrupt = 0, turn = 0) {
  return {
    strength: Math.min(0.55, Math.max(0, Number(corrupt) || 0) * 0.45),
    slide: 0.05 + Math.min(0.08, Math.abs(Number(turn) || 0) * 0.25),
  };
}

/** Allocation-free integer hash — `mulberry32` builds a closure per call. */
function hash01(n) {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** Radial darkening centred anywhere; scene-kit's version is frame-centred. */
function darkenAt(ctx, width, height, x, y, radius, amount) {
  if (!(amount > 0) || !(radius > 0)) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(0,0,0,${amount.toFixed(3)})`);
  gradient.addColorStop(0.55, `rgba(0,0,0,${(amount * 0.34).toFixed(3)})`);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export default class WiredTunnelScene {
  static id = "wired-tunnel";
  static label = "wired // tunnel";
  // The corridor makes its own atmosphere, so grain and dither stay low and the
  // vignette runs hot — it keeps the corners black and pushes the eye inward.
  static post = { grain: 0.07, scanlines: 0.13, dither: 0.05, vignette: 0.58, bar: 0.03, curve: 0.016, tear: false };

  constructor(kit) {
    this.kit = kit;
    this.feedback = new kit.FeedbackWarp({ scale: 0.6 });
    this.bloom = new kit.Bloom({ scale: 0.3 });
    this.nearField = new kit.Layer({ scale: 0.5 });

    // Projected mesh in flat arrays: nothing in the hot loops allocates.
    this.px = new Float32Array(MAX_RINGS * SEG);
    this.py = new Float32Array(MAX_RINGS * SEG);
    this.ok = new Uint8Array(MAX_RINGS * SEG);
    this.ringZ = new Float32Array(MAX_RINGS);
    this.ringFog = new Float32Array(MAX_RINGS);
    this.ringScale = new Float32Array(MAX_RINGS);
    this.ringCX = new Float32Array(MAX_RINGS);
    this.ringCY = new Float32Array(MAX_RINGS);
    this.ringLive = new Uint8Array(MAX_RINGS);
    this.zoneBounds = new Int32Array(4);
    this.boxX = new Float32Array(4);
    this.boxY = new Float32Array(4);
    this.ledX = new Float32Array(MAX_NODES * 2);
    this.ledY = new Float32Array(MAX_NODES * 2);
    this.ledR = new Float32Array(MAX_NODES * 2);
    this.ledKind = new Uint8Array(MAX_NODES * 2);

    this.theta = new Float32Array(SEG);
    this.dirX = new Float32Array(SEG);
    this.dirY = new Float32Array(SEG);
    this.segR = new Float32Array(SEG);
    this.bandPos = new Float32Array(SEG);
    this.heavy = new Uint8Array(SEG);
    this.group = new Int8Array(SEG);
    for (let s = 0; s < SEG; s += 1) {
      const th = (s / SEG) * Math.PI * 2;
      this.theta[s] = th;
      this.dirX[s] = Math.cos(th) * ASPECT_X;
      this.dirY[s] = Math.sin(th) * ASPECT_Y;
      this.segR[s] = 1;
      // Mirrored left/right frequency map: bass swells the floor, air the roof.
      const u = kit.wrap01(s / SEG - 0.25);
      this.bandPos[s] = 1 - Math.abs(2 * u - 1);
    }
    this.assignConduits(0);

    this.packets = new Array(MAX_PACKETS);
    for (let i = 0; i < MAX_PACKETS; i += 1) {
      this.packets[i] = { live: false, z: 0, rel: 0, slot: 0, len: 0.25, age: 0, err: false, lift: 1 };
    }
    this.cursor = 0;
    this.aliveCount = 0;

    this.nearAng = new Float32Array(4);
    for (let j = 0; j < 4; j += 1) this.nearAng[j] = hash01(j * 31 + 5) * Math.PI * 2;

    // A composed opening pose, so frame one — and every reduced-motion frame —
    // is already a corridor instead of an empty grid sitting at the origin.
    this.travel = 3.7;
    this.speed = 0.9;
    this.roll = 0.04;
    this.prevRoll = 0.04;
    this.bendPhase = 0.8;
    this.bendAmp = 0.15;
    this.lobeSpin = 0.3;
    this.lobeBlend = 0.5;
    this.surge = 0;
    this.turn = 0;        // signed horizontal turn rate of the axis ahead
    this.turnSmooth = 0;  // damped, drives banking and directional smear
    this.kick = 0;        // beat bounce, decays
    this.kickX = 0;
    this.kickY = 0;
    this.corrupt = 0;     // codec breakdown envelope
    this.fault = 0;
    this.dropout = 0;
    this.idle = 1;
    this.glow = 1;
    this.t = REDUCED_T;
    this.rings = MAX_RINGS;
    this.farZ = RING_Z0 + (MAX_RINGS - 1) * RING_GAP;
    this.lockX = 0;
    this.lockY = 0;
    this.lockZ = 0;
    this.lock = 0;
    this.lockNode = 0;
    this.lockTX = 0;
    this.lockTY = 0;
    this.spawnClock = 0;
    this.lastBeat = -1;
    this.channel = 0;
    this.channelSerial = kit.serialString(11, 6);
    this.routeRows = ["", "", "", "", ""];
    this.refreshRoutes(0);
    this.poseTraffic();

    this.focal = 1;
    this.halfW = 1;
    this.halfH = 1;
    this.vpX = 1;
    this.vpY = 1;
    this.projX = 0;
    this.projY = 0;
    this.projS = 1;
  }

  // -------------------------------------------------------------------------
  // Setup helpers
  // -------------------------------------------------------------------------

  /** Chooses which angular slots carry structure.  Re-run on channel change. */
  assignConduits(channel) {
    this.heavy.fill(0);
    const base = Math.floor(hash01(channel * 13 + 5) * SEG) % SEG;
    const stride = hash01(channel * 13 + 9) > 0.5 ? 4 : 3;
    for (let k = 0; k < SEG; k += stride) this.heavy[(base + k) % SEG] = 1;
    this.heavy[Math.round(SEG * 0.25) % SEG] = 2;  // floor tray, brightest run
    this.heavy[Math.round(SEG * 0.75) % SEG] = 3;  // ceiling spine
    for (let s = 0; s < SEG; s += 1) {
      const h = this.heavy[s];
      // Half the hairlines are dropped so the walls never become a solid mesh.
      this.group[s] = h === 0 ? ((s & 1) ? -1 : 0) : h;
    }
  }

  /** Fake routing table, rebuilt only when the channel changes. */
  refreshRoutes(seed) {
    const { hexString, serialString } = this.kit;
    for (let i = 0; i < this.routeRows.length; i += 1) {
      const a = hexString(hash01(seed * 7 + i * 3 + 1), 4);
      const b = hexString(hash01(seed * 7 + i * 3 + 2), 4);
      const state = hash01(seed * 5 + i * 11) > 0.84 ? "DROP" : "PASS";
      this.routeRows[i] = `${a}:${b}  ${serialString(seed * 31 + i * 5, 3)}  ${state}`;
    }
  }

  /** Seeds a plausible traffic field so nothing is empty on the first frame. */
  poseTraffic() {
    for (let i = 0; i < 14; i += 1) {
      const p = this.packets[i];
      p.live = true;
      p.z = 0.8 + hash01(i * 5 + 1) * 7.4;
      p.rel = 1.1 + hash01(i * 5 + 2) * 2.4;
      p.slot = Math.floor(hash01(i * 5 + 3) * SEG) % SEG;
      p.len = 0.18 + hash01(i * 5 + 4) * 0.5;
      p.age = 0.5;
      p.err = hash01(i * 5 + 6) > 0.9;
      p.lift = 1.02;
    }
    this.aliveCount = 14;
  }

  // -------------------------------------------------------------------------
  // Geometry primitives
  // -------------------------------------------------------------------------

  /** The trunk's axis wanders in world space, so the corridor visibly snakes. */
  bendX(worldZ) { return Math.sin(worldZ * 0.168 + this.bendPhase) * this.bendAmp * ASPECT_X; }
  bendY(worldZ) { return Math.cos(worldZ * 0.121 - this.bendPhase * 0.6) * this.bendAmp * 0.7; }

  /**
   * Inline perspective projection into scratch fields.  `project3D` allocates a
   * result object per call, and at ~450 vertices a frame that churn is the one
   * thing this scene cannot afford, so the maths is repeated here.
   */
  project(x, y, z, limit = 8) {
    if (!(z > NEAR_PLANE)) return false;
    const scale = this.focal / z;
    const sx = this.halfW + x * scale;
    const sy = this.halfH + y * scale;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return false;
    if (Math.abs(sx - this.halfW) > this.halfW * limit || Math.abs(sy - this.halfH) > this.halfH * limit) return false;
    this.projX = sx;
    this.projY = sy;
    this.projS = scale;
    return true;
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  /** Emits one packet onto a cable run.  Silently no-ops when the field is full. */
  emit(frame, err) {
    const maxAlive = Math.max(10, Math.round(MAX_PACKETS * frame.detail));
    if (this.aliveCount >= maxAlive) return;
    const seed = frame.audio.beatCount * 17 + this.cursor * 3 + frame.frameIndex;
    for (let i = 0; i < MAX_PACKETS; i += 1) {
      const index = (this.cursor + i) % MAX_PACKETS;
      const p = this.packets[index];
      if (p.live) continue;
      const r1 = hash01(seed);
      const r2 = hash01(seed * 3 + 7);
      const r3 = hash01(seed * 5 + 13);
      const r4 = hash01(seed * 7 + 3);
      p.live = true;
      p.age = 0;
      p.err = err || r4 > 0.94;
      p.slot = Math.floor(r2 * SEG) % SEG;
      p.lift = 1.015 + r3 * 0.05;
      p.len = 0.16 + r1 * 0.42;
      if (r1 > 0.24) {
        // Inbound: rushes the lens faster than the walls do and overtakes it.
        p.z = this.farZ * (0.55 + r3 * 0.44);
        p.rel = 1.0 + r4 * 4.0;
      } else {
        // Outbound: launched from a junction and left behind down the trunk.
        p.z = 1.7 + r3 * 2.2;
        p.rel = -(this.speed + 0.6 + r4 * 1.5);
      }
      this.cursor = (index + 1) % MAX_PACKETS;
      this.aliveCount += 1;
      return;
    }
  }

  /** Beat structure: re-route, fault and dropout on a schedule, not at random. */
  onBeat(frame) {
    const { audio, kit } = frame;
    this.surge = 1;
    this.kick = Math.min(1.4, this.kick + 0.7 + kit.clamp(audio.transient, 0, 1) * 0.6);
    const burst = 1 + Math.floor(kit.clamp(audio.bassAtt, 0, 2.4) * 2.2);
    for (let i = 0; i < burst; i += 1) this.emit(frame, false);
    if (audio.beatCount % 8 === 0) {
      this.channel += 1;
      this.channelSerial = kit.serialString(this.channel * 7 + 3, 6);
      this.assignConduits(this.channel);
      this.refreshRoutes(this.channel);
    }
    if (audio.beatCount % 16 === 0) {
      this.fault = 1;
      this.corrupt = 1;
      this.emit(frame, true);
    }
    if (audio.beatCount % 32 === 0) { this.dropout = 1; this.corrupt = 1.4; }
    // Hard corners shake the link loose on their own.
    if (Math.abs(this.turnSmooth) > 0.055 && audio.beatCount % 4 === 0) {
      this.corrupt = Math.max(this.corrupt, 0.55);
    }
  }

  /** Advances every envelope, the camera and the traffic field. */
  advance(frame) {
    const { audio, kit } = frame;
    const { clamp, approach } = kit;
    const reduced = frame.reducedMotion;
    const dt = reduced ? 0 : Math.min(0.05, frame.dt || 0);
    this.t = reduced ? REDUCED_T : frame.time;
    const t = this.t;

    if (reduced) this.idle = audio.silent ? 1 : 0;
    else this.idle = approach(this.idle, audio.silent ? 1 : 0, 1.1, dt);
    const idle = this.idle;

    if (audio.beatCount !== this.lastBeat) {
      this.lastBeat = audio.beatCount;
      if (!reduced) this.onBeat(frame);
    }
    this.surge = Math.max(0, this.surge - dt * 1.8);
    this.corrupt = Math.max(0, this.corrupt - dt * 2.1);
    this.fault = Math.max(0, this.fault - dt * 0.75);
    this.dropout = Math.max(0, this.dropout - dt * 2.4);

    // Tempo provides the continuous forward travel; normalized bass and hits
    // add momentary acceleration without making quiet material stand still.
    const bassAtt = clamp(audio.bassAtt, 0, 2.4);
    const tempoScale = tunnelTempoScale(frame.bpm);
    const target = (0.5 + bassAtt * 1.25 + this.surge * 0.55) * tempoScale * (1 - idle * 0.72);
    this.speed = approach(this.speed, target, 2.6, dt);
    this.travel += this.speed * dt;

    // Structural drift: the axis bend, its amplitude and the cross-section all
    // move on 8–30s cycles, independent of anything musical.
    this.bendPhase += dt * (0.12 + clamp(audio.midAtt, 0, 2) * 0.05);
    this.bendAmp = approach(this.bendAmp, 0.17 + Math.abs(Math.sin(t * 0.041)) * 0.36, 0.5, dt);
    this.lobeSpin += dt * 0.07;
    this.lobeBlend = 0.5 + Math.sin(t * 0.033) * 0.5;
    const ahead = 2.6;
    this.turn = (this.bendX(this.travel + ahead) - this.bendX(this.travel)) / ahead;
    const climb = (this.bendY(this.travel + ahead) - this.bendY(this.travel)) / ahead;
    this.turnSmooth = approach(this.turnSmooth, this.turn, 2.2, dt);

    // Beat bounce: a kick the camera absorbs over about a third of a second,
    // thrown sideways so consecutive hits do not stack into a vertical judder.
    this.kick = Math.max(0, this.kick - dt * 3.2);
    const kickAmp = this.kick * this.kick;
    this.kickX = Math.sin(this.lastBeat * 2.399) * kickAmp * 0.018;
    this.kickY = (Math.cos(this.lastBeat * 1.117) * 0.4 - 0.9) * kickAmp * 0.022;

    this.prevRoll = this.roll;
    const rollTarget = Math.sin(t * 0.19) * 0.075 + Math.sin(t * 0.071) * 0.045
      + (audio.stereoDrift || 0) * 0.03
      + this.turnSmooth * 2.6                       // bank into the corner
      + kickAmp * Math.sin(this.lastBeat * 3.7) * 0.018;
    this.roll = approach(this.roll, rollTarget, 1.4, dt);
    void climb;

    if (!reduced) {
      if (clamp(audio.transient, 0, 1) > 0.55 && frame.frameIndex % 4 === 0) this.emit(frame, false);
      this.spawnClock += dt;
      if (this.spawnClock > 1.4) {
        this.spawnClock = 0;
        if (audio.silent || this.aliveCount < 5) this.emit(frame, false);
      }
    }

    let alive = 0;
    for (let i = 0; i < MAX_PACKETS; i += 1) {
      const p = this.packets[i];
      if (!p.live) continue;
      if (dt > 0) {
        p.z -= (this.speed + p.rel) * dt;
        p.age += dt;
      }
      // `age` is also the safety valve: a packet whose net rate settles near
      // zero would otherwise hold its slot forever.
      if (!(p.z > NEAR_PLANE + 0.03) || p.z > this.farZ + 0.8 || p.age > 40) p.live = false;
      else alive += 1;
    }
    this.aliveCount = alive;

    this.glow = clamp((1 - idle * 0.5) * (1 - this.dropout * 0.55) * (0.9 + clamp(audio.level, 0, 1) * 0.25), 0.2, 1.2);
    if (this.lockX === 0 && this.lockY === 0) {
      this.lockX = this.halfW;
      this.lockY = this.halfH;
    }
  }

  /** Projects the whole trunk into the flat arrays and finds the vanishing point. */
  projectTrunk(frame) {
    const { kit } = frame;
    const { clamp, lerp, depthFade, smoothstep, fbm } = kit;
    const rings = Math.max(12, Math.min(MAX_RINGS, Math.round(MAX_RINGS * frame.detail)));
    this.rings = rings;
    this.farZ = RING_Z0 + (rings - 1) * RING_GAP;
    const t = this.t;
    const live = 1 - this.idle * 0.72;

    // Cross-section: two lobe harmonics crossfading over ~19s, so the corridor
    // changes character with no visible cut.
    for (let s = 0; s < SEG; s += 1) {
      const th = this.theta[s];
      const lobeA = 1 + 0.105 * Math.cos(4 * (th - this.lobeSpin));
      const lobeB = 1 + 0.075 * Math.cos(6 * (th + this.lobeSpin * 0.7));
      const amp = frame.band(this.bandPos[s]);
      const breath = Math.sin(th * 3 + t * 1.6) * 0.012;
      // Line noise: with no carrier the walls still creep, so it never dies.
      const hum = this.idle > 0.02 ? (fbm(s * 0.37, t * 0.22, 2) - 0.5) * 0.05 * this.idle : 0;
      this.segR[s] = lerp(lobeA, lobeB, this.lobeBlend) * (1 + amp * 0.17 * live + breath + hum);
    }

    const travelMod = this.travel % RING_GAP;
    for (let i = 0; i < rings; i += 1) {
      const z = RING_Z0 + i * RING_GAP - travelMod;
      const worldZ = z + this.travel;
      const fog = depthFade(z, 0.4, this.farZ);
      // Rings do not blink out as they swallow the lens, they just calm down.
      const pass = 0.34 + 0.66 * smoothstep(0.2, 0.85, z);
      this.ringZ[i] = z;
      this.ringFog[i] = fog * (0.32 + 0.68 * fog) * pass;
      this.ringScale[i] = z > NEAR_PLANE ? this.focal / z : 0;
      const bx = this.bendX(worldZ);
      const by = this.bendY(worldZ);
      const swell = 1 + Math.sin(worldZ * 1.15 - t * 2.1) * (0.02 + this.surge * 0.045);
      if (this.project(bx, by, z)) {
        this.ringCX[i] = this.projX;
        this.ringCY[i] = this.projY;
        this.ringLive[i] = 1;
      } else {
        this.ringCX[i] = this.halfW;
        this.ringCY[i] = this.halfH;
        this.ringLive[i] = 0;
      }
      const base = i * SEG;
      for (let s = 0; s < SEG; s += 1) {
        const k = base + s;
        const r = this.segR[s] * swell;
        if (this.project(bx + this.dirX[s] * r, by + this.dirY[s] * r, z)) {
          this.px[k] = this.projX;
          this.py[k] = this.projY;
          this.ok[k] = 1;
        } else this.ok[k] = 0;
      }
    }

    const vz = Math.min(this.farZ, 9.5);
    if (this.project(this.bendX(vz + this.travel), this.bendY(vz + this.travel), vz)) {
      this.vpX = clamp(this.projX, frame.width * 0.2, frame.width * 0.8);
      this.vpY = clamp(this.projY, frame.height * 0.2, frame.height * 0.8);
    } else {
      this.vpX = this.halfW;
      this.vpY = this.halfH;
    }
  }

  // -------------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------------

  /** Background: the feedback recession plus the haze at the vanishing point. */
  paintDepth(frame) {
    const { ctx, width, height, palette, audio, kit } = frame;
    const { clamp } = kit;
    const minDim = Math.min(width, height);
    const rush = clamp(this.speed / 2.6, 0, 1.1);

    if (frame.reducedMotion) {
      kit.fadeTo(ctx, width, height, palette.void, 1);
    } else {
      // Cornering drags the accumulated frame sideways and holds it longer,
      // which is the smear you get swinging a camera through a bend.
      const swing = clamp(Math.abs(this.turnSmooth) * 7, 0, 1);
      this.feedback.warp(frame, {
        zoom: 1.0035 + rush * 0.0085 + this.surge * 0.005,
        rot: this.roll - this.prevRoll,   // keeps the trails aligned with roll
        cx: this.vpX / width,
        cy: this.vpY / height,
        dx: -this.turnSmooth * 0.16,
        sx: 1 + clamp(audio.transient, 0, 1) * 0.003 + swing * 0.004,
        decay: clamp(0.895 + clamp(audio.sustain, 0, 1) * 0.04 + swing * 0.045 - this.dropout * 0.22, 0.6, 0.965),
        background: palette.void,
      });
      // The zoom centre is where accumulation saturates, so that is where the
      // frame gets pushed back down to black.
      darkenAt(ctx, width, height, this.vpX, this.vpY, minDim * (0.3 + rush * 0.16), 0.34 + this.surge * 0.1);
    }

    const glow = this.glow;
    const haze = ctx.createRadialGradient(this.vpX, this.vpY, 0, this.vpX, this.vpY, minDim * (0.42 + this.speed * 0.05));
    haze.addColorStop(0, palette.wire(0.075 * glow));
    haze.addColorStop(0.32, palette.wire(0.035 * glow));
    haze.addColorStop(0.66, palette.violet(0.026 * glow));
    haze.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1;
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  /** Conduit rings.  Every fourth ring is a heavy structural frame. */
  drawRings(frame) {
    const { ctx, palette, audio, kit } = frame;
    const hue = 104 + kit.clamp(audio.brightness, 0, 1) * 24;
    const phase = Math.floor(this.travel / RING_GAP);
    ctx.globalCompositeOperation = "lighter";
    for (let i = this.rings - 1; i >= 0; i -= 1) {
      if (!this.ringLive[i]) continue;
      const fog = this.ringFog[i];
      if (fog <= 0.012) continue;
      const structural = ((i + phase) & 3) === 0;
      let alpha = (structural ? 0.34 : 0.13) * fog * this.glow + this.surge * 0.05 * fog;
      if (!structural) alpha *= 1 - this.dropout * 0.8;
      if (alpha < 0.014) continue;
      alpha = Math.min(0.62, alpha);
      ctx.strokeStyle = structural
        ? palette.violet(alpha * 1.1)
        : `hsla(${hue.toFixed(0)}, 92%, ${(64 + fog * 10).toFixed(0)}%, ${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.55, (structural ? 1.8 : 0.8) * frame.ratio * (0.55 + fog * 0.6));
      ctx.beginPath();
      const base = i * SEG;
      let started = false;
      for (let s = 0; s <= SEG; s += 1) {
        const k = base + (s % SEG);
        if (!this.ok[k]) { started = false; continue; }
        if (started) ctx.lineTo(this.px[k], this.py[k]);
        else { ctx.moveTo(this.px[k], this.py[k]); started = true; }
      }
      ctx.stroke();
    }
  }

  /**
   * Longitudinal cable runs.  Batched by family and by three depth zones: one
   * path per zone keeps the fog gradient along the corridor for twelve strokes
   * instead of one stroke per cable segment.
   */
  drawRuns(frame) {
    const { ctx, palette } = frame;
    const rings = this.rings;
    const bounds = this.zoneBounds;
    bounds[0] = 0;
    bounds[1] = Math.max(1, Math.round(rings * 0.3));
    bounds[2] = Math.max(bounds[1] + 1, Math.round(rings * 0.62));
    bounds[3] = rings - 1;
    ctx.globalCompositeOperation = "lighter";
    for (let group = 0; group < 4; group += 1) {
      for (let zone = 0; zone < 3; zone += 1) {
        const lo = bounds[zone];
        const hi = bounds[zone + 1];
        if (hi <= lo) continue;
        const fog = this.ringFog[(lo + hi) >> 1];
        let alpha = RUN_ALPHA[group] * fog * this.glow;
        if (group === 0) alpha *= 1 - this.dropout * 0.85;
        if (alpha < 0.012) continue;
        alpha = Math.min(0.6, alpha);
        ctx.strokeStyle = group === 1 ? palette.violet(alpha)
          : group === 3 ? palette.violet(alpha * 0.85)
            : palette.wire(alpha);
        ctx.lineWidth = Math.max(0.5, RUN_WIDTH[group] * frame.ratio * (0.5 + fog * 0.65));
        ctx.beginPath();
        for (let s = 0; s < SEG; s += 1) {
          if (this.group[s] !== group) continue;
          let started = false;
          for (let i = lo; i <= hi; i += 1) {
            const k = i * SEG + s;
            if (!this.ok[k]) { started = false; continue; }
            if (started) ctx.lineTo(this.px[k], this.py[k]);
            else { ctx.moveTo(this.px[k], this.py[k]); started = true; }
          }
        }
        ctx.stroke();
      }
    }
  }

  /** Clamp flanges where the heavy runs cross a structural frame. */
  drawBrackets(frame) {
    const { ctx, palette, kit } = frame;
    const phase = Math.floor(this.travel / RING_GAP);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = palette.violet(0.22 * this.glow);
    ctx.lineWidth = Math.max(0.6, 1.1 * frame.ratio);
    ctx.beginPath();
    let drawn = 0;
    for (let i = 0; i < this.rings && drawn < 72; i += 1) {
      if (!this.ringLive[i] || ((i + phase) & 3) !== 0) continue;
      const fog = this.ringFog[i];
      if (fog < 0.12) continue;
      const cx = this.ringCX[i];
      const cy = this.ringCY[i];
      const len = kit.clamp(this.ringScale[i] * 0.04, 2, 42 * frame.ratio);
      const base = i * SEG;
      for (let s = 0; s < SEG; s += 1) {
        if (this.heavy[s] === 0) continue;
        const k = base + s;
        if (!this.ok[k]) continue;
        const dx = this.px[k] - cx;
        const dy = this.py[k] - cy;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / d;
        const uy = dy / d;
        const bx = this.px[k] - ux * len * 0.35;
        const by = this.py[k] - uy * len * 0.35;
        ctx.moveTo(bx - uy * len, by + ux * len);
        ctx.lineTo(bx + uy * len, by - ux * len);
        drawn += 1;
      }
    }
    ctx.stroke();
  }

  /**
   * Junction boxes bolted to the wall.  The near ones get an opaque backing so
   * they genuinely occlude the cables behind them — real depth, not just fog.
   */
  drawNodes(frame) {
    const { ctx, palette, audio, kit } = frame;
    const { clamp, depthFade, machineText } = kit;
    const first = Math.floor(this.travel / NODE_GAP) + 1;
    let bestScore = 1e9;
    let bestX = 0;
    let bestY = 0;
    let bestZ = 0;
    let bestNode = 0;
    let labels = 0;
    let leds = 0;
    ctx.lineJoin = "miter";

    for (let k = 0; k < MAX_NODES; k += 1) {
      const n = first + k;
      const z = n * NODE_GAP - this.travel;
      if (z > this.farZ) break;
      if (!(z > NEAR_PLANE + 0.06)) continue;
      const r1 = hash01(n * 4 + 1);
      const r2 = hash01(n * 4 + 2);
      const r3 = hash01(n * 4 + 3);
      // Landmarks live low in the frame: it keeps the top-left quadrant calm
      // and puts the ink where the DOM type is not.
      const th = r3 > 0.78 ? Math.PI * 1.16 + r1 * 0.68 : Math.PI * 0.2 + r1 * Math.PI * 0.6;
      const dth = 0.15 + r2 * 0.13;
      const dz = 0.24 + r2 * 0.3;
      const slot = Math.round((th / (Math.PI * 2)) * SEG) % SEG;
      const rad = this.segR[slot] * 1.01;
      const fog = depthFade(z, 0.4, this.farZ);
      const alpha = clamp(0.16 + fog * 0.42, 0, 0.62) * this.glow;

      let valid = true;
      for (let corner = 0; corner < 4; corner += 1) {
        const a = th + (corner === 1 || corner === 2 ? dth : -dth);
        const cz = z + (corner < 2 ? -dz : dz);
        const worldZ = cz + this.travel;
        const x = this.bendX(worldZ) + Math.cos(a) * ASPECT_X * rad;
        const y = this.bendY(worldZ) + Math.sin(a) * ASPECT_Y * rad;
        if (!this.project(x, y, cz)) { valid = false; break; }
        this.boxX[corner] = this.projX;
        this.boxY[corner] = this.projY;
      }
      if (!valid) continue;

      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.moveTo(this.boxX[0], this.boxY[0]);
      ctx.lineTo(this.boxX[1], this.boxY[1]);
      ctx.lineTo(this.boxX[3], this.boxY[3]);
      ctx.lineTo(this.boxX[2], this.boxY[2]);
      ctx.closePath();
      if (z < 3.4) {
        ctx.fillStyle = palette.void(0.86);
        ctx.fill();
      }
      ctx.strokeStyle = palette.violet(alpha);
      ctx.lineWidth = Math.max(0.7, 1.4 * frame.ratio * (0.5 + fog));
      ctx.stroke();

      // Inner detail: one seam plus indicator lamps.
      ctx.beginPath();
      ctx.moveTo((this.boxX[0] + this.boxX[2]) * 0.5, (this.boxY[0] + this.boxY[2]) * 0.5);
      ctx.lineTo((this.boxX[1] + this.boxX[3]) * 0.5, (this.boxY[1] + this.boxY[3]) * 0.5);
      ctx.strokeStyle = palette.wire(alpha * 0.55);
      ctx.lineWidth = Math.max(0.5, 0.8 * frame.ratio);
      ctx.stroke();

      const lit = ((n + audio.beatCount) & 1) === 0;
      if (leds + 2 <= this.ledX.length) {
        for (let l = 0; l < 2; l += 1) {
          const tx = l === 0 ? 0.3 : 0.7;
          this.ledX[leds] = this.boxX[0] + (this.boxX[3] - this.boxX[0]) * tx;
          this.ledY[leds] = this.boxY[0] + (this.boxY[3] - this.boxY[0]) * tx;
          this.ledR[leds] = Math.max(0.8, 1.6 * frame.ratio * (0.4 + fog));
          this.ledKind[leds] = n % 5 === 0 && l === 1 ? 1 : lit ? 0 : 2;
          leds += 1;
        }
      }

      if (labels < 2 && z < 4.6 && frame.detail > 0.7) {
        labels += 1;
        machineText(ctx, `${kit.serialString(n * 7, 4)}·${kit.hexString(hash01(n * 9), 3)}`,
          this.boxX[1] + 6 * frame.ratio, this.boxY[1] - 3 * frame.ratio, {
            size: clamp(this.projS * 0.028, 8 * frame.ratio, 20 * frame.ratio),
            color: palette.wire(alpha * 0.7), letterSpacing: 0.06, shadow: false,
          });
      }

      // The reticle prefers a landmark holding mid-distance.
      const score = Math.abs(z - 2.2);
      if (z > 0.9 && z < 4.8 && score < bestScore) {
        bestScore = score;
        bestX = (this.boxX[0] + this.boxX[3]) * 0.5;
        bestY = (this.boxY[0] + this.boxY[3]) * 0.5;
        bestZ = z;
        bestNode = n;
      }
    }

    if (leds > 0) {
      ctx.globalCompositeOperation = "lighter";
      for (let kind = 0; kind < 3; kind += 1) {
        let any = false;
        ctx.beginPath();
        for (let i = 0; i < leds; i += 1) {
          if (this.ledKind[i] !== kind) continue;
          ctx.moveTo(this.ledX[i] + this.ledR[i], this.ledY[i]);
          ctx.arc(this.ledX[i], this.ledY[i], this.ledR[i], 0, Math.PI * 2);
          any = true;
        }
        if (!any) continue;
        ctx.fillStyle = kind === 1 ? palette.blood(0.7 * this.glow)
          : kind === 0 ? palette.wire(0.72 * this.glow) : palette.wire(0.2 * this.glow);
        ctx.fill();
      }
    }

    const dt = frame.reducedMotion ? 0 : Math.min(0.05, frame.dt || 0);
    if (bestScore < 1e9) {
      this.lockTX = bestX;
      this.lockTY = bestY;
      this.lockZ = bestZ;
      this.lockNode = bestNode;
      this.lock = kit.approach(this.lock, 1, 3.4, dt);
    } else {
      // Nothing to hold: the reticle drifts around the vanishing point.
      this.lockTX = this.vpX + Math.sin(this.t * 0.43) * frame.width * 0.06;
      this.lockTY = this.vpY + Math.cos(this.t * 0.31) * frame.height * 0.05;
      this.lock = kit.approach(this.lock, 0.28, 1.2, dt);
    }
    this.lockX = kit.approach(this.lockX, this.lockTX, 6, dt);
    this.lockY = kit.approach(this.lockY, this.lockTY, 6, dt);
  }

  /** Packets riding the runs, batched into three depth tiers by two kinds. */
  drawTraffic(frame) {
    const { ctx, palette, kit } = frame;
    const { clamp } = kit;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let tier = 0; tier < 3; tier += 1) {
      const zLo = TIER_Z[tier];
      const zHi = TIER_Z[tier + 1];
      for (let kind = 0; kind < 2; kind += 1) {
        let any = false;
        ctx.beginPath();
        for (let i = 0; i < MAX_PACKETS; i += 1) {
          const p = this.packets[i];
          if (!p.live) continue;
          if ((p.err ? 1 : 0) !== kind) continue;
          if (p.z < zLo || p.z >= zHi) continue;
          // Nothing pops into the bright near tier: it has to have travelled.
          if (tier === 0 && p.age < 0.12) continue;
          const rate = this.speed + p.rel;
          const len = clamp(p.len * (0.5 + Math.abs(rate) * 0.35), 0.08, 1.5);
          let zTail = rate > 0 ? p.z + len : p.z - len;
          if (zTail < NEAR_PLANE + 0.02) zTail = NEAR_PLANE + 0.02;
          else if (zTail > this.farZ + 1.5) zTail = this.farZ + 1.5;
          const r = this.segR[p.slot] * p.lift;
          const dx = this.dirX[p.slot] * r;
          const dy = this.dirY[p.slot] * r;
          const headZ = p.z + this.travel;
          if (!this.project(this.bendX(headZ) + dx, this.bendY(headZ) + dy, p.z)) continue;
          const hx = this.projX;
          const hy = this.projY;
          const tailZ = zTail + this.travel;
          if (!this.project(this.bendX(tailZ) + dx, this.bendY(tailZ) + dy, zTail)) continue;
          ctx.moveTo(this.projX, this.projY);
          ctx.lineTo(hx, hy);
          any = true;
        }
        if (!any) continue;
        const alpha = Math.min(0.85, TIER_ALPHA[tier] * this.glow);
        ctx.strokeStyle = kind === 1 ? palette.blood(alpha) : palette.wire(alpha);
        ctx.lineWidth = Math.max(0.7, TIER_WIDTH[tier] * frame.ratio);
        if (tier === 0 && frame.detail > 0.85) {
          ctx.shadowBlur = 8 * frame.ratio;
          ctx.shadowColor = kind === 1 ? palette.blood(0.6) : palette.wire(0.6);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    ctx.lineCap = "butt";
  }

  /** Routing serials printed on the wall, running along the tunnel axis. */
  drawWallPrint(frame) {
    const { ctx, palette, kit } = frame;
    const { clamp, machineText } = kit;
    if (frame.detail < 0.7) return;
    const phase = Math.floor(this.travel / RING_GAP);
    let drawn = 0;
    for (let i = 1; i < this.rings - 1 && drawn < 5; i += 1) {
      const z = this.ringZ[i];
      if (z < 0.85 || z > 5.4) continue;
      const world = phase + i;
      if (world % 3 !== 0) continue;
      const slot = (world * 7) % SEG;
      const k = i * SEG + slot;
      const k2 = (i + 1) * SEG + slot;
      if (!this.ok[k] || !this.ok[k2]) continue;
      // The DOM type owns the top-left quadrant; nothing printed goes there.
      if (this.px[k] < frame.width * 0.42 && this.py[k] < frame.height * 0.4) continue;
      const angle = Math.atan2(this.py[k2] - this.py[k], this.px[k2] - this.px[k]);
      const fog = this.ringFog[i];
      const tag = WALL_TAGS[world % WALL_TAGS.length];
      const text = world % 4 === 1
        ? `${tag} ${kit.serialString(world * 3, 3)}`
        : `${kit.hexString(hash01(world * 5), 4)}-${kit.serialString(world, 2)}`;
      ctx.save();
      ctx.translate(this.px[k], this.py[k]);
      ctx.rotate(angle);
      ctx.globalCompositeOperation = "lighter";
      machineText(ctx, text, 0, -3 * frame.ratio, {
        size: clamp(this.ringScale[i] * 0.03, 7 * frame.ratio, 24 * frame.ratio),
        color: world % 5 === 0 ? palette.blood(0.2 * fog) : palette.bone(0.24 * fog * this.glow),
        letterSpacing: 0.1,
        shadow: false,
      });
      ctx.restore();
      drawn += 1;
    }
  }

  /**
   * The near plane: bundles sweeping past the lens, plus the two rings that are
   * about to swallow the camera, rendered at half resolution and blurred.  This
   * is the layer that makes the corridor feel fast.
   */
  drawNearField(frame) {
    const { ctx, width, height, palette, kit } = frame;
    const layer = this.nearField;
    if (!layer.ctx || frame.detail < 0.62) return;
    layer.match(width, height);
    layer.clear();
    const near = layer.ctx;
    const scale = layer.width / Math.max(1, width);
    near.setTransform(scale, 0, 0, scale, 0, 0);
    near.translate(this.halfW, this.halfH);
    near.rotate(this.roll);
    near.translate(-this.halfW, -this.halfH);
    near.globalCompositeOperation = "source-over";
    near.lineCap = "round";

    // Dash offset driven by travel: the clamps rush past the lens for free.
    const dash = 26 * frame.ratio;
    near.setLineDash([dash * 0.55, dash]);
    near.lineDashOffset = -((this.travel * 190 * frame.ratio) % (dash * 1.55));
    for (let j = 0; j < 4; j += 1) {
      const ang = this.nearAng[j] + this.t * 0.03 * (j & 1 ? 1 : -1);
      const rad = 1.5 + j * 0.24;
      const cos = Math.cos(ang) * ASPECT_X * rad;
      const sin = Math.sin(ang) * ASPECT_Y * rad;
      near.beginPath();
      let started = false;
      for (let step = 0; step < 5; step += 1) {
        const z = 0.45 + step * 0.55;
        const worldZ = z + this.travel;
        if (!this.project(this.bendX(worldZ) + cos, this.bendY(worldZ) + sin, z, 24)) { started = false; continue; }
        if (started) near.lineTo(this.projX, this.projY);
        else { near.moveTo(this.projX, this.projY); started = true; }
      }
      near.strokeStyle = j === 2 ? palette.wire(0.26) : palette.violet(0.3);
      near.lineWidth = (5.5 - j * 0.6) * frame.ratio;
      near.stroke();
    }
    near.setLineDash([]);

    for (let i = 0; i < this.rings; i += 1) {
      if (!this.ringLive[i] || this.ringZ[i] > 0.95) continue;
      near.beginPath();
      const base = i * SEG;
      let started = false;
      for (let s = 0; s <= SEG; s += 1) {
        const k = base + (s % SEG);
        if (!this.ok[k]) { started = false; continue; }
        if (started) near.lineTo(this.px[k], this.py[k]);
        else { near.moveTo(this.px[k], this.py[k]); started = true; }
      }
      near.strokeStyle = palette.wire(0.22);
      near.lineWidth = 4 * frame.ratio;
      near.stroke();
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = kit.clamp(0.42 * this.glow, 0, 0.6);
    ctx.filter = `blur(${(2.2 + this.speed * 0.5).toFixed(2)}px)`;
    ctx.drawImage(layer.canvas, 0, 0, width, height);
    ctx.filter = "none";
    ctx.restore();
  }

  /** Surveillance furniture: the lock, the diagnostics block, the fault. */
  drawOverlay(frame) {
    const { ctx, width, height, palette, audio, kit } = frame;
    const { clamp, machineText, reticle } = kit;
    const ratio = frame.ratio;
    const small = Math.max(9, 11 * ratio);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // The lock lives in world space, so it has to be rolled into view space.
    const cos = Math.cos(this.roll);
    const sin = Math.sin(this.roll);
    const rx = this.lockX - this.halfW;
    const ry = this.lockY - this.halfH;
    const lx = this.halfW + rx * cos - ry * sin;
    const ly = this.halfH + rx * sin + ry * cos;
    const calm = lx < width * 0.42 && ly < height * 0.4 ? 0.4 : 1;
    const lockAlpha = clamp(this.lock * 0.5 * calm, 0, 0.5);
    if (lockAlpha > 0.02) {
      const size = clamp(Math.min(width, height) * 0.13, 40 * ratio, 190 * ratio);
      reticle(ctx, lx, ly, size, {
        color: audio.silent ? palette.blood(lockAlpha * 0.8) : palette.wire(lockAlpha),
        width: Math.max(1, ratio),
        crosshair: this.lock > 0.7,
      });
      machineText(ctx, audio.silent
        ? "CARRIER LOST"
        : `NODE ${kit.serialString(this.lockNode * 7, 4)} · ${this.lockZ.toFixed(2)}U`,
      lx - size * 0.5, ly + size * 0.5 + small * 1.1, {
        size: small * 0.9,
        color: audio.silent ? palette.blood(0.4) : palette.wire(lockAlpha * 0.9),
        letterSpacing: 0.08,
        shadow: false,
      });
    }

    // Bottom-left is the scene's own corner; the shared HUD owns the right.
    const left = 26 * ratio;
    const baseY = height - 20 * ratio;
    const barsW = Math.min(width * 0.26, 230 * ratio);
    const barsH = 34 * ratio;
    const barsY = baseY - small * 3.6;
    const count = Math.max(14, Math.round(26 * frame.detail));
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const amp = clamp(frame.band(t), 0, 1);
      const w = barsW / count;
      const h = Math.max(ratio, amp * barsH);
      ctx.rect(left + i * w, barsY - h, Math.max(1, w - ratio), h);
    }
    ctx.fillStyle = palette.wire(0.3 + clamp(audio.trebRel, 0, 2) * 0.1);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const peak = clamp(frame.bandPeaks[Math.min(31, Math.round((i / (count - 1)) * 31))], 0, 1);
      const w = barsW / count;
      ctx.rect(left + i * w, barsY - Math.max(ratio, peak * barsH), Math.max(1, w - ratio), Math.max(1, ratio));
    }
    ctx.fillStyle = palette.violet(0.4);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
    const rate = Math.round(120 + clamp(audio.level, 0, 1) * 8600 + this.speed * 400);
    const lat = Math.round(6 + (1 / (0.3 + this.speed)) * 22);
    const loss = Math.round(clamp(audio.flux, 0, 1) * 12 + this.fault * 46);
    const lines = [
      `WIRE://TRUNK-${this.channelSerial}  CH${String(this.channel % 100).padStart(2, "0")}`,
      `${rate} KB/S  LAT ${lat}MS  LOSS ${loss}%`,
      `${audio.silent ? "NO CARRIER · IDLE" : `LINK UP  HOP ${String(Math.floor(this.travel / NODE_GAP) % 1000).padStart(3, "0")}`}`,
    ];
    for (let i = 0; i < lines.length; i += 1) {
      machineText(ctx, lines[i], left, baseY - (lines.length - 1 - i) * small * 1.2, {
        size: small,
        color: i === 2 && audio.silent ? palette.blood(0.45) : i === 0 ? palette.wire(0.5) : palette.bone(0.32),
        letterSpacing: 0.06,
      });
    }

    // Routing table: dense dim texture, only where there is room for it.
    if (width > 700 * ratio) {
      for (let i = 0; i < this.routeRows.length; i += 1) {
        machineText(ctx, this.routeRows[i], width * 0.34, baseY - (this.routeRows.length - 1 - i) * small * 1.05, {
          size: small * 0.85,
          color: this.routeRows[i].endsWith("DROP") ? palette.blood(0.24) : palette.bone(0.16),
          letterSpacing: 0.05,
          shadow: false,
        });
      }
    }

    if (this.fault > 0.15) {
      // Phone-line noise: a trace that only appears while the line is faulting.
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = palette.blood(0.3 * this.fault);
      ctx.lineWidth = Math.max(1, ratio);
      ctx.beginPath();
      const steps = 40;
      const y = height * 0.74;
      for (let i = 0; i <= steps; i += 1) {
        const x = width * (0.05 + 0.46 * (i / steps));
        const yy = y + (kit.noise2D(i * 0.7, this.t * 9) - 0.5) * height * 0.05 * this.fault;
        if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
      }
      ctx.stroke();
    }
    if (this.fault > 0.08 || audio.silent) {
      const strength = audio.silent ? 0.3 : this.fault;
      kit.stampText(ctx, audio.silent ? "NO CARRIER" : FAULT_WORDS[this.channel % FAULT_WORDS.length],
        left, height * 0.66, {
          size: Math.max(18, Math.min(width, height) * 0.075),
          ink: palette.blood,
          bruise: palette.violet(0.3),
          alpha: clamp(strength * 0.42, 0, 0.42),
          rotate: -0.02,
          passes: 2,
          spread: 2.4 * ratio,
          letterSpacing: 0.04,
        });
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Contract
  // -------------------------------------------------------------------------

  render(frame) {
    const { ctx, width, height } = frame;
    this.focal = Math.min(width, height) * 0.86;
    this.halfW = width * 0.5;
    this.halfH = height * 0.5;

    this.advance(frame);
    this.projectTrunk(frame);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    this.paintDepth(frame);

    ctx.save();
    ctx.translate(this.halfW + this.kickX * width, this.halfH + this.kickY * height);
    ctx.rotate(this.roll);
    ctx.translate(-this.halfW, -this.halfH);
    this.drawRings(frame);
    this.drawRuns(frame);
    this.drawBrackets(frame);
    this.drawNodes(frame);
    this.drawTraffic(frame);
    this.drawWallPrint(frame);
    ctx.restore();

    this.drawNearField(frame);
    this.drawOverlay(frame);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";

    // One copy serves twice: the feedback source for the next frame and the
    // bloom source for this one.  Bloom lands after the store, so the halo
    // never feeds back on itself and saturates.
    this.feedback.store(frame);
    if (this.feedback.primed && this.feedback.layer.canvas) {
      this.bloom.apply(ctx, this.feedback.layer.canvas, {
        strength: 0.4 + this.surge * 0.16,
        blur: 7 * frame.ratio + this.speed * 2,
        passes: frame.detail > 0.85 ? 2 : 1,
        threshold: 1,
      });
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";

    // Codec breakdown last, so it corrupts the finished picture rather than
    // something the bloom then papers back over. The source is the copy the
    // feedback pass already took, so this costs no extra full-frame read.
    if (!frame.reducedMotion && this.corrupt > 0.02 && this.feedback.layer.canvas) {
      const corruption = wiredCorruptionProfile(this.corrupt, this.turnSmooth);
      frame.kit.blockGlitch(ctx, this.feedback.layer.canvas, width, height, {
        strength: corruption.strength,
        size: Math.max(12, Math.round(26 * frame.ratio)),
        count: 14,
        slide: corruption.slide,
        seed: this.lastBeat * 131 + (frame.frameIndex >> 2),
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  }

  suspend() {
    this.feedback.release();
    this.bloom.release();
    this.nearField.release();
  }
}
