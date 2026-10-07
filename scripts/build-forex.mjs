// Builds forex.json for heat.sala.company/forex/: currencies against the US dollar, one close per business day.
// Runs in the same GitHub Actions job as data.json (every 10 minutes), but the rates only change once a day, so it
// reuses the previous file and refetches at most hourly. Usage: node scripts/build-forex.mjs <out.json>
//   (env PREV_URL = the last published forex.json)
// Sources:
//   - ECB euro reference rates, via the Frankfurter API: 29 currencies, official, history back to 1999. Set around
//     14:15 Frankfurt time on business days. Free; the ECB allows reuse with the source credited.
//   - exchange-api by Fawaz Ahmed (public domain, CC0): currencies the ECB doesn't publish (the ruble, the Gulf and other
//     Arab currencies, the rial, the Syrian pound). Daily files from March 2024. Sampled on the ECB's dates, so every
//     currency shares one business-day calendar. Its sources aren't documented, so these get the "?" mark.
// build() has no Node dependencies: the scorer (scripts/score-forex.mjs) and tests reuse the helpers.

export const DAY = 864e5;
const FRANKFURTER = 'https://api.frankfurter.dev/v1';
// exchange-api files are made just after midnight UTC. The file dated D is paired with the ECB rate of day D (set at
// 14:15 Frankfurt time): measured over 46 ECB days × 29 currencies (Oct 2026) it is the closest match, 0.16% off on
// average, vs 0.21% for the file dated D+1 and 0.29% for D−1. (Metals are different: their day is a close, so the
// file dated D is filed under D−1 there; see build-metals.mjs.)
const XAPI = [
  d => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${d}/v1/currencies/usd.min.json`,
  d => `https://${d}.currency-api.pages.dev/v1/currencies/usd.min.json`,
];
export const XAPI_FROM = '2024-03-02';   // first day the extra feed has files for
const HISTORY_DAYS = 400;                // calendar days fetched for the page: ~275 business days (indicators need 260)
const REFETCH = 60 * 60e3;               // rates change once a day: check hourly, reuse the previous file in between
const QUOTE = 'usd-xxx';                 // how pairs are stored; a file in another quoting is rebuilt, not reused

// Every pair is quoted USD/XXX (units of the currency per dollar), so all tiles read the same way: a rising rate means
// the dollar gained. The page can flip them all to XXX/USD. (Brokers quote EUR, GBP, AUD and NZD the other way round:
// EUR/USD. 'inv: true' on a currency would store it that way; none use it now.)
// src 'ecb' = official ECB rate, 'x' = the extra feed. pegged = fixed to the dollar (hidden by default, never scored).
// warn = official and market rates differ a lot; shown with a note, never scored.
export const CURRENCIES = [
  { code: 'EUR', name: 'Euro', flag: '🇪🇺', src: 'ecb' },
  { code: 'JPY', name: 'Japanese yen', flag: '🇯🇵', src: 'ecb' },
  { code: 'GBP', name: 'British pound', flag: '🇬🇧', src: 'ecb' },
  { code: 'CNY', name: 'Chinese yuan', flag: '🇨🇳', src: 'ecb' },
  { code: 'CHF', name: 'Swiss franc', flag: '🇨🇭', src: 'ecb' },
  { code: 'CAD', name: 'Canadian dollar', flag: '🇨🇦', src: 'ecb' },
  { code: 'AUD', name: 'Australian dollar', flag: '🇦🇺', src: 'ecb' },
  { code: 'HKD', name: 'Hong Kong dollar', flag: '🇭🇰', src: 'ecb', pegged: true },
  { code: 'SGD', name: 'Singapore dollar', flag: '🇸🇬', src: 'ecb' },
  { code: 'SEK', name: 'Swedish krona', flag: '🇸🇪', src: 'ecb' },
  { code: 'KRW', name: 'South Korean won', flag: '🇰🇷', src: 'ecb' },
  { code: 'NOK', name: 'Norwegian krone', flag: '🇳🇴', src: 'ecb' },
  { code: 'NZD', name: 'New Zealand dollar', flag: '🇳🇿', src: 'ecb' },
  { code: 'INR', name: 'Indian rupee', flag: '🇮🇳', src: 'ecb' },
  { code: 'MXN', name: 'Mexican peso', flag: '🇲🇽', src: 'ecb' },
  { code: 'ZAR', name: 'South African rand', flag: '🇿🇦', src: 'ecb' },
  { code: 'BRL', name: 'Brazilian real', flag: '🇧🇷', src: 'ecb' },
  { code: 'TRY', name: 'Turkish lira', flag: '🇹🇷', src: 'ecb' },
  { code: 'RUB', name: 'Russian ruble', flag: '🇷🇺', src: 'x' },
  { code: 'PLN', name: 'Polish zloty', flag: '🇵🇱', src: 'ecb' },
  { code: 'DKK', name: 'Danish krone', flag: '🇩🇰', src: 'ecb' },
  { code: 'ILS', name: 'Israeli shekel', flag: '🇮🇱', src: 'ecb' },
  { code: 'THB', name: 'Thai baht', flag: '🇹🇭', src: 'ecb' },
  { code: 'IDR', name: 'Indonesian rupiah', flag: '🇮🇩', src: 'ecb' },
  { code: 'MYR', name: 'Malaysian ringgit', flag: '🇲🇾', src: 'ecb' },
  { code: 'PHP', name: 'Philippine peso', flag: '🇵🇭', src: 'ecb' },
  { code: 'CZK', name: 'Czech koruna', flag: '🇨🇿', src: 'ecb' },
  { code: 'HUF', name: 'Hungarian forint', flag: '🇭🇺', src: 'ecb' },
  { code: 'RON', name: 'Romanian leu', flag: '🇷🇴', src: 'ecb' },
  { code: 'ISK', name: 'Icelandic króna', flag: '🇮🇸', src: 'ecb' },
  { code: 'EGP', name: 'Egyptian pound', flag: '🇪🇬', src: 'x' },
  { code: 'KWD', name: 'Kuwaiti dinar', flag: '🇰🇼', src: 'x' },
  { code: 'MAD', name: 'Moroccan dirham', flag: '🇲🇦', src: 'x' },
  { code: 'TND', name: 'Tunisian dinar', flag: '🇹🇳', src: 'x' },
  { code: 'DZD', name: 'Algerian dinar', flag: '🇩🇿', src: 'x' },
  { code: 'LYD', name: 'Libyan dinar', flag: '🇱🇾', src: 'x' },
  { code: 'SDG', name: 'Sudanese pound', flag: '🇸🇩', src: 'x' },
  { code: 'YER', name: 'Yemeni rial', flag: '🇾🇪', src: 'x' },
  { code: 'IRR', name: 'Iranian rial', flag: '🇮🇷', src: 'x', warn: true },
  { code: 'SYP', name: 'Syrian pound', flag: '🇸🇾', src: 'x', warn: true },
  { code: 'SAR', name: 'Saudi riyal', flag: '🇸🇦', src: 'x', pegged: true },
  { code: 'AED', name: 'UAE dirham', flag: '🇦🇪', src: 'x', pegged: true },
  { code: 'QAR', name: 'Qatari riyal', flag: '🇶🇦', src: 'x', pegged: true },
  { code: 'BHD', name: 'Bahraini dinar', flag: '🇧🇭', src: 'x', pegged: true },
  { code: 'OMR', name: 'Omani rial', flag: '🇴🇲', src: 'x', pegged: true },
  { code: 'JOD', name: 'Jordanian dinar', flag: '🇯🇴', src: 'x', pegged: true },
  { code: 'IQD', name: 'Iraqi dinar', flag: '🇮🇶', src: 'x', pegged: true },
  { code: 'LBP', name: 'Lebanese pound', flag: '🇱🇧', src: 'x', pegged: true },
];
// Left out of the scorecard: a price that doesn't move (pegs) or can't be trusted (warn) can't test a signal
export const scored = cur => !cur.pegged && !cur.warn;

export const pairOf = cur => cur.inv ? `${cur.code}/USD` : `USD/${cur.code}`;
// Both sources give units of the currency per 1 US dollar
export const priceOf = (cur, perUsd) => perUsd > 0 ? +(cur.inv ? 1 / perUsd : perUsd).toPrecision(6) : null;
export const isoDay = d => new Date(d * DAY).toISOString().slice(0, 10);
export const dayNum = iso => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, { tries = 3, timeout = 20e3 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (r.status === 404) { const e = new Error('404 ' + url); e.status = 404; throw e; }
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.json();
    } catch (e) { err = e; if (e.status === 404) break; await sleep(800 * (i + 1)); }
  }
  throw err;
}
export async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ECB rates for every business day in [from, to]: { 'YYYY-MM-DD': { JPY: 157.0, ... } } (units per 1 USD)
export async function fetchEcb(from, to) {
  const d = await getJSON(`${FRANKFURTER}/${from}..${to}?base=USD`);
  return d.rates || {};
}
// The extra feed's rates for one date: { rub: 83.7, sar: 3.75, ... } (units per 1 USD), or null if that day is missing
export async function fetchExtras(date) {
  for (const url of XAPI) {
    try { return (await getJSON(url(date), { tries: 2 })).usd || null; } catch { /* try the mirror */ }
  }
  return null;
}

// Unusual jumps: a one-day move at least SPIKE_X times the currency's typical (median) move over the previous 60
// days, and at least SPIKE_MIN_PCT. Real devaluations (EGP 2024, CHF 2015) are flagged too: either way it's a move
// the indicators weren't built for, and for the extra feed it may be a source switching between official and street
// rates. Returns the indices of the closes that jumped.
export const SPIKE_X = 10, SPIKE_MIN_PCT = 2.5;
export function findSpikes(c) {
  const moves = c.map((v, i) => i ? Math.abs(Math.log(v / c[i - 1])) : 0), out = [];
  for (let i = 1; i < c.length; i++) {
    const past = moves.slice(Math.max(1, i - 60), i).sort((a, b) => a - b);
    if (past.length < 10) continue;                       // too little history to know what's normal: don't flag
    const typical = past[Math.floor(past.length / 2)];
    if (moves[i] * 100 >= SPIKE_MIN_PCT && moves[i] >= SPIKE_X * typical) out.push(i);
  }
  return out;
}

// Business-day closes per currency on the ECB calendar. ecb: as from fetchEcb; extras: { date: { rub: … } }.
// A missing extra-feed value is carried forward from the day before (marked in `filled`).
export function assemble(ecb, extras) {
  const dates = Object.keys(ecb).sort();
  const out = {};
  for (const cur of CURRENCIES) {
    const days = [], c = [];
    let last = null, filled = 0;
    for (const date of dates) {
      let v = cur.src === 'ecb' ? ecb[date]?.[cur.code] : extras[date]?.[cur.code.toLowerCase()];
      if (!(v > 0)) {
        if (cur.src === 'ecb' || last == null) continue;     // nothing to carry forward yet
        v = last; filled++;
      }
      last = v;
      days.push(dayNum(date));
      c.push(priceOf(cur, v));
    }
    out[cur.code] = { days, c, filled, spikes: findSpikes(c) };
  }
  return out;
}

// Price changes over n closes (1 = previous business day, 5 ≈ a week, 21 ≈ a month)
export const BACK = { '24h': 1, '7d': 5, '30d': 21 };
const chg = (c, k) => c.length > k ? (c[c.length - 1] / c[c.length - 1 - k] - 1) * 100 : null;

// US Dollar Index, with ICE's formula: 50.14348112 × EUR/USD^−0.576 × USD/JPY^0.136 × GBP/USD^−0.119 × USD/CAD^0.091
// × USD/SEK^0.042 × USD/CHF^0.036. Pairs here are all USD/XXX, so EUR/USD^−0.576 = USD/EUR^0.576 and every weight is
// positive. Built from the daily ECB rates (14:15 Frankfurt), it tracks the official index (ICE futures, traded around
// the clock) closely but not exactly. The page computes it from forex.json (app/dxy.mjs): no extra requests.
export const DXY_WEIGHTS = { eur: 0.576, jpy: 0.136, gbp: 0.119, cad: 0.091, sek: 0.042, chf: 0.036 };
const DXY_K = 50.14348112;
// hist: forex.json's hist, in its stored USD/XXX quoting. Returns [[time, index], …] for every business day all six
// rates exist, or null if a currency is missing.
export function dxySeries(hist) {
  const ids = Object.keys(DXY_WEIGHTS);
  const byDay = ids.map(id => {
    const h = hist?.[id];
    return h?.c?.length ? new Map(h.c.map((v, i) => [Math.round(h.t0 / DAY) + (h.d ? h.d[i] : i), v])) : null;
  });
  if (byDay.some(m => !m)) return null;
  const days = [...byDay[0].keys()].filter(d => byDay.every(m => m.get(d) > 0)).sort((a, b) => a - b);
  return days.map(d => [d * DAY, +(DXY_K * ids.reduce((p, id, k) => p * byDay[k].get(d) ** DXY_WEIGHTS[id], 1)).toFixed(3)]);
}

// forex.json, in the same shape as data.json so the page can show it the same way
export function toSnapshot(series, { now = Date.now(), params = null, fetched = now, prev = null } = {}) {
  const markets = [], hist = {};
  const lastEcb = Math.max(...CURRENCIES.filter(x => x.src === 'ecb').map(x => series[x.code]?.days.at(-1) ?? 0));
  CURRENCIES.forEach((cur, k) => {
    const s = series[cur.code];
    if (!s?.c.length) return;
    const id = cur.code.toLowerCase(), price = s.c.at(-1);
    markets.push({
      id, fx: true, symbol: pairOf(cur), name: cur.name, flag: cur.flag, image: '', market_cap_rank: k + 1,
      current_price: price, market_cap: null, pegged: !!cur.pegged, warn: !!cur.warn, src: cur.src,
      // the latest unusual jump within the last 21 business days (about a month), if any: shown as ⚠ on the tile
      spike: (() => { const i = s.spikes.filter(j => j >= s.c.length - 21).at(-1); return i == null ? null : { date: isoDay(s.days[i]), pct: (s.c[i] / s.c[i - 1] - 1) * 100 }; })(),
      price_change_percentage_24h_in_currency: chg(s.c, BACK['24h']),
      price_change_percentage_7d_in_currency: chg(s.c, BACK['7d']),
      price_change_percentage_30d_in_currency: chg(s.c, BACK['30d']),
    });
    const t0 = s.days[0] * DAY;
    hist[id] = {
      src: cur.src === 'ecb' ? 'ECB' : 'exchange-api', pair: pairOf(cur), ok: cur.src === 'ecb' ? 1 : 0, t: fetched, t0,
      d: s.days.map(x => x - s.days[0]),   // business days: offsets from t0 (crypto's data.json has one close per day)
      c: s.c, sp: s.spikes,   // sp: indices of unusual one-day jumps (findSpikes)
    };
  });
  return {
    v: 1, market: 'forex', quote: QUOTE, generated: now, fetched, intervalMin: 10, params, marketSrc: 'ECB + exchange-api', marketStale: false,
    rateDate: lastEcb ? isoDay(lastEcb) : prev?.rateDate ?? null,
    markets, cats: { t: now, stable: markets.filter(m => m.pegged).map(m => m.id), gold: [] }, hist,
  };
}

// Extra-feed values already in a previous forex.json, by date, so a rebuild only fetches the days it lacks
function extrasFromPrev(prev) {
  const out = {};
  for (const cur of CURRENCIES.filter(x => x.src === 'x')) {
    const h = prev?.hist?.[cur.code.toLowerCase()];
    if (!h?.d) continue;
    const d0 = Math.floor(h.t0 / DAY);
    h.d.forEach((o, i) => {
      const date = isoDay(d0 + o), v = h.c[i];
      (out[date] ||= {})[cur.code.toLowerCase()] = cur.inv ? 1 / v : v;
    });
  }
  return out;
}

export async function build({ prev = null, params = null, log = console.log, now = Date.now() } = {}) {
  // rates change once a day: between hourly checks, republish the previous file with a fresh timestamp
  if (prev?.v === 1 && prev.market === 'forex' && prev.quote === QUOTE && now - (prev.fetched || 0) < REFETCH) {
    return { ...prev, generated: now, params: params ?? prev.params };
  }
  const to = isoDay(Math.floor(now / DAY)), from = isoDay(Math.floor(now / DAY) - HISTORY_DAYS);
  let ecb;
  try { ecb = await fetchEcb(from, to); } catch (e) {
    log('ECB rates failed: ' + e.message);
    if (prev?.market === 'forex') return { ...prev, generated: now, marketStale: true };
    throw e;
  }
  const extras = extrasFromPrev(prev);
  const need = Object.keys(ecb).filter(d => d >= XAPI_FROM && !extras[d]);
  let got = 0;
  await pool(need, 8, async date => { const r = await fetchExtras(date); if (r) { extras[date] = r; got++; } });
  const series = assemble(ecb, extras);
  const snap = toSnapshot(series, { now, params, fetched: now, prev });
  log(`Forex: ${snap.markets.length} currencies · ECB rates to ${snap.rateDate} · extra feed: ${got}/${need.length} new days fetched`);
  return snap;
}

/* ---------- CLI (Node only) ---------- */
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
if (IS_NODE && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { writeFile, readFile } = await import('node:fs/promises');
  const out = process.argv[2] || 'forex.json';
  let prev = null;
  if (process.env.PREV_URL) {
    try { prev = await getJSON(process.env.PREV_URL + '?b=' + Date.now(), { tries: 2 }); console.log('Loaded previous forex data from ' + process.env.PREV_URL); }
    catch { console.log('No previous forex.json (first run?)'); }
  }
  let params = null;   // signal settings chosen by the forex tuner (scripts/score-forex.mjs)
  try { params = JSON.parse(await readFile(new URL('../params-forex.json', import.meta.url), 'utf8')); } catch { /* defaults */ }
  const data = await build({ prev, params });
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}
