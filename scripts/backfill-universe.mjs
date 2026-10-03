// One-off: rebuild the daily top-100 lists for the days before the scorer started recording them (1 Oct 2026), so
// the Scorecard's point-in-time check has ~90 fair days at once instead of waiting.
//   node scripts/backfill-universe.mjs [--dry-run] [--limit 300] [--days 90]     (env COINGECKO_API_KEY, required)
// How: take today's top `limit` coins (nearly every coin that was in the top 100 three months ago is still among
// them), download each one's daily market cap for `days` days, and for each past day keep the top 100 by that day's
// market cap, stablecoins and wrapped/gold tokens left out as everywhere else. Days already recorded are kept.
// Limit: a coin that has since fallen out of today's top `limit` is missing from the rebuilt lists, so a small
// flattering bias remains; the Scorecard says these days are reconstructed.
// Careful with CoinGecko's free plan (30 requests a minute, ~10,000 a month, shared with the 10-minute updates):
//   - one request every GAP_MS (10 a minute), a hard cap on requests, a stop at the first "too many requests" or at
//     two errors in a row, and progress saved after every coin (data/backfill-cache.json), so a rerun resumes
//   - --dry-run fetches only 5 coins' history and writes no lists, to check everything before the full pull
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isPegged } from '../signals.mjs';

const CG = 'https://api.coingecko.com/api/v3';
const DAY = 864e5;
const GAP_MS = 6000;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry-run');
const LIMIT = Math.min(500, +arg('--limit', 300));
const DAYS = Math.min(180, +arg('--days', 90));
const MAX_REQUESTS = DRY ? 10 : LIMIT + 20;          // hard cap, whatever happens
const root = new URL('../', import.meta.url);
const readJSON = async (p, fallback) => { try { return JSON.parse(await readFile(new URL(p, root), 'utf8')); } catch { return fallback; } };
const isoDay = d => new Date(d * DAY).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const key = process.env.COINGECKO_API_KEY;
if (!key) { console.error('COINGECKO_API_KEY is not set'); process.exit(1); }

let requests = 0, lastAt = 0;
class Stop extends Error {}
async function cg(path) {
  if (requests >= MAX_REQUESTS) throw new Stop(`request cap of ${MAX_REQUESTS} reached`);
  const wait = lastAt + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now(); requests++;
  const r = await fetch(CG + path, { headers: { 'x-cg-demo-api-key': key, accept: 'application/json', 'user-agent': 'heat.sala.company backfill (one-off)' }, signal: AbortSignal.timeout(30e3) });
  if (r.status === 429) throw new Stop('CoinGecko said "too many requests": stopping (progress is saved)');
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path.split('?')[0]}`);
  return r.json();
}

const cache = await readJSON('data/backfill-cache.json', { v: 1, coins: {}, candidates: null, cats: null });
const save = async () => { await mkdir(new URL('data/', root), { recursive: true }); await writeFile(new URL('data/backfill-cache.json', root), JSON.stringify(cache)); };
const today = Math.floor(Date.now() / DAY);
let stopped = null;

try {
  // 1. Candidates: today's top coins by market cap (fetched once, then reused from the cache)
  if (!cache.candidates || cache.candidates.length < LIMIT) {
    const rows = [];
    for (let page = 1; rows.length < LIMIT; page++) {
      const got = await cg(`/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`);
      rows.push(...got);
      if (got.length < 250) break;
    }
    cache.candidates = rows.slice(0, LIMIT).map(c => ({ id: c.id, symbol: c.symbol, name: c.name }));
    await save();
  }
  // categories: stablecoins and tokenized gold are left out of every list, as on the site
  if (!cache.cats) {
    const stable = (await cg('/coins/markets?vs_currency=usd&category=stablecoins&per_page=250&order=market_cap_desc')).map(c => c.id);
    const gold = (await cg('/coins/markets?vs_currency=usd&category=tokenized-gold&per_page=100&order=market_cap_desc')).map(c => c.id);
    cache.cats = { stable, gold };
    await save();
  }
  // 2. Each candidate's daily market cap (and price), one request per coin, saved as we go
  const todo = cache.candidates.filter(c => !isPegged(c, cache.cats) && !cache.coins[c.id]).slice(0, DRY ? 5 : Infinity);
  console.log(`${cache.candidates.length} candidates, ${Object.keys(cache.coins).length} already fetched, ${todo.length} to fetch now`);
  let errorsInRow = 0;
  for (const c of todo) {
    try {
      const d = await cg(`/coins/${encodeURIComponent(c.id)}/market_chart?vs_currency=usd&days=${DAYS}&interval=daily`);
      const caps = (d.market_caps || []).filter(([, v]) => v > 0).map(([t, v]) => [Math.floor(t / DAY), Math.round(v)]);
      const lastPrice = d.prices?.at(-1)?.[1] ?? null;
      cache.coins[c.id] = { symbol: c.symbol, name: c.name, caps, lastPrice };
      errorsInRow = 0;
      await save();
    } catch (e) {
      if (e instanceof Stop) throw e;
      console.log(`  ${c.id}: ${e.message}`);
      if (++errorsInRow >= 2) throw new Stop('two errors in a row: stopping (progress is saved)');
    }
  }
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  stopped = e.message;
}

const fetched = Object.keys(cache.coins).length;
const eligible = (cache.candidates || []).filter(c => !isPegged(c, cache.cats || { stable: [], gold: [] })).length;
console.log(`${requests} CoinGecko requests this run · ${fetched}/${eligible} coins' history in the cache${stopped ? ` · STOPPED: ${stopped}` : ''}`);

if (DRY) {
  for (const [id, c] of Object.entries(cache.coins).slice(0, 5)) {
    console.log(`  ${id}: ${c.caps.length} daily caps, ${isoDay(c.caps[0]?.[0])} → ${isoDay(c.caps.at(-1)?.[0])}, latest cap $${(c.caps.at(-1)?.[1] / 1e9).toFixed(2)}B, price ${c.lastPrice}`);
  }
  console.log('Dry run: no lists written.');
  process.exit(0);
}
if (stopped || fetched < eligible) { console.log('Not every coin is fetched yet: run again to resume (no lists written).'); process.exit(stopped ? 1 : 0); }

// 3. Rebuild each past day's top 100 by that day's market cap, for days not recorded yet
const uniHist = await readJSON('data/universe-history.json', { v: 1, days: {} });
const recorded = Object.keys(uniHist.days).sort();
const firstRecorded = recorded.length ? Math.floor(Date.parse(recorded[0]) / DAY) : today;
const byDay = new Map();
for (const [id, c] of Object.entries(cache.coins)) for (const [d, cap] of c.caps) {
  if (d >= firstRecorded || d > today - 1) continue;
  if (!byDay.has(d)) byDay.set(d, []);
  byDay.get(d).push([id, cap]);
}
let added = 0;
uniHist.coins ||= {};
for (const [d, list] of [...byDay].sort((a, b) => a[0] - b[0])) {
  if (list.length < 120) continue;                                  // too few coins with a cap that day to rank 100
  const ids = list.sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id]) => id);
  uniHist.days[isoDay(d)] ||= (added++, ids);
  for (const id of ids) uniHist.coins[id] ||= { symbol: cache.coins[id].symbol, name: cache.coins[id].name };
}
const rebuilt = Object.keys(uniHist.days).filter(d => Math.floor(Date.parse(d) / DAY) < firstRecorded).sort();
uniHist.backfill = { from: rebuilt[0], to: rebuilt.at(-1), days: rebuilt.length, limit: LIMIT, candidates: eligible, at: new Date().toISOString().slice(0, 10),
  note: `rebuilt from CoinGecko daily market caps of the top ${LIMIT} coins on ${new Date().toISOString().slice(0, 10)}` };
await writeFile(new URL('data/universe-history.json', root), JSON.stringify(uniHist));
console.log(`Rebuilt ${added} daily lists (${uniHist.backfill.from} → ${uniHist.backfill.to}); recorded lists from ${recorded[0] ?? '—'} kept as they were`);
