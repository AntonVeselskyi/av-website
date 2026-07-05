# STONKS DEFIED ▲

Gravity Defied, except every track is a stock price chart.

Ride a trials bike over real historical charts — KO's decade of dividends,
AAPL's covid dip, TSLA's rollercoaster, NVDA's AI ramp, the GME squeeze,
and the 2017 BTC bubble. Beat all 6 under par to unlock the **GOLDEN BULL**
colorscheme.

## Play

Open `index.html` (or serve the folder statically). No build step, no deps.

- **PC**: `↑`/`W` gas · `↓`/`S` brake · `←`/`→` (`A`/`D`) lean · `R` retry · `Esc` pause · `M` mute
- **Mobile**: on-screen lean pads + BRK/GAS buttons

## Custom charts

`ENTER TICKER` in the menu, or deep-link with `?ticker=NVDA`.
Fetches 1y weekly closes from Yahoo Finance (via CORS proxies); falls back to
a deterministic simulated chart if the wire is down.

## Tech

Vanilla JS + canvas. Two-wheel spring-constraint physics, heightmap terrain
built from closing prices (Catmull-Rom resample → smoothing → slope clamp so
every chart stays rideable; log-scale for 50x movers). Progression lives in
a cookie. Monophonic WebAudio beeps, as nature intended.

Game by Anton Veselskyi.
