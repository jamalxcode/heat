// Builds metals.json for heat.sala.company/metals/: precious metals in US dollars per troy ounce, plus tokenized gold
// and Bitcoin for comparison. Runs in the deploy job right after data.json (every 10 minutes).
//   node scripts/build-metals.mjs <out.json> <data.json>      (env PREV_URL = the last published metals.json)
// Sources:
//   - gold, silver, platinum, palladium: the public-domain exchange-api feed (CC0), one file per day since March 2024.
//     It gives ounces per dollar; the price is 1 / that. Its sources aren't documented, so the tiles get the "?" mark.
//     Copper isn't included: it's an industrial metal, and no free public-domain feed has it.
//   - Bitcoin, PAX Gold (PAXG), Tether Gold (XAUT): copied from the crypto page's freshly built data.json.
// One close per calendar day (metals trade almost around the clock); a missing day is carried forward.
// build() has no Node dependencies, so tests and the browser can run it too.
import { fetchExtras, pool, isoDay, dayNum, DAY, XAPI_FROM } from './build-forex.mjs';

const HISTORY_DAYS = 400;               // calendar days kept: indicators need 260
const REFETCH = 60 * 60e3;              // the feed changes once a day: check for a new day hourly

export const METALS = [
  { code: 'xau', name: 'Gold', badge: 'Au' },
  { code: 'xag', name: 'Silver', badge: 'Ag' },
  { code: 'xpt', name: 'Platinum', badge: 'Pt' },
  { code: 'xpd', name: 'Palladium', badge: 'Pd' },
];
// from data.json: tokenized gold (one token = one troy ounce, so they should track gold) and Bitcoin ("digital gold")
export const FROM_CRYPTO = ['pax-gold', 'tether-gold', 'bitcoin'];

const chg = (c, k) => c.length > k ? (c[c.length - 1] / c[c.length - 1 - k] - 1) * 100 : null;

// days: { 'YYYY-MM-DD': { xau: ounces per dollar, … } } → one series per metal, in dollars per ounce, every calendar
// day from the first day any metal has a value; gaps carried forward
export function metalSeries(days) {
  const dates = Object.keys(days).sort();
  if (!dates.length) return {};
  const first = dayNum(dates[0]), last = dayNum(dates[dates.length - 1]), out = {};
  for (const m of METALS) {
    const c = []; let prev = null, t0 = null;
    for (let d = first; d <= last; d++) {
      const v = days[isoDay(d)]?.[m.code];
      const price = v > 0 ? +(1 / v).toPrecision(7) : prev;
      if (price == null) continue;                        // nothing yet to carry forward
      if (t0 == null) t0 = d;
      c.push(price); prev = price;
    }
    if (c.length) out[m.code] = { t0: t0 * DAY, c };
  }
  return out;
}

// metals.json, in the same shape as data.json so the page shows it the same way
export function toSnapshot(series, crypto, { now = Date.now(), fetched = now } = {}) {
  const markets = [], hist = {};
  METALS.forEach((m, k) => {
    const s = series[m.code];
    if (!s) return;
    markets.push({
      id: m.code, symbol: m.code.toUpperCase(), name: m.name, badge: m.badge, image: '', market_cap_rank: k + 1,
      current_price: s.c.at(-1), market_cap: null, src: 'x', unit: 'oz',
      price_change_percentage_24h_in_currency: chg(s.c, 1),
      price_change_percentage_7d_in_currency: chg(s.c, 7),
      price_change_percentage_30d_in_currency: chg(s.c, 30),
    });
    hist[m.code] = { src: 'exchange-api', pair: `${m.code.toUpperCase()}/USD`, ok: 0, t: fetched, t0: s.t0, c: s.c };
  });
  for (const id of FROM_CRYPTO) {
    const c = crypto?.markets?.find(x => x.id === id), h = crypto?.hist?.[id];
    if (!c || !h) continue;
    markets.push({ ...c, market_cap_rank: markets.length + 1, src: 'crypto' });
    hist[id] = h;
  }
  return {
    v: 1, market: 'metals', generated: now, fetched, intervalMin: 10, params: crypto?.params ?? null,
    marketSrc: 'exchange-api + CoinGecko', marketStale: !!crypto?.marketStale,
    metalsDate: Object.values(series).length ? isoDay(Math.max(...Object.values(series).map(s => s.t0 / DAY + s.c.length - 1))) : null,
    markets, cats: { t: now, stable: [], gold: [] }, hist,
  };
}

// the feed's raw values (ounces per dollar) by date, recovered from a previous metals.json
function daysFromPrev(prev) {
  const out = {};
  for (const m of METALS) {
    const h = prev?.hist?.[m.code];
    if (!h?.c) continue;
    const d0 = Math.floor(h.t0 / DAY);
    h.c.forEach((v, i) => { (out[isoDay(d0 + i)] ||= {})[m.code] = 1 / v; });
  }
  return out;
}

export async function build({ prev = null, crypto = null, log = console.log, now = Date.now() } = {}) {
  const today = Math.floor(now / DAY);
  let days = daysFromPrev(prev), fetched = prev?.fetched || 0;
  // the metals change once a day: refetch hourly (crypto tiles are refreshed on every build from data.json)
  if (!(prev?.market === 'metals' && now - fetched < REFETCH)) {
    const from = Math.max(dayNum(XAPI_FROM), today - HISTORY_DAYS);
    const recent = new Set([isoDay(today), isoDay(today - 1)]);          // re-check these: today's file may be new
    const need = [];
    for (let d = from; d <= today; d++) if (!days[isoDay(d)] || recent.has(isoDay(d))) need.push(isoDay(d));
    let got = 0;
    await pool(need, 8, async date => {
      const r = await fetchExtras(date);
      if (!r) return;
      days[date] = Object.fromEntries(METALS.filter(m => r[m.code] > 0).map(m => [m.code, r[m.code]]));
      got++;
    });
    fetched = now;
    log(`Metals: ${got}/${need.length} days fetched`);
  }
  // keep the newest HISTORY_DAYS only
  const cut = isoDay(today - HISTORY_DAYS);
  days = Object.fromEntries(Object.entries(days).filter(([d]) => d >= cut));
  const snap = toSnapshot(metalSeries(days), crypto, { now, fetched });
  log(`Metals: ${snap.markets.length} tiles · metal prices to ${snap.metalsDate}`);
  return snap;
}

/* ---------- CLI (Node only) ---------- */
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
if (IS_NODE && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const [out = 'metals.json', dataFile = 'data.json'] = process.argv.slice(2);
  let prev = null, crypto = null;
  if (process.env.PREV_URL) {
    try { prev = await (await fetch(process.env.PREV_URL + '?b=' + Date.now(), { signal: AbortSignal.timeout(20e3) })).json(); }
    catch { console.log('No previous metals.json (first run?)'); }
  }
  try { crypto = JSON.parse(await readFile(dataFile, 'utf8')); } catch { console.log(`No ${dataFile}: metals only`); }
  const data = await build({ prev, crypto });
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}
