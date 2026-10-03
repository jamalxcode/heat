// Builds metals.json for heat.sala.company/metals/: precious metals in US dollars per troy ounce, plus tokenized gold
// and Bitcoin for comparison. Runs in the deploy job right after data.json (every 10 minutes).
//   node scripts/build-metals.mjs <out.json> <data.json>      (env PREV_URL = the last published metals.json)
// Sources:
//   - daily history: the public-domain exchange-api feed (CC0), one file per day since March 2024. It gives ounces
//     per dollar; the price is 1 / that. Each file is made just after midnight UTC, so the file dated D holds the
//     price at the end of day D−1: that's the day it is filed under here.
//   - current prices and a cross-check: Swissquote's public quote feed (a Swiss bank; spot bid/ask, no history).
//     Its mid price is today's price (refreshed on every build, so the tiles move during the trading day), and its
//     last quote of each day is compared with exchange-api's close for that day. Within 1% the metal gets ✓
//     ("confirmed by a second source"); further apart, a ⚠. If exchange-api fails, Swissquote's quotes keep the
//     latest prices coming.
//   - Copper isn't included: it's an industrial metal, and no free public-domain feed has it.
//   - Bitcoin, PAX Gold (PAXG), Tether Gold (XAUT): copied from the crypto page's freshly built data.json.
// One close per calendar day (metals trade almost around the clock); a missing day is carried forward.
// build() has no Node dependencies, so tests and the browser can run it too.
import { fetchExtras, pool, isoDay, dayNum, DAY, XAPI_FROM } from './build-forex.mjs';

const HISTORY_DAYS = 400;               // calendar days kept: indicators need 260
const REFETCH = 60 * 60e3;              // exchange-api changes once a day: check for a new file hourly
const FMT = 2;                          // 2: exchange-api files filed under the day before their date
const AGREE_PCT = 1;                    // the two sources' closes within this: confirmed
const SQ_KEEP = 10;                     // days of Swissquote closing quotes kept for the cross-check

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

// Swissquote: the current spot bid/ask per metal (several servers answer; the newest quote wins).
// → { xau: { price: mid, t: quote time (ms) }, … }, leaving out any metal it couldn't get
const SQ_URL = code => `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${code.toUpperCase()}/USD`;
export async function fetchLive(fetchFn = fetch) {
  const out = {};
  await Promise.all(METALS.map(async m => {
    try {
      const j = await (await fetchFn(SQ_URL(m.code), { signal: AbortSignal.timeout(8000) })).json();
      const best = (Array.isArray(j) ? j : []).filter(x => x?.ts > 0).sort((a, b) => b.ts - a.ts)[0];
      const p = best?.spreadProfilePrices?.find(x => x.spreadProfile === 'prime') || best?.spreadProfilePrices?.[0];
      if (p?.bid > 0 && p?.ask > 0) out[m.code] = { price: +((p.bid + p.ask) / 2).toPrecision(7), t: best.ts };
    } catch { /* unreachable: the history alone still works */ }
  }));
  return out;
}

// Cross-check: for each metal, the latest day both sources have (exchange-api's close, Swissquote's last quote that
// day). → { xau: { day, diff: % (Swissquote vs exchange-api), ok: within AGREE_PCT }, … }
export function crossCheck(days, sq, primaryLatest) {
  const out = {};
  for (const m of METALS) {
    for (let d = primaryLatest; d >= primaryLatest - 7; d--) {
      const x = days[isoDay(d)]?.[m.code], s = sq[isoDay(d)]?.[m.code];
      if (!(x > 0 && s > 0)) continue;
      const diff = (s * x - 1) * 100;                     // x is ounces per dollar: s × x = Swissquote ÷ exchange-api
      out[m.code] = { day: isoDay(d), diff: +diff.toFixed(2), ok: Math.abs(diff) <= AGREE_PCT };
      break;
    }
  }
  return out;
}

// metals.json, in the same shape as data.json so the page shows it the same way
export function toSnapshot(series, crypto, { now = Date.now(), fetched = now, check = {}, sources = null, sq = {} } = {}) {
  const markets = [], hist = {};
  METALS.forEach((m, k) => {
    const s = series[m.code];
    if (!s) return;
    markets.push({
      id: m.code, symbol: m.code.toUpperCase(), name: m.name, badge: m.badge, image: '', market_cap_rank: k + 1,
      current_price: s.c.at(-1), market_cap: null, src: 'x', unit: 'oz', check: check[m.code] || null,
      price_change_percentage_24h_in_currency: chg(s.c, 1),
      price_change_percentage_7d_in_currency: chg(s.c, 7),
      price_change_percentage_30d_in_currency: chg(s.c, 30),
    });
    hist[m.code] = { src: 'exchange-api', pair: `${m.code.toUpperCase()}/USD`, ok: check[m.code]?.ok ? 1 : 0, t: fetched, t0: s.t0, c: s.c };
  });
  for (const id of FROM_CRYPTO) {
    const c = crypto?.markets?.find(x => x.id === id), h = crypto?.hist?.[id];
    if (!c || !h) continue;
    markets.push({ ...c, market_cap_rank: markets.length + 1, src: 'crypto' });
    hist[id] = h;
  }
  return {
    v: 1, fmt: FMT, market: 'metals', generated: now, fetched, intervalMin: 10, params: crypto?.params ?? null,
    marketSrc: 'exchange-api + Swissquote + CoinGecko', marketStale: !!crypto?.marketStale,
    metalsDate: Object.values(series).length ? isoDay(Math.max(...Object.values(series).map(s => s.t0 / DAY + s.c.length - 1))) : null,
    sources, sq, markets, cats: { t: now, stable: [], gold: [] }, hist,
  };
}

// the feed's raw values (ounces per dollar) by day, recovered from a previous metals.json of the same format
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

export async function build({ prev = null, crypto = null, log = console.log, now = Date.now(), extrasFn = fetchExtras, liveFn = fetchLive } = {}) {
  const today = Math.floor(now / DAY);
  const same = prev?.market === 'metals' && prev?.fmt === FMT;   // an older format is rebuilt, not reused
  let days = same ? daysFromPrev(prev) : {}, fetched = same ? prev.fetched || 0 : 0;
  const sq = same ? { ...(prev.sq || {}) } : {};
  let primaryLatest = same && prev.sources?.primary?.latest ? dayNum(prev.sources.primary.latest) : 0;
  // 1. exchange-api, hourly: the file dated f holds the close of day f − 1. The last few days are asked again,
  // since a file may appear late; days after its latest close hold Swissquote quotes until it catches up.
  if (now - fetched >= REFETCH) {
    const from = Math.max(dayNum(XAPI_FROM), today - HISTORY_DAYS);
    const need = [];
    for (let f = from; f <= today; f++) if (!days[isoDay(f - 1)] || f >= today - 2 || f - 1 > primaryLatest) need.push(f);
    let got = 0;
    await pool(need, 8, async f => {
      const r = await extrasFn(isoDay(f));
      if (!r) return;
      const vals = Object.fromEntries(METALS.filter(m => r[m.code] > 0).map(m => [m.code, r[m.code]]));
      if (!Object.keys(vals).length) return;
      days[isoDay(f - 1)] = vals;
      primaryLatest = Math.max(primaryLatest, f - 1);
      got++;
    });
    fetched = now;
    log(`Metals: exchange-api ${got}/${need.length} days fetched, closes to ${primaryLatest ? isoDay(primaryLatest) : '—'}`);
  }
  // 2. Swissquote, every build: today's price, and each day's last quote for the cross-check
  const live = await liveFn();
  for (const [code, l] of Object.entries(live)) {
    const d = Math.floor(l.t / DAY);
    if (d < today - 3 || d > today) continue;                  // a stale or odd quote time: ignore it
    (sq[isoDay(d)] ||= {})[code] = l.price;
    if (d > primaryLatest) (days[isoDay(d)] ||= {})[code] = 1 / l.price;   // newer than exchange-api's latest close
  }
  for (const d of Object.keys(sq).sort().slice(0, -SQ_KEEP)) delete sq[d];
  // keep the newest HISTORY_DAYS only
  const cut = isoDay(today - HISTORY_DAYS);
  days = Object.fromEntries(Object.entries(days).filter(([d]) => d >= cut));
  const check = crossCheck(days, sq, primaryLatest);
  const liveT = Math.max(0, ...Object.values(live).map(l => l.t));
  const sources = {
    primary: { name: 'exchange-api', latest: primaryLatest ? isoDay(primaryLatest) : null, ok: primaryLatest >= today - 3 },
    second: { name: 'Swissquote', ok: Object.keys(live).length === METALS.length && liveT > now - 4 * DAY, at: liveT || null },
    agree: Object.values(check).length ? Object.values(check).every(c => c.ok) : null,
  };
  const snap = toSnapshot(metalSeries(days), crypto, { now, fetched, check, sources, sq });
  log(`Metals: ${snap.markets.length} tiles · prices to ${snap.metalsDate} · Swissquote ${Object.keys(live).length}/${METALS.length} · cross-check ${Object.entries(check).map(([k, c]) => `${k} ${c.diff > 0 ? '+' : ''}${c.diff}%`).join(', ') || 'pending'}`);
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
