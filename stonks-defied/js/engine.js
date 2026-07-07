// STONKS DEFIED — engine: GD-style bike physics, canvas renderer, game loop
window.SD = window.SD || {};

(function () {
  const E = SD.engine = {};
  const TAU = Math.PI * 2;

  // physics constants
  const G = 1360;          // gravity (y-down)
  const WHEEL_R = 12;
  const WHEELBASE = 48;
  const ENGINE = 1500;     // tangential accel on rear wheel
  const VMAX = 620;        // top tangential speed
  const BRAKE = 10.5;
  const LEAN_GROUND = 12;  // rider torque while a wheel is planted
  const LEAN_AIR = 9;      // air-control torque
  const WHEELIE = 8.5;     // nose-up torque while on the gas
  const ENDO = 18;         // nose-down torque from braking/leaning forward
  const INV_I = 1 / 880;   // chassis angular inverse inertia
  const STEP = 1 / 60, SUB = 8;

  let canvas, ctx, W = 0, H = 0, dpr = 1;
  let ter = null, def = null, bike = null;
  let state = 'idle';      // idle|ready|riding|crashed|finished
  let paused = false;
  let rideMs = 0, endT = 0, endShown = false, finishMs = 0;
  let cam = { x: 0, y: 0 };
  let particles = [], ragdoll = null;
  let acc = 0, lastT = 0, idleT = 0;

  const keys = { gas: false, brake: false, back: false, fwd: false };
  E.setKey = (k, v) => { keys[k] = v; if (k === 'gas' && v) onGas(); };
  E.state = () => state;
  E.paused = () => paused;
  E.def = () => def;
  E.bike = () => bike;
  E.rideMs = () => rideMs;

  // ---- vec helpers ----
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function normAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }
  function axis(b) {
    b = b || bike;
    if (b && 'a' in b) return { x: Math.cos(b.a), y: Math.sin(b.a) };
    let ax = b.front.p.x - b.rear.p.x, ay = b.front.p.y - b.rear.p.y;
    const d = Math.hypot(ax, ay) || 1;
    return { x: ax / d, y: ay / d };
  }
  function mid(b) {
    b = b || bike;
    if (b && b.p) return b.p;
    return { x: (b.rear.p.x + b.front.p.x) / 2, y: (b.rear.p.y + b.front.p.y) / 2 };
  }
  function framePoint(dx, dy, b) {
    b = b || bike;
    const a = axis(b), u = { x: a.y, y: -a.x }, m = mid(b);
    return { x: m.x + a.x * dx + u.x * dy, y: m.y + a.y * dx + u.y * dy };
  }
  function headPos() {
    const a = axis(), u = { x: a.y, y: -a.x }, b = riderBodyPos();
    return { x: b.x + u.x * 26 + a.x * 5, y: b.y + u.y * 26 + a.y * 5 };
  }

  function riderBodyPos(b) {
    return framePoint(-8, 19, b);
  }

  function newBike() {
    const x = ter.startX;
    const rearY = ter.groundY(x) - WHEEL_R;
    const frontY = ter.groundY(x + WHEELBASE) - WHEEL_R;
    const a0 = Math.atan2(frontY - rearY, WHEELBASE);
    const p = { x: x + WHEELBASE / 2, y: (rearY + frontY) / 2 };
    const mk = () => ({
      p: { x: 0, y: 0 },
      v: { x: 0, y: 0 },
      rel: { x: 0, y: 0 },
      rot: 0, spinV: 0, contact: false, t: { x: 1, y: 0 },
    });
    const bike = {
      p,
      v: { x: 0, y: 0 },
      a: a0,
      av: 0,
      rear: mk(),
      front: mk(),
      body: { p: { x: 0, y: 0 }, v: { x: 0, y: 0 } },
    };
    syncBike(bike);
    return bike;
  }

  function syncBike(b) {
    const a = { x: Math.cos(b.a), y: Math.sin(b.a) };
    const rearRel = { x: -a.x * WHEELBASE / 2, y: -a.y * WHEELBASE / 2 };
    const frontRel = { x: a.x * WHEELBASE / 2, y: a.y * WHEELBASE / 2 };
    setWheelFromRel(b.rear, b, rearRel);
    setWheelFromRel(b.front, b, frontRel);
    b.body.p = riderBodyPos(b);
    b.body.v = pointVelocity(b.body.p, b);
  }

  function setWheelFromRel(w, b, rel) {
    w.rel = rel;
    w.p.x = b.p.x + rel.x;
    w.p.y = b.p.y + rel.y;
    const pv = pointVelocity(w.p, b);
    w.v.x = pv.x;
    w.v.y = pv.y;
  }

  function pointVelocity(p, b) {
    b = b || bike;
    const rx = p.x - b.p.x, ry = p.y - b.p.y;
    return { x: b.v.x - ry * b.av, y: b.v.y + rx * b.av };
  }

  function applyImpulseAt(p, ix, iy) {
    const rx = p.x - bike.p.x, ry = p.y - bike.p.y;
    bike.v.x += ix;
    bike.v.y += iy;
    bike.av += (rx * iy - ry * ix) * INV_I;
    bike.av = clamp(bike.av, -18, 18);
  }

  function solveWheel(w) {
    const c = ter.contact(w.p.x, w.p.y, WHEEL_R);
    if (!c) return false;

    w.contact = true;
    let tx = -c.ny, ty = c.nx;
    if (tx < 0) { tx = -tx; ty = -ty; }
    w.t = { x: tx, y: ty };

    bike.p.x += c.nx * c.pen * 0.72;
    bike.p.y += c.ny * c.pen * 0.72;
    const rx = w.p.x - bike.p.x, ry = w.p.y - bike.p.y;
    bike.a = normAngle(bike.a + (rx * c.ny - ry * c.nx) * c.pen * INV_I * 0.34);
    syncBike(bike);

    const pv = pointVelocity(w.p);
    const rn = (w.p.x - bike.p.x) * c.ny - (w.p.y - bike.p.y) * c.nx;
    const vn = pv.x * c.nx + pv.y * c.ny;
    if (vn < 0) {
      const j = -(1.16 + Math.min(0.18, Math.abs(vn) / 1600)) * vn / (1 + rn * rn * INV_I);
      applyImpulseAt(w.p, c.nx * j, c.ny * j);
    }

    const pv2 = pointVelocity(w.p);
    const rt = (w.p.x - bike.p.x) * ty - (w.p.y - bike.p.y) * tx;
    const vt = pv2.x * tx + pv2.y * ty;
    const grip = w === bike.rear ? 0.0032 : 0.0024;
    const jt = -vt * grip / (1 + rt * rt * INV_I);
    applyImpulseAt(w.p, tx * jt, ty * jt);
    return true;
  }

  function wheelSpeed(w) {
    const pv = pointVelocity(w.p);
    return pv.x * w.t.x + pv.y * w.t.y;
  }

  // ---- simulation ----
  function sub(h) {
    const wheels = [bike.rear, bike.front];
    const wasGrounded = bike.rear.contact || bike.front.contact;

    // controls
    if (state === 'riding') {
      const leanInput = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0);
      const torque = wasGrounded ? LEAN_GROUND : LEAN_AIR;
      bike.av += leanInput * torque * h;

      if (keys.gas && bike.rear.contact) {
        const t = bike.rear.t;
        const vt = bike.v.x * t.x + bike.v.y * t.y;
        if (vt < VMAX) {
          const drive = ENGINE * (keys.back ? 1.08 : 1) * (keys.fwd ? 0.94 : 1);
          applyImpulseAt(bike.rear.p, t.x * drive * h, t.y * drive * h);
        }
        bike.av -= WHEELIE * h * (keys.back ? 0.85 : keys.fwd ? 0.04 : 0.72);
        if (Math.random() < h * 30) spawnExhaust();
      }
      if (keys.brake) {
        for (const w of wheels) if (w.contact) {
          const vt = wheelSpeed(w);
          const f = -vt * Math.min(0.52, BRAKE * h);
          applyImpulseAt(w.p, w.t.x * f, w.t.y * f);
        }
        if (bike.front.contact || keys.fwd) bike.av += ENDO * h;
      }
      if (leanInput) {
        if (keys.fwd) {
          if (bike.rear.contact || bike.front.contact) applyImpulseAt(bike.rear.p, 0, -400 * h);
          if (bike.front.contact) bike.av += ENDO * h * 0.28;
        }
        if (keys.back) {
          if (bike.rear.contact || bike.front.contact) applyImpulseAt(bike.front.p, 0, -280 * h);
          if (bike.rear.contact) bike.av -= WHEELIE * h * 0.2;
        }
      }
    }
    bike.av = clamp(bike.av, -18, 18);

    bike.v.y += G * h;
    bike.p.x += bike.v.x * h;
    bike.p.y += bike.v.y * h;
    bike.a = normAngle(bike.a + bike.av * h);
    bike.av *= 1 - (wasGrounded ? 0.45 : 0.12) * h;
    bike.v.x *= 1 - 0.012 * h;

    for (const w of wheels) w.contact = false;
    syncBike(bike);
    for (let it = 0; it < 3; it++) {
      for (const w of wheels) solveWheel(w);
      syncBike(bike);
    }

    // wheel spin (visual)
    for (const w of wheels) {
      if (w.contact) w.spinV = wheelSpeed(w) / WHEEL_R;
      else if (w === bike.rear && keys.gas && state === 'riding') w.spinV = Math.min(w.spinV + 60 * h, 55);
      else w.spinV *= 1 - 0.4 * h;
      w.rot += w.spinV * h;
    }

    // crash & finish checks
    if (state === 'riding') {
      const hp = headPos(), shoulder = framePoint(-2, 35), hip = riderBodyPos();
      if (rideMs > 700 && (
        ter.contact(hp.x, hp.y, 7.5) ||
        ter.contact(shoulder.x, shoulder.y, 5.5) ||
        ter.contact(hip.x, hip.y, 5)
      )) return doCrash();
      if (mid().y > ter.maxY + 700) return doCrash();
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

  function doCrash() {
    state = 'crashed'; endT = 0; endShown = false;
    const hp = headPos(), m = mid();
    const mv = {
      x: (bike.rear.v.x + bike.front.v.x) / 2,
      y: (bike.rear.v.y + bike.front.v.y) / 2,
    };
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
    state = 'ready'; paused = false;
    rideMs = 0; endT = 0; endShown = false;
    particles = []; ragdoll = null;
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
    if (state !== 'idle' && SD.ui) {
      const mx = mid().x;
      SD.ui.hudTick(rideMs, def, ter ? ter.priceAt(mx) : 0, state, ter && ter.dateAt ? ter.dateAt(mx) : '');
    }
  }

  // ---- rendering ----
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  function zoomLevel() {
    return Math.max(0.62, Math.min(1.5, Math.min(W / 860, H / 520)));
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
    const vx = (bike.rear.v.x + bike.front.v.x) / 2;
    const tx = m.x + Math.max(-80, Math.min(240, vx * 0.4));
    const ty = m.y - 44;
    const k = Math.min(1, dt * 5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    const z = zoomLevel();

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
    drawParticles();
    if (state === 'crashed') { drawBike(true); drawRagdoll(); }
    else drawBike(false);

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

  function drawBike(noRider) {
    const th = SD.theme;
    const a = axis(), u = { x: a.y, y: -a.x }, m = mid();
    const P = (dx2, dy2) => ({ x: m.x + a.x * dx2 + u.x * dy2, y: m.y + a.y * dx2 + u.y * dy2 });

    drawWheel(bike.rear);
    drawWheel(bike.front);

    // frame
    const bb = P(-2, 6), seat = bike.body ? riderBodyPos() : P(-9, 16), handle = P(14, 22);
    ctx.strokeStyle = th.frame; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bike.rear.p.x, bike.rear.p.y); ctx.lineTo(seat.x, seat.y);
    ctx.lineTo(handle.x, handle.y);
    ctx.lineTo(bike.front.p.x, bike.front.p.y);
    ctx.moveTo(bike.rear.p.x, bike.rear.p.y); ctx.lineTo(bb.x, bb.y);
    ctx.lineTo(handle.x, handle.y);
    ctx.stroke();

    if (noRider) return;

    // rider (THE driver — yellow by default)
    const lean = ((keys.fwd ? 1 : 0) - (keys.back ? 1 : 0)) * 5;
    const hp = headPos();
    const head = { x: hp.x + a.x * lean * 0.6, y: hp.y + a.y * lean * 0.6 };
    const hip = { x: seat.x + a.x * lean * 0.45, y: seat.y + a.y * lean * 0.45 };
    const shoulder = { x: hip.x + u.x * 16 + a.x * (lean * 0.35 + 4), y: hip.y + u.y * 16 + a.y * (lean * 0.35 + 4) };
    const knee = P(4 + lean * 0.3, 12);
    const foot = { x: bb.x + a.x * 2, y: bb.y + a.y * 2 };

    ctx.strokeStyle = th.driver; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y); ctx.lineTo(knee.x, knee.y); ctx.lineTo(foot.x, foot.y); // leg
    ctx.moveTo(hip.x, hip.y); ctx.lineTo(shoulder.x, shoulder.y);                     // torso
    ctx.moveTo(shoulder.x, shoulder.y); ctx.lineTo(handle.x, handle.y);               // arm
    ctx.stroke();

    // helmet
    ctx.fillStyle = th.driver;
    ctx.beginPath(); ctx.arc(head.x, head.y, 5.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = th.bg; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(head.x, head.y, 3.4, -0.5, 0.9); ctx.stroke(); // visor
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
      let price = ter.pmin + ((400 - y) / amp) * (ter.pmax - ter.pmin);
      if (def.log) {
        const llo = Math.log(ter.pmin), lhi = Math.log(ter.pmax);
        price = Math.exp(llo + ((400 - y) / amp) * (lhi - llo));
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
