// Unit tests for the rates page data (scripts/build-rates.mjs). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, interp, parseUS, parseECB, parseBoE, parseMOF, parseBoC, summarize, slopeState, build } from '../scripts/build-rates.mjs';
import { health } from '../scripts/health.mjs';
import { dayNum, DAY } from '../scripts/build-forex.mjs';

test('the markets: US, euro area, UK, Japan, Canada; the UK slope uses Bank Rate', () => {
  assert.deepEqual(COUNTRIES.map(c => c.id), ['us', 'ea', 'uk', 'jp', 'ca']);
  assert.equal(COUNTRIES.find(c => c.id === 'uk').short, 'Bank Rate');
  assert.ok(COUNTRIES.every(c => c.src && c.srcUrl.startsWith('https://')));
});

test('interp: straight line between points, exact at a point, nothing outside the curve', () => {
  const pts = [[1, 2], [3, 4], [10, 5]];
  assert.equal(interp(pts, 2), 3);
  assert.equal(interp(pts, 3), 4);
  assert.equal(interp(pts, 10), 5);
  assert.equal(interp(pts, 0.5), null);
  assert.equal(interp(pts, 11), null);
});

test('slope: ≥ 0.5 pp normal, 0 to 0.5 flat, below 0 inverted', () => {
  assert.equal(slopeState(1.2), 'normal');
  assert.equal(slopeState(0.5), 'normal');
  assert.equal(slopeState(0.2), 'flat');
  assert.equal(slopeState(0), 'flat');
  assert.equal(slopeState(-0.1), 'inverted');
  assert.equal(slopeState(null), null);
});

test('parsers: each official format to curves by day (tenors in years)', () => {
  const us = parseUS('Date,"1 Mo","1.5 Month","3 Mo","6 Mo","1 Yr","2 Yr","5 Yr","10 Yr","30 Yr"\n10/05/2026,4.05,4.10,4.22,4.30,4.47,4.84,5.06,5.31,5.66\n');
  const usDay = us.get(dayNum('2026-10-05'));
  assert.deepEqual(usDay[0], [0.0833, 4.05]);
  assert.deepEqual(usDay.at(-1), [30, 5.66]);
  assert.equal(interp(usDay, 10), 5.31);

  const ecb = parseECB('KEY,FREQ,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE\n' + ['3M,2.5', '1Y,2.8', '2Y,3.0', '5Y,3.1', '10Y,3.46', '30Y,3.7'].map(s => { const [t, v] = s.split(','); return `x,B,SR_${t},2026-10-02,${v}`; }).join('\n'));
  assert.deepEqual(ecb.get(dayNum('2026-10-02')).map(p => p[0]), [0.25, 1, 2, 5, 10, 30]);

  const boe = parseBoE('DATE,IUDBEDR,IUDSNPY,IUDMNPY,IUDLNPY\n01 Oct 2026,3.75,4.9132,5.3665,5.752\n02 Oct 2026,3.75,,,\n');
  assert.deepEqual(boe.get(dayNum('2026-10-01')), [[0, 3.75], [5, 4.9132], [10, 5.3665], [20, 5.752]]);
  assert.equal(boe.has(dayNum('2026-10-02')), false, 'a day with only Bank Rate is skipped');

  const mof = parseMOF('Interest Rate,,,,,,\nDate,1Y,2Y,5Y,10Y,20Y,30Y\n2026/9/30,1.684,1.952,2.399,3.057,3.877,4.098\n1990/1/4,6.1,-,-,6.9,-,-\n');
  assert.equal(interp(mof.get(dayNum('2026-09-30')), 10), 3.057);
  assert.equal(mof.has(dayNum('1990-01-04')), false, 'too few maturities');

  const boc = parseBoC({ observations: [{ d: '2026-10-02', 'BD.CDN.2YR.DQ.YLD': { v: '3.25' }, 'BD.CDN.5YR.DQ.YLD': { v: '3.5' }, 'BD.CDN.10YR.DQ.YLD': { v: '3.93' }, 'BD.CDN.LONG.DQ.YLD': { v: '4.2' } }] });
  assert.deepEqual(boc.get(dayNum('2026-10-02')), [[2, 3.25], [5, 3.5], [10, 3.93], [30, 4.2]]);
});

// curves by day: a gently steepening curve, 10-year at 4% + i * 0.001
function days(n, from, shape = (t, i) => 3 + Math.log1p(t) * 0.5 + i * 0.001) {
  const m = new Map();
  for (let i = 0; i < n; i++) m.set(from + i, [0.25, 2, 5, 10, 30].map(t => [t, +shape(t, i).toFixed(4)]));
  return m;
}

test('summarize: 10-year, slope and its reading, the curve a week / month / year ago, and the daily series', () => {
  const from = dayNum('2025-06-01'), n = 480, now = (from + n - 1) * DAY + 12 * 36e5;
  const s = summarize(COUNTRIES[0], days(n, from), now);
  assert.equal(s.date, '2026-09-23');
  assert.equal(s.y10, +(3 + Math.log1p(10) * 0.5 + (n - 1) * 0.001).toFixed(4));
  assert.ok(Math.abs(s.slope - (Math.log1p(10) - Math.log1p(2)) * 0.5) < 1e-3);
  assert.equal(s.state, 'normal');
  assert.equal(s.then.w1.date, '2026-09-16');
  assert.equal(s.then.m1.date, '2026-08-24');
  assert.equal(s.then.y1.date, '2025-09-23');
  assert.equal(s.series.y10.length, s.series.d.length);
  const inv = summarize(COUNTRIES[0], days(30, from, t => 5 - t * 0.05), (from + 29) * DAY);
  assert.equal(inv.state, 'inverted');
  const uk = summarize(COUNTRIES[2], new Map([[from, [[0, 4], [5, 4.2], [10, 4.6], [20, 5]]]]), from * DAY);
  assert.equal(uk.yShort, 4, 'UK: Bank Rate is the short leg');
  assert.ok(Math.abs(uk.slope - 0.6) < 1e-9);
});

test('build: reuses the last file between fetches; a source that fails keeps its last curve, flagged', async () => {
  const now = Date.parse('2026-10-06T10:00:00Z');
  const usCsv = 'Date,"3 Mo","2 Yr","5 Yr","10 Yr","30 Yr"\n10/05/2026,4.2,4.8,5.0,5.3,5.6\n10/02/2026,4.2,4.8,5.0,5.28,5.6\n';
  const fetchFn = async url => {
    if (url.includes('treasury.gov')) return { ok: true, text: async () => usCsv };
    return { ok: false, status: 503, text: async () => '' };
  };
  const first = await build({ now, fetchFn, log: () => {} });
  assert.deepEqual(first.countries.map(c => c.id), ['us'], 'only the US answered');
  assert.equal(first.countries[0].y10, 5.3);
  assert.equal(first.countries[0].state, 'normal');
  const again = await build({ prev: first, now: now + 60e3, fetchFn: async () => { throw new Error('should not fetch'); }, log: () => {} });
  assert.equal(again.fetched, first.fetched, 'within 3 hours: the last file, re-dated');
  assert.equal(again.generated, now + 60e3);
  const later = await build({ prev: first, now: now + 4 * 36e5, fetchFn: async () => ({ ok: false, status: 500, text: async () => '' }), log: () => {} });
  assert.equal(later.countries[0].notRefreshed, true);
  assert.equal(later.countries[0].y10, 5.3);
  await assert.rejects(build({ now, fetchFn: async () => ({ ok: false, status: 500, text: async () => '' }), log: () => {} }), /no yield curve source/);
});

test('health: bond yields current, partly late, or missing', () => {
  const now = Date.parse('2026-10-06T10:00:00Z');
  const row = rates => health({ rates }, now).sources.find(s => s.key === 'yields');
  const c = (badge, date, extra = {}) => ({ badge, date, ...extra });
  assert.equal(row({ countries: [c('US', '2026-10-05'), c('JP', '2026-10-01')] }).state, 'ok');
  assert.match(row({ countries: [c('US', '2026-10-05'), c('JP', '2026-10-01')] }).note, /2\/2 markets current · oldest JP 2026-10-01/);
  assert.equal(row({ countries: [c('US', '2026-10-05'), c('UK', '2026-09-20')] }).state, 'warn');
  assert.equal(row({ countries: [c('US', '2026-10-05', { notRefreshed: true })] }).state, 'down');
  assert.equal(row(null).state, 'down');
  assert.equal(health({}, now).sources.find(s => s.key === 'yields'), undefined);
});
