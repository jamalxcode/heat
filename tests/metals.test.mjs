// Unit tests for the metals page data (scripts/build-metals.mjs). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METALS, FROM_CRYPTO, metalSeries, toSnapshot, build, crossCheck } from '../scripts/build-metals.mjs';
import { health } from '../scripts/health.mjs';
import { isoDay, dayNum, DAY } from '../scripts/build-forex.mjs';

test('metal list: gold, silver, platinum, palladium; no copper', () => {
  assert.deepEqual(METALS.map(m => m.code), ['xau', 'xag', 'xpt', 'xpd']);
  assert.deepEqual(FROM_CRYPTO, ['pax-gold', 'tether-gold', 'bitcoin']);
});

test('metalSeries: dollars per ounce (1 / feed value), every calendar day, gaps carried forward', () => {
  const d0 = dayNum('2026-01-01');
  const days = {
    [isoDay(d0)]: { xau: 1 / 4000 },
    [isoDay(d0 + 1)]: { xau: 1 / 4100, xag: 1 / 50 },
    // d0 + 2 missing
    [isoDay(d0 + 3)]: { xau: 1 / 4200, xag: 1 / 52 },
  };
  const s = metalSeries(days);
  assert.deepEqual(s.xau.c, [4000, 4100, 4100, 4200]);
  assert.equal(s.xau.t0, d0 * DAY);
  assert.deepEqual(s.xag.c, [50, 50, 52], 'silver starts on its first day, not before');
  assert.equal(s.xag.t0, (d0 + 1) * DAY);
  assert.equal(s.xpt, undefined, 'no data, no series');
  assert.deepEqual(metalSeries({}), {});
});

test('toSnapshot: metals.json has the shape the page reads, with the crypto tiles copied in', () => {
  const d0 = dayNum('2026-01-01');
  const c = Array.from({ length: 40 }, (_, i) => 4000 + i * 10);
  const series = { xau: { t0: d0 * DAY, c } };
  const crypto = {
    markets: [{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 90000 }, { id: 'solana', symbol: 'sol' }],
    hist: { bitcoin: { c: [1, 2, 3] }, solana: { c: [1] } },
    params: { w: 1 },
  };
  const snap = toSnapshot(series, crypto, { now: 123 });
  assert.equal(snap.market, 'metals');
  assert.equal(snap.metalsDate, isoDay(d0 + 39));
  assert.deepEqual(snap.markets.map(m => m.id), ['xau', 'bitcoin'], 'only the listed crypto assets, metals first');
  const gold = snap.markets[0];
  assert.equal(gold.badge, 'Au');
  assert.equal(gold.current_price, c.at(-1));
  assert.ok(Math.abs(gold.price_change_percentage_24h_in_currency - (4390 / 4380 - 1) * 100) < 1e-9);
  assert.ok(Math.abs(gold.price_change_percentage_30d_in_currency - (4390 / 4090 - 1) * 100) < 1e-9);
  assert.equal(snap.markets[1].market_cap_rank, 2);
  assert.deepEqual(snap.hist.bitcoin, { c: [1, 2, 3] });
  assert.deepEqual(snap.params, { w: 1 }, 'same signal settings as the crypto page');
  assert.equal(toSnapshot({}, null).markets.length, 0);
});

// Fake feeds. exchange-api: the file dated f holds the close of day f − 1, here 4000 + (f − 1 − D) for gold (each
// metal scaled), and only files up to `upTo` exist. Swissquote: one quote per metal at time t.
const D = dayNum('2026-10-07');
const SCALE = { xau: 1, xag: 0.015, xpt: 0.42, xpd: 0.3 };
const extras = upTo => async date => {
  const f = dayNum(date);
  return f > upTo ? null : Object.fromEntries(METALS.map(m => [m.code, 1 / ((4000 + (f - 1 - D)) * SCALE[m.code])]));
};
const quotes = (t, gold) => async () => Object.fromEntries(METALS.map(m => [m.code, { price: +(gold * SCALE[m.code]).toPrecision(7), t }]));
const quiet = { log: () => {} };

test('build: exchange-api files filed under the day before; Swissquote gives today\'s price and confirms each close', async () => {
  const late = Date.parse('2026-10-06T23:55:00Z');                       // last build of 6 Oct
  const first = await build({ ...quiet, now: late, extrasFn: extras(D - 1), liveFn: quotes(late - 300e3, 3999.5) });
  assert.equal(first.sources.primary.latest, '2026-10-05', 'the file dated 6 Oct holds the 5 Oct close');
  assert.equal(first.markets[0].current_price, 3999.5, '6 Oct: Swissquote\'s price, exchange-api has no close yet');
  assert.equal(first.markets[0].check, null, 'nothing to compare yet');

  const noon = Date.parse('2026-10-07T12:00:00Z');
  const snap = await build({ ...quiet, prev: first, now: noon, extrasFn: extras(D), liveFn: quotes(noon - 60e3, 4010) });
  const gold = snap.markets.find(m => m.id === 'xau');
  assert.deepEqual(gold.check, { day: '2026-10-06', diff: 0.01, ok: true }, '6 Oct: exchange-api 3999 vs Swissquote 3999.5');
  assert.equal(gold.current_price, 4010, 'today: Swissquote');
  assert.deepEqual(snap.hist.xau.c.slice(-3), [3998, 3999, 4010], 'exchange-api\'s close replaced the 6 Oct quote');
  assert.equal(snap.hist.xau.ok, 1);
  assert.equal(snap.metalsDate, '2026-10-07');
  assert.equal(snap.sources.second.ok, true);
  assert.equal(snap.sources.agree, true);
});

test('build: sources more than 1% apart get no ✓; an older metals.json format is rebuilt, not reused', async () => {
  const late = Date.parse('2026-10-06T23:55:00Z'), noon = Date.parse('2026-10-07T12:00:00Z');
  const first = await build({ ...quiet, now: late, extrasFn: extras(D - 1), liveFn: quotes(late, 4060) });   // 1.5% above
  const snap = await build({ ...quiet, prev: first, now: noon, extrasFn: extras(D), liveFn: quotes(noon, 4010) });
  assert.equal(snap.markets[0].check.ok, false);
  assert.equal(snap.markets[0].check.diff, 1.53);
  assert.equal(snap.sources.agree, false);
  const old = { ...snap, fmt: undefined, hist: { xau: { t0: 0, c: [1, 2, 3] } } };
  const rebuilt = await build({ ...quiet, prev: old, now: noon, extrasFn: extras(D), liveFn: async () => ({}) });
  assert.ok(rebuilt.hist.xau.c.length > 300, 'refetched from scratch');
});

test('build: if exchange-api stops, Swissquote keeps today\'s price coming and the health line says so', async () => {
  const noon = Date.parse('2026-10-07T12:00:00Z');
  const ok = await build({ ...quiet, now: noon, extrasFn: extras(D), liveFn: quotes(noon, 4010) });
  const later = noon + 5 * 864e5;                                                       // five days without new files
  const snap = await build({ ...quiet, prev: ok, now: later, extrasFn: async () => null, liveFn: quotes(later, 4100) });
  assert.equal(snap.markets[0].current_price, 4100);
  assert.equal(snap.sources.primary.ok, false);
  const h = health({ metals: snap }, later).sources.find(s => s.key === 'xapi');
  assert.equal(h.state, 'down');
  const none = await build({ ...quiet, prev: ok, now: noon + 3600e3, extrasFn: extras(D), liveFn: async () => ({}) });
  assert.equal(none.sources.second.ok, false, 'Swissquote unreachable');
  assert.equal(health({ metals: none }, noon).sources.find(s => s.key === 'swissquote').state, 'warn');
});

test('crossCheck: the latest day both sources have', () => {
  const days = { '2026-10-05': { xau: 1 / 4000 }, '2026-10-06': { xau: 1 / 4100 } };
  assert.deepEqual(crossCheck(days, { '2026-10-05': { xau: 4002 } }, D - 1).xau, { day: '2026-10-05', diff: 0.05, ok: true });
  assert.deepEqual(crossCheck(days, {}, D - 1), {});
});

test('health: CoinGecko, candles, ECB, TradingView states', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const crypto = { marketSrc: 'CoinGecko', hist: { a: { src: 'Binance', t: now - 600e3 }, b: { src: 'Gate.io', t: now - 600e3 } } };
  const by = h => Object.fromEntries(h.sources.map(s => [s.key, s.state]));
  assert.deepEqual(by(health({ crypto, forex: { rateDate: '2026-10-06' }, tv: { t: now, sym: { X: [1, now, ''] } } }, now)),
    { rankings: 'ok', candles: 'ok', ecb: 'ok', xapi: 'down', swissquote: 'down', tradingview: 'ok' });
  assert.equal(by(health({ crypto: { ...crypto, marketSrc: 'CoinLore' } }, now)).rankings, 'warn');
  assert.equal(by(health({ crypto: { ...crypto, marketStale: true } }, now)).rankings, 'down');
  assert.equal(by(health({ forex: { rateDate: '2026-09-25' } }, now)).ecb, 'down');
});

test('cross-check: gold within 1%; silver, platinum and palladium (which swing more) within 2%', () => {
  const d = dayNum('2026-10-05'), days = { '2026-10-05': { xau: 1 / 4000, xag: 1 / 50, xpt: 1 / 1700 } };
  const c = crossCheck(days, { '2026-10-05': { xau: 4060, xag: 50.75, xpt: 1740 } }, d);
  assert.deepEqual([c.xau.diff, c.xau.ok], [1.5, false]);
  assert.deepEqual([c.xag.diff, c.xag.ok], [1.5, true]);
  assert.deepEqual([c.xpt.diff, c.xpt.ok], [2.35, false]);
});
