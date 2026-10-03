// Unit tests for how daily volume is kept in data.json (scripts/build-data.mjs pack). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack } from '../scripts/build-data.mjs';

const DAY = 864e5;

test('pack: volume for the last 60 days, lined up with the end of the closes; gaps have none', () => {
  const closes = Array.from({ length: 100 }, (_, i) => [i * DAY, 100 + i, 1234567 + i]).filter((_, i) => i !== 95);
  const h = pack({ src: 'Binance', pair: 'X/USDT', verified: true, t: 1, closes });
  assert.equal(h.c.length, 100, 'the gap day is filled with the previous close');
  assert.equal(h.c[95], h.c[94]);
  assert.equal(h.v.length, 60);
  assert.equal(h.v.at(-1), 1230000, '3 significant digits');
  assert.equal(h.v[60 - 5], null, 'day 95 had no candle: no volume');
  assert.equal(h.v[0], 1230000);
});

test('pack: no volume at all (e.g. an old source) leaves out v; short histories keep what they have', () => {
  const noVol = pack({ src: 'X', pair: 'X/USD', verified: false, t: 1, closes: Array.from({ length: 30 }, (_, i) => [i * DAY, 5]) });
  assert.equal('v' in noVol, false);
  const short = pack({ src: 'X', pair: 'X/USD', verified: false, t: 1, closes: Array.from({ length: 30 }, (_, i) => [i * DAY, 5, 10]) });
  assert.equal(short.v.length, 30);
});
