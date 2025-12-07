// ========== DOM ELEMENTS ==========
const gameContainer = document.getElementById('main-list');

// ========== TIER ORDER ==========
const TIER_ORDER = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E'];

// ========== LOAD AND PROCESS GAMES ==========
let allGames = [];

async function enrichGames(games)
{
  const BACK_API = "https://bzfclyzne3.execute-api.us-east-2.amazonaws.com/default/gameTierListProvider"
  try
  {
    const idPairs = games.map(g => [g.igdb_id, g.rawg_id]);

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
        const key = `${game.igdb_id}_${game.rawg_id}`;
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
}


function createGameCard(game)
{
  const wrapper = document.createElement('div');
  wrapper.className = 'game-card-wrapper';

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
    <p class="game-comment">"${commentHtml}"</p>
  `;

  // Append everything directly to wrapper
  wrapper.appendChild(titleOverlay);
  wrapper.appendChild(card);
  wrapper.appendChild(infoOverlay);
  wrapper.appendChild(expOverlay);

  wrapper.addEventListener('mouseenter', () =>
  {
    const rect = wrapper.getBoundingClientRect();
    const maxOverlayWidth = window.innerWidth * 0.32; // 32vw = your max-width
    const spaceRight = window.innerWidth - rect.right;

    if (spaceRight < maxOverlayWidth) {
      // Not enough space on the right -> open to the left
      expOverlay.classList.add('open-left');
    } else {
      // Plenty of space -> keep opening to the right
      expOverlay.classList.remove('open-left');
    }
  });

  wrapper.addEventListener('mouseleave', () =>
  {
    expOverlay.classList.remove('open-left');
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

    games.forEach(game =>
    {
        const card = createGameCard(game);
        row.appendChild(card);
    });

    tierRowWrapper.appendChild(row);
    section.appendChild(tierRowWrapper);

    const divider = document.createElement('div');
    divider.className = 'art-divider';

    return [section, divider];
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

// ========== FILTER STATE ==========
// category: 'all' | 'indie' | 'ubisoft'
let filterCategory = 'all';
// decade: null | '2000s' | '2010s' | '2020s'
let filterDecade = null;
// platform: null | 'psp' | 'ps2' | 'ps4' | 'xbox 360' | 'pc'
let filterPlatform = null;

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

  if (filterCategory === 'indie')
  {
    games = games.filter(g =>
      (g.category || '').toLowerCase() === 'indie'
    );
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
    const target = filterPlatform.toLowerCase();
    games = games.filter(g =>
      (g.platform || '').toLowerCase() === target
    );
  }

  renderGames(games);
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

      renderGames(allGames); // default to all
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