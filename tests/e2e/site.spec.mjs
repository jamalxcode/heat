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
    // start on the grid with detailed tiles (most tests read the tile rows), but keep anything a test saved before a
    // reload (e.g. the chart type); hm.realDefaults: a test of the page's own defaults
    const saved = JSON.parse(localStorage.getItem('hm.prefs') || '{}');
    const base = localStorage.getItem('hm.realDefaults') ? {} : { tiles: 'detailed', view: 'grid', colorBy: '24h' };
    localStorage.setItem('hm.prefs', JSON.stringify({ ...base, ...saved, ...(localStorage.getItem('hm.realDefaults') ? {} : { view: 'grid', colorBy: '24h' }) }));
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

test('compact top: coins start in the top 40% of a 13-inch screen (the market tabs take a row of their own); the full legend opens on demand and is remembered', async ({ page }) => {
  const gridTop = await page.locator('#grid').evaluate(el => el.getBoundingClientRect().top);
  expect(gridTop).toBeLessThan(page.viewportSize().height * 0.4);
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

test('SEO: title, description, canonical, share image, valid structured data matching the visible FAQ, robots.txt', async ({ page, request }) => {
  await expect(page).toHaveTitle(/Crypto Heatmap/);
  expect((await page.title()).length).toBeLessThanOrEqual(65);
  const desc = await page.locator('meta[name="description"]').getAttribute('content');
  expect(desc.length).toBeLessThanOrEqual(160);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://heat.sala.company/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-image\.png$/);
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  const faq = ld['@graph'].find(x => x['@type'] === 'FAQPage').mainEntity.map(q => q.name);
  expect(await page.locator('footer .about h3').allTextContents()).toEqual(faq);     // Google wants FAQ markup to be visible text
  expect((await request.get('/og-image.png')).status()).toBe(200);
  expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap: https://heat.sala.company/sitemap.xml');
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
  for (const f of ['up', 'down', 'ob', 'rs', 'vol', 'cross', 'stop']) {
    const chip = page.locator(`#filters .chip[data-f="${f}"]`);
    const count = Number(await chip.locator('.n').textContent());
    if (['rs', 'vol', 'cross'].includes(f)) await page.locator('#moreFilters summary').click();   // these live in "More ▾"
    await chip.click();
    if (count) await expect(tiles(page)).toHaveCount(count);
    else await expect(page.locator('#grid .empty')).toContainText('right now');
  }
  await page.locator('#filters .chip[data-f="all"]').click();
  await expect(tiles(page)).toHaveCount(N);
});

test('"More ▾" holds the less-used filters: picking one closes the menu and shows on its button', async ({ page }) => {
  const more = page.locator('#moreFilters');
  await expect(more.locator('[data-f="cross"]')).toBeHidden();
  await more.locator('summary').click();
  await expect(more.locator('[data-f="cross"]')).toBeVisible();
  await more.locator('[data-f="cross"]').click();
  await expect(more.locator('summary')).toHaveText('More: Recent cross ▾');
  await expect(more.locator('[data-f="cross"]')).toBeHidden();                  // closed after picking
  await page.locator('#filters .chip[data-f="all"]').click();
  await expect(more.locator('summary')).toHaveText('More ▾');
  await more.locator('summary').click();
  await page.locator('h1').click();                                         // a click elsewhere closes it
  await expect(more.locator('[data-f="cross"]')).toBeHidden();
});

test('ⓘ on a tile opens its chart card at once; resting elsewhere on a tile opens it after ~0.7 s', async ({ page }) => {
  const popup = page.locator('#detail');
  const ti = tile(page, 'beta-coin').locator('.ti');
  const b = await ti.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await expect(popup).toHaveClass(/show/, { timeout: 400 });                 // no 0.7 s wait
  await expect(popup.locator('.d-head b')).toHaveText('Beta Coin');
  await page.mouse.move(5, 5);
  await expect(popup).not.toHaveClass(/show/);
  const a = await tile(page, 'alpha-coin').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 40);
  await page.waitForTimeout(350);
  await expect(popup).not.toHaveClass(/show/);
  await expect(popup).toHaveClass(/show/, { timeout: 1500 });
});

test('"How to read" is the one place that explains the page, including that the emoji are conditions, not predictions', async ({ page }) => {
  await page.locator('#legendToggle').click();
  const more = page.locator('#legendMore');
  await expect(more).toContainText('not predictions');
  await expect(more).toContainText('Reading a tile');
  await expect(page.locator('footer')).not.toContainText('How to read a tile');   // no second copy in the footer
});

test('color scale: clicking a range shows only coins in it; again (or All coins) shows every coin', async ({ page }) => {
  const ranges = page.locator('#legendScale [data-heat]');
  await expect(ranges).toHaveCount(9);
  let total = 0;
  for (let i = 0; i < 9; i++) {
    const r = ranges.nth(i), k = await r.getAttribute('data-heat');
    await r.click();
    await expect(ranges.nth(i)).toHaveAttribute('aria-pressed', 'true');
    const n = await tiles(page).count();
    total += n;
    if (n) expect(await tiles(page).evaluateAll((els, k) => els.every(t => t.classList.contains(k)), k)).toBe(true);   // every tile is in that band
    else await expect(page.locator('#grid .empty')).toContainText('change of');
    await ranges.nth(i).click();                                              // again: back to all
    await expect(tiles(page)).toHaveCount(N);
  }
  expect(total).toBe(N);                                                      // the nine ranges cover every coin once
  await ranges.nth(4).click();                                                // ±1, then "All coins" clears it
  await page.locator('#filters .chip[data-f="all"]').click();
  await expect(tiles(page)).toHaveCount(N);
  await expect(page.locator('#legendScale [aria-pressed="true"]')).toHaveCount(0);
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
  for (const t of await page.locator('#grid .tile .emo').all()) expect(await t.getAttribute('title')).toMatch(/^(🚀 strong uptrend|😢 strong downtrend|🔥 strong 1-month momentum .*|🧊 weak 1-month momentum .*)$/);
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

// Forex: the same page at /forex/, with forex.json (tests/e2e/fixtures.mjs: 8 currencies, SAR pegged, IRR warned)
test.describe('forex', () => {
  const FX_VISIBLE = 9;   // 10 in the test data, minus the pegged SAR
  test.beforeEach(async ({ page }) => {
    await page.goto('/forex/');
    await expect(page.locator('#status')).toContainText(`${FX_VISIBLE}/${FX_VISIBLE} currencies with indicators`);
  });

  test('loads its own data, labels and search tags; the market switch links the two pages', async ({ page }) => {
    await expect(tiles(page)).toHaveCount(FX_VISIBLE);
    await expect(page).toHaveTitle(/Forex Heatmap/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://heat.sala.company/forex/');
    await expect(page.locator('#colorBy button')).toHaveText(['1d', '1w', '1m']);
    await expect(page.locator('#fresh')).toContainText('Rates of');
    await expect(page.locator('#fresh')).toContainText('not real-time');
    await expect(page.locator('#market a[aria-current="page"]')).toHaveText(/Forex/);
    await expect(page.locator('#market a[data-m="crypto"]')).toHaveAttribute('href', '/');
    await expect(page.locator('#legendScale')).toContainText('±0.1');                        // forex-sized color ranges
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    const faq = ld['@graph'].find(x => x['@type'] === 'FAQPage').mainEntity.map(q => q.name);
    expect(await page.locator('footer .about h3').allTextContents()).toEqual(faq);
    expect(external).toEqual([]);
  });

  test('US Dollar Index bar: computed from the six ECB rates, follows the timeframe, not on the Scorecard or other markets', async ({ page }) => {
    const bar = page.locator('#dxy');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('US Dollar Index');
    expect(Number(await bar.locator('.dxy-val').textContent())).toBeGreaterThan(50);
    await expect(bar.locator('.dxy-chg')).toHaveClass(/\bh-?[0-4]\b/);                    // the same heat colours as the tiles
    await expect(bar.locator('.dxy-tfs')).toContainText('1w');
    await page.locator('#colorBy [data-v="30d"]').click();
    await expect(bar.locator('.dxy-tfs')).toContainText('1d');                              // the chosen timeframe moves into the coloured chip
    await page.locator('#quote [data-v="usd"]').click();
    await expect(bar.locator('.dxy-val')).toHaveText(/^\d+\.\d\d$/);                        // an index of the dollar: the same either way pairs are quoted
    await page.locator('#view [data-v="score"]').click();
    await expect(bar).toBeHidden();
    await page.goto('/');
    await expect(page.locator('#dxy')).toBeHidden();
  });

  test('tiles: every pair USD/…, rates without $, ✓ for ECB and ? for the extra feed', async ({ page }) => {
    const eur = tile(page, 'eur');
    await expect(eur.locator('.sym')).toContainText('USD/EUR');
    await expect(tile(page, 'jpy').locator('.sym')).toContainText('USD/JPY');
    expect(await eur.locator('.px').textContent()).toMatch(/^0\.\d{5}$/);                   // e.g. 0.88067 euros per dollar
    await expect(eur.locator('.vf.ok')).toHaveCount(1);
    await expect(tile(page, 'rub').locator('.vf.guess')).toHaveCount(1);
    await expect(tile(page, 'sar')).toHaveCount(0);                                         // pegged: hidden
  });

  test('pegged currencies show with their own checkbox, separate from crypto stablecoins', async ({ page }) => {
    await expect(page.locator('#pegged').locator('..')).toContainText('Pegged');
    await page.locator('#pegged').check();
    await expect(tiles(page)).toHaveCount(FX_VISIBLE + 1);
    await expect(tile(page, 'sar')).toHaveCount(1);
    await page.goto('/');
    await expect(page.locator('#pegged')).not.toBeChecked();                                // crypto keeps its own choice
  });

  test('quote switch: …/USD flips every pair (name, rate, change, color), is remembered, and flips back', async ({ page }) => {
    const jpy = tile(page, 'jpy');
    const read = async () => ({
      name: (await jpy.locator('.sym').textContent()).trim(), px: await jpy.locator('.px').textContent(),
      chg: await jpy.locator('.chg').textContent(), cls: (await jpy.getAttribute('class')).match(/\bh-?\d\b/)[0],
      eur: (await tile(page, 'eur').locator('.sym').textContent()).trim(),
    });
    const market = await read();
    expect(market.name).toContain('USD/JPY');
    await page.locator('#quote [data-v="usd"]').click();
    await expect(jpy.locator('.sym')).toContainText('JPY/USD');
    const usd = await read();
    expect(Number(usd.px)).toBeLessThan(0.1);                                   // 1 / ~150
    expect(Number(usd.px) * Number(market.px.replace(/,/g, ''))).toBeCloseTo(1, 3);
    const sign = s => s.startsWith('−') ? -1 : s.startsWith('+') ? 1 : 0;
    if (sign(market.chg)) expect(sign(usd.chg)).toBe(-sign(market.chg));        // the move flips
    if (market.cls !== 'h0') expect(usd.cls).toBe(market.cls.startsWith('h-') ? market.cls.slice(0, 1) + market.cls.slice(2) : 'h-' + market.cls.slice(1));
    expect(market.eur).toContain('USD/EUR');                                    // every pair flips, the euro too
    expect(usd.eur).toContain('EUR/USD');
    await page.locator('#view button[data-v="score"]').click();
    await expect(page.locator('#scorewrap')).toContainText('scored on USD/… pairs');
    await page.reload();
    await expect(page.locator('#status')).toContainText('currencies with indicators');
    await expect(page.locator('#quote [data-v="usd"]')).toHaveAttribute('aria-pressed', 'true');   // remembered
    await page.locator('#view button[data-v="grid"]').click();
    await page.locator('#quote [data-v="market"]').click();
    await expect(jpy.locator('.sym')).toContainText('USD/JPY');
    await page.goto('/');
    await expect(page.locator('#quote')).toBeHidden();                          // crypto has no quote switch
  });

  test('flags: a flag emoji where the system has them, a country-code badge where it doesn\'t (Windows)', async ({ page }) => {
    const sym = tile(page, 'eur').locator('.sym');
    expect(await sym.locator('.flag').count() + await sym.locator('.flag-code').count()).toBe(1);
    if (await sym.locator('.flag-code').count()) await expect(sym.locator('.flag-code')).toHaveText('EU');
  });

  test('an unusual one-day jump gets a ⚠ on the tile and an explanation in the popup', async ({ page }) => {
    const egp = tile(page, 'egp');
    await expect(egp.locator('.caution')).toHaveCount(1);
    expect(await egp.locator('.caution').getAttribute('title')).toMatch(/Unusual jump of \+1[45]\.\d% on/);
    await egp.click();
    await expect(page.locator('#detail')).toContainText('far outside this currency');
    await expect(tile(page, 'jpy').locator('.caution')).toHaveCount(0);
  });

  test('rial: the popup warns that official and market rates differ', async ({ page }) => {
    await tile(page, 'irr').click();
    await expect(page.locator('#detail')).toHaveClass(/pinned/);
    await expect(page.locator('#detail')).toContainText('official rate and the street');
    await expect(page.locator('#detail')).toContainText('1d');
    await expect(page.locator('#detail')).not.toContainText('Cap ');
  });

  test('scorecard view renders from forex-scorecard.json', async ({ page }) => {
    await page.locator('#view button[data-v="score"]').click();
    await expect(page.locator('#scorewrap')).toContainText("Yesterday's calls");
    await expect(page.locator('#scorewrap .sc-chart svg')).toBeVisible();
  });
});

test('Heatmap tiles are the default: whole tile in its colour, symbol, change, price; Detailed switches back, remembered and linkable', async ({ page }) => {
  await page.evaluate(() => { localStorage.setItem('hm.realDefaults', '1'); localStorage.removeItem('hm.prefs'); });
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('with indicators');
  const cols = () => page.locator('#grid').evaluate(g => getComputedStyle(g).gridTemplateColumns.split(' ').length);
  await expect(page.locator('#density [data-v="heatmap"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#grid')).toHaveClass(/heatmap/);
  await expect(page).toHaveURL(/\/$/);
  const t = tile(page, 'alpha-coin');
  await expect(t.locator('.ind')).toBeHidden();
  await expect(t.locator('.name')).toBeHidden();
  await expect(t.locator('.chg')).toBeVisible();
  await expect(t.locator('.px')).toBeVisible();
  const bg = await t.evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).getPropertyValue('--tint').trim()]);
  expect(bg[1]).not.toBe('');                                                               // filled with its heat colour
  await t.click();                                                                          // the chart card has the details
  await expect(page.locator('#detail .d-head b')).toHaveText('Alpha Coin');
  await page.locator('#detail .x').click();
  const heatCols = await cols();
  await page.locator('#density [data-v="detailed"]').click();
  await expect(page.locator('#grid')).not.toHaveClass(/heatmap/);
  await expect(page).toHaveURL(/\?d=detailed$/);
  expect(await cols()).toBeLessThan(heatCols);
  await expect(t.locator('.ind')).toBeVisible();
  await page.locator('#view [data-v="table"]').click();
  await expect(page.locator('#density')).toBeHidden();
  await page.goto('/');                                                                     // remembered
  await expect(page.locator('#grid')).not.toHaveClass(/heatmap/);
  await page.goto('/?d=heatmap');                                                           // a link applies for that visit
  await expect(page.locator('#grid')).toHaveClass(/heatmap/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hm.prefs')).tiles)).toBe('detailed');
});

test('↺ Reset, first in the controls under the market tabs, puts every control back to the default view and remembers it', async ({ page }) => {
  await page.goto('/?tf=7d');
  await expect(page.locator('#status')).toContainText('with indicators');
  const reset = page.locator('#reset');
  expect(await reset.evaluate(el => el === el.parentElement.firstElementChild && el.parentElement.previousElementSibling?.id === 'market')).toBe(true);
  await page.locator('#pegged').check();
  await page.locator('#density [data-v="detailed"]').click();   // (tests start on detailed; Reset brings heatmap back)
  await page.locator('#filters .chip[data-f="up"]').click();
  await tiles(page).first().click();                                                        // and a chart card open
  await expect(page.locator('#detail')).toHaveClass(/pinned/);
  await reset.dispatchEvent('click');                                                       // the open card may cover it
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#detail')).not.toHaveClass(/show/);
  await expect(page.locator('#filters .chip[data-f="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#colorBy [data-v="24h"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#density [data-v="heatmap"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#grid')).toHaveClass(/heatmap/);
  await expect(page.locator('#pegged')).not.toBeChecked();
  await expect(tiles(page)).toHaveCount(N);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hm.prefs')));
  expect([saved.colorBy, saved.view, saved.tiles, saved.pegged]).toEqual(['24h', 'grid', 'heatmap', false]);
});

test.describe('shareable links', () => {
  // on the page's own default tiles (heatmap), so the links carry only what each test changes
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => { localStorage.setItem('hm.realDefaults', '1'); const p = JSON.parse(localStorage.getItem('hm.prefs') || '{}'); delete p.tiles; localStorage.setItem('hm.prefs', JSON.stringify(p)); });
  });
  test('a link opens that view (filter, timeframe, coin) without changing the visitor\'s saved settings', async ({ page }) => {
    await page.goto('/?f=up&tf=7d&coin=alpha-coin');
    await expect(page.locator('#status')).toContainText('with indicators');
    await expect(page.locator('#filters .chip[data-f="up"]')).toHaveAttribute('aria-pressed', 'true');
    const n = Number(await page.locator('#filters .chip[data-f="up"] .n').textContent());
    await expect(tiles(page)).toHaveCount(n);                                             // filtered once the indicators are in
    await expect(page.locator('#colorBy [data-v="7d"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#detail')).toHaveClass(/pinned/);
    await expect(page.locator('#detail .d-head b')).toHaveText('Alpha Coin');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hm.prefs') || '{}').colorBy)).not.toBe('7d');
  });

  test('the address bar follows every change, and 🔗 copies it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toContainText('with indicators');
    await page.locator('#colorBy [data-v="30d"]').click();
    await expect(page).toHaveURL(/\?tf=30d$/);
    await page.locator('#filters .chip[data-f="down"]').click();
    await expect(page).toHaveURL(/\?f=down&tf=30d$/);
    await page.locator('#filters .chip[data-f="all"]').click();
    await tile(page, 'moon-coin').click();
    await expect(page).toHaveURL(/\?tf=30d&coin=moon-coin$/);
    await page.evaluate(() => { window.copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => window.copied.push(t) }, configurable: true }); });
    await page.locator('#detail [data-copy-link]').click();
    await page.locator('#share').dispatchEvent('click');                                 // on this screen size the open card covers the header
    await expect(page.locator('#share')).toHaveText('✓ Copied');
    await expect(page.locator('#detail')).toHaveClass(/pinned/);                          // the header button keeps the popup open
    expect(await page.evaluate(() => window.copied)).toEqual(Array(2).fill(page.url()));
    await page.locator('#detail .x').click();
    await expect(page).toHaveURL(/\?tf=30d$/);
    await page.locator('#colorBy [data-v="24h"]').click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('forex: the quote direction travels with the link; a filter the page lacks is ignored', async ({ page }) => {
    await page.goto('/forex/?q=usd&f=vol&coin=jpy');
    await expect(page.locator('#status')).toContainText('with indicators');
    await expect(page.locator('#quote [data-v="usd"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#filters .chip[data-f="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#detail .d-head')).toContainText('JPY/USD');
    await expect(page).toHaveURL(/\/forex\/\?q=usd&coin=jpy$/);
  });
});

test('emoji size follows each signal\'s Scorecard record: small and grey until proven, full size once it is', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('with indicators');
  const mark = page.locator('#grid .emo[data-k], #grid .pnf-mark[data-k]').first();
  await expect(mark).toBeVisible();
  const k = await mark.getAttribute('data-k');
  // the page's classes match the rule in signals.mjs, applied to the scorecard it loaded
  const expected = await page.evaluate(async () => {
    const SIG = await import('/signals.mjs');
    const card = await (await fetch('/scorecard.json')).json();
    return [...SIG.provenSignals(card, SIG.withDefaults(card.params))].sort();
  });
  const classes = await page.evaluate(() => [...document.body.classList].filter(c => c.startsWith('proven-')).map(c => c.slice(7)).sort());
  expect(classes).toEqual(expected);
  const size = () => mark.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await page.evaluate(k => document.body.classList.remove(`proven-${k}`), k);
  expect(await size()).toBe(10);
  await page.evaluate(k => document.body.classList.add(`proven-${k}`), k);
  expect(await size()).toBe(17);
});

// Relative strength and volume rows (Bollinger width is gone from the tiles; the bands stay in the chart)
test.describe('relative strength and volume', () => {
  const row = (page, id, k) => tile(page, id).locator('.row', { has: page.locator(`.k:text-is("${k}")`) });

  test('crypto tiles: RS and VOL rows, no BBW; a volume surge on a climb is tagged and filterable', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toContainText('with indicators');
    await expect(page.locator('#grid .row .k', { hasText: 'BBW' })).toHaveCount(0);
    await expect(row(page, 'alpha-coin', 'RS')).toHaveCount(1);
    await expect(row(page, 'alpha-coin', 'RS')).toContainText('n/a');                // no Bitcoin in the test data: no benchmark
    await expect(row(page, 'alpha-coin', 'VOL')).toContainText('usual volume');
    await expect(row(page, 'moon-coin', 'VOL').locator('.tag.vol-up')).toContainText('on a climb');
    await page.locator('#moreFilters summary').click();
    const chip = page.locator('#filters .chip[data-f="vol"]');
    await expect(chip).toBeVisible();
    await expect(chip.locator('.n')).toHaveText('1');
    await chip.click();
    await expect(tiles(page)).toHaveCount(1);
    await expect(tile(page, 'moon-coin')).toHaveCount(1);
    await page.locator('#filters .chip[data-f="all"]').click();
    await tile(page, 'moon-coin').click();
    await expect(page.locator('#detail dl.kv')).toContainText('Volume (7d vs 30d)');
    await expect(page.locator('#detail dl.kv')).not.toContainText('BB width');
    await expect(page.locator('#detail .d-legend')).toContainText('Bollinger');          // still drawn in the chart
  });

  test('forex compares with the basket (no volume row); metals with gold', async ({ page }) => {
    await page.goto('/forex/');
    await expect(page.locator('#status')).toContainText('with indicators');
    await expect(row(page, 'eur', 'RS')).toContainText(/[+−]\d+\.\d%/);
    await expect(row(page, 'eur', 'VOL')).toHaveCount(0);
    await expect(page.locator('#filters .chip[data-f="vol"]')).toBeHidden();
    await expect(page.locator('#filters .chip[data-f="rs"]')).toContainText('Beating basket');
    await page.goto('/metals/');
    await expect(page.locator('#status')).toContainText('with indicators');
    await expect(row(page, 'xau', 'RS')).toContainText('the benchmark');
    await expect(row(page, 'xag', 'RS')).toContainText(/[+−]\d+\.\d%/);
  });
});

// TradingView links (tests/e2e/fixtures.mjs makeTvFixture: which symbols "exist")
test.describe('TradingView link', () => {
  const tvLinks = page => page.locator('#detail .d-head a.tv');
  const open = async (page, id) => { await tile(page, id).click(); await expect(page.locator('#detail')).toHaveClass(/pinned/); };

  test('crypto: links the exchange pair, in a new tab; no link when the symbol is missing or another coin', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toContainText('with indicators');
    await open(page, 'alpha-coin');
    await expect(tvLinks(page)).toHaveCount(2);                                             // logo + name, and "TradingView ↗"
    await expect(tvLinks(page).first()).toHaveAttribute('href', 'https://www.tradingview.com/chart/?symbol=BINANCE%3AALPUSDT');
    await expect(tvLinks(page).first()).toHaveAttribute('target', '_blank');
    await expect(tvLinks(page).first()).toHaveAttribute('rel', /noopener/);
    await expect(page.locator('#detail .d-head')).toContainText('TradingView ↗');
    await page.locator('#detail .x').click();
    await open(page, 'beta-coin');                                                          // CRYPTO:BETUSD is "Betting Token"
    await expect(page.locator('#detail .d-head b')).toHaveText('Beta Coin');
    await expect(tvLinks(page)).toHaveCount(0);
    expect(external).toEqual([]);                                                           // checked at deploy, not by the page
  });

  test('forex: follows the quote switch; metals: spot symbol', async ({ page }) => {
    await page.goto('/forex/');
    await expect(page.locator('#status')).toContainText('with indicators');
    await open(page, 'jpy');
    await expect(tvLinks(page).first()).toHaveAttribute('href', /symbol=FX_IDC%3AUSDJPY$/);
    await page.locator('#detail .x').click();
    await page.locator('#quote [data-v="usd"]').click();
    await open(page, 'jpy');
    await expect(tvLinks(page).first()).toHaveAttribute('href', /symbol=FX_IDC%3AJPYUSD$/);
    await page.locator('#detail .x').click();
    await open(page, 'eur');
    await expect(tvLinks(page)).toHaveCount(0);                                             // not in tv.json: no link
    await page.goto('/metals/');
    await expect(page.locator('#status')).toContainText('with indicators');
    await open(page, 'xau');
    await expect(tvLinks(page).first()).toHaveAttribute('href', /symbol=TVC%3AGOLD$/);
  });
});

// Metals: the same page at /metals/, with metals.json (tests/e2e/fixtures.mjs: 4 metals plus a "bitcoin" tile)
test.describe('metals', () => {
  const N = 5;
  test.beforeEach(async ({ page }) => {
    await page.goto('/metals/');
    await expect(page.locator('#status')).toContainText(`${N}/${N} assets with indicators`);
  });

  test('loads its own data and search tags; no scorecard, no pegged checkbox; the switch links all seven pages', async ({ page }) => {
    await expect(tiles(page)).toHaveCount(N);
    await expect(page).toHaveTitle(/Precious Metals Heatmap/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://heat.sala.company/metals/');
    await expect(page.locator('#market a[aria-current="page"]')).toHaveText(/Metals/);
    await expect(page.locator('#market a')).toHaveCount(7);
    await expect(page.locator('#market a[data-m="predictions"]')).toHaveAttribute('href', '/predictions/');
    await expect(page.locator('#market a[data-m="forex"]')).toHaveAttribute('href', '/forex/');
    await expect(page.locator('#view [data-v="score"]')).toBeHidden();
    await expect(page.locator('#pegged')).toBeHidden();
    await expect(page.locator('#fresh')).toContainText('not real-time');
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    const faq = ld['@graph'].find(x => x['@type'] === 'FAQPage').mainEntity.map(q => q.name);
    expect(await page.locator('footer .about h3').allTextContents()).toEqual(faq);
    expect(external).toEqual([]);
  });

  test('tiles: metal badges, dollar prices per ounce; ✓ when two sources agree, ⚠ when not, ? until checked', async ({ page }) => {
    const gold = tile(page, 'xau');
    await expect(gold.locator('.metal')).toHaveText('Au');
    await expect(gold).toContainText('Gold');
    expect(await gold.locator('.px').textContent()).toMatch(/^\$[\d,]+$/);
    await expect(gold.locator('.vf.ok')).toHaveCount(1);                                    // confirmed by Swissquote
    await expect(gold.locator('.vf.ok')).toHaveAttribute('title', /Swissquote.*within 0\.12%/);
    await expect(tile(page, 'xag').locator('.vf.guess')).toHaveCount(1);                    // 2.4% apart
    await expect(tile(page, 'xag').locator('.caution')).toHaveAttribute('title', /disagree by 2\.4%/);
    await expect(tile(page, 'xpt').locator('.vf.guess')).toHaveAttribute('title', /Not cross-checked yet/);
    await expect(tile(page, 'xpt').locator('.caution')).toHaveCount(0);
    await expect(page.locator('#grid .metal')).toHaveCount(4);
    await expect(tile(page, 'bitcoin')).toHaveCount(1);
    await gold.click();
    await expect(page.locator('#detail')).toHaveClass(/pinned/);
    await expect(page.locator('#detail .d-head b')).toHaveText('Gold');
    await expect(page.locator('#detail .d-src', { hasText: 'exchange-api and Swissquote agree' })).toHaveCount(1);
  });

  test('footer: the sources health line on every page, with details on hover', async ({ page }) => {
    for (const url of ['/', '/forex/', '/metals/']) {
      await page.goto(url);
      const line = page.locator('#health');
      await expect(line).toBeVisible();
      await expect(line).toContainText('Sources: CoinGecko ✓ · ECB ✓ · Swissquote ⚠');
      await expect(line.locator('[data-src="swissquote"]')).toHaveClass(/hs-warn/);
      await expect(line.locator('[data-src="swissquote"]')).toHaveAttribute('title', /disagrees: Silver 2\.4%/);
    }
  });

  test('the crypto page keeps its scorecard after visiting metals', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#view [data-v="score"]')).toBeVisible();
  });
});

// Energy: the same page at /energy/, with energy.json (tests/e2e/fixtures.mjs: six futures on weekdays only)
test.describe('energy', () => {
  const N = 6;
  test.beforeEach(async ({ page }) => {
    await page.goto('/energy/');
    await expect(page.locator('#status')).toContainText(`${N}/${N} assets with indicators`);
  });

  test('loads its own data and search tags; no scorecard; trading-day timeframes', async ({ page }) => {
    await expect(tiles(page)).toHaveCount(N);
    await expect(page).toHaveTitle(/Oil, Diesel & Natural Gas/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://heat.sala.company/energy/');
    await expect(page.locator('#market a[aria-current="page"]')).toHaveText(/Energy/);
    await expect(page.locator('#view [data-v="score"]')).toBeHidden();
    await expect(page.locator('#pegged')).toBeHidden();
    await expect(page.locator('#colorBy button')).toHaveText(['1d', '1w', '1m']);
    await expect(page.locator('#fresh')).toContainText('delayed ~10 min');
    await expect(page.locator('#fresh a')).toHaveText('Source: Yahoo Finance');
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    const faq = ld['@graph'].find(x => x['@type'] === 'FAQPage').mainEntity.map(q => q.name);
    expect(await page.locator('footer .about h3').allTextContents()).toEqual(faq);
    expect(external).toEqual([]);
  });

  test('weekly rows under the futures: pump prices in $/litre (sortable) and US refined spot prices, each marked as such', async ({ page }) => {
    const pumpRow = page.locator('#fuelPump');
    await expect(pumpRow.locator('h2')).toContainText('Pump prices');
    await expect(pumpRow.locator('.f-tag')).toContainText('weekly');
    await expect(pumpRow.locator('tbody tr')).toHaveCount(3);
    await expect(pumpRow.locator('tbody tr').first()).toContainText('Germany');       // dearest petrol first
    await expect(pumpRow.locator('tbody tr').first()).toContainText('$2.59');
    await expect(pumpRow.locator('tbody tr').first()).toContainText('new');           // no week-on-week yet
    await expect(pumpRow.locator('tr', { hasText: 'United States' })).toContainText('▼ 2.5%');
    await pumpRow.locator('#fsort').selectOption('name');
    await expect(pumpRow.locator('tbody tr').first()).toContainText('Germany');
    await pumpRow.locator('#fsort').selectOption('chg');
    await expect(pumpRow.locator('tbody tr').first()).toContainText('United Kingdom');
    const spot = page.locator('#fuelSpot');
    await expect(spot.locator('.f-tag')).toContainText('about a week behind');
    await expect(spot.locator('tbody tr')).toHaveCount(2);
    await expect(spot.locator('tr', { hasText: 'Jet fuel' })).toContainText('$4.40');
  });

  test('tiles: product badges, prices without a currency sign, units in the popup, a TradingView link', async ({ page }) => {
    const wti = tile(page, 'wti');
    await expect(wti.locator('.metal')).toHaveText('WTI');
    await expect(wti).toContainText('WTI crude oil');
    expect(await wti.locator('.px').textContent()).toMatch(/^[\d,]+\.\d\d$/);
    expect(await tile(page, 'natgas').locator('.px').textContent()).toMatch(/^\d\.\d{3}$/);
    await expect(page.locator('#grid .metal')).toHaveCount(N);
    await expect(wti.locator('.vf')).toHaveCount(0);
    await expect(tile(page, 'ttf').locator('.vf.guess')).toHaveAttribute('title', /didn't answer/);   // not refreshed
    await wti.click();
    await expect(page.locator('#detail')).toHaveClass(/pinned/);
    await expect(page.locator('#detail .d-src', { hasText: 'US dollars per barrel' })).toContainText('CL=F');
    await expect(page.locator('#detail .d-head a.tv').first()).toHaveAttribute('href', /symbol=NYMEX%3ACL1!$/);
    await expect(page.locator('#detail')).toContainText('vs Brent');
  });
});

// ETFs: the same page at /etfs/, with etfs.json (tests/e2e/fixtures.mjs: all 112 funds on weekdays, KSA not refreshed)
test.describe('etfs', () => {
  const N = 112;
  test.beforeEach(async ({ page }) => {
    await page.goto('/etfs/');
    await expect(page.locator('#status')).toContainText(`${N}/${N} ETFs with indicators`);
  });

  test('loads its own data and search tags; no scorecard; trading-day timeframes', async ({ page }) => {
    await expect(tiles(page)).toHaveCount(N);
    await expect(page).toHaveTitle(/US ETF Heatmap/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://heat.sala.company/etfs/');
    await expect(page.locator('#market a[aria-current="page"]')).toHaveText(/ETFs/);
    await expect(page.locator('#view [data-v="score"]')).toBeHidden();
    await expect(page.locator('#pegged')).toBeHidden();
    await expect(page.locator('#colorBy button')).toHaveText(['1d', '1w', '1m']);
    await expect(page.locator('#fresh')).toContainText('US market hours only');
    await expect(page.locator('#fresh a')).toHaveText('Source: Yahoo Finance');
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    const faq = ld['@graph'].find(x => x['@type'] === 'FAQPage').mainEntity.map(q => q.name);
    expect(await page.locator('footer .about h3').allTextContents()).toEqual(faq);
    expect(external).toEqual([]);
  });

  test('grouped: a heading per group with its count and its average move, tiles in order under it; filters keep the headings honest', async ({ page }) => {
    await expect(page.locator('#grid .tgroup')).toHaveText([/^US stock market 28/, /^Sectors 11/, /^Industries & themes 39/, /^International 34/]);
    await expect(page.locator('#grid .tgroup[data-g="sector"] .tg-sum')).toHaveText(/^avg [+−]?\d+\.\d\d% · \d+ of 11 up$/);   // the group's average move and how many rose
    await expect(page.locator('#grid .tgroup[data-g="sector"] + .tile')).toHaveAttribute('data-id', 'xlk');
    await expect(page.locator('#grid > *').first()).toHaveClass(/tgroup/);
    await page.locator('#colorBy [data-v="7d"]').click();
    const heat = page.locator('#legendScale [data-heat]').first();
    await heat.click();
    const shown = await tiles(page).count();
    const counts = (await page.locator('#grid .tgroup > span:not(.tg-sum)').allTextContents()).map(Number);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(shown);
  });

  test('tiles: short names (kept on heatmap tiles), flags for countries, dollar prices, fund name in the popup, a TradingView link', async ({ page }) => {
    const spy = tile(page, 'spy');
    await expect(spy).toContainText('S&P 500');
    expect(await spy.locator('.px').textContent()).toMatch(/^\$[\d,]+\.\d\d$/);
    await expect(tile(page, 'ewj')).toContainText('Japan');
    await expect(tile(page, 'ewj').locator('.flag, .flag-code')).toHaveCount(1);
    await expect(tile(page, 'ksa').locator('.vf.guess')).toHaveAttribute('title', /didn't answer/);   // not refreshed
    await expect(spy.locator('.row .k', { hasText: 'VOL' })).toHaveCount(1);
    await spy.click();
    await expect(page.locator('#detail')).toHaveClass(/pinned/);
    await expect(page.locator('#detail .d-src', { hasText: 'SPY Fund Trust' })).toContainText('SPY Fund Trust (SPY) on Yahoo Finance');
    await expect(page.locator('#detail .d-head a.tv').first()).toHaveAttribute('href', /symbol=AMEX%3ASPY$/);
    await page.keyboard.press('Escape');
    await page.locator('#density [data-v="heatmap"]').click();
    await expect(page.locator('#grid')).toHaveClass(/heatmap/);
    await expect(spy.locator('.name .nm')).toBeVisible();
    await expect(spy.locator('.name .nm')).toHaveText('S&P 500');
  });
});

// Rates: the same page at /rates/, drawing its own view from rates.json (tests/e2e/fixtures.mjs: fourteen daily markets and 15 monthly European ones, Canada
// inverted, the euro area flat)
test.describe('rates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/rates/');
    await expect(page.locator('#status')).toContainText('14 markets · 1 inverted · 15 monthly');
  });

  test('its own view: a tile per market, no price controls, its own search tags, nothing from outside', async ({ page }) => {
    await expect(page.locator('#grid .rtile')).toHaveCount(14);
    await expect(page.locator('#grid .tile')).toHaveCount(0);
    await expect(page).toHaveTitle(/Government Bond Yield Curves/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://heat.sala.company/rates/');
    await expect(page.locator('#market a[aria-current="page"]')).toHaveText(/Rates/);
    for (const s of ['#colorBy', '#view', '#density', '#legend', '#refresh', '#reset']) await expect(page.locator(s)).toBeHidden();
    await expect(page.locator('#fresh')).toContainText('Official closing yields');
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    const faq = ld['@graph'].find(x => x['@type'] === 'FAQPage').mainEntity.map(q => q.name);
    expect(await page.locator('footer .about h3').allTextContents()).toEqual(faq);
    expect(external).toEqual([]);
  });

  test('tiles: 10-year yield, change in basis points, the curve reading; the UK slope uses Bank Rate', async ({ page }) => {
    const us = page.locator('.rtile[data-id="us"]');
    await expect(us.locator('.rt-chg')).toHaveText('+4 bp');
    await expect(us.locator('.rt-y')).toContainText(/\d\.\d\d%/);
    await expect(us.locator('.rt-state')).toHaveText(/Normal/);
    await expect(page.locator('.rtile[data-id="ca"] .rt-state')).toHaveText(/Inverted/);
    await expect(page.locator('.rtile[data-id="ea"] .rt-state')).toHaveText(/Flat/);
    await expect(page.locator('.rtile[data-id="uk"] .rt-slope')).toContainText('10y−BR');
    await expect(page.locator('.rtile[data-id="za"] .rt-slope')).toContainText('10y−3m');
    await page.locator('#rtf button[data-v="1m"]').click();
    await expect(page.locator('#rlegend')).toContainText('1m change in the 10-year yield');
  });

  test('a card opens its curve in a small popup beside it (two cards wide and tall): key numbers first, details below; closes like the others', async ({ page }) => {
    const pop = page.locator('#detail');
    await expect(page.locator('#ratesAll')).toHaveCount(0);                  // no combined chart under the cards
    await expect(pop).not.toHaveClass(/pinned/);
    await page.locator('.rtile[data-id="ca"]').click();
    await expect(pop).toHaveClass(/pinned/);
    await expect(pop.locator('h2')).toContainText('Canada');
    await expect(pop.locator('.r-says')).toContainText('Inverted');
    await expect(pop.locator('.r-keys')).toContainText('A year ago');
    await expect(pop.locator('.r-chart')).toHaveCount(1);                   // one chart at a time (Curve | History)
    await expect(pop.locator('.r-mini').first()).toContainText('10y');
    const card = await page.locator('.rtile[data-id="ca"]').boundingBox(), box = await pop.boundingBox();
    expect(Math.abs(box.width - (card.width * 2 + 8))).toBeLessThan(3);       // about two cards wide …
    expect(box.height).toBeLessThanOrEqual(card.height * 2 + 10);           // … and at most two cards tall
    expect(box.x >= card.x + card.width || box.x + box.width <= card.x).toBe(true);   // beside the card, not over it
    await expect(page.locator('.rtile.sel')).toHaveAttribute('data-id', 'ca');
    await expect(page).toHaveURL(/\/rates\/\?c=ca$/);
    await page.locator('.rtile[data-id="jp"]').dispatchEvent('click');    // another card (under the popup here): switches, stays open
    await expect(pop.locator('h2')).toContainText('Japan');
    await page.keyboard.press('Escape');
    await expect(pop).not.toHaveClass(/pinned/);
    await expect(page).toHaveURL(/\/rates\/$/);
    await page.goto('/rates/?c=ca');                                         // a shared link opens that curve
    await expect(pop).toHaveClass(/pinned/);
    await expect(pop.locator('h2')).toContainText('Canada');
    await pop.locator('.x').click();
    await expect(pop).not.toHaveClass(/pinned/);
    await page.locator('.mtile[data-id="it"]').click();                    // a monthly card opens its own
    await expect(pop.locator('h2')).toContainText('Italy');
  });

  test('cards lead with the yield: a sketch of each curve, only what is unusual (a yield below inflation); a date more than 2 business days old is greyed', async ({ page }) => {
    await expect(page.locator('#grid .rt-spark')).toHaveCount(14);
    const us = page.locator('.rtile[data-id="us"]');
    // readable without telling colours apart: every reading has an arrow for its slope
    await expect(us.locator('.rt-state .st-ico')).toContainText('↗');
    await expect(page.locator('.rtile[data-id="ca"] .rt-state .st-ico')).toContainText('↘');
    await expect(page.locator('.rtile[data-id="ea"] .rt-state .st-ico')).toContainText('→');
    // the real yield shows on a card only when it is below zero (▼ on orange); inflation and the rest are in the popup
    await expect(us.locator('.r-real, .r-infl')).toHaveCount(0);
    await expect(page.locator('.rtile[data-id="cn"] .rt-flags .r-real')).toHaveClass(/neg/);
    await expect(page.locator('.rtile[data-id="cn"] .rt-flags .r-real')).toContainText('▼');
    await expect(page.locator('.rtile[data-id="ch"] .r-real')).toHaveCount(0);       // no inflation figure: nothing to flag
    await us.click();
    await expect(page.locator('#detail .r-mini2 .r-real')).toHaveClass(/pos/);
    await expect(page.locator('#detail .r-mini2 .r-infl')).toHaveText('CPI 2.5% · Aug');
    await page.keyboard.press('Escape');
    await expect(page.locator('.rtile[data-id="jp"] .rt-date')).toHaveClass(/old/);
    await expect(us.locator('.rt-date')).not.toHaveClass(/old/);
    await expect(page.locator('#ratesMonthly .rt-spark')).toHaveCount(15);
    await expect(page.locator('#ratesMonthly h2')).toContainText('doesn’t apply');
  });

  test('sort, group by region, table view; each remembered', async ({ page }) => {
    await page.locator('#rsort').selectOption('state');
    await expect(page.locator('#grid .rtile').first()).toHaveAttribute('data-id', 'ca');   // the inverted curve first
    await page.locator('#rgroup').selectOption('region');
    await expect(page.locator('.r-group h3')).toHaveText(['Americas', 'Europe', 'Asia-Pacific', 'Africa']);
    await page.reload();
    await expect(page.locator('#rsort')).toHaveValue('state');
    await expect(page.locator('.r-group h3').first()).toHaveText('Americas');
    await page.locator('#rview button[data-v="table"]').click();
    await expect(page.locator('#ratesTable')).toBeVisible();
    await expect(page.locator('#grid')).toBeHidden();
    await expect(page.locator('#ratesTable tbody tr')).toHaveCount(29);
    await expect(page.locator('#ratesTable tbody tr').first()).toHaveAttribute('data-id', 'ca');
    await page.locator('#ratesTable tr[data-id="no"]').click();
    await expect(page.locator('#detail')).toHaveClass(/pinned/);
    await expect(page.locator('#detail h2')).toContainText('Norway');
    await page.keyboard.press('Escape');
    await page.locator('#rview button[data-v="cards"]').click();
    await page.locator('#rsort').selectOption('default');
    await page.locator('#rgroup').selectOption('none');
    await expect(page.locator('#grid .rtile').first()).toHaveAttribute('data-id', 'us');
  });

  test('popup: real yield, rank against its own history, and a Curve | History switch; "How to read" explains the terms', async ({ page }) => {
    await page.locator('.rtile[data-id="us"]').click();
    const pop = page.locator('#detail');
    await expect(pop.locator('.r-mini').nth(1)).toContainText('Real yield');
    await expect(pop.locator('.r-mini').nth(1)).toContainText('steeper than');
    await expect(pop.locator('.r-mini').first()).toContainText('10y−3m');
    await expect(pop.locator('a.tv-go')).toHaveAttribute('href', /symbol=TVC%3AUS10Y$/);   // TradingView, as on the other pages
    await expect(pop.locator('a.tv-go')).toHaveAttribute('target', '_blank');
    await expect(pop.locator('[data-rtab="curve"]')).toHaveAttribute('aria-pressed', 'true');
    await pop.locator('[data-rtab="history"]').click();
    await expect(pop.locator('[data-rtab="history"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(pop.locator('.r-keys')).toContainText('10-year minus 2y');
    await expect(pop).toHaveClass(/pinned/);
    await pop.locator('[data-rtab="curve"]').click();
    await expect(pop.locator('.r-keys')).toContainText('A year ago');
    await page.keyboard.press('Escape');
    await page.locator('#rhelpBtn').click();
    await expect(page.locator('#rhelp')).toBeVisible();
    await expect(page.locator('#rhelp')).toContainText('Real yield');
    await expect(page.locator('#rhelp')).toContainText('basis point');
  });

  test('colour by: change (a week by default), the curve or the real yield; the corner number follows; remembered', async ({ page }) => {
    await expect(page.locator('#rtf button[aria-pressed="true"]')).toHaveText('1w');
    await expect(page.locator('#rlegend')).toContainText('1w change in the 10-year yield');
    await expect(page.locator('#rlegend .r-bpnote')).toContainText('1 bp = 0.01 pt');
    await page.locator('#rcolor button[data-v="curve"]').click();
    await expect(page.locator('#rtf')).toBeHidden();
    await expect(page.locator('#rlegend')).toContainText('the curve');
    const ca = page.locator('.rtile[data-id="ca"]');
    await expect(ca.locator('.rt-chg')).toContainText('−0.');                  // the inverted gap, in pp
    await expect(ca).toHaveClass(/h-\d/);                                       // the red side of the scale
    await expect(page.locator('.mtile').first()).toHaveClass(/ h0/);            // no curve for the monthly cards
    await page.locator('#rcolor button[data-v="real"]').click();
    await expect(page.locator('.rtile[data-id="us"] .rt-chg')).toContainText('%');
    await expect(page.locator('#rlegend')).toContainText('real yield');
    await page.reload();
    await expect(page.locator('#rcolor button[aria-pressed="true"]')).toHaveText('Real yield');
    await page.locator('#rcolor button[data-v="change"]').click();
    await expect(page.locator('#rtf')).toBeVisible();
  });

  test('mouse: resting on a card previews its curve beside it; moving away closes it; a click pins it in place', async ({ page }) => {
    const pop = page.locator('#detail'), card = page.locator('.rtile[data-id="ca"]');
    await card.hover();
    await expect(pop).toHaveClass(/show/);
    await expect(pop).not.toHaveClass(/pinned/);
    await expect(pop.locator('h2')).toContainText('Canada');
    await expect(page).toHaveURL(/\/rates\/$/);                              // a preview doesn't change the address
    await page.mouse.move(5, 5);
    await expect(pop).not.toHaveClass(/show/);
    await card.hover();
    await expect(pop).toHaveClass(/show/);
    const left = await pop.evaluate(b => b.style.left);
    await card.click();
    await expect(pop).toHaveClass(/pinned/);
    expect(await pop.evaluate(b => b.style.left)).toBe(left);                // pinned where it was
    await expect(page).toHaveURL(/\/rates\/\?c=ca$/);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    await expect(pop).toHaveClass(/pinned/);                                 // stays open once pinned
  });

  test('risk: the gap to the US (Germany for Europe) ranked in its own history; a card shows only a high-risk tag, the popup every level; sortable; explained', async ({ page }) => {
    // on the cards only the exception: ▲ High risk. Benchmarks, average and low risk are in the popup and the table
    await expect(page.locator('.rtile[data-id="us"] .r-risk')).toHaveCount(0);
    await expect(page.locator('#grid .rtile .r-risk')).toHaveText(Array((await page.locator('#grid .rtile .r-risk').count())).fill('▲ High risk'));
    const it = page.locator('.mtile[data-id="it"]'), es = page.locator('.mtile[data-id="es"]');
    await expect(it.locator('.r-risk')).toHaveText('▲ High risk');                         // its widest gap in the five years
    await expect(it.locator('.r-risk')).toHaveAttribute('title', /0\.85 pp more than Germany.*the widest of the last 5 years.*credit risk/);
    await expect(es.locator('.r-risk')).toHaveCount(0);                                   // low risk: in the popup
    await page.locator('.rtile[data-id="us"]').click();
    await expect(page.locator('#detail .r-mini2 .r-risk')).toHaveText('Benchmark');
    await page.keyboard.press('Escape');
    await page.locator('.rtile[data-id="uk"]').click();
    await expect(page.locator('#detail .r-mini2 .r-risk')).toHaveText(/^[▲●▼] (High|Average|Low) risk$/);
    await expect(page.locator('#detail .r-mini2 .r-risk')).toHaveAttribute('title', /than the US on 10-year debt.*inflation and currency risk/);
    await page.keyboard.press('Escape');
    await es.click();
    await expect(page.locator('#detail .r-mini2 .r-risk')).toHaveText('▼ Low risk');
    await page.keyboard.press('Escape');
    await page.locator('#rsort').selectOption('risk');
    await expect(page.locator('#ratesMonthly .mtile').first()).toHaveAttribute('data-id', 'it');
    await expect(page.locator('#ratesMonthly .mtile').last()).toHaveAttribute('data-id', 'es');
    await expect(page.locator('#grid .rtile').last()).toHaveAttribute('data-id', /^(us|ea|de)$/);   // benchmarks and untagged last
    await page.locator('#rsort').selectOption('default');
    await it.click();
    await expect(page.locator('#detail .r-mini2 .r-risk')).toHaveText('▲ High risk');
    await expect(page.locator('#detail .r-says')).toContainText('so high risk');
    await page.keyboard.press('Escape');
    await page.locator('#rhelpBtn').click();
    await expect(page.locator('#rhelp')).toContainText('Risk tag');
    await page.locator('#rview button[data-v="table"]').click();
    await expect(page.locator('#ratesTable th', { hasText: /^Risk$/ })).toHaveCount(2);
    await expect(page.locator('#ratesTable tr[data-id="it"] .r-risk')).toHaveText('▲ High risk');
    await page.locator('#rview button[data-v="cards"]').click();
  });

  test('Europe, monthly: its own labelled row; a tile opens the monthly chart with Germany for comparison', async ({ page }) => {
    const row = page.locator('#ratesMonthly');
    await expect(row).toBeVisible();
    await expect(row.locator('h2')).toContainText('Europe, monthly');
    await expect(row.locator('h2')).toContainText('August 2026');
    await expect(row.locator('.mtile')).toHaveCount(15);
    const it = row.locator('.mtile[data-id="it"]');
    await expect(it.locator('.rt-date')).toHaveText('Aug 2026');
    await expect(it.locator('.rt-bot').first()).toContainText('+0.85 pp');
    await expect(row.locator('.mtile[data-id="pl"] .rt-bot').first()).toContainText('not in the euro');
    await it.click();
    const pop = page.locator('#detail');
    await expect(pop).toHaveClass(/pinned/);
    await expect(pop.locator('h2')).toContainText('Italy 10-year, monthly');
    await expect(pop.locator('.r-says')).toContainText('above Germany');
    await expect(pop.locator('.r-chart path')).toHaveCount(2);
    await expect(page).toHaveURL(/\/rates\/\?c=it$/);
    await expect(page.locator('#fresh')).toContainText('Europe monthly: Aug 2026');
  });
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

  test('every page fits the screen with the seven-way market switch', async ({ page }) => {
    for (const url of ['/', '/forex/', '/metals/', '/energy/', '/etfs/', '/rates/', '/predictions/']) {
      await page.goto(url);
      await expect(page.locator('#grid .tile, #grid .rtile, #grid .ptile').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), url).toBe(true);
    }
  });
});

test('the market switch is a row of folder tabs: the open page’s tab is raised and joined to the panel below', async ({ page }) => {
  const tabs = page.locator('#market a'), open = page.locator('#market a[aria-current="page"]');
  await expect(tabs).toHaveCount(7);
  expect(parseFloat(await tabs.first().evaluate(e => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(15);
  const [ob, other, panel] = [await open.boundingBox(), await tabs.nth(1).boundingBox(), await page.locator('.controls').boundingBox()];
  expect(ob.y).toBeLessThan(other.y);                                          // raised above the others
  expect(Math.abs(ob.y + ob.height - panel.y)).toBeLessThan(3);               // its bottom meets the panel's top
  expect(await open.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await page.locator('.controls').evaluate(e => getComputedStyle(e).backgroundColor));
  await expect(page.locator('#reset')).toBeVisible();
  // each tab with a figure is filled with a lighter shade of the figure's colour and outlined 2px; Predictions stays neutral
  const forex = page.locator('#market a[data-m="forex"]');
  await expect(forex).toHaveClass(/tinted/);
  await expect(forex).toHaveClass(new RegExp((await forex.locator('.mk-x').getAttribute('class')).split(' ')[1]));   // same colour step as its chip
  expect(await forex.evaluate(e => getComputedStyle(e).borderTopWidth)).toBe('2px');
  expect(await forex.evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(await forex.locator('.mk-x').evaluate(e => getComputedStyle(e).backgroundColor));
  await expect(page.locator('#market a[data-m="predictions"]')).not.toHaveClass(/tinted/);
});

// Prediction markets: the same page at /predictions/, drawing its own view from predictions.json (tests/e2e/fixtures.mjs)
test.describe('predictions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/predictions/');
  });
  const ids = async (page, sel = '#grid > .grid .ptile') => page.locator(sel).evaluateAll(els => els.map(e => e.dataset.id));
  const filters = async page => { if (await page.locator('#pfilters').isHidden()) await page.locator('#pfiltBtn').click(); };

  test('tiles read at a glance: verdict, answer, chance, trend; colour = how sure, chip = the move; Betfair hidden', async ({ page }) => {
    await expect(page).toHaveTitle(/Prediction Market Heatmap/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://heat.sala.company/predictions/');
    await expect(page.locator('#pvenue button')).toHaveText([/^All/, /Polymarket/, /Kalshi/, /PredictIt/, /Manifold/]);
    await expect(page.locator('#porder button')).toHaveText(['Biggest bets', 'Surest bets', 'Close calls', 'Big movers', 'Ending soon', 'Venues disagree']);
    await expect(page.locator('#porder button[aria-pressed="true"]')).toHaveText('Biggest bets');   // the first tab mixes likely and unlikely
    await expect.poll(() => ids(page)).toEqual(['pm:mayor', 'ks:SEN', 'pm:fed', 'pm:thin', 'pm:by', 'pm:eth', 'pi:8000']);
    const top = page.locator('#grid > .grid .ptile').first();
    await expect(top).toHaveClass(/sz-l/);
    await expect(top).toHaveClass(/c3/);                                                            // 71%: the second-darkest shade, bold
    await expect(top.locator('.pt-rank')).toHaveText('#1');
    await expect(top.locator('.pt-title')).toHaveText('NYC mayor winner?');
    await expect(top.locator('.pt-head > .p-ico')).toHaveText('🇺🇸');                             // a big flag for US politics beside the headline
    await expect(top.locator('.pt-full')).toHaveCount(0);                                         // short already: no second line
    await expect(top.locator('.p-end')).toHaveText(/yrs\+ left$/);                                // the time-left ring
    await expect(top.locator('.p-end')).toHaveClass(/e-far/);
    await expect(top.locator('.pt-verdict')).toHaveText('Leaning');
    await expect(top.locator('.pt-ans')).toHaveText('Alice');
    await expect(top.locator('.pt-p')).toHaveText('71%');
    await expect(top.locator('.pt-spark')).toHaveCount(1);                                         // the trend from its history
    await expect(top.locator('.pt-chg')).toHaveText('▲ +5 pts');
    await expect(top.locator('.pt-chg')).toHaveClass(/q2/);                                        // teal chip: more likely
    await expect(top.locator('.pt-top .pt-vol')).toHaveText('$5M today');                         // money bet today, up front beside the rank
    await expect(top.locator('.pt-foot')).toContainText('$90M total');
    await expect(top.locator('.pt-foot')).not.toContainText('today');
    const fed = page.locator('.ptile[data-id="pm:fed"]');
    await expect(fed.locator('.pt-ans')).toHaveText(/^✗ (No, it won’t happen|Won’t happen)$/)   /* the short form on small tiles */;                     // 30% yes shown as its likelier side, in words
    await expect(fed.locator('.pt-p')).toHaveText('70%');
    await expect(fed.locator('.pt-chg')).toHaveText('▲ +8 pts');                                   // its move turned round
    await expect(page.locator('.ptile[data-id="pi:8000"] .pt-ans')).toHaveText('Vance');           // one named option isn't a yes/no
    await expect(page.locator('.ptile[data-id="pi:8000"] .pt-verdict')).toHaveText('Unlikely');
    await expect(page.locator('.ptile[data-id="pm:thin"]')).toHaveClass(/thin/);
  });

  test('Today picks out the news; each card opens its question', async ({ page }) => {
    await expect(page.locator('.p-today .p-news-k')).toHaveText(['Biggest swing today', 'Most money today', 'Closest big call']);   // Senate is already the close call: no second card for it
    expect(await page.locator('.p-today .p-news').evaluateAll(els => els.map(e => e.dataset.id))).toEqual(['pm:fed', 'pm:mayor', 'ks:SEN']);
    await page.locator('.p-today .p-news').first().click();
    await expect(page.locator('#detail')).toHaveClass(/pinned/);
    await expect(page.locator('#detail .p-q')).toHaveText('🏦Fed cut in December?');
  });

  test('the tabs ask a question: close calls, biggest bets, venues disagree', async ({ page }) => {
    await page.locator('#porder button[data-o="close"]').click();
    // mixed topics: the second politics question (mayor) counts ×0.65, so the Fed (economy) comes before it
    await expect.poll(() => ids(page)).toEqual(['ks:SEN', 'pm:fed', 'pm:mayor', 'pm:thin', 'pm:by', 'pm:eth', 'pi:8000']);
    await filters(page);
    await page.locator('#pmix').uncheck();                                                        // unmixed: the plain order
    await expect.poll(() => ids(page)).toEqual(['ks:SEN', 'pm:mayor', 'pm:fed', 'pm:thin', 'pm:by', 'pm:eth', 'pi:8000']);
    await expect(page.locator('#pfiltBtn .n')).toHaveText('1');
    await page.locator('#pmix').check();
    await expect(page).toHaveURL(/o=close/);
    // surest bets: certainty × log10(interest): mayor 71% × 6.9, Fed (70% no) × 6.2, Senate (merged) 55% × 6.6, thin, PredictIt (no money) last
    await page.locator('#porder button[data-o="sure"]').click();
    await expect.poll(() => ids(page)).toEqual(['pm:mayor', 'pm:fed', 'ks:SEN', 'pm:thin', 'pm:eth', 'pm:by', 'pi:8000']);
    await page.locator('#porder button[data-o="disagree"]').click();
    await expect.poll(() => ids(page)).toEqual(['ks:SEN']);
    const sen = page.locator('.ptile[data-id="ks:SEN"]');
    await expect(sen.locator('.pv')).toHaveText(['K', 'PI']);
    await expect(sen.locator('.pt-cmp')).toHaveText('⚡ K 55% · PI 65%');
    await page.locator('#pvenue button[data-v="predictit"]').click();                             // a venue's own tab: no merging, its own order
    await expect(page.locator('#porder button[data-o="disagree"]')).toHaveCount(0);
    await expect.poll(() => ids(page)).toEqual(['pi:8000', 'pi:SEN']);
  });

  test('the popup gives the answer first, then the chart, each venue, outcomes and the fine print; watch and full view', async ({ page }) => {
    await page.locator('.ptile[data-id="ks:SEN"]').click();
    await expect(page.locator('#detail .p-say')).toHaveText(/Toss-up:\s*Democrats\s*55%/);
    await expect(page.locator('#detail .p-cmp tbody tr')).toHaveCount(2);
    await expect(page.locator('#detail .p-differ')).toContainText('10 points apart');
    await page.keyboard.press('Escape');
    await page.locator('.ptile[data-id="pm:mayor"]').click();
    await expect(page.locator('#detail .p-say')).toHaveText(/Leaning:\s*Alice\s*71%/);
    await expect(page.locator('#detail .p-moves')).toContainText('this week ▲ +12 pts');
    await expect(page.locator('#detail .p-chart')).toBeVisible();
    await expect(page.locator('#detail .p-fine')).not.toHaveAttribute('open', '');
    await expect(page.locator('#detail .p-fine .kv')).toContainText('Buy–sell gap1.0 points');
    await expect(page).toHaveURL(/m=pm%3Amayor/);
    await page.locator('#detail .p-fullbtn').click();
    await expect(page.locator('#detail')).toHaveClass(/p-full/);
    await page.locator('#detail [data-watch]').click();
    await expect(page.locator('#detail [data-watch]')).toHaveText('★ Watching');
    await page.keyboard.press('Escape');
    await expect(page.locator('#detail')).not.toHaveClass(/p-full/);
    await expect(page.locator('.p-watch .ptile')).toHaveCount(1);
    await page.reload();                                                                          // the watchlist is remembered
    await expect(page.locator('.p-watch .ptile[data-id="pm:mayor"]')).toHaveCount(1);
    await expect(page.locator('.ptile[data-id="pm:mayor"] .pt-star').first()).toBeVisible();
  });

  test('story cards, short-term prices off, blanks filled, yes/no in words, no verdict on small tiles', async ({ page }) => {
    // the Senate seats question rides on the Senate control card instead of a tile of its own
    await expect(page.locator('#grid > .grid .ptile[data-id="pm:seats"]')).toHaveCount(0);
    const sen = page.locator('.ptile[data-id="ks:SEN"]');
    await expect(sen.locator('.pt-also-k')).toHaveText(/Senate control · 2 questions/i);
    await expect(sen.locator('.pt-more')).toHaveText([/Democrats’ Senate seats after Midterms\s*Below 50 seats 62%/]);
    await sen.locator('.pt-more').click();                                                        // a line opens its own question
    await expect(page.locator('#detail .p-q')).toContainText('Democrats’ Senate seats after Midterms');
    await page.keyboard.press('Escape');
    // yes/no in words; small tiles drop the verdict word
    const fed = page.locator('.ptile[data-id="pm:fed"]');
    await expect(fed.locator('.pt-ans')).toHaveText(/^✗ (No, it won’t happen|Won’t happen)$/)   /* the short form on small tiles */;
    await expect(page.locator('.ptile.sz-s .pt-verdict').first()).toBeHidden();
    // short-term price bets are off to start with; switched on, the blank in the title is filled with the step shown
    await expect(page.locator('.ptile[data-id="pm:btc"]')).toHaveCount(0);
    await filters(page);
    await page.locator('#ptopics button[data-topic="short"]').click();
    const btc = page.locator('.ptile[data-id="pm:btc"]');
    await expect(btc.locator('.pt-title')).toHaveText('Bitcoin above 80,000 on November 5?');
    await expect(btc.locator('.pt-ans')).toHaveText('✓ Yes');                                  // in the decided / waiting row: a result, not a forecast
    await expect(btc.locator('.pt-p')).toHaveText('60%');
  });

  test('just decided, race bars, "by …?" filled, PredictIt needs 8 points to disagree', async ({ page }) => {
    // NC-05 ended yesterday at 98%; a week before, the winner was at 24%: an upset
    const res = page.locator('.p-recent .p-res[data-id="ks:WON"]');
    await expect(page.locator('.p-recent .p-res')).toHaveCount(2);
    await expect(res.locator('.p-news-k')).toHaveText('✓ Decided · upset');
    await expect(res.locator('.p-news-l')).toHaveText('Chuck Hubbard 98% · a week ago 24%');
    // a race on the big tile: the top three as bars
    await expect(page.locator('.ptile[data-id="pm:mayor"] .pt-run')).toHaveText([/Alice\s*71%/, /Bob\s*27%/, /Carol\s*2%/]);
    await expect(page.locator('.ptile[data-id="pm:fed"] .pt-race')).toHaveCount(0);                // yes/no: no race
    // "Netanyahu out by...?" takes the step shown
    await expect(page.locator('.ptile[data-id="pm:by"] .pt-title')).toHaveText('Netanyahu out by June 30, 2027?');
    await expect(page.locator('.ptile[data-id="pm:by"] .pt-ans')).toHaveText(/^✗ (No, it won’t happen|Won’t happen)$/)   /* the short form on small tiles */;    // 43% yes: its likelier side, like a yes/no
    await expect(page.locator('.ptile[data-id="pm:by"] .pt-p')).toHaveText('57%');
    // a both-ways price ladder says which way; past tense on a decided result
    await expect(page.locator('.ptile[data-id="pm:eth"] .pt-title')).toHaveText('Ethereum price in 2026');
    await expect(page.locator('.ptile[data-id="pm:eth"] .pt-ans')).toHaveText('falls to $2,000');
    await expect(res.locator('.p-news-l b').first()).toHaveText('Chuck Hubbard');
    // the popup draws a rough dashed line from the venue's own changes while the daily history is short
    await page.locator('.ptile[data-id="pm:mayor"]').click();
    await expect(page.locator('#detail .p-rough')).toBeVisible();
    await page.keyboard.press('Escape');
    // a daily weather question whose day has passed: short-term, and waiting for the result
    await filters(page);
    await page.locator('#ptopics button[data-topic="short"]').click();
    await expect(page.locator('#pdone .ptile[data-id="ks:RAIN"] .pt-foot')).toContainText('has passed: waiting for the result');
    // PredictIt 10 points off Kalshi: flagged; the shown gap is the real one
    await expect(page.locator('.ptile[data-id="ks:SEN"] .pt-cmp')).toHaveClass(/differ/);
    await expect(page.locator('.ptile[data-id="pm:by"] .pt-foot')).not.toContainText('no money');
  });

  test('called races leave the grid; since your last visit; copy link and title; the track record', async ({ page }) => {
    // Ohio: 95% after +50 this week → called, in Just decided, not among the open questions
    await expect(page.locator('#grid > .grid .ptile[data-id="pm:call"]')).toHaveCount(0);
    await expect(page.locator('.p-res[data-id="pm:call"] .p-news-k')).toHaveText('📣 Called · not yet settled');
    await expect(page.locator('.p-res[data-id="pm:call"] .p-news-l b').first()).toHaveText('Sherrod Brown');
    // Today: never the same question twice
    const today = await page.locator('.p-today .p-news').evaluateAll(els => els.map(e => e.dataset.id));
    expect(new Set(today).size).toBe(today.length);
    // a popup: copy link, and the tab title says the question
    await page.locator('.ptile[data-id="pm:mayor"]').click();
    await expect(page).toHaveTitle(/^NYC mayor winner\?: Alice 71% · Predictions/);
    await expect(page.locator('#detail .p-linkbtn')).toHaveText('🔗 Copy link');
    await page.locator('#detail .p-linkbtn').click();
    await expect(page.locator('#detail .p-linkbtn')).toHaveText(/✓ Copied|\/predictions\/\?m=pm%3Amayor/);
    await page.keyboard.press('Escape');
    await expect(page).toHaveTitle(/Prediction Market Heatmap/);
    // the track record: 20 answers at 80% a week before, 15 happened
    await page.locator('#ptrack summary').click();
    await expect(page.locator('#ptrack tbody tr').nth(4)).toContainText('70–90%');
    await expect(page.locator('#ptrack tbody tr').nth(4)).toContainText('20');
    await expect(page.locator('#ptrack tbody tr').nth(4)).toContainText('75%');
    // on a phone the whole table fits: the "Happened" column isn't pushed off-screen
    await page.setViewportSize({ width: 375, height: 800 });
    const box = await page.locator('#ptrack table').boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  });

  test('since your last visit: the biggest moves since the saved visit, and a chip on the tile', async ({ page }) => {
    await page.evaluate(() => { localStorage.setItem('hm.predVisit', JSON.stringify({ at: Date.now() - 3 * 3600e3, p: { 'pm:mayor': ['Alice', 0.6], 'pm:fed': ['Yes', 0.3] } })); sessionStorage.clear(); });
    await page.reload();
    const card = page.locator('.p-since .p-news[data-id="pm:mayor"]');
    await expect(card).toContainText('Alice 60% → 71%');
    await expect(page.locator('.p-since .p-news[data-id="pm:fed"]')).toHaveCount(0);              // didn't move
    await expect(page.locator('.ptile[data-id="pm:mayor"] .pt-since')).toContainText('▲ +11 since');
    await page.reload();                                                                          // same session: still compared with that visit
    await expect(page.locator('.p-since .p-news[data-id="pm:mayor"]')).toHaveCount(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hm.predVisit')).p['pm:mayor'][1])).toBe(0.71);   // and this visit saved
  });

  test('Filters: decided row, topics, play money, single games; money map, stories and table views', async ({ page }) => {
    await expect(page.locator('#pfilters')).toBeHidden();
    await expect(page.locator('#pdone .ptile')).toHaveCount(3);
    await expect(page.locator('#pdone .ptile[data-id="ks:DONE"] .pt-foot')).toContainText('99% sure already');
    await expect(page.locator('.ptile[data-id="mf:x"]')).toHaveCount(0);
    await expect(page.locator('.ptile[data-id="ks:GAME"]')).toHaveCount(0);
    await filters(page);
    await page.locator('#pplay').check();
    await expect(page.locator('.ptile[data-id="mf:x"]')).toHaveCount(1);
    await page.locator('#ptopics button[data-topic="games"]').click();
    await expect(page.locator('.ptile[data-id="ks:GAME"]')).toHaveCount(1);
    await page.locator('#ptopics button[data-topic="Politics"]').click();
    await expect(page.locator('#grid > .grid .ptile[data-id="pm:mayor"]')).toHaveCount(0);
    await expect(page.locator('#pfiltBtn .n')).toHaveText('3');                                   // play money, games shown, politics hidden
    await page.locator('#ptopics button[data-topic="Politics"]').click();
    await page.locator('#pview button[data-v="map"]').click();
    // area = the square root of the money with Mix topics on, so even the small ones get a rectangle; one block per story
    // (the Senate seats question is in the Senate block, listed in its popup)
    expect((await ids(page, '.p-map .pm-tile')).sort()).toEqual(['ks:GAME', 'ks:SEN', 'mf:x', 'pm:by', 'pm:eth', 'pm:fed', 'pm:mayor', 'pm:thin']);
    await expect(page.locator('.p-mapnote')).toContainText('1 without money figures');
    expect(await page.locator('.pm-tile[data-id="ks:SEN"]').getAttribute('aria-label')).toContain('1 related question');
    await expect(page).toHaveURL(/view=map/);
    await page.locator('.pm-tile[data-id="pm:mayor"]').click();
    await expect(page.locator('#detail .p-q')).toHaveText('🇺🇸NYC mayor winner?');
    await page.keyboard.press('Escape');
    await page.locator('#pview button[data-v="tiles"]').click();
    await page.locator('#pgroup').selectOption('story');
    await expect(page.locator('#grid .p-story h3')).toHaveText([/^Senate control\s+2 questions/]);   // grouped by story: laid out, not stacked
    await expect(page.locator('#grid .r-group h3').last()).toContainText('Other questions');
    await page.locator('#pview button[data-v="table"]').click();
    await page.locator('#grid th[data-sort="total"]').click();
    await expect(page.locator('#grid tbody tr').first()).toHaveAttribute('data-id', 'pm:mayor');
    await page.locator('#psearch').fill('fed');
    await expect(page.locator('#grid tbody tr')).toHaveCount(1);
  });
});

// At a glance (Nov 2026): the warning as a slim line, a headline above the tiles, each market's figure on the switch,
// a Map view, a week's line on the tiles, a compact phone header, a yield chart on rates and one news strip on predictions
test.describe('at a glance', () => {
  test('first visit: the warning is one slim line above the page, never over it; ✕ hides it, ⚠ WIP brings it back with the full text', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto('/');
    const wip = page.locator('#wip');
    await expect(wip).toBeVisible();
    await expect(wip).toContainText('nothing here is financial advice');
    const wb = await wip.boundingBox(), hb = await page.locator('header').boundingBox();
    expect(wb.y + wb.height).toBeLessThanOrEqual(hb.y + 1);                     // above the header, in the flow
    expect(wb.height).toBeLessThan(48);                                         // one line on a laptop
    await expect(page.locator('#wip-d')).toBeHidden();
    await page.locator('#wipMore').click();
    await expect(page.locator('#wip-d')).toContainText("Don't trust anyone");
    await page.locator('#wipOk').click();
    await expect(wip).toBeHidden();
    await page.reload();
    await expect(page.locator('#status')).toContainText('coins with indicators');
    await expect(wip).toBeHidden();                                             // remembered
    await page.locator('#wipBtn').click();
    await expect(wip).toBeVisible();
    await expect(page.locator('#wip-d')).toBeVisible();
    await ctx.close();
  });

  test('summary above the tiles: the move weighted by market cap, how many rose and fell, the best and worst (each opens its card); a filter narrows it', async ({ page }) => {
    const sm = page.locator('#summary');
    await expect(sm).toContainText(`Top ${N} coins, 24h`);
    await expect(sm).toContainText('weighted by market cap');
    const chg = await tiles(page).evaluateAll(els => els.map(e => parseFloat(e.querySelector('.chg').textContent.replace('−', '-'))));
    await expect(sm.locator('.sum-up')).toHaveText(`▲ ${chg.filter(v => v > 0).length}`);
    await expect(sm.locator('.sum-dn')).toHaveText(`▼ ${chg.filter(v => v < 0).length}`);
    await expect(sm.locator('.sum-x').last()).toContainText('INT');             // the biggest drop
    await sm.locator('.sum-x').last().click();
    await expect(page.locator('#detail')).toHaveClass(/pinned/);
    await expect(page.locator('#detail .d-head')).toContainText('INT');
    await page.keyboard.press('Escape');
    await page.locator('#filters [data-f="down"]').click();
    await expect(sm).toContainText(`${await tiles(page).count()} coins shown`);
    await page.locator('#view [data-v="score"]').click();
    await expect(sm).toBeHidden();
  });

  test('forex and ETFs use the median, so one outlier can’t drag the headline; ETF groups carry their own average', async ({ page }) => {
    await page.goto('/forex/');
    await expect(page.locator('#summary')).toContainText('median');
    await expect(page.locator('#summary')).toContainText('up = the dollar gained');
    await page.goto('/etfs/');
    await expect(page.locator('#summary')).toContainText('US stock ETFs');
    await expect(page.locator('#grid .tgroup .tg-avg').first()).toHaveText(/^[+−]?\d+\.\d\d%$/);
  });

  test('the market switch carries each market’s headline figure from pulse.json, on every page', async ({ page }) => {
    for (const url of ['/', '/rates/', '/predictions/']) {
      await page.goto(url);
      await expect(page.locator('#market a[data-m="forex"] .mk-x')).toHaveText(/^[+−]?\d+\.\d%$/);     // the dollar index
      await expect(page.locator('#market a[data-m="rates"] .mk-x')).toHaveText('+4bp');               // the US 10-year
      await expect(page.locator('#market a[data-m="rates"] .mk-x')).toHaveAttribute('title', /US 10y \d\.\d\d%/);
      await expect(page.locator('#market a[data-m="predictions"] .mk-x')).toHaveCount(0);
    }
    expect(external).toEqual([]);
  });

  test('Map: crypto tiles sized by market cap (bigger first), coloured by the move; a tile opens its card; ETFs in group blocks; no Map on forex', async ({ page }) => {
    await page.locator('#view [data-v="map"]').click();
    await expect(page.locator('#grid')).toHaveClass(/map/);
    await expect(page.locator('#grid .tile.mt')).toHaveCount(N);
    await expect(page).toHaveURL(/view=map/);
    const area = id => page.locator(`.mt[data-id="${id}"]`).evaluate(e => e.offsetWidth * e.offsetHeight);
    expect(await area('alpha-coin') ?? 0).toBeGreaterThan(0);
    const areas = await page.locator('#grid .mt').evaluateAll(els => els.map(e => [e.dataset.id, e.offsetWidth * e.offsetHeight]));
    const caps = await page.evaluate(async () => Object.fromEntries((await (await fetch('/data.json')).json()).markets.map(m => [m.id, m.market_cap])));
    const byCap = [...areas].sort((a, b) => caps[b[0]] - caps[a[0]]);
    expect(byCap[0][1]).toBeGreaterThan(byCap.at(-1)[1]);                       // the biggest coin has the biggest tile
    await expect(page.locator('#mapNote')).toContainText('market cap');
    await page.locator('.mt').first().click();
    await expect(page.locator('#detail')).toHaveClass(/pinned/);
    await page.keyboard.press('Escape');
    await page.locator('#view [data-v="grid"]').click();
    await expect(page.locator('#mapNote')).toHaveCount(0);
    await page.goto('/etfs/?view=map');
    await expect(page.locator('#grid .mgrp')).toHaveCount(4);
    await expect(page.locator('#grid .mt')).toHaveCount(112);
    await page.goto('/forex/?view=map');
    await expect(page.locator('#view [data-v="map"]')).toBeHidden();
    await expect(page.locator('#grid .tile').first()).not.toHaveClass(/\bmt\b/);
  });

  test('heatmap tiles show the last week as a small line; detailed tiles don’t need it', async ({ page }) => {
    await page.locator('#density [data-v="heatmap"]').click();
    await expect(page.locator('#grid .tile .spk')).toHaveCount(N);
    await expect(page.locator('#grid .tile .spk').first()).toBeVisible();
    await page.locator('#density [data-v="detailed"]').click();
    await expect(page.locator('#grid .tile .spk').first()).toBeHidden();
  });

  test('rates: a column per market, highest 10-year yield first; a column opens its curve', async ({ page }) => {
    await page.goto('/rates/');
    const cols = page.locator('#ratesBars .rb');
    await expect(cols).toHaveCount(14);
    const ys = (await cols.locator('.rb-v').allTextContents()).map(Number);
    expect(ys).toEqual([...ys].sort((a, b) => b - a));
    await expect(cols.first()).toHaveAttribute('data-id', 'br');
    await cols.first().click();
    await expect(page.locator('#detail')).toHaveClass(/pinned/);
    await expect(page.locator('#detail h2')).toContainText('Brazil');
    await page.keyboard.press('Escape');
    await page.locator('#rview button[data-v="table"]').click();
    await expect(page.locator('#ratesBars')).toBeHidden();
    await page.locator('#rview button[data-v="cards"]').click();
  });

  test('predictions: the news is one row of small cards, and the board starts in the top half of a laptop screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/predictions/');
    const strip = page.locator('.p-strip');
    await expect(strip.locator('.p-news').first()).toBeVisible();
    const tops = await strip.locator('.p-news').evaluateAll(els => [...new Set(els.map(e => Math.round(e.getBoundingClientRect().top)))]);
    expect(tops.length).toBe(1);                                                // a single row
    const first = await page.locator('#grid .ptile').first().boundingBox();
    expect(first.y).toBeLessThan(900 / 2);
  });
});

test.describe('phone, at a glance', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('the first tiles sit in the top third of the screen; the controls fold behind ⚙ View, with a badge for what differs', async ({ page }) => {
    const top = await tiles(page).first().evaluate(e => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(812 / 3);
    await expect(page.locator('#colorBy')).toBeHidden();
    await expect(page.locator('#market')).toBeVisible();
    await page.locator('#ctlToggle').tap();
    await expect(page.locator('#ctlToggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#colorBy')).toBeVisible();
    const spill = await page.evaluate(() => { const R = document.querySelector('.controls').getBoundingClientRect().right; return [...document.querySelectorAll('#ctlMore > *')].filter(e => e.offsetParent).some(e => e.getBoundingClientRect().right > R + 1); });
    expect(spill).toBe(false);                                                  // nothing in the open panel runs past its edge (search included)
    await page.locator('#colorBy [data-v="7d"]').tap();
    await expect(page.locator('#ctlSum')).toHaveText(/^[1-9]$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#ctlToggle').tap();
    await expect(page.locator('#colorBy')).toBeHidden();
  });
});

// The next click (Nov 2026, round 2): the coin card in words, the year range, search, the watchlist, the scorecard
// without price controls, instant repeat visits, the table
test.describe('the next click', () => {
  test('the card opens with what the readings say, in words, and where the price sits in its range', async ({ page }) => {
    await tile(page, 'moon-coin').click();
    const say = page.locator('#detail .d-say');
    await expect(say).toContainText('Strong uptrend');
    await expect(say).toContainText(/overbought \(RSI \d+\)/);
    await expect(say).toContainText(/near its short stop/);
    await expect(page.locator('#detail .d-range')).toContainText(/\d+-month range|1-year range/);
    await expect(page.locator('#detail .d-range .rbar i')).toHaveCount(1);
    await expect(tile(page, 'moon-coin').locator('.row .k', { hasText: 'RNG' })).toHaveCount(1);   // detailed tiles get a range row
  });

  test('the chart’s stop labels never overprint each other or the price scale', async ({ page }) => {
    await tile(page, 'moon-coin').click();                                    // its short stop sits right at the price
    const ys = await page.locator('#detail .d-chart svg').first().evaluate(svg => [...svg.querySelectorAll('text')].map(t => ({ stop: /stop/.test(t.textContent), y: +t.getAttribute('y') })));
    const stops = ys.filter(t => t.stop), ticks = ys.filter(t => !t.stop);
    expect(stops.length).toBe(2);
    expect(Math.abs(stops[0].y - stops[1].y)).toBeGreaterThanOrEqual(10.9);
    for (const t of ticks) for (const st of stops) expect(Math.abs(t.y - st.y)).toBeGreaterThanOrEqual(10.9);
  });

  test('search: "/" jumps to it, it filters as you type (summary follows), Escape clears it; no match says so', async ({ page }) => {
    await page.keyboard.press('/');
    await expect(page.locator('#q')).toBeFocused();
    await page.keyboard.type('moon');
    await expect(tiles(page)).toHaveCount(1);
    await expect(page.locator('#summary')).toContainText('1 coin shown');
    await page.keyboard.press('Escape');
    await expect(tiles(page)).toHaveCount(N);
    await page.locator('#q').fill('zzz');
    await expect(page.locator('#grid .empty')).toContainText('No coins match “zzz”');
    await page.locator('#grid .empty [data-show-all]').click();
    await expect(page.locator('#q')).toHaveValue('');
    await expect(tiles(page)).toHaveCount(N);
  });

  test('☆ Watch pins a coin to a watchlist at the top, remembered per market; ★ Watching takes it off', async ({ page }) => {
    const id = await tiles(page).nth(7).getAttribute('data-id');
    await tile(page, id).click();
    await page.locator('#detail [data-watch]').click();
    await expect(page.locator('#detail [data-watch]')).toHaveText('★ Watching');
    await page.keyboard.press('Escape');
    await expect(page.locator('#grid .tgroup.twatch')).toContainText('Your watchlist');
    await expect(page.locator('#grid > *').nth(1)).toHaveAttribute('data-id', id);   // first tile under the heading
    await page.reload();
    await expect(page.locator('#grid .tgroup.twatch')).toBeVisible();
    await page.goto('/forex/');
    await expect(page.locator('#grid .tgroup.twatch')).toHaveCount(0);           // each market has its own list
    await page.goto('/');
    await tile(page, id).click();
    await page.locator('#detail [data-watch]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#grid .tgroup.twatch')).toHaveCount(0);
  });

  test('the scorecard opens on its answer: filters, colour scale, timeframe and search step aside', async ({ page }) => {
    await page.locator('#view [data-v="score"]').click();
    for (const s of ['#filters', '#legendScale', '#colorBy', '#q']) await expect(page.locator(s)).toBeHidden();
    await page.locator('#view [data-v="grid"]').click();
    for (const s of ['#filters', '#legendScale', '#colorBy', '#q']) await expect(page.locator(s)).toBeVisible();
  });

  test('a repeat visit draws the last copy at once, then swaps in the fresh file', async ({ page }) => {
    await page.waitForTimeout(1700);                                          // the copy is saved just after the first load
    let release;
    const held = new Promise(r => { release = r; });
    await page.route('**/data.json*', async route => { await held; await route.continue(); });
    await page.reload();
    await expect(tiles(page)).toHaveCount(N);                                 // drawn before data.json has answered
    await expect(page.locator('#status')).toContainText('last visit');
    release();
    await expect(page.locator('#status')).toContainText(`${N}/${N} coins with indicators`);
  });

  test('table: a week line per row, how far from the high, and the coin column stays put while scrolling sideways', async ({ page }) => {
    await page.locator('#view [data-v="table"]').click();
    await expect(page.locator('#tablewrap td.t-wk svg')).toHaveCount(N);
    await expect(page.locator('#tablewrap th', { hasText: 'From high' })).toHaveCount(1);
    expect(await page.locator('#tablewrap tbody td:nth-child(2)').first().evaluate(e => getComputedStyle(e).position)).toBe('sticky');
  });

  test('energy points to its weekly pump-price tables', async ({ page }) => {
    await page.goto('/energy/');
    await expect(page.locator('#summary .sum-jump')).toHaveAttribute('href', '#fuel');
  });
});

test.describe('predictions, yes/no that can’t be misread', () => {
  test('a yes/no tile says what the market expects as a statement, labels the number as a chance, and shows both sides on a bar', async ({ page }) => {
    await page.goto('/predictions/');
    const fed = page.locator('.ptile[data-id="pm:fed"]');                    // 30% yes
    await expect(fed.locator('.pt-verdict')).toHaveText('Market expects');
    await expect(fed.locator('.pt-ans')).toHaveText(/^✗ (No, it won’t happen|Won’t happen)$/)   /* the short form on small tiles */;
    await expect(fed.locator('.pt-p')).toHaveText('70%');
    await expect(fed.locator('.pt-pw')).toHaveText('chance');
    await expect(fed.locator('.pt-yn')).toHaveText(/Yes 30%.*No 70%/);
    await expect(fed.locator('.pt-yn > .win')).toHaveText('No 70%');          // the likelier side is the bold one
    await expect(fed).toHaveAttribute('aria-label', /Market expects, No, it won’t happen, 70% chance/);
    await fed.click();
    await expect(page.locator('#detail .p-say')).toContainText('Market expects: ✗ No, it won’t happen 70% chance');
    await expect(page.locator('#detail .pt-yn')).toHaveText(/Yes 30%.*No 70%/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.p-today .p-news[data-id="pm:fed"] .p-news-l')).toContainText('✗ Won’t happen');   // the short form in the news strip
  });
});
