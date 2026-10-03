// Daily scorecard for heat.sala.company's 🚀 / 😢 signals, plus the weekly self-tuning.
// Runs in GitHub Actions at 00:20 UTC (.github/workflows/score-signals.yml), right after the daily candle closes.
//   node scripts/score.mjs [--tune]    env SITE_URL = the live site (for today's top-100 list)
// Writes data/scorecard.json, and params.json when the tuner finds settings that do better on unseen data.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getJSON, fromExchanges, fromCoinGecko, loadPairs, pool } from './build-data.mjs';
import * as SIG from '../signals.mjs';

const SITE = process.env.SITE_URL || 'https://heat.sala.company';
const HISTORY = 1000;                       // ~2.7 years of daily candles for scoring and tuning
const DAY = 864e5;
const isoDay = d => new Date(d * DAY).toISOString().slice(0, 10);
const root = new URL('../', import.meta.url);
const readJSON = async (path, fallback) => { try { return JSON.parse(await readFile(new URL(path, root), 'utf8')); } catch { return fallback; } };

const today = Math.floor(Date.now() / DAY);
const params = SIG.withDefaults(await readJSON('params.json', null));
const prev = await readJSON('data/scorecard.json', null);

// 1. Today's universe: the same top 100 the site shows
const snap = await getJSON(`${SITE}/data.json?b=${Date.now()}`);
const universe = SIG.pickUniverse(snap.markets, snap.cats, 100);

// 2. Exact trading pairs by CoinGecko ID: refreshed weekly (and for coins new to the top 100), saved to data/pairs.json
const tuneNow = process.argv.includes('--tune') || new Date().getUTCDay() === 0;
let pairsFile = await readJSON('data/pairs.json', { t: 0, pairs: {} });
const stalePairs = tuneNow || Date.now() - pairsFile.t > 7 * DAY;
const pairIds = universe.map(c => c.id).filter(id => !id.startsWith('cl-') && (stalePairs || !pairsFile.pairs[id]));
if (pairIds.length) {
  const fresh = await loadPairs(pairIds);
  pairsFile = { t: stalePairs ? Date.now() : pairsFile.t, pairs: { ...pairsFile.pairs, ...fresh } };
  await mkdir(new URL('data/', root), { recursive: true });
  await writeFile(new URL('data/pairs.json', root), JSON.stringify(pairsFile, null, 1) + '\n');
  console.log(`Pairs by ID: fetched ${Object.keys(fresh).length}/${pairIds.length}, ${Object.values(fresh).filter(p => Object.keys(p).length).length} with at least one exchange`);
}

// 3. Long daily history, complete days only (today's candle is still forming), gaps forward-filled.
// allowCG: fall back to CoinGecko's candles (today's list only, to keep within its free plan)
async function history(c, allowCG) {
  let h = await fromExchanges(c, snap.hist?.[c.id]?.src, HISTORY, pairsFile.pairs);
  if (!h && allowCG) { try { h = await fromCoinGecko(c, HISTORY); } catch { h = null; } }
  const closes = (h?.closes || []).filter(([t]) => Math.floor(t / DAY) < today);
  if (closes.length < 260) return null;
  const byDay = new Map(closes.map(([t, v, vol]) => [Math.floor(t / DAY), [v, vol]]));
  const days = [...byDay.keys()].sort((a, b) => a - b), filled = [], vols = [];
  let last = byDay.get(days[0])[0];
  for (let d = days[0]; d <= days[days.length - 1]; d++) {
    const x = byDay.get(d);
    if (x) last = x[0];
    filled.push(last);
    vols.push(x?.[1] > 0 ? x[1] : null);   // a gap has no volume (the close is carried forward, the volume isn't)
  }
  return { id: c.id, symbol: c.symbol.toUpperCase(), name: c.name, t0: days[0] * DAY, c: filled, v: vols, verified: h.verified };
}
const coins = [], missing = [];
await pool(universe, 5, async c => { const h = await history(c, true); if (h) coins.push(h); else missing.push(c.symbol.toUpperCase()); });
const verified = coins.filter(c => c.verified).length;

// 4. Point-in-time lists: record today's top 100, so the scorecard can also judge each day using only the coins that
// were in the list on that day (scoring today's list alone flatters the signals: coins are there because they rose).
// Every coin in a recorded list is scored, not only today's: a coin that later fell out of the top 100 must still
// count on the days it was in it, or the losers quietly disappear from the check.
const isoToday = new Date(today * DAY).toISOString().slice(0, 10);
const uniHist = await readJSON('data/universe-history.json', { v: 1, days: {} });
uniHist.days[isoToday] = universe.map(c => c.id);
uniHist.coins ||= {};
for (const c of universe) uniHist.coins[c.id] = { symbol: c.symbol, name: c.name };
const since = isoDay(today - HISTORY);
const inToday = new Set(universe.map(c => c.id));
const extraIds = [...new Set(Object.entries(uniHist.days).filter(([d]) => d >= since).flatMap(([, ids]) => ids))].filter(id => !inToday.has(id));
// their current price (the candle sources are checked against it): today's markets list, else one CoinGecko request
const live = new Map(snap.markets.map(c => [c.id, c]));
const priceless = extraIds.filter(id => !live.get(id)?.current_price);
const prices = {};
for (let i = 0; i < priceless.length; i += 200) {
  try { Object.assign(prices, await getJSON(`https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=${priceless.slice(i, i + 200).map(encodeURIComponent).join(',')}`, { tries: 1 })); }
  catch (e) { console.log('Prices for past-list coins failed: ' + e.message); }
}
const extra = [], extraMissing = [];
await pool(extraIds, 5, async id => {
  const meta = live.get(id) || { id, ...uniHist.coins[id], current_price: prices[id]?.usd };
  if (!meta.symbol || !(meta.current_price > 0)) { extraMissing.push(id); return; }
  const h = await history(meta, false);
  if (h) extra.push(h); else extraMissing.push(id);
});
// Relative strength is measured against Bitcoin
const btc = coins.find(c => c.id === 'bitcoin');
if (btc) {
  const b0 = btc.t0 / DAY, byDayBtc = new Map(btc.c.map((v, i) => [b0 + i, v]));
  for (const c of [...coins, ...extra]) c.bench = SIG.alignBench(c.c.map((_, i) => c.t0 / DAY + i), byDayBtc);
}
console.log(`History for ${coins.length}/${universe.length} coins (${verified} on pairs verified by ID, ${coins.filter(c => c.v.some(Boolean)).length} with volume)${btc ? '' : ' · no Bitcoin history: relative strength not measured'}${missing.length ? ' · none for ' + missing.join(', ') : ''}`);
console.log(`Past-list coins no longer in the top 100: ${extra.length}/${extraIds.length} with history${extraMissing.length ? ` (none for ${extraMissing.length})` : ''}`);

// 5. Score, and tune on Sundays (or when asked, or the first time). Costs: ~0.1% per side on a large exchange.
const { card, newParams } = SIG.buildScorecard(coins, params, { prev, tuneNow, costPct: 0.002, universe: uniHist.days, extra, backfill: uniHist.backfill });

await mkdir(new URL('data/', root), { recursive: true });
await writeFile(new URL('data/scorecard.json', root), JSON.stringify(card));
await writeFile(new URL('data/universe-history.json', root), JSON.stringify(uniHist));
if (newParams) await writeFile(new URL('params.json', root), JSON.stringify(newParams, null, 2) + '\n');

const pct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
const y = card.yesterday.stats, t = card.tuning.last;
console.log(`Point-in-time list: ${card.pit?.days ?? 0} day(s) recorded since ${card.pit?.from ?? isoToday}`);
console.log(`Signals of ${card.signalDay} → ${card.outcomeDay}: ${y.rockets.n} 🚀 coins (${pct(y.rockets.upRate)} up), ${y.sad.n} 😢 coins (${pct(y.sad.downRate)} down), market ${pct(card.yesterday.market)}`);
for (const h of SIG.HORIZONS) {
  const w = card.windows.d30[h];
  console.log(`Last 30 days, ${h}d ahead: 🚀 up ${pct(w.rockets.upRate)} · 😢 down ${pct(w.sad.downRate)} · IC ${w.ic.mean?.toFixed(4) ?? '—'} (t=${w.ic.t?.toFixed(2) ?? '—'})`);
}
if (t && card.tuning.lastRun && Date.now() - Date.parse(card.tuning.lastRun) < 3600e3) {
  console.log(`Tuning: ${t.adopted ? 'ADOPTED new settings' : 'kept current settings'} · won ${t.wins}/${t.folds.length} check periods · avg IC ${t.testIC.before?.toFixed(4)} → ${t.testIC.after?.toFixed(4)}`);
  for (const n of t.notes) console.log('  ' + n);
  if (t.holdout) console.log(`  untouched last days ${t.holdout.from}…${t.holdout.to}: IC current ${t.holdout.current?.toFixed(4)} · proposed ${t.holdout.proposed?.toFixed(4)}`);
  if (t.stop) console.log(`  stop distance: ${t.stop.table.map(s => s.m + 'x ' + (s.avg * 100).toFixed(2) + '%').join(', ')} → ${t.stop.adopt ? 'switched to ' + t.stop.to + 'x' : 'kept ' + t.stop.from + 'x'}`);
}
