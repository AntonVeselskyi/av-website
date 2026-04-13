// ========== GAME LIST CONFIG ==========
// Loaded between games.js and core.js in gamelist.html.
// Provides all game-specific logic so core.js stays generic.

const MAIN_PLATFORMS_FILTER = [
  'pc',
  'psp',
  'playstation 2',
  'xbox 360',
  'playstation 4'
];

window.LIST_CONFIG = {

  data: gameMasterList,

  getKey: (g) =>
    `${g.igdb_id || 'x'}_${g.rawg_id || 'y'}_${(g.name || '').toLowerCase()}`,

  getLink: (g) =>
    (g.website && g.website.trim())
      ? g.website
      : (g.rawg_id ? `https://rawg.io/games/${g.rawg_id}` : null),

  async enrichItems(games) {
    const BACK_API = "https://bzfclyzne3.execute-api.us-east-2.amazonaws.com/default/gameTierListProvider";

    const idPairs = games.map(g => [g.igdb_id, g.rawg_id || null]);

    const response = await fetch(BACK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ games: idPairs })
    });

    const enrichedCovers = await response.json();
    if (!enrichedCovers.ok || !Array.isArray(enrichedCovers.data))
      throw new Error("Bad data from Lambda");

    const coverMap = enrichedCovers.data.reduce((acc, enriched) => {
      const key = `${enriched.igdb_id}_${enriched.rawg_id}`;
      acc[key] = enriched;
      return acc;
    }, {});

    return games.map(game => {
      const safeRawgId = (game.rawg_id === undefined || game.rawg_id === "") ? "null" : game.rawg_id;
      const key = `${game.igdb_id}_${safeRawgId}`;
      const enriched = coverMap[key] || {};
      return { ...game, ...enriched, image: enriched.image || 'img/placeholder.png' };
    });
  },

  getDetailsHtml: (g) => `
    <p>Developer:</p>
    <p><span>${g.developer || 'N/A'}<span></p>
    <p>Released:</p>
    <p><span>${g.release_date?.split('-')[0] || 'N/A'}<span></p>
    ${g.metacritic ? `<p>Metacritic: <span>${g.metacritic}<span></p>` : ''}
    ${g.website ? `<p><a href="${g.website}" target="_blank" style="color:inherit;text-decoration:none;">Website</a><p>` : ''}
    ${g.developer ? `<p><a href="https://rawg.io/games/${g.rawg_id}" target="_blank" style="color:inherit;text-decoration:none;">RAWG</a><p>` : ''}
  `,

  getExpHtml: (g) => `
    <p>Platform: <span>${g.platform}<span></p>
    <p>Played: <span>${g.played_year}<span></p>
  `,

  decadeField: 'played_year',

  sortFns: {
    played:   g => Number(g.played_year) || 0,
    released: g => g.release_date ? Number(g.release_date.split('-')[0]) : 0,
    score:    g => Number(g.score) || 0,
    name:     g => (g.name || '').toLowerCase(),
  },

  axisValueFns: {
    score:      g => g.score || 0,
    played:     g => g.played_year || 0,
    released:   g => g.release_date ? g.release_date.split('-')[0] : 0,
    metacritic: g => Number(g.metacritic),
    platform: g => {
      const raw = g.platform || "Unknown";
      const primary = raw.split('/')[0].trim();
      return shortenPlatformName(primary);
    },
  },

  yearSortKeys: ['played', 'released'],

  pillarAxisFilter: (games, axis) => {
    if (axis === 'metacritic') return games.filter(g => g.metacritic && !isNaN(g.metacritic));
    return games;
  },

  filterFns: {
    category: (games, value) => {
      if (value === 'indie')
        return games.filter(g => (g.category || '').toLowerCase() === 'indie');
      if (value === 'ubisoft')
        return games.filter(g => (g.developer || '').toLowerCase().includes('ubisoft'));
      if (value === 'meta80')
        return games.filter(g => Number(g.metacritic) >= 80);
      return games;
    },
    platform: (games, value) => {
      if (value === 'all-other')
        return games.filter(g => !MAIN_PLATFORMS_FILTER.some(m => (g.platform || '').toLowerCase().includes(m)));
      return games.filter(g => (g.platform || '').toLowerCase().includes(value.toLowerCase()));
    },
  },

};
