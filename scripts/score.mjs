// Daily scorecard for heat.sala.company's 🚀 / 😢 signals, plus the weekly self-tuning.
// Runs in GitHub Actions at 00:20 UTC (.github/workflows/score-signals.yml), right after the daily candle closes.
//   node scripts/score.mjs [--tune]    env SITE_URL = the live site (for today's top-50 list)
// Writes data/scorecard.json, and params.json when the tuner finds settings that do better on unseen data.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getJSON, fromExchanges, fromCoinGecko, pool } from './build-data.mjs';
import * as SIG from '../signals.mjs';

const SITE = process.env.SITE_URL || 'https://heat.sala.company';
const HISTORY = 1000;                       // ~2.7 years of daily candles for scoring and tuning
const DAY = 864e5;
const root = new URL('../', import.meta.url);
const readJSON = async (path, fallback) => { try { return JSON.parse(await readFile(new URL(path, root), 'utf8')); } catch { return fallback; } };

const today = Math.floor(Date.now() / DAY);
const params = SIG.withDefaults(await readJSON('params.json', null));
const prev = await readJSON('data/scorecard.json', null);

// 1. Today's universe: the same top 50 the site shows
const snap = await getJSON(`${SITE}/data.json?b=${Date.now()}`);
const universe = SIG.pickUniverse(snap.markets, snap.cats, 50);

// 2. Long daily history, complete days only (today's candle is still forming), gaps forward-filled
const coins = [], missing = [];
await pool(universe, 5, async c => {
  let h = await fromExchanges(c, snap.hist?.[c.id]?.src, HISTORY);
  if (!h) { try { h = await fromCoinGecko(c, HISTORY); } catch { h = null; } }
  const closes = (h?.closes || []).filter(([t]) => Math.floor(t / DAY) < today);
  if (closes.length < 260) { missing.push(c.symbol.toUpperCase()); return; }
  const byDay = new Map(closes.map(([t, v]) => [Math.floor(t / DAY), v]));
  const days = [...byDay.keys()].sort((a, b) => a - b), filled = [];
  let last = byDay.get(days[0]);
  for (let d = days[0]; d <= days[days.length - 1]; d++) { if (byDay.has(d)) last = byDay.get(d); filled.push(last); }
  coins.push({ id: c.id, symbol: c.symbol.toUpperCase(), name: c.name, t0: days[0] * DAY, c: filled });
});
console.log(`History for ${coins.length}/${universe.length} coins${missing.length ? ' (none for ' + missing.join(', ') + ')' : ''}`);

// 3. Score, and tune on Sundays (or when asked, or the first time)
const tuneNow = process.argv.includes('--tune') || new Date().getUTCDay() === 0;
const { card, newParams } = SIG.buildScorecard(coins, params, { prev, tuneNow });

await mkdir(new URL('data/', root), { recursive: true });
await writeFile(new URL('data/scorecard.json', root), JSON.stringify(card));
if (newParams) await writeFile(new URL('params.json', root), JSON.stringify(newParams, null, 2) + '\n');

const pct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
const y = card.yesterday.stats, t = card.tuning.last;
console.log(`Signals of ${card.signalDay} → ${card.outcomeDay}: ${y.rockets.n} 🚀 coins (${pct(y.rockets.upRate)} up), ${y.sad.n} 😢 coins (${pct(y.sad.downRate)} down), market ${pct(card.yesterday.market)}`);
for (const h of SIG.HORIZONS) {
  const w = card.windows.d30[h];
  console.log(`Last 30 days, ${h}d ahead: 🚀 up ${pct(w.rockets.upRate)} · 😢 down ${pct(w.sad.downRate)} · ⚡ moves ${w.squeeze.ratio?.toFixed(2) ?? '—'}× usual · IC ${w.ic.mean?.toFixed(4) ?? '—'} (t=${w.ic.t?.toFixed(2) ?? '—'})`);
}
if (t && card.tuning.lastRun && Date.now() - Date.parse(card.tuning.lastRun) < 3600e3) {
  console.log(`Tuning: ${t.adopted ? 'ADOPTED new settings' : 'kept current settings'} · won ${t.wins}/${t.folds.length} check periods · avg IC ${t.testIC.before?.toFixed(4)} → ${t.testIC.after?.toFixed(4)}`);
  for (const n of t.notes) console.log('  ' + n);
}
