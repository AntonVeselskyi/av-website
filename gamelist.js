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
  titleOverlay.innerHTML = `<a href="${game.website}" target="_blank">${game.name}</a>`;

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

// ========== TAB FILTERS ==========
const FILTERS =
{
  // show everything
  allTab: games => games,

  // existing indie filter
  indieTab: games =>
    games.filter(g => (g.category || '').toLowerCase() === 'indie'),

  // 200x: 2000–2009
  y200xTab: games =>
    games.filter(g =>
    {
      const year = Number(g.played_year);
      return year >= 2000 && year < 2010;
    }),

  // 201x: 2010–2019
  y201xTab: games =>
    games.filter(g => {
      const year = Number(g.played_year);
      return year >= 2010 && year < 2020;
    }),

  // 202x: 2020–2029
  y202xTab: games =>
    games.filter(g =>
    {
      const year = Number(g.played_year);
      return year >= 2020 && year < 2030;
    }),

  // PSP filter (adjust string if needed to match your data exactly)
  pspTab: games =>
    games.filter(g => (g.platform || '').toLowerCase() === 'psp'),

  // Xbox 360 filter
  xbox360Tab: games =>
    games.filter(g => (g.platform || '').toLowerCase() === 'xbox 360'),
};

// ========== TAB HANDLERS ==========
function setupTabs()
{
  const tabButtons = document.querySelectorAll('.tab-buttons .secret-btn');

  tabButtons.forEach(btn =>
  {
    const id = btn.id;
    const filterFn = FILTERS[id] || (games => games);

    btn.addEventListener('click', (e) => {
      e.preventDefault();

      // clear active from all
      tabButtons.forEach(b => b.classList.remove('active'));
      // mark this as active
      btn.classList.add('active');

      const filtered = filterFn(allGames);
      renderGames(filtered);
    });
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

      // make ALL GAMES tab visually active on load
      const allTabBtn = document.getElementById('allTab');
      if (allTabBtn)
      {
        allTabBtn.classList.add('active');
      }
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