let currentRenderId = 0;
// ========== DOM ELEMENTS ==========
const gameContainer = document.getElementById('main-list');

// ===== LOADER COUNTDOWN =====
// Roman-ish glyphs from 10 down to 0
const LOADER_SYMBOLS = {
  10: 'Ⅹ',
  9:  'Ⅸ',
  8:  'Ⅷ',
  7:  'Ⅶ',
  6:  'Ⅵ',
  5:  'Ⅴ',
  4:  'Ⅳ',
  3:  'Ⅲ',
  2:  'Ⅱ',
  1:  'Ⅰ',
  0:  '∞'   // you can swap for some funky glyph if you want
};

let loaderTimer   = null;
let loaderValue   = 10;
let loaderActive  = false;

function loaderSetNumber(value) {
  const numEl  = document.getElementById('loader-number');
  const dotsEl = document.querySelector('.loader-dots');
  if (!numEl || !dotsEl) return;

  const symbol = LOADER_SYMBOLS[value] ?? String(value);
  numEl.textContent = symbol;

  // restart number animation
  numEl.classList.remove('animate-in');
  void numEl.offsetWidth;           // force reflow
  numEl.classList.add('animate-in');

  // little shake on dots when number "clicks in"
  dotsEl.classList.remove('shake');
  void dotsEl.offsetWidth;
  dotsEl.classList.add('shake');
}

function showLoader()
{
  const overlay = document.getElementById('loader-overlay');
  if (!overlay) return;

  overlay.classList.remove('loader-hidden');
  loaderActive = true;
  loaderValue  = 10;
  loaderSetNumber(loaderValue);

  if (loaderTimer) clearInterval(loaderTimer);
  loaderTimer = setInterval(() => {
    if (!loaderActive) return;

    loaderValue--;
    if (loaderValue < 0) {
      // stay at 0, stop counting
      loaderValue = 0;
      clearInterval(loaderTimer);
      loaderTimer = null;
      return;
    }
    loaderSetNumber(loaderValue);
  }, 1000);
}

function hideLoader() {
  const overlay = document.getElementById('loader-overlay');
  if (!overlay) return;

  loaderActive = false;
  if (loaderTimer) {
    clearInterval(loaderTimer);
    loaderTimer = null;
  }
  overlay.classList.add('loader-hidden');
}

// ========== TIER ORDER ==========
const TIER_ORDER = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E'];

let viewMode = 'grid'; // 'grid' or 'pillar'
let activePillarAxis = 'score'; // 'score', 'played', 'released'

// ========== LOAD AND PROCESS GAMES ==========
let allGames = [];

function gameKey(g)
{
  return LIST_CONFIG.getKey(g);
}

async function enrichGames(games)
{
  try
  {
    showLoader();
    return await LIST_CONFIG.enrichItems(games);
  }
  catch (e)
  {
    console.error("Failed to enrich items:", e);
    return games.map(g => ({ ...g, image: 'img/placeholder.png' }));
  }
  finally
  {
    hideLoader();
  }
}

function createGameCard(game)
{
  const wrapper = document.createElement('div');
  wrapper.className = 'game-card-wrapper';
  wrapper.dataset.key = gameKey(game);

  const titleOverlay = document.createElement('div');
  titleOverlay.className = 'game-title-overlay';
  const titleUrl = LIST_CONFIG.getLink(game);

  if (titleUrl)
  {
    titleOverlay.innerHTML =
      `<a href="${titleUrl}" target="_blank">${game.name}</a>`;
  }
  else
  {
    titleOverlay.textContent = game.name;
  }

  const card = document.createElement('div');
  card.className = 'game-card';

  const img = document.createElement('img');
  img.src = game.image || 'img/placeholder.png';
  img.alt = game.name;
  img.loading = 'lazy';     // only fetch covers as they approach the viewport
  img.decoding = 'async';   // don't block paint on image decode
  card.appendChild(img);

  const commentHtml = (game.comment || '').replace(/\n/g, '<br>');

  const infoOverlay = document.createElement('div');
  infoOverlay.className = 'game-details-overlay';
  infoOverlay.innerHTML = LIST_CONFIG.getDetailsHtml(game);

  const expOverlay = document.createElement('div');
  expOverlay.className = 'game-exp-overlay';
  expOverlay.innerHTML = `
    ${LIST_CONFIG.getExpHtml(game)}
    <p>Score: <span>${game.score || '?'}<span></p>
    <div class="exp-spacer"></div>
    <p class="game-comment">〝${commentHtml}〞</p>
  `;

  // 🔻 NEW: SCORE STRIP – only in "sort by score" mode
  let scoreStrip = null;
  if (sortKey === 'score')
  {
    scoreStrip = document.createElement('div');
    scoreStrip.className = 'game-score-overlay';
    scoreStrip.textContent =
      (game.score !== undefined && game.score !== null && game.score !== '')
        ? game.score
        : '?';
  }

  // Append everything directly to wrapper
  wrapper.appendChild(titleOverlay);
  wrapper.appendChild(card);
  if(scoreStrip)
    wrapper.appendChild(scoreStrip);
  wrapper.appendChild(infoOverlay);
  wrapper.appendChild(expOverlay);

  // Grab the COMMENT element inside EXP overlay
  const commentEl = expOverlay.querySelector('.game-comment');

  // Bottom portion of EXP where we keep overlays visible.
  // Example: 0.5 = bottom 50% is "safe".
  const SAFE_ZONE_START = 0.5;

  wrapper.addEventListener('mouseenter', () =>
  {
    const rect = wrapper.getBoundingClientRect();
    const maxOverlayWidth = window.innerWidth * 0.32; // 32vw = your max-width
    const spaceRight = window.innerWidth - rect.right;

    if (spaceRight < maxOverlayWidth) {
      expOverlay.classList.add('open-left');
    } else {
      expOverlay.classList.remove('open-left');
    }

    // Whenever we re-enter a card, allow overlays again
    wrapper.classList.remove('force-collapse');
  });

  wrapper.addEventListener('mouseleave', () =>
  {
    expOverlay.classList.remove('open-left');
    // Reset collapse state when we truly leave the card
    wrapper.classList.remove('force-collapse');
  });

  // Moving over the EXP overlay:
  // - In safe (bottom) zone → overlays stay
  // - In top area (outside safe zone & not on comment) → collapse everything,
  //   same as if the wrapper wasn't hovered at all.
  expOverlay.addEventListener('mousemove', (e) =>
  {
    // In inspiration view the overlay must stay open so the score/details are
    // readable; the tierlist "collapse on top region" behaviour causes the
    // magnetic focus to flicker as the overlay vanishes under the cursor.
    if (document.body.classList.contains('inspiration-mode')) return;
    const rect = expOverlay.getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height; // 0 = top, 1 = bottom
    const overComment = e.target.closest('.game-comment') !== null;

    const inSafeZone = relY >= SAFE_ZONE_START;

    if (!inSafeZone && !overComment) {
      // Top area of EXP (not comment) → nuke all overlays
      wrapper.classList.add('force-collapse');
      // After this, overlays are "dead" until you truly leave the card
      // and re-enter (wrapper mouseleave + mouseenter).
    }
  });

  // Bonus: entering the comment itself always keeps overlays alive
  if (commentEl) {
    commentEl.addEventListener('mouseenter', (e) =>
    {
      wrapper.classList.remove('force-collapse');
      e.stopPropagation();
    });
  }
    // coming back to the main card revives overlays
    card.addEventListener('mouseenter', () =>
      {
        wrapper.classList.remove('force-collapse');
      });

  return wrapper;
}

function buildTierSection(tierName, games)
{
    const section = document.createElement('div');
    section.className = 'tier-section';

    const tierRowWrapper = document.createElement('div');
    tierRowWrapper.className = 'tier-row';

    const label = document.createElement('div');
    label.className = 'tier-label cursive';
    label.textContent = tierName;
    tierRowWrapper.appendChild(label);
        const row = document.createElement('div');
    row.className = 'row';

// ===== YEAR / ROW LAYOUT =====
const _yearKeys = LIST_CONFIG.yearSortKeys ?? ['played', 'released'];
if (_yearKeys.includes(sortKey))
  {
    const maxPerRow = calcMaxCardsPerRow();

    // helper to get the "year" string for a game based on current sort
    const getYear = (game) =>
    {
      const fn = LIST_CONFIG.sortFns?.[sortKey];
      return fn ? (fn(game) || 'N/A') : 'N/A';
    };

    let i = 0;
    let slotsLeft = maxPerRow; // how many card slots remain in the current row

    while (i < games.length)
    {
      const currentYear = getYear(games[i]);

      // how many consecutive games share this year, starting at i
      let runEnd = i + 1;
      while (runEnd < games.length && getYear(games[runEnd]) === currentYear)
      {
        runEnd++;
      }
      let remainingInYear = runEnd - i;

      // while we still have games from this year, keep carving groups
      while (remainingInYear > 0)
      {
        if (slotsLeft === 0)
        {
          // conceptually start a new visual row
          slotsLeft = maxPerRow;
        }

        const take = Math.min(remainingInYear, slotsLeft);

        const group = document.createElement('div');
        group.className = 'year-group';

        const cardsRow = document.createElement('div');
        cardsRow.className = 'year-group-cards';

        for (let k = 0; k < take; k++)
        {
          const g = games[i + k];
          const card = createGameCard(g);
          cardsRow.appendChild(card);
        }

        const yearLabel = document.createElement('div');
        yearLabel.className = 'year-label';
        yearLabel.textContent = currentYear;

        group.appendChild(cardsRow);
        group.appendChild(yearLabel);
        row.appendChild(group);

        i += take;
        remainingInYear -= take;
        slotsLeft -= take;
      }
    }
  }
  else
  {
    // ===== DEFAULT: just cards next to each other =====
    games.forEach(game =>
    {
      const card = createGameCard(game);
      row.appendChild(card);
    });
  }


    tierRowWrapper.appendChild(row);
    section.appendChild(tierRowWrapper);

    const divider = document.createElement('div');
    divider.className = 'art-divider';

    return [section, divider];
}

function calcMaxCardsPerRow()
{
  // Probe container to get real width + gap
  const probeRow = document.createElement('div');
  probeRow.className = 'row';
  probeRow.style.visibility = 'hidden';
  probeRow.style.position = 'absolute';

  // KEY PART: make it span the viewport width, not shrink to content
  probeRow.style.left = '0';
  probeRow.style.right = '0';
  probeRow.style.width = '100%';

  const probeCard = document.createElement('div');
  probeCard.className = 'game-card-wrapper';

  probeRow.appendChild(probeCard);
  document.body.appendChild(probeRow);

  const rowWidth  = probeRow.clientWidth || window.innerWidth;
  const cardWidth = probeCard.offsetWidth || 169;

  const style = getComputedStyle(probeRow);
  const gapStr = style.columnGap || style.gap || '0';
  const gap    = parseFloat(gapStr) || 0;

  document.body.removeChild(probeRow);

  const total = cardWidth + gap;
  if (!total || rowWidth <= 0) return 1;

  const perRow = Math.floor((rowWidth + gap) / total);
  return Math.max(1, perRow-1);
}

function renderGames(games)
{
    gameContainer.innerHTML = '';
    const tierMap = {};
    TIER_ORDER.forEach(tier => tierMap[tier] = []);
    games.forEach(game =>
    {
        if (tierMap[game.tier])
            tierMap[game.tier].push(game);
    });
    TIER_ORDER.forEach(tier =>
    {
        if (tierMap[tier].length)
        {
            const [section, divider] = buildTierSection(tier, tierMap[tier]);
            gameContainer.appendChild(section);
            gameContainer.appendChild(divider);
        }
    });

  // decide which side overlays should open on for this layout
  setupOverlaySides();
}

let globalRafId = null;
function renderGamesAnimated(games)
{
  currentRenderId++;
  const thisRenderId = currentRenderId;
  const container = gameContainer;

  // --- 1. STOP THE WORLD & GARBAGE COLLECTION ---
  // Cancel any pending animation frame from a previous rapid click
  if (globalRafId) {
    cancelAnimationFrame(globalRafId);
    globalRafId = null;
  }

  // Immediately nuke ANY ghost cards from the document.
  // This cleans up clones from a previous render that might still be animating.
  document.querySelectorAll('.game-card-wrapper.is-leaving').forEach(el => el.remove());
  container.querySelector('.inspiration-grid')?.remove();   // drop floating cloud tiles when leaving inspiration

  // Lock height to prevent scroll jumping
  container.style.minHeight = `${container.offsetHeight}px`;

  // --- 2. SNAPSHOT OLD POSITIONS ---
  const oldEls = Array.from(container.querySelectorAll('.game-card-wrapper'));
  const oldRectByKey = new Map();
  for (const el of oldEls) {
    if (el.dataset.key) {
      oldRectByKey.set(el.dataset.key, el.getBoundingClientRect());
    }
  }

  const nextKeys = new Set(games.map(gameKey));

  // --- 3. HANDLE DELETIONS (Make Ghosts) ---
  for (const el of oldEls) {
    const key = el.dataset.key;
    // If this card is staying, skip it
    if (!key || nextKeys.has(key)) continue;

    const rect = el.getBoundingClientRect();

    // Don't clone invisible elements
    if (rect.width === 0 || rect.height === 0) {
        el.remove();
        continue;
    }

    const clone = el.cloneNode(true);

    // Freeze it exactly where it is on screen
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      zIndex: '1000',
      pointerEvents: 'none',
      transform: 'none',
      opacity: '1'
    });

    clone.classList.add('is-leaving');
    clone.classList.remove('is-moving', 'is-entering');
    document.body.appendChild(clone);

    // Trigger the exit animation next frame
    requestAnimationFrame(() => {
      clone.style.transition = 'transform 0.4s ease, opacity 0.4s ease';
      clone.style.transform = `translate3d(${window.innerWidth * 0.5}px, 0, 0)`;
      clone.style.opacity = '0';
    });

    // FAILSAFE: Remove after 500ms even if transitionend misses
    setTimeout(() => clone.remove(), 500);

    // Remove original immediately
    el.remove();
  }

  // --- 4. RENDER NEW ---
  renderGames(games);

  // --- 5. CALCULATE INVERTS ---
  const newEls = Array.from(container.querySelectorAll('.game-card-wrapper'));

  for (const el of newEls) {
    const key = el.dataset.key;
    const newRect = el.getBoundingClientRect();
    const oldRect = oldRectByKey.get(key);

    if (oldRect) {
      // MOVE: Calculate delta
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      el.dataset.animType = 'move';
    } else {
      // ENTER: Drop in
      const dropHeight = Math.max(350, window.innerHeight * 0.45);
      el.style.transform = `translate3d(0, ${-dropHeight}px, 0)`;
      el.style.opacity = '0';
      el.dataset.animType = 'enter';
    }
  }

  // --- 6. PLAY ANIMATION ---
  void container.offsetHeight; // Force Reflow

  globalRafId = requestAnimationFrame(() =>
  {
    // Safety check: if user clicked again while waiting for frame, abort
    if (thisRenderId !== currentRenderId) return;

    container.style.minHeight = '';

    for (const el of newEls)
    {
      const type = el.dataset.animType;

      if (type === 'move') {
        el.classList.add('is-moving');
        el.style.transform = 'translate3d(0,0,0)';
        el.style.opacity = '1';
      } else if (type === 'enter') {
        el.classList.add('is-entering');
      }

      // Cleanup listener
      const cleanup = (e) => {
        if (e && e.type === 'transitionend' && e.propertyName !== 'transform') return;
        el.classList.remove('is-moving', 'is-entering');
        el.style.transform = '';
        el.style.opacity = '';
        delete el.dataset.animType;
        el.removeEventListener('transitionend', cleanup);
        el.removeEventListener('animationend', cleanup);
      };

      el.addEventListener('transitionend', cleanup);
      el.addEventListener('animationend', cleanup);
    }
  });
}

function setupOverlaySides()
{
  const wrappers = document.querySelectorAll('.game-card-wrapper');
  // Inspiration mode scales the wrapper on hover, needs extra headroom.
  const isInspiration = document.body.classList.contains('inspiration-mode');
  const maxOverlayWidth = window.innerWidth * (isInspiration ? 0.38 : 0.32);

  wrappers.forEach(wrapper => {
    const rect = wrapper.getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.right;

    if (spaceRight < maxOverlayWidth) {
      // Not enough space on the right → always open this one to the left
      wrapper.classList.add('exp-open-left');
    } else {
      wrapper.classList.remove('exp-open-left');
    }
  });
}

// ===== INSPIRATION VIEW =====

const TILE_CLOUDS = [
  'img/clouds/cloud (1).png',
  'img/clouds/cloud (4).png',
  'img/clouds/cloud (5).png',
  'img/clouds/cloud (6).png',
];

// BG (sky + cloud layers + mist) is injected only while inspiration view is
// active and fully removed otherwise — avoids any chance of bleeding into
// other views.
function ensureInspirationBg(show)
{
  let bg = document.getElementById('inspiration-bg');
  if (!show) { if (bg) bg.remove(); return; }
  if (bg) return;
  bg = document.createElement('div');
  bg.id = 'inspiration-bg';
  bg.className = 'inspiration-bg';
  bg.setAttribute('aria-hidden', 'true');
  bg.innerHTML =
    '<div class="cloud-layer cloud-layer-1"></div>' +
    '<div class="cloud-layer cloud-layer-2"></div>' +
    '<div class="cloud-layer cloud-layer-3"></div>' +
    '<div class="cloud-layer cloud-layer-4"></div>' +
    '<div class="bottom-mist"></div>';
  document.body.appendChild(bg);
}

// Soft-cluster games by theme; matched on name fragment so apostrophe
// variants don't matter.
function inspirationGroupOf(name)
{
  if (/Haste|Mirror|Prototype/.test(name))               return 0; // locomotion
  if (/Brotherhood|Uncharted|Last of Us/.test(name))     return 1; // AAA spectacle
  if (/DmC|Noire|Max Payne|Darkness/.test(name))         return 2; // noir / moody
  return 3;                                                         // lone (Bulletstorm, etc.)
}

function renderInspirationView(games)
{
  gameContainer.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'inspiration-grid';

  // Responsive layout — tile width/spacing shrink on narrow (phone) viewports so
  // cards never have to overlap. Poster aspect is ~1.5, so height = width * 1.5.
  const viewportW = window.innerWidth;
  const narrow = viewportW < 760;
  const tileW = narrow ? Math.max(150, Math.min(210, Math.round(viewportW * 0.62))) : 280;
  const tileH = Math.round(tileW * 1.5);
  grid.style.setProperty('--tile-w', tileW + 'px');

  // Collision is based on the ACTUAL rendered card footprint (the visible poster
  // is a fixed 169x253 left-aligned inside the larger --tile-w container), NOT
  // the tile box. Using the tile box made minSep far too big, so cluster
  // placement failed and fell back to the "allow overlap" last resort.
  const CARD_W = 169, CARD_H = 253;
  const minSepX = CARD_W + 20, minSepY = CARD_H + 26;  // AABB collision (card + buffer)
  const inGroupR = narrow ? 130 : 200;                // intra-cluster radius
  const padTop = 0, padBot = narrow ? 120 : 200;
  const padSide = narrow ? Math.round(tileW / 2) + 8 : 170;

  const cols  = Math.max(1, Math.floor((viewportW - 2 * padSide) / minSepX));
  // Reserve enough rows for every card (+1 spare row) so the relaxation pass
  // always has room to separate everyone without overlap.
  const rows  = Math.ceil(games.length / cols) + 1;
  const areaH = Math.max(narrow ? 800 : 1000, rows * minSepY + CARD_H + 80);
  grid.style.minHeight = (padTop + areaH + padBot) + 'px';

  const minX = padSide, maxX = viewportW - padSide;
  // Cards are top-aligned at y and are CARD_H tall, so only reserve the card
  // height at the bottom (not the much taller tile box).
  const minY = padTop,  maxY = padTop + areaH - CARD_H;

  const collides = (x, y, others) =>
    others.some(p => Math.abs(p.x - x) < minSepX && Math.abs(p.y - y) < minSepY);
  const randXY = () => ({
    x: minX + Math.random() * (maxX - minX),
    y: minY + Math.random() * (maxY - minY),
  });

  // 1. Pick a separated center for each cluster.
  const groupIds   = [...new Set(games.map(g => inspirationGroupOf(g.name)))];
  const groupCenter = {};
  const groupSepX = minSepX * 1.25, groupSepY = minSepY;
  groupIds.forEach(gid =>
  {
    let c = null;
    for (let i = 0; i < 300 && !c; i++)
    {
      const p = randXY();
      const ok = Object.values(groupCenter).every(o =>
        Math.abs(o.x - p.x) >= groupSepX || Math.abs(o.y - p.y) >= groupSepY);
      if (ok) c = p;
    }
    groupCenter[gid] = c || randXY();
  });

  // 2. Place each card near its cluster center, expanding the radius if it
  //    can't fit; brute-force anywhere as a fallback; allow overlap last.
  const positions = [];
  games.forEach(g =>
  {
    const center = groupCenter[inspirationGroupOf(g.name)];
    let chosen = null;

    outer:
    for (const radius of [inGroupR, inGroupR * 1.7, inGroupR * 2.6, inGroupR * 4])
    {
      for (let i = 0; i < 200; i++)
      {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * radius;
        const x = Math.max(minX, Math.min(maxX, center.x + Math.cos(a) * r));
        const y = Math.max(minY, Math.min(maxY, center.y + Math.sin(a) * r));
        if (!collides(x, y, positions)) { chosen = { x, y }; break outer; }
      }
    }
    if (!chosen) for (let i = 0; i < 500 && !chosen; i++)
    {
      const p = randXY();
      if (!collides(p.x, p.y, positions)) chosen = p;
    }
    positions.push(chosen || randXY());
  });

  // 3. Relaxation pass — guarantees no two cards visually overlap regardless of
  //    viewport width. Any colliding pair is shoved apart along its axis of
  //    least penetration; positions stay clamped to bounds. With only a handful
  //    of cards this converges in a few iterations and preserves the clusters.
  for (let iter = 0; iter < 120; iter++)
  {
    let moved = false;
    for (let i = 0; i < positions.length; i++)
    {
      for (let j = i + 1; j < positions.length; j++)
      {
        const a = positions[i], b = positions[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const penX = minSepX - Math.abs(dx);
        const penY = minSepY - Math.abs(dy);
        if (penX <= 0 || penY <= 0) continue;          // not overlapping
        if (penX < penY)                                // separate horizontally
        {
          const push = (penX / 2 + 0.5) * (dx < 0 ? -1 : 1);
          a.x = Math.max(minX, Math.min(maxX, a.x - push));
          b.x = Math.max(minX, Math.min(maxX, b.x + push));
        }
        else                                            // separate vertically
        {
          const push = (penY / 2 + 0.5) * (dy < 0 ? -1 : 1);
          a.y = Math.max(minY, Math.min(maxY, a.y - push));
          b.y = Math.max(minY, Math.min(maxY, b.y + push));
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  games.forEach((game, i) =>
  {
    const { x, y } = positions[i];

    const tile = document.createElement('div');
    tile.className = 'inspiration-tile';
    tile.style.left = x + 'px';
    tile.style.top  = y + 'px';

    // Staggered cinematic entrance — cards rise and resolve into focus in waves.
    tile.style.setProperty('--enter-delay', (i * 0.06).toFixed(2) + 's');

    const inner = document.createElement('div');
    inner.className = 'inspiration-tile-card';
    const cloud = TILE_CLOUDS[Math.floor(Math.random() * TILE_CLOUDS.length)];
    inner.style.setProperty('--cloud-img',   `url("${cloud}")`);
    inner.style.setProperty('--float-delay', (Math.random() * 6).toFixed(2) + 's');
    inner.style.setProperty('--float-dur',   (6 + Math.random() * 5).toFixed(2) + 's');

    // Light stack (back→front): beam → card → dust → flare. Hover/tilt is
    // driven globally by the magnetic system below.
    inner.appendChild(Object.assign(document.createElement('div'), { className: 'light-beam' }));
    inner.appendChild(createGameCard(game));
    inner.appendChild(Object.assign(document.createElement('div'), { className: 'light-dust' }));
    inner.appendChild(Object.assign(document.createElement('div'), { className: 'light-flare' }));

    tile.appendChild(inner);
    grid.appendChild(tile);
  });

  gameContainer.appendChild(grid);
  requestAnimationFrame(setupOverlaySides);
}

// ===== MAGNETIC HOVER =====
// Single card gets the focused treatment based on cursor proximity. Hysteresis
// (DEACTIVATE_PAD > ACTIVATE_PAD) prevents flicker between adjacent cards.
const MAGNETIC = {
  ACTIVATE_PAD:   180,
  DEACTIVATE_PAD: 260,
  SWITCH_MARGIN:  90,   // a rival card must be this much closer to steal focus
  SCALE_MIN:      1.11,
  SCALE_MAX:      1.22,
  TILT_MAX:       12,
};
const LIGHT_VARS = ['--beam-x','--beam-y','--beam-angle','--flare-x','--flare-y','--light-strength'];
let _magneticActiveTile = null;
let _magneticRaf = null;
let _lastMouseEvt = null;
let _loseGrace = 0;
const LOSE_GRACE_FRAMES = 6;   // hold focus briefly so a 1-frame hit-test gap doesn't flicker

// Bounding box of the card unioned with its open detail overlay, so the focus
// stays put while the cursor travels out to read the score/details.
function _activeKeepRect(tile)
{
  const wrap = tile.querySelector('.game-card-wrapper');
  if (!wrap) return null;
  const r = wrap.getBoundingClientRect();
  let l = r.left, t = r.top, rr = r.right, b = r.bottom;
  const exp = tile.querySelector('.game-exp-overlay');
  if (exp)
  {
    const er = exp.getBoundingClientRect();
    if (er.width > 2 && er.height > 2 && getComputedStyle(exp).visibility !== 'hidden')
    {
      l = Math.min(l, er.left); t = Math.min(t, er.top);
      rr = Math.max(rr, er.right); b = Math.max(b, er.bottom);
    }
  }
  return { l, t, r: rr, b };
}

function _resetTileLight(tile)
{
  if (!tile) return;
  const wrapper = tile.querySelector('.game-card-wrapper');
  const inner   = tile.querySelector('.inspiration-tile-card');
  if (wrapper) wrapper.style.transform = '';
  if (inner) LIGHT_VARS.forEach(v => inner.style.removeProperty(v));
  tile.classList.remove('magnetic-active');
}

function _applyMagnetic(tile, edgeDist)
{
  const wrapper = tile.querySelector('.game-card-wrapper');
  const inner   = tile.querySelector('.inspiration-tile-card');
  if (!wrapper || !inner) return;

  const r  = wrapper.getBoundingClientRect();
  const e  = _lastMouseEvt;
  const dx = Math.max(-1.5, Math.min(1.5, (e.clientX - r.left - r.width  / 2) / (r.width  / 2)));
  const dy = Math.max(-1.5, Math.min(1.5, (e.clientY - r.top  - r.height / 2) / (r.height / 2)));

  const t = Math.max(0, Math.min(1, 1 - edgeDist / MAGNETIC.ACTIVATE_PAD));
  const k = t * t * (3 - 2 * t);                                       // smoothstep

  const scale = MAGNETIC.SCALE_MIN + (MAGNETIC.SCALE_MAX - MAGNETIC.SCALE_MIN) * k;
  const tilt  = MAGNETIC.TILT_MAX * k;
  const ry =  Math.max(-1, Math.min(1, dx)) * tilt;
  const rx = -Math.max(-1, Math.min(1, dy)) * tilt;

  wrapper.style.transform = `scale(${scale.toFixed(3)}) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
  inner.style.setProperty('--beam-x',         `${(35 - dx * 18).toFixed(1)}%`);
  inner.style.setProperty('--beam-y',         `${(30 - dy * 18).toFixed(1)}%`);
  inner.style.setProperty('--beam-angle',     `${(155 + dx * 12).toFixed(1)}deg`);
  inner.style.setProperty('--flare-x',        `${(50 + dx * 28).toFixed(1)}%`);
  inner.style.setProperty('--flare-y',        `${(40 + dy * 28).toFixed(1)}%`);
  inner.style.setProperty('--light-strength', k.toFixed(3));
  tile.classList.add('magnetic-active');
}

function _updateMagnetic()
{
  _magneticRaf = null;
  const e = _lastMouseEvt;
  if (!e || !document.body.classList.contains('inspiration-mode')) return;

  const grid = document.querySelector('.inspiration-grid');

  // Keep the active tile sticky while the cursor is over the card OR its open
  // detail/score overlay (which extends well outside the card bbox). Geometric
  // union is more reliable than hit-testing a layer that may animate/collapse.
  if (_magneticActiveTile)
  {
    const kr = _activeKeepRect(_magneticActiveTile);
    const pad = 40;
    if (kr && e.clientX >= kr.l - pad && e.clientX <= kr.r + pad &&
              e.clientY >= kr.t - pad && e.clientY <= kr.b + pad)
    {
      _loseGrace = 0;
      _applyMagnetic(_magneticActiveTile, 0);
      return;
    }
  }

  let closest = null, closestDist = Infinity, activeDist = Infinity;
  document.querySelectorAll('.inspiration-tile').forEach(tile =>
  {
    const wrapper = tile.querySelector('.game-card-wrapper');
    if (!wrapper) return;
    const r  = wrapper.getBoundingClientRect();
    const ex = Math.max(0, Math.abs(e.clientX - r.left - r.width  / 2) - r.width  / 2);
    const ey = Math.max(0, Math.abs(e.clientY - r.top  - r.height / 2) - r.height / 2);
    const d  = Math.hypot(ex, ey);
    if (d < closestDist) { closestDist = d; closest = tile; }
    if (tile === _magneticActiveTile) activeDist = d;
  });

  // Stay on the current card while still in range, unless a rival is clearly
  // closer (SWITCH_MARGIN) — stops focus ping-ponging between clustered cards.
  if (_magneticActiveTile && activeDist <= MAGNETIC.DEACTIVATE_PAD &&
      closestDist > activeDist - MAGNETIC.SWITCH_MARGIN)
  {
    _loseGrace = 0;
    _applyMagnetic(_magneticActiveTile, activeDist);
    return;
  }

  if (closest && closestDist <= MAGNETIC.ACTIVATE_PAD)
  {
    if (_magneticActiveTile && _magneticActiveTile !== closest) _resetTileLight(_magneticActiveTile);
    _magneticActiveTile = closest;
    _loseGrace = 0;
    if (grid) grid.classList.add('has-active');             // pull non-focused cards into soft background
    _applyMagnetic(closest, closestDist);
    return;
  }

  // Out of range — hold the last focused state for a few frames so a momentary
  // gap (overlay collapsing under the cursor, hit-test miss) doesn't flicker.
  if (_magneticActiveTile)
  {
    if (_loseGrace++ < LOSE_GRACE_FRAMES) { _applyMagnetic(_magneticActiveTile, 0); return; }
    _resetTileLight(_magneticActiveTile);
    _magneticActiveTile = null;
    _loseGrace = 0;
    if (grid) grid.classList.remove('has-active');
  }
}

window.addEventListener('mousemove', (e) =>
{
  if (!document.body.classList.contains('inspiration-mode')) return;
  _lastMouseEvt = e;
  if (!_magneticRaf) _magneticRaf = requestAnimationFrame(_updateMagnetic);
}, { passive: true });

document.addEventListener('mouseleave', () =>
{
  if (_magneticActiveTile) _resetTileLight(_magneticActiveTile);
  _magneticActiveTile = null;
  const grid = document.querySelector('.inspiration-grid');
  if (grid) grid.classList.remove('has-active');
});

// Re-layout the inspiration view on resize — tile positions are baked from
// viewport width at render time.
// Re-layout on resize for the views whose layout depends on viewport width:
//  - inspiration: tile scatter positions are baked from window.innerWidth
//  - pillar: flips to the phone (vertical-scroll) histogram below 760px, so it
//    must re-render when the window crosses that threshold (e.g. narrowing the
//    desktop browser to test the phone layout).
let _inspirationResizeTimer = null;
window.addEventListener('resize', () =>
{
  const needsRelayout = document.body.classList.contains('inspiration-mode')
    || (typeof viewMode !== 'undefined' && viewMode === 'pillar');
  if (!needsRelayout) return;
  clearTimeout(_inspirationResizeTimer);
  _inspirationResizeTimer = setTimeout(() =>
  {
    if (typeof applyFilters === 'function') applyFilters();
  }, 200);
});

// ==========  SORT STATE ==========
// Default to first yearSortKey (e.g. 'watched' for shows, 'played' for games)
let sortKey = (LIST_CONFIG.yearSortKeys ?? ['played'])[0];
// 'asc' or 'desc'
let sortDir = 'desc';

function sortGames(games)
{
  if (!sortKey) return games;

  const dir = (sortDir === 'asc') ? 1 : -1;
  const sortFn = LIST_CONFIG.sortFns?.[sortKey];
  if (!sortFn) return games;

  return games.slice().sort((a, b) =>
  {
    const va = sortFn(a);
    const vb = sortFn(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return  1 * dir;
    return 0;
  });
}

// ========== FILTER STATE ==========
// category: [] means all; array of strings means multiselect OR filter
let filterCategory = [];
let filterSearch = '';
// decade: null | '2000s' | '2010s' | '2020s'
let filterDecade = null;
// platform: null | 'psp' | 'ps2' | 'ps4' | 'xbox 360' | 'pc'
let filterPlatform = null;
// vibe: null | 'Cinematic' | 'Sweaty' | 'Brainy' | 'Party' | 'Cozy' | 'Flow' | 'Epic'
let filterVibe = [];
let filterTTB = null;

// Helper to apply all active filters and re-render
function applyFilters()
{
  let games = allGames.slice();

  // Search by name
  if (filterSearch)
  {
    const q = filterSearch.toLowerCase();
    games = games.filter(g => (g.name || '').toLowerCase().includes(q));
  }

  // Category ([] = all; array = OR multiselect)
  if (filterCategory.length > 0)
  {
    const categoryFn = LIST_CONFIG.filterFns?.category;
    games = categoryFn
      ? categoryFn(games, filterCategory)
      : games.filter(g => filterCategory.includes((g.category || '').toLowerCase()));
  }

  // Decade
  if (filterDecade)
  {
    const decadeField = LIST_CONFIG.decadeField || 'played_year';
    games = games.filter(g =>
    {
      const year = Number(g[decadeField]);
      if (!year) return false;
      if (filterDecade === '2000s') return year >= 2000 && year < 2010;
      if (filterDecade === '2010s') return year >= 2010 && year < 2020;
      if (filterDecade === '2020s') return year >= 2020 && year < 2030;
      return true;
    });
  }

  // Platform (or equivalent toggle filter)
  if (filterPlatform)
  {
    const platformFn = LIST_CONFIG.filterFns?.platform;
    games = platformFn
      ? platformFn(games, filterPlatform)
      : games.filter(g => (g.platform || '').toLowerCase().includes(filterPlatform.toLowerCase()));
  }

  // Vibe (Intersection / AND logic)
  if (filterVibe && filterVibe.length > 0)
  {
    games = games.filter(g => {
      if (!g.vibe) return false;
      const gameVibes = g.vibe.split(',').map(v => v.trim().toLowerCase());

      // Every selected filter MUST be present in the game's vibes
      return filterVibe.every(selected => gameVibes.includes(selected.toLowerCase()));
    });
  }

  // TTB
  if (filterTTB)
  {
    games = games.filter(g => (g.ttb || '').toLowerCase() === filterTTB.toLowerCase());
  }

  // Sort and Render based on ViewMode
  if (viewMode === 'inspiration')
  {
    // Inspiration is its own view — ignores filters, only games marked inspiration
    games = allGames.filter(g => g.inspiration === true);
    games = sortGames(games);
    renderInspirationView(games);
  }
  else if (viewMode === 'pillar')
  {
    // Allow config to pre-filter for certain axes (e.g. drop items without metacritic)
    if (LIST_CONFIG.pillarAxisFilter)
    {
      games = LIST_CONFIG.pillarAxisFilter(games, activePillarAxis);
    }
    // We don't need sorting for pillars as position is X-axis based
    updateResultCount(games.length, allGames.length);
    renderPillarView(games);
  }
  else
  {
    games = sortGames(games);
    updateResultCount(games.length, allGames.length);
    renderGamesAnimated(games);
  }
}

// Live "shown/total" readout next to the search field; ticks on change.
function updateResultCount(shown, total)
{
  const el = document.getElementById('result-count');
  if (!el) return;
  const text = `${shown}/${total}`;
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('tick');
  void el.offsetWidth;            // restart the pop animation
  el.classList.add('tick');
}

function setActiveInGroup(buttons, activeBtn)
{
  buttons.forEach(b =>
  {
    if (b === activeBtn) b.classList.add('active');
    else b.classList.remove('active');
  });
}



// ========== TAB HANDLERS ==========
// One category + one decade + one platform at a time,
// but groups combine with each other.
function setupTabs()
{
  const allButtons = document.querySelectorAll('.tab-buttons .secret-btn');

  const categoryButtons = Array.from(allButtons)
    .filter(b => b.dataset.group === 'category');
  const decadeButtons = Array.from(allButtons)
    .filter(b => b.dataset.group === 'decade');
  const platformButtons = Array.from(allButtons)
    .filter(b => b.dataset.group === 'platform');
  const sortButtons = Array.from(allButtons)
    .filter(b => b.dataset.group === 'sort');
  const vibeButtons = Array.from(allButtons)
    .filter(b => b.dataset.group === 'vibe');
  const ttbButtons = Array.from(allButtons)
    .filter(b => b.dataset.group === 'ttb');

  allButtons.forEach(btn =>
  {
    btn.addEventListener('click', (e) =>
    {
      e.preventDefault();

      const group = btn.dataset.group;
      const value = btn.dataset.value;

      if (group === 'category')
      {
        if (value === 'all')
        {
          filterCategory = [];
        }
        else
        {
          // Single-select: replaces any previous selection (narrows from ALL)
          filterCategory = [value];
        }
        setActiveInGroup(categoryButtons, btn);
      }
      else if (group === 'decade')
      {
        // toggle decade: click again to clear
        if (filterDecade === value)
        {
          filterDecade = null;
          decadeButtons.forEach(b => b.classList.remove('active'));
        }
        else
        {
          filterDecade = value;
          setActiveInGroup(decadeButtons, btn);
        }
      }
      else if (group === 'platform')
      {
        // toggle platform: click again to clear
        if (filterPlatform === value)
        {
          filterPlatform = null;
          platformButtons.forEach(b => b.classList.remove('active'));
        }
        else
        {
          filterPlatform = value;
          setActiveInGroup(platformButtons, btn);
        }
      }
      else if (group === 'vibe')
      {
        // Toggle value in the array
        const index = filterVibe.indexOf(value);
        if (index > -1) {
          filterVibe.splice(index, 1);
          btn.classList.remove('active');
        } else {
          filterVibe.push(value);
          btn.classList.add('active');
        }
      }
      else if (group === 'ttb')
      {
        if (filterTTB === value) {
          filterTTB = null;
          ttbButtons.forEach(b => b.classList.remove('active'));
        } else {
          filterTTB = value;
          setActiveInGroup(ttbButtons, btn);
        }
      }
      else if (group === 'sort')
      {
        if (sortKey === value)
        {
          // same button → toggle direction
          sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
        }
        else
        {
          sortKey = value;

          // sensible defaults
          if (value === 'name') sortDir = 'asc';
          else sortDir = 'desc';
        }

        setActiveInGroup(sortButtons, btn);
      }
      else if (group === 'pillarAxis')
      {
        activePillarAxis = value;
        setActiveInGroup(document.querySelectorAll('[data-group="pillarAxis"]'), btn);
        applyFilters();
      }

      applyFilters();
    });
  });

  // Mark ALL as active by default (filterCategory starts empty = show all)
  categoryButtons.find(b => b.dataset.value === 'all')?.classList.add('active');

  // Mark default sort button as active
  const defaultSortBtn = sortButtons.find(b => b.dataset.value === sortKey);
  if (defaultSortBtn) defaultSortBtn.classList.add('active');

  // Search input — debounced so fast typing doesn't re-render the whole list
  // on every keystroke (300+ cards per render).
  const searchInput = document.getElementById('search-input');
  if (searchInput)
  {
    let searchDebounce = null;
    searchInput.addEventListener('input', e =>
    {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() =>
      {
        filterSearch = e.target.value.trim();
        applyFilters();
      }, 180);
    });
  }

  // View Mode Toggles
  const viewButtons = document.querySelectorAll('.view-btn');
  viewButtons.forEach(btn =>
  {
    btn.addEventListener('click', () =>
    {
      if (btn.classList.contains('active')) return;
        viewButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        viewMode = btn.dataset.view;

        //Sync state to body for CSS visibility logic
        if (viewMode === 'pillar')
        {
            document.body.classList.add('pillar-view-active');
            gameContainer.classList.add('pillar-view');
        }
        else
        {
            document.body.classList.remove('pillar-view-active');
            gameContainer.classList.remove('pillar-view');
            gameContainer.style.height = '';
        }

        document.body.classList.toggle('inspiration-mode', viewMode === 'inspiration');
        ensureInspirationBg(viewMode === 'inspiration');

        // Crossfade the list container so view changes feel deliberate
        // (opacity only — transforms would break position:fixed descendants
        // like the pillar inspect panel).
        gameContainer.classList.remove('view-switching');
        void gameContainer.offsetWidth;
        gameContainer.classList.add('view-switching');

        applyFilters();
    });
  });
}

// ---------- VARIATION 1 ---
function updatePillarInspect(game, isHovering, mouseX = 0)
{
  const panel = document.getElementById('pillar-inspect-panel');
  if (!panel) return;

  if (!isHovering)
  {
    panel.classList.add('inspect-hidden');
    // Clear content after fade out to prevent flickering
    setTimeout(() => {
        if(panel.classList.contains('inspect-hidden')) panel.innerHTML = '';

    }, 200);
    return;
  }

  // --- SMART POSITIONING LOGIC ---
  const screenMid = window.innerWidth / 2;

  if (mouseX > screenMid) {
      // Mouse is on RIGHT side -> Show Panel on LEFT
      panel.style.left = '30px';
      panel.style.right = 'auto';
      // Standard Layout: Image Left, Details Right
      panel.classList.remove('dock-right');
  } else {
      // Mouse is on LEFT side -> Show Panel on RIGHT
      panel.style.left = 'auto';
      panel.style.right = '30px';
      // Flipped Layout: Details Left, Image Right
      panel.classList.add('dock-right');
  }

  panel.innerHTML = '';
  // Create a fresh card for the preview
  const previewCard = createGameCard(game);

  // Remove animation classes so it doesn't "drop" inside the HUD
  previewCard.classList.remove('is-entering', 'is-moving');
  // Force overlays to be visible in the preview via your CSS
  previewCard.classList.add('force-preview-show');

  panel.appendChild(previewCard);
  panel.classList.remove('inspect-hidden');
}

// ========== HELPER: SHORTEN NAMES ==========
function shortenPlatformName(platformName) {
  if (!platformName) return "Unknown";

  // 1. Handle PlayStation (Global replacement for PS 2/3/4/5)
  let shortName = platformName.replace(/PlayStation/gi, "PS");

  // 2. Handle Xbox Specifics
  const lower = shortName.toLowerCase();
  if (lower.includes("xbox series x")) return "Xbox SX";
  if (lower.includes("xbox series s")) return "Xbox SS";
  if (lower.includes("xbox one"))      return "Xbox One";
  if (lower.includes("xbox 360"))      return "Xbox 360";

  if (lower.includes("sony ericsson"))  return "Old Mobile";

  // 3. Handle Nintendo (Optional cleanup)
  if (lower.includes("nintendo switch")) return "Switch";

  return shortName.trim();
}

// Global variable to track state between renders
let lastRenderedAxis = null;

function renderPillarView(games)
{
  currentRenderId++;
  const thisRenderId = currentRenderId;
  const container = gameContainer;
  container.classList.add('pillar-view');

  // ============================================================
  // 1. CLEANUP PHASE
  // ============================================================
  container.querySelector('.inspiration-grid')?.remove();   // drop floating cloud tiles when leaving inspiration
  const tierArtifacts = container.querySelectorAll('.tier-section, .art-divider');
  if (tierArtifacts.length > 0) {
    const allNestedCards = container.querySelectorAll('.game-card-wrapper');
    allNestedCards.forEach(card => card.remove());
    tierArtifacts.forEach(el => el.remove());
    lastRenderedAxis = null;
  }

  if (activePillarAxis !== lastRenderedAxis) {
    lastRenderedAxis = activePillarAxis;
  }

  let hud = document.getElementById('pillar-inspect-panel');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'pillar-inspect-panel';
    hud.classList.add('inspect-hidden');
    container.appendChild(hud);
  }

  // ============================================================
  // 2. CALCULATION PHASE
  // ============================================================
  const getVal = (g) => {
    const fn = LIST_CONFIG.axisValueFns?.[activePillarAxis];
    return fn ? fn(g) : 0;
  };

  const uniqueVals = [...new Set(games.map(getVal))];
  const presentValues = uniqueVals.sort((a, b) => {
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    return a - b;
  });

  const colCount = presentValues.length;

  // --- DYNAMIC SPACING & CENTERING LOGIC ---
  const MAX_GAP = 18;       // Max distance (%) between columns. Lower = tighter packing.
  const AVAILABLE_WIDTH = 94; // Use 94% of screen (leaves 3% padding on sides)

  let spacing = 0;
  let startX = 50; // Default to center

  if (colCount > 1) {
    // 1. Calculate the spacing required to fill the screen
    const spreadSpacing = AVAILABLE_WIDTH / (colCount - 1);

    // 2. Clamp it. If we have few items, don't stretch > MAX_GAP.
    //    If we have many items, 'spreadSpacing' will be small, so use that.
    spacing = Math.min(spreadSpacing, MAX_GAP);

    // 3. Calculate total width of our cluster and find the starting offset to center it
    const totalGroupWidth = spacing * (colCount - 1);
    startX = 50 - (totalGroupWidth / 2);
  }
  // -----------------------------------------

  // Dimensions
  const cardWidth = 30;
  const yOffset = 45;
  const valCounts = {};
  presentValues.forEach(v => { valCounts[v] = games.filter(g => getVal(g) === v).length; });
  const maxStack = Math.max(...presentValues.map(v => valCounts[v]));

  // On phones the axes flip: values run top→bottom (vertical scroll) and each
  // stack grows left→right, so the dense value-axis labels never overlap.
  const phone = window.innerWidth < 760;
  const P_LABEL = 44, P_GAP = 16, P_CARDW = 34, P_TOP = 14;
  const P_CARDH = Math.round(P_CARDW * 1.5);
  const P_ROWH  = P_CARDH + P_GAP;
  const P_AVAIL = window.innerWidth - P_LABEL - 12;  // usable width for a row of cards
  // Per-row horizontal step: cards sit border-to-border (step == card width) and
  // ONLY a row that would overflow the screen gets compressed to fit. This stops
  // the densest row from forcing every other row to overlap needlessly.
  const phoneStep = (count) => Math.min(P_CARDW, P_AVAIL / Math.max(1, count));

  if (phone) {
    container.classList.add('pillar-phone');
    container.style.height = (P_TOP + colCount * P_ROWH + 40) + 'px';
  } else {
    container.classList.remove('pillar-phone');
    container.style.height = `${(maxStack * yOffset) + 150}px`;
  }

  // Animation Timers
  const colStartTimes = new Map();
  presentValues.forEach(val => {
      colStartTimes.set(val, Math.random() * 0.6);
  });

  // Snapshot
  const existingCards = new Map();
  container.querySelectorAll('.game-card-wrapper').forEach(el => {
    if(el.dataset.key) existingCards.set(el.dataset.key, el);
  });

  const stacks = {};
  const newKeys = new Set();

  // ============================================================
  // 3. RENDER LOOP
  // ============================================================
  games.forEach(game => {
    const key = LIST_CONFIG.getKey(game);
    if (thisRenderId !== currentRenderId) return;
    newKeys.add(key);

    const val = getVal(game);
    if (!stacks[val]) stacks[val] = 0;

    const valIndex = presentValues.indexOf(val);

    // ▼ USE DYNAMIC POSITION ▼
    const xPos = startX + (valIndex * spacing);

    const yPos = stacks[val] * yOffset;
    const depth = 1000 + (valIndex * 100) + stacks[val];

    let card = existingCards.get(key);
    let isNew = false;
    let isRevived = false;

    if (!card) {
      isNew = true;
      card = createGameCard(game);
      card.classList.add('pillar-mini-card');
      card.addEventListener('mouseenter', (e) => updatePillarInspect(game, true, e.clientX));
      card.addEventListener('mouseleave', () => updatePillarInspect(game, false));
      container.appendChild(card);
    }
    else {
      if (card._removeTimer) {
         clearTimeout(card._removeTimer);
         card._removeTimer = null;
      }
      if (card.classList.contains('pillar-dissolve')) {
        isRevived = true;
        card.classList.remove('pillar-dissolve');
      }
    }

    card.style.position = 'absolute';
    if (phone) {
      card.style.left = `${P_LABEL + stacks[val] * phoneStep(valCounts[val])}px`;
      card.style.top = `${P_TOP + valIndex * P_ROWH}px`;
      card.style.bottom = 'auto';
      card.style.width = `${P_CARDW}px`;
      card.style.zIndex = 1000 + (valIndex * 100) + stacks[val];
      card.style.transform = 'translateZ(0)';
    } else {
      card.style.left = `${xPos}%`;
      card.style.bottom = `${yPos + 40}px`;
      card.style.top = 'auto';
      card.style.width = `${cardWidth}px`;
      card.style.zIndex = depth;
      card.style.transform = 'translateX(-50%) translateZ(0)';
    }

    if (isNew || isRevived) {
      card.classList.remove('pillar-animate-in');
      card.style.animationDelay = '0s';
      card.style.opacity = '1';
      void card.offsetWidth;
      card.classList.add('pillar-animate-in');
      const baseDelay = colStartTimes.get(val) || 0;
      const floorDelay = stacks[val] * 0.05;
      card.style.animationDelay = `${baseDelay + floorDelay}s`;
    } else {
      card.classList.remove('pillar-animate-in');
      card.style.animationDelay = '0s';
      card.classList.remove('pillar-dissolve');
      card.style.opacity = '1';
    }

    stacks[val]++;
  });

  // ============================================================
  // 4. REMOVAL PHASE
  // ============================================================
  existingCards.forEach((el, key) => {
    if (!newKeys.has(key)) {
      if (thisRenderId !== currentRenderId) return;
      if (el._removeTimer) clearTimeout(el._removeTimer);
      if (el.classList.contains('pillar-dissolve')) return;

      el.classList.add('pillar-dissolve');
      el._removeTimer = setTimeout(() => {
        if (el.parentNode) el.remove();
        if (thisRenderId !== currentRenderId) return;
        el._removeTimer = null;
      }, 350);
    }
  });

  // ============================================================
  // 5. RULER UPDATE (With Smart Text Alignment)
  // ============================================================
  const oldRulers = container.querySelectorAll('.pillar-ruler');
  oldRulers.forEach(r => r.remove());

  const ruler = document.createElement('div');
  ruler.className = 'pillar-ruler';

  presentValues.forEach((tick, i) => {
    const marker = document.createElement('span');
    marker.textContent = tick;
    marker.style.position = 'absolute';

    if (phone) {
      // Vertical ruler down the left: one label per value row, centred on it.
      marker.style.left = '4px';
      marker.style.top = `${P_TOP + (i * P_ROWH) + (P_CARDH / 2)}px`;
      marker.style.transform = 'translateY(-50%)';
      marker.style.textAlign = 'left';
      ruler.appendChild(marker);
      return;
    }

    // Use the same dynamic position as the cards
    const xPos = startX + (i * spacing);
    marker.style.left = `${xPos}%`;

    // ▼ SMART ALIGNMENT ▼
    // If the label is extremely close to the left edge (<10%), anchor it left.
    // If it's extremely close to the right edge (>90%), anchor it right.
    // Otherwise, center it.
    if (xPos < 10) {
        marker.style.transform = 'translateX(-15%)'; // Slight shift to keep first letter visible
        marker.style.textAlign = 'left';
    } else if (xPos > 90) {
        marker.style.transform = 'translateX(-85%)'; // Pull back to keep last letter visible
        marker.style.textAlign = 'right';
    } else {
        marker.style.transform = 'translateX(-50%)';
        marker.style.textAlign = 'center';
    }

    ruler.appendChild(marker);
  });
  container.appendChild(ruler);

  // ============================================================
  // 6. AUTO-SCROLL
  // ============================================================
  if (!phone) setTimeout(() => {
    const scrollTarget = container.offsetTop + container.offsetHeight;
    if (thisRenderId !== currentRenderId) return;
    if ((window.innerHeight + window.scrollY) < scrollTarget - 100) {
        window.scrollTo({
            top: scrollTarget,
            behavior: 'smooth'
        });
    }
  }, 100);
}

// ========== APP-FEEL POLISH ==========
// Injected UI + shortcuts shared by all lists: results counter, scroll-to-top,
// and keyboard navigation. No HTML edits needed — everything is created here.
function setupAppPolish()
{
  // --- results counter (sits right after the search field) ---
  const searchInput = document.getElementById('search-input');
  if (searchInput && !document.getElementById('result-count'))
  {
    const counter = document.createElement('span');
    counter.id = 'result-count';
    counter.setAttribute('aria-live', 'polite');
    searchInput.insertAdjacentElement('afterend', counter);
  }

  // --- scroll-to-top button (appears after scrolling down) ---
  const topBtn = document.createElement('button');
  topBtn.className = 'scroll-top-btn';
  topBtn.type = 'button';
  topBtn.setAttribute('aria-label', 'Scroll to top');
  topBtn.textContent = '▲';
  topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.appendChild(topBtn);
  window.addEventListener('scroll', () =>
  {
    topBtn.classList.toggle('visible', window.scrollY > 600);
  }, { passive: true });

  // --- keyboard shortcuts ---
  //   /        focus search
  //   Escape   clear search and blur
  //   1/2/3    switch view (tierlist / histogram / inspiration)
  document.addEventListener('keydown', (e) =>
  {
    const typing = e.target.matches('input, textarea');

    if (e.key === '/' && !typing)
    {
      e.preventDefault();
      searchInput?.focus();
    }
    else if (e.key === 'Escape' && typing && e.target === searchInput)
    {
      searchInput.value = '';
      filterSearch = '';
      applyFilters();
      searchInput.blur();
    }
    else if (!typing && ['1', '2', '3'].includes(e.key))
    {
      const btns = document.querySelectorAll('.view-btn');
      btns[Number(e.key) - 1]?.click();
    }
  });
}

// ========== INIT ==========
async function init()
{
    setupAppPolish();
    console.log(LIST_CONFIG.data);
    try
    {
      const enriched = await enrichGames(LIST_CONFIG.data);
      allGames = enriched;
      console.log('Enriched items:', allGames);

      setupTabs();
      applyFilters(); // initial render with default sort applied
    }
    catch (e)
    {
      console.error('Failed to load games.json', e);
    }
    finally
    {
      // Reveal the AV monogram once content is ready (always runs, even if
      // enrichment failed, so the mark never stays stuck hidden).
      document.body.classList.add('content-ready');
    }

    window.addEventListener('resize', () =>
    {
      setupOverlaySides();
    });
}

init();