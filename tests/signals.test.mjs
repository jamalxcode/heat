// Unit tests for the shared signal engine. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../signals.mjs';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b}, got ${a}`);

test('sma: simple moving average, null until warmed up', () => {
  assert.deepEqual(S.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(S.sma([5, 5, 5], 1), [5, 5, 5]);
});

// Worked example from StockCharts' "Relative Strength Index (RSI)" ChartSchool article (Wilder smoothing, 14 periods)
const RSI_CLOSES = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
  46.00, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13];
const RSI_EXPECTED = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.30, 33.08, 37.77];

test('rsi: first value equals the exact Wilder formula', () => {
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const d = RSI_CLOSES[i] - RSI_CLOSES[i - 1]; if (d > 0) g += d; else l -= d; }
  const r = S.rsi(RSI_CLOSES, 14);
  for (let i = 0; i < 14; i++) assert.equal(r[i], null, `index ${i} should be warming up`);
  near(r[14], 100 - 100 / (1 + g / l), 1e-9, 'first RSI');   // 70.464
});

test('rsi: tracks the StockCharts worked example', () => {
  // Their spreadsheet rounds intermediate averages, so published values differ from the exact ones by up to ~0.07
  const r = S.rsi(RSI_CLOSES, 14);
  RSI_EXPECTED.forEach((v, k) => near(r[14 + k], v, 0.1, `RSI at index ${14 + k}`));
});

test('rsi: 100 when prices only rise, 0 when they only fall', () => {
  const up = Array.from({ length: 30 }, (_, i) => 10 + i), down = up.slice().reverse();
  assert.equal(S.rsi(up, 14).at(-1), 100);
  near(S.rsi(down, 14).at(-1), 0, 1e-9);
});

test('bollinger: hand-computed values for 1..20', () => {
  const a = Array.from({ length: 20 }, (_, i) => i + 1);
  const bb = S.bollinger(a, 20, 2);
  const sd = Math.sqrt((20 ** 2 - 1) / 12);           // population sd of 1..20 = 5.766
  near(bb.mid[19], 10.5, 1e-12);
  near(bb.up[19], 10.5 + 2 * sd, 1e-9);
  near(bb.lo[19], 10.5 - 2 * sd, 1e-9);
  near(bb.w[19], 4 * sd / 10.5 * 100, 1e-9);
  assert.equal(bb.w[18], null);
});

test('bollinger: flat prices have zero width', () => {
  const bb = S.bollinger(new Array(25).fill(7), 20, 2);
  assert.equal(bb.w.at(-1), 0);
});

test('rollingPct: rank of the latest width in its window', () => {
  const w = Array.from({ length: 40 }, (_, i) => i);   // rising: latest is always the widest
  assert.equal(S.rollingPct(w, 30).at(-1), 100);
  const falling = w.slice().reverse();                 // falling: latest is the narrowest
  near(S.rollingPct(falling, 30).at(-1), 100 / 30, 1e-9);
  assert.equal(S.rollingPct(w, 30)[10], null, 'needs 20 values first');
});

test('componentsAt / scoreOf: a steady uptrend is a strong uptrend, not a downtrend', () => {
  const c = Array.from({ length: 260 }, (_, i) => 100 * 1.003 ** i + (i % 2 ? 0.4 : -0.4));
  const s = S.series(c, S.DEFAULT_PARAMS);
  const a = S.componentsAt(s, c.length - 1, S.DEFAULT_PARAMS);
  assert.equal(a.trendUp, true);
  assert.equal(a.trendDown, false);
  const sc = S.scoreOf(a, S.DEFAULT_PARAMS);
  assert.ok(sc.good.includes('trendUp'));
  assert.equal(sc.score, sc.good.length - sc.bad.length);
});

test('scoreOf: weights decide 🚀 vs 😢 vs off, and the squeeze never counts', () => {
  const a = { trendUp: true, oversold: true, trendDown: false, overbought: false, bbWide: true, squeeze: true };
  const p = S.withDefaults({ weights: { trendUp: 1, oversold: 0, bbWide: 1 } });
  const sc = S.scoreOf(a, p);
  assert.deepEqual(sc.good.sort(), ['bbWide', 'trendUp']);
  assert.deepEqual(sc.bad, []);
  assert.equal(sc.score, 2);
  assert.equal(sc.squeeze, true);
});

test('withDefaults: ignores unknown weights and fills missing ones', () => {
  const p = S.withDefaults({ rsiLow: 25, weights: { bbTight: 1, overbought: 1 } });
  assert.equal(p.rsiLow, 25);
  assert.equal(p.weights.overbought, 1);
  assert.equal(p.weights.trendUp, 1);
  assert.equal('bbTight' in p.weights, false);
});

test('stopLevels: 2 × the average daily move, either side of the anchor close', () => {
  const c = Array.from({ length: 30 }, (_, k) => 100 * 1.01 ** k);   // every day +1% → average move 1%
  near(S.stopDistance(c, 29, S.DEFAULT_PARAMS), 0.02, 1e-9);
  const lv = S.stopLevels(c, 29, S.DEFAULT_PARAMS);
  near(lv.long, c[29] * 0.98, 1e-9);
  near(lv.short, c[29] * 1.02, 1e-9);
  assert.equal(S.stopLevels(c, 10, S.DEFAULT_PARAMS), null, 'needs 20 days of moves');
  near(S.stopDistance(c, 29, { stopMult: 3 }), 0.03, 1e-9, 'multiplier is a setting');
});

// Deterministic pseudo-random walk so tests are repeatable
function walk(seed, n, drift = 0) {
  let x = seed, p = 100;
  const out = [];
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    p *= 1 + drift + (x / 2147483648 - 0.5) * 0.06;
    out.push(p);
  }
  return out;
}
const coins = Array.from({ length: 12 }, (_, k) => ({ id: 'c' + k, symbol: 'C' + k, t0: 19000 * 864e5, c: walk(k + 1, 420, (k - 6) * 0.0004) }));

test('signalRows: excess moves average to zero across coins each day', () => {
  const rows = S.signalRows(coins, S.DEFAULT_PARAMS);
  assert.ok(rows.length > 1000);
  const byDay = new Map();
  for (const r of rows) if (r.exc[1] != null) byDay.set(r.day, (byDay.get(r.day) || 0) + r.exc[1]);
  for (const sum of byDay.values()) near(sum, 0, 1e-9, 'daily excess sum');
  const last = rows.filter(r => r.id === 'c0').at(-1);
  assert.equal(last.ret[7], null, 'no 7-day move for the last days');
});

test('stats: counts add up and horizons are separate', () => {
  const rows = S.signalRows(coins, S.DEFAULT_PARAMS);
  for (const h of S.HORIZONS) {
    const st = S.stats(rows, h);
    const total = Object.values(st.byScore).reduce((s, b) => s + b.n, 0);
    assert.equal(total, st.rows);
    assert.ok(st.all.upRate > 0 && st.all.upRate < 1);
  }
  assert.ok(S.stats(rows, 7).rows < S.stats(rows, 1).rows);
});

test('stats: stop-loss hit and good-exit rates are sane', () => {
  const rows = S.signalRows(coins, S.DEFAULT_PARAMS);
  const s3 = S.stats(rows, 3).stops, s7 = S.stats(rows, 7).stops;
  for (const s of [s3, s7]) for (const k of ['long', 'short']) {
    assert.ok(s[k].hitRate > 0 && s[k].hitRate < 1, `${k} hit rate in (0,1)`);
    assert.ok(s[k].goodRate >= 0 && s[k].goodRate <= 1, `${k} good rate in [0,1]`);
  }
  assert.ok(s7.long.hitRate >= s3.long.hitRate, 'a longer window can only cross more often');
});

test('spearman: perfect, inverse and no relationship', () => {
  near(S.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1, 1e-12);
  near(S.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1, 1e-12);
  assert.equal(S.spearman([1, 1, 1], [1, 2, 3]), null);
});

test('tune: runs on random data and returns a well-formed decision', () => {
  const res = S.tune(coins, S.DEFAULT_PARAMS);
  assert.equal(typeof res.adopt, 'boolean');
  assert.equal(res.folds.length, 3);
  assert.ok(res.notes.length >= 1);
  if (!res.adopt) assert.deepEqual(res.params, S.withDefaults(S.DEFAULT_PARAMS));
});

test('buildScorecard: has yesterday, all windows and horizons', () => {
  const { card } = S.buildScorecard(coins, S.DEFAULT_PARAMS, { tuneNow: false, prev: { tuning: { lastRun: 'x', history: [] } } });
  assert.equal(card.v, 2);
  for (const w of ['d30', 'd90', 'all']) for (const h of S.HORIZONS) assert.ok(card.windows[w][h].rows >= 0);
  assert.ok(card.yesterday.coins.length > 0);
  assert.ok(card.daily.length > 0 && card.daily.length <= 60);
});

test('pickUniverse: drops stablecoins and wrapped copies', () => {
  const m = [
    { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 80000, price_change_percentage_24h_in_currency: 1, price_change_percentage_7d_in_currency: 3 },
    { id: 'tether', symbol: 'usdt', name: 'Tether', current_price: 1, price_change_percentage_24h_in_currency: 0, price_change_percentage_7d_in_currency: 0 },
    { id: 'wrapped-bitcoin', symbol: 'wbtc', name: 'Wrapped Bitcoin', current_price: 80000, price_change_percentage_24h_in_currency: 1, price_change_percentage_7d_in_currency: 3 },
  ];
  assert.deepEqual(S.pickUniverse(m, { stable: [], gold: [] }).map(c => c.id), ['bitcoin']);
});
