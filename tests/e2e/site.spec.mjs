// Browser tests: the real page in headless Chrome, against deterministic test data (tests/e2e/fixtures.mjs).
import { test, expect } from '@playwright/test';

const N = 12;
let external;   // any request that isn't the local server (there should be none)

test.beforeEach(async ({ page }) => {
  external = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost') return route.continue();
    external.push(u.href);
    return route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem('hm.wip', String(Date.now()));                       // skip the work-in-progress popup
    // start on the grid, but keep anything a test saved before a reload (e.g. the chart type)
    const saved = JSON.parse(localStorage.getItem('hm.prefs') || '{}');
    localStorage.setItem('hm.prefs', JSON.stringify({ ...saved, view: 'grid', colorBy: '24h' }));
  });
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(`${N}/${N} coins with indicators`);
});

const tiles = page => page.locator('#grid .tile');
const tile = (page, id) => page.locator(`.tile[data-id="${id}"]`);

test('loads everything from data.json, with no outside API calls', async ({ page }) => {
  await expect(tiles(page)).toHaveCount(N);
  await expect(page.locator('#fresh')).toContainText('Last refreshed');
  await expect(page.locator('#legend')).toContainText('Track record, last 90 days');
  expect(external).toEqual([]);
});

test('compact top: coins start in the top third of a 13-inch screen; the full legend opens on demand and is remembered', async ({ page }) => {
  const gridTop = await page.locator('#grid').evaluate(el => el.getBoundingClientRect().top);
  expect(gridTop).toBeLessThan(page.viewportSize().height / 3);
  await expect(page.locator('#fresh')).toContainText('not real-time');
  const more = page.locator('#legendMore');
  await expect(more).toBeHidden();
  await page.locator('#legendToggle').click();
  await expect(more).toBeVisible();
  await expect(more).toContainText('STOP');
  await page.reload();
  await expect(page.locator('#legendMore')).toBeVisible();             // stays open after a reload
  await page.locator('#legendToggle').click();
  await expect(page.locator('#legendMore')).toBeHidden();
});

test('CoinGecko attribution is shown (required for the free API key)', async ({ page }) => {
  for (const where of ['#fresh', 'footer']) {
    const link = page.locator(`${where} a[href="https://www.coingecko.com/"]`);
    await expect(link).toBeVisible();
    await expect(link).toContainText('Powered by CoinGecko');
  }
});

test('✓ / ? marks show how each coin was matched', async ({ page }) => {
  await expect(tile(page, 'alpha-coin').locator('.vf.ok')).toHaveCount(1);
  await expect(tile(page, 'beta-coin').locator('.vf.guess')).toHaveCount(1);
});

test('filters show only matching coins, and "All coins" restores them', async ({ page }) => {
  for (const f of ['up', 'down', 'ob', 'sq', 'cross', 'stop']) {
    const chip = page.locator(`#filters .chip[data-f="${f}"]`);
    const count = Number(await chip.locator('.n').textContent());
    await chip.click();
    if (count) await expect(tiles(page)).toHaveCount(count);
    else await expect(page.locator('#grid .empty')).toContainText('right now');
  }
  await page.locator('#filters .chip[data-f="all"]').click();
  await expect(tiles(page)).toHaveCount(N);
});

test('filter counts match the tiles as soon as the page loads', async ({ page }) => {
  const shown = await page.locator('#grid .tile.stop-closed').count();
  await expect(page.locator('#filters .chip[data-f="stop"] .n')).toHaveText(String(shown));
});

test('stops: a daily close past the stop is an exit; intraday is only a warning', async ({ page }) => {
  await expect(tile(page, 'closed-coin')).toHaveClass(/stop-closed/);
  await expect(tile(page, 'closed-coin')).toContainText('closed below long stop');
  await expect(tile(page, 'intraday-coin')).toHaveClass(/stop-intraday/);
  await expect(tile(page, 'intraday-coin')).toContainText('below long stop intraday');
  await page.locator('#filters .chip[data-f="stop"]').click();
  await expect(tile(page, 'closed-coin')).toBeVisible();
  await expect(tile(page, 'intraday-coin')).toHaveCount(0);
});

test('popup fits a 13-inch screen, stays put under the mouse, pins and closes', async ({ page }) => {
  const first = tile(page, 'alpha-coin');
  const tb = await first.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  const popup = page.locator('#detail');
  await expect(popup).toHaveClass(/show/);
  await expect(popup.locator('.d-head b')).toHaveText('Alpha Coin');

  const pb = await popup.boundingBox();
  const vp = page.viewportSize();
  expect(pb.x).toBeGreaterThanOrEqual(0);
  expect(pb.y).toBeGreaterThanOrEqual(0);
  expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width);
  expect(pb.y + pb.height).toBeLessThanOrEqual(vp.height);
  expect(await popup.locator('.d-cols').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);

  // glide across the other tiles onto the popup: it must stay on Alpha
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 15 });
  await page.waitForTimeout(600);
  await expect(popup.locator('.d-head b')).toHaveText('Alpha Coin');

  await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await expect(popup).toHaveClass(/pinned/);
  await page.locator('h1').click();
  await expect(popup).not.toHaveClass(/show/);
});

const center = b => [b.x + b.width / 2, b.y + b.height / 2];

test('hover: gliding across tiles opens nothing; a popup opens only after resting on a coin', async ({ page }) => {
  const ids = await tiles(page).evaluateAll(els => els.map(e => e.dataset.id));
  const first = await tile(page, ids[0]).boundingBox(), last = await tile(page, ids[ids.length - 1]).boundingBox();
  await page.mouse.move(...center(first));
  await page.mouse.move(...center(last), { steps: 20 });       // a quick pass over the grid
  const popup = page.locator('#detail');
  await page.waitForTimeout(150);
  await expect(popup).not.toHaveClass(/show/);
  await page.waitForTimeout(2300);                             // now resting on the last tile
  await expect(popup).toHaveClass(/show/);
  const want = ids[ids.length - 1].replace(/-coin$/, '').replace(/^./, s => s.toUpperCase()) + ' Coin';
  await expect(popup.locator('.d-head b')).toHaveText(new RegExp(want, 'i'));   // the coin it rests on, not one it crossed
});

test('hover: moving off toward another coin closes the popup, then opens that coin', async ({ page }) => {
  const a = await tile(page, 'alpha-coin').boundingBox();
  await page.mouse.move(...center(a));
  const popup = page.locator('#detail');
  await expect(popup.locator('.d-head b')).toHaveText('Alpha Coin');
  const pb = await popup.boundingBox();
  // pick a tile that lies away from the popup (the popup's center is on the other side)
  const away = await tiles(page).evaluateAll((els, p) => {
    const pc = p.x + p.width / 2;
    const cand = els.map(e => ({ id: e.dataset.id, r: e.getBoundingClientRect() }))
      .filter(t => t.id !== 'alpha-coin' && (t.r.right < p.x || t.r.left > p.x + p.width || t.r.bottom < p.y || t.r.top > p.y + p.height));
    cand.sort((x, y) => Math.abs(y.r.left - pc) - Math.abs(x.r.left - pc));
    return cand[0]?.id;
  }, pb);
  expect(away).toBeTruthy();
  const tb = await tile(page, away).boundingBox();
  await page.mouse.move(...center(tb), { steps: 8 });
  await page.waitForTimeout(250);
  await expect(popup).not.toHaveClass(/show/);                 // closed quickly on the way
  await expect(popup).toHaveClass(/show/);                     // then the resting coin opens
  await expect(popup.locator('.d-head b')).not.toHaveText('Alpha Coin');
});

test('names show only the MA 🚀/😢, momentum 🔥/🧊 and the point & figure trend (X📈 / O📉), matching the popup chart', async ({ page }) => {
  await expect(page.locator('#grid .tile .pnf-mark')).toHaveCount(N);
  const mark = tile(page, 'moon-coin').locator('.pnf-mark');
  const dir = (await mark.getAttribute('class')).includes('pnf-X') ? 'X' : 'O';
  await expect(mark).toHaveText(dir === 'X' ? 'X📈' : 'O📉');
  await expect(page.locator('#grid .tile .name', { hasText: '⚡' })).toHaveCount(0);   // no BB emoji
  for (const t of await page.locator('#grid .tile .emo').all()) expect(await t.getAttribute('title')).toMatch(/^(🚀 strong uptrend|😢 strong downtrend|🔥 strong 30-day momentum .*|🧊 weak 30-day momentum .*)$/);
  await expect(tile(page, 'moon-coin').locator('.emo.mom')).toHaveText('🔥');                      // up ~40% in 30 days
  await tile(page, 'moon-coin').click();
  await page.locator('#detail [data-chart="pnf"]').click();
  await expect(page.locator('#detail')).toContainText(dir === 'X' ? 'rising (X)' : 'falling (O)');
});

test('popup switches to a point & figure chart that fits, and remembers it', async ({ page }) => {
  await tile(page, 'moon-coin').click();                      // pin it open
  const popup = page.locator('#detail');
  await expect(popup).toHaveClass(/pinned/);
  await popup.locator('[data-chart="pnf"]').click();
  const svg = popup.locator('svg.pnf');
  await expect(svg).toBeVisible();
  expect(await svg.locator('path, ellipse').count()).toBeGreaterThan(10);  // X and O marks drawn
  await expect(popup).toContainText('reversal');
  const pb = await popup.boundingBox(), vp = page.viewportSize();
  expect(pb.y + pb.height).toBeLessThanOrEqual(vp.height);
  await page.reload();
  await tile(page, 'alpha-coin').click();
  await expect(page.locator('#detail svg.pnf')).toBeVisible();          // choice kept after reload
  await page.locator('#detail [data-chart="price"]').click();
  await expect(page.locator('#detail svg.pnf')).toHaveCount(0);
});

test('scorecard view renders its chart and horizon switch', async ({ page }) => {
  await page.locator('#view button[data-v="score"]').click();
  await expect(page.locator('#scorewrap')).toContainText("Yesterday's calls");
  await expect(page.locator('#scorewrap .sc-chart svg')).toBeVisible();
  await page.locator('#scoreH button[data-h="7"]').click();
  await expect(page.locator('#scorewrap')).toContainText('judged over the next 7 days');
});

test("scorecard: clicking one of yesterday's coins opens its chart card beside it; × closes it", async ({ page }) => {
  await page.locator('#view button[data-v="score"]').click();
  await page.locator('#scorewrap button[data-coin="moon-coin"]').click();
  const popup = page.locator('#detail');
  await expect(popup).toHaveClass(/pinned/);
  await expect(popup.locator('.d-head b')).toHaveText('Moon Coin');
  const pb = await popup.boundingBox(), vp = page.viewportSize();
  expect(pb.y + pb.height).toBeLessThanOrEqual(vp.height);
  await popup.locator('[data-chart="pnf"]').click();                        // same Price / P&F switch as the grid
  await expect(popup.locator('svg.pnf')).toBeVisible();
  await popup.locator('[data-chart="price"]').click();
  await expect(popup.locator('svg.pnf')).toHaveCount(0);
  // another of yesterday's coins switches the card (whichever the test data lists; the card may cover it, so dispatch)
  const other = page.locator('#scorewrap button[data-coin]:not([data-coin="moon-coin"])').first();
  await other.dispatchEvent('click');
  await expect(popup).toHaveClass(/pinned/);
  await expect(popup.locator('.d-head b')).not.toHaveText('Moon Coin');
  await popup.locator('.x').click();
  await expect(popup).not.toHaveClass(/show/);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('tap opens a full-width bottom sheet, tap outside closes it', async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await tile(page, 'moon-coin').tap();
    const popup = page.locator('#detail');
    await expect(popup).toHaveClass(/pinned/);
    const pb = await popup.boundingBox();
    expect(Math.round(pb.width)).toBe(375);
    await page.locator('#scrim').tap({ position: { x: 20, y: 20 } });
    await expect(popup).not.toHaveClass(/show/);
  });
});
