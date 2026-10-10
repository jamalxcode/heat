// Unit tests for the ETF page data (scripts/build-etfs.mjs). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ETFS, GROUPS, parseSpark, toHist, build } from '../scripts/build-etfs.mjs';
import { health, stocksOpen } from '../scripts/health.mjs';
import { candidates, assetsOf } from '../scripts/tradingview.mjs';
import { dayNum, isoDay, DAY } from '../scripts/build-forex.mjs';

const H = 36e5;
const weekdays = (from, n) => { const out = []; for (let d = from; out.length < n; d++) if (![0, 6].includes(new Date(d * DAY).getUTCDay())) out.push(d); return out; };
// a Yahoo chart answer for a US ETF: daily candles stamped at the opening bell (13:30 UTC in summer), with volume
function chart(sym, days, closes, { vols = closes.map(() => 1e6), at = null, exch = 'PCX' } = {}) {
  return { chart: { result: [{
    meta: { symbol: sym, gmtoffset: -14400, regularMarketPrice: closes.at(-1), regularMarketTime: at ?? (days.at(-1) * DAY + 20 * H) / 1000, longName: `${sym} Trust`, exchangeName: exch },
    timestamp: days.map(d => (d * DAY + 13.5 * H) / 1000),
    indicators: { quote: [{ close: closes, volume: vols }] },
  }] } };
}
// Yahoo's bulk answer: today's 5-minute bars for each symbol asked
const spark = (syms, day, price) => Object.fromEntries(syms.map(s => [s, {
  symbol: s, timestamp: [0, 1, 2].map(i => (day * DAY + 13.5 * H + i * 300e3) / 1000), close: [price(s) - 1, price(s) - 0.5, price(s)],
}]));

test('the list: 112 funds, one each, in four groups (28 US market, 11 sectors, 39 themes, 34 international)', () => {
  assert.equal(ETFS.length, 112);
  assert.equal(new Set(ETFS.map(a => a.id)).size, 112, 'no fund twice');
  assert.deepEqual(GROUPS.map(g => g[0]), ['us', 'sector', 'theme', 'intl']);
  const n = k => ETFS.filter(a => a.group === k).length;
  assert.deepEqual([n('us'), n('sector'), n('theme'), n('intl')], [28, 11, 39, 34]);
  assert.ok(ETFS.every(a => a.id === a.yahoo.toLowerCase() && a.name));
  assert.ok(ETFS.every(a => !a.flag || [...a.flag].length === 2), 'flags are two regional-indicator letters');
  // one fund per index: the copies that were cut stay out, and so do bond, leveraged and inverse funds
  for (const t of ['VOO', 'IVV', 'SPYM', 'QQQM', 'VEA', 'IEFA', 'TLT', 'AGG', 'TQQQ', 'SQQQ', 'SOXL', 'GLD', 'IBIT', 'QAT', 'UAE', 'EIS']) assert.ok(!ETFS.some(a => a.yahoo === t), t);
  assert.equal(ETFS[0].yahoo, 'SPY', 'the benchmark first');
});

test('parseSpark: each fund’s latest 5-minute close, the bar’s time and its trading day', () => {
  const d = dayNum('2026-10-09');
  const got = parseSpark({ SPY: { timestamp: [(d * DAY + 19 * H) / 1000, (d * DAY + 19.1 * H) / 1000], close: [778.5, null] }, BAD: { close: [1] } });
  assert.deepEqual(got, { spy: { day: d, price: 778.5, t: d * DAY + 19 * H } }, 'a null last bar falls back to the one before');
  assert.deepEqual(parseSpark(null), {});
});

test('toHist: trading days as offsets, volume for the last days lined up with the end (null where missing)', () => {
  const d0 = dayNum('2026-10-02');
  const h = toHist(new Map([[d0, 10], [d0 + 3, 11], [d0 + 4, 12]]), new Map([[d0, 500], [d0 + 3, 600]]), ETFS[0], 7);
  assert.deepEqual({ t0: h.t0, d: h.d, c: h.c, v: h.v, pair: h.pair, t: h.t }, { t0: d0 * DAY, d: [0, 3, 4], c: [10, 11, 12], v: [500, 600, null], pair: 'SPY', t: 7 });
  assert.equal(toHist(new Map([[d0, 1]]), new Map(), ETFS[0], 7).v, undefined, 'no volume at all: no v');
});

test('build: full history hourly, the latest prices in bulk (20 per request) in between; trading-day changes', async () => {
  const days = weekdays(dayNum('2025-06-02'), 300), today = days.at(-1), now = today * DAY + 17 * H;
  const closes = days.map((_, i) => 100 + i);
  const asked = [];
  const fetchFn = async url => {
    asked.push(url);
    const u = new URL(url);
    if (u.pathname.includes('/spark')) return { ok: true, json: async () => spark(u.searchParams.get('symbols').split(','), today, () => 500) };
    const sym = decodeURIComponent(u.pathname.split('/').pop());
    return { ok: true, json: async () => chart(sym, days, closes, { exch: sym === 'QQQ' ? 'NGM' : 'PCX' }) };
  };
  const first = await build({ now, fetchFn, log: () => {} });
  assert.equal(first.market, 'etfs');
  assert.equal(first.markets.length, 112);
  assert.equal(asked.length, 112, 'one history request per fund, no bulk request needed');
  assert.ok(asked.every(u => u.includes('range=2y')));
  const spy = first.markets[0];
  assert.deepEqual([spy.symbol, spy.name, spy.group, spy.fund, spy.exch], ['SPY', 'S&P 500', 'us', 'SPY Trust', 'PCX']);
  assert.equal(first.markets.find(m => m.id === 'qqq').exch, 'NGM');
  assert.equal(spy.current_price, 399);
  assert.equal(spy.price_change_percentage_7d_in_currency, (399 / 394 - 1) * 100, '1 week = 5 trading days');
  assert.equal(spy.price_change_percentage_30d_in_currency, (399 / 378 - 1) * 100, '1 month = 21 trading days');
  assert.equal(first.hist.spy.c.length, 300);
  assert.equal(first.hist.spy.v.length, 60);
  assert.equal(first.latestDate, isoDay(today));
  assert.deepEqual(first.groups, GROUPS);
  assert.deepEqual(first.sources, { name: 'Yahoo Finance', got: 112, of: 112, at: today * DAY + 20 * H });
  assert.equal(first.markets.find(m => m.id === 'ewj').flag, '🇯🇵');

  // ten minutes later: six bulk requests, history, volume, names and exchanges kept from the previous file
  asked.length = 0;
  const second = await build({ prev: JSON.parse(JSON.stringify(first)), now: now + 10 * 60e3, fetchFn, log: () => {} });
  assert.equal(asked.length, 6);
  assert.ok(asked.every(u => u.includes('/spark') && new URL(u).searchParams.get('symbols').split(',').length <= 20));
  assert.equal(second.markets[0].current_price, 500, 'the latest 5-minute close');
  assert.equal(second.hist.spy.c.at(-1), 500, 'replaces today’s close so far');
  assert.equal(second.hist.spy.c.length, 300);
  assert.deepEqual(second.hist.spy.v, first.hist.spy.v);
  assert.equal(second.markets[0].fund, 'SPY Trust');
  assert.equal(second.fetched, first.fetched);
  assert.equal(second.sources.at, today * DAY + 13.5 * H + 600e3);

  // the next trading day starts: a new close appended, without volume yet
  const next = weekdays(today + 1, 1)[0];
  const third = await build({ prev: second, now: next * DAY + 15 * H, fetchFn: async url => {
    const u = new URL(url);
    if (u.pathname.includes('/spark')) return { ok: true, json: async () => spark(u.searchParams.get('symbols').split(','), next, () => 510) };
    return { ok: false, status: 429, json: async () => ({}) };   // the hourly history is due, but Yahoo says no
  }, log: () => {} });
  assert.equal(third.hist.spy.c.length, 301);
  assert.equal(third.hist.spy.v.at(-1), null);
  assert.equal(third.markets[0].price_change_percentage_24h_in_currency, (510 / 500 - 1) * 100);
  assert.ok(!third.markets.some(m => m.notRefreshed), 'the bulk prices still came through');
});

test('build: a fund Yahoo does not answer for keeps its last price, flagged; none at all is an error', async () => {
  const days = weekdays(dayNum('2025-06-02'), 300), today = days.at(-1), now = today * DAY + 17 * H;
  const ok = async url => ({ ok: true, json: async () => chart(decodeURIComponent(new URL(url).pathname.split('/').pop()), days, days.map((_, i) => 10 + i)) });
  const first = await build({ now, fetchFn: ok, log: () => {} });
  const partial = async url => {
    const u = new URL(url), syms = u.searchParams.get('symbols').split(',').filter(s => s !== 'KSA');
    return { ok: true, json: async () => spark(syms, today, () => 77) };
  };
  const second = await build({ prev: first, now: now + 10 * 60e3, fetchFn: partial, log: () => {} });
  const ksa = second.markets.find(m => m.id === 'ksa');
  assert.equal(ksa.notRefreshed, true);
  assert.equal(ksa.current_price, first.markets.find(m => m.id === 'ksa').current_price);
  assert.equal(second.sources.got, 111);
  await assert.rejects(build({ now, fetchFn: async () => { throw new Error('offline'); }, log: () => {} }), /none of the ETFs/);
});

test('health: ETF quotes judged during US market hours, relaxed outside them', () => {
  const wed = Date.parse('2026-10-07T17:00:00Z'), sat = Date.parse('2026-10-10T12:00:00Z'), fri = Date.parse('2026-10-09T20:00:00Z');
  assert.equal(stocksOpen(wed), true);
  assert.equal(stocksOpen(sat), false);
  assert.equal(stocksOpen(Date.parse('2026-10-07T13:00:00Z')), false, 'before the opening bell');
  const at = (etfs, now) => health({ etfs }, now).sources.find(s => s.key === 'yahoo-etf');
  assert.equal(at({ sources: { got: 112, of: 112, at: wed - 15 * 60e3 } }, wed).state, 'ok');
  assert.equal(at({ sources: { got: 110, of: 112, at: wed - 15 * 60e3 } }, wed).state, 'ok', 'a couple missing is fine');
  assert.equal(at({ sources: { got: 80, of: 112, at: wed - 15 * 60e3 } }, wed).state, 'warn');
  assert.equal(at({ sources: { got: 112, of: 112, at: wed - 3 * H } }, wed).state, 'warn');
  assert.equal(at({ sources: { got: 112, of: 112, at: fri - 5 * 60e3 } }, sat).state, 'ok', 'Friday close on Saturday');
  assert.match(at({ sources: { got: 112, of: 112, at: fri } }, sat).note, /market closed/);
  assert.equal(at(null, wed).state, 'down');
  assert.equal(health({}, wed).sources.find(s => s.key === 'yahoo-etf'), undefined, 'not asked about ETFs: no row');
});

test('TradingView: an ETF links to its listing exchange first (NYSE Arca is AMEX there), then the others', () => {
  assert.deepEqual(candidates({ id: 'spy', symbol: 'SPY', exch: 'PCX' }, null, 'etfs'), ['AMEX:SPY', 'NASDAQ:SPY', 'CBOE:SPY']);
  assert.deepEqual(candidates({ id: 'qqq', symbol: 'QQQ', exch: 'NGM' }, null, 'etfs'), ['NASDAQ:QQQ', 'AMEX:QQQ', 'CBOE:QQQ']);
  assert.deepEqual(candidates({ id: 'x', symbol: 'XLK' }, null, 'etfs'), ['AMEX:XLK', 'NASDAQ:XLK', 'CBOE:XLK'], 'exchange unknown');
  const list = assetsOf({ energy: { markets: [{ id: 'wti' }], hist: {} }, etfs: { markets: [{ id: 'spy', symbol: 'SPY' }] }, metals: { markets: [{ id: 'xau' }], hist: {} } });
  assert.deepEqual(list.map(x => x[2]), ['energy', 'etfs', 'metals']);
});
