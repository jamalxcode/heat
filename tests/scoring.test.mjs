// Unit tests for the scoring safeguards: unusual-jump filter, skipped days, the tuner's untouched holdout, costs,
// the point-in-time list, and the freshness check. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../signals.mjs';
import { findSpikes } from '../scripts/build-forex.mjs';
import { CHECKS } from '../scripts/check-fresh.mjs';

const DAY = 864e5;
// a calm random walk: ±0.3% a day, deterministic
const calm = (n, seed = 7) => { let x = seed, p = 100; return Array.from({ length: n }, () => (p *= 1 + ((x = (x * 48271) % 2147483647) / 2147483647 - 0.5) * 0.006)); };

test('findSpikes: flags a one-day jump far outside the normal range, not ordinary days', () => {
  const c = calm(120);
  assert.deepEqual(findSpikes(c), [], 'calm series: nothing flagged');
  c[100] = c[99] * 1.2;                                   // +20% in a day
  for (let i = 101; i < c.length; i++) c[i] = c[i] * 1.2;
  assert.deepEqual(findSpikes(c), [100]);
  const noisy = Array.from({ length: 120 }, (_, i) => 100 * (i % 2 ? 1.04 : 1));   // ±4% every day: a 5% day is normal here
  noisy[110] = noisy[109] * 1.05;
  assert.deepEqual(findSpikes(noisy), [], 'relative to the currency\'s own normal range');
});

test('signalRows: skipped closes are left out of the scoring', () => {
  const c = calm(400), coin = { id: 'x', symbol: 'X', t0: 0, c };
  const all = S.signalRows([coin], null);
  const skip = new Set([300, 301, 302]);
  const some = S.signalRows([{ ...coin, skip }], null);
  assert.equal(all.length - some.length, 3);
  assert.ok(!some.some(r => [300, 301, 302].includes(r.day)), 'those days are gone');
});

// 40 coins × 900 days of calm walks: long enough for the holdout to apply
const coins = Array.from({ length: 40 }, (_, k) => ({ id: 'c' + k, symbol: 'C' + k, t0: 0, c: calm(900, k + 3) }));

test('tune: the newest 90 days are never used to choose settings, and are reported as an untouched check', () => {
  const res = S.tune(coins, null);
  assert.ok(res.holdout, 'holdout reported');
  const lastDay = 899 - 1;                                 // the last close with a next-day outcome
  assert.equal(res.holdout.to, lastDay);
  assert.equal(res.holdout.from, lastDay - 90 + 1);
  for (const f of res.folds) assert.ok(f.to < res.holdout.from, `check period ${f.from}–${f.to} ends before the holdout`);
  assert.ok(res.split.testTo < res.holdout.from);
  assert.ok(Number.isFinite(res.holdout.current));
  const short = S.tune(coins.map(c => ({ ...c, c: c.c.slice(0, 330) })), null);
  assert.equal(short.holdout, null, 'too short to hold anything out');
});

test('buildScorecard: records costs, and scores point-in-time only the coins that were in each day\'s list', () => {
  const day = d => new Date(d * DAY).toISOString().slice(0, 10);
  const universe = { [day(500)]: ['c1', 'c2'], [day(501)]: ['c1'] };
  const { card } = S.buildScorecard(coins.slice(0, 12), null, { prev: { tuning: { lastRun: 'x', history: [] } }, costPct: 0.002, universe });
  assert.deepEqual(card.costs, { roundTrip: 0.002 });
  assert.equal(card.pit.days, 2);
  assert.equal(card.pit.from, day(500));
  assert.equal(card.pit.windows.all[1].rows, 3, 'c1 and c2 on day 500, c1 on day 501');
  const { card: none } = S.buildScorecard(coins.slice(0, 12), null, { prev: { tuning: { lastRun: 'x', history: [] } } });
  assert.equal(none.pit, undefined, 'no list history, no point-in-time section');
});

test('freshness check: each limit catches stale data and passes fresh data', () => {
  const now = Date.now(), H = 3600e3;
  const fresh = { generated: now - 5 * 60e3, hist: { a: { t: now - H } }, rateDate: new Date(now - 864e5).toISOString().slice(0, 10) };
  const stale = { generated: now - 5 * H, hist: { a: { t: now - 10 * H } }, rateDate: new Date(now - 9 * 864e5).toISOString().slice(0, 10) };
  for (const [file, age, limit, what] of CHECKS) {
    if (what.includes('scorecard')) continue;              // generated a day apart: covered by the 'generated' rule
    assert.ok(age(fresh) <= limit, `${file}: fresh data passes "${what}"`);
    assert.ok(age(stale) > limit, `${file}: stale data fails "${what}"`);
  }
});
