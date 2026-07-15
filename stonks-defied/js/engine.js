// STONKS DEFIED - engine: GD-style bike physics, canvas renderer, game loop
window.SD = window.SD || {};

(function () {
  const E = SD.engine = {};
  const TAU = Math.PI * 2;

  // physics constants
  const G = 870;           // gravity (y-down), tuned for GD-style hang time
  const WHEEL_R = 11;
  const WHEELBASE = 46;
  const BODY_MASS = 1.45;
  const WHEEL_MASS = 0.31;
  const BODY_INERTIA = 620;
  const BODY_INV_MASS = 1 / BODY_MASS;
  const WHEEL_INV_MASS = 1 / WHEEL_MASS;
  const BODY_INV_INERTIA = 1 / BODY_INERTIA;
  const TOTAL_MASS = BODY_MASS + WHEEL_MASS * 2;
  const SUSP_REST = 17;
  const SUSP_MIN = 9;
  const SUSP_MAX = 25;
  const SUSP_K = 220;
  const SUSP_BUMP_K = 820;
  const SUSP_COMP_DAMP = 9;
  const SUSP_REBOUND_DAMP = 4.6;
  const ENGINE_FORCE = 1250;
  const VMAX = 520;
  const BRAKE = 8;
  const DRIVE_TORQUE = 900;
  const AIR_DRIVE_TORQUE = 1450;
  const RIDER_MASS = 0.72;
  const RIDER_SHIFT = 14;
  const LEAN_RATE = 11;
  const LEAN_GROUND_TORQUE = 6500;
  const LEAN_AIR_TORQUE = 5200;
  const LEAN_UNLOAD = 2.2;
  const STALL_FORCE = 3200;
  const STALL_TORQUE = 1700;
  const MAX_OMEGA = 8.2;
  const STEP = 1 / 60, SUB = 4;

  let canvas, ctx, W = 0, H = 0, dpr = 1;
  let ter = null, def = null, bike = null;
  let state = 'idle';      // idle|ready|riding|crashed|finished
  let paused = false;
  let rideMs = 0, endT = 0, endShown = false, finishMs = 0;
  let cam = { x: 0, y: 0 };
  let particles = [], ragdoll = null;
  let tronTrail = [];
  let trick = null;
  let stallT = 0;
  let wheelieT = 0, wheelieBreakT = 0, wheelieDone = false;
  let riderHitT = 0, crashReason = '';
  let acc = 0, lastT = 0, idleT = 0;

  const keys = { gas: false, brake: false, back: false, fwd: false };
  E.setKey = (k, v) => { keys[k] = v; if (k === 'gas' && v) onGas(); };
  E.state = () => state;
  E.paused = () => paused;
  E.def = () => def;
  E.bike = () => bike;
  E.rideMs = () => rideMs;
  E.wheelieSeconds = () => wheelieT;
  E.crashReason = () => crashReason;

  // ---- vec helpers ----
  function axis() {
    return { x: Math.cos(bike.body.a), y: Math.sin(bike.body.a) };
  }
  function mid() {
    return bike.body.p;
  }
  function bikeAngle() {
    return bike.body.a;
  }
  function angleDelta(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }
  function headPos() {
    const a = axis(), u = { x: a.y, y: -a.x }, m = mid();
    const lean = bike.lean || 0;
    return {
      x: m.x + u.x * 17 + a.x * (4 + lean * 0.6),
      y: m.y + u.y * 17 + a.y * (4 + lean * 0.6),
    };
  }

  function bodyPoint(lx, ly) {
    const a = axis(), u = { x: a.y, y: -a.x }, p = bike.body.p;
    return { x: p.x + a.x * lx + u.x * ly, y: p.y + a.y * lx + u.y * ly };
  }

  function suspensionMount(wheel) {
    return bodyPoint(wheel === bike.rear ? -WHEELBASE * 0.46 : WHEELBASE * 0.46, -1);
  }

  function mountVelocity(mount) {
    const b = bike.body, rx = mount.x - b.p.x, ry = mount.y - b.p.y;
    return { x: b.v.x - b.w * ry, y: b.v.y + b.w * rx };
  }

  function suspensionAxes(wheel) {
    const a = axis();
    return {
      a,
      down: { x: -a.y, y: a.x },
      side: wheel === bike.rear ? -2 : 2,
    };
  }

  function posePoints() {
    const a = axis(), u = { x: a.y, y: -a.x };
    const bb = bodyPoint(-2, -8), seat = bodyPoint(-9, 2), handle = bodyPoint(14, 8);
    const lean = bike.lean || 0;
    const hp = headPos();
    const head = { x: hp.x, y: hp.y };
    const shoulder = { x: head.x - u.x * 8 - a.x * 2, y: head.y - u.y * 8 - a.y * 2 };
    const hip = bodyPoint(-8 + lean * 0.5, 3);
    const knee = bodyPoint(4 + lean * 0.3, -2);
    const foot = { x: bb.x + a.x * 2, y: bb.y + a.y * 2 };
    return { bb, seat, handle, head, shoulder, hip, knee, foot };
  }

  function segmentProbe(out, a, b, count, r) {
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        r,
      });
    }
  }

  function resolveChassisGround() {
    const p = posePoints();
    const probes = [
      { ...p.bb, r: 5 },
      { ...p.seat, r: 3.8 },
      { ...p.handle, r: 3.8 },
    ];
    segmentProbe(probes, p.bb, p.seat, 2, 4.2);
    segmentProbe(probes, p.bb, p.handle, 3, 4.2);

    let best = null;
    for (const q of probes) {
      const c = ter.contact(q.x, q.y, q.r);
      if (c && (!best || c.pen > best.c.pen)) best = { q, c };
    }
    if (!best) return false;

    const b = bike.body, c = best.c;
    // Keep frame contact continuous. Large repeated corrections at a chart
    // vertex used to hoist the entire bike onto the peak in one frame.
    const correction = Math.min(0.9, Math.max(0, c.pen - 0.35) * 0.18);
    b.p.x += c.nx * correction;
    b.p.y += c.ny * correction;

    const rx = best.q.x - b.p.x, ry = best.q.y - b.p.y;
    const pvx = b.v.x - b.w * ry, pvy = b.v.y + b.w * rx;
    const vn = pvx * c.nx + pvy * c.ny;
    if (vn < 0) {
      const arm = rx * c.ny - ry * c.nx;
      const effInv = BODY_INV_MASS + arm * arm * BODY_INV_INERTIA;
      const impulse = -vn * 0.82 / effInv;
      b.v.x += c.nx * impulse * BODY_INV_MASS;
      b.v.y += c.ny * impulse * BODY_INV_MASS;
      b.w += arm * impulse * BODY_INV_INERTIA;
    }
    return true;
  }

  function newBike() {
    const x = ter.startX;
    const rearY = ter.groundY(x) - WHEEL_R;
    const frontY = ter.groundY(x + WHEELBASE) - WHEEL_R;
    const angle = Math.atan2(frontY - rearY, WHEELBASE);
    const up = { x: Math.sin(angle), y: -Math.cos(angle) };
    const mk = (wx, wy) => ({
      p: { x: wx, y: wy },
      v: { x: 0, y: 0 },
      rot: 0, spinV: 0, contact: false, t: { x: 1, y: 0 }, susp: SUSP_REST,
    });
    return {
      body: {
        p: { x: x + WHEELBASE * 0.5 + up.x * 15, y: (rearY + frontY) * 0.5 + up.y * 15 },
        v: { x: 0, y: 0 }, a: angle, w: 0,
      },
      rear: mk(x, rearY),
      front: mk(x + WHEELBASE, frontY),
      lean: 0,
    };
  }

  function applyBodyForce(fx, fy, point, h) {
    const b = bike.body;
    b.v.x += fx * BODY_INV_MASS * h;
    b.v.y += fy * BODY_INV_MASS * h;
    if (point) {
      const rx = point.x - b.p.x, ry = point.y - b.p.y;
      b.w += (rx * fy - ry * fx) * BODY_INV_INERTIA * h;
    }
  }

  function applyWheelForce(w, fx, fy, h) {
    w.v.x += fx * WHEEL_INV_MASS * h;
    w.v.y += fy * WHEEL_INV_MASS * h;
  }

  function applyBikeForce(fx, fy, h) {
    const dvx = fx / TOTAL_MASS * h, dvy = fy / TOTAL_MASS * h;
    bike.body.v.x += dvx; bike.body.v.y += dvy;
    bike.rear.v.x += dvx; bike.rear.v.y += dvy;
    bike.front.v.x += dvx; bike.front.v.y += dvy;
  }

  function applySuspension(w, h) {
    const mount = suspensionMount(w);
    const mv = mountVelocity(mount);
    const s = suspensionAxes(w);
    const dx = w.p.x - mount.x, dy = w.p.y - mount.y;
    const long = dx * s.down.x + dy * s.down.y;
    const lateral = dx * s.a.x + dy * s.a.y - s.side;
    const rvx = w.v.x - mv.x, rvy = w.v.y - mv.y;
    const relLong = rvx * s.down.x + rvy * s.down.y;
    const relLat = rvx * s.a.x + rvy * s.a.y;
    const damp = relLong < 0 ? SUSP_COMP_DAMP : SUSP_REBOUND_DAMP;
    let longForce = (SUSP_REST - long) * SUSP_K - relLong * damp;
    if (long < SUSP_MIN) longForce += (SUSP_MIN - long) * SUSP_BUMP_K;
    if (long > SUSP_MAX) longForce -= (long - SUSP_MAX) * SUSP_BUMP_K;
    longForce = Math.max(-7000, Math.min(7000, longForce));
    const latForce = Math.max(-7000, Math.min(7000, -lateral * 1050 - relLat * 18));
    const fx = s.down.x * longForce + s.a.x * latForce;
    const fy = s.down.y * longForce + s.a.y * latForce;
    applyWheelForce(w, fx, fy, h);
    applyBodyForce(-fx, -fy, mount, h);
    w.susp = long;
  }

  function enforceSuspensionLimit(w) {
    const mount = suspensionMount(w);
    const s = suspensionAxes(w);
    const dx = w.p.x - mount.x, dy = w.p.y - mount.y;
    const long = dx * s.down.x + dy * s.down.y;
    const targetLong = Math.max(SUSP_MIN, Math.min(SUSP_MAX, long));
    const targetX = mount.x + s.a.x * s.side + s.down.x * targetLong;
    const targetY = mount.y + s.a.y * s.side + s.down.y * targetLong;
    let corrX = w.p.x - targetX, corrY = w.p.y - targetY;
    const corrLen = Math.hypot(corrX, corrY);
    // Sharp chart vertices can put the tires on opposing faces for one step.
    // Resolve that disagreement progressively instead of snapping the chassis.
    if (corrLen > 2.5) {
      corrX *= 2.5 / corrLen;
      corrY *= 2.5 / corrLen;
    }
    w.susp = targetLong;
    const invSum = WHEEL_INV_MASS + BODY_INV_MASS;
    w.p.x -= corrX * WHEEL_INV_MASS / invSum;
    w.p.y -= corrY * WHEEL_INV_MASS / invSum;
    bike.body.p.x += corrX * BODY_INV_MASS / invSum;
    bike.body.p.y += corrY * BODY_INV_MASS / invSum;

    const mount2 = suspensionMount(w);
    const mv = mountVelocity(mount2);
    const rx = mount2.x - bike.body.p.x, ry = mount2.y - bike.body.p.y;
    const solveVelocity = (nx, ny, rel, strength) => {
      const arm = rx * ny - ry * nx;
      const effInv = WHEEL_INV_MASS + BODY_INV_MASS + arm * arm * BODY_INV_INERTIA;
      const impulse = -rel * strength / effInv;
      w.v.x += nx * impulse * WHEEL_INV_MASS;
      w.v.y += ny * impulse * WHEEL_INV_MASS;
      bike.body.v.x -= nx * impulse * BODY_INV_MASS;
      bike.body.v.y -= ny * impulse * BODY_INV_MASS;
      bike.body.w -= arm * impulse * BODY_INV_INERTIA;
    };
    const rvx = w.v.x - mv.x, rvy = w.v.y - mv.y;
    const relLat = rvx * s.a.x + rvy * s.a.y;
    solveVelocity(s.a.x, s.a.y, relLat, 0.45);
    const relLong = rvx * s.down.x + rvy * s.down.y;
    const escaping = (long > SUSP_MAX && relLong > 0) || (long < SUSP_MIN && relLong < 0);
    if (escaping) solveVelocity(s.down.x, s.down.y, relLong, 1);
  }

  // ---- simulation ----
  function sub(h) {
    const wheels = [bike.rear, bike.front];
    const wasGrounded = bike.rear.contact || bike.front.contact;
    const steer = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0);
    const leanTarget = state === 'riding' ? steer * RIDER_SHIFT : 0;
    bike.lean += (leanTarget - bike.lean) * Math.min(1, LEAN_RATE * h);

    applyBodyForce(0, BODY_MASS * G, null, h);
    for (const w of wheels) {
      applyWheelForce(w, 0, WHEEL_MASS * G, h);
    }

    // Shifted rider weight loads the fork or rear shock before any steering torque.
    if (Math.abs(bike.lean) > 0.001) {
      const rider = bodyPoint(bike.lean, 7);
      applyBodyForce(0, RIDER_MASS * G, rider, h);
      applyBodyForce(0, -RIDER_MASS * G, null, h); // BODY_MASS already includes the rider
    }

    applySuspension(bike.rear, h);
    applySuspension(bike.front, h);

    if (state === 'riding') {
      if (keys.gas && bike.rear.contact) {
        const t = bike.rear.t;
        const speed = bike.body.v.x * t.x + bike.body.v.y * t.y;
        const speedLimit = Math.max(0, Math.min(1, (VMAX - speed) / 90));
        const stallBoost = 1 + Math.max(0, Math.min(1, (90 - Math.abs(speed)) / 90)) * 0.9;
        const drive = ENGINE_FORCE * speedLimit * stallBoost;
        applyBikeForce(t.x * drive, t.y * drive, h);
        bike.body.w -= DRIVE_TORQUE * BODY_INV_INERTIA * h;
        if (Math.random() < h * 30) spawnExhaust();
      } else if (keys.gas && !bike.front.contact) {
        // Rear-wheel spin carries an equal nose-up reaction through the drivetrain.
        bike.body.w -= AIR_DRIVE_TORQUE * BODY_INV_INERTIA * h;
      }
      if (keys.brake) {
        for (const w of wheels) if (w.contact) {
          const vt = w.v.x * w.t.x + w.v.y * w.t.y;
          const f = Math.min(1, BRAKE * h);
          w.v.x -= w.t.x * vt * f;
          w.v.y -= w.t.y * vt * f;
        }
      }
      if (steer) {
        const torque = wasGrounded ? LEAN_GROUND_TORQUE : LEAN_AIR_TORQUE;
        bike.body.w += steer * torque * BODY_INV_INERTIA * h;
        if (wasGrounded) {
          const a = axis(), up = { x: a.y, y: -a.x };
          const lift = G * LEAN_UNLOAD * h;
          const lifted = steer < 0 ? bike.front : bike.rear;
          const loaded = steer < 0 ? bike.rear : bike.front;
          lifted.v.x += up.x * lift; lifted.v.y += up.y * lift;
          loaded.v.x -= up.x * lift * 0.16; loaded.v.y -= up.y * lift * 0.16;
        }
      }
    }

    bike.body.w *= Math.exp(-(wasGrounded ? 0.25 : 0.08) * h);
    bike.body.w = Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, bike.body.w));
    bike.body.p.x += bike.body.v.x * h;
    bike.body.p.y += bike.body.v.y * h;
    bike.body.a += bike.body.w * h;
    for (const w of wheels) {
      w.p.x += w.v.x * h;
      w.p.y += w.v.y * h;
    }

    for (let it = 0; it < 2; it++) {
      enforceSuspensionLimit(bike.rear);
      enforceSuspensionLimit(bike.front);
    }

    // ground contacts
    for (const w of wheels) {
      w.contact = false;
      const c = ter.contact(w.p.x, w.p.y, WHEEL_R);
      if (c) {
        const correction = Math.min(c.pen, 2.5);
        w.p.x += c.nx * correction; w.p.y += c.ny * correction;
        const vn = w.v.x * c.nx + w.v.y * c.ny;
        if (vn < 0) {
          const restitution = Math.min(0.38, 0.20 + Math.max(0, -vn - 35) * 0.0011);
          w.v.x -= c.nx * vn * (1 + restitution);
          w.v.y -= c.ny * vn * (1 + restitution);
        }
        let tx = -c.ny, ty = c.nx;
        if (tx < 0) { tx = -tx; ty = -ty; }
        const vt = w.v.x * tx + w.v.y * ty;
        w.v.x -= tx * vt * 0.0025; w.v.y -= ty * vt * 0.0025;
        w.contact = true; w.t = { x: tx, y: ty };
      }
    }

    // Ground projection moves each wheel independently. Re-couple the bike
    // before rider collision checks, especially when straddling a sharp peak.
    for (let it = 0; it < 4; it++) {
      enforceSuspensionLimit(bike.rear);
      enforceSuspensionLimit(bike.front);
    }

    if (state === 'riding') trackWheelie(h);

    if (state === 'riding' && keys.gas && bike.rear.contact && Math.abs(bike.body.v.x) < 85) {
      stallT += h;
    } else {
      stallT = Math.max(0, stallT - h * 3);
    }
    if (stallT > 0.18) {
      const ramp = Math.min(1, (stallT - 0.18) / 0.28);
      const look = 30;
      const dy = ter.groundY(bike.front.p.x + look) - ter.groundY(bike.front.p.x);
      const dl = Math.hypot(look, dy) || 1;
      const climb = { x: look / dl, y: dy / dl };
      applyBikeForce(climb.x * STALL_FORCE * ramp, climb.y * STALL_FORCE * ramp, h);
      if (!keys.fwd) {
        const wheelie = keys.back ? 1 : 0.42;
        bike.body.w -= STALL_TORQUE * wheelie * BODY_INV_INERTIA * h;
        bike.front.v.y -= G * 0.2 * wheelie * ramp * h;
      }
    }

    const chassisContact = resolveChassisGround();

    // wheel spin (visual)
    for (const w of wheels) {
      if (w.contact) w.spinV = (w.v.x * w.t.x + w.v.y * w.t.y) / WHEEL_R;
      else if (w === bike.rear && keys.gas && state === 'riding') w.spinV = Math.min(w.spinV + 60 * h, 55);
      else w.spinV *= 1 - 0.4 * h;
      w.rot += w.spinV * h;
    }

    if (state === 'riding') trackTricks();

    // crash & finish checks
    if (state === 'riding') {
      const hp = headPos();
      const headHit = ter.contact(hp.x, hp.y, 7.5);
      const pose = posePoints();
      const tor = {
        x: (pose.shoulder.x + pose.hip.x) * 0.5,
        y: (pose.shoulder.y + pose.hip.y) * 0.5,
      };
      const torsoHit = ter.contact(tor.x, tor.y, 6.5);
      const riderPen = Math.max(headHit ? headHit.pen - 1.5 : 0, torsoHit ? torsoHit.pen - 5.5 : 0);
      if (riderPen > 0) {
        const uprightOnFrame = chassisContact && Math.cos(bike.body.a) > 0.2;
        riderHitT += uprightOnFrame ? -h * 5 : h;
        riderHitT = Math.max(0, riderHitT);
        const supported = bike.rear.contact || bike.front.contact;
        const grace = supported ? 0.16 : 0.055;
        if (!uprightOnFrame && (riderHitT > grace || (riderPen > 9 && !supported))) {
          return doCrash(headHit && headHit.pen > 1.5 ? 'head' : 'torso');
        }
      } else {
        riderHitT = Math.max(0, riderHitT - h * 3);
      }
      if (mid().y > ter.maxY + 700) return doCrash('fall');
      if (Math.min(bike.rear.p.x, bike.front.p.x) > ter.finishX) return doFinish();
    }

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= h;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.v.y += G * p.grav * h;
      p.p.x += p.v.x * h; p.p.y += p.v.y * h;
      if (p.bounce) {
        const c = ter.contact(p.p.x, p.p.y, p.r);
        if (c) {
          p.p.x += c.nx * c.pen; p.p.y += c.ny * c.pen;
          const vn = p.v.x * c.nx + p.v.y * c.ny;
          if (vn < 0) { p.v.x -= c.nx * vn * 1.45; p.v.y -= c.ny * vn * 1.45; }
          p.v.x *= 0.7; p.v.y *= 0.7;
        }
      }
      if (p.spin) p.a += p.spin * h;
    }
  }

  function spawnExhaust() {
    const t = bike.rear.t, u = { x: t.y, y: -t.x };
    particles.push({
      kind: 'puff',
      p: { x: bike.rear.p.x - t.x * 16, y: bike.rear.p.y - t.y * 16 + u.y * 4 },
      v: { x: -t.x * 50 + (Math.random() - 0.5) * 30, y: -30 - Math.random() * 30 },
      life: 0.4 + Math.random() * 0.25, max: 0.65, r: 2 + Math.random() * 2.5, grav: -0.02,
    });
  }

  function spawnConfetti() {
    const m = mid();
    for (let i = 0; i < 26; i++) {
      particles.push({
        kind: 'cash',
        p: { x: m.x + (Math.random() - 0.5) * 30, y: m.y - 20 },
        v: { x: (Math.random() - 0.5) * 360, y: -180 - Math.random() * 260 },
        life: 1.6 + Math.random(), max: 2.6, r: 4, grav: 0.35,
        a: Math.random() * TAU, spin: (Math.random() - 0.5) * 8,
      });
    }
  }

  function trackTricks() {
    if (!trick) return;
    const ang = bikeAngle();
    const d = angleDelta(ang, trick.lastAng);
    trick.lastAng = ang;
    const bothGrounded = bike.rear.contact && bike.front.contact;
    const landed = bike.rear.contact || bike.front.contact;

    // A backflip may begin from a wheelie and finish as soon as either tire lands.
    if (!trick.active && !bothGrounded && d < -0.001) trick.active = true;
    if (trick.active) {
      if (d < 0) trick.backRot += d;
      else if (!trick.backReady) trick.backRot = Math.min(0, trick.backRot + d * 0.15);
      if (trick.backRot <= -Math.PI * 0.83) trick.backReady = true;
    }

    if (trick.backReady && landed && !trick.backDone) {
      trick.backDone = true;
      if (SD.ui && SD.ui.onBackflip) SD.ui.onBackflip(def);
    }

    if (bothGrounded && !trick.backReady) {
      trick.active = false;
      trick.backRot = 0;
    }
  }

  function trackWheelie(h) {
    const frontClearance = ter.groundY(bike.front.p.x) - (bike.front.p.y + WHEEL_R);
    const rearClearance = ter.groundY(bike.rear.p.x) - (bike.rear.p.y + WHEEL_R);
    const attitude = angleDelta(bike.body.a, 0);
    const rearSupported = bike.rear.contact || rearClearance < 7;
    const holding = rearSupported && !bike.front.contact &&
      attitude < -0.12 && attitude > -1.75 && frontClearance > 4;
    if (holding) {
      wheelieBreakT = 0;
      wheelieT += h;
      if (wheelieT >= 2 && !wheelieDone) {
        wheelieDone = true;
        if (SD.ui && SD.ui.onWheelie) SD.ui.onWheelie(def);
      }
    } else {
      wheelieBreakT += h;
      if (wheelieBreakT > 0.35) wheelieT = 0;
    }
  }

  function doCrash(reason) {
    crashReason = reason || 'impact';
    state = 'crashed'; endT = 0; endShown = false;
    const hp = headPos(), m = mid();
    const mv = { x: bike.body.v.x, y: bike.body.v.y };
    ragdoll = { head: { p: hp, v: { x: mv.x * 1.05 + 40, y: mv.y - 130 }, r: 6, rot: 0 } };
    for (let i = 0; i < 7; i++) {
      particles.push({
        kind: 'debris',
        p: { x: m.x, y: m.y - 10 },
        v: { x: mv.x * 0.6 + (Math.random() - 0.5) * 260, y: mv.y * 0.4 - Math.random() * 240 },
        life: 1.5 + Math.random(), max: 2.5, r: 2.5, grav: 1, bounce: true,
        a: Math.random() * TAU, spin: (Math.random() - 0.5) * 14,
      });
    }
    if (SD.ui) SD.ui.onCrash(def);
  }

  function doFinish() {
    state = 'finished'; endT = 0; endShown = false;
    finishMs = rideMs;
    spawnConfetti();
    if (SD.ui) SD.ui.onFinish(def, finishMs);
  }

  function onGas() {
    if (state === 'ready' && !paused) {
      state = 'riding';
      if (SD.ui) SD.ui.onRideStart();
    }
  }

  // ---- ragdoll ----
  function simRagdoll(h) {
    if (!ragdoll) return;
    const hd = ragdoll.head;
    hd.v.y += G * h;
    hd.p.x += hd.v.x * h; hd.p.y += hd.v.y * h;
    hd.rot += hd.v.x * 0.02 * h * 60;
    const c = ter.contact(hd.p.x, hd.p.y, hd.r);
    if (c) {
      hd.p.x += c.nx * c.pen; hd.p.y += c.ny * c.pen;
      const vn = hd.v.x * c.nx + hd.v.y * c.ny;
      if (vn < 0) { hd.v.x -= c.nx * vn * 1.4; hd.v.y -= c.ny * vn * 1.4; }
      hd.v.x *= 0.85; hd.v.y *= 0.85;
    }
  }

  // ---- lifecycle ----
  E.startLevel = function (d) {
    def = d;
    ter = SD.levels.buildTerrain(d);
    bike = newBike();
    trick = { lastAng: bikeAngle(), active: false, backRot: 0, backReady: false, backDone: false };
    state = 'ready'; paused = false;
    rideMs = 0; endT = 0; endShown = false;
    stallT = 0;
    wheelieT = 0; wheelieBreakT = 0; wheelieDone = false;
    riderHitT = 0; crashReason = '';
    acc = 0;
    particles = []; ragdoll = null; tronTrail = [];
    const m = mid();
    cam.x = m.x; cam.y = m.y - 40;
    if (SD.ui) SD.ui.onLevelStart(d);
  };
  E.restart = () => { if (def) E.startLevel(def); };
  E.setPaused = (v) => { paused = v; };
  E.quit = () => { state = 'idle'; def = null; ter = null; paused = false; };

  // ---- main loop ----
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    idleT += dt;
    if (state !== 'idle' && !paused) {
      acc += dt;
      while (acc >= STEP) {
        acc -= STEP;
        const h = STEP / SUB;
        for (let s = 0; s < SUB; s++) { sub(h); if (state === 'crashed') simRagdoll(h); }
        if (state === 'riding') rideMs += STEP * 1000;
        if (state === 'crashed' || state === 'finished') {
          endT += STEP;
          const delay = state === 'crashed' ? 0.9 : 0.75;
          if (endT > delay && !endShown) {
            endShown = true;
            if (SD.ui) SD.ui.showEnd(state, def, finishMs);
          }
        }
      }
    }
    render(dt);
    if (state !== 'idle' && SD.ui) SD.ui.hudTick(rideMs, def, ter ? ter.priceAt(mid().x) : 0, state, ter ? ter.dateAt(mid().x) : null);
  }

  // ---- rendering ----
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  function zoomLevel() {
    return Math.max(0.8, Math.min(2.2, Math.min(W / 600, H / 360)));
  }

  function render(dt) {
    const th = SD.theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.bg2); g.addColorStop(1, th.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (state === 'idle' || !ter) { renderAttract(); return; }

    // camera
    const m = mid();
    const vx = bike.body.v.x;
    const tx = m.x + Math.max(-100, Math.min(320, vx * 0.55));
    const ty = m.y - 28;
    const k = 1 - Math.exp(-11 * dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    const z = zoomLevel();
    const currentPrice = ter.priceAt(m.x);

    drawPriceEcho(currentPrice);

    ctx.save();
    ctx.translate(W / 2 - cam.x * z, H / 2 - cam.y * z);
    ctx.scale(z, z);

    const vw = W / z, vh = H / z;
    const vx0 = cam.x - vw / 2, vx1 = cam.x + vw / 2;
    const vy0 = cam.y - vh / 2, vy1 = cam.y + vh / 2;

    drawGrid(vx0, vx1, vy0, vy1, z);
    drawWatermark(vx0, vy0, vw, vh);
    drawTerrain(vx0, vx1, vy1);
    drawFlags();
    updateTronTrail(dt);
    drawTronTrail();
    drawParticles();
    drawBikePixelSnapped(state === 'crashed', z);
    if (state === 'crashed') drawRagdoll();

    ctx.restore();

    drawPriceLabels(z, vy0, vy1);
  }

  function drawGrid(x0, x1, y0, y1, z) {
    const th = SD.theme;
    ctx.lineWidth = 1 / z;
    const gx = 130, gy = 90;
    ctx.strokeStyle = th.grid;
    ctx.beginPath();
    for (let x = Math.floor(x0 / gx) * gx; x < x1; x += gx) {
      ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    }
    for (let y = Math.floor(y0 / gy) * gy; y < y1; y += gy) {
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    }
    ctx.stroke();
  }

  function drawWatermark(x0, y0, vw, vh) {
    const th = SD.theme;
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.fillStyle = th.text;
    ctx.font = '700 ' + Math.round(vh * 0.34) + 'px "VT323", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.sym, x0 + vw / 2 - (cam.x * 0.02 % vw) * 0, y0 + vh * 0.36);
    ctx.restore();
  }

  function drawPriceEcho(price) {
    if (!ter || !isFinite(price)) return;
    const th = SD.theme;
    const label = '$' + fmtPrice(price);
    const drift = -((cam.x * 0.075) % 170);
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = th.text;
    ctx.font = '700 46px "VT323", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let x = drift + 8; x < Math.min(W * 0.62, 430); x += 170) {
      ctx.fillText(label, x, 48);
    }
    ctx.globalAlpha = 0.05;
    ctx.font = '700 18px "VT323", monospace';
    ctx.fillText(def.sym + ' / ' + (def.co || def.sym), 10 + ((cam.x * 0.035) % 18), 38);
    ctx.restore();
  }

  function drawTerrain(x0, x1, ybot) {
    const th = SD.theme;
    const i0 = Math.max(0, Math.floor((x0 - ter.x0) / ter.dx) - 1);
    const i1 = Math.min(ter.N - 1, Math.ceil((x1 - ter.x0) / ter.dx) + 1);
    if (i1 <= i0) return;

    // area fill
    ctx.beginPath();
    ctx.moveTo(ter.x0 + i0 * ter.dx, ybot + 50);
    for (let i = i0; i <= i1; i++) ctx.lineTo(ter.x0 + i * ter.dx, ter.ys[i]);
    ctx.lineTo(ter.x0 + i1 * ter.dx, ybot + 50);
    ctx.closePath();
    ctx.fillStyle = th.mapFill;
    ctx.fill();

    // the chart line itself
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const x = ter.x0 + i * ter.dx;
      if (i === i0) ctx.moveTo(x, ter.ys[i]); else ctx.lineTo(x, ter.ys[i]);
    }
    ctx.strokeStyle = th.map;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // data-point ticks
    ctx.fillStyle = th.map;
    for (let i = i0 + (4 - (i0 % 4)) % 4; i <= i1; i += 4) {
      const x = ter.x0 + i * ter.dx;
      ctx.fillRect(x - 2, ter.ys[i] - 2, 4, 4);
    }
  }

  function drawFlags() {
    const th = SD.theme;
    // start
    flag(ter.startX - 40, 'IPO', th.dim);
    // finish
    flag(ter.finishX, '$', th.accent);
  }
  function flag(x, label, color) {
    const gy = ter.groundY(x);
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - 64); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, gy - 64); ctx.lineTo(x + 34, gy - 55); ctx.lineTo(x, gy - 46);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = SD.theme.bg;
    ctx.font = '700 12px "VT323", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 5, gy - 55);
  }

  function drawWheel(w) {
    const th = SD.theme;
    ctx.strokeStyle = th.frame; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(w.p.x, w.p.y, WHEEL_R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let s = 0; s < 3; s++) {
      const a = w.rot + s * TAU / 3;
      ctx.moveTo(w.p.x - Math.cos(a) * WHEEL_R * 0.8, w.p.y - Math.sin(a) * WHEEL_R * 0.8);
      ctx.lineTo(w.p.x + Math.cos(a) * WHEEL_R * 0.8, w.p.y + Math.sin(a) * WHEEL_R * 0.8);
    }
    ctx.stroke();
  }

  function drawShock(mount, wheel) {
    const th = SD.theme;
    const dx = wheel.p.x - mount.x, dy = wheel.p.y - mount.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len, ty = dy / len, nx = -ty, ny = tx;
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(mount.x, mount.y);
    ctx.lineTo(mount.x + dx * 0.22, mount.y + dy * 0.22);
    for (let i = 0; i <= 6; i++) {
      const f = 0.25 + i * 0.075;
      const side = (i === 0 || i === 6) ? 0 : (i % 2 ? 2.2 : -2.2);
      ctx.lineTo(mount.x + tx * len * f + nx * side, mount.y + ty * len * f + ny * side);
    }
    ctx.lineTo(wheel.p.x, wheel.p.y);
    ctx.stroke();
  }

  function updateTronTrail(dt) {
    for (const p of tronTrail) p.life -= dt;
    while (tronTrail.length && tronTrail[0].life <= 0) tronTrail.shift();
    if (SD.themeId !== 'tron') { tronTrail.length = 0; return; }
    if (state !== 'riding') return;
    const x = bike.rear.p.x, y = bike.rear.p.y;
    const last = tronTrail[tronTrail.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) > 8) {
      tronTrail.push({ x, y, life: 0.9 });
      if (tronTrail.length > 36) tronTrail.shift();
    }
  }

  function drawTronTrail() {
    if (SD.themeId !== 'tron' || tronTrail.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#00bcd4';
    ctx.lineWidth = 3.2;
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.moveTo(tronTrail[0].x, tronTrail[0].y);
    for (let i = 1; i < tronTrail.length; i++) {
      ctx.lineTo(tronTrail[i].x, tronTrail[i].y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#72f6ff';
    ctx.lineWidth = 1.1;
    ctx.globalAlpha = 0.42;
    ctx.stroke();
    ctx.restore();
  }

  function drawBikePixelSnapped(noRider, z) {
    const sx = (W * 0.5 + (bike.body.p.x - cam.x) * z) * dpr;
    const sy = (H * 0.5 + (bike.body.p.y - cam.y) * z) * dpr;
    const snapX = (Math.round(sx) - sx) / (z * dpr);
    const snapY = (Math.round(sy) - sy) / (z * dpr);
    ctx.save();
    ctx.translate(snapX, snapY);
    drawBike(noRider);
    ctx.restore();
  }

  const ROOSTER_MASK = [
    '..KK...KK.......',
    '.KRRK.KRRK......',
    'KRRRRKRRRRK.....',
    'KRRRRRRRRRRK....',
    'KRRRRRRWWRRK....',
    'KRRRRRRWKRRKKYY.',
    'KRRRRRRRRRKKYYY.',
    '.KRRRRRRRRRKYY..',
    '..KRRRRRRRK.....',
    '...KRRRRRK......',
    '...KRRKKRK......',
    '...KRK.KRK......',
    '...KK..KK.......',
  ];

  function drawRoosterMask(head) {
    const a = axis();
    const along = bike.body.v.x * a.x + bike.body.v.y * a.y;
    const facing = along < -8 ? -1 : 1;
    const colors = { K: '#26000f', R: '#ff3f50', W: '#fff0df', Y: '#fff45b' };
    const px = 1.35;
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(bike.body.a);
    ctx.scale(facing, 1);
    ctx.translate(-8 * px, -6.5 * px);
    for (let y = 0; y < ROOSTER_MASK.length; y++) {
      const row = ROOSTER_MASK[y];
      for (let x = 0; x < row.length; x++) {
        const color = colors[row[x]];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * px, y * px, px + 0.12, px + 0.12);
      }
    }
    ctx.fillStyle = '#16000a';
    ctx.fillRect(9 * px, 5 * px, px, px);
    ctx.restore();
  }

  function drawBike(noRider) {
    const th = SD.theme;
    const pose = posePoints();
    const rearMount = suspensionMount(bike.rear);
    const frontMount = suspensionMount(bike.front);

    drawWheel(bike.rear);
    drawWheel(bike.front);
    drawShock(rearMount, bike.rear);
    drawShock(frontMount, bike.front);

    // Rigid chassis with articulated swingarm and fork.
    const bb = pose.bb, seat = pose.seat, handle = pose.handle;
    ctx.strokeStyle = th.frame; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bike.rear.p.x, bike.rear.p.y); ctx.lineTo(bb.x, bb.y);
    ctx.lineTo(seat.x, seat.y);
    ctx.lineTo(handle.x, handle.y);
    ctx.lineTo(bike.front.p.x, bike.front.p.y);
    ctx.moveTo(bb.x, bb.y);
    ctx.lineTo(handle.x, handle.y);
    ctx.moveTo(rearMount.x, rearMount.y); ctx.lineTo(frontMount.x, frontMount.y);
    ctx.stroke();

    if (noRider) return;

    // rider (THE driver - yellow by default)
    const head = pose.head, shoulder = pose.shoulder, hip = pose.hip;
    const knee = pose.knee, foot = pose.foot;

    ctx.strokeStyle = th.driver; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y); ctx.lineTo(knee.x, knee.y); ctx.lineTo(foot.x, foot.y); // leg
    ctx.moveTo(hip.x, hip.y); ctx.lineTo(shoulder.x, shoulder.y);                     // torso
    ctx.moveTo(shoulder.x, shoulder.y); ctx.lineTo(handle.x, handle.y);               // arm
    ctx.stroke();

    if (SD.themeId === 'hotline') {
      drawRoosterMask(head);
    } else {
      // helmet
      ctx.fillStyle = th.driver;
      ctx.beginPath(); ctx.arc(head.x, head.y, 5.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = th.bg; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(head.x, head.y, 3.4, -0.5, 0.9); ctx.stroke(); // visor
    }
  }

  function drawRagdoll() {
    if (!ragdoll) return;
    const th = SD.theme, hd = ragdoll.head;
    ctx.save();
    ctx.translate(hd.p.x, hd.p.y);
    ctx.rotate(hd.rot);
    ctx.fillStyle = th.driver;
    ctx.beginPath(); ctx.arc(0, 0, hd.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = th.bg; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, 3.6, -0.5, 0.9); ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    const th = SD.theme;
    for (const p of particles) {
      const f = Math.max(0, p.life / p.max);
      if (p.kind === 'puff') {
        ctx.globalAlpha = f * 0.4;
        ctx.fillStyle = th.text;
        ctx.beginPath(); ctx.arc(p.p.x, p.p.y, p.r * (2 - f), 0, TAU); ctx.fill();
      } else if (p.kind === 'cash') {
        ctx.globalAlpha = Math.min(1, f * 2);
        ctx.save();
        ctx.translate(p.p.x, p.p.y); ctx.rotate(p.a);
        ctx.fillStyle = th.good;
        ctx.font = '700 14px "VT323", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('$', 0, 0);
        ctx.restore();
      } else { // debris
        ctx.globalAlpha = Math.min(1, f * 2);
        ctx.save();
        ctx.translate(p.p.x, p.p.y); ctx.rotate(p.a);
        ctx.fillStyle = th.frame;
        ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPriceLabels(z, vy0, vy1) {
    if (!ter) return;
    const th = SD.theme;
    const gy = 90;
    ctx.fillStyle = th.dim;
    ctx.font = '13px "VT323", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    // world y=400 is pmin, y=400-amp is pmax (pre-clamp approximation)
    const amp = def.amp || 260;
    for (let y = Math.floor(vy0 / gy) * gy; y < vy1; y += gy) {
      const scale = def.scale || (def.log ? 'log' : 'linear');
      const f = (400 - y) / amp;
      let price;
      if (scale === 'log') {
        const llo = Math.log(ter.pmin), lhi = Math.log(ter.pmax);
        price = Math.exp(llo + f * (lhi - llo));
      } else if (scale === 'sqrt') {
        const slo = Math.sqrt(ter.pmin), shi = Math.sqrt(ter.pmax);
        const s = slo + f * (shi - slo);
        price = s * s;
      } else {
        price = ter.pmin + f * (ter.pmax - ter.pmin);
      }
      if (price < ter.pmin * 0.5 || price > ter.pmax * 2) continue;
      const sy = (y - cam.y) * z + H / 2;
      if (sy < 68 || sy > H - 8) continue;
      ctx.fillText('$' + fmtPrice(price), 8, sy - 2);
    }
  }

  function fmtPrice(p) {
    if (p >= 1000) return Math.round(p).toLocaleString('en-US');
    if (p >= 100) return p.toFixed(1);
    return p.toFixed(2);
  }
  E.fmtPrice = fmtPrice;

  // ---- attract mode (behind menus) ----
  let attract = null;
  function renderAttract() {
    const th = SD.theme;
    if (!attract) {
      attract = [];
      let v = 0.5;
      for (let i = 0; i < 260; i++) {
        v += (Math.random() - 0.48) * 0.09;
        v = Math.max(0.05, Math.min(0.95, v));
        attract.push(v);
      }
    }
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (-(idleT * 20) % 60); x < W; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y < H; y += 60) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    ctx.strokeStyle = th.map;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const n = attract.length, sp = 34;
    const off = (idleT * 30) % sp;
    for (let i = 0; i < n; i++) {
      const x = i * sp - off - ((Math.floor(idleT * 30 / sp)) % n) * 0;
      const idx = (i + Math.floor(idleT * 30 / sp)) % n;
      const y = H * 0.82 - attract[idx] * H * 0.33;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      if (x > W + sp) break;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- boot ----
  E.init = function () {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', () => { resize(); });
    requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(frame); });
  };
})();
