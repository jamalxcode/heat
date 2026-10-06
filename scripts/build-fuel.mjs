// Builds fuel.json for the Energy page's two weekly rows: pump prices by country, and US refined-product spot prices.
// Runs in the deploy job, refetching every REFETCH (the sources change once a week, or once a day a week late).
//   node scripts/build-fuel.mjs <out.json> <forex.json>     (env PREV_URL = the last published fuel.json)
// Sources (official, free):
//   - EU Weekly Oil Bulletin (European Commission): petrol (Euro-super 95) and diesel pump prices with taxes in all 27
//     EU countries, in euros per 1,000 litres, for the Monday of each week (published a few days later)
//   - UK: the government's weekly road fuel prices (DESNZ), pence per litre, petrol (ULSP) and diesel (ULSD)
//   - US: the Energy Information Administration's weekly retail prices (via FRED), dollars per gallon, regular petrol and
//     diesel; and its daily spot prices of refined products (via FRED): about a week behind
// Every price is also shown in US dollars per litre, converted at the latest rate on the Forex page, so countries compare.
// The weekly change comes from the source's own history (UK, US) or builds up week by week from the last file (EU).
import { unzipEntries } from './build-rates.mjs';

const DAY = 864e5, REFETCH = 6 * 36e5, FMT = 1, GALLON = 3.785411784, KEEP = 12;
const isoDay = d => new Date(d * DAY).toISOString().slice(0, 10);
const r4 = v => Math.round(v * 1e4) / 1e4;

export const EU = {
  Austria: ['at', '🇦🇹'], Belgium: ['be', '🇧🇪'], Bulgaria: ['bg', '🇧🇬'], Croatia: ['hr', '🇭🇷'], Cyprus: ['cy', '🇨🇾'], Czechia: ['cz', '🇨🇿'],
  Denmark: ['dk', '🇩🇰'], Estonia: ['ee', '🇪🇪'], Finland: ['fi', '🇫🇮'], France: ['fr', '🇫🇷'], Germany: ['de', '🇩🇪'], Greece: ['gr', '🇬🇷'],
  Hungary: ['hu', '🇭🇺'], Ireland: ['ie', '🇮🇪'], Italy: ['it', '🇮🇹'], Latvia: ['lv', '🇱🇻'], Lithuania: ['lt', '🇱🇹'], Luxembourg: ['lu', '🇱🇺'],
  Malta: ['mt', '🇲🇹'], Netherlands: ['nl', '🇳🇱'], Poland: ['pl', '🇵🇱'], Portugal: ['pt', '🇵🇹'], Romania: ['ro', '🇷🇴'], Slovakia: ['sk', '🇸🇰'],
  Slovenia: ['si', '🇸🇮'], Spain: ['es', '🇪🇸'], Sweden: ['se', '🇸🇪'],
};
// US refined-product spot prices (EIA, daily, dollars per gallon)
export const SPOT = [
  ['DDFUELNYH', 'Diesel (ULSD)', 'New York Harbor'], ['DDFUELUSGULF', 'Diesel (ULSD)', 'US Gulf Coast'], ['DDFUELLA', 'Diesel (ULSD)', 'Los Angeles'],
  ['DJFUELUSGULF', 'Jet fuel', 'US Gulf Coast'], ['DGASNYH', 'Gasoline (conventional)', 'New York Harbor'], ['DGASUSGULF', 'Gasoline (conventional)', 'US Gulf Coast'],
  ['DHOILNYH', 'Heating oil', 'New York Harbor'], ['DPROPANEMBTX', 'Propane', 'Mont Belvieu, Texas'],
];

async function getText(url, fetchFn, ms = 60e3) {
  const r = await fetchFn(url, { headers: { 'user-agent': 'Mozilla/5.0 (heat.sala.company)' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url.split('?')[0]}`);
  return r;
}
// FRED csv: observation_date,SERIES → [[day, value]…] (dots for missing are skipped)
export function parseFred(text) {
  return String(text).trim().split(/\r?\n/).slice(1).map(l => l.split(',')).filter(([, v]) => v && v !== '.')
    .map(([d, v]) => [Math.floor(Date.parse(d + 'T00:00:00Z') / DAY), +v]).filter(([d, v]) => Number.isFinite(d) && v > 0);
}
// the EU bulletin's sheet: a date (Excel serial) in A2, then one row per country: name | Euro-super 95 | diesel | …
export async function parseBulletin(buf) {
  const f = await unzipEntries(buf, n => n === 'xl/sharedStrings.xml' || n === 'xl/worksheets/sheet1.xml');
  const strings = (f['xl/sharedStrings.xml'] || '').split('<si>').slice(1).map(s => s.replace(/<[^>]*>/g, '').trim());
  const cells = row => Object.fromEntries([...row.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<f>[^<]*<\/f>)?<v>([^<]*)<\/v>/g)].map(([, col, attrs, v]) => [col, /t="s"/.test(attrs) ? strings[+v] : +v]));
  let day = null;
  const out = {};
  for (const row of (f['xl/worksheets/sheet1.xml'] || '').split('<row').slice(1)) {
    const c = cells(row);
    if (day == null && typeof c.A === 'number' && c.A > 40000) { day = Math.round(c.A) - 25569; continue; }   // Excel serial → day number
    const eu = typeof c.A === 'string' && EU[c.A];
    if (eu && c.B > 0 && c.C > 0) out[eu[0]] = { name: c.A, flag: eu[1], petrol: c.B / 1000, diesel: c.C / 1000 };
  }
  return day == null ? null : { day, prices: out };
}
// the UK government's weekly CSV: Date (DD/MM/YYYY), ULSP pence/litre, ULSD pence/litre, …
export function parseUK(text) {
  return String(text).replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map(l => l.split(',')).map(([d, p, dz]) => {
    const [dd, mm, yy] = String(d).split('/');
    return [Math.floor(Date.parse(`${yy}-${mm}-${dd}T00:00:00Z`) / DAY), +p / 100, +dz / 100];
  }).filter(([d, p, dz]) => Number.isFinite(d) && p > 0 && dz > 0);
}
// USD per unit of each currency, from forex.json (its pairs are USD/XXX: XXX per dollar)
export function fxFrom(forex) {
  const per = code => forex?.markets?.find(m => m.symbol === `USD/${code}`)?.current_price;
  const eur = per('EUR'), gbp = per('GBP');
  return { EUR: eur ? 1 / eur : null, GBP: gbp ? 1 / gbp : null, USD: 1 };
}
const pct = (now, was) => now > 0 && was > 0 ? r4((now / was - 1) * 100) : null;
// one country's row: local prices per litre, US dollars per litre, change on the week (from its history)
function row(id, name, flag, region, cur, unit, src, srcUrl, hist, fx) {
  const last = hist.at(-1), prev = hist.at(-2);
  const usd = v => fx[cur] && v > 0 ? r4(v * fx[cur]) : null;
  return {
    id, name, flag, badge: id.toUpperCase(), region, cur, unit, src, srcUrl, date: isoDay(last[0]),
    petrol: { local: r4(last[1]), usdL: usd(last[1]), chg: prev ? pct(last[1], prev[1]) : null },
    diesel: { local: r4(last[2]), usdL: usd(last[2]), chg: prev ? pct(last[2], prev[2]) : null },
    hist: hist.slice(-KEEP),
  };
}

export async function build({ prev = null, forex = null, log = console.log, now = Date.now(), fetchFn = fetch, force = false } = {}) {
  const same = prev?.v === 1 && prev?.fmt === FMT;
  if (same && !force && now - (prev.fetched || 0) < REFETCH) return { ...prev, generated: now };
  const fx = fxFrom(forex), today = Math.floor(now / DAY), failed = [], pump = [], prevPump = id => same ? prev.pump.find(p => p.id === id) : null;
  const keepOld = id => { const p = prevPump(id); if (p) pump.push({ ...p, notRefreshed: true }); };
  // EU: the latest bulletin; its history builds up from the last file's
  try {
    const page = 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en';
    const b = await parseBulletin(await (await getText('https://energy.ec.europa.eu/document/download/264c2d0f-f161-4ea3-a777-78faae59bea0_en', fetchFn)).arrayBuffer());
    if (!b || Object.keys(b.prices).length < 20) throw new Error('bulletin unreadable');
    for (const [id, p] of Object.entries(b.prices)) {
      const hist = (prevPump(id)?.hist || []).filter(h => h[0] < b.day);
      hist.push([b.day, p.petrol, p.diesel]);
      pump.push(row(id, p.name, p.flag, 'Europe', 'EUR', 'litre', 'EU Weekly Oil Bulletin', page, hist, fx));
    }
  } catch (e) { failed.push(`EU (${e.message})`); for (const id of Object.values(EU).map(x => x[0])) keepOld(id); }
  // UK: the government's weekly CSV (its address changes with each week's file: read it from the page)
  try {
    const page = 'https://www.gov.uk/government/statistics/weekly-road-fuel-prices';
    const html = await (await getText(page, fetchFn)).text();
    const csv = html.match(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"']+?\.csv/i)?.[0];
    if (!csv) throw new Error('no CSV link on the page');
    const rows = parseUK(await (await getText(csv, fetchFn)).text());
    if (!rows.length) throw new Error('empty CSV');
    pump.push(row('uk', 'United Kingdom', '🇬🇧', 'Europe', 'GBP', 'litre', 'UK government (DESNZ), weekly road fuel prices', page, rows.slice(-KEEP), fx));
  } catch (e) { failed.push(`UK (${e.message})`); keepOld('uk'); }
  // US: weekly retail, dollars per gallon → per litre
  try {
    const [p, d] = await Promise.all(['GASREGW', 'GASDESW'].map(async id => parseFred(await (await getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${isoDay(today - 200)}`, fetchFn)).text())));
    const dz = new Map(d), rows = p.filter(([day]) => dz.has(day)).map(([day, v]) => [day, v / GALLON, dz.get(day) / GALLON]);
    if (!rows.length) throw new Error('no weekly prices');
    pump.push(row('us', 'United States', '🇺🇸', 'Americas', 'USD', 'litre', 'US Energy Information Administration (weekly retail, via FRED)', 'https://www.eia.gov/petroleum/gasdiesel/', rows.slice(-KEEP), fx));
  } catch (e) { failed.push(`US pump (${e.message})`); keepOld('us'); }
  // US refined products: daily spot, about a week behind
  const spot = (await Promise.all(SPOT.map(async ([id, name, where]) => {
    try {
      const s = parseFred(await (await getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${isoDay(today - 120)}`, fetchFn)).text());
      if (!s.length) throw new Error('empty');
      const [d, v] = s.at(-1), wk = [...s].reverse().find(([x]) => x <= d - 7), mo = [...s].reverse().find(([x]) => x <= d - 30);
      return { id, name, where, usdGal: r4(v), date: isoDay(d), chg1w: wk ? pct(v, wk[1]) : null, chg1m: mo ? pct(v, mo[1]) : null, series: s.slice(-90).map(([x, y]) => [isoDay(x), r4(y)]) };
    } catch (e) {
      failed.push(`${id} (${e.message})`);
      const p = same ? prev.spot.find(x => x.id === id) : null;
      return p ? { ...p, notRefreshed: true } : null;
    }
  }))).filter(Boolean);
  if (!pump.length && !spot.length) throw new Error('no fuel source answered');
  log(`Fuel: ${pump.length} countries' pump prices (EU to ${pump.find(p => p.region === 'Europe' && p.id !== 'uk')?.date ?? '—'}, UK ${pump.find(p => p.id === 'uk')?.date ?? '—'}, US ${pump.find(p => p.id === 'us')?.date ?? '—'}) · ${spot.length} US spot prices to ${spot[0]?.date ?? '—'}${failed.length ? ` · failed: ${failed.join(', ')}` : ''}`);
  return { v: 1, fmt: FMT, generated: now, fetched: now, fx, pump, spot };
}

/* ---------- CLI (Node only) ---------- */
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
if (IS_NODE && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const [out = 'fuel.json', forexFile = 'forex.json'] = process.argv.slice(2);
  let prev = null, forex = null;
  if (process.env.PREV_URL) {
    try { prev = await (await fetch(process.env.PREV_URL + '?b=' + Date.now(), { signal: AbortSignal.timeout(20e3) })).json(); }
    catch { console.log('No previous fuel.json (first run?)'); }
  }
  try { forex = JSON.parse(await readFile(forexFile, 'utf8')); } catch { console.log(`No ${forexFile}: no conversion to US dollars`); }
  const data = await build({ prev, forex });
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}
