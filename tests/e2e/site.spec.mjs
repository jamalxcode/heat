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
  const FX_VISIBLE = 7;   // 8 in the test data, minus the pegged SAR
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

test('↺ Reset, right before the market switch, puts every control back to the default view and remembers it', async ({ page }) => {
  await page.goto('/?tf=7d');
  await expect(page.locator('#status')).toContainText('with indicators');
  const reset = page.locator('#reset');
  expect(await reset.evaluate(el => el.nextElementSibling?.id)).toBe('market');
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

  test('loads its own data and search tags; no scorecard, no pegged checkbox; the switch links all five pages', async ({ page }) => {
    await expect(tiles(page)).toHaveCount(N);
    await expect(page).toHaveTitle(/Precious Metals Heatmap/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://heat.sala.company/metals/');
    await expect(page.locator('#market a[aria-current="page"]')).toHaveText(/Metals/);
    await expect(page.locator('#market a')).toHaveCount(5);
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

// Rates: the same page at /rates/, drawing its own view from rates.json (tests/e2e/fixtures.mjs: eleven markets, Canada
// inverted, the euro area flat)
test.describe('rates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/rates/');
    await expect(page.locator('#status')).toContainText('11 markets · 1 inverted');
  });

  test('its own view: a tile per market, no price controls, its own search tags, nothing from outside', async ({ page }) => {
    await expect(page.locator('#grid .rtile')).toHaveCount(11);
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
    await expect(page.locator('.rtile[data-id="uk"] .rt-slope')).toContainText('10y − BR');
    await expect(page.locator('.rtile[data-id="za"] .rt-slope')).toContainText('10y − 3m');
    await page.locator('#rtf button[data-v="1m"]').click();
    await expect(page.locator('#rlegend')).toContainText('1m change in the 10-year yield');
  });

  test('picking a market shows its curve now and before, its slope history, and a shareable address', async ({ page }) => {
    await expect(page.locator('#ratesAll .r-chart path')).toHaveCount(11);
    await expect(page.locator('#ratesDetail h2')).toContainText('United States');
    await page.locator('.rtile[data-id="ca"]').click();
    await expect(page.locator('#ratesDetail h2')).toContainText('Canada');
    await expect(page.locator('#ratesDetail .r-says')).toContainText('Inverted');
    await expect(page.locator('#ratesDetail .r-keys')).toContainText('A year ago');
    await expect(page.locator('#ratesDetail .r-chart')).toHaveCount(2);
    await expect(page).toHaveURL(/\/rates\/\?c=ca$/);
    await page.reload();
    await expect(page.locator('#ratesDetail h2')).toContainText('Canada');
    await page.locator('#ratesAll .r-pick[data-id="jp"]').click();
    await expect(page.locator('#ratesDetail h2')).toContainText('Japan');
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

  test('every page fits the screen with the five-way market switch', async ({ page }) => {
    for (const url of ['/', '/forex/', '/metals/', '/energy/', '/rates/']) {
      await page.goto(url);
      await expect(page.locator('#grid .tile, #grid .rtile').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), url).toBe(true);
    }
  });
});
