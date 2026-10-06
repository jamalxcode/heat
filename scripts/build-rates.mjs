// Builds rates.json for heat.sala.company/rates/: government bond yield curves, from official sources only, once a day.
// Runs in the deploy job (every 10 minutes) but refetches only every REFETCH: the sources publish once a business day.
//   node scripts/build-rates.mjs <out.json>        (env PREV_URL = the last published rates.json)
// Sources (all official and free; each publishes after its market closes, some a few days late):
//   US         US Treasury daily par yield curve (1 month … 30 years), one CSV per year
//   Euro area  ECB yield curve of AAA-rated euro area government bonds (3 months … 30 years)
//   UK         Bank of England: Bank Rate plus the 5, 10 and 20-year nominal par gilt yields (the free daily series)
//   Japan      Ministry of Finance JGB yields (1 … 40 years): the full history file plus this month's file
//   Canada     Bank of Canada benchmark bond yields (2 … 30 years)
//   Australia  Reserve Bank table F2: government bond yields at 2, 3, 5 and 10 years
//   Germany    Bundesbank fitted curve of listed federal securities (1 … 30 years)
//   Switzerl.  Swiss National Bank spot rates of Confederation bonds (1 … 30 years)
//   Sweden     Riksbank: Treasury bills and government bonds (3 months … 10 years); its open API allows a few requests a minute
//   Norway     Norges Bank generic government rates (3 months … 10 years)
//   Brazil     National Treasury, Tesouro Direto fixed-rate bonds by maturity date (one ~15 MB file, fetched every 12 hours)
//   China      ChinaBond government bond yield curve (chart data; slow from abroad, so a few missing dates per run)
//   India      FBIL par yield curve, one Excel file per day (read with a small built-in .xlsx reader), a few days per run
//   S. Africa  Reserve Bank: Treasury bill tenders (3 … 12 months) and average bond yields by maturity band (5–10, 10+ years)
//   Europe     monthly only: the ECB's 10-year yield per EU country (France, Italy, Spain … 15), shown in their own row
// Not included: the Gulf states publish auction results, not a daily curve, and have no free official daily feed;
// Morocco's Bank Al-Maghrib publishes a daily curve, but its website refuses requests from
// cloud servers like GitHub's. (The RBA's site is the other way round: it blocks home connections, not GitHub's.)
// Health: the curve's slope, 10-year minus 2-year (UK: minus Bank Rate; South Africa: minus the 3-month bill). Long
// rates normally sit above short ones; an inverted curve (short above long) has come before most US recessions.
// ≥ 0.5 pp normal, 0 to 0.5 flat, < 0 inverted.
import { isoDay, dayNum, DAY } from './build-forex.mjs';

const REFETCH = 3 * 36e5;               // every 3 hours
const SERIES_DAYS = 760;                // ~2 years of daily 10-year and short yields, for the changes
const LONG_DAYS = 3660;                 // ~10 years of weekly 10-year and short yields, for the slope history and its rank
const LONG_EVERY = 7 * DAY;             // how often a fetch reaches back that far (in between, the history is carried over)
const FMT = 1;                          // the history kept between runs (China's, India's): a change drops it
const LAYOUT = 2;                       // what each market carries (2: inflation, real yield, ten-year rank): a change
                                        // rebuilds the file at once instead of reusing the last one for REFETCH
export const FLAT_PP = 0.5;

// short: the short leg of the slope ('2y', or 'Bank Rate' / '3m' where no 2-year is published); every: hours between
// fetches when more than the default REFETCH (a big file); note: a caveat shown under the market's chart
export const COUNTRIES = [
  { id: 'us', region: 'Americas', name: 'United States', flag: '🇺🇸', badge: 'US', src: 'US Treasury', srcUrl: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates', short: '2y' },
  { id: 'ea', region: 'Europe', name: 'Euro area', flag: '🇪🇺', badge: 'EU', src: 'European Central Bank (AAA-rated government bonds)', srcUrl: 'https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_area_yield_curves/html/index.en.html', short: '2y',
    note: 'The euro area curve is built from AAA-rated government bonds (Germany, the Netherlands and others), not each country’s own.' },
  { id: 'de', region: 'Europe', name: 'Germany', flag: '🇩🇪', badge: 'DE', src: 'Deutsche Bundesbank', srcUrl: 'https://www.bundesbank.de/en/statistics/money-and-capital-markets/interest-rates-and-yields', short: '2y',
    note: 'The Bundesbank’s fitted curve of listed federal securities (Bunds).' },
  { id: 'uk', region: 'Europe', name: 'United Kingdom', flag: '🇬🇧', badge: 'GB', src: 'Bank of England', srcUrl: 'https://www.bankofengland.co.uk/boeapps/database/', short: 'Bank Rate',
    note: 'The free daily series has the 5, 10 and 20-year gilt yields; the short end is the Bank Rate.' },
  { id: 'jp', region: 'Asia-Pacific', name: 'Japan', flag: '🇯🇵', badge: 'JP', src: 'Ministry of Finance Japan', srcUrl: 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm', short: '2y' },
  { id: 'ca', region: 'Americas', name: 'Canada', flag: '🇨🇦', badge: 'CA', src: 'Bank of Canada', srcUrl: 'https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/', short: '2y' },
  { id: 'au', region: 'Asia-Pacific', name: 'Australia', flag: '🇦🇺', badge: 'AU', src: 'Reserve Bank of Australia', srcUrl: 'https://www.rba.gov.au/statistics/tables/#interest-rates', short: '2y',
    note: 'The Reserve Bank publishes the 2, 3, 5 and 10-year government bond yields.' },
  { id: 'ch', region: 'Europe', name: 'Switzerland', flag: '🇨🇭', badge: 'CH', src: 'Swiss National Bank', srcUrl: 'https://data.snb.ch/en/topics/ziredev', short: '2y',
    note: 'Spot rates of Swiss Confederation bonds.' },
  { id: 'se', region: 'Europe', name: 'Sweden', flag: '🇸🇪', badge: 'SE', src: 'Sveriges Riksbank', srcUrl: 'https://www.riksbank.se/en-gb/statistics/interest-rates-and-exchange-rates/', short: '2y' },
  { id: 'no', region: 'Europe', name: 'Norway', flag: '🇳🇴', badge: 'NO', src: 'Norges Bank', srcUrl: 'https://www.norges-bank.no/en/topics/Statistics/Interest-rates/Government-debt-securities/', short: '2y' },
  { id: 'br', region: 'Americas', name: 'Brazil', flag: '🇧🇷', badge: 'BR', src: 'Tesouro Nacional (Tesouro Direto rates)', srcUrl: 'https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto', short: '2y', every: 12,
    note: 'Fixed-rate bonds offered to savers through Tesouro Direto (Prefixado, with and without coupons): the National Treasury’s own daily rates, close to the market’s. Maturities are fixed dates, so the points move a little each day.' },
  { id: 'cn', region: 'Asia-Pacific', name: 'China', flag: '🇨🇳', badge: 'CN', src: 'ChinaBond (China Central Depository & Clearing)', srcUrl: 'https://yield.chinabond.com.cn/cbweb-mn/yield_main?locale=en_US', short: '2y',
    note: 'ChinaBond’s government bond yield curve, the benchmark for Chinese government bonds; before the last month the history is weekly.' },
  { id: 'in', region: 'Asia-Pacific', name: 'India', flag: '🇮🇳', badge: 'IN', src: 'Financial Benchmarks India (FBIL)', srcUrl: 'https://www.fbil.org.in/#/benchmark/gsec', short: '2y', perDay: true,
    note: 'FBIL’s daily par yield curve for government securities (G-secs), published as one file per day; the history is filled in weekly points at first, then daily.' },
  { id: 'za', region: 'Africa', name: 'South Africa', flag: '🇿🇦', badge: 'ZA', src: 'South African Reserve Bank', srcUrl: 'https://www.resbank.co.za/en/home/what-we-do/statistics/key-statistics/current-market-rates', short: '3m',
    note: 'The Reserve Bank publishes Treasury bill rates (weekly tenders) and average bond yields by maturity band (5–10 years, 10 years and longer), shown here at 7.5 and 15 years, so the 10-year figure is an estimate between them.' },
];
const SHORT_T = { '2y': 2, 'Bank Rate': 0, '3m': 0.25 };

/* ---------- helpers ---------- */
const r4 = v => Math.round(v * 1e4) / 1e4;
// yield at tenor t (years) on a curve [[tenor, yield]…] sorted by tenor: straight line between neighbours, null outside
export function interp(pts, t) {
  if (!pts?.length || t < pts[0][0] - 1e-9 || t > pts[pts.length - 1][0] + 1e-9) return null;
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(pts[i][0] - t) < 1e-9) return pts[i][1];
    if (pts[i][0] > t) { const [t0, y0] = pts[i - 1], [t1, y1] = pts[i]; return y0 + (y1 - y0) * (t - t0) / (t1 - t0); }
  }
  return null;
}
const sortPts = m => [...m].filter(([, y]) => Number.isFinite(y)).sort((a, b) => a[0] - b[0]).map(([t, y]) => [r4(t), r4(y)]);
const csvRows = text => text.trim().split(/\r?\n/).map(l => l.split(',').map(s => s.replace(/^"|"$/g, '').trim()));
async function getText(url, fetchFn, opts = {}) {
  const r = await fetchFn(url, { headers: { 'user-agent': 'Mozilla/5.0 (heat.sala.company)', ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout || 30e3) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url.split('?')[0]}`);
  return r.text();
}
const tenorOf = s => { const m = String(s).match(/([\d.]+)\s*(mo|month|m|yr|y)/i); return m ? (+m[1]) / (/^m/i.test(m[2]) ? 12 : 1) : null; };

/* ---------- one parser per source: text → Map(day number → curve points) ---------- */
// US Treasury CSV: Date,"1 Mo","1.5 Month",…,"30 Yr"; dates MM/DD/YYYY
export function parseUS(text) {
  const [head, ...rows] = csvRows(text), tenors = head.map(tenorOf), out = new Map();
  for (const r of rows) {
    const [m, d, y] = r[0].split('/');
    if (!y) continue;
    const pts = sortPts(r.slice(1).map((v, i) => [tenors[i + 1], v === '' ? NaN : +v]).filter(([t]) => t));
    if (pts.length >= 5) out.set(dayNum(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`), pts);
  }
  return out;
}
// ECB csvdata: …,DATA_TYPE_FM (SR_10Y),TIME_PERIOD,OBS_VALUE,…
export function parseECB(text) {
  const [head, ...rows] = csvRows(text), iT = head.indexOf('DATA_TYPE_FM'), iD = head.indexOf('TIME_PERIOD'), iV = head.indexOf('OBS_VALUE');
  const by = new Map();
  for (const r of rows) {
    const t = tenorOf(r[iT]?.replace('SR_', '')), v = +r[iV], d = dayNum(r[iD]);
    if (!t || !Number.isFinite(v) || !Number.isFinite(d)) continue;
    if (!by.has(d)) by.set(d, new Map());
    by.get(d).set(t, v);
  }
  return new Map([...by].map(([d, m]) => [d, sortPts(m)]).filter(([, p]) => p.length >= 5));
}
// Bank of England IADB csv: DATE,IUDBEDR,IUDSNPY,IUDMNPY,IUDLNPY with dates "01 Sep 2026". Bank Rate sits at tenor 0.
export const BOE = { IUDBEDR: 0, IUDSNPY: 5, IUDMNPY: 10, IUDLNPY: 20 };
export function parseBoE(text) {
  const [head, ...rows] = csvRows(text), out = new Map();
  for (const r of rows) {
    const d = Math.floor(Date.parse(r[0] + ' UTC') / DAY);
    if (!Number.isFinite(d)) continue;
    const pts = sortPts(head.slice(1).map((code, i) => [BOE[code], r[i + 1] === '' ? NaN : +r[i + 1]]).filter(([t]) => t != null));
    if (pts.length === 4) out.set(d, pts);
  }
  return out;
}
// MOF JGB csv: a title line, then Date,1Y,…,40Y with dates YYYY/M/D; "-" for no value
export function parseMOF(text) {
  const rows = csvRows(text), hi = rows.findIndex(r => r[0] === 'Date');
  if (hi < 0) return new Map();
  const tenors = rows[hi].map(tenorOf), out = new Map();
  for (const r of rows.slice(hi + 1)) {
    const [y, m, d] = r[0].split('/');
    if (!d) continue;
    const pts = sortPts(r.slice(1).map((v, i) => [tenors[i + 1], v === '' || v === '-' ? NaN : +v]).filter(([t]) => t));
    if (pts.length >= 5) out.set(dayNum(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`), pts);
  }
  return out;
}
// Bank of Canada Valet JSON: observations [{ d, 'BD.CDN.2YR.DQ.YLD': { v } …}]; LONG = the long benchmark (~30 years)
export function parseBoC(json) {
  const out = new Map();
  for (const o of json?.observations || []) {
    const pts = sortPts(Object.entries(o).filter(([k]) => k.startsWith('BD.CDN.')).map(([k, x]) => [k.includes('LONG') ? 30 : +k.match(/(\d+)YR/)?.[1], +x?.v]).filter(([t]) => t));
    if (pts.length >= 4) out.set(dayNum(o.d), pts);
  }
  return out;
}

// semicolon CSV with a header row (fields may be quoted) → rows as objects by column name
function semiRows(text, headerTest) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/), hi = lines.findIndex(headerTest);
  if (hi < 0) return [];
  const cells = l => l.split(';').map(s => s.replace(/^"|"$/g, '').trim()), head = cells(lines[hi]);
  return lines.slice(hi + 1).filter(Boolean).map(l => Object.fromEntries(cells(l).map((v, i) => [head[i], v])));
}
const byDay = (rows, min) => {
  const by = new Map();
  for (const [d, t, v] of rows) { if (!Number.isFinite(d) || !Number.isFinite(v) || t == null) continue; if (!by.has(d)) by.set(d, new Map()); by.get(d).set(t, v); }
  return new Map([...by].map(([d, m]) => [d, sortPts(m)]).filter(([, p]) => p.length >= min));
};
// Bundesbank sdmx_csv: BBK_SEIS_MATURITY R10XX = 10 years; '.' = no value
export const parseBBK = (text, min = 5) => byDay(semiRows(text, l => l.includes('BBK_SEIS_MATURITY')).map(r => [dayNum(r.TIME_PERIOD), +r.BBK_SEIS_MATURITY?.match(/R(\d+)XX/)?.[1], r.OBS_VALUE === '.' ? NaN : +r.OBS_VALUE]), min);
// SNB cube csv: "Date";"D0";"D1";"Value" with D1 = 10J (years), Swiss Confederation bonds only (D0 = CHF)
export const parseSNB = text => byDay(semiRows(text, l => l.startsWith('"Date"')).filter(r => r.D0 === 'CHF').map(r => [dayNum(r.Date), tenorOf(r.D1.replace('J', 'y')), r.Value === '' ? NaN : +r.Value]), 5);
// Norges Bank csv: TENOR 3M / 12M / 10Y, TIME_PERIOD, OBS_VALUE
export const parseNB = text => byDay(semiRows(text, l => l.startsWith('FREQ;')).map(r => [dayNum(r.TIME_PERIOD), tenorOf(r.TENOR), +r.OBS_VALUE]), 4);
// one [{ date, value }] list per maturity (Riksbank) → curves by day
export function mergeSeries(byTenor, min, dateKey = 'date', valueKey = 'value') {
  const rows = [];
  for (const [t, list] of byTenor) for (const o of list || []) rows.push([dayNum(String(o[dateKey]).slice(0, 10)), t, +o[valueKey]]);
  return byDay(rows, min);
}
// South Africa: Treasury bills come from weekly tenders and the bond bands daily, so each bond day uses the latest
// bill rates on or before it (within 10 days)
export function mergeSARB(bills, bonds) {
  const bondDays = mergeSeries(bonds, 2, 'Period', 'Value'), billDays = mergeSeries(bills, 1, 'Period', 'Value');
  const billKeys = [...billDays.keys()].sort((a, b) => a - b), out = new Map();
  for (const [d, pts] of bondDays) {
    let k = null;
    for (const b of billKeys) { if (b > d) break; if (b >= d - 10) k = b; }
    if (k != null) out.set(d, sortPts(new Map([...billDays.get(k), ...pts])));
  }
  return out;
}
// RBA table F2 csv: title rows, then 'Series ID', then DD-Mon-YYYY,2y,3y,5y,10y,indexed (the indexed bond is left out)
export function parseRBA(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/), hi = lines.findIndex(l => l.startsWith('Series ID'));
  if (hi < 0) return new Map();
  const tenors = [2, 3, 5, 10], rows = [];
  for (const l of lines.slice(hi + 1)) {
    const [date, ...v] = l.split(','), d = Math.floor(Date.parse(date.replace(/-/g, ' ') + ' UTC') / DAY);
    tenors.forEach((t, i) => rows.push([d, t, v[i] === '' || v[i] == null ? NaN : +v[i]]));
  }
  return byDay(rows, 4);
}
// Tesouro Direto csv: Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;… (dates DD/MM/YYYY, decimal commas).
// The fixed-rate bonds only (Prefixado, with and without coupons), as years to maturity; from day `since` on
export function parseTesouro(text, since = 0) {
  const rows = [], iso = s => { const [d, m, y] = s.split('/'); return dayNum(`${y}-${m}-${d}`); };
  for (const l of String(text).split(/\r?\n/)) {
    if (!l.startsWith('Tesouro Prefixado')) continue;
    const [, venc, base, rate] = l.split(';'), b = iso(base), v = iso(venc), y = +String(rate).replace(',', '.');
    if (b >= since && v > b + 60 && y > 0) rows.push([b, r4((v - b) / 365.25), y]);
  }
  return byDay(rows, 4);
}

// ChinaBond chart data: [{ worktime, seriesData: [[years, yield]…] }] every 0.1 year out to 50, kept at the usual
// maturities (enough to draw the curve, much smaller)
const STD_TENORS = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 40, 50];
const thin = all => STD_TENORS.map(t => [t, interp(all, t)]).filter(([, y]) => y != null).map(([t, y]) => [t, r4(y)]);
export function parseChinaBond(json) {
  const out = new Map();
  for (const o of Array.isArray(json) ? json : []) {
    const all = sortPts(new Map((o.seriesData || []).map(([t, y]) => [+t, +y])));
    const pts = thin(all);
    if (o.worktime && pts.length >= 5) out.set(dayNum(o.worktime), pts);
  }
  return out;
}

// The smallest .xlsx reader that works here: a zip of XML files. Returns { 'xl/sharedStrings.xml': text, … } for the
// entries asked for. Uses DecompressionStream (Node 18+ and browsers), so no packages.
export async function unzipEntries(buf, wanted) {
  const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = {};
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  let p = dv.getUint32(eocd + 16, true);
  const n = dv.getUint16(eocd + 10, true), dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nameLen = dv.getUint16(p + 28, true);
    const extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!wanted(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true), data = b.subarray(start, start + size);
    out[name] = method === 0 ? dec.decode(data)
      : await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  }
  return out;
}
// FBIL's daily file: the "Par Yield" sheet holds Tenor (years) | par yield rows (0.25 … 40). Found by its cells, not
// its position: the sheet whose rows are a rising tenor in A and a yield in B.
export async function parseFBIL(buf) {
  const files = await unzipEntries(buf, n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const strings = (files['xl/sharedStrings.xml'] || '').split('<si>').slice(1).map(s => s.replace(/<[^>]*>/g, ''));
  const date = strings.map(s => s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/)).find(Boolean);
  const day = date ? Math.floor(Date.parse(`${date[1]} ${date[2]} ${date[3]} UTC`) / DAY) : null;
  for (const [name, xml] of Object.entries(files)) {
    if (!name.includes('worksheets')) continue;
    const pts = new Map();
    for (const row of xml.split('<row').slice(1)) {
      const a = row.match(/<c r="A\d+"[^>]*>(?:<f>[^<]*<\/f>)?<v>([\d.]+)<\/v>/), y = row.match(/<c r="B\d+"[^>]*>(?:<f>[^<]*<\/f>)?<v>([\d.]+)<\/v>/);
      if (a && y && !/t="s"/.test(row.match(/<c r="A\d+"[^>]*>/)[0]) && +a[1] > 0 && +a[1] <= 50 && +y[1] > 0 && +y[1] < 30) pts.set(+a[1], +y[1]);
    }
    const p = sortPts(pts);
    if (p.length >= 8 && day != null) return { day, pts: thin(p) };
  }
  return null;
}

// ECB monthly long-term (10-year) government bond yields per EU country: KEY,…,REF_AREA,…,TIME_PERIOD (YYYY-MM),OBS_VALUE
export function parseIRS(text) {
  const [head, ...rows] = csvRows(text), iA = head.indexOf('REF_AREA'), iT = head.indexOf('TIME_PERIOD'), iV = head.indexOf('OBS_VALUE');
  const out = {};
  for (const r of rows) if (r[iA] && /^\d{4}-\d{2}$/.test(r[iT]) && r[iV] !== '') (out[r[iA]] ||= []).push([r[iT], +r[iV]]);
  for (const k in out) out[k].sort((a, b) => a[0] < b[0] ? -1 : 1);
  return out;
}

/* ---------- fetchers ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the Riksbank's open API allows a handful of requests a minute: one at a time, waiting when it says so
async function riksbank(id, from, fetchFn) {
  for (let tries = 0; tries < 4; tries++) {
    const r = await fetchFn(`https://api.riksbank.se/swea/v1/Observations/${id}/${from}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30e3) });
    if (r.status === 429) { const s = +(await r.text()).match(/(\d+) second/)?.[1] || 15; await sleep((s + 1) * 1000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status} for Riksbank ${id}`);
    return r.json();
  }
  throw new Error(`Riksbank ${id}: still rate-limited`);
}
const sarb = (code, from, to, fetchFn) => getText(`https://custom.resbank.co.za/SarbWebApi/WebIndicators/Shared/GetTimeseriesObservations/${code}/${from}/${to}`, fetchFn).then(JSON.parse);
const FETCH = {
  async us(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    const y = new Date(today * DAY).getUTCFullYear(), out = new Map();
    for (let yr = new Date(from * DAY).getUTCFullYear(); yr <= y; yr++) {
      const t = await getText(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`, fetchFn);
      for (const [d, p] of parseUS(t)) out.set(d, p);
    }
    return out;
  },
  async ea(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    const keys = ['3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '15Y', '20Y', '30Y'].map(k => 'SR_' + k).join('+');
    return parseECB(await getText(`https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.${keys}?startPeriod=${isoDay(from)}&format=csvdata&detail=dataonly`, fetchFn, { timeout: 60e3 }));
  },
  async uk(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    const start = new Date(from * DAY).toUTCString().slice(5, 16).replace(/ /g, '/');   // 01/Sep/2024
    return parseBoE(await getText(`https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${start}&Dateto=now&SeriesCodes=${Object.keys(BOE).join(',')}&CSVF=TN&UsingCodes=Y`, fetchFn));
  },
  async jp(fetchFn) {
    const base = 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/';
    const out = parseMOF(await getText(base + 'historical/jgbcme_all.csv', fetchFn, { timeout: 90e3 }));
    try { for (const [d, p] of parseMOF(await getText(base + 'jgbcme.csv', fetchFn))) out.set(d, p); } catch { /* this month's file is a bonus */ }
    return out;
  },
  async ca(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    return parseBoC(JSON.parse(await getText(`https://www.bankofcanada.ca/valet/observations/group/bond_yields_benchmark/json?start_date=${isoDay(from)}`, fetchFn)));
  },
  async de(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    // the whole curve for the last two years; further back (the weekly 10-year history) only the 2 and 10-year, as the
    // full set over ten years is ~10 MB
    const url = (keys, start) => `https://api.statistiken.bundesbank.de/rest/data/BBSIS/D.I.ZST.ZI.EUR.S1311.B.A604.${keys.map(n => `R${n}XX`).join('+')}.R.A.A._Z._Z.A?startPeriod=${isoDay(start)}&format=sdmx_csv`;
    const recent = Math.max(from, today - SERIES_DAYS - 10);
    const out = parseBBK(await getText(url(['01', '02', '03', '05', '07', '10', '15', '20', '30'], recent), fetchFn, { timeout: 90e3 }));
    if (from < recent) for (const [d, p] of parseBBK(await getText(url(['02', '10'], from), fetchFn, { timeout: 90e3 }), 2)) if (!out.has(d)) out.set(d, p);
    return out;
  },
  async au(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    const all = parseRBA(await getText('https://www.rba.gov.au/statistics/tables/csv/f2-data.csv', fetchFn, { timeout: 60e3 }));
    return new Map([...all].filter(([d]) => d >= from));
  },
  async ch(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    return parseSNB(await getText(`https://data.snb.ch/api/cube/rendeiduebd/data/csv/en?fromDate=${isoDay(from)}&dimSel=D0(CHF)`, fetchFn, { timeout: 60e3 }));
  },
  async se(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    const start = isoDay(from), series = [['SETB3MBENCH', 0.25], ['SETB6MBENCH', 0.5], ['SEGVB2YC', 2], ['SEGVB5YC', 5], ['SEGVB7YC', 7], ['SEGVB10YC', 10]];
    const byTenor = [];
    for (const [id, t] of series) byTenor.push([t, await riksbank(id, start, fetchFn)]);
    return mergeSeries(byTenor, 4);
  },
  async no(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    return parseNB(await getText(`https://data.norges-bank.no/api/data/GOVT_GENERIC_RATES/B..?format=csv&startPeriod=${isoDay(from)}&locale=en`, fetchFn, { timeout: 60e3 }));
  },
  async br(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    // one file with every day since 2002 (~15 MB): fetched at most every 12 hours (`every`), only the last two years kept
    return parseTesouro(await getText('https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv', fetchFn, { timeout: 120e3 }), from);
  },
  // China: ChinaBond answers slowly from abroad, so like India its history is kept in rates.json and each run asks
  // only for missing dates (up to 30, ten per request): weekdays of the last six weeks, the exact week / month /
  // year-ago days, and one a week back two years. The first few runs fill it in; after that, a date or two a run.
  async cn(fetchFn, today, { prev, log } = {}) {
    const c = COUNTRIES.find(x => x.id === 'cn'), days = daysFromSummary(c, prev);
    const weekday = d => { const w = new Date(d * DAY).getUTCDay(); return w === 6 ? d - 1 : w === 0 ? d - 2 : d; };
    const full = d => { for (let j = d; j >= d - 3; j--) if (days.get(j)?.length > 2) return true; return false; };
    const any = d => { for (let j = d; j >= d - 3; j--) if (days.has(j)) return true; return false; };
    const latest = weekday(today), want = [];
    for (const d of [latest, latest - 7, latest - 30, latest - 365].map(weekday)) if (!full(d)) want.push(d);
    for (let d = latest - 1; d >= latest - 42; d--) if (weekday(d) === d && !any(d)) want.push(d);
    for (let k = 49; k <= SERIES_DAYS; k += 7) { const d = weekday(latest - k); if (!any(d)) want.push(d); }
    const todo = [...new Set(want)].slice(0, 30);
    let got = 0;
    for (let i = 0; i < todo.length; i += 10) {
      const url = `https://yield.chinabond.com.cn/cbweb-mn/yc/searchYc?xyzSelect=txy&&workTimes=${todo.slice(i, i + 10).map(isoDay).join(',')}&&dxbj=0&&qxll=0,&&yqqxN=N&&yqqxK=K&&ycDefIds=2c9081e50a2f9606010a3068cae70001,&&wrjxCBFlag=0&&locale=en_US`;
      try {
        const r = await fetchFn(url, { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (heat.sala.company)' }, signal: AbortSignal.timeout(40e3) });
        if (!r.ok) break;
        for (const [d, p] of parseChinaBond(await r.json())) { days.set(d, p); got++; }
      } catch { break; }                                  // slow or unreachable: keep what we have, ask again next run
    }
    if (todo.length) log?.(`Rates: ChinaBond ${got} of ${todo.length} dates fetched`);
    if (!days.size) throw new Error('ChinaBond did not answer');
    return days;
  },
  // India: one file per day, so its history is kept in rates.json and only new days are asked for (a few per run):
  // the latest, the last two weeks, the exact week / month / year-ago comparison days, and weekly points back a year
  async in(fetchFn, today, { prev, log } = {}) {
    const c = COUNTRIES.find(x => x.id === 'in'), days = daysFromSummary(c, prev);
    const weekday = d => { const w = new Date(d * DAY).getUTCDay(); return w === 6 ? d - 1 : w === 0 ? d - 2 : d; };
    const getDay = async d => {
      const r = await fetchFn(`https://www.fbil.org.in/wasdm/gsec/downloadPublished?date=${isoDay(d)}`, { headers: { 'user-agent': 'Mozilla/5.0 (heat.sala.company)' }, signal: AbortSignal.timeout(30e3) });
      if (!r.ok) return null;                              // no file that day (a holiday)
      try { return await parseFBIL(await r.arrayBuffer()); } catch { return null; }
    };
    const full = d => { for (let j = d; j >= d - 3; j--) if (days.get(j)?.length > 2) return true; return false; };
    const any = d => { for (let j = d; j >= d - 3; j--) if (days.has(j)) return true; return false; };
    const latest = weekday(today);                       // (today's file appears in the evening, India time: until then, the day before)
    const wantFull = [latest, latest - 7, latest - 30, latest - 365].map(weekday);
    const wantAny = [];
    for (let k = 1; k <= 14; k++) wantAny.push(weekday(latest - k));
    for (let k = 21; k <= 371; k += 7) wantAny.push(weekday(latest - k));
    const todo = [...new Set([...wantFull.filter(d => !full(d)), ...wantAny.filter(d => !any(d))])].slice(0, 14);
    let got = 0;
    for (const d of todo) {
      const r = await getDay(d) || await getDay(weekday(d - 1));
      if (r) { days.set(r.day, r.pts); got++; }
    }
    if (todo.length) log?.(`Rates: FBIL ${got}/${todo.length} daily files fetched`);
    if (!days.size) throw new Error('no FBIL file');
    return days;
  },
  async za(fetchFn, today, { from = today - SERIES_DAYS - 10 } = {}) {
    const start = isoDay(from), to = isoDay(today);
    const get = async list => Promise.all(list.map(async ([code, t]) => [t, await sarb(code, start, to, fetchFn)]));
    return mergeSARB(await get([['MMRD203A', 0.25], ['MMRD206A', 0.5], ['MMRD209A', 0.75], ['MMRD212A', 1]]), await get([['CMJD003A', 7.5], ['CMJD004A', 15]]));
  },
};

/* ---------- from curves by day to what the page shows ---------- */
// short leg of the slope: the 2-year (interpolated), the UK's Bank Rate (tenor 0) or South Africa's 3-month bill
const shortOf = (c, pts) => interp(pts, SHORT_T[c.short]);
export function slopeState(s) { return s == null ? null : s < 0 ? 'inverted' : s < FLAT_PP ? 'flat' : 'normal'; }

// the latest curve on or before day d (within 10 days)
// (a whole curve if there is one: India's history also holds days kept as just their 10-year and 2-year points)
function curveNear(days, d) {
  for (const full of [true, false])
    for (let k = d; k >= d - 10; k--) if (days.has(k) && (!full || days.get(k).length > 2)) return { date: isoDay(k), pts: days.get(k) };
  return null;
}
// back from a market's last summary to curves by day: its daily 10-year and short points, plus the whole curves it
// kept (today, a week, a month, a year ago). For a source fetched one day at a time, so nothing is asked twice.
export function daysFromSummary(c, s) {
  const days = new Map();
  if (!s?.series) return days;
  const d0 = Math.floor(s.series.t0 / DAY);
  s.series.d.forEach((o, i) => { const p = [[10, s.series.y10[i]]]; if (s.series.ys[i] != null) p.unshift([SHORT_T[c.short], s.series.ys[i]]); days.set(d0 + o, p); });
  for (const snap of [s.curve && { date: s.date, pts: s.curve }, ...Object.values(s.then || {})]) if (snap?.pts?.length > 2) days.set(dayNum(snap.date), snap.pts);
  return days;
}
// one point a week (each week's last day), from [[day, y10, ys]…] sorted by day
function weeklyOf(points) {
  const out = [];
  let wk = null;
  for (const p of points) { const w = Math.floor((p[0] + 3) / 7); if (w === wk) out[out.length - 1] = p; else { out.push(p); wk = w; } }
  return out;
}
// prevLong: the market's weekly history from the last run, extended with every day fetched now (once a week a fetch
// reaches back LONG_DAYS; in between only the recent days are fetched, so the history is carried over)
export function summarize(c, days, now, prevLong = null) {
  const today = Math.floor(now / DAY), all = [...days.keys()].sort((a, b) => a - b);
  const ds = all.filter(d => d >= today - SERIES_DAYS);
  if (!ds.length) return null;
  const last = ds[ds.length - 1], pts = days.get(last);
  const y10 = [], ys = [], d = [];
  for (const k of ds) {
    const p = days.get(k), a = interp(p, 10), b = shortOf(c, p);
    if (a == null) continue;
    d.push(k - ds[0]); y10.push(r4(a)); ys.push(b == null ? null : r4(b));
  }
  const ten = interp(pts, 10), sh = shortOf(c, pts), slope = ten != null && sh != null ? r4(ten - sh) : null;
  // the weekly history (up to ten years) and where today's slope sits in it: the share of weeks it was flatter
  const hist = new Map();
  if (prevLong?.d) { const d0 = Math.floor(prevLong.t0 / DAY); prevLong.d.forEach((o, i) => hist.set(d0 + o, [d0 + o, prevLong.y10[i], prevLong.ys[i]])); }
  for (const k of all) { const p = days.get(k), a = interp(p, 10), b = shortOf(c, p); if (a != null) hist.set(k, [k, r4(a), b == null ? null : r4(b)]); }
  const wk = weeklyOf([...hist.values()].filter(p => p[0] >= today - LONG_DAYS).sort((a, b) => a[0] - b[0]));
  const slopes = wk.filter(p => p[2] != null).map(p => p[1] - p[2]);
  const longYears = wk.length > 1 ? Math.round((wk.at(-1)[0] - wk[0][0]) / 365.25 * 10) / 10 : 0;
  const slopePct = slope != null && slopes.length >= 52 ? Math.round(slopes.filter(s => s < slope).length / slopes.length * 100) : null;
  // 10-year minus 3-month, where the curve starts at 3 months or sooner (the US Federal Reserve's favourite warning
  // sign); not the UK, whose short end here is the Bank Rate
  const y3m = c.short !== 'Bank Rate' && pts[0][0] > 0 && pts[0][0] <= 0.26 ? interp(pts, 0.25) : null;
  return {
    id: c.id, name: c.name, flag: c.flag, badge: c.badge, region: c.region, src: c.src, srcUrl: c.srcUrl, short: c.short, note: c.note || null, fetchedAt: now,
    date: isoDay(last), y10: ten == null ? null : r4(ten), yShort: sh == null ? null : r4(sh), slope, state: slopeState(slope),
    y3m: y3m == null ? null : r4(y3m), slope3m: y3m != null && ten != null ? r4(ten - y3m) : null, slopePct, longYears,
    curve: pts,
    then: { w1: curveNear(days, last - 7), m1: curveNear(days, last - 30), y1: curveNear(days, last - 365) },
    series: { t0: ds[0] * DAY, d, y10, ys },
    long: wk.length ? { t0: wk[0][0] * DAY, d: wk.map(p => p[0] - wk[0][0]), y10: wk.map(p => p[1]), ys: wk.map(p => p[2]) } : null,
  };
}
/* ---------- inflation: for the real yield (10-year minus the latest yearly inflation) ---------- */
// Official yearly consumer-price inflation, the latest month each source has:
//   Eurostat HICP (prc_hicp_minr, annual rate): the euro area and every European market here, plus Norway and Switzerland
//   OECD CPI: US, UK, Canada, Australia, Brazil, China, India (current; its figures for the others lag or stopped)
//   South African Reserve Bank: headline CPI · Statistics Bureau of Japan (e-Stat): the monthly index, its yearly change
// → { us: { v: 3.4, month: '2026-08', src: 'OECD' }, … } keyed like the markets (daily and monthly ids)
const EUROSTAT_GEO = { EA20: 'ea', DE: 'de', FR: 'fr', IT: 'it', ES: 'es', NL: 'nl', BE: 'be', AT: 'at', PT: 'pt', EL: 'gr', IE: 'ie', FI: 'fi', PL: 'pl', CZ: 'cz', HU: 'hu', RO: 'ro', DK: 'dk', SE: 'se', NO: 'no', CH: 'ch' };
const OECD_AREA = { USA: 'us', GBR: 'uk', CAN: 'ca', AUS: 'au', BRA: 'br', CHN: 'cn', IND: 'in' };
// JSON-stat (Eurostat): values indexed geo-major over time → the latest month with a value, per geo
export function parseEurostat(json) {
  const geo = json?.dimension?.geo?.category?.index || {}, time = json?.dimension?.time?.category?.index || {}, v = json?.value || {};
  const months = Object.entries(time).sort((a, b) => a[1] - b[1]).map(([m]) => m), nT = months.length, out = {};
  for (const [g, gi] of Object.entries(geo)) {
    for (let t = nT - 1; t >= 0; t--) {
      const x = v[gi * nT + t];
      if (x != null && EUROSTAT_GEO[g]) { out[EUROSTAT_GEO[g]] = { v: +x, month: months[t], src: 'Eurostat' }; break; }
    }
  }
  return out;
}
export function parseOECD(text) {
  const [head, ...rows] = csvRows(text), iA = head.indexOf('REF_AREA'), iT = head.indexOf('TIME_PERIOD'), iV = head.indexOf('OBS_VALUE'), out = {};
  for (const r of rows) {
    const id = OECD_AREA[r[iA]];
    if (id && r[iV] !== '' && (!out[id] || r[iT] > out[id].month)) out[id] = { v: r4(+r[iV]), month: r[iT], src: 'OECD' };
  }
  return out;
}
// e-Stat's CPI file: rows "YYYYMM,all items,…" (index levels) → the yearly change of the latest month
export function parseJapanCPI(text) {
  const rows = String(text).split(/\r?\n/).map(l => l.split(',')).filter(r => /^\d{6}$/.test(r[0]) && +r[1] > 0);
  const last = rows.at(-1), yearAgo = last && rows.find(r => r[0] === String(+last[0] - 100));
  if (!last || !yearAgo) return null;
  return { v: r4((+last[1] / +yearAgo[1] - 1) * 100), month: `${last[0].slice(0, 4)}-${last[0].slice(4)}`, src: 'Statistics Bureau of Japan' };
}
export async function fetchInflation(fetchFn, today) {
  const out = {}, since = isoDay(today - 200).slice(0, 7), jobs = [
    async () => {
      const geos = Object.keys(EUROSTAT_GEO).map(g => `&geo=${g}`).join('');
      Object.assign(out, parseEurostat(JSON.parse(await getText(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?format=JSON&coicop18=TOTAL&unit=RCH_A&sinceTimePeriod=${since}${geos}`, fetchFn))));
    },
    async () => {                         // (the OECD's service often answers 500 to shared cloud servers: three tries)
      const url = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/${Object.keys(OECD_AREA).join('+')}.M.N.CPI.PA._T.N.GY?lastNObservations=1&format=csvfile`;
      let text;
      for (let k = 0; k < 3 && text == null; k++) {
        try { text = await getText(url, fetchFn, { timeout: 60e3 }); } catch (e) { if (k === 2) throw e; await sleep(8000 * (k + 1)); }
      }
      Object.assign(out, parseOECD(text));
    },
    async () => {
      const list = await sarb('CPI1000F', isoDay(today - 200), isoDay(today), fetchFn), last = list?.[0];
      if (last?.Value != null) out.za = { v: r4(+last.Value), month: String(last.Period).slice(0, 7), src: 'South African Reserve Bank' };
    },
    async () => { const j = parseJapanCPI(await getText('https://www.e-stat.go.jp/stat-search/file-download?statInfId=000032103842&fileKind=1', fetchFn)); if (j) out.jp = j; },
  ];
  const failed = [];
  await Promise.all(jobs.map((job, i) => job().catch(e => failed.push(['Eurostat', 'OECD', 'SARB', 'e-Stat'][i] + ': ' + e.message))));
  return { inflation: out, failed };
}

/* ---------- Europe, monthly: the ECB's 10-year yield per EU country (no free daily source for these) ---------- */
// The monthly average of each country's benchmark 10-year government bond yield (the EU "convergence" rate), published
// early the next month. Germany is fetched too, for the spread every euro bond is measured against.
export const EU_MONTHLY = [
  ['FR', 'France', '🇫🇷'], ['IT', 'Italy', '🇮🇹'], ['ES', 'Spain', '🇪🇸'], ['NL', 'Netherlands', '🇳🇱'], ['BE', 'Belgium', '🇧🇪'],
  ['AT', 'Austria', '🇦🇹'], ['PT', 'Portugal', '🇵🇹'], ['GR', 'Greece', '🇬🇷'], ['IE', 'Ireland', '🇮🇪'], ['FI', 'Finland', '🇫🇮'],
  ['PL', 'Poland', '🇵🇱'], ['CZ', 'Czechia', '🇨🇿'], ['HU', 'Hungary', '🇭🇺'], ['RO', 'Romania', '🇷🇴'], ['DK', 'Denmark', '🇩🇰'],
].map(([code, name, flag]) => ({ id: code.toLowerCase(), code, name, flag, badge: code }));
const EURO = new Set(['FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'GR', 'IE', 'FI']);
const monthBack = (ym, k) => { const [y, m] = ym.split('-').map(Number), t = y * 12 + m - 1 - k; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
export function summarizeMonthly(by) {
  const de = new Map(by.DE || []);
  return EU_MONTHLY.map(c => {
    const s = by[c.code];
    if (!s?.length) return null;
    const [month, y10] = s.at(-1), at = new Map(s), was = k => at.get(monthBack(month, k));
    const bp = v => v == null ? null : Math.round((y10 - v) * 100);
    return {
      id: c.id, name: c.name, flag: c.flag, badge: c.badge, euro: EURO.has(c.code), month, y10,
      chg1m: bp(was(1)), chg12m: bp(was(12)), vsDE: EURO.has(c.code) && de.has(month) ? r4(y10 - de.get(month)) : null,
      series: s.slice(-25), de: EURO.has(c.code) ? [...de].filter(([m]) => m >= s.slice(-25)[0][0]) : null,
    };
  }).filter(Boolean);
}
async function fetchMonthly(fetchFn, today) {
  const from = isoDay(today - 800).slice(0, 7), areas = [...EU_MONTHLY.map(c => c.code), 'DE'].join('+');
  return summarizeMonthly(parseIRS(await getText(`https://data-api.ecb.europa.eu/service/data/IRS/M.${areas}.L.L40.CI.0000..N.Z?startPeriod=${from}&format=csvdata&detail=dataonly`, fetchFn, { timeout: 60e3 })));
}

export async function build({ prev = null, log = console.log, now = Date.now(), fetchFn = fetch, force = false } = {}) {
  const same = prev?.market === 'rates' && prev?.fmt === FMT;
  const ids = COUNTRIES.map(c => c.id).join(',');           // a market added or removed: fetch now, don't wait for REFETCH
  if (same && !force && prev.ids === ids && prev.layout === LAYOUT && now - (prev.fetched || 0) < REFETCH) return { ...prev, generated: now };
  const today = Math.floor(now / DAY), out = [], failed = [];
  const prevOf = id => same ? prev.countries.find(c => c.id === id) : null;
  // every market at once (each source is a different server); the list keeps COUNTRIES' order
  const results = await Promise.all(COUNTRIES.map(async c => {
    const p = prevOf(c.id);
    if (p && !p.notRefreshed && p.long && c.every && now - (p.fetchedAt || 0) < c.every * 36e5) return p;   // a big file, fetched less often
    // once a week (or the first time) the fetch reaches back ten years for the weekly history; in between, two years
    const longDue = !p?.long || !p.longAt || now - p.longAt >= LONG_EVERY;
    try {
      const s = summarize(c, await FETCH[c.id](fetchFn, today, { prev: p, log, ...(longDue ? { from: today - LONG_DAYS - 10 } : {}) }), now, p?.long);
      if (!s) throw new Error('no data');
      s.longAt = longDue ? now : p.longAt;
      return s;
    } catch (e) {
      failed.push(`${c.id} (${e.message})`);
      return p ? { ...p, notRefreshed: true, failedSince: p.failedSince || now } : null;   // keep the last good curve; note since when it fails
    }
  }));
  out.push(...results.filter(Boolean));
  let monthly = same ? (prev.monthly || []) : [];
  try { monthly = await fetchMonthly(fetchFn, today); }
  catch (e) { failed.push(`EU monthly (${e.message})`); monthly = monthly.map(m => ({ ...m, notRefreshed: true, failedSince: m.failedSince || now })); }
  // inflation for the real yields (a source that fails keeps each market's last figure)
  const { inflation, failed: inflFailed } = await fetchInflation(fetchFn, today);
  failed.push(...inflFailed.map(f => `inflation ${f}`));
  // a source that fails keeps each market's figure from the last file (inflation changes once a month)
  const lastInfl = id => same ? [...(prev.countries || []), ...(prev.monthly || [])].find(p => p.id === id)?.infl : null;
  const withReal = x => { const i = inflation[x.id] || x.infl || lastInfl(x.id) || null; return { ...x, infl: i, real: i && x.y10 != null ? r4(x.y10 - i.v) : null }; };
  out.splice(0, out.length, ...out.map(withReal));
  monthly = monthly.map(withReal);
  if (!out.length) throw new Error('no yield curve source answered');
  log(`Rates: ${out.map(c => `${c.id} ${c.date} 10y ${c.y10?.toFixed(2)}% slope ${c.slope > 0 ? '+' : ''}${c.slope?.toFixed(2)} (${c.state})`).join(' · ')} · monthly: ${monthly.length} EU countries to ${monthly[0]?.month ?? '—'}${failed.length ? ` · failed: ${failed.join(', ')}` : ''}`);
  return { v: 1, fmt: FMT, layout: LAYOUT, market: 'rates', generated: now, fetched: now, flatPP: FLAT_PP, ids, countries: out, monthly };
}

/* ---------- CLI (Node only) ---------- */
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
if (IS_NODE && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { writeFile } = await import('node:fs/promises');
  const [out = 'rates.json'] = process.argv.slice(2);
  let prev = null;
  if (process.env.PREV_URL) {
    try { prev = await (await fetch(process.env.PREV_URL + '?b=' + Date.now(), { signal: AbortSignal.timeout(20e3) })).json(); }
    catch { console.log('No previous rates.json (first run?)'); }
  }
  const data = await build({ prev });
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}
