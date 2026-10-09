// Serve the repo (e.g. python -m http.server 8765), then run with Playwright installed:
// node tests/gamelist-browser.cjs
// Optional: GAMELIST_URL and PLAYWRIGHT_CHANNEL (e.g. msedge).
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const shows = process.env.LIST_KIND === 'shows';
const url = process.env.GAMELIST_URL || `http://localhost:8765/${shows ? 'showlist' : 'gamelist'}.html`;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    for (const width of [320, 390, 759, 1024, 1440]) {
      const phone = width < 760;
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: phone, hasTouch: phone });
      await page.addInitScript(() => { let seed = 123456; Math.random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646; });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      // Test actual local game data without depending on the enrichment service.
      await page.route(shows ? '**/showTierProvider' : '**/gameTierListProvider', r => r.fulfill({ json: { ok: true, data: [] } }));
      await page.route('https://fonts.googleapis.com/**', r => r.abort());
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body.content-ready');
      if (phone) {
        const initialCount = await page.locator('#main-list .game-card-wrapper').count();
        for (const [group, value, parameter] of (shows ? [['category', 'anime', 'cat']] : [['category', 'indie', 'cat'], ['decade', '2010s', 'decade'], ['platform', 'pc', 'platform'], ['vibe', 'Epic', 'vibe'], ['ttb', 'Short', 'ttb']])) {
          const button = page.locator(`[data-group="${group}"][data-value="${value}"]`);
          await button.tap();
          assert.ok(await button.evaluate(e => e.classList.contains('active')), `${group} selects`);
          await button.tap();
          await page.waitForTimeout(250);
          assert.ok(!await button.evaluate(e => e.classList.contains('active')), `${group} deselects`);
          assert.equal(await button.evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', `${group} clears sticky hover`);
          assert.ok(!new URL(page.url()).searchParams.has(parameter), `${group} clears URL state`);
          assert.equal(await page.locator('#main-list .game-card-wrapper').count(), initialCount);
        }
        // Name sorting makes full rows independent of where year groups end.
        await page.locator('[data-group="sort"][data-value="name"]').tap();
        const columns = await page.locator('.tier-section .row').first().evaluate(e => {
          const cards = [...e.querySelectorAll('.game-card-wrapper')];
          const top = cards[0].getBoundingClientRect().top;
          return cards.filter(c => Math.abs(c.getBoundingClientRect().top - top) < 1).length;
        });
        assert.equal(columns, width < 380 ? 3 : 4, 'Tierlist card density');
      }
      for (const view of (shows ? ['grid', 'pillar'] : ['grid', 'pillar', 'inspiration'])) {
        await page.locator(`[data-view="${view}"]`).click();
        await page.waitForTimeout(450);
        assert.ok(await page.locator('#main-list .game-card-wrapper').count(), `${view} has cards`);
        if (!phone) continue;
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `${view} fits ${width}px`);
        await page.locator('#main-list .game-card-wrapper').first().click();
        await page.waitForSelector('#game-details-dialog[open]');
        await page.waitForTimeout(650);
        assert.ok(await page.locator('#game-details-dialog .game-title-overlay').textContent());
        assert.ok(await page.locator('#game-details-dialog').evaluate(e => {
          const r = e.getBoundingClientRect();
          return Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 1 && Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) < 1 && r.left >= 12 && r.right <= innerWidth - 12 && e.scrollWidth === e.clientWidth;
        }), 'Detail panel is centered and content fits');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#game-details-dialog[open]', { state: 'hidden' });
        assert.equal(await page.locator('#game-details-dialog[open]').count(), 0);
        await page.evaluate(() => { window.firstCard = document.querySelector('#main-list .game-card-wrapper'); });
        await page.setViewportSize({ width, height: 744 });
        await page.waitForTimeout(250);
        assert.ok(await page.evaluate(() => window.firstCard === document.querySelector('#main-list .game-card-wrapper')), 'Height-only resize preserves cards');
        await page.setViewportSize({ width, height: 844 });
      }
      if (phone) {
        await page.locator('[data-view="pillar"]').click();
        const count = await page.locator('#main-list .pillar-mini-card').count();
        for (const axis of (shows ? ['score', 'watched', 'released', 'network', 'seasons'] : ['score', 'played', 'released', 'metacritic', 'platform'])) {
          await page.locator(`[data-group="pillarAxis"][data-value="${axis}"]`).click();
          await page.waitForTimeout(900);
          assert.ok(await page.evaluate(() => {
            const rects = [...document.querySelectorAll('#main-list .pillar-mini-card')].map(e => e.getBoundingClientRect());
            return rects.every((a, i) => rects.slice(i + 1).every(b => !(a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1)));
          }), `No overlapping cards: ${axis}`);
        }
        await page.locator('[data-group="pillarAxis"][data-value="score"]').click();
        assert.equal(await page.locator('#main-list .pillar-mini-card').count(), count, 'Repeated IDs do not accumulate stale cards');
        assert.ok(await page.evaluate(() => {
          const before = [...document.querySelectorAll('#main-list .pillar-mini-card')];
          applyFilters();
          const after = [...document.querySelectorAll('#main-list .pillar-mini-card')];
          return before.length === after.length && before.every((card, i) => card === after[i]);
        }), 'Histogram refresh reuses cards');
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable');
        const metrics = async () => (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'LayoutCount').value;
        const before = await metrics();
        await page.evaluate(() => applyFilters());
        assert.ok(await metrics() - before < 10, 'Histogram does not force layout per card');
        await page.locator('#search-input').fill('zzzz-no-match');
        await page.waitForTimeout(250);
        assert.equal(await page.locator('#main-list .pillar-mini-card').count(), 0);
        assert.ok(await page.evaluate(() => Number.isFinite(parseFloat(document.querySelector('#main-list').style.height))));
      } else if (!shows) {
        // Pause drifting in this test so the pointer can land deterministically.
        await page.addStyleTag({ content: 'html { scroll-behavior:auto !important; } .inspiration-tile,.inspiration-tile-card { animation:none !important; }' });
        const card = page.locator('.inspiration-tile .game-card-wrapper').first();
        await card.locator('.game-card').hover({ force: true });
        await page.waitForTimeout(700);
        assert.equal(await card.locator('.game-exp-overlay').evaluate(e => getComputedStyle(e).opacity), '1');
        await card.locator('.game-exp-overlay').dispatchEvent('mousemove', { clientX: 10, clientY: 0 });
        assert.ok(!await card.evaluate(e => e.classList.contains('force-collapse')), 'Desktop Inspiration keeps details open');
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: layout, interaction and rendering checks`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
