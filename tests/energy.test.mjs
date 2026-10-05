// Unit tests for the energy page data (scripts/build-energy.mjs). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENERGY, parseChart, toHist, build } from '../scripts/build-energy.mjs';
import { health, futuresOpen } from '../scripts/health.mjs';
import { candidates, assetsOf } from '../scripts/tradingview.mjs';
import { dayNum, isoDay, DAY } from '../scripts/build-forex.mjs';

const H = 36e5;
// a Yahoo chart answer: daily candles stamped at midnight New York time (04:00 UTC in summer)
function yahoo(days, closes, { price = closes.at(-1), at = null } = {}) {
  return { chart: { result: [{
    meta: { gmtoffset: -14400, regularMarketPrice: price, regularMarketTime: at ?? (days.at(-1) * DAY + 14 * H) / 1000 },
    timestamp: days.map(d => (d * DAY + 4 * H) / 1000),
    indicators: { quote: [{ close: closes }] },
  }] } };
}
const weekdays = (from, n) => { const out = []; for (let d = from; out.length < n; d++) if (![0, 6].includes(new Date(d * DAY).getUTCDay())) out.push(d); return out; };

test('the six contracts: WTI, Brent, diesel, gasoline, Henry Hub and TTF gas', () => {
  assert.deepEqual(ENERGY.map(a => a.yahoo), ['CL=F', 'BZ=F', 'HO=F', 'RB=F', 'NG=F', 'TTF=F']);
  assert.ok(ENERGY.every(a => a.unit && a.where && a.badge.length <= 3));
});

test('parseChart: one close per trading day (the exchange date), gaps skipped, the latest quote as today', () => {
  const d0 = dayNum('2026-09-28');                    // a Monday
  const p = parseChart(yahoo([d0, d0 + 1, d0 + 2], [90.5, null, 91.25], { price: 92, at: (d0 + 2) * DAY / 1000 + 15 * 3600 }));
  assert.deepEqual([...p.days], [[d0, 90.5], [d0 + 2, 92]], 'null close skipped; the live price replaces the day it was quoted on');
  assert.equal(p.price, 92);
  assert.equal(p.t, (d0 + 2) * DAY + 15 * H);
  assert.equal(parseChart({ chart: { result: null, error: { code: 'Not Found' } } }), null);
  assert.equal(parseChart(null), null);
});

test('toHist: trading days only, as day offsets the page unpacks', () => {
  const d0 = dayNum('2026-10-02');                    // Friday, then Monday
  const h = toHist(new Map([[d0 + 3, 2], [d0, 1]]), ENERGY[0], 5);
  assert.deepEqual({ t0: h.t0, d: h.d, c: h.c, pair: h.pair, t: h.t }, { t0: d0 * DAY, d: [0, 3], c: [1, 2], pair: 'CL=F', t: 5 });
});

test('build: full history first, then only the latest days merged in; changes count trading days', async () => {
  const days = weekdays(dayNum('2025-06-02'), 300), today = days.at(-1), now = today * DAY + 15 * H;
  const closes = days.map((_, i) => 50 + i);
  const asked = [];
  const fetchFn = async url => {
    asked.push(url);
    const range = new URL(url).searchParams.get('range');
    const n = range === '2y' ? days.length : 5;
    return { ok: true, json: async () => yahoo(days.slice(-n), closes.slice(-n)) };
  };
  const first = await build({ now, fetchFn, log: () => {} });
  assert.equal(first.market, 'energy');
  assert.equal(first.markets.length, 6);
  assert.ok(asked.every(u => u.includes('range=2y')) && asked.length === 6);
  const wti = first.markets.find(m => m.id === 'wti');
  assert.equal(wti.current_price, 349);
  assert.equal(wti.price_change_percentage_24h_in_currency, (349 / 348 - 1) * 100);
  assert.equal(wti.price_change_percentage_7d_in_currency, (349 / 344 - 1) * 100, '1 week = 5 trading days');
  assert.equal(first.hist.wti.c.length, 300);
  assert.equal(first.latestDate, isoDay(today));
  assert.deepEqual(first.sources, { name: 'Yahoo Finance', got: 6, of: 6, at: today * DAY + 14 * H });

  // ten minutes later: small requests, history kept from the previous file
  asked.length = 0;
  const second = await build({ prev: JSON.parse(JSON.stringify(first)), now: now + 10 * 60e3, fetchFn, log: () => {} });
  assert.ok(asked.every(u => u.includes('range=5d')) && asked.length === 6);
  assert.deepEqual(second.hist.wti.c, first.hist.wti.c);
  assert.equal(second.fetched, first.fetched);
});

test('build: a contract Yahoo does not answer for keeps its last price, flagged; none at all is an error', async () => {
  const days = weekdays(dayNum('2025-06-02'), 300), now = days.at(-1) * DAY + 15 * H;
  const ok = async () => ({ ok: true, json: async () => yahoo(days, days.map((_, i) => 10 + i)) });
  const first = await build({ now, fetchFn: ok, log: () => {} });
  const flaky = async url => url.includes('TTF') ? { ok: false, status: 429, json: async () => ({}) } : ok();
  const second = await build({ prev: first, now: now + 10 * 60e3, fetchFn: flaky, log: () => {} });
  const ttf = second.markets.find(m => m.id === 'ttf');
  assert.equal(ttf.notRefreshed, true);
  assert.equal(ttf.current_price, first.markets.find(m => m.id === 'ttf').current_price);
  assert.equal(second.sources.got, 5);
  await assert.rejects(build({ now, fetchFn: async () => { throw new Error('offline'); }, log: () => {} }), /none of the contracts/);
});

test('health: Yahoo judged by the newest quote while futures trade, relaxed over the weekend', () => {
  const wed = Date.parse('2026-10-07T15:00:00Z'), sat = Date.parse('2026-10-10T12:00:00Z'), fri = Date.parse('2026-10-09T20:59:00Z');
  assert.equal(futuresOpen(wed), true);
  assert.equal(futuresOpen(fri), true);
  assert.equal(futuresOpen(sat), false);
  assert.equal(futuresOpen(Date.parse('2026-10-11T23:30:00Z')), true, 'Sunday evening: open again');
  const at = (energy, now) => health({ energy }, now).sources.find(s => s.key === 'yahoo');
  assert.equal(at({ sources: { got: 6, of: 6, at: wed - 20 * 60e3 } }, wed).state, 'ok');
  assert.equal(at({ sources: { got: 5, of: 6, at: wed - 20 * 60e3 } }, wed).state, 'warn');
  assert.equal(at({ sources: { got: 6, of: 6, at: wed - 5 * H } }, wed).state, 'warn');
  assert.equal(at({ sources: { got: 6, of: 6, at: fri - 60e3 } }, sat).state, 'ok', 'Friday quote on Saturday');
  assert.match(at({ sources: { got: 6, of: 6, at: fri - 60e3 } }, sat).note, /markets closed/);
  assert.equal(at(null, wed).state, 'down');
  assert.equal(health({}, wed).sources.find(s => s.key === 'yahoo'), undefined, 'not asked about energy: no row');
});

test('TradingView: each contract links to its continuous front-month chart; energy checked first', () => {
  assert.deepEqual(candidates({ id: 'wti' }, null, 'energy'), ['NYMEX:CL1!']);
  assert.deepEqual(candidates({ id: 'ttf' }, null, 'energy'), ['ICEENDEX:TFM1!']);
  assert.deepEqual(candidates({ id: 'nope' }, null, 'energy'), []);
  const list = assetsOf({ energy: { markets: [{ id: 'wti' }], hist: {} }, metals: { markets: [{ id: 'xau' }], hist: {} } });
  assert.deepEqual(list.map(x => x[2]), ['energy', 'metals']);
});
