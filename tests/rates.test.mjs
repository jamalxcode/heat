// Unit tests for the rates page data (scripts/build-rates.mjs). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, interp, parseUS, parseECB, parseBoE, parseMOF, parseBoC, parseRBA, parseBBK, parseSNB, parseNB, mergeSeries, mergeSARB, parseTesouro, parseChinaBond, parseFBIL, unzipEntries, parseIRS, summarizeMonthly, daysFromSummary, EU_MONTHLY, parseEurostat, parseOECD, parseJapanCPI, summarize, slopeState, build } from '../scripts/build-rates.mjs';
import { health } from '../scripts/health.mjs';
import { dayNum, DAY } from '../scripts/build-forex.mjs';
import { deflateRawSync } from 'node:zlib';

test('the fourteen markets; the UK slope uses Bank Rate, South Africa the 3-month bill', () => {
  assert.deepEqual(COUNTRIES.map(c => c.id), ['us', 'ea', 'de', 'uk', 'jp', 'ca', 'au', 'ch', 'se', 'no', 'br', 'cn', 'in', 'za']);
  assert.equal(COUNTRIES.find(c => c.id === 'za').short, '3m');
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

test('parsers for the newer sources: RBA, Bundesbank, SNB, Norges Bank, Riksbank, Reserve Bank (SA), Tesouro Direto', () => {
  const rba = parseRBA('\uFEFFF2 CAPITAL MARKET YIELDS\nTitle,2 year,3 year,5 year,10 year,Indexed\nSeries ID,FCMYGBAG2D,FCMYGBAG3D,FCMYGBAG5D,FCMYGBAG10D,FCMYGBAGID\n20-May-2013,,,,3.229,1.2\n02-Oct-2026,3.61,3.7,3.92,4.38,2.1\n');
  assert.deepEqual(rba.get(dayNum('2026-10-02')), [[2, 3.61], [3, 3.7], [5, 3.92], [10, 4.38]], 'the indexed bond left out');
  assert.equal(rba.has(dayNum('2013-05-20')), false, 'only the 10-year that day');

  const bbk = parseBBK('DATAFLOW;BBK_SEIS_MATURITY;TIME_PERIOD;OBS_VALUE\n' + ['01;2.91', '02;3.02', '05;3.2', '10;3.51', '30;3.9'].map(s => { const [m, v] = s.split(';'); return `BBK;R${m}XX;2026-10-05;${v}`; }).join('\n') + '\nBBK;R10XX;2026-10-04;.\n');
  assert.deepEqual(bbk.get(dayNum('2026-10-05')).map(p => p[0]), [1, 2, 5, 10, 30]);
  assert.equal(bbk.has(dayNum('2026-10-04')), false, "'.' is no value");

  const snb = parseSNB('"CubeId";"rendeiduebd"\n\n"Date";"D0";"D1";"Value"\n' + ['1J;0.17', '2J;0.287', '5J;0.453', '10J;0.586', '30J;0.553'].map(s => { const [t, v] = s.split(';'); return `"2026-09-30";"CHF";"${t}";"${v}"`; }).join('\n') + '\n"2026-09-30";"EUR";"10J";\n');
  assert.equal(interp(snb.get(dayNum('2026-09-30')), 10), 0.586);
  assert.equal(snb.get(dayNum('2026-09-30')).length, 5, 'only the Confederation (CHF) rows');

  const nb = parseNB('FREQ;Frequency;TENOR;Tenor;INSTRUMENT_TYPE;Instrument Type;TIME_PERIOD;OBS_VALUE\n' + ['3M;4.458', '12M;4.741', '3Y;4.791', '10Y;4.588'].map(s => { const [t, v] = s.split(';'); return `B;Business;${t};x;GBON;x;2026-10-02;${v}`; }).join('\n'));
  assert.deepEqual(nb.get(dayNum('2026-10-02')), [[0.25, 4.458], [1, 4.741], [3, 4.791], [10, 4.588]]);

  const se = mergeSeries([[0.25, [{ date: '2026-10-02', value: 2.1 }]], [2, [{ date: '2026-10-02', value: 2.66 }]], [5, [{ date: '2026-10-02', value: 2.9 }]], [10, [{ date: '2026-10-02', value: 3.14 }, { date: '2026-10-01', value: 3.2 }]]], 4);
  assert.deepEqual(se.get(dayNum('2026-10-02')), [[0.25, 2.1], [2, 2.66], [5, 2.9], [10, 3.14]]);
  assert.equal(se.has(dayNum('2026-10-01')), false, 'a day with too few maturities is skipped');

  const P = (d, v) => ({ Period: d + 'T00:00:00', Value: v });
  const za = mergeSARB([[0.25, [P('2026-09-25', 6.9)]], [1, [P('2026-09-25', 7.5)]]], [[7.5, [P('2026-10-02', 8.83), P('2026-09-01', 8.5)]], [15, [P('2026-10-02', 9.07), P('2026-09-01', 8.8)]]]);
  assert.deepEqual(za.get(dayNum('2026-10-02')), [[0.25, 6.9], [1, 7.5], [7.5, 8.83], [15, 9.07]], "last week's bill tender carried to the bond day");
  assert.equal(za.has(dayNum('2026-09-01')), false, 'no bill tender within 10 days before: skipped');

  const csv = ['Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha',
    'Tesouro Selic;01/03/2031;02/10/2026;0,09;0,10',
    ...['01/01/2027;13,10', '01/01/2029;13,50', '01/01/2032;13,90', '01/01/2037;14,20'].map(s => { const [v, r] = s.split(';'); return `Tesouro Prefixado com Juros Semestrais;${v};02/10/2026;${r};0`; }),
    'Tesouro Prefixado;01/11/2026;02/10/2026;12,90;0', 'Tesouro Prefixado;01/01/2020;31/12/2018;6,5;0'].join('\n');
  const br = parseTesouro(csv, dayNum('2024-01-01'));
  assert.equal(br.size, 1, 'only days from `since` on');
  const pts = br.get(dayNum('2026-10-02'));
  assert.equal(pts.length, 4, 'Selic (floating) and bonds under 2 months to maturity left out');
  assert.equal(pts[0][1], 13.1);
  assert.ok(Math.abs(pts.at(-1)[0] - 10.25) < 0.01, 'years to maturity');
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
  const uk = summarize(COUNTRIES.find(c => c.id === 'uk'), new Map([[from, [[0, 4], [5, 4.2], [10, 4.6], [20, 5]]]]), from * DAY);
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
  const listChanged = await build({ prev: { ...first, ids: 'us,ea' }, now: now + 60e3, fetchFn, log: () => {} });
  const layoutChanged = await build({ prev: { ...first, layout: 1 }, now: now + 60e3, fetchFn, log: () => {} });
  assert.equal(layoutChanged.fetched, now + 60e3, 'a file from older code: rebuilt at once');
  assert.equal(listChanged.fetched, now + 60e3, 'a market added since the last file: fetched at once');
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

// a minimal .xlsx (a zip of XML files, deflated) like FBIL's: shared strings with the date, a G-Sec sheet keyed by
// ISIN strings, and the Par Yield sheet (tenor | yield rows)
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), data = deflateRawSync(enc.encode(text)), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

test('China and India: ChinaBond chart data and FBIL’s daily file, thinned to the usual maturities', async () => {
  const series = Array.from({ length: 501 }, (_, i) => [i / 10, +(1 + i / 500).toFixed(4)]);
  const cn = parseChinaBond([{ worktime: '2026-09-30', seriesData: series }, { worktime: '2026-09-29', seriesData: [] }]);
  assert.deepEqual([...cn.keys()], [dayNum('2026-09-30')], 'a day without data is skipped');
  const p = cn.get(dayNum('2026-09-30'));
  assert.deepEqual(p.map(x => x[0]), [0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 40, 50]);
  assert.equal(interp(p, 10), 1.2);

  const row = (r, a, b, aStr) => `<row r="${r}"><c r="A${r}"${aStr ? ' t="s"' : ''}><v>${a}</v></c><c r="B${r}"><v>${b}</v></c></row>`;
  const tenors = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 40];
  const buf = zip({
    'xl/sharedStrings.xml': '<sst><si><t>FBIL GSec Base/Par Yield</t></si><si><t>29-Sep-2026</t></si><si><t>IN0020230119</t></si></sst>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(r => row(r, 2, 101.5, true)).join('')}</sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet><sheetData>${row(1, 0, 0, true)}${tenors.map((t, i) => row(i + 6, t, (5.4 + t * 0.05).toFixed(2))).join('')}</sheetData></worksheet>`,
  });
  const files = await unzipEntries(buf, n => n.endsWith('sheet2.xml'));
  assert.deepEqual(Object.keys(files), ['xl/worksheets/sheet2.xml']);
  const fb = await parseFBIL(buf);
  assert.equal(fb.day, dayNum('2026-09-29'), 'the date from the file');
  assert.equal(interp(fb.pts, 10), 5.9);
  assert.equal(interp(fb.pts, 2), 5.5);
  assert.equal(await parseFBIL(zip({ 'xl/sharedStrings.xml': '<sst></sst>' })), null);
});

test('history kept between runs (India): the daily 10-year and 2-year points, and the whole curves', () => {
  const c = COUNTRIES.find(x => x.id === 'in'), from = dayNum('2026-01-05');
  const full = new Map([[from, [[0.25, 5], [2, 5.5], [10, 6]]], [from + 20, [[0.25, 5.05], [2, 5.55], [10, 6.1]]], [from + 27, [[0.25, 5.1], [2, 5.6], [10, 6.2]]]]);
  const s = summarize(c, full, (from + 27) * DAY);
  const back = daysFromSummary(c, s);
  assert.deepEqual(back.get(from), [[2, 5.5], [10, 6]], 'a past day: just its 10-year and 2-year');
  assert.deepEqual(back.get(from + 20), [[0.25, 5.05], [2, 5.55], [10, 6.1]], 'the week-ago comparison: the whole curve');
  assert.deepEqual(back.get(from + 27), [[0.25, 5.1], [2, 5.6], [10, 6.2]], 'the latest: the whole curve');
  assert.deepEqual(summarize(c, back, (from + 27) * DAY).series, s.series, 'nothing lost on the way round');
});

test('Europe, monthly: the ECB 10-year per country, change on the month and year, and the gap to Germany', () => {
  const months = Array.from({ length: 25 }, (_, i) => `${2024 + Math.floor((7 + i) / 12)}-${String((7 + i) % 12 + 1).padStart(2, '0')}`);
  const csv = 'KEY,FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE\n' + months.flatMap((m, i) => [`x,M,IT,${m},${(3 + i * 0.01).toFixed(3)}`, `x,M,DE,${m},${(2.5 + i * 0.01).toFixed(3)}`, `x,M,PL,${m},${(5 + i * 0.02).toFixed(3)}`]).join('\n');
  const by = parseIRS(csv);
  assert.equal(by.IT.length, 25);
  const ms = summarizeMonthly(by);
  assert.deepEqual(ms.map(m => m.id), ['it', 'pl'], 'only the countries with data, in the list order');
  const it = ms[0];
  assert.equal(it.month, '2026-08');
  assert.equal(it.y10, 3.24);
  assert.equal(it.chg1m, 1);
  assert.equal(it.chg12m, 12);
  assert.equal(it.vsDE, 0.5);
  assert.equal(it.de.length, 25);
  assert.equal(ms[1].vsDE, null, 'Poland is not in the euro: no gap to Germany');
  assert.equal(EU_MONTHLY.length, 15);
});

test('health: the monthly figures count as late 75 days after their month began', () => {
  const now = Date.parse('2026-10-06T10:00:00Z'), countries = [{ badge: 'US', date: '2026-10-05' }];
  const row = month => health({ rates: { countries, monthly: [{ month }] } }, now).sources.find(s => s.key === 'yields');
  assert.equal(row('2026-08').state, 'ok');
  assert.match(row('2026-08').note, /Europe monthly to 2026-08 · inflation for 0\/2$/);
  assert.equal(row('2026-06').state, 'warn');
});

test('inflation: Eurostat (JSON-stat), the OECD (csv), Japan’s CPI index → the latest yearly rate per market', () => {
  const es = parseEurostat({ dimension: { geo: { category: { index: { EA20: 0, EL: 1, XX: 2 } } }, time: { category: { index: { '2026-07': 0, '2026-08': 1, '2026-09': 2 } } } },
    value: { 0: 2.7, 1: 2.9, 2: 3.8, 3: 3.0, 4: 3.1, 6: 1 } });
  assert.deepEqual(es.ea, { v: 3.8, month: '2026-09', src: 'Eurostat' });
  assert.deepEqual(es.gr, { v: 3.1, month: '2026-08', src: 'Eurostat' }, 'Greece (EL): its latest month with a value');
  assert.equal(Object.keys(es).length, 2, 'areas not on the page are ignored');
  const oe = parseOECD('DATAFLOW,REF_AREA,FREQ,TIME_PERIOD,OBS_VALUE\nx,USA,M,2026-08,3.396548\nx,GBR,M,2026-08,3.3\nx,JPN,M,2021-06,-0.5\n');
  assert.deepEqual(oe.us, { v: 3.3965, month: '2026-08', src: 'OECD' });
  assert.equal(oe.jp, undefined, 'Japan comes from its own statistics bureau');
  const jp = parseJapanCPI('header,…\n202508,111.0,1\n202607,113.9,1\n202608,114.3,1\n');
  assert.deepEqual(jp, { v: 2.973, month: '2026-08', src: 'Statistics Bureau of Japan' });
  assert.equal(parseJapanCPI('202608,114.3\n'), null, 'no year-ago month: no rate');
});

test('summarize: ten years of weekly history, today’s slope ranked against it, and the 10-year minus 3-month gap', () => {
  const from = dayNum('2021-01-04'), n = 2000, now = (from + n - 1) * DAY;
  // the slope (10y − 2y) drifts from −1 to +1 over the period, so today's is the steepest
  const days = new Map();
  for (let i = 0; i < n; i++) { const s = -1 + 2 * i / (n - 1); days.set(from + i, [[0.25, 3], [2, 3.5], [10, 3.5 + s]]); }
  const s = summarize(COUNTRIES[0], days, now);
  assert.ok(s.long.d.length > 270 && s.long.d.length < 290, 'one point a week');
  assert.ok(s.longYears > 5.4 && s.longYears < 5.6);
  assert.ok(s.slopePct >= 99, 'steeper than nearly every week');
  assert.equal(s.series.d.length, 761, 'the daily series keeps two years');
  assert.equal(s.y3m, 3);
  assert.equal(s.slope3m, 1.5);
  // the next run fetches only the recent days: the history is carried over from the last one
  const recent = new Map([...days].filter(([d]) => d >= from + n - 30));
  const t = summarize(COUNTRIES[0], recent, now, s.long);
  assert.equal(t.long.d.length, s.long.d.length);
  assert.equal(t.slopePct, s.slopePct);
  const uk = summarize(COUNTRIES.find(c => c.id === 'uk'), new Map([[from, [[0, 4], [5, 4.2], [10, 4.6], [20, 5]]]]), from * DAY);
  assert.equal(uk.y3m, null, 'not for a curve whose short end is the Bank Rate');
  assert.equal(uk.slopePct, null, 'too little history to rank');
});
