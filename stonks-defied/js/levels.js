// STONKS DEFIED — levels: real historical charts, terrain builder, ticker API
window.SD = window.SD || {};

(function () {
  const L = SD.levels = {};

  // ---- cherry-picked REAL historical closes (Yahoo Finance) ----
  // Windows chosen so the chart rides like a proper Gravity Defied track.
  L.PRESETS = [
    {
      id: 'KO', sym: 'KO', co: 'COCA-COLA', nick: 'DIVIDEND CRUISE', era: '2010–2019 · MONTHLY',
      d0: '2010-01-01', d1: '2019-12-01',
      par: 20, amp: 150, dx: 54, slope: 1.05, drop: 1.05, smooth: 2,
      prices: [27.12,26.46,27.36,26.44,25.47,26.2,27.77,28.79,30.29,31.42,32.78,31.43,32.08,33.28,33.64,33.5,33.81,34.69,34.28,34.06,33.71,34.88,33.79,35.16,37.24,37.93,38.03,39.72,38.69,37.75,37.37,37.8,36.36,37.28,38.93,40.84,41.62,40.04,40.1,38.98,37.98,39.17,40.1,41.25,37.83,38.26,39.13,40.83,41.5,40.84,40.72,42.36,42.06,44.42,42.34,41.27,42.92,40.55,40.69,40.25,40.16,40.03,39.87,41.86,42.59,42.95,42.93,43.61,46.01,44.73,44.91,44.46,43.51,42.66,42.38,40.59,41.43,41.6,42.03,42.62,43.94,45.2,45.37,45.66,45.17,45.78,45.79,45.88,47.27,43.25,43.37,43.14,43.38,45.33,45.34,45.73,47.55,50.15,47.38,47.9,45.6,47.45,49.09,49.93,51.85,54.16,54.61,54.43,53.49,55.35],
    },
    {
      id: 'AAPL', sym: 'AAPL', co: 'APPLE', nick: 'STEADY GAINS', era: '2019–2021 · WEEKLY',
      d0: '2019-01-01', d1: '2021-12-28',
      par: 20, n: 100, amp: 300, dx: 58, slope: 1.3, drop: 2.6, punch: 1.2, smooth: 0,
      prices: [36.98,38.03,39.12,42.56,42.42,43.13,43.91,45.13,47.09,47.68,50.0,50.36,51.15,51.88,46.2,45.09,43.36,48.24,49.17,50.32,50.29,51.57,52.32,48.6,51.26,51.84,52.3,54.11,54.77,56.01,57.49,59.71,62.15,64.68,66.25,66.61,66.17,68.36,70.81,73.14,76.82,79.57,77.23,78.36,80.97,74.6,72.23,62.87,56.43,64.15,67.09,69.1,71.21,75.91,78.74,79.8,81.66,85.09,89.74,91.48,94.78,98.26,98.73,111.2,114.4,126.5,124.8,116.3,110.8,115.7,122.5,115.9,112.6,114.0,120.2,115.5,122.0,121.9,130.4,132.6,129.0,130.1,138.6,136.4,134.3,126.8,119.3,124.0,122.7,124.4,131.2,134.8,133.4,127.3,126.5,125.8,125.7,130.8,133.5,138.8,144.3,145.1,146.5,146.2,150.6,151.9,154.3,147.8,144.3,139.8,143.6,147.6,148.9,150.4,154.9,160.4,166.0,173.5,177.0,178.2],
    },
    {
      id: 'AMZN', sym: 'AMZN', co: 'AMAZON', nick: 'DOT-COM BUBBLE', era: '1997–2001 · WEEKLY',
      d0: '1997-05-12', d1: '2001-12-31',
      par: 30, n: 92, amp: 580, dx: 64, slope: 1.4, drop: 3.9, punch: 2.4, scale: 'log', smooth: 0,
      prices: [0.09,0.08,0.08,0.07,0.11,0.11,0.12,0.11,0.12,0.19,0.2,0.19,0.25,0.21,0.21,0.23,0.23,0.23,0.24,0.25,0.26,0.32,0.33,0.36,0.4,0.36,0.38,0.36,0.38,0.64,1.03,1,0.93,1.02,0.9,0.65,0.87,0.79,0.93,1.04,1.37,1.65,2.19,2.69,3.72,2.99,2.75,2.86,3.17,3.42,4.39,4.92,4.03,3.28,2.91,2.67,2.82,3.18,2.82,2.26,2.85,3.13,3.19,3.83,3.81,3.58,3.67,4.52,5.12,4.55,3.57,3.14,3.64,3.45,3.26,3.29,3.48,2.87,2.68,2.82,2.51,2.79,2.1,1.81,2.11,1.53,1.74,2.01,2.15,2.06,1.57,1.55,1.88,1.38,1.24,1.15,0.78,0.86,0.98,0.68,0.61,0.58,0.52,0.45,0.77,0.83,0.74,0.85,0.71,0.66,0.8,0.76,0.57,0.5,0.44,0.42,0.31,0.4,0.37,0.37,0.46,0.58,0.5,0.54],
    },
    {
      id: 'TSLA', sym: 'TSLA', co: 'TESLA', nick: 'VOLATILITY RIDE', era: '2020–2022 · WEEKLY',
      d0: '2020-01-01', d1: '2022-12-28',
      par: 25, n: 92, amp: 370, dx: 66, slope: 1.45, drop: 3.2, punch: 1.8, smooth: 0,
      prices: [31.27,36.05,37.3,57.7,52.99,55.06,50.19,40.49,31.11,34.68,37.56,46.68,49.8,51.33,53.93,54.35,58.67,63.5,66.26,71.51,94.51,102.9,99.41,98.0,107.4,132.8,154.3,125.8,143.9,139.7,141.6,143.6,141.5,140.1,142.7,180.7,199.1,213.8,213.0,224.9,261.7,281.9,294.2,288.1,271.1,233.2,227.5,225.2,221.1,216.3,243.4,241.7,233.2,215.5,195.4,202.2,205.2,200.2,208.5,224.5,221.8,220.3,220.9,236.6,223.4,238.1,248.2,248.6,248.3,259.6,266.6,292.0,359.3,356.1,351.7,373.5,362.0,321.3,325.4,374.3,358.4,336.6,308.3,307.9,303.5,280.0,278.3,270.5,344.0,364.7,329.6,327.8,298.8,269.7,243.8,232.7,241.0,223.5,235.0,233.0,234.2,250.9,288.7,283.9,303.2,284.3,274.6,296.6,293.8,253.1,217.2,221.3,226.9,191.7,183.5,178.2,178.6,152.2,118.0,123.2],
    },
    {
      id: 'NVDA', sym: 'NVDA', co: 'NVIDIA', nick: 'AI RAMP', era: '2022–2024 · WEEKLY',
      d0: '2022-09-26', d1: '2024-06-24',
      par: 25, n: 88, amp: 640, dx: 64, slope: 1.46, drop: 4.0, punch: 2.5, smooth: 0,
      prices: [12.14,12.08,11.23,12.47,13.83,14.16,16.33,15.41,16.27,16.88,17.0,16.57,15.21,14.61,14.86,16.9,17.84,20.36,21.1,21.26,21.39,23.29,23.89,22.97,25.73,26.78,27.78,27.04,26.76,27.12,27.75,28.68,28.34,31.26,38.95,39.33,38.77,42.69,42.21,42.3,42.5,45.47,44.31,46.75,44.68,40.85,43.3,46.02,48.51,45.57,43.9,41.61,43.5,45.76,45.46,41.39,40.5,45.01,48.33,49.3,47.78,46.76,47.51,48.89,48.83,49.52,49.1,54.71,59.49,61.03,66.16,72.13,72.61,78.82,82.28,87.53,87.84,94.29,90.36,88.01,88.19,76.2,87.74,88.79,89.88,92.48,106.5,109.6,120.9,131.9,126.6,123.5],
    },
    {
      id: 'SPX', sym: '^GSPC', co: 'S&P 500', nick: 'COVID CRASH', era: '2020 · DAILY',
      d0: '2020-01-02', d1: '2020-12-31',
      par: 25, n: 90, amp: 420, dx: 64, slope: 1.4, drop: 3.3, punch: 1.6, scale: 'linear', smooth: 0,
      prices: [3258,3246,3255,3269,3284,3320,3321,3315,3256,3278,3237,3317,3335,3356,3376,3373,3376,3245,3118,2956,3005,3023,2756,2710,2656,2500,2381,2304,2532,2577,2532,2507,2661,2774,2817,2795,2836,2787,2831,2865,2914,2843,2850,2930,2863,2855,2946,2965,2968,3034,3049,3101,3156,3218,3071,3059,3117,3102,3129,3080,3050,3115,3179,3169,3181,3202,3218,3253,3263,3224,3235,3258,3301,3340,3357,3364,3373,3388,3383,3426,3475,3507,3527,3454,3338,3339,3387,3379,3308,3289,3267,3345,3372,3381,3395,3466,3519,3485,3439,3437,3464,3391,3309,3312,3448,3514,3550,3548,3622,3572,3565,3633,3631,3666,3685,3698,3670,3652,3700,3712,3688,3702,3727,3756],
    },
    {
      id: 'META', sym: 'META', co: 'META', nick: 'THE GREAT CANYON', era: '2021–2023 · WEEKLY',
      d0: '2021-01-01', d1: '2023-06-30',
      par: 30, n: 92, amp: 580, dx: 64, slope: 1.4, drop: 3.9, punch: 2.4, scale: 'linear', smooth: 0,
      prices: [268.7,247.2,272,265.3,267.4,270.1,264.4,255.9,265,276.3,278.7,291.2,308.5,309.2,298.8,324.7,320.9,305.7,319,332.2,326.9,333.3,338.2,346.6,351.2,345.1,347.7,355,361.1,362.8,357.3,362.2,373.3,377.7,373.4,346.2,338.9,329.1,330.7,336.4,322.2,333.1,332,339.7,325.6,321.3,333,335.1,341.9,335,327.4,317.5,295.5,237.6,226.6,207.7,206.7,201.1,199,212,220.7,222.6,216.2,197.2,199.4,207.5,195.4,191.3,191.6,198.3,184.2,160.8,159,162.9,169.2,164.8,175.9,164.5,173.6,176.1,171.4,166.7,163.2,153,144.3,137.5,138.8,130.7,131.3,97.35,91.71,111.8,111.6,114.6,118.7,115.7,116.6,118.8,124.1,133.1,136.3,144.5,180.7,179.4,172.9,172,174.8,183.8,204.8,205,210,217.4,217.6,224.1,236.1,234.8,242.4,250.7,266.9,266.4,278.9,284.5,281.7,287],
    },
    {
      id: 'GME', sym: 'GME', co: 'GAMESTOP', nick: 'THE SQUEEZE', era: '2020–2021 · DAILY',
      d0: '2020-09-15', d1: '2021-05-28',
      par: 30, n: 92, amp: 480, dx: 66, slope: 1.35, drop: 3.8, punch: 1.8, smooth: 0, scale: 'log',
      prices: [1.77,2.23,2.37,2.4,2.52,2.38,2.52,2.57,2.45,2.35,2.29,2.71,3.06,2.96,3.05,3.42,3.45,3.48,3.68,3.65,3.22,2.95,2.7,2.73,2.78,2.88,2.9,2.8,2.84,2.79,2.95,2.92,3.15,3.47,3.57,4.03,4.04,4.14,4.13,4.09,3.83,3.53,3.26,3.45,3.57,3.89,4.3,5.12,5.12,4.89,4.78,4.37,4.43,4.53,4.6,4.99,8.48,9.12,9.82,10.52,16.97,32.21,78.47,71.59,49.73,22.91,13.81,15.32,12.61,12.78,13.02,11.84,10.17,10.93,12.03,25.29,25.63,29.81,31.08,33.77,48.51,63.89,65.04,61.09,52.22,51.59,50.1,47.34,31.76,45.68,45.31,48.21,47.8,46.54,44.79,41.66,36.18,37.02,39.7,39.28,40.01,39.21,37.79,42.68,44.58,43.93,41.51,40.14,40.11,39.71,36.37,36.69,40.45,45.15,43.5,42.7,44.63,52.57,62.12,55.5],
    },
    {
      id: 'BTC', sym: 'BTC-USD', co: 'BITCOIN', nick: 'TO THE MOON', era: '2016–2018 · WEEKLY',
      d0: '2016-01-01', d1: '2018-12-28',
      par: 30, n: 94, amp: 550, dx: 66, slope: 1.45, drop: 3.9, punch: 2.4, smooth: 0, scale: 'sqrt',
      prices: [458.0,426.1,397.7,386.1,381.3,422.5,423.8,419.5,419.5,416.9,417.3,423.2,437.1,449.1,448.0,452.5,443.8,500.6,566.1,761.9,633.2,660.4,651.2,663.7,653.3,580.8,582.6,576.6,573.1,625.0,604.1,600.9,610.8,634.6,637.5,688.4,703.1,734.5,740.3,759.1,773.5,828.4,950.7,1013,824.6,906.8,976.7,997.2,1034,1188,1222,1188,1056,1041,1179,1200,1293,1522,1854,2034,2362,2713,2473,2675,2567,2457,2732,2675,2939,3801,4334,4652,4499,3288,3897,4282,5343,5731,6287,7113,7685,8031,11482,17403,16122,14857,15599,13002,11385,9948,8413,10159,10247,10227,8657,8679,7133,7137,8096,9006,9712,8911,7917,7535,7635,6699,6576,6194,6391,7237,7943,7335,6465,6465,6916,6528,6518,6596,6607,6286,6477,6444,6418,5854,4426,4155,3444,3791,3755,3743],
    },
    {
      id: 'MSTR', sym: 'MSTR', co: 'MICROSTRATEGY', nick: 'SAYLOR ROLLERCOASTER', era: '2024 · DAILY',
      d0: '2024-01-02', d1: '2024-12-31',
      par: 35, n: 94, amp: 600, dx: 66, slope: 1.45, drop: 4.0, punch: 2.5, scale: 'sqrt', smooth: 0,
      prices: [68.51,65.48,59.63,56.21,48.5,49.65,47.84,45.04,46.97,51.59,50.21,49.59,50.29,61.87,69.96,73.82,70.31,70.07,76.72,94.22,106.9,109.2,129.4,148,176.2,177.8,142.5,159.2,185.9,188.1,162.4,160.9,146.1,148.4,152.4,130.1,119.7,125,129.9,126.5,115,109.6,125.5,123.9,119.8,128.9,144.8,171.4,164.7,168.4,161.6,153.2,164.5,164.7,159.1,157.5,149.9,146.8,144.4,148.1,146,134.4,129.1,129.7,133.8,153.5,161.4,171.7,174,161.9,169.5,161.3,145.3,136.7,136,131.7,130.5,133.3,135,137.2,145.2,132.2,129.1,122.9,118.7,129.5,136.1,132.8,139.6,148,152.6,173.1,164.2,163.7,184.4,189.4,209.7,194.7,193.4,219.1,215.4,236.6,256.6,241.7,224.1,261.3,291.9,346.7,332.7,404.5,437.7,412.4,373.1,383.2,394.1,392.2,373.9,396.9,408.5,355.6,359.6,356.1,330.4,289.6],
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

  // ---- terrain builder: prices -> rideable heightmap ----
  const PRE = 6, POST = 9; // flat platform columns before/after the chart
  L.buildTerrain = function (def) {
    const n = def.n || Math.min(150, Math.max(60, def.prices.length));
    const raw = resample(def.prices, n);
    const dx = def.dx || 55;
    const amp = def.amp || 260;

    // shape values via chosen vertical scale, then normalize.
    // scale: 'linear' | 'sqrt' | 'log'  (legacy `log: true` == scale 'log')
    const scale = def.scale || (def.log ? 'log' : 'linear');
    const scaleFn = scale === 'log' ? (v => Math.log(Math.max(v, 1e-6)))
      : scale === 'sqrt' ? (v => Math.sqrt(Math.max(v, 0)))
      : (v => v);
    let vals = raw.map(scaleFn);
    for (let pass = 0; pass < (def.smooth || 1); pass++) {
      const s = vals.slice();
      for (let i = 1; i < n - 1; i++) vals[i] = (s[i - 1] + 2 * s[i] + s[i + 1]) / 4;
    }
    // punch: unsharp mask — exaggerates local relief (ledges, launch ramps,
    // washboard) while the macro chart silhouette stays recognizable
    if (def.punch) {
      let sm = vals.slice();
      for (let pass = 0; pass < 3; pass++) {
        const s = sm.slice();
        for (let i = 1; i < n - 1; i++) sm[i] = (s[i - 1] + 2 * s[i] + s[i + 1]) / 4;
      }
      vals = vals.map((v, i) => v + def.punch * (v - sm[i]));
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const range = (hi - lo) || 1;

    // world ys (y-down): higher price = higher ground (smaller y)
    const ys = new Array(PRE + n + POST);
    const prices = new Array(PRE + n + POST);
    for (let i = 0; i < n; i++) {
      ys[PRE + i] = 400 - ((vals[i] - lo) / range) * amp;
      prices[PRE + i] = raw[i];
    }
    for (let i = 0; i < PRE; i++) { ys[i] = ys[PRE]; prices[i] = raw[0]; }
    for (let i = 0; i < POST; i++) { ys[PRE + n + i] = ys[PRE + n - 1]; prices[PRE + n + i] = raw[n - 1]; }

    // asymmetric slope clamp: climbs stay climbable, but sell-offs become
    // proper GD drop-offs you launch from (y-down: +dy = descent)
    const maxUp = dx * (def.slope || 1.35);
    const maxDown = dx * (def.drop || (def.slope || 1.35) * 2.2);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < ys.length; i++)
        ys[i] = Math.max(ys[i - 1] - maxUp, Math.min(ys[i - 1] + maxDown, ys[i]));
      for (let i = ys.length - 2; i >= 0; i--)
        ys[i] = Math.max(ys[i + 1] - maxDown, Math.min(ys[i + 1] + maxUp, ys[i]));
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

    // date mapping: d0 at first chart column, d1 at the last; the flat start/
    // finish platforms clamp to d0/d1. presets carry ISO d0/d1; custom tickers
    // carry unix-second ts0/ts1 straight from the Yahoo response.
    const t0 = def.ts0 != null ? def.ts0 * 1000 : (def.d0 ? Date.parse(def.d0) : null);
    const t1 = def.ts1 != null ? def.ts1 * 1000 : (def.d1 ? Date.parse(def.d1) : null);
    const colX0 = x0 + PRE * dx, colX1 = x0 + (PRE + n - 1) * dx;
    ter.dateAt = function (x) {
      if (t0 == null || t1 == null || isNaN(t0) || isNaN(t1)) return null;
      let f = (x - colX0) / ((colX1 - colX0) || 1);
      f = Math.max(0, Math.min(1, f));
      return new Date(t0 + f * (t1 - t0));
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
          const ts = r.timestamp || [];
          return { sym, prices: closes, live: true, ts0: ts[0], ts1: ts[ts.length - 1] };
        }
      } catch (e) { /* next route */ }
    }
    return { sym, prices: simPrices(sym), live: false };
  };

  L.makeCustomDef = function (sym, prices, live, ts0, ts1) {
    let lo = Infinity, hi = -Infinity;
    for (const p of prices) { if (p < lo) lo = p; if (p > hi) hi = p; }
    const wild = hi / Math.max(lo, 1e-6) > 12;
    // live: real first/last timestamps; sim: today back one year
    let d0, d1;
    if (live && ts0 && ts1) {
      d0 = new Date(ts0 * 1000).toISOString(); d1 = new Date(ts1 * 1000).toISOString();
    } else {
      const now = Date.now();
      d1 = new Date(now).toISOString(); d0 = new Date(now - 365 * 864e5).toISOString();
    }
    return {
      id: 'T:' + sym, sym, co: sym,
      nick: live ? 'LIVE · 1Y WEEKLY' : 'SIMULATED CHART',
      era: live ? 'THE WIRE' : 'OFFLINE SIM',
      prices, live, d0, d1,
      n: 96, dx: 60, amp: 340, slope: 1.35, drop: 2.8, punch: 1.3, smooth: live ? 1 : 2, log: wild,
      par: 55,
    };
  };
})();
