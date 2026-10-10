// Builds energy.json for heat.sala.company/energy/: crude oil, refined products and natural gas, from the front-month
// futures contracts (the prices the market quotes). Runs in the deploy job right after data.json (every 10 minutes).
//   node scripts/build-energy.mjs <out.json> <data.json>      (env PREV_URL = the last published energy.json)
// Source: Yahoo Finance's public chart data (unofficial, no key). The exchanges delay futures quotes by about
// 10 minutes, so with the 10-minute update a price here is at most about 20–30 minutes old while markets are open.
//   - Only prices that fresh are shown. Benchmarks with no free current price (Russian Urals, Dubai/Oman, Murban,
//     Canadian WCS, Asian LNG/JKM, European diesel) are left out rather than shown days or months late.
//   - "Front month" = the contract closest to expiry, rolled into the next one each month, so a chart can show a small
//     step on the roll day (bigger for natural gas). That is how every free continuous oil chart works.
//   - Futures trade on weekdays (Sunday evening to Friday afternoon, US time): one close per trading day, so the
//     changes are 1 trading day, 1 week (5) and 1 month (21), like forex. No trading, no candle: nothing is carried
//     forward over weekends.
//   - Yahoo's full history is fetched hourly; in between, only the last few days (one small request per contract).
//     If Yahoo fails, the last good energy.json is republished (see the deploy job).
// build() has no Node dependencies, so tests can run it with a fake fetch.
import { pool, isoDay, DAY } from './build-forex.mjs';

const HISTORY_DAYS = 760;               // calendar days kept (~2 years): indicators need 260 trading days
const REFETCH = 60 * 60e3;              // the full history, hourly
const FMT = 1;

export const ENERGY = [
  { id: 'wti', yahoo: 'CL=F', symbol: 'WTI', name: 'WTI crude oil', badge: 'WTI', unit: 'US dollars per barrel', where: 'US benchmark (Cushing, Oklahoma), NYMEX' },
  { id: 'brent', yahoo: 'BZ=F', symbol: 'BRENT', name: 'Brent crude oil', badge: 'BRT', unit: 'US dollars per barrel', where: 'world benchmark (North Sea), ICE / NYMEX' },
  { id: 'diesel', yahoo: 'HO=F', symbol: 'ULSD', name: 'Diesel (NY Harbor)', badge: 'DSL', unit: 'US dollars per gallon', where: 'ultra-low-sulphur diesel, New York Harbor, NYMEX (the contract once called heating oil)' },
  { id: 'gasoline', yahoo: 'RB=F', symbol: 'RBOB', name: 'Gasoline (NY Harbor)', badge: 'GAS', unit: 'US dollars per gallon', where: 'RBOB gasoline, New York Harbor, NYMEX' },
  { id: 'natgas', yahoo: 'NG=F', symbol: 'NG', name: 'US natural gas (Henry Hub)', badge: 'NG', unit: 'US dollars per MMBtu', where: 'US benchmark (Henry Hub, Louisiana), NYMEX' },
  { id: 'ttf', yahoo: 'TTF=F', symbol: 'TTF', name: 'European natural gas (TTF)', badge: 'TTF', unit: 'euros per MWh', where: 'European benchmark (Dutch TTF hub, where much of Europe’s LNG is priced), ICE Endex' },
];

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const chartUrl = (host, sym, range) => `${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d&includePrePost=false`;

// Yahoo's chart answer → { days: Map(trading day → close), vols: Map(trading day → volume), price, t (ms of the
// latest quote), name, exch }, or null. Each daily candle's time is midnight (futures) or the opening bell (stocks) at
// the exchange, so its local date (time + the exchange's UTC offset) is the trading day. Days without a close
// (holidays, the odd gap) are skipped; a repeated day keeps its last value.
export function parseChart(j) {
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp, q = r?.indicators?.quote?.[0], cl = q?.close, vo = q?.volume;
  if (!Array.isArray(ts) || !Array.isArray(cl)) return null;
  const off = (r.meta?.gmtoffset || 0) * 1000, days = new Map(), vols = new Map();
  ts.forEach((t, i) => {
    if (!(cl[i] > 0)) return;
    const d = Math.floor((t * 1000 + off) / DAY);
    days.set(d, +cl[i].toPrecision(6));
    if (vo?.[i] > 0) vols.set(d, vo[i]);
  });
  const price = r.meta?.regularMarketPrice, at = r.meta?.regularMarketTime;
  if (price > 0 && at > 0) days.set(Math.floor((at * 1000 + off) / DAY), +price.toPrecision(6));   // the latest quote is today's close so far
  if (!days.size) return null;
  return { days, vols, price: price > 0 ? +price.toPrecision(6) : [...days.values()].at(-1), t: at > 0 ? at * 1000 : null, name: r.meta?.longName || null, exch: r.meta?.exchangeName || null };
}

export async function fetchChart(sym, range, fetchFn = fetch) {
  for (const host of HOSTS) {
    try {
      const r = await fetchFn(chartUrl(host, sym, range), { headers: { 'user-agent': 'Mozilla/5.0 (heat.sala.company)', accept: 'application/json' }, signal: AbortSignal.timeout(15e3) });
      if (!r.ok) continue;
      const p = parseChart(await r.json());
      if (p) return p;
    } catch { /* try the other host */ }
  }
  return null;
}

// change over k trading days, in %
const chg = (c, k) => c.length > k ? (c[c.length - 1] / c[c.length - 1 - k] - 1) * 100 : null;

// days: Map(day number → close) → the hist entry the page reads: t0 + d (day offsets, trading days only) + c
export function toHist(days, a, fetched) {
  const ds = [...days.keys()].sort((x, y) => x - y);
  if (!ds.length) return null;
  return { src: 'Yahoo Finance', pair: a.yahoo, ok: 1, t: fetched, t0: ds[0] * DAY, d: ds.map(d => d - ds[0]), c: ds.map(d => days.get(d)) };
}

// the closes by day, recovered from a previous energy.json of the same format
function daysFromPrev(prev, id) {
  const h = prev?.hist?.[id];
  if (!h?.c || !h.d) return new Map();
  const d0 = Math.floor(h.t0 / DAY);
  return new Map(h.c.map((v, i) => [d0 + h.d[i], v]));
}

export function toSnapshot(series, crypto, { now = Date.now(), fetched = now, quotes = {} } = {}) {
  const markets = [], hist = {};
  ENERGY.forEach((a, k) => {
    const h = series[a.id];
    if (!h) return;
    const q = quotes[a.id];
    markets.push({
      id: a.id, symbol: a.symbol, name: a.name, badge: a.badge, image: '', market_cap_rank: k + 1,
      current_price: q?.price ?? h.c.at(-1), market_cap: null, src: 'yahoo', unit: a.unit, where: a.where, quoteAt: q?.t ?? null,
      price_change_percentage_24h_in_currency: chg(h.c, 1),
      price_change_percentage_7d_in_currency: chg(h.c, 5),
      price_change_percentage_30d_in_currency: chg(h.c, 21),
    });
    hist[a.id] = h;
  });
  const at = Math.max(0, ...Object.values(quotes).map(q => q.t || 0));
  const last = Math.max(0, ...Object.values(series).map(h => h.t0 / DAY + h.d.at(-1)));
  return {
    v: 1, fmt: FMT, market: 'energy', generated: now, fetched, intervalMin: 10, params: crypto?.params ?? null,
    marketSrc: 'Yahoo Finance', marketStale: false,
    latestDate: last ? isoDay(last) : null,
    sources: { name: 'Yahoo Finance', got: Object.keys(quotes).length, of: ENERGY.length, at: at || null },
    markets, cats: { t: now, stable: [], gold: [] }, hist,
  };
}

export async function build({ prev = null, crypto = null, log = console.log, now = Date.now(), fetchFn = fetch } = {}) {
  const same = prev?.market === 'energy' && prev?.fmt === FMT;
  const full = !same || now - (prev.fetched || 0) >= REFETCH;
  const fetched = full ? now : prev.fetched;
  const cut = Math.floor(now / DAY) - HISTORY_DAYS;
  const series = {}, quotes = {}, failed = [];
  await pool(ENERGY, 3, async a => {
    const got = await fetchChart(a.yahoo, full ? '2y' : '5d', fetchFn);
    if (!got) {                                          // keep the last good history and price, if any
      failed.push(a.symbol);
      const old = same ? daysFromPrev(prev, a.id) : new Map();
      const m = old.size && prev.markets?.find(x => x.id === a.id);
      if (m) { series[a.id] = toHist(old, a, prev.hist[a.id].t); quotes[a.id] = { price: m.current_price, t: m.quoteAt, stale: true }; }
      return;
    }
    const days = full ? new Map() : daysFromPrev(prev, a.id);
    for (const [d, v] of got.days) days.set(d, v);
    for (const d of [...days.keys()]) if (d < cut) days.delete(d);
    series[a.id] = toHist(days, a, fetched);
    quotes[a.id] = { price: got.price, t: got.t };
  });
  if (!Object.keys(series).length) throw new Error('Yahoo Finance answered for none of the contracts');
  const snap = toSnapshot(series, crypto, { now, fetched, quotes: Object.fromEntries(Object.entries(quotes).filter(([, q]) => !q.stale)) });
  // a contract Yahoo didn't answer for keeps its last price, flagged as not refreshed
  for (const m of snap.markets) if (quotes[m.id]?.stale) { m.current_price = quotes[m.id].price; m.quoteAt = quotes[m.id].t; m.notRefreshed = true; }
  log(`Energy: ${full ? 'full history' : 'latest days'} · ${snap.markets.length} tiles · prices to ${snap.latestDate} · newest quote ${snap.sources.at ? new Date(snap.sources.at).toISOString() : '—'}${failed.length ? ` · no answer for ${failed.join(', ')}` : ''}`);
  return snap;
}

/* ---------- CLI (Node only) ---------- */
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
if (IS_NODE && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const [out = 'energy.json', dataFile = 'data.json'] = process.argv.slice(2);
  let prev = null, crypto = null;
  if (process.env.PREV_URL) {
    try { prev = await (await fetch(process.env.PREV_URL + '?b=' + Date.now(), { signal: AbortSignal.timeout(20e3) })).json(); }
    catch { console.log('No previous energy.json (first run?)'); }
  }
  try { crypto = JSON.parse(await readFile(dataFile, 'utf8')); } catch { console.log(`No ${dataFile}: default signal settings`); }
  const data = await build({ prev, crypto });
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}
