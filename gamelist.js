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
  // stable unique-ish key (prefer IDs, fallback to name)
  return `${g.igdb_id || 'x'}_${g.rawg_id || 'y'}_${(g.name || '').toLowerCase()}`;
}

async function enrichGames(games)
{
  const BACK_API = "https://bzfclyzne3.execute-api.us-east-2.amazonaws.com/default/gameTierListProvider"
  try
  {
    showLoader(); // start countdown while we wait

    const idPairs = games.map(g => [g.igdb_id, g.rawg_id || null]);

    const response = await fetch(BACK_API,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ games: idPairs })
    });

    const enrichedCovers = await response.json();
    if (!enrichedCovers.ok || !Array.isArray(enrichedCovers.data))
    {
      throw new Error("Bad data from Lambda");
    }

    const coverMap = enrichedCovers.data.reduce((acc, enriched) =>
    {
      const key = `${enriched.igdb_id}_${enriched.rawg_id}`;
      acc[key] = enriched;
      return acc;
    }, {});

    return games.map(game =>
    {
        const safeRawgId = (game.rawg_id === undefined || game.rawg_id === "")
                            ? "null"
                            : game.rawg_id;

        const key = `${game.igdb_id}_${safeRawgId}`;
        const enriched = coverMap[key] || {};
        return {
          ...game,
          ...enriched,
          image: enriched.image || 'img/placeholder.png'
        };
    });

  }
  catch (e)
  {
    console.error("Failed to enrich via Lambda:", e);
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
  const hasWebsite = game.website && game.website.trim();
  const hasRawg   = game.rawg_id;
  const titleUrl = hasWebsite
    ? game.website
    : (hasRawg ? `https://rawg.io/games/${game.rawg_id}` : null);

  if (titleUrl)
  {
    titleOverlay.innerHTML =
      `<a href="${titleUrl}" target="_blank">${game.name}</a>`;
  }
  else
  {
    // fallback: just text, not a link
    titleOverlay.textContent = game.name;
  }

  const card = document.createElement('div');
  card.className = 'game-card';

  const img = document.createElement('img');
  img.src = game.image || 'img/placeholder.png';
  img.alt = game.name;
  card.appendChild(img);

  const commentHtml = (game.comment || '').replace(/\n/g, '<br>');

  const infoOverlay = document.createElement('div');
  infoOverlay.className = 'game-details-overlay';
  infoOverlay.innerHTML = `
    <p>Developer:</p>
    <p><span>${game.developer || 'N/A'}<span></p>
    <p>Released:</p>
    <p><span>${game.release_date?.split('-')[0] || 'N/A'}<span></p>
    ${game.metacritic ? `<p>Metacritic: <span>${game.metacritic}<span></p>` : ''}
    ${game.website ? `<p><a href="${game.website}" target="_blank" style="color: inherit; text-decoration: none;">Website</a><p>` : ''}
    ${game.developer ? `<p><a href="https://rawg.io/games/${game.rawg_id}" target="_blank" style="color: inherit; text-decoration: none;">RAWG</a><p>` : ''}
  `;

  const expOverlay = document.createElement('div');
  expOverlay.className = 'game-exp-overlay';
  expOverlay.innerHTML = `
    <p>Platform: <span>${game.platform}<span></p>
    <p>Played: <span>${game.played_year}<span></p>
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
if (sortKey === 'played' || sortKey === 'released')
  {
    const maxPerRow = calcMaxCardsPerRow();

    // helper to get the "year" string for a game based on current sort
    const getYear = (game) =>
    {
      if (sortKey === 'played')
      {
        return game.played_year || 'N/A';
      }
      return game.release_date
        ? game.release_date.split('-')[0]
        : 'N/A';
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
  const maxOverlayWidth = window.innerWidth * 0.32; // 32vw = your max-width

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

// ==========  SORT STATE ==========
// sort: null | 'played' | 'released' | 'score' | 'name'
let sortKey = null;
// 'asc' or 'desc'
let sortDir = 'desc';

function sortGames(games)
{
  if (!sortKey) return games;

  const dir = (sortDir === 'asc') ? 1 : -1;

  return games.slice().sort((a, b) =>
  {
    let va, vb;

    switch (sortKey)
    {
      case 'played':
        va = Number(a.played_year) || 0;
        vb = Number(b.played_year) || 0;
        break;

      case 'released':
        va = a.release_date ? Number(a.release_date.split('-')[0]) : 0;
        vb = b.release_date ? Number(b.release_date.split('-')[0]) : 0;
        break;

      case 'score':
        va = Number(a.score) || 0;
        vb = Number(b.score) || 0;
        break;

      case 'name':
        va = (a.name || '').toLowerCase();
        vb = (b.name || '').toLowerCase();
        break;

      default:
        return 0;
    }

    if (va < vb) return -1 * dir;
    if (va > vb) return  1 * dir;
    return 0;
  });
}

// ========== FILTER STATE ==========
// category: 'all' | 'indie' | 'ubisoft'
let filterCategory = 'all';
// decade: null | '2000s' | '2010s' | '2020s'
let filterDecade = null;
// platform: null | 'psp' | 'ps2' | 'ps4' | 'xbox 360' | 'pc'
let filterPlatform = null;
const MAIN_PLATFORMS_FILTER = [
  'pc',
  'psp',
  'playstation 2',
  'xbox 360',
  'playstation 4'
];
// vibe: null | 'Cinematic' | 'Sweaty' | 'Brainy' | 'Party' | 'Cozy' | 'Flow' | 'Epic'
let filterVibe = [];
let filterTTB = null;

// Helper to apply all active filters and re-render
function applyFilters()
{
  let games = allGames.slice();

  // Category
  if (filterCategory === 'indie')
  {
    games = games.filter(g =>
      (g.category || '').toLowerCase() === 'indie'
    );
  }
  else if (filterCategory === 'ubisoft')
  {
    games = games.filter(g =>
      (g.developer || '').toLowerCase().includes('ubisoft')
    );
  }
  else if (filterCategory === 'meta80')
  {
    games = games.filter(g => Number(g.metacritic) >= 80);
  }

  // Decade
  if (filterDecade)
  {
    games = games.filter(g =>
    {
      const year = Number(g.played_year);
      if (!year) return false;

      if (filterDecade === '2000s') return year >= 2000 && year < 2010;
      if (filterDecade === '2010s') return year >= 2010 && year < 2020;
      if (filterDecade === '2020s') return year >= 2020 && year < 2030;
      return true;
    });
  }

  // Platform
  if (filterPlatform)
  {
    if (filterPlatform === 'all-other')
    {
      games = games.filter(g =>
      {
        const p = (g.platform || '').toLowerCase();
        // Keep game ONLY if it does NOT match any of the main platforms
        return !MAIN_PLATFORMS_FILTER.some(main => p.includes(main));
      });
   }
   else
   {
     const target = filterPlatform.toLowerCase();
     games = games.filter(g =>
       (g.platform || '').toLowerCase().includes(target)
     );
   }
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
  if (viewMode === 'pillar')
  {
    // If axis is Metacritic, filter out games without a metascore
    if (activePillarAxis === 'metacritic')
      {
      games = games.filter(g => g.metacritic && !isNaN(g.metacritic));
    }
    // We don't need sorting for pillars as position is X-axis based
    renderPillarView(games);
  }
  else
  {
    games = sortGames(games);
    renderGamesAnimated(games);
  }
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
        // always exactly one category
        filterCategory = value;
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

  // Mark ALL GAMES as active by default
  categoryButtons.forEach(b =>
  {
    if (b.dataset.value === 'all')
    {
      b.classList.add('active');
    }
  });

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
            document.body.classList.add('pillar-view-active'); // For CSS
            gameContainer.classList.add('pillar-view');
        }
        else
        {
            document.body.classList.remove('pillar-view-active');
            gameContainer.classList.remove('pillar-view');
            gameContainer.style.height = '';
        }

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
    if (activePillarAxis === 'score') return g.score || 0;
    if (activePillarAxis === 'played') return g.played_year || 0;
    if (activePillarAxis === 'released') return g.release_date ? g.release_date.split('-')[0] : 0;
    if (activePillarAxis === 'metacritic') return Number(g.metacritic);
    if (activePillarAxis === 'platform')
    {
        const raw = g.platform || "Unknown";
        // Get the first platform if multiple (e.g., "PS5 / PC")
        const primary = raw.split('/')[0].trim();
        // Run it through the shortener
        return shortenPlatformName(primary);
    }
    return 0;
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
  const maxStack = Math.max(...presentValues.map(v => games.filter(g => getVal(g) === v).length));
  const actualChartHeight = (maxStack * yOffset) + 150;
  container.style.height = `${actualChartHeight}px`;

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
    const key = gameKey(game);
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

    card.style.left = `${xPos}%`;
    card.style.bottom = `${yPos + 40}px`;
    card.style.position = 'absolute';
    card.style.width = `${cardWidth}px`;
    card.style.zIndex = depth;
    card.style.transform = 'translateX(-50%) translateZ(0)';

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
  setTimeout(() => {
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

// ========== INIT ==========
async function init()
{
    console.log(gameMasterList);
    try
    {
      const enriched = await enrichGames(gameMasterList);
      allGames = enriched;
      console.log('Enriched games:', allGames);

    //renderGames(allGames); // default to all
    renderGamesAnimated(allGames);

      setupTabs();
    }
    catch (e)
    {
      console.error('Failed to load games.json', e);
    }

    window.addEventListener('resize', () =>
    {
      setupOverlaySides();
    });
}

init();