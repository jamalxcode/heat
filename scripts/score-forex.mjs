// Daily scorecard for the forex 🚀 / 😢 (and weekly tuning on Sundays), like scripts/score.mjs does for crypto.
//   node scripts/score-forex.mjs [--tune]
// Writes data/forex-scorecard.json, params-forex.json (only when the tuner adopts new settings) and
// data/forex-extras.json (a cache of the extra feed's past rates, so each run fetches only the new days).
// History: ECB currencies since 2010 (one request); extra-feed currencies since March 2024 (one file per day).
// Pegged currencies and those with unreliable rates (rial, Syrian pound) are left out: they can't test a signal.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as SIG from '../signals.mjs';
import { CURRENCIES, scored, pairOf, fetchEcb, fetchExtras, assemble, pool, isoDay, DAY, XAPI_FROM } from './build-forex.mjs';

const root = new URL('../', import.meta.url);
const readJSON = async (p, fallback) => { try { return JSON.parse(await readFile(new URL(p, root), 'utf8')); } catch { return fallback; } };

// Forex moves are a fraction of crypto's: momentum is judged over 21 business days (about a month), with thresholds
// in the low single digits. These are the starting settings; the tuner adjusts them.
const FX_START = { momPct: 3, momDays: 21 };
const MOM_PCTS = [1.5, 3, 4.5];
const HISTORY_FROM = '2010-01-01';

const now = Date.now(), today = Math.floor(now / DAY);
const params = SIG.withDefaults(await readJSON('params-forex.json', FX_START));
const prev = await readJSON('data/forex-scorecard.json', null);
const tuneNow = process.argv.includes('--tune') || new Date().getUTCDay() === 0;

// 1. ECB rates since 2010 (official, business days only)
const ecb = await fetchEcb(HISTORY_FROM, isoDay(today));
const dates = Object.keys(ecb).sort();
console.log(`ECB: ${dates.length} business days, ${dates[0]} to ${dates.at(-1)}`);

// 2. The extra feed, on the same dates, from the cache plus whatever days are new
const xCodes = CURRENCIES.filter(c => c.src === 'x' && scored(c)).map(c => c.code.toLowerCase());
const cache = await readJSON('data/forex-extras.json', { v: 1, rates: {} });
const need = dates.filter(d => d >= XAPI_FROM && !cache.rates[d]);
let got = 0;
await pool(need, 8, async d => {
  const r = await fetchExtras(d);
  if (!r) return;
  cache.rates[d] = Object.fromEntries(xCodes.filter(k => r[k] > 0).map(k => [k, r[k]]));
  got++;
});
console.log(`Extra feed: ${got}/${need.length} new days fetched, ${Object.keys(cache.rates).length} cached`);

// 3. One series per scored currency, with its real business days (signals.mjs uses `days` for dates and grouping)
const series = assemble(ecb, cache.rates);
const coins = [], spiky = [];
for (const cur of CURRENCIES.filter(scored)) {
  const s = series[cur.code];
  if (!s || s.c.length < 300) { console.log(`Skipped ${cur.code}: ${s?.c.length || 0} closes`); continue; }
  // leave out each unusual jump and the 7 closes before it (their 1–7-day outcomes include the jump): a glitch or a
  // devaluation would otherwise swamp the averages
  const skip = new Set(s.spikes.flatMap(j => Array.from({ length: 8 }, (_, k) => j - k)));
  if (s.spikes.length) spiky.push(`${cur.code} ${s.spikes.length}`);
  coins.push({ id: cur.code.toLowerCase(), symbol: pairOf(cur), name: cur.name, t0: s.days[0] * DAY, c: s.c, days: s.days, skip });
}
console.log(`Scoring ${coins.length} currencies${tuneNow ? ', tuning' : ''}${spiky.length ? ` · unusual jumps left out: ${spiky.join(', ')}` : ''}`);

// 4. Score, and tune on Sundays (or when asked, or the first time)
// costs: ~0.05% round trip (bid-ask spread on major pairs; wider for the extra-feed currencies)
const { card, newParams } = SIG.buildScorecard(coins, params, { prev, tuneNow, now, momPcts: MOM_PCTS, costPct: 0.0005 });
card.market = 'forex';
await mkdir(new URL('data/', root), { recursive: true });
await writeFile(new URL('data/forex-scorecard.json', root), JSON.stringify(card));
await writeFile(new URL('data/forex-extras.json', root), JSON.stringify(cache));
if (newParams) await writeFile(new URL('params-forex.json', root), JSON.stringify(newParams, null, 2) + '\n');

const y = card.yesterday.stats, w = card.windows.d90[1];
console.log(`Signal day ${card.signalDay} → ${card.outcomeDay}: 🚀 ${y.rockets.n} (up ${(y.rockets.upRate * 100 || 0).toFixed(0)}%), 😢 ${y.sad.n}`);
console.log(`Last 90 days, next day: rank correlation ${w.ic.mean?.toFixed(3)} (t ${w.ic.t?.toFixed(2)})`);
if (card.tuning.last && tuneNow) {
  console.log(`Tuner: ${card.tuning.last.adopted ? 'ADOPTED new settings' : 'kept the current settings'} (won ${card.tuning.last.wins}/3 periods)`);
  for (const n of card.tuning.last.notes) console.log('  ' + n);
  console.log(`Stops: ${card.tuning.last.stop.adopt ? `switched to ${card.tuning.last.stop.to}×` : `kept ${card.tuning.last.stop.from}×`}`);
}
