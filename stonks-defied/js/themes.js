// STONKS DEFIED — colorschemes (Sony Ericsson era y2k)
window.SD = window.SD || {};

SD.THEMES = {
  t610: {
    name: 'Y2K BLUE',
    bg: '#061033', bg2: '#0a1a4d',
    grid: '#13275e', gridStrong: '#1c3577',
    map: '#3d7bff', mapFill: 'rgba(61,123,255,0.10)',
    driver: '#ffd60a', frame: '#dfe7fa',
    text: '#cfe0ff', dim: '#5d76b8', accent: '#ffd60a',
    danger: '#ff5d5d', good: '#39e07a',
  },
  lcd: {
    name: 'NOKIA LCD',
    bg: '#a3b284', bg2: '#aebd8e',
    grid: '#93a375', gridStrong: '#86956b',
    map: '#28391b', mapFill: 'rgba(40,57,27,0.10)',
    driver: '#1c2b12', frame: '#2f4423',
    text: '#1c2b12', dim: '#5c6b45', accent: '#1c2b12',
    danger: '#1c2b12', good: '#1c2b12',
  },
  hotline: {
    name: 'HOTLINE',
    bg: '#16002a', bg2: '#22013d',
    grid: '#33124f', gridStrong: '#471a6b',
    map: '#ff3fd8', mapFill: 'rgba(255,63,216,0.10)',
    driver: '#00e8ff', frame: '#d9c8ff',
    text: '#f4d9ff', dim: '#8a5cb8', accent: '#00e8ff',
    danger: '#ff5d7d', good: '#3fffc4',
  },
  matrix: {
    name: 'THE MATRIX',
    bg: '#010604', bg2: '#06120b',
    grid: '#073615', gridStrong: '#0a6b2b',
    map: '#1cff43', mapFill: 'rgba(28,255,67,0.14)',
    driver: '#cfd7ff', frame: '#b4c3ff',
    text: '#26ff45', dim: '#12a838', accent: '#c8d0ff',
    danger: '#7dff8f', good: '#39ff58',
  },
  tron: {
    name: 'TRON GRID',
    locked: true, hint: 'LAND A BACKFLIP',
    bg: '#020716', bg2: '#071329',
    grid: '#073763', gridStrong: '#0b75b7',
    map: '#00e5ff', mapFill: 'rgba(0,229,255,0.12)',
    driver: '#ff9f1c', frame: '#e8fbff',
    text: '#caf7ff', dim: '#4da4c7', accent: '#ff8c1a',
    danger: '#ff406e', good: '#00f6ff',
  },
  goldenbull: {
    name: 'GOLDEN BULL',
    locked: true, hint: 'BEAT ALL 10 CHARTS UNDER PAR',
    bg: '#0b0800', bg2: '#171003',
    grid: '#33270a', gridStrong: '#4b3a10',
    map: '#ffd23f', mapFill: 'rgba(255,210,63,0.12)',
    driver: '#ffffff', frame: '#ffd23f',
    text: '#ffe89a', dim: '#8c7433', accent: '#ffd23f',
    danger: '#ff7d4d', good: '#ffe25d',
  },
};

SD.theme = SD.THEMES.t610;

SD.applyTheme = function (id) {
  const t = SD.THEMES[id] || SD.THEMES.t610;
  SD.theme = t;
  SD.themeId = SD.THEMES[id] ? id : 't610';
  const s = document.documentElement.style;
  s.setProperty('--bg', t.bg);
  s.setProperty('--bg2', t.bg2);
  s.setProperty('--grid', t.grid);
  s.setProperty('--map', t.map);
  s.setProperty('--drv', t.driver);
  s.setProperty('--text', t.text);
  s.setProperty('--dim', t.dim);
  s.setProperty('--accent', t.accent);
  s.setProperty('--good', t.good || '#39e07a');
  s.setProperty('--danger', t.danger || '#ff5d5d');
  if (document.body) {
    document.body.classList.toggle('matrix-theme', SD.themeId === 'matrix');
    document.body.classList.toggle('tron-theme', SD.themeId === 'tron');
  }
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = t.bg;
};
