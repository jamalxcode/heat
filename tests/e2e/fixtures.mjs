// Deterministic test data for the browser tests: a data.json and scorecard.json shaped exactly like the real ones,
// built from seeded random walks (no network). Includes coins set up to hit each recommended-stop state.
import * as SIG from '../../signals.mjs';
import { assemble, toSnapshot, CURRENCIES, scored, pairOf, isoDay } from '../../scripts/build-forex.mjs';

const DAY = 864e5, N = 260;

// Lehmer random walk: same numbers every run
function walk(seed, n, drift, vol = 0.03) {
  let x = seed * 7919, p = 100;
  const out = [];
  for (let i = 0; i < n; i++) {
    x = (x * 48271) % 2147483647;
    p *= 1 + drift + (x / 2147483647 - 0.5) * vol * 2;
    out.push(+p.toPrecision(7));
  }
  return out;
}

// [id, symbol, name, seed, daily drift]
export const SPEC = [
  ['alpha-coin', 'ALP', 'Alpha', 1, 0.004],
  ['beta-coin', 'BET', 'Beta', 2, -0.003],       // ticker-only match (shows ?)
  ['moon-coin', 'MOON', 'Moon', 3, 0.012],       // steep uptrend
  ['closed-coin', 'CLS', 'Closed', 4, 0.001],    // yesterday's close fell 15%: closed below the long stop
  ['intraday-coin', 'INT', 'Intraday', 5, 0.001], // down 20% today, not yet confirmed by a close
  ['gamma-coin', 'GAM', 'Gamma', 6, 0.002],
  ['delta-coin', 'DEL', 'Delta', 7, -0.006],
  ['eps-coin', 'EPS', 'Epsilon', 8, 0],
  ['zeta-coin', 'ZET', 'Zeta', 9, 0.001],
  ['eta-coin', 'ETA', 'Eta', 10, -0.001],
  ['theta-coin', 'THE', 'Theta', 11, 0.003],
  ['iota-coin', 'IOT', 'Iota', 12, -0.002],
];

export function makeFixtures(now = Date.now()) {
  const today = Math.floor(now / DAY), t0 = (today - N + 1) * DAY;   // last candle = today (still forming)
  const markets = [], hist = {}, complete = [];
  SPEC.forEach(([id, sym, name, seed, drift], k) => {
    const c = walk(seed, N, drift);
    if (id === 'closed-coin') { c[N - 2] = +(c[N - 3] * 0.85).toPrecision(7); c[N - 1] = c[N - 2]; }
    if (id === 'intraday-coin') { c[N - 2] = c[N - 3]; c[N - 1] = c[N - 2]; }
    const price = id === 'intraday-coin' ? +(c[N - 2] * 0.8).toPrecision(7) : c[N - 1];
    const pct = back => (price / c[N - 1 - back] - 1) * 100;
    markets.push({
      id, symbol: sym.toLowerCase(), name: `${name} Coin`, image: '', market_cap_rank: k + 1,
      current_price: price, market_cap: 1e9 * (SPEC.length - k),
      price_change_percentage_24h_in_currency: pct(1), price_change_percentage_7d_in_currency: pct(7), price_change_percentage_30d_in_currency: pct(30),
    });
    hist[id] = { src: 'Binance', pair: `${sym}/USDT`, ok: id === 'beta-coin' ? 0 : 1, t: now, t0, c };
    complete.push({ id, symbol: sym, t0, c: c.slice(0, N - 1) });            // the scorer only sees complete days
  });
  const data = { v: 1, generated: now, intervalMin: 10, params: null, marketSrc: 'Fixture', marketStale: false, markets, cats: { t: 0, stable: [], gold: [] }, hist };
  const { card } = SIG.buildScorecard(complete, null, { prev: { tuning: { lastRun: '2026-01-01T00:00:00Z', history: [] } }, tuneNow: false, now });
  return { data, scorecard: card };
}

// Forex: business days only (no weekends), built through the real build-forex.mjs helpers, so the browser tests
// also check that forex.json comes out in the shape the page expects.
// [code, seed, daily drift] in units per US dollar (the builder flips EUR to EUR/USD)
export const FX_SPEC = [
  ['EUR', 21, -0.0004],   // ECB, quoted EUR/USD
  ['JPY', 22, 0.0006],    // ECB, quoted USD/JPY
  ['GBP', 23, 0.0001],
  ['CHF', 24, -0.0002],
  ['RUB', 25, 0.0008],    // extra feed: "?" mark
  ['EGP', 26, 0.0015],
  ['SAR', 0, 0],          // pegged to the dollar: hidden until "Pegged" is ticked
  ['IRR', 27, 0.002],     // extra feed with a warning (official and market rates differ)
];
export const FX_N = 260;
export function makeForexFixtures(now = Date.now()) {
  const days = [];
  for (let d = Math.floor(now / DAY) - 1; days.length < FX_N; d--) { const wd = new Date(d * DAY).getUTCDay(); if (wd !== 0 && wd !== 6) days.unshift(d); }
  const ecb = {}, extras = {};
  for (const [code, seed, drift] of FX_SPEC) {
    const base = { EUR: 0.9, JPY: 150, GBP: 0.78, CHF: 0.85, RUB: 85, EGP: 48, SAR: 3.75, IRR: 1.2e6 }[code];
    const c = seed ? walk(seed, FX_N, drift, 0.004).map(v => v / 100 * base) : Array(FX_N).fill(base);
    const src = CURRENCIES.find(x => x.code === code).src;
    days.forEach((d, i) => {
      const date = isoDay(d);
      if (src === 'ecb') (ecb[date] ||= {})[code] = c[i];
      else { ecb[date] ||= {}; (extras[date] ||= {})[code.toLowerCase()] = c[i]; }
    });
  }
  const series = assemble(ecb, extras);
  const data = toSnapshot(series, { now });
  data.markets = data.markets.filter(m => FX_SPEC.some(([code]) => code.toLowerCase() === m.id));
  const coins = CURRENCIES.filter(cur => scored(cur) && series[cur.code]?.c.length)
    .map(cur => ({ id: cur.code.toLowerCase(), symbol: pairOf(cur), name: cur.name, t0: series[cur.code].days[0] * DAY, c: series[cur.code].c, days: series[cur.code].days }));
  const { card } = SIG.buildScorecard(coins, { momPct: 3, momDays: 21 }, { prev: { tuning: { lastRun: '2026-01-01T00:00:00Z', history: [] } }, tuneNow: false, now });
  return { data, scorecard: card };
}
