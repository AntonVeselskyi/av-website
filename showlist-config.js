// ========== SHOW LIST CONFIG ==========
// Loaded between show-list.js and core.js in showlist.html.

const SHOW_API = "https://bzfclyzne3.execute-api.us-east-2.amazonaws.com/default/showTierProvider";

window.LIST_CONFIG = {

  data: showMasterList,

  getKey: (g) => `show_${g.tmdb_id}_${(g.name || "").toLowerCase()}`,

  getLink: (g) => g.imdb_url || g.tmdb_url || null,

  async enrichItems(shows) {
    const ids = shows.map(s => s.tmdb_id).filter(Boolean);

    const response = await fetch(SHOW_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shows: ids })
    });

    const result = await response.json();
    if (!result.ok || !Array.isArray(result.data))
      throw new Error("Bad response from show Lambda");

    const coverMap = result.data.reduce((acc, e) => {
      acc[String(e.tmdb_id)] = e;
      return acc;
    }, {});

    return shows.map(show => {
      const enriched = coverMap[String(show.tmdb_id)] || {};
      return { ...show, ...enriched, category: show.category || enriched.category, image: enriched.image || "img/placeholder.png" };
    });
  },

  getDetailsHtml: (g) => `
    <p>Creator:</p>
    <p><span>${g.creator || "N/A"}</span></p>
    <p>First Aired:</p>
    <p><span>${g.first_air_date?.split("-")[0] || "N/A"}</span></p>
    <p>Network:</p>
    <p><span>${g.network || "N/A"}</span></p>
    <p>Status:</p>
    <p><span>${g.status || "N/A"}</span></p>
    ${g.season_count  ? `<p>Seasons: <span>${g.season_count}</span></p>`  : ""}
    ${g.episode_count ? `<p>Episodes: <span>${g.episode_count}</span></p>` : ""}
    ${g.imdb_url ? `<p><a href="${g.imdb_url}" target="_blank" style="color:inherit;text-decoration:none;">IMDB</a></p>` : ""}
    ${g.tmdb_url ? `<p><a href="${g.tmdb_url}" target="_blank" style="color:inherit;text-decoration:none;">TMDB</a></p>` : ""}
  `,

  getExpHtml: (g) => `
    <p>Watched: <span>${g.watched_year || "N/A"}</span></p>
  `,

  decadeField: "watched_year",

  yearSortKeys: ["watched", "released"],

  sortFns: {
    watched:  g => Number(g.watched_year) || 0,
    released: g => g.first_air_date ? Number(g.first_air_date.split("-")[0]) : 0,
    score:    g => Number(g.score) || 0,
    name:     g => (g.name || "").toLowerCase(),
  },

  axisValueFns: {
    score:    g => g.score || 0,
    watched:  g => g.watched_year || 0,
    released: g => g.first_air_date ? Number(g.first_air_date.split("-")[0]) : 0,
    network:  g => g.network || "Unknown",
    seasons:  g => Number(g.season_count) || 0,
  },

  pillarAxisFilter: (_games, _axis) => _games, // no special filtering needed

  filterFns: {
    category: (games, values) => {
      const vals = (Array.isArray(values) ? values : [values]).map(v => v.toLowerCase());
      return games.filter(g => vals.includes((g.category || "").toLowerCase()));
    },
  },

};
