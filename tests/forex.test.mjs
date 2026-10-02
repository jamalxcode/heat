// Unit tests for the forex market: the builder's helpers (no network) and the engine features forex relies on.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../signals.mjs';
import { CURRENCIES, scored, pairOf, priceOf, assemble, toSnapshot, isoDay, dayNum, DAY, BACK } from '../scripts/build-forex.mjs';
import { swap } from '../scripts/market-page.mjs';

const cur = code => CURRENCIES.find(c => c.code === code);

test('currency list: USD/XXX quotes, pegs and warnings', () => {
  assert.equal(pairOf(cur('EUR')), 'USD/EUR', 'every pair dollar first, so all tiles read the same way');
  assert.equal(pairOf(cur('GBP')), 'USD/GBP');
  assert.equal(pairOf(cur('JPY')), 'USD/JPY');
  assert.equal(pairOf(cur('SAR')), 'USD/SAR');
  assert.equal(priceOf(cur('EUR'), 0.8), 0.8, 'USD/EUR = euros per dollar');
  assert.equal(priceOf({ code: 'XXX', inv: true }, 0.8), 1.25, 'a currency marked inv would be stored XXX/USD');
  assert.equal(priceOf(cur('JPY'), 150), 150);
  for (const c of ['SAR', 'AED', 'QAR', 'BHD', 'OMR', 'JOD', 'HKD']) assert.ok(cur(c).pegged, c + ' is pegged');
  for (const c of ['IRR', 'SYP']) assert.ok(cur(c).warn && !scored(cur(c)), c + ' is shown with a warning and never scored');
  for (const c of ['RUB', 'EGP', 'KWD', 'MAD']) assert.ok(cur(c) && scored(cur(c)), c + ' is included and scored');
  assert.equal(new Set(CURRENCIES.map(c => c.code)).size, CURRENCIES.length, 'no duplicates');
});

// Three business days around a weekend: Fri 2026-09-25, Mon 28, Tue 29
const ECB = { '2026-09-25': { JPY: 150, EUR: 0.8 }, '2026-09-28': { JPY: 151.5, EUR: 0.8 }, '2026-09-29': { JPY: 151.5, EUR: 0.78 } };
const X = { '2026-09-25': { rub: 80 }, '2026-09-29': { rub: 84 } };   // the 28th is missing from the extra feed

test('assemble: business days only, ECB calendar for every currency, missing extra-feed days carried forward', () => {
  const s = assemble(ECB, X);
  assert.deepEqual(s.JPY.days, ['2026-09-25', '2026-09-28', '2026-09-29'].map(dayNum), 'no weekend days');
  assert.deepEqual(s.JPY.c, [150, 151.5, 151.5]);
  assert.deepEqual(s.EUR.c, [0.8, 0.8, 0.78]);
  assert.deepEqual(s.RUB.c, [80, 80, 84], 'the 28th carried forward from the 25th');
  assert.equal(s.RUB.filled, 1);
  assert.equal(s.SAR.c.length, 0, 'no data, no series');
});

test('toSnapshot: forex.json has the shape the page reads, with business-day offsets', () => {
  const now = Date.parse('2026-09-30T10:00:00Z');
  const snap = toSnapshot(assemble(ECB, X), { now });
  assert.equal(snap.market, 'forex');
  assert.equal(snap.rateDate, '2026-09-29');
  const jpy = snap.markets.find(m => m.id === 'jpy');
  assert.equal(jpy.symbol, 'USD/JPY');
  assert.ok(jpy.fx && !jpy.pegged);
  assert.equal(jpy.current_price, 151.5);
  assert.equal(jpy.price_change_percentage_24h_in_currency, 0);
  const h = snap.hist.jpy;
  assert.deepEqual(h.d, [0, 3, 4], 'Fri → Mon is 3 days');
  assert.equal(h.ok, 1);
  assert.equal(snap.hist.rub.ok, 0, 'extra feed: not official');
  assert.equal(isoDay(h.t0 / DAY + h.d[2]), '2026-09-29');
  assert.deepEqual(BACK, { '24h': 1, '7d': 5, '30d': 21 });
});

test('isPegged: currencies use their explicit flag, never the crypto stablecoin rules', () => {
  const eurusd = { id: 'eur', fx: true, symbol: 'EUR/USD', name: 'Euro', current_price: 1.08, price_change_percentage_24h_in_currency: 0.1, price_change_percentage_7d_in_currency: 0.3, price_change_percentage_30d_in_currency: 1 };
  assert.equal(S.isPegged(eurusd, { stable: [] }), false, 'EUR/USD near 1.0 is not a stablecoin');
  assert.equal(S.isPegged({ ...eurusd, id: 'sar', pegged: true }, {}), true);
});

test('momentum window is a setting (21 business days for forex)', () => {
  const c = Array.from({ length: 260 }, (_, i) => 100 * 1.002 ** i);   // +0.2% a day
  const a30 = S.componentsAt(S.series(c, { momPct: 5 }), 259, { momPct: 5 });                 // 30 closes: +6.2%
  const a21 = S.componentsAt(S.series(c, { momPct: 5, momDays: 21 }), 259, { momPct: 5, momDays: 21 });   // +4.3%
  assert.equal(a30.momUp, true);
  assert.equal(a21.momUp, false);
});

test('P&F box size goes down to 0.1% for quiet currencies', () => {
  const c = Array.from({ length: 100 }, (_, i) => 1.1 * (1 + (i % 2 ? 0.001 : -0.001)));   // ±0.1% a day
  assert.ok(S.autoBoxPct(c) <= 0.25, `box ${S.autoBoxPct(c)}%`);
});

test('signalRows: real business days for dates, next close for the outcome', () => {
  const days = [], c = [];
  for (let d = dayNum('2025-01-01'); days.length < 400; d++) { const wd = new Date(d * DAY).getUTCDay(); if (wd !== 0 && wd !== 6) { days.push(d); c.push(100 * 1.001 ** days.length); } }
  const rows = S.signalRows([{ id: 'x', symbol: 'X', t0: days[0] * DAY, c, days }], S.withDefaults(null));
  assert.ok(rows.length > 100);
  for (const r of rows) {
    const wd = new Date(r.day * DAY).getUTCDay();
    assert.ok(wd !== 0 && wd !== 6, 'no weekend rows');
  }
  const fri = rows.find(r => new Date(r.day * DAY).getUTCDay() === 5);
  assert.equal(fri.next - fri.day, 3, "Friday's next close is Monday");
});

test('forex page: the SEO, About and sources blocks are swapped, the rest is the same file', () => {
  const html = '<head>\n<!-- SEO:start: x -->\n<title>Crypto</title>\n<!-- SEO:end -->\n</head><p>tiles</p>';
  const out = swap(html, 'SEO', '<!-- SEO:start -->\n<title>Forex</title>\n<!-- SEO:end -->\n');
  assert.equal(out, '<head>\n<!-- SEO:start -->\n<title>Forex</title>\n<!-- SEO:end -->\n</head><p>tiles</p>');
  assert.throws(() => swap('<p></p>', 'ABOUT', 'x'), /no ABOUT markers/);
});
