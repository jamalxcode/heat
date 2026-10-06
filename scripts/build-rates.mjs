// Builds rates.json for heat.sala.company/rates/: government bond yield curves, from official sources only, once a day.
// Runs in the deploy job (every 10 minutes) but refetches only every REFETCH: the sources publish once a business day.
//   node scripts/build-rates.mjs <out.json>        (env PREV_URL = the last published rates.json)
// Sources (all official and free; each publishes after its market closes, some a few days late):
//   US         US Treasury daily par yield curve (1 month … 30 years), one CSV per year
//   Euro area  ECB yield curve of AAA-rated euro area government bonds (3 months … 30 years)
//   UK         Bank of England: Bank Rate plus the 5, 10 and 20-year nominal par gilt yields (the free daily series)
//   Japan      Ministry of Finance JGB yields (1 … 40 years): the full history file plus this month's file
//   Canada     Bank of Canada benchmark bond yields (2 … 30 years)
// Not included: the Gulf states publish auction results, not a daily curve; China and India have no free official feed;
// Morocco's Bank Al-Maghrib publishes a daily curve, but its website refuses requests from cloud servers like GitHub's.
// Health: the curve's slope, 10-year minus 2-year (UK: minus Bank Rate). Long rates normally sit above short ones; an
// inverted curve (short above long) has come before most US recessions. ≥ 0.5 pp normal, 0 to 0.5 flat, < 0 inverted.
import { isoDay, dayNum, DAY } from './build-forex.mjs';

const REFETCH = 3 * 36e5;               // every 3 hours
const SERIES_DAYS = 760;                // ~2 years of daily 10-year and short yields, for the changes and the slope history
const FMT = 1;
export const FLAT_PP = 0.5;

export const COUNTRIES = [
  { id: 'us', name: 'United States', flag: '🇺🇸', badge: 'US', src: 'US Treasury', srcUrl: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates', short: '2y' },
  { id: 'ea', name: 'Euro area', flag: '🇪🇺', badge: 'EU', src: 'European Central Bank (AAA-rated government bonds)', srcUrl: 'https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_area_yield_curves/html/index.en.html', short: '2y' },
  { id: 'uk', name: 'United Kingdom', flag: '🇬🇧', badge: 'GB', src: 'Bank of England', srcUrl: 'https://www.bankofengland.co.uk/boeapps/database/', short: 'Bank Rate' },
  { id: 'jp', name: 'Japan', flag: '🇯🇵', badge: 'JP', src: 'Ministry of Finance Japan', srcUrl: 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm', short: '2y' },
  { id: 'ca', name: 'Canada', flag: '🇨🇦', badge: 'CA', src: 'Bank of Canada', srcUrl: 'https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/', short: '2y' },
];

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

/* ---------- fetchers ---------- */
const FETCH = {
  async us(fetchFn, today) {
    const y = new Date(today * DAY).getUTCFullYear(), out = new Map();
    for (const yr of [y - 2, y - 1, y]) {
      const t = await getText(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`, fetchFn);
      for (const [d, p] of parseUS(t)) out.set(d, p);
    }
    return out;
  },
  async ea(fetchFn, today) {
    const keys = ['3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '15Y', '20Y', '30Y'].map(k => 'SR_' + k).join('+');
    return parseECB(await getText(`https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.${keys}?startPeriod=${isoDay(today - SERIES_DAYS - 10)}&format=csvdata&detail=dataonly`, fetchFn, { timeout: 60e3 }));
  },
  async uk(fetchFn, today) {
    const from = new Date((today - SERIES_DAYS - 10) * DAY).toUTCString().slice(5, 16).replace(/ /g, '/');   // 01/Sep/2024
    return parseBoE(await getText(`https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${from}&Dateto=now&SeriesCodes=${Object.keys(BOE).join(',')}&CSVF=TN&UsingCodes=Y`, fetchFn));
  },
  async jp(fetchFn) {
    const base = 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/';
    const out = parseMOF(await getText(base + 'historical/jgbcme_all.csv', fetchFn, { timeout: 90e3 }));
    try { for (const [d, p] of parseMOF(await getText(base + 'jgbcme.csv', fetchFn))) out.set(d, p); } catch { /* this month's file is a bonus */ }
    return out;
  },
  async ca(fetchFn, today) {
    return parseBoC(JSON.parse(await getText(`https://www.bankofcanada.ca/valet/observations/group/bond_yields_benchmark/json?start_date=${isoDay(today - SERIES_DAYS - 10)}`, fetchFn)));
  },
};

/* ---------- from curves by day to what the page shows ---------- */
// short leg of the slope: the 2-year (interpolated), or the UK's Bank Rate (tenor 0)
const shortOf = (c, pts) => c.short === 'Bank Rate' ? interp(pts, 0) : interp(pts, 2);
export function slopeState(s) { return s == null ? null : s < 0 ? 'inverted' : s < FLAT_PP ? 'flat' : 'normal'; }

// the latest curve on or before day d (within 10 days)
function curveNear(days, d) {
  for (let k = d; k >= d - 10; k--) if (days.has(k)) return { date: isoDay(k), pts: days.get(k) };
  return null;
}
export function summarize(c, days, now) {
  const ds = [...days.keys()].sort((a, b) => a - b).filter(d => d >= Math.floor(now / DAY) - SERIES_DAYS);
  if (!ds.length) return null;
  const last = ds[ds.length - 1], pts = days.get(last);
  const y10 = [], ys = [], d = [];
  for (const k of ds) {
    const p = days.get(k), a = interp(p, 10), b = shortOf(c, p);
    if (a == null) continue;
    d.push(k - ds[0]); y10.push(r4(a)); ys.push(b == null ? null : r4(b));
  }
  const ten = interp(pts, 10), sh = shortOf(c, pts), slope = ten != null && sh != null ? r4(ten - sh) : null;
  return {
    id: c.id, name: c.name, flag: c.flag, badge: c.badge, src: c.src, srcUrl: c.srcUrl, short: c.short,
    date: isoDay(last), y10: ten == null ? null : r4(ten), yShort: sh == null ? null : r4(sh), slope, state: slopeState(slope),
    curve: pts,
    then: { w1: curveNear(days, last - 7), m1: curveNear(days, last - 30), y1: curveNear(days, last - 365) },
    series: { t0: ds[0] * DAY, d, y10, ys },
  };
}
export async function build({ prev = null, log = console.log, now = Date.now(), fetchFn = fetch, force = false } = {}) {
  const same = prev?.market === 'rates' && prev?.fmt === FMT;
  if (same && !force && now - (prev.fetched || 0) < REFETCH) return { ...prev, generated: now };
  const today = Math.floor(now / DAY), out = [], failed = [];
  const prevOf = id => same ? prev.countries.find(c => c.id === id) : null;
  for (const c of COUNTRIES) {
    try {
      const days = await FETCH[c.id](fetchFn, today);
      const s = summarize(c, days, now);
      if (!s) throw new Error('no data');
      out.push(s);
    } catch (e) {
      failed.push(`${c.id} (${e.message})`);
      const p = prevOf(c.id);
      if (p) out.push({ ...p, notRefreshed: true });           // keep the last good curve
    }
  }
  if (!out.length) throw new Error('no yield curve source answered');
  log(`Rates: ${out.map(c => `${c.id} ${c.date} 10y ${c.y10?.toFixed(2)}% slope ${c.slope > 0 ? '+' : ''}${c.slope?.toFixed(2)} (${c.state})`).join(' · ')}${failed.length ? ` · failed: ${failed.join(', ')}` : ''}`);
  return { v: 1, fmt: FMT, market: 'rates', generated: now, fetched: now, flatPP: FLAT_PP, countries: out };
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
