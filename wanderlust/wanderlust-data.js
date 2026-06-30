/* =====================================================================
   WANDERLUST — travel data (separated from rendering, like games.js).
   Coordinates are [longitude, latitude] (GeoJSON order).

   - places : home bases / anchors (get a star or home pin, and can be the
              origin of a trip's arc). Keyed by the city name used in trip.from.
   - trips  : one journey leg each (from → city). Repeated destinations get
              multiple arcs; multi-leg trips are just several legs sharing dates
              (e.g. Lviv→Batumi, then Batumi→Üçkardeş).
   ===================================================================== */
window.WANDERLUST = {

  /* routes NOT taken by plane (road / train / boat / on-foot) — drawn as
     dotted, near-straight lines instead of bowed flight arcs. Keyed
     `${from}→${city}`; a trip can also opt in per-leg with `ground:true`. */
  groundRoutes: [
    'Batumi→Üçkardeş',                          // day trip across the GE/TR border
    'Lviv→Kraków',                              // 2022 drive into Poland
    'Lviv→Myczkowce',                           // 2015 summer camp
    'Rome→Florence', 'Rome→Venice', 'Rome→Vatican', // 2024 Italy by train/foot
    'Toronto→Tobermory', 'Toronto→Niagara Falls',   // Ontario road trips
    'Uray→Mezhdurechensky',                         // local trip while living there
  ],

  places: {
    Lviv:    { city: 'Lviv',    country: 'Ukraine', coords: [24.0297, 49.8397], icon: 'star',
               hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },
    'Kraków':{ city: 'Kraków',  country: 'Poland',  coords: [19.9450, 50.0647], icon: 'home',
               hello: { native: 'Cześć', translit: 'cheshch', lang: 'pl-PL' } },
    Toronto: { city: 'Toronto', country: 'Canada',  coords: [-79.3470, 43.6510], icon: 'home',
               hello: { native: 'Hello', translit: 'heh-LOH', lang: 'en-CA' } },
  },

  /* Year → pin / arc / legend colour. "Temperature timeline, distinct steps":
     ordered cool → warm so hue reads as time, but every year is its own punchy
     hue (no muddy neighbours). The three big years — 2014 / 2019 / 2024 — are
     the most vivid stops, so they stand out by colour alone. */
  yearColors: {
    2014: '#069aa0',  /* vivid teal    — big year */
    2015: '#5cc7a2',  /* mint          */
    2018: '#a7c64a',  /* lime          */
    2019: '#f6a700',  /* gold          — big year */
    2020: '#ef8a1f',  /* orange        */
    2021: '#b5472f',  /* deep brick    */
    2022: '#e76f51',  /* light coral   */
    2023: '#8c2f2a',  /* dark maroon   */
    2024: '#e51d2a',  /* vivid red     — big year */
    2025: '#9a3350',  /* wine          */
    2026: '#5f2b3a',  /* deep maroon   */
  },

  /* Special grouped journeys — each its own legend filter + colour. */
  eras: {
    pre2014:  { label: 'before 2014', color: '#b56a8f' },   /* dusty magenta — the prologue */
  },

  /* Home countries are coloured by meaning, NOT by year. */
  homeCountries: ['Ukraine', 'Poland', 'Canada'],

  /* Approximate city/municipality populations for pin popups.
     Keys are `${city}|${country}` so same-name places stay unambiguous. */
  cityPopulations: {
    'Lviv|Ukraine': 717000,
    'Kraków|Poland': 804000,
    'Toronto|Canada': 2794000,
    'Český Krumlov|Czechia': 13000,
    'Salzburg|Austria': 157000,
    'Vaduz|Liechtenstein': 5700,
    'Zürich|Switzerland': 443000,
    'Munich|Germany': 1512000,
    'Myczkowce|Poland': 500,
    'Paris|France': 2103000,
    'Warsaw|Poland': 1862000,
    'Batumi|Georgia': 179000,
    'Üçkardeş|Turkey': 200,
    'Valletta|Malta': 5200,
    'Mdina|Malta': 243,
    'Victoria|Malta': 6901,
    'Ramla Beach|Malta': 0,
    'Sliema|Malta': 22591,
    'Comino Island|Malta': 2,
    'Budapest|Hungary': 1685000,
    'Budva|Montenegro': 13000,
    'Kotor|Montenegro': 13347,
    'Porto Montenegro|Montenegro': 0,
    'Podgorica|Montenegro': 179505,
    'Sveti Stefan|Montenegro': 400,
    'Lake Skadar|Montenegro': 0,
    'Sharm El Sheikh|Egypt': 73000,
    'Stockholm|Sweden': 985000,
    'Punta Cana|Dominican Rep.': 54000,
    'Niagara Falls|Canada': 94400,
    'Tobermory|Canada': 4400,
    'Montreal|Canada': 1763000,
    'Vancouver|Canada': 662000,
    'Lisbon|Portugal': 567000,
    'Copenhagen|Denmark': 661000,
    'Prague|Czechia': 1385000,
    'Rome|Italy': 2755000,
    'Florence|Italy': 367000,
    'Venice|Italy': 250000,
    'Vatican|Vatican': 800,
    'Obzor|Bulgaria': 2100,
    'Uray|Russia': 39800,
    'Mezhdurechensky|Russia': 11000,
    'Kyiv|Ukraine': 2952000,
    'Odesa|Ukraine': 1011000,
    'Ivano-Frankivsk|Ukraine': 238000,
    'Synevyrska Poliana|Ukraine': 1354,
    'Yaremche|Ukraine': 8200,
    'Simferopol|Ukraine': 341000,
    'Hurzuf|Ukraine': 8900,
    'Utyos|Ukraine': 300,
    'Yalta|Ukraine': 76700,
    'Yevpatoria|Ukraine': 106000,
    'Berehove (Feodosia)|Ukraine': 1000,
    'Alanya|Turkey': 364000,
    'Antalya|Turkey': 1344000,
    'Pamukkale|Turkey': 347000,
  },

  /* Approximate country context for the compact info panel.
     population = recent country population estimate.
     salaryUsd = rough current monthly net/typical salary after tax, shown as USD
                 and converted client-side to EUR/CAD for quick comparison. */
  countryInfo: {
    Ukraine: { population: 37000000, salaryUsd: 480 },
    Poland: { population: 37500000, salaryUsd: 1300 },
    Canada: { population: 41500000, salaryUsd: 3300 },
    Czechia: { population: 10900000, salaryUsd: 1600 },
    Austria: { population: 9200000, salaryUsd: 2900 },
    Liechtenstein: { population: 40000, salaryUsd: 6200 },
    Switzerland: { population: 9000000, salaryUsd: 6500 },
    Germany: { population: 83600000, salaryUsd: 3100 },
    France: { population: 68400000, salaryUsd: 2600 },
    Georgia: { population: 3700000, salaryUsd: 600 },
    Turkey: { population: 85700000, salaryUsd: 700 },
    Malta: { population: 560000, salaryUsd: 1700 },
    Hungary: { population: 9600000, salaryUsd: 1150 },
    Montenegro: { population: 620000, salaryUsd: 1050 },
    Egypt: { population: 116000000, salaryUsd: 210 },
    Sweden: { population: 10600000, salaryUsd: 3000 },
    'Dominican Rep.': { population: 11400000, salaryUsd: 400 },
    Portugal: { population: 10600000, salaryUsd: 1300 },
    Denmark: { population: 6000000, salaryUsd: 3600 },
    Italy: { population: 59000000, salaryUsd: 1800 },
    Vatican: { population: 800, salaryUsd: null },
    Bulgaria: { population: 6400000, salaryUsd: 1200 },
    Russia: { population: 146000000, salaryUsd: 620 },
  },

  /* Local pronunciation recordings. Keys are `${lang}|${native}`.
     Source files live in audio/hello/ and credits are in audio/hello/ATTRIBUTION.md.
     Missing entries intentionally fall back to Web Speech API. */
  helloAudio: {
    'uk-UA|Привіт': {
      src: 'audio/hello/uk-pryvit.ogg',
      source: 'Wikimedia Commons',
      title: 'Uk-привіт.ogg',
      author: 'Галя Раптова, Nicolas Vion',
      license: 'CC BY 3.0 US',
      url: 'https://commons.wikimedia.org/wiki/File:Uk-%D0%BF%D1%80%D0%B8%D0%B2%D1%96%D1%82.ogg'
    },
    'pl-PL|Cześć': {
      src: 'audio/hello/pl-czesc.ogg',
      source: 'Wikimedia Commons',
      title: 'Pl-cześć.ogg',
      author: 'Tomasz "odder" Kozlowski',
      license: 'CC BY-SA 2.5',
      url: 'https://commons.wikimedia.org/wiki/File:Pl-cze%C5%9B%C4%87.ogg'
    },
    'cs-CZ|Ahoj': {
      src: 'audio/hello/cs-ahoj.oga',
      source: 'Wikimedia Commons',
      title: 'Cs-ahoj.oga',
      author: 'Ivana K, Nicolas Vion / The Shtooka Project',
      license: 'CC BY 2.0 FR',
      url: 'https://commons.wikimedia.org/wiki/File:Cs-ahoj.oga'
    },
    'ar-SA|مرحبا': {
      src: 'audio/hello/ar-marhaba.wav',
      source: 'Wikimedia Commons / Lingua Libre',
      title: 'LL-Q13955 (ara)-Zinou2go-مرحبا.wav',
      author: 'Zinou2go',
      license: 'CC BY-SA 3.0',
      url: 'https://commons.wikimedia.org/wiki/File:LL-Q13955_(ara)-Zinou2go-%D9%85%D8%B1%D8%AD%D8%A8%D8%A7.wav'
    },
    'sr-RS|Здраво': {
      src: 'audio/hello/sr-zdravo.flac',
      source: 'Wikimedia Commons',
      title: 'Sr-здраво!.flac',
      author: 'Saša Vićentijević / The Shtooka Project',
      license: 'CC BY 3.0 US',
      url: 'https://commons.wikimedia.org/wiki/File:Sr-%D0%B7%D0%B4%D1%80%D0%B0%D0%B2%D0%BE!.flac'
    },
    'bg-BG|Здравей': {
      src: 'audio/hello/bg-zdravey.wav',
      source: 'Wikimedia Commons / Lingua Libre',
      title: 'LL-Q7918 (bul)-Kiril kovachev-здравей.wav',
      author: 'Kiril kovachev',
      license: 'CC BY-SA 4.0',
      url: 'https://commons.wikimedia.org/wiki/File:LL-Q7918_(bul)-Kiril_kovachev-%D0%B7%D0%B4%D1%80%D0%B0%D0%B2%D0%B5%D0%B9.wav'
    },
    'en-CA|Hello': {
      src: 'audio/hello/en-hello.ogg',
      source: 'Wikimedia Commons',
      title: 'En-us-hello.ogg',
      author: 'Dvortygirl',
      license: 'Public domain',
      url: 'https://commons.wikimedia.org/wiki/File:En-us-hello.ogg'
    },
    'da-DK|Hej': {
      src: 'audio/hello/da-hej.ogg',
      source: 'Wikimedia Commons',
      title: 'Da-hej.ogg',
      author: 'User:Thrane',
      license: 'CC BY-SA 3.0',
      url: 'https://commons.wikimedia.org/wiki/File:Da-hej.ogg'
    },
    'de-AT|Servus': {
      src: 'audio/hello/de-servus.ogg',
      source: 'Wikimedia Commons',
      title: 'De-servus.ogg',
      author: 'Wikimedia Commons contributor',
      license: 'Public domain',
      url: 'https://commons.wikimedia.org/wiki/File:De-servus.ogg'
    },
    'de-DE|Servus': {
      src: 'audio/hello/de-servus.ogg',
      source: 'Wikimedia Commons',
      title: 'De-servus.ogg',
      author: 'Wikimedia Commons contributor',
      license: 'Public domain',
      url: 'https://commons.wikimedia.org/wiki/File:De-servus.ogg'
    },
    'de-CH|Grüezi': {
      src: 'audio/hello/de-ch-gruezi.ogg',
      source: 'Wikimedia Commons',
      title: 'Gsw-züritüütsch-Grüezi.ogg',
      author: 'Terfili',
      license: 'CC BY-SA 4.0',
      url: 'https://commons.wikimedia.org/wiki/File:Gsw-z%C3%BCrit%C3%BC%C3%BCtsch-Gr%C3%BCezi.ogg'
    },
    'de-CH|Hoi': {
      src: 'audio/hello/de-hoi.ogg',
      source: 'Wikimedia Commons',
      title: 'De-hoi.ogg',
      author: 'Jeuwre',
      license: 'CC BY-SA 4.0',
      url: 'https://commons.wikimedia.org/wiki/File:De-hoi.ogg'
    },
    'es-DO|Hola': {
      src: 'audio/hello/es-hola.oga',
      source: 'Wikimedia Commons',
      title: 'Es-hola.oga',
      author: 'Josemoya',
      license: 'CC BY-SA 3.0',
      url: 'https://commons.wikimedia.org/wiki/File:Es-hola.oga'
    },
    'fr-FR|Bonjour': {
      src: 'audio/hello/fr-bonjour.ogg',
      source: 'Wikimedia Commons',
      title: 'Fr-bonjour.ogg',
      author: 'Vion Nicolas / The Shtooka Project',
      license: 'CC BY 2.0 FR',
      url: 'https://commons.wikimedia.org/wiki/File:Fr-bonjour.ogg'
    },
    'hu-HU|Szia': {
      src: 'audio/hello/hu-szia.ogg',
      source: 'Wikimedia Commons',
      title: 'Hu-szia.ogg',
      author: 'Panda10',
      license: 'CC BY-SA 3.0',
      url: 'https://commons.wikimedia.org/wiki/File:Hu-szia.ogg'
    },
    'it-IT|Ciao': {
      src: 'audio/hello/it-ciao.ogg',
      source: 'Wikimedia Commons',
      title: 'It-ciao.ogg',
      author: 'Wikimedia Commons contributor',
      license: 'CC BY-SA 3.0',
      url: 'https://commons.wikimedia.org/wiki/File:It-ciao.ogg'
    },
    'it-IT|Salve': {
      src: 'audio/hello/it-salve.ogg',
      source: 'Wikimedia Commons / Lingua Libre',
      title: 'LL-Q652 (ita)-XANA000-salve.wav',
      author: 'XANA000',
      license: 'CC0',
      url: 'https://commons.wikimedia.org/wiki/File:LL-Q652_(ita)-XANA000-salve.wav'
    },
    'pt-PT|Olá': {
      src: 'audio/hello/pt-ola.wav',
      source: 'Wikimedia Commons / Lingua Libre',
      title: 'LL-Q5146 (por)-Santamarcanda-olá.wav',
      author: 'Santamarcanda',
      license: 'CC BY-SA 4.0',
      url: 'https://commons.wikimedia.org/wiki/File:LL-Q5146_(por)-Santamarcanda-ol%C3%A1.wav'
    },
    'sv-SE|Hej': {
      src: 'audio/hello/sv-hej.ogg',
      source: 'Wikimedia Commons',
      title: 'Sv-hej.ogg',
      author: 'M. Kihlstedt, N. Vion / The Shtooka Project',
      license: 'CC BY 2.0 FR',
      url: 'https://commons.wikimedia.org/wiki/File:Sv-hej.ogg'
    },
    'tr-TR|Merhaba': {
      src: 'audio/hello/tr-merhaba.ogg',
      source: 'Wikimedia Commons / Lingua Libre',
      title: 'LL-Q256 (tur)-ToprakM-merhaba.wav',
      author: 'ToprakM',
      license: 'CC BY 4.0',
      url: 'https://commons.wikimedia.org/wiki/File:LL-Q256_(tur)-ToprakM-merhaba.wav'
    },
    'ka-GE|გამარჯობა': {
      src: 'https://omniglot.com/soundfiles/georgian/hello_ka.mp3',
      source: 'Omniglot',
      title: 'Useful Georgian phrases: hello_ka.mp3',
      author: 'George Keretchashvili, Giga Paitchadze, Lasse / EasyGeorgian',
      license: 'Omniglot phrasebook audio',
      url: 'https://omniglot.com/language/phrases/georgian.php'
    }
  },

  trips: [
    // 2014 — December Euro road trip (dates approximate within Dec 2014)
    { from: 'Lviv', city: 'Český Krumlov', country: 'Czechia', coords: [14.3150, 48.8127],
      year: 2014, from_date: '2014-12-19', to_date: '2014-12-21', purpose: 'Travel',
      hello: { native: 'Ahoj', translit: 'a-HOY', lang: 'cs-CZ' } },
    { from: 'Český Krumlov', city: 'Salzburg', country: 'Austria', coords: [13.0550, 47.8095],
      year: 2014, from_date: '2014-12-21', to_date: '2014-12-23', purpose: 'Travel',
      hello: { native: 'Servus', translit: 'SER-voos', lang: 'de-AT' } },
    { from: 'Salzburg', city: 'Vaduz', country: 'Liechtenstein', coords: [9.5209, 47.1410],
      year: 2014, from_date: '2014-12-23', to_date: '2014-12-24', purpose: 'Travel',
      hello: { native: 'Hoi', translit: 'hoy', lang: 'de-CH' } },
    { from: 'Vaduz', city: 'Zürich', country: 'Switzerland', coords: [8.5417, 47.3769],
      year: 2014, from_date: '2014-12-24', to_date: '2014-12-27', purpose: 'Travel',
      hello: { native: 'Grüezi', translit: 'GROO-eh-tsi', lang: 'de-CH' } },
    { from: 'Zürich', city: 'Munich', country: 'Germany', coords: [11.5820, 48.1351],
      year: 2014, from_date: '2014-12-27', to_date: '2014-12-30', purpose: 'Travel',
      hello: { native: 'Servus', translit: 'SER-voos', lang: 'de-DE' } },

    // 2015
    { from: 'Lviv', city: 'Myczkowce', country: 'Poland', coords: [22.3600, 49.4100],
      year: 2015, from_date: '2015-08-01', to_date: '2015-08-15', purpose: 'Summer camp',
      hello: { native: 'Cześć', translit: 'cheshch', lang: 'pl-PL' } },

    // 2018
    { from: 'Lviv', city: 'Paris', country: 'France', coords: [2.3522, 48.8566],
      year: 2018, from_date: '2018-06-03', to_date: '2018-06-15', purpose: 'Business',
      hello: { native: 'Bonjour', translit: 'bon-ZHOOR', lang: 'fr-FR' } },

    // 2019
    { from: 'Lviv', city: 'Warsaw', country: 'Poland', coords: [21.0122, 52.2297],
      year: 2019, from_date: '2019-04-03', to_date: '2019-04-07', purpose: 'Travel',
      hello: { native: 'Cześć', translit: 'cheshch', lang: 'pl-PL' } },
    { from: 'Lviv', city: 'Paris', country: 'France', coords: [2.3522, 48.8566],
      year: 2019, from_date: '2019-07-07', to_date: '2019-07-13', purpose: 'Business',
      hello: { native: 'Bonjour', translit: 'bon-ZHOOR', lang: 'fr-FR' } },
    { from: 'Lviv', city: 'Batumi', country: 'Georgia', coords: [41.6168, 41.6367],
      year: 2019, from_date: '2019-08-06', to_date: '2019-08-21', purpose: 'Travel',
      hello: { native: 'გამარჯობა', translit: 'gah-mar-JO-ba', lang: 'ka-GE' } },
    { from: 'Batumi', city: 'Üçkardeş', country: 'Turkey', coords: [41.4500, 41.3500],
      year: 2019, from_date: '2019-08-16', to_date: '2019-08-16', purpose: 'Day trip',
      hello: { native: 'Merhaba', translit: 'mer-ha-BA', lang: 'tr-TR' } },
    { from: 'Lviv', city: 'Valletta', country: 'Malta', coords: [14.5146, 35.8989],
      year: 2019, from_date: '2019-08-29', to_date: '2019-09-05', purpose: 'Travel',
      via: [[8.6821, 50.1109]],   // transit through Frankfurt (no marker)
      hello: { native: 'Bonġu', translit: 'BON-joo', lang: 'mt-MT' } },
    { from: 'Valletta', city: 'Mdina', country: 'Malta', coords: [14.4028, 35.8869],
      year: 2019, from_date: '2019-08-30', to_date: '2019-08-30', purpose: 'Day trip', ground: true, focusOnly: true,
      hello: { native: 'Bonġu', translit: 'BON-joo', lang: 'mt-MT' } },
    { from: 'Valletta', city: 'Victoria', country: 'Malta', coords: [14.2397, 36.0444],
      year: 2019, from_date: '2019-08-31', to_date: '2019-08-31', purpose: 'Day trip', ground: true, focusOnly: true,
      hello: { native: 'Bonġu', translit: 'BON-joo', lang: 'mt-MT' } },
    { from: 'Valletta', city: 'Ramla Beach', country: 'Malta', coords: [14.2846, 36.0612],
      year: 2019, from_date: '2019-08-31', to_date: '2019-08-31', purpose: 'Day trip', ground: true, focusOnly: true,
      hello: { native: 'Bonġu', translit: 'BON-joo', lang: 'mt-MT' } },
    { from: 'Valletta', city: 'Sliema', country: 'Malta', coords: [14.5012, 35.9122],
      year: 2019, from_date: '2019-09-01', to_date: '2019-09-01', purpose: 'Day trip', ground: true, focusOnly: true,
      hello: { native: 'Bonġu', translit: 'BON-joo', lang: 'mt-MT' } },
    { from: 'Valletta', city: 'Comino Island', country: 'Malta', coords: [14.3347, 36.0111],
      year: 2019, from_date: '2019-09-02', to_date: '2019-09-02', purpose: 'Day trip', ground: true, focusOnly: true,
      hello: { native: 'Bonġu', translit: 'BON-joo', lang: 'mt-MT' } },
    { from: 'Lviv', city: 'Paris', country: 'France', coords: [2.3522, 48.8566],
      year: 2019, from_date: '2019-11-03', to_date: '2019-11-09', purpose: 'Business',
      hello: { native: 'Bonjour', translit: 'bon-ZHOOR', lang: 'fr-FR' } },

    // 2020
    { from: 'Lviv', city: 'Budapest', country: 'Hungary', coords: [19.0402, 47.4979],
      year: 2020, from_date: '2020-02-01', to_date: '2020-02-08', purpose: 'Travel',
      hello: { native: 'Szia', translit: 'SEE-yah', lang: 'hu-HU' } },

    // 2021
    { from: 'Lviv', city: 'Budva', country: 'Montenegro', coords: [18.8400, 42.2864],
      year: 2021, from_date: '2021-07-14', to_date: '2021-07-22', purpose: 'Travel',
      hello: { native: 'Здраво', translit: 'ZDRA-vo', lang: 'sr-RS' } },
    { from: 'Budva', city: 'Kotor', country: 'Montenegro', coords: [18.7712, 42.4247],
      year: 2021, from_date: '2021-07-15', to_date: '2021-07-15', purpose: 'Day trip', ground: true, focusOnly: true,
      hello: { native: 'Здраво', translit: 'ZDRA-vo', lang: 'sr-RS' } },
    { from: 'Budva', city: 'Porto Montenegro', country: 'Montenegro', coords: [18.6934, 42.4340],
      year: 2021, from_date: '2021-07-16', to_date: '2021-07-16', purpose: 'Day trip', ground: true, focusOnly: true,
      hello: { native: 'Здраво', translit: 'ZDRA-vo', lang: 'sr-RS' } },
    { from: 'Budva', city: 'Podgorica', country: 'Montenegro', coords: [19.2629, 42.4304],
      year: 2021, from_date: '2021-07-17', to_date: '2021-07-17', purpose: 'Day trip', ground: true, focusOnly: true,
      hello: { native: 'Здраво', translit: 'ZDRA-vo', lang: 'sr-RS' } },
    { from: 'Budva', city: 'Sveti Stefan', country: 'Montenegro', coords: [18.8914, 42.2556],
      year: 2021, from_date: '2021-07-18', to_date: '2021-07-18', purpose: 'Day trip', ground: true, focusOnly: true,
      hello: { native: 'Здраво', translit: 'ZDRA-vo', lang: 'sr-RS' } },
    { from: 'Budva', city: 'Lake Skadar', country: 'Montenegro', coords: [19.3190, 42.1660],
      year: 2021, from_date: '2021-07-19', to_date: '2021-07-19', purpose: 'Day trip', ground: true, focusOnly: true,
      hello: { native: 'Здраво', translit: 'ZDRA-vo', lang: 'sr-RS' } },

    // 2022
    { from: 'Lviv', city: 'Sharm El Sheikh', country: 'Egypt', coords: [34.3300, 27.9158],
      year: 2022, from_date: '2022-01-02', to_date: '2022-01-09', purpose: 'Travel',
      hello: { native: 'مرحبا', translit: 'mar-HA-ba', lang: 'ar-SA' } },
    { from: 'Lviv', city: 'Kraków', country: 'Poland', coords: [19.9450, 50.0647],
      year: 2022, from_date: '2022-02-22', to_date: '2022-05-19', purpose: 'Stay',
      hello: { native: 'Cześć', translit: 'cheshch', lang: 'pl-PL' } },
    { from: 'Kraków', city: 'Stockholm', country: 'Sweden', coords: [18.0686, 59.3293],
      year: 2022, from_date: '2022-05-19', to_date: '2022-05-23', purpose: 'Travel',
      hello: { native: 'Hej', translit: 'hey', lang: 'sv-SE' } },
    { from: 'Kraków', city: 'Toronto', country: 'Canada', coords: [-79.3470, 43.6510],
      year: 2022, from_date: '2022-10-26', to_date: '2022-10-26', purpose: 'Moved',
      hello: { native: 'Hello', translit: 'heh-LOH', lang: 'en-CA' } },

    // 2023
    { from: 'Toronto', city: 'Punta Cana', country: 'Dominican Rep.', coords: [-68.4055, 18.5601],
      year: 2023, from_date: '2023-11-04', to_date: '2023-11-15', purpose: 'Travel',
      hello: { native: 'Hola', translit: 'OH-lah', lang: 'es-DO' } },

    // Canada — domestic trips from Toronto
    { from: 'Toronto', city: 'Niagara Falls', country: 'Canada', coords: [-79.0849, 43.0896],
      year: 2023, from_date: '2023-05-13', to_date: '2023-05-14', purpose: 'Travel',
      hello: { native: 'Hello', translit: 'heh-LOH', lang: 'en-CA' } },
    { from: 'Toronto', city: 'Tobermory', country: 'Canada', coords: [-81.6645, 45.2537],
      year: 2024, from_date: '2024-05-04', to_date: '2024-05-05', purpose: 'Travel',
      hello: { native: 'Hello', translit: 'heh-LOH', lang: 'en-CA' } },
    { from: 'Toronto', city: 'Montreal', country: 'Canada', coords: [-73.5673, 45.5017],
      year: 2024, from_date: '2024-10-20', to_date: '2024-10-25', purpose: 'Travel',
      hello: { native: 'Hello', translit: 'heh-LOH', lang: 'en-CA' } },
    { from: 'Toronto', city: 'Montreal', country: 'Canada', coords: [-73.5673, 45.5017],
      year: 2025, from_date: '2025-07-04', to_date: '2025-07-12', purpose: 'Travel', ground: true,
      hello: { native: 'Hello', translit: 'heh-LOH', lang: 'en-CA' } },
    { from: 'Toronto', city: 'Niagara Falls', country: 'Canada', coords: [-79.0849, 43.0896],
      year: 2026, from_date: '2026-02-08', to_date: '2026-02-08', purpose: 'Travel',
      hello: { native: 'Hello', translit: 'heh-LOH', lang: 'en-CA' } },
    { from: 'Toronto', city: 'Vancouver', country: 'Canada', coords: [-123.1207, 49.2827],
      year: 2026, from_date: '2026-07-01', to_date: '2026-07-05', purpose: 'Travel',
      hello: { native: 'Hello', translit: 'heh-LOH', lang: 'en-CA' } },

    // ★ Euro Trip 2024 — the favourite (one big chain, with 3 side trips from Rome)
    { from: 'Toronto', city: 'Lisbon', country: 'Portugal', coords: [-9.1393, 38.7223],
      year: 2024, from_date: '2024-09-11', to_date: '2024-09-12', purpose: 'Travel',
      hello: { native: 'Olá', translit: 'oh-LAH', lang: 'pt-PT' } },
    { from: 'Lisbon', city: 'Copenhagen', country: 'Denmark', coords: [12.5683, 55.6761],
      year: 2024, from_date: '2024-09-12', to_date: '2024-09-16', purpose: 'Dota 2 · The International',
      hello: { native: 'Hej', translit: 'hye', lang: 'da-DK' } },
    { from: 'Copenhagen', city: 'Prague', country: 'Czechia', coords: [14.4378, 50.0755],
      year: 2024, from_date: '2024-09-17', to_date: '2024-09-19', purpose: 'Old friends',
      hello: { native: 'Ahoj', translit: 'a-HOY', lang: 'cs-CZ' } },
    { from: 'Prague', city: 'Munich', country: 'Germany', coords: [11.5820, 48.1351],
      year: 2024, from_date: '2024-09-20', to_date: '2024-09-29', purpose: 'Family · Oktoberfest',
      hello: { native: 'Servus', translit: 'SER-voos', lang: 'de-DE' } },
    { from: 'Munich', city: 'Rome', country: 'Italy', coords: [12.4964, 41.9028],
      year: 2024, from_date: '2024-09-30', to_date: '2024-10-10', purpose: 'Travel',
      hello: { native: 'Ciao', translit: 'chow', lang: 'it-IT' } },
    { from: 'Rome', city: 'Florence', country: 'Italy', coords: [11.2558, 43.7696],
      year: 2024, from_date: '2024-10-05', to_date: '2024-10-05', purpose: 'Day trip',
      hello: { native: 'Ciao', translit: 'chow', lang: 'it-IT' } },
    { from: 'Rome', city: 'Venice', country: 'Italy', coords: [12.3155, 45.4408],
      year: 2024, from_date: '2024-10-06', to_date: '2024-10-08', purpose: 'Travel',
      hello: { native: 'Ciao', translit: 'chow', lang: 'it-IT' } },
    { from: 'Rome', city: 'Vatican', country: 'Vatican', coords: [12.4534, 41.9029],
      year: 2024, from_date: '2024-10-09', to_date: '2024-10-10', purpose: 'Travel',
      hello: { native: 'Salve', translit: 'SAL-veh', lang: 'it-IT' } },
    { from: 'Rome', city: 'Warsaw', country: 'Poland', coords: [21.0122, 52.2297],
      year: 2024, from_date: '2024-10-11', to_date: '2024-10-13', purpose: 'Sister',
      hello: { native: 'Cześć', translit: 'cheshch', lang: 'pl-PL' } },
    { from: 'Warsaw', city: 'Toronto', country: 'Canada', coords: [-79.3470, 43.6510],
      year: 2024, from_date: '2024-10-14', to_date: '2024-10-14', purpose: 'Return',
      hello: { native: 'Hello', translit: 'heh-LOH', lang: 'en-CA' } },

    // Bulgaria — Obzor, twice (2009 is pre-2014)
    { from: 'Lviv', city: 'Obzor', country: 'Bulgaria', coords: [27.8869, 42.8133],
      era: 'pre2014', from_date: '2009-07-01', to_date: '2009-07-12', purpose: 'Travel',
      hello: { native: 'Здравей', translit: 'ZDRA-vey', lang: 'bg-BG' } },
    { from: 'Lviv', city: 'Obzor', country: 'Bulgaria', coords: [27.8869, 42.8133],
      year: 2014, from_date: '2014-07-01', to_date: '2014-07-12', purpose: 'Travel',
      hello: { native: 'Здравей', translit: 'ZDRA-vey', lang: 'bg-BG' } },

    // before 2014 — lived in russia 2001–2003 (lowercase, no greeting audio).
    // reached via transit through Moscow and Tyumen (no markers for those).
    { from: 'Lviv', city: 'Uray', country: 'Russia', coords: [64.7956, 60.1342],
      era: 'pre2014', icon: 'home', via: [[37.6173, 55.7558], [65.5343, 57.1553]],
      from_date: '2001-01-01', to_date: '2003-06-30', purpose: 'Lived' },
    { from: 'Uray', city: 'Mezhdurechensky', country: 'Russia', coords: [65.9450, 59.6133],
      era: 'pre2014', from_date: '2001-01-01', to_date: '2003-06-30', purpose: 'Travel' },
  ],

  /* Standalone pins (no arc) — places visited without a full trip record. */
  markers: [
    // Ukraine — domestic, no specific info
    { city: 'Kyiv', country: 'Ukraine', coords: [30.5234, 50.4501],
      date: 'Summer 2016 · USL basketball festival',
      hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },
    { city: 'Odesa', country: 'Ukraine', coords: [30.7233, 46.4825],
      date: 'Summer 2016 · USL basketball festival',
      hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },
    { city: 'Ivano-Frankivsk', country: 'Ukraine', coords: [24.7111, 48.9226], year: 2020,
      date: '2020',
      hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },
    { city: 'Synevyrska Poliana', country: 'Ukraine', coords: [23.6864, 48.5844], year: 2021,
      date: '12 Jun 2021', hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },
    { city: 'Yaremche', country: 'Ukraine', coords: [24.5575, 48.4517], year: 2020,
      date: '2020 · road trip', hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },

    // before 2014 — Crimea (Ukraine)
    { city: 'Simferopol', country: 'Ukraine', coords: [34.1024, 44.9521], era: 'pre2014',
      hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },
    { city: 'Hurzuf', country: 'Ukraine', coords: [34.2772, 44.5469], era: 'pre2014',
      hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },
    { city: 'Utyos', country: 'Ukraine', coords: [34.29, 44.62], era: 'pre2014',
      hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },
    { city: 'Yalta', country: 'Ukraine', coords: [34.1664, 44.4952], era: 'pre2014',
      hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },
    { city: 'Yevpatoria', country: 'Ukraine', coords: [33.3575, 45.1903], era: 'pre2014',
      date: '2000 (first time)', hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },
    { city: 'Berehove (Feodosia)', country: 'Ukraine', coords: [35.32, 45.05], era: 'pre2014',
      hello: { native: 'Привіт', translit: 'pry-VEET', lang: 'uk-UA' } },

    // before 2014 — Turkey
    { city: 'Alanya', country: 'Turkey', coords: [31.9988, 36.5444], era: 'pre2014', date: '2013',
      hello: { native: 'Merhaba', translit: 'mer-ha-BA', lang: 'tr-TR' } },
    { city: 'Antalya', country: 'Turkey', coords: [30.7133, 36.8969], era: 'pre2014', date: '2010, 2011',
      hello: { native: 'Merhaba', translit: 'mer-ha-BA', lang: 'tr-TR' } },
    { city: 'Pamukkale', country: 'Turkey', coords: [29.1208, 37.9203], era: 'pre2014', date: '2010',
      hello: { native: 'Merhaba', translit: 'mer-ha-BA', lang: 'tr-TR' } },
  ],

  /* Sea / ocean labels. [lon, lat] anchor; minK = zoom level at which it appears
     (bigger waters show first, smaller ones reveal as you zoom further in). */
  seas: [
    { name: 'Atlantic Ocean', coords: [-38, 34], minK: 1.5 },
    { name: 'Mediterranean Sea', coords: [17, 35], minK: 1.8 },
    { name: 'Black Sea', coords: [34, 43.3], minK: 1.8 },
    { name: 'Caribbean Sea', coords: [-75, 14.5], minK: 1.8 },
    { name: 'Baltic Sea', coords: [19.5, 58], minK: 2.2 },
    { name: 'North Sea', coords: [3, 56], minK: 2.2 },
    { name: 'Caspian Sea', coords: [50.5, 41.5], minK: 2.2 },
    { name: 'Norwegian Sea', coords: [3, 67], minK: 2.2 },
    { name: 'Red Sea', coords: [37, 21], minK: 2.2 },
    { name: 'Adriatic Sea', coords: [15.5, 43], minK: 3 },
    { name: 'Aegean Sea', coords: [25, 38.3], minK: 3.5 },
    { name: 'Ionian Sea', coords: [18.5, 38], minK: 3.5 },
    { name: 'Tyrrhenian Sea', coords: [12, 40], minK: 3.5 },
    { name: 'Sea of Azov', coords: [36.3, 46], minK: 3.5 },
    { name: 'Sea of Marmara', coords: [28, 40.7], minK: 5 },
    { name: 'Ligurian Sea', coords: [8.6, 43.5], minK: 5 },
    { name: 'Bay of Biscay', coords: [-5, 45.5], minK: 4 },
    { name: 'English Channel', coords: [-0.5, 50], minK: 4.5 },
    { name: 'Irish Sea', coords: [-5, 53.6], minK: 5 },
  ],

  /* Countries that get the soft pattern fill (matched against world-atlas
     feature.properties.name). Malta is omitted by the 110m map, so it only
     gets a pin. */
  visitedCountries: [
    'Ukraine', 'Poland', 'France', 'Hungary', 'Montenegro', 'Egypt',
    'Canada', 'Georgia', 'Turkey', 'Sweden', 'Dominican Rep.', 'Malta',
    'Czechia', 'Austria', 'Liechtenstein', 'Switzerland', 'Germany',
    'Bulgaria', 'Russia', 'Portugal', 'Denmark', 'Italy', 'Vatican',
  ],
};
