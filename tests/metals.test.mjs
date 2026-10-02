// Unit tests for the metals page data (scripts/build-metals.mjs). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METALS, FROM_CRYPTO, metalSeries, toSnapshot } from '../scripts/build-metals.mjs';
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
