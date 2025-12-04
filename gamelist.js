// ========== DOM ELEMENTS ==========
const allTabBtn = document.getElementById('allTab');
const indieTabBtn = document.getElementById('indieTab');
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
  titleOverlay.innerHTML = `<a href="${game.website}" target="_blank" style="color: inherit; text-decoration: none;">${game.name}</a>`;

  const card = document.createElement('div');
  card.className = 'game-card';

  const img = document.createElement('img');
  img.src = game.image || 'img/placeholder.png';
  img.alt = game.name;
  card.appendChild(img);

  const infoOverlay = document.createElement('div');
  infoOverlay.className = 'game-details-overlay';
  infoOverlay.innerHTML = `
    <p>Developer:</p>
    <p><span>${game.developer || 'N/A'}<span></p>
    <p>Released:</p>
    <p><span>${game.release_date?.split('-')[0] || 'N/A'}<span></p>
    ${game.metacritic ? `<p>Metacritic: <span>${game.metacritic}<span></p>` : ''}
    ${game.dev_team_size ? `<p>Dev Team Size: <span>${game.dev_team_size}<span></p>` : ''}
    ${game.website ? `<span><a href="${game.website}" target="_blank" style="color: inherit; text-decoration: none;">Website</a><span>` : ''}
    ${game.developer ? `<span><a href="https://rawg.io/games/${game.rawg_id}" target="_blank" style="color: inherit; text-decoration: none;">RAWG</a><span>` : ''}
  `;

  const expOverlay = document.createElement('div');
  expOverlay.className = 'game-exp-overlay';
  expOverlay.innerHTML = `
    <p>Platform: <span>${game.platform}<span></p>
    <p>Played: <span>${game.played_year}<span></p>
    <p>Score: <span>${game.score || '?'}<span></p>
    <p class="game-comment">"${game.comment}"</p>
  `;

  // Append everything directly to wrapper
  wrapper.appendChild(titleOverlay);
  wrapper.appendChild(card);
  wrapper.appendChild(infoOverlay);
  wrapper.appendChild(expOverlay);

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
}

// ========== TAB HANDLERS ==========
function setupTabs() {
  allTabBtn.addEventListener('click', (e) =>
    {
    e.preventDefault();
    renderGames(allGames);
  });
  indieTabBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const filtered = allGames.filter(g => g.category.toLowerCase() === 'indie');
    renderGames(filtered);
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
    } catch (e)
    {
    console.error('Failed to load games.json', e);
    }
}

init();