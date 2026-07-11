// STONKS DEFIED — ui: cookies save, menus, audio beeps, overlays, input wiring
window.SD = window.SD || {};

(function () {
  const U = SD.ui = {};
  const $ = (id) => document.getElementById(id);
  const E = () => SD.engine;

  // ================= cookies save =================
  const COOKIE = 'stonksdefied';
  let save = { b: {}, th: 't610', un: [], mu: 0 };

  function loadSave() {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]*)'));
    if (m) {
      try {
        const s = JSON.parse(decodeURIComponent(m[1]));
        if (s && typeof s === 'object') save = Object.assign(save, s);
      } catch (e) { /* fresh save */ }
    }
  }
  function writeSave() {
    document.cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify(save)) +
      ';max-age=34560000;path=/;SameSite=Lax';
  }
  U.save = () => save;

  // ================= audio (monophonic, very Sony Ericsson) =================
  let actx = null;
  function ac() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, dur, delay, vol, type) {
    if (save.mu) return;
    const a = ac(); if (!a) return;
    const t0 = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(vol || 0.04, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const sfx = {
    click: () => tone(880, 0.05, 0, 0.035),
    back: () => tone(520, 0.06, 0, 0.035),
    start: () => { tone(660, 0.07, 0, 0.045); tone(990, 0.09, 0.08, 0.045); },
    crash: () => { tone(300, 0.1, 0, 0.06, 'sawtooth'); tone(150, 0.18, 0.07, 0.06, 'sawtooth'); tone(80, 0.3, 0.15, 0.05, 'sawtooth'); },
    finish: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.1, i * 0.09, 0.05)),
    unlock: () => [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.12, i * 0.1, 0.05)),
    deny: () => { tone(220, 0.08, 0, 0.05); tone(196, 0.12, 0.09, 0.05); },
  };
  U.sfx = sfx;

  // ================= helpers =================
  function fmtTime(ms) {
    const t = Math.max(0, Math.round(ms / 100));
    const m = Math.floor(t / 600), s = Math.floor((t % 600) / 10), d = t % 10;
    return m + ':' + String(s).padStart(2, '0') + '.' + d;
  }
  function fmtPar(sec) {
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  function fmtDate(d) {
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yy = String(d.getUTCFullYear()).slice(-2);
    return dd + '.' + mm + '.' + yy;
  }

  let toastT = null;
  function toast(msg, long) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.add('hidden'), long ? 4200 : 2200);
  }
  U.toast = toast;

  // ================= screens & menu nav =================
  const screens = ['main', 'levels', 'ticker', 'colors', 'credits'];
  let activeScreen = 'main';
  let focusIdx = 0;

  function show(name) {
    activeScreen = name;
    for (const s of screens) $('scr-' + s).classList.toggle('active', s === name);
    $('statusbar').style.display = name ? 'flex' : 'none';
    focusIdx = 0;
    refreshFocus();
    if (name === 'levels') buildLevelGrid();
    if (name === 'colors') buildSchemeList();
    if (name === 'ticker') setTimeout(() => $('ticker-input').focus(), 50);
  }
  function hideScreens() {
    activeScreen = null;
    for (const s of screens) $('scr-' + s).classList.remove('active');
    $('statusbar').style.display = 'none';
  }
  function focusables() {
    if (!activeScreen) return [];
    return [...$('scr-' + activeScreen).querySelectorAll('button, input')];
  }
  function refreshFocus() {
    const els = focusables();
    els.forEach((el, i) => el.classList.toggle('sel', i === focusIdx));
  }
  function menuKey(e) {
    const els = focusables();
    if (!els.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      focusIdx = (focusIdx + 1) % els.length; refreshFocus(); sfx.click(); return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      focusIdx = (focusIdx - 1 + els.length) % els.length; refreshFocus(); sfx.click(); return true;
    }
    if (e.key === 'Enter') {
      const el = els[focusIdx];
      if (el && el.tagName === 'BUTTON') { el.click(); return true; }
      if (el && el.id === 'ticker-input') { $('ticker-go').click(); return true; }
    }
    if (e.key === 'Escape' && activeScreen !== 'main') { show('main'); sfx.back(); return true; }
    return false;
  }

  // ================= level select =================
  function bestOf(id) { return save.b[id] || 0; }
  function beaten(def) { const b = bestOf(def.id); return b > 0 && b <= def.par * 1000; }

  function buildLevelGrid() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    for (const def of SD.levels.PRESETS) {
      const b = bestOf(def.id);
      const btn = document.createElement('button');
      btn.className = 'mbtn lvl';
      btn.innerHTML =
        '<span class="l-row1"><b>' + def.sym + '</b> &#183; ' + (def.co || def.sym) +
        ' &#8212; ' + def.nick +
        (beaten(def) ? ' <span class="medal">&#9650;</span>' : '') + '</span>' +
        '<span class="l-row2">' + def.era + ' &#183; PAR ' + fmtPar(def.par) +
        (b ? ' &#183; BEST ' + fmtTime(b) : '') + '</span>';
      btn.addEventListener('click', () => { sfx.click(); startLevel(def); });
      grid.appendChild(btn);
    }
  }

  // ================= colorschemes =================
  function unlockedTheme(id) { return !SD.THEMES[id].locked || save.un.includes(id); }

  function buildSchemeList() {
    const list = $('scheme-list');
    list.innerHTML = '';
    for (const id of Object.keys(SD.THEMES)) {
      const t = SD.THEMES[id];
      const open = unlockedTheme(id);
      const btn = document.createElement('button');
      btn.className = 'mbtn scheme' + (open ? '' : ' locked');
      btn.innerHTML =
        '<span class="chips">' +
        '<i style="background:' + t.bg + '"></i>' +
        '<i style="background:' + t.map + '"></i>' +
        '<i style="background:' + t.driver + '"></i></span>' +
        (SD.themeId === id ? '&#9654; ' : '') + t.name +
        (open ? '' : ' &#128274;');
      btn.addEventListener('click', () => {
        if (!open) { sfx.deny(); toast('LOCKED: ' + t.hint); return; }
        sfx.click();
        save.th = id; writeSave();
        SD.applyTheme(id);
        buildSchemeList();
      });
      list.appendChild(btn);
    }
  }

  function checkUnlock() {
    if (save.un.includes('goldenbull')) return false;
    const all = SD.levels.PRESETS.every(beaten);
    if (all) {
      save.un.push('goldenbull');
      writeSave();
      return true;
    }
    return false;
  }

  // ================= ticker =================
  let dialing = false;
  async function dialTicker(sym) {
    if (dialing) return;
    sym = (sym || '').trim().toUpperCase();
    if (!sym) return;
    dialing = true;
    const st = $('ticker-status');
    st.textContent = 'DIALING UP ' + sym + '...';
    try {
      const r = await SD.levels.fetchTicker(sym);
      st.textContent = r.live ? 'CONNECTED ▲ LIVE DATA' : 'WIRE DOWN ▼ SIMULATED CHART';
      const def = SD.levels.makeCustomDef(r.sym, r.prices, r.live, r.ts0, r.ts1);
      setTimeout(() => { startLevel(def); st.textContent = ''; }, 450);
    } catch (e) {
      st.textContent = 'BAD TICKER. TRY AGAIN.';
    }
    dialing = false;
  }

  // ================= game flow =================
  function startLevel(def) {
    hideScreens();
    $('hud').classList.remove('hidden');
    if (isTouch) $('touch').classList.remove('hidden');
    hideOverlay();
    E().startLevel(def);
  }

  U.onLevelStart = function (def) {
    $('hud-sym').textContent = def.sym;
    $('hud-par').textContent = 'PAR ' + fmtPar(def.par);
    banner('PRESS ▲ GAS TO OPEN POSITION');
  };
  U.onRideStart = function () { banner(null); sfx.start(); };

  U.onCrash = function () { sfx.crash(); banner('LIQUIDATED!', true); };
  U.onFinish = function (def, ms) {
    const prevBest = bestOf(def.id);
    if (!prevBest || ms < prevBest) { save.b[def.id] = Math.round(ms); writeSave(); }
    sfx.finish();
    banner(ms <= def.par * 1000 ? 'TO THE MOON! ▲' : 'POSITION CLOSED');
  };

  U.showEnd = function (state, def, ms) {
    banner(null);
    const isPreset = SD.levels.PRESETS.some(p => p.id === def.id);
    const idx = SD.levels.PRESETS.findIndex(p => p.id === def.id);
    const next = isPreset && idx < SD.levels.PRESETS.length - 1 ? SD.levels.PRESETS[idx + 1] : null;

    if (state === 'crashed') {
      const quips = [
        'YOUR PORTFOLIO HIT THE FLOOR', 'BUY HIGH, CRASH LOW', 'MARGIN CALL INCOMING',
        'THE MARKET CAN STAY IRRATIONAL LONGER THAN YOU CAN STAY UPRIGHT',
        'DIAMOND HANDS, GLASS HELMET', 'SELL SIGNAL CONFIRMED',
      ];
      showOverlay('LIQUIDATED!', quips[Math.floor(Math.random() * quips.length)], [
        { label: 'RE-ENTER ↻', fn: () => E().restart(), primary: true },
        { label: 'EXIT TO MENU', fn: quitToMenu },
      ]);
    } else {
      const under = ms <= def.par * 1000;
      const best = bestOf(def.id);
      let sub = 'TIME ' + fmtTime(ms) + ' / PAR ' + fmtPar(def.par);
      if (best && Math.round(ms) <= best) sub += '<br>NEW BEST!';
      sub += under ? '<br><span class="good">▲ UNDER PAR</span>' : '<br><span class="bad">▼ OVER PAR</span>';
      const btns = [];
      if (next) btns.push({ label: 'NEXT: ' + next.sym + ' ▶', fn: () => startLevel(next), primary: true });
      btns.push({ label: 'RETRY ↻', fn: () => E().restart(), primary: !next });
      btns.push({ label: 'EXIT TO MENU', fn: quitToMenu });
      showOverlay(under ? 'TO THE MOON! ▲' : 'POSITION CLOSED', sub, btns);
      if (checkUnlock()) {
        setTimeout(() => { sfx.unlock(); toast('★ COLORSCHEME UNLOCKED: GOLDEN BULL ★', true); }, 900);
      }
    }
  };

  U.hudTick = function (ms, def, price, state, date) {
    $('hud-time').textContent = fmtTime(ms);
    $('hud-time').classList.toggle('over', ms > def.par * 1000);
    $('hud-price').textContent = '$' + E().fmtPrice(price);
    $('hud-date').textContent = date ? fmtDate(date) : '';
  };

  function banner(text, danger) {
    const el = $('banner');
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.toggle('danger', !!danger);
    el.classList.remove('hidden');
  }

  function quitToMenu() {
    E().quit();
    hideOverlay();
    banner(null);
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    show('main');
  }

  // ================= overlay =================
  let ovBtns = [], ovIdx = 0;
  function showOverlay(title, sub, btns) {
    $('ov-title').textContent = title;
    $('ov-sub').innerHTML = sub;
    const box = $('ov-btns');
    box.innerHTML = '';
    ovBtns = []; ovIdx = 0;
    btns.forEach((b, i) => {
      const el = document.createElement('button');
      el.className = 'mbtn' + (b.primary ? ' primary' : '');
      el.textContent = b.label;
      el.addEventListener('click', () => { sfx.click(); b.fn(); });
      if (b.primary) ovIdx = i;
      box.appendChild(el);
      ovBtns.push(el);
    });
    refreshOvFocus();
    $('overlay').classList.remove('hidden');
  }
  function refreshOvFocus() { ovBtns.forEach((el, i) => el.classList.toggle('sel', i === ovIdx)); }
  function hideOverlay() { $('overlay').classList.add('hidden'); ovBtns = []; }
  function overlayVisible() { return !$('overlay').classList.contains('hidden'); }
  function overlayKey(e) {
    if (!ovBtns.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { ovIdx = (ovIdx + 1) % ovBtns.length; refreshOvFocus(); return true; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { ovIdx = (ovIdx - 1 + ovBtns.length) % ovBtns.length; refreshOvFocus(); return true; }
    if (e.key === 'Enter') { ovBtns[ovIdx].click(); return true; }
    return false;
  }

  function showPause() {
    E().setPaused(true);
    showOverlay('PAUSED', 'MARKET HALTED', [
      { label: 'RESUME ▶', fn: () => { E().setPaused(false); hideOverlay(); }, primary: true },
      { label: 'RETRY ↻', fn: () => { E().setPaused(false); E().restart(); hideOverlay(); } },
      { label: 'SOUND: ' + (save.mu ? 'OFF' : 'ON'), fn: () => { toggleMute(); showPause(); } },
      { label: 'EXIT TO MENU', fn: quitToMenu },
    ]);
  }
  function toggleMute() {
    save.mu = save.mu ? 0 : 1; writeSave();
    toast('SOUND ' + (save.mu ? 'OFF' : 'ON'));
  }

  // ================= input =================
  const isTouch = ('ontouchstart' in window) || (window.matchMedia && matchMedia('(pointer: coarse)').matches);

  const KEYMAP = {
    ArrowUp: 'gas', w: 'gas', W: 'gas', ' ': 'gas',
    ArrowDown: 'brake', s: 'brake', S: 'brake',
    ArrowLeft: 'back', a: 'back', A: 'back',
    ArrowRight: 'fwd', d: 'fwd', D: 'fwd',
  };

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.repeat) { if (KEYMAP[e.key] && !activeScreen) e.preventDefault(); return; }
      // typing a ticker
      if (document.activeElement === $('ticker-input')) {
        if (e.key === 'Enter') { $('ticker-go').click(); e.preventDefault(); }
        if (e.key === 'Escape') { show('main'); sfx.back(); }
        return;
      }
      if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
      if (overlayVisible()) { if (overlayKey(e)) e.preventDefault(); return; }
      if (activeScreen) { if (menuKey(e)) e.preventDefault(); return; }
      // in game
      const st = E().state();
      if (KEYMAP[e.key]) { E().setKey(KEYMAP[e.key], true); e.preventDefault(); return; }
      if (e.key === 'r' || e.key === 'R') { E().restart(); return; }
      if (e.key === 'Escape') {
        if (E().paused()) { E().setPaused(false); hideOverlay(); }
        else if (st !== 'idle') showPause();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (KEYMAP[e.key]) E().setKey(KEYMAP[e.key], false);
    });
  }

  function bindTouch() {
    const map = { 't-gas': 'gas', 't-brake': 'brake', 't-back': 'back', 't-fwd': 'fwd' };
    for (const id of Object.keys(map)) {
      const el = $(id);
      const on = (e) => { e.preventDefault(); el.classList.add('on'); E().setKey(map[id], true); };
      const off = (e) => { e.preventDefault(); el.classList.remove('on'); E().setKey(map[id], false); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    document.addEventListener('touchmove', (e) => {
      if (!activeScreen) e.preventDefault();
    }, { passive: false });
  }

  // ================= boot =================
  function boot() {
    loadSave();
    SD.applyTheme(save.th);
    SD.engine.init();

    // menu buttons
    document.querySelectorAll('[data-go]').forEach((el) => {
      el.addEventListener('click', () => {
        sfx.click();
        show(el.getAttribute('data-go'));
      });
    });
    $('ticker-go').addEventListener('click', () => { sfx.click(); dialTicker($('ticker-input').value); });
    $('ticker-input').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
    $('btn-pause').addEventListener('click', () => { if (!overlayVisible()) showPause(); });
    $('btn-restart').addEventListener('click', () => { sfx.click(); hideOverlay(); E().setPaused(false); E().restart(); });

    // hover sets menu focus
    document.addEventListener('mouseover', (e) => {
      if (!activeScreen) return;
      const els = focusables();
      const i = els.indexOf(e.target.closest('button, input'));
      if (i >= 0) { focusIdx = i; refreshFocus(); }
    });

    // fake status bar clock
    const clock = () => {
      const d = new Date();
      $('sb-clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    clock(); setInterval(clock, 20000);

    bindKeys();
    bindTouch();
    show('main');

    // ticker deep link: ?ticker=NVDA
    const q = new URLSearchParams(location.search).get('ticker');
    if (q) {
      show('ticker');
      $('ticker-input').value = q.toUpperCase();
      dialTicker(q);
    }
  }

  U._show = show; // debug/test hook
  U._startLevel = startLevel;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
