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
    localStorage.setItem('hm.prefs', JSON.stringify({ view: 'grid', colorBy: '24h' }));
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

test('CoinGecko attribution is shown (required for the free API key)', async ({ page }) => {
  for (const where of ['#fresh', 'footer']) {
    const link = page.locator(`${where} a[href^="https://www.coingecko.com"]`);
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

test('scorecard view renders its chart and horizon switch', async ({ page }) => {
  await page.locator('#view button[data-v="score"]').click();
  await expect(page.locator('#scorewrap')).toContainText("Yesterday's calls");
  await expect(page.locator('#scorewrap .sc-chart svg')).toBeVisible();
  await page.locator('#scoreH button[data-h="7"]').click();
  await expect(page.locator('#scorewrap')).toContainText('judged over the next 7 days');
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
