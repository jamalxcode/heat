// Deterministic test data for the browser tests: a data.json and scorecard.json shaped exactly like the real ones,
// built from seeded random walks (no network). Includes coins set up to hit each recommended-stop state.
import * as SIG from '../../signals.mjs';

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
