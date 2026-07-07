// STONKS DEFIED — levels: real historical charts, terrain builder, ticker API
window.SD = window.SD || {};

(function () {
  const L = SD.levels = {};

  // ---- cherry-picked REAL historical closes (Yahoo Finance) ----
  // Windows chosen so the chart rides like a proper Gravity Defied track.
  L.PRESETS = [
    {
      id: 'KO', sym: 'KO', company: 'The Coca-Cola Company',
      level: 'Carbonation Highway', nick: 'DIVIDEND CRUISE', era: '2010-2019 / MONTHLY',
      par: 25, amp: 170, dx: 52, slope: 1.15, smooth: 1, routeBoost: 0.28, momentum: 0.10,
      prices: [27.12,26.46,27.36,26.44,25.47,26.2,27.77,28.79,30.29,31.42,32.78,31.43,32.08,33.28,33.64,33.5,33.81,34.69,34.28,34.06,33.71,34.88,33.79,35.16,37.24,37.93,38.03,39.72,38.69,37.75,37.37,37.8,36.36,37.28,38.93,40.84,41.62,40.04,40.1,38.98,37.98,39.17,40.1,41.25,37.83,38.26,39.13,40.83,41.5,40.84,40.72,42.36,42.06,44.42,42.34,41.27,42.92,40.55,40.69,40.25,40.16,40.03,39.87,41.86,42.59,42.95,42.93,43.61,46.01,44.73,44.91,44.46,43.51,42.66,42.38,40.59,41.43,41.6,42.03,42.62,43.94,45.2,45.37,45.66,45.17,45.78,45.79,45.88,47.27,43.25,43.37,43.14,43.38,45.33,45.34,45.73,47.55,50.15,47.38,47.9,45.6,47.45,49.09,49.93,51.85,54.16,54.61,54.43,53.49,55.35],
    },
    {
      id: 'AAPL', sym: 'AAPL', company: 'Apple Inc.',
      level: 'Cupertino Staircase', nick: 'STEADY GAINS', era: '2019-2021 / WEEKLY',
      par: 31, amp: 240, dx: 52, slope: 1.35, smooth: 1, routeBoost: 0.38, momentum: 0.14,
      prices: [36.98,38.03,39.12,42.56,42.42,43.13,43.91,45.13,47.09,47.68,50.0,50.36,51.15,51.88,46.2,45.09,43.36,48.24,49.17,50.32,50.29,51.57,52.32,48.6,51.26,51.84,52.3,54.11,54.77,56.01,57.49,59.71,62.15,64.68,66.25,66.61,66.17,68.36,70.81,73.14,76.82,79.57,77.23,78.36,80.97,74.6,72.23,62.87,56.43,64.15,67.09,69.1,71.21,75.91,78.74,79.8,81.66,85.09,89.74,91.48,94.78,98.26,98.73,111.2,114.4,126.5,124.8,116.3,110.8,115.7,122.5,115.9,112.6,114.0,120.2,115.5,122.0,121.9,130.4,132.6,129.0,130.1,138.6,136.4,134.3,126.8,119.3,124.0,122.7,124.4,131.2,134.8,133.4,127.3,126.5,125.8,125.7,130.8,133.5,138.8,144.3,145.1,146.5,146.2,150.6,151.9,154.3,147.8,144.3,139.8,143.6,147.6,148.9,150.4,154.9,160.4,166.0,173.5,177.0,178.2],
    },
    {
      id: 'TSLA', sym: 'TSLA', company: 'Tesla, Inc.',
      level: 'Battery Day Backflip', nick: 'VOLATILITY RIDE', era: '2020-2022 / WEEKLY',
      par: 32, amp: 300, dx: 50, slope: 1.55, smooth: 0, routeBoost: 0.44, momentum: 0.18,
      prices: [31.27,36.05,37.3,57.7,52.99,55.06,50.19,40.49,31.11,34.68,37.56,46.68,49.8,51.33,53.93,54.35,58.67,63.5,66.26,71.51,94.51,102.9,99.41,98.0,107.4,132.8,154.3,125.8,143.9,139.7,141.6,143.6,141.5,140.1,142.7,180.7,199.1,213.8,213.0,224.9,261.7,281.9,294.2,288.1,271.1,233.2,227.5,225.2,221.1,216.3,243.4,241.7,233.2,215.5,195.4,202.2,205.2,200.2,208.5,224.5,221.8,220.3,220.9,236.6,223.4,238.1,248.2,248.6,248.3,259.6,266.6,292.0,359.3,356.1,351.7,373.5,362.0,321.3,325.4,374.3,358.4,336.6,308.3,307.9,303.5,280.0,278.3,270.5,344.0,364.7,329.6,327.8,298.8,269.7,243.8,232.7,241.0,223.5,235.0,233.0,234.2,250.9,288.7,283.9,303.2,284.3,274.6,296.6,293.8,253.1,217.2,221.3,226.9,191.7,183.5,178.2,178.6,152.2,118.0,123.2],
    },
    {
      id: 'NVDA', sym: 'NVDA', company: 'NVIDIA Corporation',
      level: 'CUDA Launch Ramp', nick: 'AI RAMP', era: '2022-2024 / WEEKLY',
      par: 28, amp: 330, dx: 50, slope: 1.62, smooth: 0, routeBoost: 0.50, momentum: 0.20,
      prices: [12.14,12.08,11.23,12.47,13.83,14.16,16.33,15.41,16.27,16.88,17.0,16.57,15.21,14.61,14.86,16.9,17.84,20.36,21.1,21.26,21.39,23.29,23.89,22.97,25.73,26.78,27.78,27.04,26.76,27.12,27.75,28.68,28.34,31.26,38.95,39.33,38.77,42.69,42.21,42.3,42.5,45.47,44.31,46.75,44.68,40.85,43.3,46.02,48.51,45.57,43.9,41.61,43.5,45.76,45.46,41.39,40.5,45.01,48.33,49.3,47.78,46.76,47.51,48.89,48.83,49.52,49.1,54.71,59.49,61.03,66.16,72.13,72.61,78.82,82.28,87.53,87.84,94.29,90.36,88.01,88.19,76.2,87.74,88.79,89.88,92.48,106.5,109.6,120.9,131.9,126.6,123.5],
    },
    {
      id: 'GME', sym: 'GME', company: 'GameStop Corp.',
      level: 'Short Squeeze Spine', nick: 'THE SQUEEZE', era: '2020-2021 / DAILY',
      par: 34, amp: 350, dx: 48, slope: 1.75, smooth: 0, log: true, routeBoost: 0.58, momentum: 0.22,
      prices: [1.77,2.23,2.37,2.4,2.52,2.38,2.52,2.57,2.45,2.35,2.29,2.71,3.06,2.96,3.05,3.42,3.45,3.48,3.68,3.65,3.22,2.95,2.7,2.73,2.78,2.88,2.9,2.8,2.84,2.79,2.95,2.92,3.15,3.47,3.57,4.03,4.04,4.14,4.13,4.09,3.83,3.53,3.26,3.45,3.57,3.89,4.3,5.12,5.12,4.89,4.78,4.37,4.43,4.53,4.6,4.99,8.48,9.12,9.82,10.52,16.97,32.21,78.47,71.59,49.73,22.91,13.81,15.32,12.61,12.78,13.02,11.84,10.17,10.93,12.03,25.29,25.63,29.81,31.08,33.77,48.51,63.89,65.04,61.09,52.22,51.59,50.1,47.34,31.76,45.68,45.31,48.21,47.8,46.54,44.79,41.66,36.18,37.02,39.7,39.28,40.01,39.21,37.79,42.68,44.58,43.93,41.51,40.14,40.11,39.71,36.37,36.69,40.45,45.15,43.5,42.7,44.63,52.57,62.12,55.5],
    },
    {
      id: 'BTC', sym: 'BTC-USD', company: 'Bitcoin',
      level: 'Halving Cliffside', nick: 'LASER EYES, PAPER HANDS', era: '2020-2022 / WEEKLY',
      par: 39, amp: 360, dx: 47, slope: 1.85, smooth: 0, log: true, routeBoost: 0.64, momentum: 0.26,
      prices: [8163.69,8827.76,8745.89,9358.59,9180.96,10208.24,10142,9341.71,8787.79,7909.73,5225.63,6734.8,6438.64,7176.41,6842.43,6880.32,7807.06,9003.07,8804.48,9729.04,8835.05,9529.8,9795.7,9538.02,9629.66,9137.99,9252.28,9243.21,9374.89,10912.82,11205.89,11410.53,11991.23,11366.13,11970.48,10131.52,10796.95,10538.46,10844.64,10604.41,11425.9,11916.33,13654.22,13950.3,15290.9,17645.41,19107.46,18803,18321.14,19417.08,23783.03,27362.44,33992.43,33922.96,36069.8,32569.85,35510.29,46481.11,49199.87,48824.43,48378.99,54824.12,56804.9,54738.95,58917.69,58192.36,63503.46,56473.03,55033.12,53333.54,56704.57,42909.4,38402.22,36684.93,33472.63,40406.27,32505.66,35867.78,34235.2,32702.03,29807.35,39406.94,38152.98,45585.03,44695.36,47706.12,47166.69,46811.13,47092.49,40693.68,41034.54,51514.81,56041.06,64261.99,60363.79,63226.4,66971.83,60161.25,57569.07,57005.43,50700.09,46612.63,48936.61,47588.86,45897.57,42735.86,42375.63,36954,38743.27,44118.45,44575.2,38286.03,44354.64,38737.27,39338.79,42358.81,47465.73,45555.99,40127.18,41502.75,38117.46,37750.45,31022.91,30425.86,29655.59,31792.31,31155.48,22206.79,20710.6,20280.63,20190.12,19323.91,23389.43,21239.75,22978.12,23164.32,23883.29,21528.09,19796.81,18837.67,20296.71,18890.79,19110.55,20336.84,19051.42,19334.42,20095.86,20485.27,18541.27,16884.61,16189.77,16444.98,17089.5,17781.32,16906.3,16717.17,16547.5],
    },
    {
      id: 'SPY', sym: 'SPY', company: 'SPDR S&P 500 ETF Trust',
      level: 'Lehman Gap', nick: 'BEAR MARKET BOBSLED', era: '2007-2009 / WEEKLY',
      par: 28, amp: 285, dx: 50, slope: 1.55, smooth: 0, routeBoost: 0.46, momentum: 0.18,
      prices: [155.85,156.33,149.67,153.62,151.2,145.14,145.79,144.13,148.66,150.91,147.17,148.13,147.3,141.31,140.15,132.06,133.04,139.58,133.07,135.14,135.62,133.82,129.71,129.61,132.08,131.51,136.89,133.38,138.48,139.6,141.51,138.9,142.66,137.64,140.35,136.29,136.15,131.58,127.53,126.31,123.84,125.98,125.48,126.16,129.37,130.17,129.65,128.79,124.42,126.09,124.12,120.85,110.34,88.5,93.21,87.04,96.83,93.86,86.62,79.52,90.09,87.93,88.99,88.19,87.16,92.96,89.09,85.06,83.11,82.83,86.98,82.76,77.42,73.93,68.92,76.09,76.71,81.61,84.26,85.81,87.08,86.66,87.89,92.98,88.71,89.02,92.53,94.55,95.08,92.04,91.84,91.95],
    },
    {
      id: 'META', sym: 'META', company: 'Meta Platforms, Inc.',
      level: 'Metaverse Drawdown', nick: 'ZUCKERBERG VALLEY', era: '2021-2023 / WEEKLY',
      par: 32, amp: 320, dx: 49, slope: 1.7, smooth: 0, routeBoost: 0.54, momentum: 0.20,
      prices: [376.26,378.69,364.72,352.96,343.01,330.05,324.76,324.61,323.57,341.13,340.89,345.3,333.12,306.84,329.75,333.79,335.24,336.35,331.79,331.9,303.17,301.71,237.09,219.55,206.16,210.48,200.06,187.61,216.49,221.82,224.85,222.33,210.18,184.11,200.47,203.77,198.62,193.54,195.13,190.78,175.57,163.74,170.16,160.03,170.88,164.7,169.27,159.1,167.11,180.5,167.96,161.78,160.32,169.15,146.29,140.41,135.68,133.45,126.76,130.01,99.2,90.79,113.02,112.05,111.41,123.49,115.9,119.43,118.04,120.34,130.02,136.98,139.37,151.74,186.53,174.15,172.88,170.39,185.25,179.51,195.61,206.01,211.94,216.1,221.49,212.89,240.32,232.78,233.81,245.64,262.04,272.61,264.95,281,288.73,286.98,290.53,308.87,294.26,325.48,310.73,301.64,283.25,285.5,296.38,297.89,300.31,299.08,300.21,315.43,314.69,308.65,296.73,314.6,328.77,335.04,338.23,324.82,332.75,334.92,353.39,353.96],
    },
    {
      id: 'AMZN', sym: 'AMZN', company: 'Amazon.com, Inc.',
      level: 'Dotcom Ripper', nick: 'ONE-CLICK WHIPLASH', era: '1997-2001 / WEEKLY',
      par: 36, amp: 345, dx: 47, slope: 1.9, smooth: 0, log: true, routeBoost: 0.62, momentum: 0.24,
      prices: [0.09,0.08,0.08,0.08,0.08,0.08,0.07,0.1,0.11,0.11,0.11,0.12,0.11,0.11,0.11,0.12,0.13,0.18,0.2,0.21,0.2,0.2,0.18,0.25,0.25,0.22,0.21,0.22,0.21,0.23,0.23,0.22,0.23,0.25,0.21,0.24,0.25,0.25,0.25,0.26,0.26,0.32,0.32,0.33,0.35,0.35,0.39,0.4,0.4,0.35,0.39,0.38,0.37,0.36,0.37,0.37,0.51,0.63,0.79,1.03,0.83,1,1.04,0.92,0.97,1.02,1.08,0.88,0.72,0.63,0.66,0.91,0.92,0.76,0.83,0.97,1.05,1.04,1.06,1.51,1.81,1.57,1.86,2.39,2.71,2.68,4.01,3.51,3.08,2.92,2.9,2.61,2.55,3.2,3.04,3.33,3.38,3.48,4.28,4.57,4.75,5.25,4.3,3.41,3.31,3.21,2.97,2.71,2.65,2.78,2.75,3.1,3.14,3.44,2.86,2.5,2.24,2.44,2.84,3.21,3.12,3.33,3.19,3.25,3.86,4.46,3.75,3.93,3.53,3.25,3.75,3.9,4.66,4.33,5.33,4.7,4.5,3.81,3.48,3.21,3.1,3.08,3.93,3.81,3.24,3.46,3.13,3.34,3.24,3.63,3.35,3.38,2.34,2.62,2.76,2.92,2.69,2.63,2.33,2.89,2.61,2.3,1.69,1.82,1.81,2.13,2.06,1.5,1.63,1.68,1.95,2,2.08,2.15,2.18,2.07,1.92,1.58,1.42,1.54,1.78,1.88,1.5,1.37,1.45,1.23,1.17,1.14,0.78,0.78,0.73,0.88,1,0.98,0.72,0.67,0.68,0.59,0.5,0.61,0.55,0.51,0.51,0.42,0.73,0.79,0.76,0.88,0.73,0.74,0.85,0.85,0.79,0.62,0.62,0.71,0.76,0.85,0.85,0.61,0.61,0.5,0.5,0.51,0.45,0.43,0.43,0.37,0.3,0.36,0.4,0.4,0.38,0.34,0.36,0.45,0.45,0.57,0.59,0.55,0.5,0.55,0.54],
    },
  ];

  // ---- deterministic RNG ----
  function hash(str) {
    let h = 1779033703;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Catmull-Rom resample of an array to n points
  function resample(arr, n) {
    const m = arr.length;
    if (m === n) return arr.slice();
    const out = new Array(n);
    for (let k = 0; k < n; k++) {
      const t = (k / (n - 1)) * (m - 1);
      const i = Math.min(m - 2, Math.floor(t));
      const f = t - i;
      const p0 = arr[Math.max(0, i - 1)], p1 = arr[i], p2 = arr[i + 1], p3 = arr[Math.min(m - 1, i + 2)];
      out[k] = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
    }
    return out;
  }

  function trendAt(arr, idx, radius) {
    let sum = 0, count = 0;
    for (let j = idx - radius; j <= idx + radius; j++) {
      const k = Math.max(0, Math.min(arr.length - 1, j));
      sum += arr[k];
      count++;
    }
    return sum / count;
  }

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function inferDateScale(def, count) {
    if (def.dates && def.dates.length) return { explicit: def.dates };
    const m = String(def.era || '').match(/(\d{4})\s*-\s*(\d{4})/);
    const startYear = m ? Number(m[1]) : new Date().getFullYear() - 1;
    const endYear = m ? Number(m[2]) : startYear;
    const upper = String(def.era || '').toUpperCase();
    const stepDays = upper.includes('DAILY') ? 1 : upper.includes('MONTHLY') ? 30.4375 : 7;
    const start = Date.UTC(startYear, 0, 1);
    const naturalEnd = start + Math.max(0, count - 1) * stepDays * 86400000;
    const eraEnd = Date.UTC(endYear, 11, 31);
    return { start, end: Math.max(naturalEnd, eraEnd) };
  }

  function fmtDate(ms) {
    const d = new Date(ms);
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  // ---- terrain builder: prices -> rideable heightmap ----
  const PRE = 6, POST = 9; // flat platform columns before/after the chart
  L.buildTerrain = function (def) {
    const n = Math.min(def.points || 150, Math.max(72, def.prices.length));
    const raw = resample(def.prices, n);
    const dateScale = inferDateScale(def, n);
    const dx = def.dx || 55;
    const amp = def.amp || 260;

    // Shape values (optionally log-scaled for wild movers), then normalize.
    // The route still comes from the real closes, but we add back some
    // high-frequency contour so the chart becomes a Gravity Defied track.
    const base = raw.map(def.log ? (v => Math.log(Math.max(v, 1e-6))) : (v => v));
    const routeBoost = def.routeBoost == null ? 0.34 : def.routeBoost;
    const momentum = def.momentum == null ? 0.12 : def.momentum;
    const radius = def.trendWindow || 5;
    let vals = base.map((v, i) => {
      const trend = trendAt(base, i, radius);
      const prev = base[Math.max(0, i - 1)];
      const next = base[Math.min(base.length - 1, i + 1)];
      return v + (v - trend) * routeBoost + (next - prev) * momentum;
    });
    for (let pass = 0; pass < (def.smooth || 1); pass++) {
      const s = vals.slice();
      for (let i = 1; i < n - 1; i++) vals[i] = (s[i - 1] + 2 * s[i] + s[i + 1]) / 4;
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const range = (hi - lo) || 1;

    // world ys (y-down): higher price = higher ground (smaller y)
    const ys = new Array(PRE + n + POST);
    const prices = new Array(PRE + n + POST);
    const dates = new Array(PRE + n + POST);
    for (let i = 0; i < n; i++) {
      ys[PRE + i] = 400 - ((vals[i] - lo) / range) * amp;
      prices[PRE + i] = raw[i];
      if (dateScale.explicit) {
        dates[PRE + i] = dateScale.explicit[Math.min(dateScale.explicit.length - 1, Math.round((i / Math.max(1, n - 1)) * (dateScale.explicit.length - 1)))];
      } else {
        dates[PRE + i] = fmtDate(dateScale.start + (dateScale.end - dateScale.start) * (i / Math.max(1, n - 1)));
      }
    }
    for (let i = 0; i < PRE; i++) { ys[i] = ys[PRE]; prices[i] = raw[0]; dates[i] = dates[PRE]; }
    for (let i = 0; i < POST; i++) { ys[PRE + n + i] = ys[PRE + n - 1]; prices[PRE + n + i] = raw[n - 1]; dates[PRE + n + i] = dates[PRE + n - 1]; }

    // slope clamp so any chart stays rideable (forward + backward passes)
    const maxDy = dx * (def.slope || 1.35);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < ys.length; i++)
        ys[i] = Math.max(ys[i - 1] - maxDy, Math.min(ys[i - 1] + maxDy, ys[i]));
      for (let i = ys.length - 2; i >= 0; i--)
        ys[i] = Math.max(ys[i + 1] - maxDy, Math.min(ys[i + 1] + maxDy, ys[i]));
    }

    const x0 = 0;
    const N = ys.length;
    let maxY = -Infinity, minY = Infinity;
    for (const y of ys) { if (y > maxY) maxY = y; if (y < minY) minY = y; }
    let pmin = Infinity, pmax = -Infinity;
    for (const p of raw) { if (p < pmin) pmin = p; if (p > pmax) pmax = p; }

    const ter = {
      def, ys, dx, x0, N,
      maxY, minY, pmin, pmax,
      startX: x0 + 2.2 * dx,
      finishX: x0 + (PRE + n + 2) * dx,
      endX: x0 + (N - 1) * dx,
      length: (N - 1) * dx,
    };

    ter.groundY = function (x) {
      let t = (x - x0) / dx;
      const i = Math.max(0, Math.min(N - 2, Math.floor(t)));
      const f = Math.max(0, Math.min(1, t - i));
      return ys[i] + (ys[i + 1] - ys[i]) * f;
    };

    ter.priceAt = function (x) {
      const i = Math.max(0, Math.min(N - 1, Math.round((x - x0) / dx)));
      return prices[i];
    };

    ter.dateAt = function (x) {
      const i = Math.max(0, Math.min(N - 1, Math.round((x - x0) / dx)));
      return dates[i] || '';
    };

    // deepest circle-vs-heightmap contact; normal points away from ground (up-ish)
    ter.contact = function (px, py, r) {
      const i0 = Math.max(0, Math.floor((px - r - x0) / dx) - 1);
      const i1 = Math.min(N - 2, Math.floor((px + r - x0) / dx) + 1);
      let best = null;
      for (let i = i0; i <= i1; i++) {
        const ax = x0 + i * dx, ay = ys[i];
        const sx = dx, sy = ys[i + 1] - ay;
        const len = Math.hypot(sx, sy);
        // upward segment normal
        let nx = sy / len, ny = -sx / len;
        if (ny > 0) { nx = -nx; ny = -ny; }
        let t = ((px - ax) * sx + (py - ay) * sy) / (len * len);
        if (t > 0 && t < 1) {
          const sd = (px - ax) * nx + (py - ay) * ny; // signed height above line
          const pen = r - sd;
          if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx, ny };
        } else {
          const cx = ax + sx * Math.max(0, Math.min(1, t));
          const cy = ay + sy * Math.max(0, Math.min(1, t));
          const ddx = px - cx, ddy = py - cy;
          const d = Math.hypot(ddx, ddy);
          if (d < r) {
            const pen = r - d;
            let cnx, cny;
            if (d > 1e-6) { cnx = ddx / d; cny = ddy / d; }
            else { cnx = nx; cny = ny; }
            if (cny > 0.2) { cnx = nx; cny = ny; } // never push down through ground
            if (!best || pen > best.pen) best = { pen, nx: cnx, ny: cny };
          }
        }
      }
      return best;
    };

    return ter;
  };

  // ---- custom ticker: live data with simulated fallback ----
  function simPrices(sym) {
    const rng = mulberry32(hash(sym.toUpperCase()));
    const drift = (rng() - 0.42) * 0.02;
    const vol = 0.03 + rng() * 0.05;
    let p = 20 + rng() * 180;
    const out = [];
    for (let i = 0; i < 110; i++) {
      out.push(p);
      p *= 1 + drift + (rng() - 0.5) * 2 * vol;
      if (rng() < 0.03) p *= 1 + (rng() - 0.45) * 0.35; // the occasional earnings surprise
      p = Math.max(0.5, p);
    }
    return out;
  }

  L.fetchTicker = async function (sym) {
    sym = sym.toUpperCase().replace(/[^A-Z0-9.\-=^]/g, '');
    if (!sym) throw new Error('empty');
    const api = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(sym) + '?range=1y&interval=1wk';
    const routes = [
      u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
      u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
      u => u,
    ];
    for (const route of routes) {
      try {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), 7000);
        const res = await fetch(route(api), { signal: ctl.signal });
        clearTimeout(to);
        if (!res.ok) continue;
        const j = await res.json();
        const r = j && j.chart && j.chart.result && j.chart.result[0];
        const closes = r && r.indicators.quote[0].close.filter(c => c != null);
        if (closes && closes.length >= 8) {
          return { sym, prices: closes, live: true };
        }
      } catch (e) { /* next route */ }
    }
    return { sym, prices: simPrices(sym), live: false };
  };

  L.makeCustomDef = function (sym, prices, live) {
    let lo = Infinity, hi = -Infinity;
    for (const p of prices) { if (p < lo) lo = p; if (p > hi) hi = p; }
    const wild = hi / Math.max(lo, 1e-6) > 12;
    return {
      id: 'T:' + sym, sym, company: sym,
      level: live ? 'Dial-Up Live Wire' : 'Offline Simulator',
      nick: live ? 'LIVE / 1Y WEEKLY' : 'SIMULATED CHART',
      era: live ? 'THE WIRE' : 'OFFLINE SIM',
      prices, live,
      amp: 290, dx: 50, slope: 1.55, smooth: live ? 0 : 1, log: wild,
      routeBoost: wild ? 0.58 : 0.42, momentum: wild ? 0.22 : 0.16,
      par: 55,
    };
  };
})();
