/* =====================================================================
   WANDERLUST — render + interaction
   Flat (Natural Earth) <-> Globe (Orthographic) morph, soft country
   patterns, ballpoint pins, animated arcs, timelapse, hello-audio popup.
   Depends on: d3 v7, d3-geo-projection, topojson-client, versor (CDN).
   ===================================================================== */
(function () {
  'use strict';

  const DATA = window.WANDERLUST;
  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
  const MAX_ZOOM = 240;         // allow zooming right down to tiny places (Comino, Vaduz, Vatican)
  const USD_TO_EUR = 0.86;      // approximate display conversion for country salary context
  const USD_TO_CAD = 1.37;
  const FOCUS_DIM = {
    countryOpacity: 0.76,
    countryFilter: 'saturate(.72) brightness(.92)',
    arcOpacity: 0.62,
    arcFilter: 'saturate(.68) brightness(.88)',
    pinOpacity: 0.78,
  };
  const TIMELINE_MARKER_SPEEDUP = 0.7;
  const TIMELINE_MARKER_LANDING_MS = 780 * TIMELINE_MARKER_SPEEDUP;
  const TIMELINE_MARKER_HOLD_MS = 720 * TIMELINE_MARKER_SPEEDUP;

  /* ---- state ---- */
  let svg, gZoom, gCountries, gGraticule, gArcs, gSphere, gMeasure, gGlobeTitle, defs, pinLayer, popup;
  let measureMode = false, measurePts = [], measureLabel = null, measureOverlay = null;
  let measurePointer = null, measureLastRelease = null;
  let width = 0, height = 0;
  let projection, path;
  let zoom, zoomT;              // d3.zoom behaviour + current transform
  let countries = [];           // GeoJSON features
  let isGlobe = false;
  let morphing = false;
  let timelapsePlaying = false;
  const pins = [];              // pin entries (places + deduped city pins)
  const arcEls = [];            // { el, trip, fromCoords, routeIndex }
  let usePinImage = false;      // set true if img/pin.png loads
  let countryYear = {};         // country name → latest visit year
  let countryKeys = {};         // country name → Set of keys (years + eras) visited
  let countryMotif = {};        // country name → motif key (distinct per country)
  let timelapseActive = false;  // timelapse hides everything but Ukraine, reveals as arcs land
  const revealedCountries = new Set();
  const revealedYearByCountry = {};   // country → key of the latest revealed arc (timelapse/timeline)
  let hoveredCountry = null;    // country under the cursor (border highlight + label)
  let coordsByName = {};        // city name → coords (places + trips)
  let countryByCity = {};       // city name → country, for focus-context routing
  let cityPinByName = {};       // city name → pin entry (for timelapse)
  let showCityNames = true;
  let countryInfoState = null;
  const HOME_COUNTRIES = new Set(DATA.homeCountries || []);
  const EUROPE_COUNTRIES = [
    'Albania', 'Andorra', 'Austria', 'Belarus', 'Belgium', 'Bosnia and Herzegovina',
    'Bulgaria', 'Croatia', 'Cyprus', 'Czechia', 'Denmark', 'Estonia', 'Finland',
    'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Italy',
    'Kosovo', 'Latvia', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Malta',
    'Moldova', 'Monaco', 'Montenegro', 'Netherlands', 'North Macedonia', 'Norway',
    'Poland', 'Portugal', 'Romania', 'Russia', 'San Marino', 'Serbia', 'Slovakia',
    'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Turkey', 'Ukraine',
    'United Kingdom', 'Vatican'
  ];
  const STATS_DISTANCE_MODES = ['km', 'miles', 'cans', 'steps'];
  let statsDistanceModeIndex = 0;
  let statsIncludeHomeTrips = true;
  const GLOBE_FRONT_MARGIN = 0.025;
  const TITLE_MOUNT_MS = 760;

  const $ = (sel) => document.querySelector(sel);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function getCoords(name) {
    if (coordsByName[name]) return coordsByName[name];
    if (DATA.places[name]) return DATA.places[name].coords;
    const t = DATA.trips.find((t) => t.city === name);
    return t ? t.coords : null;
  }

  /* =================================================================
     PROJECTION MORPH  (Bostock/Rivière interpolating raw projection)
     ================================================================= */
  function interpolateProjection(raw0, raw1) {
    const mutate = d3.geoProjectionMutator((t) => {
      const raw = (x, y) => {
        const [x0, y0] = raw0(x, y), [x1, y1] = raw1(x, y);
        return [x0 + t * (x1 - x0), y0 + t * (y1 - y0)];
      };
      // Provide an inverse so projection.invert() works — REQUIRED for
      // versor globe-dragging. Exact at the endpoints (t=0 flat, t=1 globe),
      // which is all that matters since rotation only happens on the globe.
      if (raw0.invert && raw1.invert) {
        raw.invert = (x, y) => (t < 0.5 ? raw0.invert : raw1.invert)(x, y);
      }
      return raw;
    });
    let t = 0;
    return Object.assign(mutate(t), {
      alpha(_) { return arguments.length ? mutate(t = +_) : t; },
    });
  }

  // GeoJSON of every place visited — used to frame the flat map and to
  // aim the globe. Built once at init.
  let contentGeo = null;
  function buildContentGeo() {
    coordsByName = {};
    countryByCity = {};
    Object.values(DATA.places).forEach((p) => {
      coordsByName[p.city] = p.coords;
      countryByCity[p.city] = p.country;
    });
    DATA.trips.forEach((t) => {
      coordsByName[t.city] = t.coords;
      countryByCity[t.city] = t.country;
    });
    (DATA.markers || []).forEach((m) => {
      coordsByName[m.city] = m.coords;
      countryByCity[m.city] = m.country;
    });
    contentGeo = { type: 'MultiPoint', coordinates: Object.values(coordsByName) };
  }

  /* =================================================================
     SETUP
     ================================================================= */
  function measure() {
    const map = $('#wl-map');
    width = map.clientWidth;
    height = map.clientHeight;
  }

  function buildSvg() {
    const map = d3.select('#wl-map');
    map.selectAll('svg').remove();
    svg = map.append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    defs = svg.append('defs');
    buildPatterns();

    // everything geographic lives in gZoom so pan/zoom is one transform.
    zoomT = d3.zoomIdentity;
    gZoom = svg.append('g').attr('class', 'zoom-layer');
    gSphere    = gZoom.append('path').attr('class', 'wl-sphere');
    gGraticule = gZoom.append('path').attr('class', 'wl-graticule');
    gCountries = gZoom.append('g').attr('class', 'countries');
    gGlobeTitle = gZoom.append('g').attr('class', 'globe-title');
    gArcs      = gZoom.append('g').attr('class', 'arcs');
    gMeasure   = gZoom.append('g').attr('class', 'measure');
  }

  /* Geometric "summer-dress" tile motifs, all SEAMLESS on a 20×20 tile
     (userSpaceOnUse): line motifs connect across tile edges; filled motifs sit
     fully inside with a margin so nothing is clipped at the stitch. */
  const TILE = 20;
  const MOTIFS = {
    // continuous diamond lattice — vertices on edge midpoints connect tiles
    diamond: (g, c) => {
      g.attr('fill', 'none').attr('stroke', c).attr('stroke-width', 1.3);
      g.append('path').attr('d', 'M10 0 L20 10 L10 20 L0 10 Z');
      g.append('circle').attr('cx', 10).attr('cy', 10).attr('r', 1.6).attr('fill', c).attr('stroke', 'none');
    },
    // contained up-triangle (gaps), never touches edges
    triangle: (g, c) => {
      g.attr('fill', c);
      g.append('path').attr('d', 'M10 3 L17 16 L3 16 Z').attr('opacity', .9);
    },
    // zigzag rows; endpoints meet at x=0 & x=20 so rows are continuous
    chevron: (g, c) => {
      g.attr('fill', 'none').attr('stroke', c).attr('stroke-width', 1.5)
        .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      g.append('path').attr('d', 'M0 6 L10 1 L20 6');
      g.append('path').attr('d', 'M0 16 L10 11 L20 16');
    },
    // wave rows, continuous across edges
    scallop: (g, c) => {
      g.attr('fill', 'none').attr('stroke', c).attr('stroke-width', 1.4).attr('stroke-linecap', 'round');
      g.append('path').attr('d', 'M0 6 Q5 1 10 6 T20 6');
      g.append('path').attr('d', 'M0 16 Q5 11 10 16 T20 16');
    },
    // even grid (lines on 0 & 10 tile across cleanly) + dots in the cells
    lattice: (g, c) => {
      g.attr('stroke', c).attr('stroke-width', 1).attr('stroke-linecap', 'round');
      g.append('path').attr('d', 'M0 0 H20 M0 10 H20 M0 0 V20 M10 0 V20').attr('opacity', .5);
      [[5, 5], [15, 5], [5, 15], [15, 15]].forEach(([x, y]) =>
        g.append('circle').attr('cx', x).attr('cy', y).attr('r', 1.4).attr('fill', c).attr('stroke', 'none'));
    },
    // two diagonal rounded squares, fully contained (no clipping at the stitch)
    checks: (g, c) => {
      g.attr('fill', c);
      g.append('rect').attr('x', 2.5).attr('y', 2.5).attr('width', 6).attr('height', 6).attr('rx', 1.3).attr('opacity', .85);
      g.append('rect').attr('x', 11.5).attr('y', 11.5).attr('width', 6).attr('height', 6).attr('rx', 1.3).attr('opacity', .85);
    },
    // semicircle arch row, continuous across edges
    arches: (g, c) => {
      g.attr('fill', 'none').attr('stroke', c).attr('stroke-width', 1.4).attr('stroke-linecap', 'round');
      g.append('path').attr('d', 'M0 14 A5 5 0 0 1 10 14 M10 14 A5 5 0 0 1 20 14');
      [[5, 4], [15, 4]].forEach(([x, y]) => g.append('circle').attr('cx', x).attr('cy', y).attr('r', 1.3).attr('fill', c).attr('stroke', 'none'));
    },
    // offset contained triangles
    offsetTri: (g, c) => {
      g.attr('fill', c);
      [[6, 4], [14, 11]].forEach(([x, y]) =>
        g.append('path').attr('d', `M${x} ${y} L${x + 4} ${y + 6} L${x - 4} ${y + 6} Z`).attr('opacity', .9));
    },
    // Ukraine: stylised wheat sheaf (kept as-is, fully inside the tile)
    wheat: (g, c) => {
      const gg = g.append('g').attr('stroke', c).attr('stroke-width', 1.2)
        .attr('fill', 'none').attr('stroke-linecap', 'round');
      gg.append('path').attr('d', 'M10 3 L10 18');
      for (let k = 0; k < 5; k++) {
        const y = 5.5 + k * 2.7;
        gg.append('path').attr('d', `M10 ${y} C7.5 ${y - 0.8} 6.7 ${y - 2} 6.3 ${y - 3.2}`);
        gg.append('path').attr('d', `M10 ${y} C12.5 ${y - 0.8} 13.3 ${y - 2} 13.7 ${y - 3.2}`);
      }
    },

    /* --- Euro Trip 2024: a little "soul" per country, still minimalist --- */
    // Portugal — azulejo quatrefoil tile
    azulejo: (g, c) => {
      g.attr('fill', 'none').attr('stroke', c).attr('stroke-width', 1.2);
      [[10, 4], [10, 16], [4, 10], [16, 10]].forEach(([x, y]) =>
        g.append('circle').attr('cx', x).attr('cy', y).attr('r', 3));
      g.append('circle').attr('cx', 10).attr('cy', 10).attr('r', 1.4).attr('fill', c).attr('stroke', 'none');
    },
    // Italy — Roman mosaic (rotated square + corner studs)
    mosaic: (g, c) => {
      g.attr('fill', 'none').attr('stroke', c).attr('stroke-width', 1.2);
      g.append('path').attr('d', 'M10 4 L16 10 L10 16 L4 10 Z');
      [[10, 4], [16, 10], [10, 16], [4, 10]].forEach(([x, y]) =>
        g.append('circle').attr('cx', x).attr('cy', y).attr('r', 1.1).attr('fill', c).attr('stroke', 'none'));
    },
    // Denmark — Nordic cross
    nordic: (g, c) => {
      g.attr('stroke', c).attr('stroke-width', 2).attr('stroke-linecap', 'round');
      g.append('path').attr('d', 'M8 2 V18 M0 8 H20');
    },
    // Vatican — papal sunburst / cross
    cross: (g, c) => {
      g.attr('stroke', c).attr('stroke-width', 1.3).attr('stroke-linecap', 'round');
      g.append('path').attr('d', 'M10 4 V16 M6 7 H14');
      g.append('circle').attr('cx', 10).attr('cy', 10).attr('r', 5).attr('fill', 'none').attr('opacity', .5);
    },
  };
  const SPECIAL_MOTIF = { Portugal: 'azulejo', Italy: 'mosaic', Denmark: 'nordic', Vatican: 'cross' };

  function patId(name) { return 'wl-pat-' + name.replace(/[^a-z]/gi, ''); }

  function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function lighten(hex, amt) {
    const h = hex.replace('#', '');
    let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
    return `rgb(${r},${g},${b})`;
  }

  // complementary colour (opposite hue, vivid) so pins/arcs pop off the pattern
  function complement(hex) {
    const h = hex.replace('#', '');
    let r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l0 = (mx + mn) / 2;
    let hue = 0, s = 0;
    if (mx !== mn) {
      const dd = mx - mn;
      s = l0 > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      if (mx === r) hue = (g - b) / dd + (g < b ? 6 : 0);
      else if (mx === g) hue = (b - r) / dd + 2;
      else hue = (r - g) / dd + 4;
      hue /= 6;
    }
    hue = (hue + 0.5) % 1;                       // rotate 180°
    s = Math.min(1, Math.max(s, 0.62));          // keep it vivid
    const l = Math.min(0.7, Math.max(0.55, l0)); // and bright enough to read
    const hed = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const to = (t) => Math.round(hed(p, q, hue + t) * 255).toString(16).padStart(2, '0');
    return `#${to(1 / 3)}${to(0)}${to(-1 / 3)}`;
  }
  // --- HSL helpers for the pin-bead contrast pass ---
  function hexToHsl(hex) {
    const h = hex.replace('#', '');
    let r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let hue = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) hue = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
      hue /= 6;
    }
    return [hue, s, l];
  }
  function hslToHex(h, s, l) {
    const hed = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const to = (t) => Math.round(hed(p, q, h + t) * 255).toString(16).padStart(2, '0');
    return `#${to(1 / 3)}${to(0)}${to(-1 / 3)}`;
  }

  /* Pin-bead colour: keep the year's HUE (so a pin reads as its legend year) but
     guarantee it pops. Floor the brightness (no near-black pins), and when the
     bead would sit same-hue + same-tone on its own country's fill (pre-2014 pink
     on pink, Canada mint on mint), lift it well above the faint pattern so it
     separates by lightness. */
  function beadColor(base, country) {
    let [h, s, l] = hexToHsl(base);
    s = Math.max(s, 0.55);
    l = Math.max(l, 0.52);                       // brightness floor → never reads as black
    if (country) {
      const [bh, , bl] = hexToHsl(countryDisplayColor(country));
      const dh = Math.min(Math.abs(h - bh), 1 - Math.abs(h - bh));   // hue distance 0..0.5
      if (dh < 0.07 && Math.abs(l - bl) < 0.24) l = Math.min(0.82, bl + 0.30);
    }
    return hslToHex(h, s, l);
  }

  // a trip/marker is keyed by its era ('pre2014') or its year
  const ERAS = DATA.eras || {};
  const itemKey = (o) => o.era || o.year;
  const keyColor = (key) => (ERAS[key] ? ERAS[key].color : DATA.yearColors[key]) || '#999';
  const keyLabel = (key) => (key === 'pre2014' ? t('before2014') : ERAS[key] ? ERAS[key].label : String(key));
  // pin/arc base colour = the item's own year/era colour, so it matches the
  // legend. Pins additionally run through beadColor() for on-country contrast.
  const markColor = (o) => keyColor(itemKey(o));

  /* ===== i18n (English ⇄ Ukrainian; city names are never translated) ===== */
  let lang = 'en';
  const T = {
    travels:    { en: 'travels', uk: 'подорожі' },
    allYears:   { en: 'all', uk: 'усі' },
    showArcs:   { en: 'show arcs', uk: 'показати дуги' },
    showPins:   { en: 'show pins', uk: 'показати шпильки' },
    cityNames:  { en: 'city names', uk: 'назви міст' },
    globe:      { en: '◉ globe', uk: '◉ глобус' },
    flat:       { en: '◳ flat map', uk: '◳ карта' },
    timeline:   { en: '⧗ timeline', uk: '⧗ хронологія' },
    reset:      { en: '⟳ reset view', uk: '⟳ скинути' },
    measure:    { en: '⟂ measure', uk: '⟂ виміряти' },
    play:       { en: '▶ play the journey', uk: '▶ відтворити подорож' },
    stopJourney:{ en: '■ stop', uk: '■ стоп' },
    timelinePlay: { en: 'play', uk: 'пуск' },
    timelineStop: { en: 'stop', uk: 'стоп' },
    before2014: { en: 'before 2014', uk: 'до 2014' },
    hometown:   { en: '★ hometown', uk: '★ рідне місто' },
    home:       { en: '⌂ home', uk: '⌂ дім' },
    population: { en: 'population', uk: 'населення' },
    totalVisits:{ en: 'total visits', uk: 'всього візитів' },
    fromLviv:   { en: 'from Lviv', uk: 'від Львова' },
    countryPrompt: { en: 'hover a pin or focus a country', uk: 'наведи на шпильку або сфокусуй країну' },
    salaryNet:  { en: 'net salary / mo', uk: 'чиста зарплата / міс' },
    language:   { en: 'language', uk: 'мова' },
    noData:     { en: 'n/a', uk: 'н/д' },
    beginning:  { en: 'Lviv — the beginning', uk: 'Львів — початок' },
    hintFlat:   { en: 'drag to pan · scroll to zoom · play the journey', uk: 'тягни — рух · коліщатко — масштаб · відтвори подорож' },
    hintGlobe:  { en: 'drag to spin · scroll to zoom', uk: 'тягни — обертання · коліщатко — масштаб' },
    audioCredits: { en: 'audio credits', uk: 'аудіо джерела' },
    audioCreditsText: {
      en: 'recorded greetings are reused from public pronunciation archives and phrasebooks.',
      uk: 'записи привітань використано з публічних архівів вимови та розмовників.',
    },
    closeCredits: { en: 'close audio credits', uk: 'закрити аудіо джерела' },
    stats: { en: 'stats', uk: 'статистика' },
    closeStats: { en: 'close stats', uk: 'закрити статистику' },
    countryList: { en: 'countries', uk: 'країни' },
    closeCountryList: { en: 'close countries visited', uk: 'закрити відвідані країни' },
    cityList: { en: 'cities', uk: 'міста' },
    closeCityList: { en: 'close cities visited', uk: 'закрити відвідані міста' },
    europeChecklist: { en: 'Europe checklist', uk: 'Європа чекліст' },
    closeEuropeChecklist: { en: 'close Europe checklist', uk: 'закрити чекліст Європи' },
    countriesVisited: { en: 'countries visited', uk: 'відвідані країни' },
    citiesVisited: { en: 'cities visited', uk: 'відвідані міста' },
    clickForList: { en: 'click for list', uk: 'натисни для списку' },
    europeVisited: { en: 'European countries', uk: 'країни Європи' },
    clickForChecklist: { en: 'click for checklist', uk: 'натисни для чекліста' },
    totalKilometers: { en: 'total distance traveled', uk: 'усього відстані в подорожах' },
    distanceCycle: { en: 'click to cycle units', uk: 'натисни, щоб змінити одиниці' },
    milesLong: { en: 'miles', uk: 'милі' },
    cansLong: { en: 'Coca-Cola cans long', uk: 'банок Coca-Cola завдовжки' },
    stepsLong: { en: 'walking steps', uk: 'кроків пішки' },
    farthestFromLviv: { en: 'farthest from Lviv', uk: 'найдалі від Львова' },
    travelsPerYear: { en: 'travels per year', uk: 'подорожі за рік' },
    includingHomeTrips: { en: 'including home-country trips', uk: 'включно з поїздками в домашніх країнах' },
    excludingHomeTrips: { en: 'excluding domestic trips inside home countries', uk: 'без внутрішніх поїздок у домашніх країнах' },
    visited: { en: 'visited', uk: 'відвідано' },
  };
  const t = (k) => (T[k] ? T[k][lang] : k);

  const LANG_NAMES = {
    'uk-UA': ['Ukrainian', 'Українська'], 'fr-FR': ['French', 'Французька'], 'pl-PL': ['Polish', 'Польська'],
    'ka-GE': ['Georgian', 'Грузинська'], 'tr-TR': ['Turkish', 'Турецька'], 'mt-MT': ['Maltese', 'Мальтійська'],
    'hu-HU': ['Hungarian', 'Угорська'], 'sr-RS': ['Serbian', 'Сербська'], 'ar-SA': ['Arabic', 'Арабська'],
    'sv-SE': ['Swedish', 'Шведська'], 'es-DO': ['Spanish', 'Іспанська'], 'en-CA': ['English', 'Англійська'],
    'cs-CZ': ['Czech', 'Чеська'], 'da-DK': ['Danish', 'Данська'], 'de-AT': ['Austrian German', 'Австрійська німецька'],
    'de-CH': ['Swiss German', 'Швейцарська німецька'], 'de-DE': ['German', 'Німецька'], 'bg-BG': ['Bulgarian', 'Болгарська'],
    'it-IT': ['Italian', 'Італійська'], 'pt-PT': ['Portuguese', 'Португальська'],
  };
  const langName = (code) => {
    const v = LANG_NAMES[code];
    if (v) return v[lang === 'uk' ? 1 : 0];
    const base = (code || '').split('-')[0];
    if (!base) return '';
    try {
      return new Intl.DisplayNames([lang === 'uk' ? 'uk' : 'en'], { type: 'language' }).of(base) || base.toUpperCase();
    } catch {
      return base.toUpperCase();
    }
  };

  const COUNTRY_UK = {
    Ukraine: 'Україна', Poland: 'Польща', France: 'Франція', Hungary: 'Угорщина', Montenegro: 'Чорногорія',
    Egypt: 'Єгипет', Canada: 'Канада', Georgia: 'Грузія', Turkey: 'Туреччина', Sweden: 'Швеція',
    'Dominican Rep.': 'Домініканська Респ.', Malta: 'Мальта', Czechia: 'Чехія', Austria: 'Австрія',
    Liechtenstein: 'Ліхтенштейн', Switzerland: 'Швейцарія', Germany: 'Німеччина', Bulgaria: 'Болгарія',
    Russia: 'росія', Italy: 'Італія', Spain: 'Іспанія', Romania: 'Румунія', Greece: 'Греція',
    Portugal: 'Португалія', Norway: 'Норвегія', Finland: 'Фінляндія', 'United States of America': 'США',
    'United Kingdom': 'Велика Британія', Ireland: 'Ірландія', Netherlands: 'Нідерланди', Belgium: 'Бельгія',
    Slovakia: 'Словаччина', Slovenia: 'Словенія', Croatia: 'Хорватія', Serbia: 'Сербія', Belarus: 'Білорусь',
    Denmark: 'Данія', Mexico: 'Мексика', Cuba: 'Куба', Algeria: 'Алжир', Libya: 'Лівія', Morocco: 'Марокко',
  };
  const SEA_UK = {
    'Atlantic Ocean': 'Атлантичний океан', 'Mediterranean Sea': 'Середземне море', 'Black Sea': 'Чорне море',
    'Caribbean Sea': 'Карибське море', 'Baltic Sea': 'Балтійське море', 'North Sea': 'Північне море',
    'Caspian Sea': 'Каспійське море', 'Norwegian Sea': 'Норвезьке море', 'Red Sea': 'Червоне море',
    'Adriatic Sea': 'Адріатичне море', 'Aegean Sea': 'Егейське море', 'Ionian Sea': 'Іонічне море',
    'Tyrrhenian Sea': 'Тірренське море', 'Sea of Azov': 'Азовське море', 'Sea of Marmara': 'Мармурове море',
    'Ligurian Sea': 'Лігурійське море', 'Bay of Biscay': 'Біскайська затока', 'English Channel': 'Ла-Манш',
    'Irish Sea': 'Ірландське море',
  };
  const PURPOSE_UK = { Travel: 'подорож', Business: 'робота', Stay: 'перебування', Moved: 'переїзд', Lived: 'життя', 'Day trip': 'одноденка' };

  const CITY_UK = {
    Lviv: 'Львів', 'Kraków': 'Краків', Toronto: 'Торонто', Paris: 'Париж', Warsaw: 'Варшава',
    Batumi: 'Батумі', 'Üçkardeş': 'Учкардеш', Valletta: 'Валлетта', Budapest: 'Будапешт', Budva: 'Будва',
    Mdina: 'Мдіна', Victoria: 'Вікторія', 'Ramla Beach': 'Рамла Біч', Sliema: 'Сліма', 'Comino Island': 'острів Коміно',
    Kotor: 'Котор', 'Porto Montenegro': 'Порто Монтенегро', Podgorica: 'Подгориця', 'Sveti Stefan': 'Светі-Стефан', 'Lake Skadar': 'Скадарське озеро',
    'Sharm El Sheikh': 'Шарм-ель-Шейх', Stockholm: 'Стокгольм', 'Punta Cana': 'Пунта-Кана',
    'Český Krumlov': 'Чеський Крумлов', Salzburg: 'Зальцбург', Vaduz: 'Вадуц', 'Zürich': 'Цюрих',
    Munich: 'Мюнхен', 'Niagara Falls': 'Ніагарський водоспад', Tobermory: 'Тоберморі', Montreal: 'Монреаль',
    Vancouver: 'Ванкувер', Obzor: 'Обзор', Uray: 'Урай', Mezhdurechensky: 'Междуреченський',
    Kyiv: 'Київ', Odesa: 'Одеса', 'Ivano-Frankivsk': 'Івано-Франківськ', 'Synevyrska Poliana': 'Синевирська Поляна', Yaremche: 'Яремче', Myczkowce: 'Мичківці',
    Simferopol: 'Сімферополь', Hurzuf: 'Гурзуф', Utyos: 'Утьос', Yalta: 'Ялта', Yevpatoria: 'Євпаторія',
    'Berehove (Feodosia)': 'Берегове (Феодосія)', Alanya: 'Аланія', Antalya: 'Анталія', Pamukkale: 'Памуккале',
    Lisbon: 'Лісабон', Copenhagen: 'Копенгаген', Prague: 'Прага', Rome: 'Рим', Florence: 'Флоренція',
    Venice: 'Венеція', Vatican: 'Ватикан',
  };
  const dispCity = (name) => (lang === 'uk' ? (CITY_UK[name] || name) : name);

  // russia stays lowercase in every HUD and language (deliberate).
  const isRussia = (name) => name === 'Russia';
  const countryNameClass = (name) => isRussia(name) ? ' country-russia' : '';
  const dispCountry = (name) => {
    if (isRussia(name)) return lang === 'uk' ? 'росія' : 'russia';
    return lang === 'uk' ? (COUNTRY_UK[name] || name) : name;
  };
  const dispSea = (name) => (lang === 'uk' ? (SEA_UK[name] || name) : name);
  const dispPurpose = (p) => (lang === 'uk' ? (PURPOSE_UK[p] || p) : p);

  function populationFor(city, country) {
    const key = `${city}|${country}`;
    const byKey = DATA.cityPopulations || {};
    if (Object.prototype.hasOwnProperty.call(byKey, key)) return byKey[key];
    if (Object.prototype.hasOwnProperty.call(byKey, city)) return byKey[city];
    return null;
  }

  function formatPopulation(value) {
    if (value == null || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (n === 0) return '0';
    if (n >= 1000000) return `≈ ${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}M`;
    if (n >= 10000) return `≈ ${Math.round(n / 1000)}K`;
    if (n >= 1000) return `≈ ${(n / 1000).toFixed(1)}K`;
    return `≈ ${Math.round(n).toLocaleString()}`;
  }

  function countryInfoFor(country) {
    return (DATA.countryInfo || {})[country] || {};
  }

  function isVisitedCountry(country) {
    return (DATA.visitedCountries || []).includes(country);
  }

  function formatMoney(value, rate) {
    if (value == null || value === '') return t('noData');
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return Math.round(n * rate).toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US');
  }

  function countryVisitCount(country) {
    const tripCount = DATA.trips.filter((trip) => trip.country === country).length;
    const markerCount = (DATA.markers || []).filter((marker) => marker.country === country).length;
    return tripCount + markerCount;
  }

  function distanceFromLviv(entry, country) {
    const home = DATA.places.Lviv && DATA.places.Lviv.coords;
    const fallback = entry && entry.coords ? null : countryEntryFor(country);
    const target = entry && entry.coords ? entry.coords : fallback && fallback.coords;
    if (!home || !target) return null;
    return Math.round(d3.geoDistance(home, target) * 6371);
  }

  function formatDistanceKm(km) {
    if (km == null || !Number.isFinite(km)) return t('noData');
    if (km < 10) return `${km} km`;
    return `${Math.round(km / 10) * 10} km`;
  }

  function formatTotalKm(km) {
    if (km == null || !Number.isFinite(km)) return t('noData');
    return `${Math.round(km / 100) * 100} km`;
  }

  function formatCompactNumber(value) {
    const n = Math.round(value);
    const locale = lang === 'uk' ? 'uk-UA' : 'en-US';
    try {
      return new Intl.NumberFormat(locale, {
        notation: n >= 100000 ? 'compact' : 'standard',
        maximumFractionDigits: n >= 1000000 ? 1 : 0,
      }).format(n);
    } catch {
      return n.toLocaleString(locale);
    }
  }

  function statsDistanceDisplay(km) {
    const mode = STATS_DISTANCE_MODES[statsDistanceModeIndex] || 'km';
    if (mode === 'miles') {
      const miles = km * 0.621371;
      return { value: `${Math.round(miles / 100) * 100} mi`, sub: `${t('milesLong')} · ${t('distanceCycle')}` };
    }
    if (mode === 'cans') {
      const cans = (km * 1000) / 0.122; // 12 oz Coca-Cola can height, about 12.2 cm
      return { value: `${formatCompactNumber(cans)} cans`, sub: `${t('cansLong')} · ${t('distanceCycle')}` };
    }
    if (mode === 'steps') {
      const steps = (km * 1000) / 0.762; // average adult walking step, about 2.5 ft
      return { value: `${formatCompactNumber(steps)} steps`, sub: `${t('stepsLong')} · ${t('distanceCycle')}` };
    }
    return { value: formatTotalKm(km), sub: t('distanceCycle') };
  }

  function tripRoutePoints(trip) {
    const points = [];
    const start = getCoords(trip.from);
    if (start) points.push(start);
    if (trip.via) trip.via.forEach((v) => points.push(v));
    if (trip.coords) points.push(trip.coords);
    return points;
  }

  function routeDistanceKm(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += d3.geoDistance(points[i - 1], points[i]) * 6371;
    }
    return total;
  }

  function isDomesticHomeTrip(trip) {
    const from = tripFromCountry(trip);
    return !!from && from === trip.country && HOME_COUNTRIES.has(trip.country);
  }

  function allVisitedPlaces() {
    const byPlace = new Map();
    const add = (place) => {
      if (!place || !place.city || !place.country || !place.coords) return;
      const key = `${place.city}|${place.country}`;
      if (!byPlace.has(key)) byPlace.set(key, {
        city: place.city,
        country: place.country,
        coords: place.coords,
      });
    };
    Object.values(DATA.places || {}).forEach(add);
    DATA.trips.forEach(add);
    (DATA.markers || []).forEach(add);
    return [...byPlace.values()];
  }

  function countryPopulation(country) {
    const n = Number(countryInfoFor(country).population);
    return Number.isFinite(n) ? n : 0;
  }

  function visitedCityGroups() {
    const groups = new Map();
    allVisitedPlaces().forEach((place) => {
      if (!isVisitedCountry(place.country)) return;
      if (!groups.has(place.country)) groups.set(place.country, []);
      groups.get(place.country).push({
        ...place,
        population: populationFor(place.city, place.country),
      });
    });
    return [...groups.entries()]
      .sort((a, b) => (
        (isRussia(a[0]) ? 1 : 0) - (isRussia(b[0]) ? 1 : 0)
        || countryPopulation(b[0]) - countryPopulation(a[0])
        || dispCountry(a[0]).localeCompare(dispCountry(b[0]))
      ))
      .map(([country, places]) => ({
        country,
        population: countryPopulation(country),
        places: places.sort((a, b) => {
          const ap = Number.isFinite(Number(a.population)) ? Number(a.population) : -1;
          const bp = Number.isFinite(Number(b.population)) ? Number(b.population) : -1;
          return bp - ap || dispCity(a.city).localeCompare(dispCity(b.city));
        }),
      }));
  }

  function farthestPlaceFromLviv() {
    const home = DATA.places.Lviv && DATA.places.Lviv.coords;
    if (!home) return null;
    let farthest = null;
    allVisitedPlaces().forEach((place) => {
      if (place.city === 'Lviv' && place.country === 'Ukraine') return;
      const km = d3.geoDistance(home, place.coords) * 6371;
      if (!farthest || km > farthest.km) farthest = { ...place, km };
    });
    return farthest;
  }

  function travelStats() {
    const visitedCountries = new Set(DATA.visitedCountries || []);
    const europeVisited = EUROPE_COUNTRIES.filter((country) => visitedCountries.has(country));
    const cityGroups = visitedCityGroups();
    const totalKm = DATA.trips.reduce((sum, trip) => sum + routeDistanceKm(tripRoutePoints(trip)), 0);
    const yearCounts = {};
    DATA.trips.forEach((trip) => {
      if (!statsIncludeHomeTrips && isDomesticHomeTrip(trip)) return;
      const key = itemKey(trip);
      yearCounts[key] = (yearCounts[key] || 0) + 1;
    });
    const keys = Object.keys(DATA.eras || {}).concat(Object.keys(DATA.yearColors || {}));
    const tripsByYear = keys.map((key) => ({
      key,
      label: keyLabel(key),
      count: yearCounts[key] || 0,
      color: keyColor(key),
    }));
    return {
      countriesVisited: visitedCountries.size,
      citiesVisited: cityGroups.reduce((sum, group) => sum + group.places.length, 0),
      europeVisited,
      europeTotal: EUROPE_COUNTRIES.length,
      totalKm,
      farthestPlace: farthestPlaceFromLviv(),
      tripsByYear,
    };
  }

  function renderStatsPanel() {
    const wrap = $('#wl-stats-content');
    if (!wrap) return;
    const stats = travelStats();
    const distance = statsDistanceDisplay(stats.totalKm);
    const maxYear = Math.max(1, ...stats.tripsByYear.map((row) => row.count));
    const yearRows = stats.tripsByYear.map((row) => {
      const pct = Math.round((row.count / maxYear) * 100);
      const active = isolatedKey != null && String(isolatedKey) === String(row.key);
      return `
        <button class="wl-year-row${active ? ' active' : ''}" type="button" data-stats-key="${esc(row.key)}">
          <span>${esc(row.label)}</span>
          <span class="wl-year-track"><span class="wl-year-fill" style="--p:${pct}%;--c:${esc(row.color)}"></span></span>
          <span class="wl-year-count">${row.count}</span>
        </button>`;
    }).join('');
    const farthest = stats.farthestPlace;
    const farthestHtml = farthest ? `
        <div class="wl-stat-card">
          <div class="wl-stat-label">${esc(t('farthestFromLviv'))}</div>
          <div class="wl-stat-value">${esc(dispCity(farthest.city))}</div>
          <div class="wl-stat-sub">
            <span class="${countryNameClass(farthest.country).trim()}">${esc(dispCountry(farthest.country))}</span>
            · ${esc(formatDistanceKm(Math.round(farthest.km)))}
          </div>
        </div>` : '';
    wrap.innerHTML = `
      <div class="wl-stats-grid">
        <div class="wl-stat-split">
          <button class="wl-stat-card wl-stat-mini" id="wl-countries-open" type="button">
            <div class="wl-stat-label">${esc(t('countriesVisited'))}</div>
            <div class="wl-stat-value">${stats.countriesVisited.toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US')}</div>
            <div class="wl-stat-sub">${esc(t('clickForList'))}</div>
          </button>
          <button class="wl-stat-card wl-stat-mini" id="wl-cities-open" type="button">
            <div class="wl-stat-label">${esc(t('citiesVisited'))}</div>
            <div class="wl-stat-value">${stats.citiesVisited.toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US')}</div>
            <div class="wl-stat-sub">${esc(t('clickForList'))}</div>
          </button>
        </div>
        <button class="wl-stat-card" id="wl-europe-open" type="button">
          <div class="wl-stat-label">${esc(t('europeVisited'))}</div>
          <div class="wl-stat-value">${stats.europeVisited.length} / ${stats.europeTotal}</div>
          <div class="wl-stat-sub">${esc(t('clickForChecklist'))}</div>
        </button>
        <button class="wl-stat-card" id="wl-distance-cycle" type="button">
          <div class="wl-stat-label">${esc(t('totalKilometers'))}</div>
          <div class="wl-stat-value">${esc(distance.value)}</div>
          <div class="wl-stat-sub">${esc(distance.sub)}</div>
        </button>
        ${farthestHtml}
        <div class="wl-stat-card wide wl-year-toggle-card${statsIncludeHomeTrips ? ' active-toggle' : ''}" id="wl-year-toggle-card" role="button" tabindex="0">
          <div class="wl-stat-label">${esc(t('travelsPerYear'))}</div>
          <div class="wl-stat-sub">${esc(t(statsIncludeHomeTrips ? 'includingHomeTrips' : 'excludingHomeTrips'))}</div>
          <div class="wl-year-list">${yearRows}</div>
        </div>
      </div>`;
    const europeOpen = $('#wl-europe-open');
    if (europeOpen) europeOpen.addEventListener('click', (e) => {
      e.stopPropagation();
      setEuropePanel(true);
    });
    const countriesOpen = $('#wl-countries-open');
    if (countriesOpen) countriesOpen.addEventListener('click', (e) => {
      e.stopPropagation();
      setCountriesPanel(true);
    });
    const citiesOpen = $('#wl-cities-open');
    if (citiesOpen) citiesOpen.addEventListener('click', (e) => {
      e.stopPropagation();
      setCitiesPanel(true);
    });
    const distanceCycle = $('#wl-distance-cycle');
    if (distanceCycle) distanceCycle.addEventListener('click', (e) => {
      e.stopPropagation();
      statsDistanceModeIndex = (statsDistanceModeIndex + 1) % STATS_DISTANCE_MODES.length;
      renderStatsPanel();
    });
    const yearToggle = $('#wl-year-toggle-card');
    const toggleYearHomeTrips = (e) => {
      e.stopPropagation();
      statsIncludeHomeTrips = !statsIncludeHomeTrips;
      renderStatsPanel();
    };
    if (yearToggle) {
      yearToggle.addEventListener('click', toggleYearHomeTrips);
      yearToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleYearHomeTrips(e);
        }
      });
    }
    wrap.querySelectorAll('.wl-year-row[data-stats-key]').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const raw = row.dataset.statsKey;
        const key = ERAS[raw] ? raw : +raw;
        cancelTimelineForUserFilter();
        lockedKey = String(lockedKey) === String(key) ? null : key;
        setIsolate(lockedKey);
        frameKey(lockedKey);
        renderStatsPanel();
      });
    });
  }

  function renderVisitedCountriesList() {
    const wrap = $('#wl-countries-list');
    if (!wrap) return;
    const countries = (DATA.visitedCountries || [])
      .slice()
      .sort((a, b) => dispCountry(a).localeCompare(dispCountry(b)));
    wrap.innerHTML = `
      <div class="wl-europe-summary">${countries.length} ${esc(t('visited'))}</div>
      <div class="wl-europe-grid">
        ${countries.map((country) => `
          <div class="wl-europe-row visited plain">
            <span class="wl-europe-name${countryNameClass(country)}">${esc(dispCountry(country))}</span>
          </div>`).join('')}
      </div>`;
  }

  function renderVisitedCitiesList() {
    const wrap = $('#wl-cities-list');
    if (!wrap) return;
    const groups = visitedCityGroups();
    const total = groups.reduce((sum, group) => sum + group.places.length, 0);
    wrap.innerHTML = `
      <div class="wl-europe-summary">${total} ${esc(t('visited'))}</div>
      <div class="wl-europe-grid wl-city-grid">
        ${groups.map((group) => `
          <section class="wl-city-country">
            <div class="wl-city-country-head">
              <span class="wl-city-country-name${countryNameClass(group.country)}">${esc(dispCountry(group.country))}</span>
              <span class="wl-city-country-meta">${group.places.length} · ${esc(formatPopulation(group.population) || t('noData'))}</span>
            </div>
            <div class="wl-city-list">
              ${group.places.map((place) => `
                <div class="wl-city-row">
                  <span class="wl-city-name">${esc(dispCity(place.city))}</span>
                  <span class="wl-city-pop">${esc(formatPopulation(place.population) || t('noData'))}</span>
                </div>`).join('')}
            </div>
          </section>`).join('')}
      </div>`;
  }

  function renderEuropeChecklist() {
    const wrap = $('#wl-europe-checklist');
    if (!wrap) return;
    const visitedCountries = new Set(DATA.visitedCountries || []);
    const sorted = EUROPE_COUNTRIES.slice().sort((a, b) => dispCountry(a).localeCompare(dispCountry(b)));
    const visitedCount = sorted.filter((country) => visitedCountries.has(country)).length;
    wrap.innerHTML = `
      <div class="wl-europe-summary">${visitedCount} / ${EUROPE_COUNTRIES.length} ${esc(t('visited'))}</div>
      <div class="wl-europe-grid">
        ${sorted.map((country) => {
          const visited = visitedCountries.has(country);
          return `
            <div class="wl-europe-row${visited ? ' visited' : ''}">
              <span class="wl-europe-check">${visited ? '&#10003;' : ''}</span>
              <span class="wl-europe-name${countryNameClass(country)}">${esc(dispCountry(country))}</span>
            </div>`;
        }).join('')}
      </div>`;
  }

  function countryEntryFor(country) {
    const countryPins = pins.filter((p) => p.country === country);
    return countryPins.find((p) => p.hello && p.hello.native && p.kind === 'home') ||
           countryPins.find((p) => p.hello && p.hello.native && p.kind === 'origin') ||
           countryPins.find((p) => p.hello && p.hello.native && !p.focusOnly) ||
           countryPins.find((p) => p.hello && p.hello.native) ||
           countryPins[0] ||
           null;
  }

  function renderCountryInfoEmpty() {
    const panel = $('#wl-country-info');
    if (!panel) return;
    panel.classList.remove('active');
    panel.innerHTML = `<div class="ci-empty">${esc(t('countryPrompt'))}</div>`;
  }

  function showCountryInfo(input, animate = true) {
    const panel = $('#wl-country-info');
    if (!panel || !input) return;
    const entry = typeof input === 'string' ? countryEntryFor(input) : input;
    const country = typeof input === 'string' ? input : input.country;
    if (!country) return;
    if (!isVisitedCountry(country)) { clearCountryInfo(); return; }
    const info = countryInfoFor(country);
    const h = (entry && entry.hello) || {};
    const audio = helloAudioFor(h);
    countryInfoState = { country, entry: entry || null };

    const pop = formatPopulation(info.population);
    const visitCount = countryVisitCount(country);
    const fromHome = distanceFromLviv(entry, country);
    const salary = info.salaryUsd == null ? t('noData') : `
      <div class="ci-salary">
        <div class="ci-money">USD ${formatMoney(info.salaryUsd, 1)}</div>
        <div class="ci-money">EUR ${formatMoney(info.salaryUsd, USD_TO_EUR)}</div>
        <div class="ci-money">CAD ${formatMoney(info.salaryUsd, USD_TO_CAD)}</div>
      </div>`;
    const helloHtml = h.native ? `
      <div class="ci-item wide">
        <div class="ci-label">${esc(t('language'))}</div>
        <div class="ci-lang">
          <div class="ci-lang-text">
            <div class="ci-value">${esc(langName(h.lang))}</div>
            <div class="ci-native">${esc(h.native)}</div>
            <div class="ci-translit">${esc(h.translit || '')}</div>
          </div>
          <button class="pop-play ci-play" type="button" aria-label="${audio ? 'Play recorded pronunciation' : 'Play pronunciation'}">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
        </div>
      </div>` : '';

    panel.innerHTML = `
      <div class="ci-name${countryNameClass(country)}">${esc(dispCountry(country))}</div>
      <div class="ci-grid">
        <div class="ci-item">
          <div class="ci-label">${esc(t('population'))}</div>
          <div class="ci-value">${pop ? esc(pop) : esc(t('noData'))}</div>
        </div>
        <div class="ci-item">
          <div class="ci-label">${esc(t('totalVisits'))}</div>
          <div class="ci-value">${visitCount.toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US')}</div>
        </div>
        <div class="ci-item">
          <div class="ci-label">${esc(t('fromLviv'))}</div>
          <div class="ci-value">${esc(formatDistanceKm(fromHome))}</div>
        </div>
        <div class="ci-item wide">
          <div class="ci-label">${esc(t('salaryNet'))}</div>
          <div class="ci-value">${salary}</div>
        </div>
        ${helloHtml}
      </div>`;
    panel.classList.add('active');
    const btn = panel.querySelector('.ci-play');
    if (btn) btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelHide();
      playHello(h, btn);
    });
    if (animate) {
      panel.classList.remove('ci-pop');
      void panel.offsetWidth;
      panel.classList.add('ci-pop');
    }
  }

  function clearCountryInfo() {
    countryInfoState = null;
    renderCountryInfoEmpty();
  }

  function clearCountrySelection() {
    focusedPin = null;
    focusedCountryName = null;
    autoDetailCountryName = null;
    playbackDetailCountryName = null;
    clearCountryInfo();
    if (gCountries) styleCountries();
    if (gArcs) renderArcs();
    if (pinLayer) positionPins();
  }

  function rerenderCountryInfo() {
    if (countryInfoState) showCountryInfo(countryInfoState.entry || countryInfoState.country, false);
    else renderCountryInfoEmpty();
  }

  // distinct geometric motifs so same-year countries still differ
  const MOTIF_POOL = ['diamond', 'chevron', 'scallop', 'triangle', 'arches', 'checks', 'offsetTri', 'lattice'];

  // resolve a visited country's colours + motif
  function countryStyle(name) {
    if (name === 'Ukraine')        // hometown — wheat in Ukrainian colours, NOT year-coloured
      return { ground: '#0057b7', groundOp: 0.34, motif: 'wheat', motifColor: '#ffd700', stroke: '#ffd700' };
    if (name === 'Poland')         // a home — Polish red & white
      return { ground: '#c1121f', groundOp: 0.30, motif: 'checks', motifColor: '#f4f1e8', stroke: '#f4f1e8' };
    if (name === 'Canada')         // current home base
      return { ground: '#94d2bd', groundOp: 0.24, motif: 'lattice', motifColor: '#cfeee4', stroke: '#94d2bd' };
    let c = DATA.yearColors[countryYear[name]];
    if (!c) {                                   // visited only in an era (e.g. russia, pre-2014)
      const ks = countryKeys[name];
      const era = ks && [...ks].find((k) => ERAS[k]);
      c = era ? ERAS[era].color : '#999';
    }
    return { ground: c, groundOp: 0.24, motif: countryMotif[name] || 'diamond', motifColor: c, stroke: c };
  }

  // year-coloured outline + always-on geometric pattern, one per visited country
  function buildPatterns() {
    countryYear = {};
    countryKeys = {};
    const noteKey = (country, key) => {
      if (key == null) return;
      (countryKeys[country] = countryKeys[country] || new Set()).add(key);
      if (typeof key === 'number' && (!countryYear[country] || key > countryYear[country])) countryYear[country] = key;
    };
    DATA.trips.forEach((t) => noteKey(t.country, itemKey(t)));
    (DATA.markers || []).forEach((m) => noteKey(m.country, itemKey(m)));
    countryMotif = {};
    let mi = 0;
    DATA.visitedCountries.forEach((name) => {         // distinct motif per non-home country
      if (HOME_COUNTRIES.has(name)) return;
      countryMotif[name] = SPECIAL_MOTIF[name] || MOTIF_POOL[mi++ % MOTIF_POOL.length];
    });

    DATA.visitedCountries.forEach((name, i) => {
      defs.append('pattern')
        .attr('id', patId(name))
        .attr('width', TILE).attr('height', TILE)
        .attr('viewBox', `0 0 ${TILE} ${TILE}`)         // lets the tile scale per country
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('patternTransform', `rotate(${(i % 3) * 6 - 6})`);
      paintPattern(name);          // initial colour (latest year / home colour)
    });
  }

  // shrink the pattern tile for small countries so the motif stays readable
  function sizePatterns() {
    gCountries.selectAll('path.visited').each(function (d) {
      let b;
      try { b = this.getBBox(); } catch (e) { return; }
      if (!b || !b.width) return;
      // ~4 tiles across the country's smaller dimension; no big floor so tiny
      // countries (Vatican, Malta, Liechtenstein) still get a real repeat
      const tile = Math.max(1.2, Math.min(TILE, Math.min(b.width, b.height) / 4));
      const el = document.getElementById(patId(d.properties.name));
      if (el) { el.setAttribute('width', tile); el.setAttribute('height', tile); }
    });
  }

  // (re)fill a country's pattern. For year-coloured countries an override colour
  // lets the fill morph with the active filter / timelapse; home countries keep
  // their fixed (Ukraine wheat, Poland red/white, Canada pearl) styling.
  const lastPatternColor = {};
  function paintPattern(name, overrideColor) {
    const s = countryStyle(name);
    const home = HOME_COUNTRIES.has(name);
    const ground = home ? s.ground : (overrideColor || s.ground);
    const motifColor = home ? s.motifColor : (overrideColor || s.motifColor);
    const pat = defs.select('#' + patId(name));
    if (pat.empty()) return;
    pat.selectAll('*').remove();
    pat.append('rect').attr('width', TILE).attr('height', TILE)
      .attr('fill', ground).attr('opacity', s.groundOp);
    const mg = pat.append('g').attr('opacity', 0.95);
    (MOTIFS[s.motif] || MOTIFS.diamond)(mg, motifColor);
    lastPatternColor[name] = overrideColor || null;
  }

  // which colour a country should currently wear (morphs with filter / timelapse)
  function countryDisplayColor(name) {
    if (HOME_COUNTRIES.has(name)) return countryStyle(name).stroke;
    let key;
    if (timelapseActive && revealedYearByCountry[name] != null) key = revealedYearByCountry[name];
    else if (isolatedKey != null && countryHasKey(name, isolatedKey)) key = isolatedKey;
    else key = countryYear[name] != null ? countryYear[name]
      : [...(countryKeys[name] || [])].find((k) => ERAS[k]);
    return keyColor(key);
  }

  /* =================================================================
     RENDER
     ================================================================= */
  function render() {
    path = d3.geoPath(projection);
    gSphere.attr('d', path({ type: 'Sphere' }));
    gGraticule.attr('d', path(d3.geoGraticule10()));
    gCountries.selectAll('path').attr('d', path);
    positionGlobeTitle();
    renderArcs();
    positionPins();
  }

  // The world-atlas (Natural Earth 110m) hands Crimea to russia. Crimea is
  // Ukraine — so at the TOPOLOGY level remove that polygon from russia and
  // union it into Ukraine, dissolving the shared border so there's no seam.
  // Returns the merged Ukraine geometry (GeoJSON), or null.
  function liberateCrimea(topo) {
    const geoms = topo.objects.countries.geometries;
    const ukrG = geoms.find((g) => g.properties && g.properties.name === 'Ukraine');
    const rusG = geoms.find((g) => g.properties && g.properties.name === 'Russia');
    if (!ukrG || !rusG || rusG.type !== 'MultiPolygon') return null;
    let idx = -1;
    rusG.arcs.forEach((polyArcs, i) => {
      const f = topojson.feature(topo, { type: 'Polygon', arcs: polyArcs });
      const c = d3.geoCentroid(f), a = d3.geoArea(f);
      if (c[0] > 30 && c[0] < 38 && c[1] > 43 && c[1] < 47 && a < 0.01) idx = i;
    });
    if (idx < 0) return null;
    const crimeaArcs = rusG.arcs.splice(idx, 1)[0];     // detach from russia
    // merge dissolves the arc shared between mainland Ukraine and Crimea
    return topojson.merge(topo, [ukrG, { type: 'Polygon', arcs: crimeaArcs }]);
  }

  // Malta is omitted by the 110m map (too small). Inject a small synthetic
  // island so it can be a coloured visited country (slightly exaggerated for
  // visibility, like most small-island map treatments).
  function addMalta() {
    if (countries.some((f) => f.properties.name === 'Malta')) return;
    const lon = 14.45, lat = 35.92, rx = 0.34, ry = 0.40, ring = [];
    // clockwise winding so geoPath fills the small island (not its complement)
    for (let i = 0; i <= 18; i++) {
      const a = -(i / 18) * 2 * Math.PI;
      ring.push([lon + Math.cos(a) * rx, lat + Math.sin(a) * ry]);
    }
    countries.push({ type: 'Feature', properties: { name: 'Malta' },
      geometry: { type: 'Polygon', coordinates: [ring] } });
  }

  // Vatican is its own country but far too small for the basemap — inject it.
  function addVatican() {
    if (countries.some((f) => f.properties.name === 'Vatican')) return;
    const lon = 12.4534, lat = 41.9029, r = 0.16, ring = [];
    for (let i = 0; i <= 16; i++) {
      const a = -(i / 16) * 2 * Math.PI;
      ring.push([lon + Math.cos(a) * r, lat + Math.sin(a) * r]);
    }
    countries.push({ type: 'Feature', properties: { name: 'Vatican' },
      geometry: { type: 'Polygon', coordinates: [ring] } });
  }

  // swap in higher-fidelity outlines (from wanderlust-detail.js) for a few small
  // places: Malta gains its real islands + Comino, Montenegro a detailed coast.
  function applyDetailGeometry() {
    const detail = window.WANDERLUST_DETAIL;
    if (!detail) return;
    Object.entries(detail).forEach(([name, geometry]) => {
      const f = countries.find((c) => c.properties.name === name);
      if (f) f.geometry = geometry;                                  // override
      else countries.push({ type: 'Feature', properties: { name }, geometry }); // or insert
    });
  }

  // drop polygons far from a country's main landmass (overseas territories)
  function trimOutliers(f) {
    const g = f.geometry;
    if (!g || g.type !== 'MultiPolygon' || g.coordinates.length < 2) return;
    const info = g.coordinates.map((p) => {
      const poly = { type: 'Polygon', coordinates: p };
      return { p, c: d3.geoCentroid(poly), a: d3.geoArea(poly) };
    });
    const main = info.reduce((m, x) => (x.a > m.a ? x : m));
    g.coordinates = info.filter((x) => d3.geoDistance(x.c, main.c) < 0.42).map((x) => x.p); // ~24°
  }

  function drawCountries() {
    const visited = new Set(DATA.visitedCountries);
    gCountries.selectAll('path')
      .data(countries)
      .join('path')
      .attr('class', (d) => visited.has(d.properties.name) ? 'country visited' : 'country')
      .attr('d', path);
    // hover ANY country → show its name (visited ones also light their border);
    // click a country → zoom to it (so big targets like Egypt are selectable)
    gCountries.selectAll('path')
      .on('mouseenter', (event, d) => { hoveredCountry = d.properties.name; styleCountries(); showCountryLabel(d); })
      .on('mouseleave', () => { hoveredCountry = null; styleCountries(); hideCountryLabel(); })
      .on('click', (event, d) => {
        event.stopPropagation();
        if (isolatedKey != null) { lockedKey = null; setIsolate(null); }
        flyToCountry(d.properties.name);
      });
    styleCountries();
  }

  let countryLabel = null;
  let countryLabelFeature = null;
  function showCountryLabel(d) {
    if (d.properties.name === focusedCountryName) { hideCountryLabel(); return; }
    if (!countryLabel) { countryLabel = document.createElement('div'); countryLabel.id = 'wl-country-label'; document.body.appendChild(countryLabel); }
    countryLabelFeature = d;
    countryLabel.textContent = dispCountry(d.properties.name);
    countryLabel.classList.toggle('country-russia', isRussia(d.properties.name));
    countryLabel.classList.add('show');
    positionCountryLabel();
  }
  function positionCountryLabel() {
    if (!countryLabel || !countryLabelFeature || !countryLabel.classList.contains('show')) return;
    const d = countryLabelFeature;
    if (d.properties.name === focusedCountryName) { hideCountryLabel(); return; }
    const xy = projection(d3.geoCentroid(d));
    if (!xy) return;
    let x = zoomT.x + zoomT.k * xy[0], y = zoomT.y + zoomT.k * xy[1];
    // if the label is wider/taller than the country on screen, lift it above the
    // shape so the country stays visible (the Dominican Rep. / Malta case)
    const b = path.bounds(d);
    if (isFinite(b[0][0])) {
      const bw = (b[1][0] - b[0][0]) * zoomT.k, bh = (b[1][1] - b[0][1]) * zoomT.k;
      const lw = countryLabel.offsetWidth, lh = countryLabel.offsetHeight;
      if (lw > bw * 0.85 || lh > bh * 0.85) y = (zoomT.y + zoomT.k * b[0][1]) - lh / 2 - 4;
    }
    x = Math.max(70, Math.min(width - 70, x));
    y = Math.max(50, Math.min(height - 60, y));
    countryLabel.style.left = x + 'px';
    countryLabel.style.top = y + 'px';
  }
  function hideCountryLabel() {
    countryLabelFeature = null;
    if (countryLabel) countryLabel.classList.remove('show');
  }

  const countryHasKey = (name, key) => !!(countryKeys[name] && countryKeys[name].has(key));

  // Should a country show its pattern fill right now?
  function patternVisible(name) {
    // Ukraine (home) is always patterned during playback, but a YEAR/era filter
    // must NOT select it — it was never a destination of those trips.
    if (timelapseActive) return name === 'Ukraine' || revealedCountries.has(name);
    if (isolatedKey != null) return countryHasKey(name, isolatedKey);
    return true;
  }

  function tripFromCountry(trip) {
    return countryByCity[trip.from] || null;
  }

  const focusPinKey = (country, city) => `${country || ''}|${city || ''}`;

  function focusContext() {
    if (!focusedCountryName) return null;
    if (!(DATA.visitedCountries || []).includes(focusedCountryName)) return null;
    const pinKeys = new Set();
    pins.forEach((p) => {
      if (p.country === focusedCountryName) pinKeys.add(focusPinKey(p.country, p.city));
    });
    DATA.trips.forEach((trip) => {
      const from = tripFromCountry(trip);
      const touchesFocus = from === focusedCountryName || trip.country === focusedCountryName;
      if (!touchesFocus) return;
      const fromPin = cityPinByName[trip.from];
      if (fromPin) pinKeys.add(focusPinKey(fromPin.country, fromPin.city));
      pinKeys.add(focusPinKey(trip.country, trip.city));
    });
    return { country: focusedCountryName, pinKeys };
  }

  function countryContextDimmed(name) {
    const ctx = focusContext();
    return !!ctx && name !== ctx.country;
  }

  function arcContextDimmed(a) {
    const ctx = focusContext();
    if (!ctx) return false;
    return tripFromCountry(a.trip) !== ctx.country && a.trip.country !== ctx.country;
  }

  function pinContextDimmed(p) {
    const ctx = focusContext();
    return !!ctx && !ctx.pinKeys.has(focusPinKey(p.country, p.city));
  }

  // Single source of truth for visited-country fill / outline / glow.
  function styleCountries() {
    gCountries.selectAll('path.country:not(.visited)').each(function (d) {
      d3.select(this)
        .style('opacity', null)
        .style('filter', null);
    });
    gCountries.selectAll('path.visited').each(function (d) {
      const name = d.properties.name;
      const sel = d3.select(this);
      const dim = countryContextDimmed(name);
      if (!patternVisible(name)) {                        // plain background, no pattern/glow
        sel.style('fill', null).style('stroke', null)
           .style('stroke-width', null).style('filter', dim ? FOCUS_DIM.countryFilter : null)
           .style('opacity', dim ? FOCUS_DIM.countryOpacity : null);
        return;
      }
      // active colour morphs with the filter / timelapse; repaint the pattern
      // only when its colour actually changes (home countries never morph)
      const col = countryDisplayColor(name);
      if (!HOME_COUNTRIES.has(name)) {
        const norm = (isolatedKey == null && !timelapseActive) ? null : col; // null = default latest year
        if (lastPatternColor[name] !== norm) paintPattern(name, norm);
      }
      const strong = (isolatedKey != null && countryHasKey(name, isolatedKey))
        || detailCountryName() === name || hoveredCountry === name;
      sel.style('fill', `url(#${patId(name)})`)
        .style('stroke', strong ? col : lighten(col, 0.35))
        .style('stroke-width', strong ? 2.6 : 1.5)
        .style('opacity', dim ? FOCUS_DIM.countryOpacity : null)
        .style('filter', dim ? FOCUS_DIM.countryFilter : strong ? `drop-shadow(0 0 6.5px ${hexToRgba(col, .82)})` : null);
    });
  }
  // back-compat alias (older call sites)
  const updateCountryHighlight = styleCountries;

  /* ---- arcs ----
     Screen-space quadratic-bézier bows (one per leg through any via points),
     with a perpendicular "lift" that scales with distance — so short hops
     (Georgia↔Turkey) stay flat & natural while long hauls sweep. On the globe
     an arc hides once an endpoint passes the horizon. */
  function onFront(coords, center) { return d3.geoDistance(coords, center) <= Math.PI / 2 - GLOBE_FRONT_MARGIN; }

  // waypoints for an arc: from → (via…) → destination
  function arcWaypoints(a) {
    const wp = [a.fromCoords];
    if (a.trip.via) a.trip.via.forEach((v) => wp.push(v));
    wp.push(a.trip.coords);
    return wp;
  }

  function arcPathD(a) {
    const wp = arcWaypoints(a);
    if (isGlobe) {
      const r = projection.rotate(), center = [-r[0], -r[1]];
      if (!onFront(wp[0], center) || !onFront(wp[wp.length - 1], center)) return null;
    }
    const P = wp.map((c) => projection(c));
    if (P.some((p) => !p)) return null;
    let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
    for (let i = 0; i < P.length - 1; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[i + 1];
      const dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy) || 1;
      let nx = -dy / dist, ny = dx / dist;
      if (ny > 0) { nx = -nx; ny = -ny; }   // bow "up"
      // distance-proportional lift, low floor → short legs look natural.
      // ground routes stay nearly flat (just enough bow so a fan separates).
      const lift = a.ground
        ? Math.min(dist * 0.08, 16) * (1 + a.routeIndex * 0.6)
        : Math.min(Math.max(dist * 0.30, 4), 260) * (1 + a.routeIndex * 0.45);
      const cx = (x0 + x1) / 2 + nx * lift, cy = (y0 + y1) / 2 + ny * lift;
      d += ` Q${cx.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return d;
  }

  function buildArcs() {
    gArcs.selectAll('*').remove();
    arcEls.length = 0;
    const routeCount = {};
    const groundSet = DATA.groundRoutes || [];
    DATA.trips.forEach((trip) => {
      const key = trip.from + '→' + trip.city;
      const routeIndex = routeCount[key] = (routeCount[key] || 0);
      routeCount[key]++;
      const ground = !!trip.ground || groundSet.includes(key);   // road/train/boat → dotted, flat
      const col = markColor(trip);   // complement for years, faint pink for pre-2014
      const el = gArcs.append('path')
        .attr('class', ground ? 'arc ground' : 'arc')
        .attr('stroke', col)
        .style('color', col); // drop-shadow uses currentColor
      arcEls.push({ el, trip, fromCoords: getCoords(trip.from), routeIndex, ground });
    });
  }

  function arcVisible(a) {
    if (a.trip.focusOnly && timelapseActive) return false;
    if (a.trip.focusOnly && detailCountryName() !== a.trip.country) return false;
    if (timelapseActive) return !!a.revealed;
    if (isolatedKey != null) return itemKey(a.trip) === isolatedKey;   // filter: only that key's arcs
    return true;
  }

  function renderArcs() {
    arcEls.forEach((a) => {
      const d = arcPathD(a);
      if (!d || !arcVisible(a)) { a.el.attr('d', d || null).style('opacity', 0); return; }
      const dim = arcContextDimmed(a);
      a.el.attr('d', d)
        .style('opacity', dim ? FOCUS_DIM.arcOpacity : 1)
        .style('filter', dim ? FOCUS_DIM.arcFilter : null);
    });
  }

  /* ink-flowing arc draw — single reusable helper used by the intro,
     the full-journey timelapse, AND each manual timeline step so the
     feel is identical everywhere. Duration auto-scales with path length
     (≥0.9s, ≤2s) so long hauls have time to read and short hops don't
     drag. easeCubicInOut gives the slow start → smoother middle → gentle
     settle that makes it feel like ink flowing onto the page (vs. the
     prior fixed 820ms which was abrupt on long arcs). Returns the chosen
     duration so callers can chain follow-ups (pin land, country fade) off
     the same clock. */
  function drawArc(a, durHint) {
    const d = arcPathD(a);
    if (!d || !arcVisible(a)) {
      a.el.interrupt()
        .attr('stroke-dasharray', null)
        .attr('stroke-dashoffset', null)
        .attr('d', d || null)
        .style('opacity', 0);
      return 0;
    }
    if (a.ground) {
      // dotted line — fade it in so the dash pattern stays the dotted motif
      // (an ink-draw mask would fight the CSS dash-array). Keep dasharray null.
      const dur = durHint != null ? durHint : 700;
      a.el.interrupt().attr('d', d).attr('stroke-dasharray', null)
          .style('filter', arcContextDimmed(a) ? FOCUS_DIM.arcFilter : null)
          .style('opacity', 0)
        .transition().duration(dur).style('opacity', arcContextDimmed(a) ? FOCUS_DIM.arcOpacity : 1);
      return dur;
    }
    a.el.interrupt().attr('d', d)
      .style('opacity', arcContextDimmed(a) ? FOCUS_DIM.arcOpacity : 1)
      .style('filter', arcContextDimmed(a) ? FOCUS_DIM.arcFilter : null);
    const len = a.el.node().getTotalLength();
    const dur = durHint != null ? durHint : Math.max(900, Math.min(len * 1.4, 2000));
    a.el.attr('stroke-dasharray', len)
        .attr('stroke-dashoffset', len)
      .transition().duration(dur).ease(d3.easeCubicInOut)
        .attr('stroke-dashoffset', 0)
        .on('end', () => a.el.attr('stroke-dasharray', null));
    return dur;
  }
  function arcDrawDuration(a) {
    const d = arcPathD(a);
    if (!d || !arcVisible(a)) return 0;
    if (a.ground) return 700;
    a.el.attr('d', d);
    const len = a.el.node().getTotalLength();
    return Math.max(900, Math.min(len * 1.4, 2000));
  }
  // back-compat alias — existing call sites pass an explicit duration
  function animateArc(a, dur) { return drawArc(a, dur); }

  function showAllArcs() {
    arcEls.forEach((a) => {
      const d = arcPathD(a);
      a.el.interrupt()
        .attr('stroke-dasharray', null)
        .attr('stroke-dashoffset', null)
        .attr('d', d)
        .style('filter', arcContextDimmed(a) ? FOCUS_DIM.arcFilter : null)
        .style('opacity', (d && arcVisible(a)) ? (arcContextDimmed(a) ? FOCUS_DIM.arcOpacity : 1) : 0);
    });
  }

  /* =================================================================
     PINS  (HTML overlay so we get crisp images, badges, hover popups)
     ================================================================= */
  // icons drawn in a 24×24 box, visually centred on (12,12); colourable
  const ICONS = {
    star: (c) => `<path d="M12 3 L14.6 9.2 L21.3 9.7 L16.1 14 L17.8 20.6 L12 16.9 L6.2 20.6 L7.9 14 L2.7 9.7 L9.4 9.2 Z" fill="${c}"/>`,
    home: (c) => `<path d="M3.5 12 L12 4.5 L20.5 12 M6 10.5 V19.5 H18 V10.5 M9.6 19.5 V14.2 H14.4 V19.5" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`,
  };

  function hexLum(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const iconColor = (bg) => (hexLum(bg) > 150 ? '#001219' : '#fdf6e3');

  // ball-headed pushpin (round bead on a thin needle), like the shared icon;
  // bead is the year colour. Tip anchored at (16,49).
  function pinSvg(color, badge) {
    let inner;
    if (badge) {
      const s = 0.64, tx = 16 - 12 * s, ty = 15 - 12 * s;     // centre icon on the bead
      inner = `<g transform="translate(${tx},${ty}) scale(${s})">${ICONS[badge](iconColor(color))}</g>`;
    } else {
      inner = `<circle cx="16" cy="15" r="8" fill="none" stroke="${iconColor(color)}" stroke-width="1.5" opacity="0.85"/>
               <circle cx="16" cy="15" r="2.1" fill="${iconColor(color)}" opacity="0.9"/>`;
    }
    return `
      <svg viewBox="0 0 32 55" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M14.2 24 L17.8 24 L16 54 Z" fill="#5b656e" stroke="#11151a" stroke-width="0.5"/>
        <path d="M16 26 L16 52" stroke="#cdd4d9" stroke-width="0.8" opacity="0.65" stroke-linecap="round"/>
        <circle cx="16" cy="15" r="12.6" fill="${color}" stroke="#001219" stroke-width="1.6"/>
        <ellipse cx="11.4" cy="10.4" rx="3.6" ry="2.3" fill="#ffffff" opacity="0.33" transform="rotate(-30 11.4 10.4)"/>
        ${inner}
      </svg>`;
  }

  function pinImg(color, badge) {
    // tint img/pin.png via CSS mask; overlay a centred badge if present
    const badgeSvg = badge
      ? `<svg class="pin-badge" viewBox="0 0 24 24">${ICONS[badge](iconColor(color))}</svg>`
      : '';
    return `<span class="pin-img" style="
        -webkit-mask:url('../img/pin.png') center/contain no-repeat;
        mask:url('../img/pin.png') center/contain no-repeat;
        background:${color};display:block;"></span>${badgeSvg}`;
  }

  function pinMarkup(color, badge) {
    return usePinImage ? pinImg(color, badge) : pinSvg(color, badge);
  }

  function makePins() {
    pinLayer = $('#wl-pins');
    pinLayer.innerHTML = '';
    pins.length = 0;
    cityPinByName = {};

    const markerSortDate = (m) => {              // when a marker appears on the timeline
      if (m.year) return m.year + '-06-01';
      const y = (m.date || '').match(/\d{4}/);
      if (y) return y[0] + '-06-01';
      if (m.era === 'pre2014') return '2010-06-01';
      return '1990-01-01';                       // undated → present from the start
    };

    const add = (o) => {
      const el = document.createElement('div');
      el.className = 'pin';
      if (o.focusOnly) el.classList.add('focus-only');
      el.innerHTML = pinMarkup(o.color, o.badge)
        + `<span class="pin-label">${dispCity(o.city)}</span>`;
      pinLayer.appendChild(el);
      const entry = { el, coords: o.coords, city: o.city, country: o.country,
                      hello: o.hello, kind: o.kind, visits: o.visits || [],
                      keys: o.keys || [], alwaysShow: !!o.alwaysShow, date: o.date,
                      focusOnly: !!o.focusOnly,
                      population: populationFor(o.city, o.country),
                      sortDate: o.sortDate, badge: o.badge || null,
                      defaultColor: o.color, currentColor: o.color };
      pins.push(entry);
      cityPinByName[o.city] = entry;
      attachPopup(entry);
      return entry;
    };

    // home / anchor pins (star = hometown, home = lived-in) — always shown.
    // include any trips that ARRIVE here so the move-in shows in the popup;
    // keys span BOTH arrivals and departures so a year filter only lights an
    // anchor in the years it actually took part in (e.g. Kraków = 2022/2023,
    // not 2014). Lviv departs in most years, so it stays lit for those.
    Object.values(DATA.places).forEach((pl) => {
      const arrivals = DATA.trips.filter((t) => t.city === pl.city);
      const departures = DATA.trips.filter((t) => t.from === pl.city);
      add({
        coords: pl.coords, color: pl.icon === 'star' ? '#ffd700' : '#94d2bd',
        badge: pl.icon, city: pl.city, country: pl.country, hello: pl.hello,
        kind: pl.icon === 'star' ? 'origin' : 'home', alwaysShow: true,
        visits: arrivals, keys: arrivals.concat(departures).map(itemKey),
      });
    });

    // destination pins — one per city (deduped), coloured by latest visit
    const placeCities = new Set(Object.values(DATA.places).map((p) => p.city));
    const byCity = {};
    DATA.trips.forEach((t) => {
      if (placeCities.has(t.city)) return;        // already a home pin
      (byCity[t.city] = byCity[t.city] || []).push(t);
    });
    Object.entries(byCity).forEach(([city, visits]) => {
      const latest = visits.slice().sort((a, b) => (b.year || 0) - (a.year || 0))[0];
      const badged = visits.find((v) => v.icon);   // e.g. Uray carries a home icon
      add({
        coords: latest.coords, color: markColor(latest), badge: badged ? badged.icon : null,
        city, country: latest.country, hello: latest.hello,
        kind: 'trip', visits, keys: visits.map(itemKey),
        focusOnly: visits.every((v) => v.focusOnly),
      });
    });

    // standalone markers (no arc) — Ukrainian domestic + pre-2014 places
    (DATA.markers || []).forEach((m) => add({
      coords: m.coords, color: markColor(m), badge: null,
      city: m.city, country: m.country, hello: m.hello, kind: 'marker',
      visits: [{ from_date: m.date || '', to_date: m.date || '', purpose: '', year: m.year, era: m.era }],
      keys: itemKey(m) != null ? [itemKey(m)] : [], date: m.date, sortDate: markerSortDate(m),
    }));
    applyPinColors();
  }

  // sea / ocean labels — appear when zoomed in
  let seaLayer = null;
  const seaEls = [];
  function makeSeas() {
    seaLayer = document.createElement('div');
    seaLayer.id = 'wl-seas';
    document.body.appendChild(seaLayer);
    (DATA.seas || []).forEach((s) => {
      const el = document.createElement('div');
      el.className = 'sea-label';
      el.textContent = dispSea(s.name);
      seaLayer.appendChild(el);
      seaEls.push({ el, name: s.name, coords: s.coords, minK: s.minK || 2.2 });
    });
  }
  function positionSeas() {
    if (!seaEls.length) return;
    const r = projection.rotate(), center = [-r[0], -r[1]];
    seaEls.forEach((s) => {
      const xy = projection(s.coords);
      let vis = zoomT.k >= s.minK && !!xy;     // tiered: more seas appear as you zoom in
      if (vis && isGlobe) vis = d3.geoDistance(s.coords, center) <= Math.PI / 2 - GLOBE_FRONT_MARGIN;
      s.el.classList.toggle('show', vis);
      if (vis) {
        s.el.style.left = (zoomT.x + zoomT.k * xy[0]) + 'px';
        s.el.style.top = (zoomT.y + zoomT.k * xy[1]) + 'px';
      }
    });
  }

  /* The "wanderlust" title: shown big & centred at start, then sailed into the
     empty mid-Atlantic (between Morocco & Cuba) where it becomes a map-anchored
     label — it pans/zooms with the map and, on the globe, hides when that patch
     of ocean rotates to the back. */
  const ATLANTIC = [-43, 30];
  const GLOBE_TITLE_TEXT = 'wanderlust';
  const GLOBE_TITLE_POINTS = GLOBE_TITLE_TEXT.split('').map((letter, i, arr) => {
    const t = i - (arr.length - 1) / 2;
    return { letter, coords: [ATLANTIC[0] + t * 4.1, ATLANTIC[1] - Math.abs(t) * 0.22] };
  });
  let wlTitle = null, titleMounted = false;
  function positionTitle() {
    if (!titleMounted) return;
    if (!wlTitle) wlTitle = $('.wl-title');
    if (!wlTitle) return;
    if (isGlobe) {
      wlTitle.classList.add('gone');
      positionGlobeTitle();
      return;
    }
    const xy = projection(ATLANTIC);
    let vis = !!xy;
    wlTitle.classList.toggle('gone', !vis);
    if (vis) {
      wlTitle.style.setProperty('--wl-title-scale', Math.min(Math.max(zoomT.k, 1), 10));
      wlTitle.style.left = (zoomT.x + zoomT.k * xy[0]) + 'px';
      wlTitle.style.top  = (zoomT.y + zoomT.k * xy[1]) + 'px';
    }
    positionGlobeTitle();
  }
  function positionGlobeTitle() {
    if (!gGlobeTitle) return;
    if (!titleMounted || !isGlobe) {
      gGlobeTitle.selectAll('text').remove();
      gGlobeTitle.classed('show', false);
      return;
    }
    const rotate = projection.rotate();
    const center = [-rotate[0], -rotate[1]];
    gGlobeTitle.classed('show', true);
    const letters = gGlobeTitle.selectAll('text').data(GLOBE_TITLE_POINTS);
    letters.enter().append('text')
      .attr('class', 'globe-title-letter')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .merge(letters)
      .text((d) => d.letter)
      .attr('x', 0)
      .attr('y', 0)
      .attr('transform', (d) => {
        const p0 = projection(d.coords);
        const p1 = projection([d.coords[0] + 0.8, d.coords[1]]);
        if (!p0 || !p1) return null;
        const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI;
        const dist = d3.geoDistance(d.coords, center);
        const scale = Math.max(0.72, Math.cos(Math.min(dist, Math.PI / 2)) * 0.75 + 0.42);
        return `translate(${p0[0]} ${p0[1]}) rotate(${angle}) scale(${scale})`;
      })
      .style('opacity', (d) => d3.geoDistance(d.coords, center) <= Math.PI / 2 - GLOBE_FRONT_MARGIN ? 1 : 0);
    letters.exit().remove();
  }
  function mountTitle() {
    if (!wlTitle) wlTitle = $('.wl-title');
    if (!wlTitle || titleMounted) return;
    titleMounted = true;
    wlTitle.classList.add('mounted');                 // CSS animates size + position
    positionTitle();                                   // → glides to the Atlantic anchor
    setTimeout(forceTitleTracking, TITLE_MOUNT_MS); // then snap-track live
  }
  function forceTitleTracking() {
    if (!wlTitle) wlTitle = $('.wl-title');
    if (!wlTitle || !titleMounted) return;
    wlTitle.classList.add('tracking');
    positionTitle();
  }

  // a multi-year pin morphs to the active filter's colour (e.g. Paris → 2018 or 2019)
  function pinColorFor(entry) {
    if (entry.kind === 'origin' || entry.kind === 'home') return entry.defaultColor;
    if (isolatedKey != null && (entry.keys || []).includes(isolatedKey))
      return markColor(ERAS[isolatedKey] ? { era: isolatedKey } : { year: isolatedKey });
    return entry.defaultColor;
  }
  function applyPinColors() {
    pins.forEach((entry) => {
      const c = beadColor(pinColorFor(entry), entry.country);
      if (c === entry.currentColor) return;
      entry.currentColor = c;
      entry.el.innerHTML = pinMarkup(c, entry.badge)
        + `<span class="pin-label">${dispCity(entry.city)}</span>`;
    });
  }

  function positionPins() {
    const r = projection.rotate();
    const center = [-r[0], -r[1]];
    const showLabels = showCityNames && zoomT.k >= 3.2; // reveal city names when enabled + zoomed in
    const shown = [];
    pins.forEach((p) => {
      if (p.suppressed) { p.el.style.display = 'none'; return; }    // timelapse: not yet arrived
      if (p.focusOnly && timelapseActive) { p.el.style.display = 'none'; return; }
      if (p.focusOnly && detailCountryName() !== p.country) { p.el.style.display = 'none'; return; }
      p.el.style.display = '';
      const xy = projection(p.coords);
      let visible = !!xy;
      if (visible && isGlobe) {
        visible = d3.geoDistance(p.coords, center) <= Math.PI / 2 - GLOBE_FRONT_MARGIN;
      }
      if (!visible) { p.el.classList.add('hidden'); return; }
      p.el.classList.remove('hidden');
      // year filter fades non-matching pins but keeps them clickable
      const contextDim = pinContextDimmed(p);
      p.el.classList.toggle('context-dim', contextDim);
      let pinOpacity = (isolatedKey != null && !pinMatches(p)) ? 0.35 : 1;
      if (contextDim) pinOpacity *= FOCUS_DIM.pinOpacity;
      p.el.style.opacity = pinOpacity;
      const sx = zoomT.x + zoomT.k * xy[0], sy = zoomT.y + zoomT.k * xy[1];
      p.el.style.left = sx + 'px';
      p.el.style.top  = sy + 'px';
      shown.push({ p, sx, sy });
    });
    fanClusters(shown);
    // labels only for zoomed-in, non-clustered pins; then de-conflict overlaps,
    // keeping the higher-priority pin's label (anchors / badged / bigger cities
    // win — so "Uray" beats "Mezhdurechensky" when their labels collide).
    shown.forEach((s) => s.p.el.classList.remove('show-label'));
    const pinsHidden = !!(pinLayer && pinLayer.classList.contains('pins-hidden'));
    const prio = (p) => (p.kind === 'origin' ? 5 : (p.badge || p.kind === 'home') ? 4 : p.kind === 'marker' ? 1 : 2)
                        + Math.min(0.9, (p.population || 0) / 3e6);
    const rectsOverlap = (a, b, pad = 0) => !(a.x1 + pad < b.x0 || a.x0 - pad > b.x1 || a.y1 + pad < b.y0 || a.y0 - pad > b.y1);
    const labelHeight = 18;
    const headRect = (s) => {
      const small = !!s.p.focusOnly;
      const rx = small ? 13 : 18;
      const top = s.sy - (small ? 34 : 48);
      const bottom = s.sy - (small ? 10 : 14);
      return { x0: s.sx - rx, y0: top, x1: s.sx + rx, y1: bottom, pr: prio(s.p), p: s.p };
    };
    const pinHeads = shown.map(headRect);
    const placed = [];
    shown.filter((s) => showLabels && (!s.p._fan || s.p.kind === 'origin' || s.p.kind === 'home' || s.p.badge))
      .map((s) => {
        const w = dispCity(s.p.city).length * 7 + 16;
        const cx = s.sx;
        const cy = s.sy - (pinsHidden ? 17 : 52);
        return { s, w, cx, cy, pr: prio(s.p), rect: { x0: cx - w / 2, y0: cy - labelHeight / 2, x1: cx + w / 2, y1: cy + labelHeight / 2 } };
      })
      .sort((a, b) => b.pr - a.pr)
      .forEach((c) => {
        const labelClash = placed.some((b) => rectsOverlap(c.rect, b.rect, 3));
        const pinClash = !pinsHidden && pinHeads.some((h) => h.p !== c.s.p && h.pr >= c.pr && rectsOverlap(c.rect, h, 2));
        const clash = labelClash || pinClash;
        if (!clash) { placed.push(c); c.s.p.el.classList.add('show-label'); }
      });
    if (popup.classList.contains('show') && popup.__owner) repositionPopup(popup.__owner);
    positionSeas();
    positionTitle();
    positionCountryLabel();
    refreshMeasure();
  }

  /* ---- distance measure tool ---- */
  function toggleMeasure() {
    measureMode = !measureMode;
    const btn = $('#wl-measure-btn'); if (btn) btn.classList.toggle('active', measureMode);
    if (!measureOverlay) {
      measureOverlay = document.createElement('div');
      measureOverlay.id = 'wl-measure-overlay';
      document.body.appendChild(measureOverlay);
      document.addEventListener('pointerdown', onMeasurePointerDown, true);
      document.addEventListener('pointermove', onMeasurePointerMove, true);
      document.addEventListener('pointerup', onMeasurePointerUp, true);
      document.addEventListener('pointercancel', onMeasurePointerCancel, true);
      document.addEventListener('click', onMeasureClick, true);
    }
    document.body.classList.toggle('measure-mode', measureMode);
    measureOverlay.classList.toggle('active', measureMode);
    if (!measureMode) { measurePointer = null; clearMeasure(); }
  }

  function measureIgnoresTarget(target) {
    return !!(target && target.closest && target.closest([
      '#wl-controls',
      '#wl-left-ui',
      '#wl-info-btn',
      '#wl-info-panel',
      '#wl-stats-panel',
      '#wl-countries-panel',
      '#wl-europe-panel',
      '#wl-timeline',
      '#wl-popup',
      '.av-monogram',
    ].join(',')));
  }

  function onMeasurePointerDown(e) {
    if (!measureMode || e.button !== 0 || measureIgnoresTarget(e.target)) { measurePointer = null; return; }
    measurePointer = { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false };
  }

  function onMeasurePointerMove(e) {
    if (!measureMode || !measurePointer || e.pointerId !== measurePointer.id) return;
    const dx = e.clientX - measurePointer.x;
    const dy = e.clientY - measurePointer.y;
    if (Math.hypot(dx, dy) > 5) measurePointer.dragged = true;
  }

  function onMeasurePointerUp(e) {
    if (!measureMode || !measurePointer || e.pointerId !== measurePointer.id) return;
    measureLastRelease = { x: e.clientX, y: e.clientY, dragged: measurePointer.dragged, time: performance.now() };
    measurePointer = null;
  }

  function onMeasurePointerCancel() {
    measurePointer = null;
    measureLastRelease = { dragged: true, time: performance.now() };
  }

  function onMeasureClick(e) {
    if (!measureMode || measureIgnoresTarget(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const release = measureLastRelease;
    if (release && release.dragged && performance.now() - release.time < 700) return;
    addMeasurePoint(e.clientX, e.clientY);
  }

  function addMeasurePoint(x, y) {
    if (measurePts.length >= 2) clearMeasure();
    const ll = projection.invert(unzoom([x, y]));
    if (ll) { measurePts.push(ll); refreshMeasure(); }
  }
  function clearMeasure() {
    measurePts = [];
    if (gMeasure) gMeasure.selectAll('*').remove();
    if (measureLabel) measureLabel.classList.remove('show');
  }
  function refreshMeasure() {
    if (!gMeasure || !measurePts.length) { if (measureLabel) measureLabel.classList.remove('show'); return; }
    gMeasure.selectAll('.measure-dot').remove();
    measurePts.forEach((ll) => {
      const p = projection(ll);
      if (p) gMeasure.append('circle').attr('class', 'measure-dot').attr('r', 3.2 / zoomT.k).attr('cx', p[0]).attr('cy', p[1]);
    });
    if (measurePts.length === 2) {
      const interp = d3.geoInterpolate(measurePts[0], measurePts[1]);
      const line = { type: 'LineString', coordinates: d3.range(0, 1.0001, 1 / 40).map(interp) };
      let lp = gMeasure.select('.measure-line');
      if (lp.empty()) lp = gMeasure.insert('path', ':first-child').attr('class', 'measure-line');
      lp.attr('d', path(line));
      if (!measureLabel) { measureLabel = document.createElement('div'); measureLabel.id = 'wl-measure-label'; document.body.appendChild(measureLabel); }
      const km = d3.geoDistance(measurePts[0], measurePts[1]) * 6371;
      measureLabel.textContent = Math.round(km).toLocaleString() + ' km';
      const mid = projection(interp(0.5));
      if (mid) {
        measureLabel.style.left = (zoomT.x + zoomT.k * mid[0]) + 'px';
        measureLabel.style.top = (zoomT.y + zoomT.k * mid[1]) + 'px';
        measureLabel.classList.add('show');
      }
    }
  }

  // pins whose tips land close together fan out around their shared point
  // (like a real stack of pins), instead of overlapping
  function fanClusters(shown) {
    shown.forEach((s) => { s.fan = 0; });
    const used = new Array(shown.length).fill(false);
    for (let i = 0; i < shown.length; i++) {
      if (used[i]) continue;
      const group = [i];
      for (let j = i + 1; j < shown.length; j++) {
        if (used[j]) continue;
        if (Math.hypot(shown[j].sx - shown[i].sx, shown[j].sy - shown[i].sy) < 24) { group.push(j); used[j] = true; }
      }
      if (group.length > 1) {
        const n = group.length, spread = Math.min(20, 54 / n);
        group.forEach((gi, k) => {
          if (!shown[gi].p.focusOnly) shown[gi].fan = (k - (n - 1) / 2) * spread;
        });
      }
    }
    shown.forEach((s) => {                       // only write on change (avoid transition thrash)
      const want = Math.round(s.fan);
      if (s.p._fan === want) return;
      s.p._fan = want;
      if (want) s.p.el.style.setProperty('--fan', want + 'deg');
      else s.p.el.style.removeProperty('--fan');
    });
  }

  /* =================================================================
     POPUP + SPEECH
     ================================================================= */
  let hideTimer = null;
  let focusedPin = null;
  let focusedCountryName = null;
  let autoDetailCountryName = null;
  let playbackDetailCountryName = null;
  function cancelHide() { clearTimeout(hideTimer); hideTimer = null; }
  function scheduleHide() { cancelHide(); hideTimer = setTimeout(hidePopup, 260); }
  const detailCountryName = () => focusedCountryName || playbackDetailCountryName || autoDetailCountryName;

  function syncAutoDetailCountry() {
    const previous = autoDetailCountryName;
    autoDetailCountryName = null;
    if (!focusedCountryName && !isGlobe && zoomT.k >= 6) {
      const detailCountries = [...new Set(pins.filter((p) => p.focusOnly).map((p) => p.country))];
      const screenCenter = [width / 2, height * 0.46];
      const centerGeo = projection.invert(unzoom(screenCenter));
      let best = null;
      detailCountries.forEach((name) => {
        const feat = countries.find((f) => f.properties.name === name);
        const localPins = pins.filter((p) => p.focusOnly && p.country === name);
        if (!localPins.length) return;
        const containsCenter = !!(feat && centerGeo && d3.geoContains(feat, centerGeo));
        let nearest = Infinity;
        localPins.forEach((p) => {
          const xy = projection(p.coords);
          if (!xy) return;
          const sx = zoomT.x + zoomT.k * xy[0];
          const sy = zoomT.y + zoomT.k * xy[1];
          nearest = Math.min(nearest, Math.hypot(sx - screenCenter[0], sy - screenCenter[1]));
        });
        const radius = Math.max(150, Math.min(320, 70 + zoomT.k * 5));
        if ((containsCenter || nearest <= radius) && (!best || nearest < best.dist)) best = { name, dist: nearest };
      });
      autoDetailCountryName = best ? best.name : null;
    }
    if (previous !== autoDetailCountryName) {
      styleCountries();
      renderArcs();
    }
  }

  function attachPopup(entry) {
    entry.el.addEventListener('mouseenter', () => {
      cancelHide(); showPopup(entry);
      // also surface the country name + glow while hovering the pin
      hoveredCountry = entry.country; styleCountries();
      const feat = countries.find((f) => f.properties.name === entry.country);
      if (feat) showCountryLabel(feat);
    });
    entry.el.addEventListener('mouseleave', () => {
      scheduleHide(); hoveredCountry = null; styleCountries(); hideCountryLabel();
    });
    // click → open popup + zoom so the country fills the view (click again = out).
    // Selecting a pin also clears any active year filter.
    entry.el.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelHide();
      if (isolatedKey != null) { lockedKey = null; setIsolate(null); }
      showPopup(entry);
      flyToPin(entry);
      focusedPin = entry;
    });
  }

  // zoom/pan so the selected country fills ~70% of the screen (or zoom hard onto
  // the city for tiny places). Pin a little above middle, clear of the legend.
  function flyToPin(entry) {
    if (!zoom) return;
    focusedCountryName = entry.country;
    autoDetailCountryName = null;
    playbackDetailCountryName = null;
    hideCountryLabel();
    showCountryInfo(entry);
    styleCountries();
    renderArcs();
    if (isGlobe) {
      rotateGlobeToCoords([entry.coords], 700);
      return;
    }
    const feat = countries.find((f) => f.properties.name === entry.country);
    let k, cx, cy;
    const b = feat ? path.bounds(feat) : null;            // base (unzoomed) screen bounds
    if (b && isFinite(b[0][0])) {
      const bw = Math.max(b[1][0] - b[0][0], 1), bh = Math.max(b[1][1] - b[0][1], 1);
      k = focusZoomForBounds(bw, bh, entry.country);
      cx = (b[0][0] + b[1][0]) / 2; cy = (b[0][1] + b[1][1]) / 2;
    } else {
      const xy = projection(entry.coords); if (!xy) return;
      k = 4.5; cx = xy[0]; cy = xy[1];
    }
    const tx = width / 2 - k * cx, ty = height * 0.46 - k * cy;
    svg.transition().duration(800).ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  function focusZoomForBounds(bw, bh, country) {
    const base = Math.min(width / bw, height / bh);
    const longest = Math.max(bw, bh);
    const hasLocalPins = pins.some((p) => p.focusOnly && p.country === country);
    if (hasLocalPins) return Math.max(1, Math.min(base * 0.82, MAX_ZOOM));
    if (longest < 18) return Math.max(1, Math.min(base * 0.74, 34));
    if (longest < 42) return Math.max(1, Math.min(base * 0.66, 18));
    return Math.max(1, Math.min(base * 0.55, 7));
  }

  // zoom to a country by name (clicking the country body)
  function flyToCountry(name) {
    if (!zoom) return;
    const feat = countries.find((f) => f.properties.name === name);
    if (!feat) return;
    focusedCountryName = name;
    autoDetailCountryName = null;
    playbackDetailCountryName = null;
    hideCountryLabel();
    showCountryInfo(name);
    styleCountries();
    renderArcs();
    if (isGlobe) {
      const centroid = d3.geoCentroid(feat);
      rotateGlobeToCoords([centroid], 700);
      return;
    }
    const b = path.bounds(feat);
    if (!isFinite(b[0][0])) return;
    const bw = Math.max(b[1][0] - b[0][0], 1), bh = Math.max(b[1][1] - b[0][1], 1);
    const k = focusZoomForBounds(bw, bh, name);
    const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
    svg.transition().duration(800).ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity.translate(width / 2 - k * cx, height * 0.46 - k * cy).scale(k));
  }

  function flyOut() {
    if (!zoom) return;
    focusedCountryName = null;
    autoDetailCountryName = null;
    playbackDetailCountryName = null;
    clearCountryInfo();
    if (typeof updateCountryHighlight === 'function') updateCountryHighlight();
    renderArcs();
    svg.transition().duration(600).ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity);
  }

  // moving the cursor onto the popup keeps it open (so the play button is reachable)
  function wirePopupHover() {
    popup.addEventListener('mouseenter', cancelHide);
    popup.addEventListener('mouseleave', scheduleHide);
  }

  function repositionPopup(entry) {
    const xy = projection(entry.coords);
    if (!xy) return;
    popup.style.left = (zoomT.x + zoomT.k * xy[0]) + 'px';
    popup.style.top  = (zoomT.y + zoomT.k * xy[1] - 44) + 'px';  // above the pin head
  }

  function showPopup(entry) {
    const xy = projection(entry.coords);
    if (!xy) return;
    popup.__owner = entry;
    const populationHtml = entry.population != null
      ? `<div class="pop-population">${t('population')}: ${formatPopulation(entry.population)}</div>`
      : '';
    let metaHtml = '';
    if (entry.kind === 'origin') metaHtml = `<div class="pop-meta">${t('hometown')}</div>`;
    else if (entry.kind === 'home') metaHtml = `<div class="pop-meta">${t('home')}</div>`;
    if (entry.visits && entry.visits.length) {
      const items = entry.visits.slice()
        .sort((a, b) => String(a.from_date).localeCompare(String(b.from_date)))
        .map((v) => {
          const key = v.era || v.year;
          const label = v.from_date ? (v.to_date && v.to_date !== v.from_date
            ? `${fmt(v.from_date)}–${fmt(v.to_date)}` : fmt(v.from_date))
            : (v.era ? keyLabel(v.era) : '');
          const purpose = v.purpose ? ` · ${dispPurpose(v.purpose)}` : '';
          return label || purpose
            ? `<div class="pop-visit"><span class="pop-dot" style="background:${keyColor(key)}"></span>${label}${purpose}</div>`
            : '';
        }).join('');
      if (items) metaHtml += `<div class="pop-visits">${items}</div>`;
    }
    popup.innerHTML = `
      <div class="pop-city">${dispCity(entry.city)}</div>
      <div class="pop-country${countryNameClass(entry.country)}">${dispCountry(entry.country)}</div>
      ${populationHtml}
      ${metaHtml}`;
    repositionPopup(entry);
    popup.classList.add('show');
  }

  function hidePopup() {
    popup.classList.remove('show');
    popup.__owner = null;
  }

  function fmt(s) {
    if (!s) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;   // free-form marker dates pass through
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y.slice(2)}`;
  }

  let activeHelloAudio = null;
  function helloAudioFor(h) {
    if (!h || !h.native) return null;
    return (DATA.helloAudio || {})[`${h.lang || ''}|${h.native}`] ||
           (DATA.helloAudio || {})[h.native] ||
           null;
  }

  function playHello(h, btn) {
    const audio = helloAudioFor(h);
    if (!audio || !audio.src) {
      speak(h.native, h.lang, btn, h.translit);
      return;
    }

    if (activeHelloAudio) {
      activeHelloAudio.pause();
      activeHelloAudio = null;
    }
    if ('speechSynthesis' in window) speechSynthesis.cancel();

    const a = new Audio(audio.src);
    activeHelloAudio = a;
    if (btn) btn.classList.add('speaking');
    const done = () => {
      if (activeHelloAudio === a) activeHelloAudio = null;
      if (btn) btn.classList.remove('speaking');
    };
    a.addEventListener('ended', done, { once: true });
    a.addEventListener('error', () => {
      done();
      speak(h.native, h.lang, btn, h.translit);
    }, { once: true });
    a.play().catch(() => {
      done();
      speak(h.native, h.lang, btn, h.translit);
    });
  }

  function doSpeak(text, lang, btn, fallback) {
    const voices = speechSynthesis.getVoices();
    const base = (lang || '').split('-')[0].toLowerCase();
    const v = voices.find((x) => x.lang && x.lang.toLowerCase() === (lang || '').toLowerCase()) ||
              voices.find((x) => x.lang && x.lang.toLowerCase().split(/[-_]/)[0] === base);
    let u;
    if (v) {                         // proper native voice
      u = new SpeechSynthesisUtterance(text);
      u.lang = lang; u.voice = v;
    } else if (fallback) {           // no voice for this language → say the transliteration
      u = new SpeechSynthesisUtterance(fallback.replace(/[·]/g, ' '));
    } else {
      u = new SpeechSynthesisUtterance(text);
      if (lang) u.lang = lang;
    }
    u.rate = 0.9;
    if (btn) {
      btn.classList.add('speaking');
      u.onend = u.onerror = () => btn.classList.remove('speaking');
    }
    speechSynthesis.speak(u);
  }

  function speak(text, lang, btn, fallback) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    // voices can populate asynchronously — wait once if empty (fixes "first click" silence)
    if (!speechSynthesis.getVoices().length) {
      speechSynthesis.addEventListener('voiceschanged', function once() {
        speechSynthesis.removeEventListener('voiceschanged', once);
        doSpeak(text, lang, btn, fallback);
      });
      setTimeout(() => doSpeak(text, lang, btn, fallback), 250);
      return;
    }
    doSpeak(text, lang, btn, fallback);
  }

  /* =================================================================
     MORPH  (flat <-> globe)
     ================================================================= */
  function toggleGlobe() {
    if (morphing) return;
    morphing = true;
    resetZoom();                        // each mode starts fit & unzoomed
    const from = isGlobe ? 1 : 0;
    const target = isGlobe ? 0 : 1;     // alpha: 0 = flat, 1 = globe
    projection.clipAngle(null);         // no clip during the morph
    isGlobe = target === 1;             // pins follow immediately
    if (isGlobe) recenterGlobe();       // spin so the journeys face us
    else projection.rotate([0, 0]);     // flat map is never angled
    showAllArcs();

    // self-contained timer (won't be interrupted by other d3 transitions,
    // so `morphing` can never get stuck true).
    const dur = REDUCE ? 1 : 1150;
    const ease = d3.easeCubicInOut;
    const timer = d3.timer((elapsed) => {
      const k = Math.min(1, elapsed / dur);
      const a = from + (target - from) * ease(k);
      projection.alpha(a);
      applyFit(a);
      render();
      if (k >= 1) {
        timer.stop();
        projection.alpha(target);
        projection.clipAngle(isGlobe ? 90 : null);
        applyFit(target);
        render();
        morphing = false;
        updateGlobeBtn();
        applyPanBounds();
      }
    });
  }

  // point the orthographic globe at the centroid of the journeys
  function recenterGlobe() {
    const c = d3.geoCentroid(contentGeo);
    projection.rotate([-c[0], -c[1]]);
  }

  /* ---- framing ----
     Flat mode frames to the bounding box of the actual journeys (so the
     Europe cluster fills the view and arcs read), while the globe frames
     the whole sphere. We precompute both scale/translate and lerp by alpha
     so the morph stays smooth. */
  let flatFit = null, globeFit = null;

  function computeFits() {
    const a0 = projection.alpha();
    const r0 = projection.rotate();

    // flat framing — fit to the journeys' bbox, with room for the title (top),
    // arc bows (top) and the legend (more bottom reserve when it's full-width
    // on narrow screens).
    projection.alpha(0).rotate([0, 0]);
    const narrow = width <= 640;
    const padX = Math.max(46, width * 0.07);
    const padTop = Math.max(150, height * 0.20);
    const padBot = narrow ? Math.max(300, height * 0.40) : Math.max(90, height * 0.16);
    projection.fitExtent([[padX, padTop], [width - padX, height - padBot]], contentGeo);
    flatFit = { scale: projection.scale(), translate: projection.translate().slice() };

    // globe framing — fit the full sphere
    projection.alpha(1);
    projection.fitExtent([[44, 44], [width - 44, height - 44]], { type: 'Sphere' });
    globeFit = { scale: projection.scale(), translate: projection.translate().slice() };

    projection.alpha(a0).rotate(r0);
  }

  function applyFit(alpha) {
    if (!flatFit || !globeFit) computeFits();
    const s = flatFit.scale + (globeFit.scale - flatFit.scale) * alpha;
    const tx = flatFit.translate[0] + (globeFit.translate[0] - flatFit.translate[0]) * alpha;
    const ty = flatFit.translate[1] + (globeFit.translate[1] - flatFit.translate[1]) * alpha;
    projection.scale(s).translate([tx, ty]);
  }

  function fitKeepCenter() { applyFit(isGlobe ? 1 : 0); }

  function updateGlobeBtn() {
    const b = $('#wl-globe-btn');
    if (b) b.textContent = isGlobe ? t('flat') : t('globe');
    const hint = $('#wl-hint');
    if (hint) hint.textContent = isGlobe ? t('hintGlobe') : t('hintFlat');
  }

    /* Interactions:
       • scroll / pinch  → zoom (flat always; globe keeps wheel/pinch zoom)
       • drag in FLAT    → pan  (handled by d3.zoom)
       • drag on GLOBE   → spin (handled by versor d3.drag, including one-finger touch)
     The two behaviours coexist via mode-aware filters. */
  function unzoom(pt) { return [(pt[0] - zoomT.x) / zoomT.k, (pt[1] - zoomT.y) / zoomT.k]; }

  function enableInteractions() {
    zoom = d3.zoom()
      .scaleExtent([1, MAX_ZOOM])
      .filter((event) => {
        // d3-zoom v3 fires POINTER events for drag (pointerType tells mouse vs touch)
        if (event.type === 'wheel') return !event.button;     // scroll → zoom (both modes)
        if (event.type === 'dblclick') return false;
        const touch = event.pointerType === 'touch' || String(event.type || '').startsWith('touch');
        if (touch) {
          if (!isGlobe) return true;                          // touch → pan/pinch (flat)
          return !!(event.touches && event.touches.length > 1); // two-finger touch → zoom (globe)
        }
        return !isGlobe && !morphing && !event.button;        // mouse drag → pan (flat only)
      })
      .on('start', (event) => { if (event.sourceEvent) { svg.interrupt('globe-rotate'); hidePopup(); forceTitleTracking(); } svg.classed('dragging', true); })
      .on('zoom', (event) => {
        zoomT = event.transform;
        gZoom.attr('transform', zoomT);
        syncAutoDetailCountry();
        positionPins();
      })
      .on('end', () => svg.classed('dragging', false));

    let v0, q0, r0;
    const drag = d3.drag()
      .filter((event) => {
        if (!isGlobe || morphing || event.button) return false;
        const touch = event.pointerType === 'touch' || String(event.type || '').startsWith('touch');
        return !touch || !(event.touches && event.touches.length > 1);
      })
      .on('start', (event) => {
        svg.classed('dragging', true);
        svg.interrupt('globe-rotate');
        forceTitleTracking();
        cancelHide(); hidePopup();
        v0 = versor.cartesian(projection.invert(unzoom([event.x, event.y])));
        q0 = versor(r0 = projection.rotate());
      })
      .on('drag', (event) => {
        const v1 = versor.cartesian(projection.rotate(r0).invert(unzoom([event.x, event.y])));
        const q1 = versor.multiply(q0, versor.delta(v0, v1));
        projection.rotate(versor.rotation(q1));
        render();
      })
      .on('end', () => svg.classed('dragging', false));

    svg.call(zoom).call(drag);
  }

  function resetZoom() {
    if (!zoom) return;
    focusedPin = null;
    focusedCountryName = null;
    autoDetailCountryName = null;
    playbackDetailCountryName = null;
    clearCountryInfo();
    if (typeof updateCountryHighlight === 'function') updateCountryHighlight();
    renderArcs();
    zoomT = d3.zoomIdentity;
    svg.call(zoom.transform, d3.zoomIdentity);   // syncs behaviour + fires zoom
  }

  function normalizeGlobeTransform(dur = 0) {
    if (!zoom || !isGlobe) return;
    setGlobeZoom(1, dur);
  }

  function globeZoomTransform(k) {
    return d3.zoomIdentity
      .translate(width / 2 - k * width / 2, height / 2 - k * height / 2)
      .scale(k);
  }

  function setGlobeZoom(k, dur = 0) {
    if (!zoom) return;
    const t = globeZoomTransform(Math.max(1, Math.min(k || 1, 1.9)));
    if (dur > 0) svg.transition('globe-zoom').duration(dur).ease(d3.easeCubicInOut).call(zoom.transform, t);
    else svg.call(zoom.transform, t);
  }

  function geoMaxDistance(coordsList) {
    let max = 0;
    for (let i = 0; i < coordsList.length; i++) {
      for (let j = i + 1; j < coordsList.length; j++) {
        if (!coordsList[i] || !coordsList[j]) continue;
        max = Math.max(max, d3.geoDistance(coordsList[i], coordsList[j]));
      }
    }
    return max;
  }

  function globeZoomForCoords(coordsList, opts = {}) {
    if (opts.globeK != null) return opts.globeK;
    if (opts.globeCloseZoom === false) return 1;
    const span = geoMaxDistance(coordsList);
    if (span < 0.025) return 1.85; // local/day trips
    if (span < 0.075) return 1.55; // nearby countries
    if (span < 0.16) return 1.25;
    return 1;
  }

  function geoMean(coordsList) {
    let x = 0, y = 0, z = 0, n = 0;
    coordsList.forEach((coords) => {
      if (!coords) return;
      const lon = coords[0] * Math.PI / 180;
      const lat = coords[1] * Math.PI / 180;
      const cl = Math.cos(lat);
      x += cl * Math.cos(lon);
      y += cl * Math.sin(lon);
      z += Math.sin(lat);
      n++;
    });
    if (!n) return null;
    const hyp = Math.hypot(x, y);
    if (!hyp) return null;
    return [Math.atan2(y, x) * 180 / Math.PI, Math.atan2(z, hyp) * 180 / Math.PI];
  }

  function rotateGlobeToCoords(coordsList, dur = 650, opts = {}) {
    if (!coordsList.length) return;
    const target = geoMean(coordsList);
    if (!target) return;
    setGlobeZoom(globeZoomForCoords(coordsList, opts), Math.min(dur, 420));
    const start = projection.rotate().slice();
    const end = [-target[0], -target[1], start[2] || 0];
    if (REDUCE || dur <= 1) {
      projection.rotate(end);
      render();
      return;
    }
    svg.interrupt('globe-rotate');
    svg.transition('globe-rotate').duration(dur).ease(d3.easeCubicInOut)
      .tween('globe-rotate', () => {
        const ix = d3.interpolateNumber(start[0], end[0]);
        const iy = d3.interpolateNumber(start[1], end[1]);
        const iz = d3.interpolateNumber(start[2] || 0, end[2] || 0);
        return (t) => {
          projection.rotate([ix(t), iy(t), iz(t)]);
          render();
        };
      });
  }

  /* =================================================================
     TIMELAPSE
     ================================================================= */
  // fit the camera to a set of [lon,lat] coords (covers the journey so far)
  function flyToCoords(coordsList, frac, dur, opts = {}) {
    if (!zoom || !coordsList.length) return;
    if (isGlobe) {
      rotateGlobeToCoords(coordsList, dur, opts);
      return;
    }
    const xs = coordsList.map((c) => projection(c)).filter(Boolean);
    if (!xs.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    xs.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1);
    const minK = opts.minK == null ? 1 : opts.minK;
    const maxK = opts.maxK == null ? MAX_ZOOM : opts.maxK;
    const k = Math.max(minK, Math.min(frac * Math.min(width / bw, height / bh), Math.min(maxK, MAX_ZOOM)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const t = d3.zoomIdentity.translate(width / 2 - k * cx, height * 0.46 - k * cy).scale(k);
    svg.transition().duration(dur).ease(d3.easeCubicInOut).call(zoom.transform, t);
  }

  function endTimelapse(btn) {
    timelapseActive = false;
    timelapsePlaying = false;
    if (btn) btn.disabled = false;
    highlightYear(null);
    Object.keys(revealedYearByCountry).forEach((k) => delete revealedYearByCountry[k]);
    pins.forEach((p) => { p.suppressed = false; });
    arcEls.forEach((a) => { a.revealed = true; });
    styleCountries();
    renderArcs();
    positionPins();
    flyToCoords(Object.values(coordsByName), 0.82, 900);   // settle back to the whole map
  }

  function playTimelapse() {
    if (timelapsePlaying) return;
    timelapsePlaying = true;
    timelapseActive = true;
    const btn = $('#wl-play-btn');
    btn.disabled = true;

    $('#wl-arcs-toggle').checked = true;
    gArcs.classed('hidden', false);
    if (isolatedKey != null) { lockedKey = null; setIsolate(null); }

    // BLANK SLATE: hide every arc + pin, strip every pattern except Ukraine
    revealedCountries.clear();
    Object.keys(revealedYearByCountry).forEach((k) => delete revealedYearByCountry[k]);
    arcEls.forEach((a) => { a.revealed = false; a.el.interrupt().style('opacity', 0); });
    pins.forEach((p) => { p.suppressed = true; });
    styleCountries();
    positionPins();

    const ordered = arcEls.slice().sort((x, y) => x.trip.from_date.localeCompare(y.trip.from_date));
    const covered = [DATA.places.Lviv.coords];
    // step is the gap between successive legs; widened from 1050 → 1250 so
    // the longest auto-scaled draws (drawArc tops out at 2000ms but most arcs
    // land near 1000–1400ms) have room to breathe before the next leg fires.
    const step = REDUCE ? 220 : 1250;

    const revealPin = (city, jump) => {
      const pin = cityPinByName[city];
      if (!pin) return;
      pin.suppressed = false;
      positionPins();
      if (jump && !REDUCE) {
        pin.el.classList.remove('arriving'); void pin.el.offsetWidth;
        pin.el.classList.add('arriving');
      }
    };

    ordered.forEach((a, i) => {
      setTimeout(() => {
        highlightYear(itemKey(a.trip));
        revealPin(a.trip.from, false);          // show where this leg departs
        a.revealed = true;
        // per-arc duration: drawArc picks one from the path length so a
        // Berlin→Tbilisi sweep inks longer than a Lviv→Warsaw hop.
        const drawDur = REDUCE ? 1 : drawArc(a);
        if (REDUCE) { a.el.attr('d', arcPathD(a)).style('opacity', 1); }

        // camera follows the covered area; expands (zooms out) when a far point lands
        covered.push(a.fromCoords, a.trip.coords);
        const cameraCoords = isGlobe ? arcWaypoints(a).filter(Boolean) : covered;
        flyToCoords(cameraCoords, 0.7, Math.min(step, 900), { globeCloseZoom: isGlobe });

        // when the arc lands: country pattern fades in (recoloured to THIS year)
        // + pin jumps onto the city
        setTimeout(() => {
          revealedCountries.add(a.trip.country);
          revealedYearByCountry[a.trip.country] = itemKey(a.trip);
          styleCountries();
          revealPin(a.trip.city, true);
        }, drawDur);

        if (i === ordered.length - 1) setTimeout(() => endTimelapse(btn), drawDur + step);
      }, i * step);
    });
  }

  function currentTimelineSpeed() {
    return TIMELINE_SPEEDS[timelineSpeedIndex] || 1;
  }

  function setTimelinePlaybackUi() {
    const playing = timelinePlaying;
    const tlPlay = $('#wl-timeline-play');
    if (tlPlay) {
      tlPlay.textContent = t(playing ? 'timelineStop' : 'timelinePlay');
      tlPlay.classList.toggle('active', playing);
      tlPlay.setAttribute('aria-pressed', playing ? 'true' : 'false');
    }
    const tlSpeed = $('#wl-timeline-speed');
    if (tlSpeed) tlSpeed.textContent = `x${currentTimelineSpeed()}`;
    const mainPlay = $('#wl-play-btn');
    if (mainPlay) {
      mainPlay.textContent = playing ? t('stopJourney') : t('play');
      mainPlay.classList.toggle('active', playing);
      mainPlay.disabled = false;
    }
  }

  function clearTimelinePlaybackTimer() {
    if (timelinePlaybackTimer) clearTimeout(timelinePlaybackTimer);
    timelinePlaybackTimer = null;
  }

  function stopTimelinePlayback() {
    timelinePlaying = false;
    timelapsePlaying = false;
    playbackDetailCountryName = null;
    clearTimelinePlaybackTimer();
    clearTimelineStepTimers();
    normalizeGlobeTransform(360);
    setTimelinePlaybackUi();
  }

  function timelineEventKey(ev) {
    if (!ev) return null;
    if (ev.kind === 'arc') return itemKey(ev.a.trip);
    return (ev.p.keys || [])[ (ev.p.keys || []).length - 1 ] ?? null;
  }

  function timelineCoordsThrough(i) {
    const coords = [DATA.places.Lviv.coords];
    timelineOrder.slice(0, i).forEach((ev) => {
      if (ev.kind === 'arc') {
        if (ev.a.fromCoords) coords.push(ev.a.fromCoords);
        if (ev.a.trip.coords) coords.push(ev.a.trip.coords);
      } else if (ev.p.coords) coords.push(ev.p.coords);
    });
    return coords.filter(Boolean);
  }

  function geoSpread(coords) {
    let spread = 0;
    for (let i = 0; i < coords.length; i++) {
      for (let j = i + 1; j < coords.length; j++) {
        spread = Math.max(spread, d3.geoDistance(coords[i], coords[j]));
      }
    }
    return spread;
  }

  function timelineEventCoords(ev) {
    if (!ev) return [];
    if (ev.kind === 'arc') return arcWaypoints(ev.a).filter(Boolean);
    return ev.p && ev.p.coords ? [ev.p.coords] : [];
  }

  function timelineCameraForEvent(ev, dur, speed) {
    const coords = timelineEventCoords(ev);
    if (!coords.length) return;
    const spread = geoSpread(coords);
    const close = spread < 0.08;
    const local = spread < 0.18;
    const maxK = close ? 14 : local ? 8 : 4.6;
    const minK = close ? 5.2 : local ? 2.8 : 1;
    flyToCoords(coords, close ? 0.54 : 0.7, Math.max(240, Math.min(dur, 900 / speed)), { minK, maxK });
  }

  function scheduleTimelinePlayback(delay) {
    clearTimelinePlaybackTimer();
    if (!timelinePlaying) return;
    timelinePlaybackTimer = setTimeout(playTimelineStep, delay);
  }

  function startTimelinePlayback() {
    if (!timelineActive) enterTimeline();
    if (!timelineOrder.length) return;
    const range = $('#wl-timeline-range');
    if (range && +range.value >= timelineOrder.length) {
      range.value = 0;
      setTimeline(0);
    }
    timelinePlaying = true;
    timelapsePlaying = true;
    setTimelinePlaybackUi();
    scheduleTimelinePlayback(REDUCE ? 40 : 160);
  }

  function playTimelineStep() {
    if (!timelinePlaying || !timelineActive) return;
    const range = $('#wl-timeline-range');
    const speed = currentTimelineSpeed();
    const current = range ? +range.value || 0 : timelineLastIndex;
    const next = Math.min(current + 1, timelineOrder.length);
    playbackDetailCountryName = null;
    if (range) range.value = next;
    const animMs = setTimeline(next, { playback: true, speed });
    const ev = timelineOrder[next - 1];
    highlightYear(timelineEventKey(ev));
    timelineCameraForEvent(ev, animMs || 900, speed);

    if (next >= timelineOrder.length) {
      timelinePlaybackTimer = setTimeout(stopTimelinePlayback, Math.max(260, animMs + 260 / speed));
      return;
    }
    const markerStep = ev && ev.kind === 'marker';
    const hold = markerStep ? TIMELINE_MARKER_HOLD_MS : 720;
    const minDelay = markerStep ? 650 * TIMELINE_MARKER_SPEEDUP : 650;
    const maxDelay = markerStep ? 1850 * TIMELINE_MARKER_SPEEDUP : 1850;
    const stepDelay = Math.max(minDelay / speed, Math.min(maxDelay / speed, animMs + hold / speed));
    scheduleTimelinePlayback(REDUCE ? Math.max(80, 220 / speed) : stepDelay);
  }

  function toggleTimelinePlayback() {
    if (timelinePlaying) stopTimelinePlayback();
    else startTimelinePlayback();
  }

  function playTimelapse() {
    toggleTimelinePlayback();
  }

  function cycleTimelineSpeed() {
    timelineSpeedIndex = (timelineSpeedIndex + 1) % TIMELINE_SPEEDS.length;
    setTimelinePlaybackUi();
  }

  /* ---- reset to the default flat view ---- */
  function resetView() {
    lockedKey = null; setIsolate(null);
    focusedPin = null; focusedCountryName = null; autoDetailCountryName = null; playbackDetailCountryName = null;
    clearCountryInfo();
    if (timelineActive) exitTimeline();
    if (isGlobe) { toggleGlobe(); return; }   // morph to flat (also resets zoom + rotation)
    projection.rotate([0, 0]);
    flatFit = globeFit = null; resetZoom(); fitKeepCenter(); render();
  }

  /* ---- manual TIMELINE (scrub the journey at your own pace) ---- */
  const TIMELINE_SPEEDS = [1, 2, 5];
  let timelineActive = false, timelineOrder = [], timelineLastIndex = 0;
  let timelinePlaying = false, timelinePlaybackTimer = null, timelineSpeedIndex = 0;
  let timelineStepTimers = [];
  function enterTimeline() {
    stopTimelinePlayback();
    timelineActive = true; timelapseActive = true;
    normalizeGlobeTransform(1);
    if (isolatedKey != null) { lockedKey = null; setIsolate(null); }
    $('#wl-arcs-toggle').checked = true; gArcs.classed('hidden', false);
    arcEls.forEach((a) => a.el.interrupt().attr('stroke-dasharray', null).attr('stroke-dashoffset', null));
    // timeline events = arcs AND standalone markers, ordered by date — so an
    // undated/marker place (e.g. Yevpatoria 2000) gets its own step in sequence
    const arcEvents = arcEls
      .filter((a) => !a.trip.focusOnly)
      .map((a) => ({ kind: 'arc', date: a.trip.from_date, a }));
    const markerEvents = pins.filter((p) => p.kind === 'marker')
      .map((p) => ({ kind: 'marker', date: p.sortDate || '1990-01-01', p }));
    timelineOrder = arcEvents.concat(markerEvents)
      .sort((x, y) => String(x.date).localeCompare(String(y.date)));
    const range = $('#wl-timeline-range'); range.max = timelineOrder.length; range.value = 0;
    $('#wl-timeline').classList.add('show');
    $('#wl-timeline-btn').classList.add('active');
    timelineLastIndex = 0;
    setTimeline(0);
    setTimelinePlaybackUi();
  }
  function exitTimeline() {
    stopTimelinePlayback();
    timelineActive = false; timelapseActive = false;
    playbackDetailCountryName = null;
    $('#wl-timeline').classList.remove('show');
    $('#wl-timeline-btn').classList.remove('active');
    revealedCountries.clear();
    Object.keys(revealedYearByCountry).forEach((k) => delete revealedYearByCountry[k]);
    pins.forEach((p) => { p.suppressed = false; });
    arcEls.forEach((a) => { a.revealed = true; });
    clearTimelineStepTimers();
    styleCountries(); renderArcs(); positionPins();
  }
  function clearTimelineStepTimers() {
    timelineStepTimers.forEach((timer) => clearTimeout(timer));
    timelineStepTimers = [];
  }

  function setTimeline(i, opts = {}) {
    clearTimelineStepTimers();
    const ord = timelineOrder;
    const speed = opts.speed || 1;
    const rangeEl = $('#wl-timeline-range');
    if (rangeEl && +rangeEl.value !== +i) rangeEl.value = i;
    playbackDetailCountryName = null;
    revealedCountries.clear();
    Object.keys(revealedYearByCountry).forEach((k) => delete revealedYearByCountry[k]);
    const reached = new Set([DATA.places.Lviv.city]);
    const shownMarkers = new Set();
    arcEls.forEach((a) => { a._wasRevealed = a.revealed; a.revealed = false; });
    ord.forEach((ev, idx) => {
      if (idx >= i) return;
      if (ev.kind === 'arc') {
        ev.a.revealed = true;
        revealedCountries.add(ev.a.trip.country);
        revealedYearByCountry[ev.a.trip.country] = itemKey(ev.a.trip);   // last revealed wins
        reached.add(ev.a.trip.from); reached.add(ev.a.trip.city);
      } else {
        shownMarkers.add(ev.p);
        // a marker reveals its country too (e.g. Turkey's pre-2014 pins) so the
        // pattern fades in even when no arc reaches that country yet
        if (ev.p.country) {
          revealedCountries.add(ev.p.country);
          const k = (ev.p.keys || [])[ (ev.p.keys || []).length - 1 ];
          if (k != null) revealedYearByCountry[ev.p.country] = k;       // last revealed wins
        }
      }
    });
    const newlyRevealed = arcEls.filter((a) => a.revealed && !a._wasRevealed);
    let pinLandingMs = 0;

    pins.forEach((p) => {
      const wasSuppressed = p.suppressed;
      p.suppressed = (p.kind === 'marker') ? !shownMarkers.has(p) : !reached.has(p.city);
      if (wasSuppressed && !p.suppressed) {
        const cls = p.kind === 'marker' ? 'dropping' : 'arriving';
        p.el.classList.remove(cls); void p.el.offsetWidth; p.el.classList.add(cls);
        pinLandingMs = Math.max(pinLandingMs, (p.kind === 'marker' ? TIMELINE_MARKER_LANDING_MS : 1050) / speed);
      }
    });
    styleCountries(); positionPins();

    const animating = new Set(newlyRevealed);
    arcEls.forEach((a) => {
      if (animating.has(a)) return;             // drawArc owns this one
      const d = arcPathD(a);
      const show = d && arcVisible(a);
      a.el.interrupt()
          .attr('stroke-dasharray', null).attr('stroke-dashoffset', null)
          .attr('d', d || null).style('opacity', show ? 1 : 0);
    });
    let maxAnimMs = 0;
    newlyRevealed.forEach((a, idx) => {
      const delay = (idx * 90) / speed;
      const dur = Math.max(1, arcDrawDuration(a) / speed);
      maxAnimMs = Math.max(maxAnimMs, delay + dur);
      const timer = setTimeout(() => drawArc(a, dur), delay);
      timelineStepTimers.push(timer);
    });
    maxAnimMs = Math.max(maxAnimMs, pinLandingMs);

    timelineLastIndex = i;
    const lbl = $('#wl-timeline-label');
    if (lbl) {
      const cur = ord[i - 1];
      if (i === 0) lbl.textContent = t('beginning');
      else if (cur.kind === 'arc') lbl.textContent = `${dispCity(cur.a.trip.from)} → ${dispCity(cur.a.trip.city)} · ${fmt(cur.a.trip.from_date)}`;
      else lbl.textContent = `${dispCity(cur.p.city)}${cur.p.date ? ' · ' + cur.p.date : ''}`;
    }
    return maxAnimMs;
  }

  function highlightYear(key) {
    document.querySelectorAll('.legend-row').forEach((row) => {
      row.classList.toggle('active', key != null && String(row.dataset.key) === String(key));
    });
  }

  /* =================================================================
     LEGEND
     ================================================================= */
  function buildLegend() {
    const wrap = $('#wl-legend-years');
    // special era rows first (e.g. "before 2014"), then the years
    const eraKeys = Object.keys(ERAS);
    const yearKeys = Object.keys(DATA.yearColors).sort();
    const keys = eraKeys.concat(yearKeys);
    // "all" sits on top, selected by default — a rainbow swatch of the palette
    const allSwatch = `linear-gradient(90deg, ${keys.map(keyColor).join(',')})`;
    const rowHtml = (k) => `
      <div class="legend-row" data-key="${k}" role="button" tabindex="0">
        <span class="legend-swatch" style="background:${keyColor(k)};--sw:${keyColor(k)}"></span>
        <span>${keyLabel(k)}</span>
      </div>`;
    const allRow = `
      <div class="legend-row legend-all${isolatedKey == null ? ' active' : ''}" data-key="all" role="button" tabindex="0">
        <span class="legend-swatch" style="background:${allSwatch};--sw:var(--pearl-aqua)"></span>
        <span>${t('allYears')}</span>
      </div>`;
    const rightStart = keys.findIndex((k) => +k === 2021);
    const splitAt = rightStart > 0 ? rightStart : Math.ceil(keys.length / 2);
    wrap.innerHTML = allRow
      + `<div class="legend-column">${keys.slice(0, splitAt).map(rowHtml).join('')}</div>`
      + `<div class="legend-column">${keys.slice(splitAt).map(rowHtml).join('')}</div>`;
    // hover previews a key; click locks/unlocks the isolation and frames the zone
    wrap.querySelectorAll('.legend-row').forEach((row) => {
      const raw = row.dataset.key;
      if (raw === 'all') {                       // the "all" reset row
        row.addEventListener('mouseenter', () => { if (lockedKey == null) { cancelTimelineForUserFilter(); setIsolate(null); } });
        row.addEventListener('click', () => { cancelTimelineForUserFilter(); lockedKey = null; setIsolate(null); frameKey(null); });
        return;
      }
      const key = ERAS[raw] ? raw : +raw;     // era stays a string, years are numbers
      row.addEventListener('mouseenter', () => { if (lockedKey == null) { cancelTimelineForUserFilter(); setIsolate(key); } });
      row.addEventListener('mouseleave', () => { if (lockedKey == null) setIsolate(null); });
      row.addEventListener('click', () => {
        cancelTimelineForUserFilter();
        lockedKey = (lockedKey === key) ? null : key;
        setIsolate(lockedKey);
        frameKey(lockedKey);
      });
    });
  }

  /* coords involved in a year/era — arc endpoints (from + to) plus markers,
     so framing a filter shows the whole zone its travels happened in. */
  function coordsForKey(key) {
    const out = [];
    DATA.trips.forEach((tr) => {
      if (itemKey(tr) !== key) return;
      const f = getCoords(tr.from); if (f) out.push(f);
      out.push(tr.coords);
    });
    (DATA.markers || []).forEach((m) => { if (itemKey(m) === key) out.push(m.coords); });
    return out;
  }

  // fly the camera to frame a filter's zone (or back to the whole map for "all")
  function frameKey(key) {
    if (key == null) { flyToCoords(Object.values(coordsByName), 0.82, 800); return; }
    const cs = coordsForKey(key);
    if (cs.length) flyToCoords(cs, 0.58, 800, { maxK: key === 2015 ? 3.6 : 6.2 });
  }

  /* ---- isolate a single year/era (legend hover/click) ---- */
  let isolatedKey = null, lockedKey = null;
  function pinMatches(p) {
    // anchors (alwaysShow) are never hidden, but under a year filter they dim
    // like everyone else unless they actually took part that year (via keys).
    return (p.keys || []).includes(isolatedKey);
  }
  function setIsolate(key) {
    isolatedKey = key;
    document.querySelectorAll('.legend-row').forEach((row) => {
      if (row.dataset.key === 'all') {                 // "all" lit when nothing is isolated
        row.classList.toggle('active', key == null);
        row.classList.toggle('locked', lockedKey == null);
        return;
      }
      const k = ERAS[row.dataset.key] ? row.dataset.key : +row.dataset.key;
      row.classList.toggle('active', key != null && k === key);
      row.classList.toggle('locked', lockedKey != null && k === lockedKey);
    });
    styleCountries();
    renderArcs();
    applyPinColors();
    positionPins();
  }

  function cancelTimelineForUserFilter() {
    if (timelineActive || timelinePlaying || timelapsePlaying) exitTimeline();
  }

  /* =================================================================
     INIT
     ================================================================= */
  // show/hide arcs with a quick blink, keeping the checkbox in sync
  function setArcs(show, blink) {
    const cb = $('#wl-arcs-toggle'); if (cb) cb.checked = show;
    renderArcs();
    if (!blink) { gArcs.classed('hidden', !show); return; }
    gArcs.interrupt().classed('hidden', false).style('opacity', 1)
      .transition().duration(110).style('opacity', 0.08)
      .transition().duration(110).style('opacity', 1)
      .transition().duration(200).style('opacity', show ? 1 : 0)
      .on('end', () => { gArcs.classed('hidden', !show).style('opacity', null); });
  }

  function setPins(show) {
    const cb = $('#wl-pins-toggle'); if (cb) cb.checked = show;
    if (pinLayer) pinLayer.classList.toggle('pins-hidden', !show);
  }

  function setCityNames(show) {
    showCityNames = !!show;
    const cb = $('#wl-city-labels-toggle'); if (cb) cb.checked = showCityNames;
    if (pinLayer) positionPins();
  }

  function buildAudioCredits() {
    const wrap = $('#wl-audio-credits');
    if (!wrap) return;
    const entries = Object.entries(DATA.helloAudio || {}).sort(([a], [b]) => a.localeCompare(b));
    wrap.innerHTML = entries.map(([key, audio]) => {
      const [code, native = ''] = key.split('|');
      const source = audio.url
        ? `<a href="${esc(audio.url)}" target="_blank" rel="noopener">${esc(audio.source || audio.title || 'source')}</a>`
        : esc(audio.source || audio.title || 'source');
      return `
        <div class="wl-credit-row">
          <div class="wl-credit-main">
            <span class="wl-credit-lang">${esc(langName(code))}</span>
            <span class="wl-credit-native">${esc(native)}</span>
          </div>
          <div class="wl-credit-meta">${source} · ${esc(audio.author || 'unknown')} · ${esc(audio.license || 'license')}</div>
        </div>`;
    }).join('');
  }

  function setInfoPanel(open) {
    const btn = $('#wl-info-btn');
    const panel = $('#wl-info-panel');
    if (!btn || !panel) return;
    if (open) {
      setStatsPanel(false);
      setEuropePanel(false);
    }
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('active', open);
  }

  function setStatsPanel(open) {
    const btn = $('#wl-stats-btn');
    const panel = $('#wl-stats-panel');
    if (!btn || !panel) return;
    if (open) {
      setInfoPanel(false);
      if (timelineActive) exitTimeline();
      renderStatsPanel();
    } else {
      setEuropePanel(false);
      setCountriesPanel(false);
      setCitiesPanel(false);
    }
    panel.hidden = !open;
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setCountriesPanel(open) {
    const panel = $('#wl-countries-panel');
    if (!panel) return;
    if (open) {
      setEuropePanel(false);
      setCitiesPanel(false);
      renderVisitedCountriesList();
    }
    panel.hidden = !open;
  }

  function setCitiesPanel(open) {
    const panel = $('#wl-cities-panel');
    if (!panel) return;
    if (open) {
      setCountriesPanel(false);
      setEuropePanel(false);
      renderVisitedCitiesList();
    }
    panel.hidden = !open;
  }

  function setEuropePanel(open) {
    const panel = $('#wl-europe-panel');
    if (!panel) return;
    if (open) {
      setCountriesPanel(false);
      setCitiesPanel(false);
      renderEuropeChecklist();
    }
    panel.hidden = !open;
  }

  function floatingPanelTarget(target) {
    return !!(target && target.closest && target.closest([
      '#wl-stats-panel',
      '#wl-countries-panel',
      '#wl-cities-panel',
      '#wl-europe-panel',
      '#wl-info-panel',
      '#wl-stats-btn',
      '#wl-info-btn',
    ].join(',')));
  }

  function closeFloatingPanelsFromOutside(e) {
    if (floatingPanelTarget(e.target)) return;
    setInfoPanel(false);
    setStatsPanel(false);
  }

  function applyLang() {
    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
    set('#wl-filters-title', t('travels'));
    set('#wl-arcs-label', t('showArcs'));
    set('#wl-pins-label', t('showPins'));
    set('#wl-city-labels-label', t('cityNames'));
    set('#wl-timeline-btn', t('timeline'));
    set('#wl-reset-btn', t('reset'));
    set('#wl-measure-btn', t('measure'));
    set('#wl-play-btn', t('play'));
    set('#wl-lang-btn', lang === 'en' ? 'УКР' : 'ENG');
    set('#wl-stats-btn', t('stats'));
    set('#wl-stats-panel h2', t('stats'));
    set('#wl-countries-panel h2', t('countryList'));
    set('#wl-cities-panel h2', t('cityList'));
    set('#wl-europe-panel h2', t('europeChecklist'));
    set('#wl-info-panel h2', t('audioCredits'));
    set('#wl-info-panel p', t('audioCreditsText'));
    const close = $('#wl-info-close'); if (close) close.setAttribute('aria-label', t('closeCredits'));
    const statsClose = $('#wl-stats-close'); if (statsClose) statsClose.setAttribute('aria-label', t('closeStats'));
    const countriesClose = $('#wl-countries-close'); if (countriesClose) countriesClose.setAttribute('aria-label', t('closeCountryList'));
    const citiesClose = $('#wl-cities-close'); if (citiesClose) citiesClose.setAttribute('aria-label', t('closeCityList'));
    const europeClose = $('#wl-europe-close'); if (europeClose) europeClose.setAttribute('aria-label', t('closeEuropeChecklist'));
    updateGlobeBtn();                                   // globe/flat label + hint
    buildLegend(); setIsolate(isolatedKey);            // re-translate filter labels, keep state
    buildAudioCredits();
    if (!$('#wl-stats-panel')?.hidden) renderStatsPanel();
    if (!$('#wl-countries-panel')?.hidden) renderVisitedCountriesList();
    if (!$('#wl-cities-panel')?.hidden) renderVisitedCitiesList();
    if (!$('#wl-europe-panel')?.hidden) renderEuropeChecklist();
    seaEls.forEach((s) => { s.el.textContent = dispSea(s.name); });
    pins.forEach((p) => { const l = p.el.querySelector('.pin-label'); if (l) l.textContent = dispCity(p.city); });
    if (popup.classList.contains('show') && popup.__owner) showPopup(popup.__owner);
    rerenderCountryInfo();
    setTimelinePlaybackUi();
    if (timelineActive) setTimeline(+$('#wl-timeline-range').value);
  }
  function setLang(l) { lang = l; applyLang(); }

  function wireControls() {
    $('#wl-arcs-toggle').addEventListener('change', (e) => setArcs(e.target.checked, true));
    const pt = $('#wl-pins-toggle');
    if (pt) pt.addEventListener('change', (e) => setPins(e.target.checked));
    const ct = $('#wl-city-labels-toggle');
    if (ct) ct.addEventListener('change', (e) => setCityNames(e.target.checked));
    const collapseBtn = $('#wl-collapse-toggle');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        const collapsed = document.body.classList.toggle('wl-panels-collapsed');
        collapseBtn.textContent = collapsed ? '⌃' : '⌄';
        collapseBtn.setAttribute('aria-expanded', String(!collapsed));
      });
    }
    renderCountryInfoEmpty();
    $('#wl-globe-btn').addEventListener('click', toggleGlobe);
    $('#wl-play-btn').addEventListener('click', playTimelapse);
    const rb = $('#wl-reset-btn'); if (rb) rb.addEventListener('click', resetView);
    const mb = $('#wl-measure-btn'); if (mb) mb.addEventListener('click', toggleMeasure);
    const tb = $('#wl-timeline-btn');
    if (tb) tb.addEventListener('click', () => (timelineActive ? exitTimeline() : enterTimeline()));
    const tpb = $('#wl-timeline-play');
    if (tpb) tpb.addEventListener('click', toggleTimelinePlayback);
    const tsb = $('#wl-timeline-speed');
    if (tsb) tsb.addEventListener('click', cycleTimelineSpeed);
    const tr = $('#wl-timeline-range');
    if (tr) tr.addEventListener('input', (e) => { stopTimelinePlayback(); setTimeline(+e.target.value); });
    const tc = $('#wl-timeline-close'); if (tc) tc.addEventListener('click', exitTimeline);
    const lb = $('#wl-lang-btn'); if (lb) lb.addEventListener('click', () => setLang(lang === 'en' ? 'uk' : 'en'));
    const statsBtn = $('#wl-stats-btn');
    const statsPanel = $('#wl-stats-panel');
    const countriesPanel = $('#wl-countries-panel');
    const citiesPanel = $('#wl-cities-panel');
    const europePanel = $('#wl-europe-panel');
    if (statsBtn && statsPanel) {
      statsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setStatsPanel(statsPanel.hidden);
      });
      statsPanel.addEventListener('click', (e) => e.stopPropagation());
      const statsClose = $('#wl-stats-close');
      if (statsClose) statsClose.addEventListener('click', (e) => {
        e.stopPropagation();
        setStatsPanel(false);
      });
    }
    if (countriesPanel) {
      countriesPanel.addEventListener('click', (e) => e.stopPropagation());
      const countriesClose = $('#wl-countries-close');
      if (countriesClose) countriesClose.addEventListener('click', (e) => {
        e.stopPropagation();
        setCountriesPanel(false);
      });
    }
    if (citiesPanel) {
      citiesPanel.addEventListener('click', (e) => e.stopPropagation());
      const citiesClose = $('#wl-cities-close');
      if (citiesClose) citiesClose.addEventListener('click', (e) => {
        e.stopPropagation();
        setCitiesPanel(false);
      });
    }
    if (europePanel) {
      europePanel.addEventListener('click', (e) => e.stopPropagation());
      const europeClose = $('#wl-europe-close');
      if (europeClose) europeClose.addEventListener('click', (e) => {
        e.stopPropagation();
        setEuropePanel(false);
      });
    }
    const infoBtn = $('#wl-info-btn');
    const infoPanel = $('#wl-info-panel');
    const countryPanel = $('#wl-country-info');
    if (countryPanel) countryPanel.addEventListener('click', (e) => e.stopPropagation());
    if (infoBtn && infoPanel) {
      buildAudioCredits();
      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setInfoPanel(infoPanel.hidden);
      });
      infoPanel.addEventListener('click', (e) => e.stopPropagation());
      const infoClose = $('#wl-info-close');
      if (infoClose) infoClose.addEventListener('click', (e) => {
        e.stopPropagation();
        setInfoPanel(false);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          setInfoPanel(false);
          setStatsPanel(false);
        }
      });
    }
    document.addEventListener('pointerdown', closeFloatingPanelsFromOutside, true);
    document.addEventListener('click', closeFloatingPanelsFromOutside, true);
    document.addEventListener('click', () => {
      hidePopup();
      setInfoPanel(false);
      setStatsPanel(false);
      clearCountrySelection();
    });
    window.addEventListener('resize', onResize);
  }

  // intro: fire all arcs at once, drop the pins in, blink, then tuck arcs away
  function introSequence() {
    if (REDUCE) { arcEls.forEach((a) => { a.revealed = true; }); renderArcs();
      setArcs(true, false); mountTitle(); return; }
    pins.forEach((p) => p.el.classList.add('intro-hide'));
    // start blank: hide every arc NOW (same frame) so there's no flash of all arcs
    arcEls.forEach((a) => { a.revealed = true; a.el.interrupt().style('opacity', 0); });
    const drawDur = 1500;
    // …then shoot them ALL out at once on the next frame
    requestAnimationFrame(() => arcEls.forEach((a) => animateArc(a, drawDur)));
    setTimeout(mountTitle, 520);
    setTimeout(() => {                         // all have landed → drop the pins in
      pins.forEach((p, i) => setTimeout(() => {
        p.el.classList.remove('intro-hide');
        p.el.classList.add('dropping');
        p.el.addEventListener('animationend', () => p.el.classList.remove('dropping'), { once: true });
      }, i * 14));
      setTimeout(() => setArcs(true, true), 500);    // blink once, arcs stay ON by default
    }, drawDur + 150);
  }

  let resizeRAF;
  function onResize() {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => {
      measure();
      svg.attr('viewBox', `0 0 ${width} ${height}`);
      flatFit = globeFit = null;   // re-measure framing for the new size
      resetZoom();
      fitKeepCenter();
      render();
      sizePatterns();
      applyPanBounds();
    });
  }

  // limit flat-map panning so you can't drag the world fully off-screen
  // (allow ~20% over-pan past the edges)
  function applyPanBounds() {
    if (!zoom) return;
    if (isGlobe) { zoom.translateExtent([[-Infinity, -Infinity], [Infinity, Infinity]]); return; }
    const b = path.bounds({ type: 'Sphere' });
    if (!isFinite(b[0][0])) return;
    const px = (b[1][0] - b[0][0]) * 0.2, py = (b[1][1] - b[0][1]) * 0.2;
    zoom.translateExtent([[b[0][0] - px, b[0][1] - py], [b[1][0] + px, b[1][1] + py]]);
  }

  function probePinImage() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { usePinImage = true; resolve(); };
      img.onerror = () => { usePinImage = false; resolve(); };
      img.src = '../img/pin.png';
    });
  }

  async function init() {
    popup = $('#wl-popup');
    measure();

    projection = interpolateProjection(d3.geoNaturalEarth1Raw, d3.geoOrthographicRaw)
      .precision(0.2);

    buildContentGeo();
    buildSvg();
    computeFits();
    fitKeepCenter();

    // warm up speech voices (some browsers populate async)
    if ('speechSynthesis' in window) speechSynthesis.getVoices();

    buildLegend();
    wireControls();
    updateGlobeBtn();

    const [world] = await Promise.all([
      d3.json(WORLD_URL),
      probePinImage(),
    ]);
    const crimeaMerged = liberateCrimea(world);   // Crimea is Ukraine (before building features)
    countries = topojson.feature(world, world.objects.countries).features;
    if (crimeaMerged) {
      const ukr = countries.find((f) => f.properties.name === 'Ukraine');
      if (ukr) ukr.geometry = crimeaMerged;
    }
    addMalta();    // 50m map omits Malta (fallback ellipse if no detail geometry)
    addVatican();  // …and Vatican
    applyDetailGeometry();   // upgrade Malta (+Gozo +Comino) & Montenegro outlines
    // only France needs trimming (French Guiana / DOM-TOMs across the ocean);
    // other countries keep all their polygons so Canada stays detailed
    const fr = countries.find((f) => f.properties.name === 'France');
    if (fr) trimOutliers(fr);

    drawCountries();
    buildArcs();
    makePins();
    makeSeas();
    wirePopupHover();
    enableInteractions();
    render();

    introSequence();   // arcs all at once → pins drop → blink → arcs tuck away

    // re-fit once layout has settled (guards against an early/narrow first measure)
    requestAnimationFrame(() => {
      measure();
      svg.attr('viewBox', `0 0 ${width} ${height}`);
      flatFit = globeFit = null;
      fitKeepCenter();
      render();
      applyPanBounds();
    });
    // size the patterns once getBBox is reliable (SVG layout fully resolved)
    setTimeout(sizePatterns, 800);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
