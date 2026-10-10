// Deterministic test data for the browser tests: a data.json and scorecard.json shaped exactly like the real ones,
// built from seeded random walks (no network). Includes coins set up to hit each recommended-stop state.
import * as SIG from '../../signals.mjs';
import { assemble, toSnapshot, CURRENCIES, scored, pairOf, isoDay } from '../../scripts/build-forex.mjs';
import { metalSeries, toSnapshot as metalsSnapshot } from '../../scripts/build-metals.mjs';
import { ENERGY, toHist as energyHist, toSnapshot as energySnapshot } from '../../scripts/build-energy.mjs';
import { ETFS, toHist as etfHist, toSnapshot as etfSnapshot } from '../../scripts/build-etfs.mjs';
import { COUNTRIES as RATE_MARKETS, summarize as rateSummary, EU_MONTHLY, summarizeMonthly } from '../../scripts/build-rates.mjs';

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
    // volume for the last 60 days: steady, except Moon, whose volume tripled over the last week while it climbed
    const v = Array.from({ length: 60 }, (_, i) => id === 'moon-coin' && i >= 52 ? 3e6 : 1e6);
    hist[id] = { src: 'Binance', pair: `${sym}/USDT`, ok: id === 'beta-coin' ? 0 : 1, t: now, t0, c, v };
    complete.push({ id, symbol: sym, t0, c: c.slice(0, N - 1) });            // the scorer only sees complete days
  });
  const data = { v: 1, generated: now, intervalMin: 10, params: null, marketSrc: 'Fixture', marketStale: false, markets, cats: { t: 0, stable: [], gold: [] }, hist };
  const { card } = SIG.buildScorecard(complete, null, { prev: { tuning: { lastRun: '2026-01-01T00:00:00Z', history: [] } }, tuneNow: false, now });
  return { data, scorecard: card };
}

// Forex: business days only (no weekends), built through the real build-forex.mjs helpers, so the browser tests
// also check that forex.json comes out in the shape the page expects.
// [code, seed, daily drift] in units per US dollar (every pair is stored USD/XXX)
export const FX_SPEC = [
  ['EUR', 21, -0.0004],   // ECB, USD/EUR
  ['JPY', 22, 0.0006],    // ECB, quoted USD/JPY
  ['GBP', 23, 0.0001],
  ['CHF', 24, -0.0002],
  ['CAD', 28, 0.0002],    // with EUR, JPY, GBP, CHF and SEK: the six currencies of the US Dollar Index bar
  ['SEK', 29, -0.0001],
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
    const base = { EUR: 0.9, JPY: 150, GBP: 0.78, CHF: 0.85, CAD: 1.36, SEK: 10.5, RUB: 85, EGP: 48, SAR: 3.75, IRR: 1.2e6 }[code];
    const c = seed ? walk(seed, FX_N, drift, 0.004).map(v => v / 100 * base) : Array(FX_N).fill(base);
    if (code === 'EGP') c[FX_N - 1] = c[FX_N - 2] * 1.15;   // an unusual one-day jump: flagged ⚠ (findSpikes)
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

// Metals: gold, silver, platinum, palladium from fake feed values (ounces per dollar, one per calendar day), plus a
// "bitcoin" tile copied from the crypto test data (alpha-coin under Bitcoin's id), built by the real build-metals.mjs.
export function makeMetalsFixtures(cryptoData, now = Date.now()) {
  const today = Math.floor(now / DAY), days = {};
  const base = { xau: 4000, xag: 60, xpt: 1700, xpd: 1200 };
  const walks = Object.fromEntries(Object.keys(base).map((m, k) => [m, walk(31 + k, FX_N, 0.0005 * (k - 1), 0.012)]));
  for (let i = 0; i < FX_N; i++) {
    const date = isoDay(today - FX_N + 1 + i);
    days[date] = Object.fromEntries(Object.keys(base).map(m => [m, 1 / (walks[m][i] / 100 * base[m])]));
  }
  const alpha = cryptoData.markets.find(m => m.id === 'alpha-coin');
  const crypto = { markets: [{ ...alpha, id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }], hist: { bitcoin: cryptoData.hist['alpha-coin'] } };
  // cross-check: gold confirmed by the second source, silver 2.4% apart (⚠), the others not checked yet
  const day = isoDay(today - 1);
  const check = { xau: { day, diff: 0.12, ok: true }, xag: { day, diff: -2.4, ok: false } };
  const sources = { primary: { name: 'exchange-api', latest: day, ok: true }, second: { name: 'Swissquote', ok: true, at: now }, agree: false };
  return metalsSnapshot(metalSeries(days), crypto, { now, check, sources });
}

// tv.json: which TradingView symbols exist. Alpha's exchange pair and both directions of JPY exist; Beta's ticker
// exists only under a different coin's name (so it must not be linked); gold exists; nothing else was found.
export function makeTvFixture(now = Date.now()) {
  return { v: 1, t: now, sym: {
    'BINANCE:ALPUSDT': [1, now, 'Alpha Coin / TetherUS'],
    'BINANCE:BETUSDT': [0, now, ''], 'CRYPTO:BETUSD': [1, now, 'Betting Token'], 'COINBASE:BETUSD': [0, now, ''],
    'FX_IDC:USDJPY': [1, now, 'U.S. DOLLAR / JAPANESE YEN'], 'FX_IDC:JPYUSD': [1, now, 'JAPANESE YEN / U.S. DOLLAR'],
    'TVC:GOLD': [1, now, 'Gold'],
    'NYMEX:CL1!': [1, now, 'Crude Oil Futures'],
    'AMEX:SPY': [1, now, 'State Street SPDR S&P 500 ETF Trust'],
    'TVC:US10Y': [1, now, 'United States 10 Year Government Bonds Yield'], 'TVC:IT10Y': [1, now, 'Italy 10 Year Government Bonds Yield'],
  } };
}

// health.json: every source fine except Swissquote's cross-check (silver disagrees)
export function makeHealthFixture(now = Date.now()) {
  return { v: 1, t: now, sources: [
    { key: 'rankings', name: 'CoinGecko', what: 'crypto prices and rankings', state: 'ok', note: 'live' },
    { key: 'ecb', name: 'ECB', what: 'official currency rates', state: 'ok', note: 'rates of today' },
    { key: 'swissquote', name: 'Swissquote', what: 'current metal prices, cross-check', state: 'warn', note: 'live · disagrees: Silver 2.4%' },
  ] };
}

// energy.json: the six futures over ~300 weekdays (no weekend candles), quoted 15 minutes ago; TTF's latest update
// failed, so it keeps its last price and is flagged as not refreshed
export function makeEnergyFixtures(cryptoData, now = Date.now()) {
  const today = Math.floor(now / DAY), weekdays = [];
  for (let d = today; weekdays.length < 300; d--) if (![0, 6].includes(new Date(d * DAY).getUTCDay())) weekdays.unshift(d);
  const base = { wti: 90, brent: 100, diesel: 4.5, gasoline: 3.2, natgas: 3.05, ttf: 73 };
  const series = {}, quotes = {};
  ENERGY.forEach((a, k) => {
    const w = walk(41 + k, weekdays.length, 0.0006 * (k - 2), 0.02);
    series[a.id] = energyHist(new Map(weekdays.map((d, i) => [d, +(w[i] / 100 * base[a.id]).toPrecision(6)])), a, now);
    if (a.id !== 'ttf') quotes[a.id] = { price: series[a.id].c.at(-1), t: now - 15 * 60e3 };
  });
  const snap = energySnapshot(series, { params: cryptoData.params }, { now, quotes });
  const ttf = snap.markets.find(m => m.id === 'ttf');
  Object.assign(ttf, { notRefreshed: true, quoteAt: now - 3 * 3600e3 });
  return snap;
}

// etfs.json: all 112 funds over ~300 weekdays with volume, quoted 10 minutes ago; KSA's latest update failed, so it
// keeps its last price and is flagged as not refreshed
export function makeEtfsFixture(cryptoData, now = Date.now()) {
  const today = Math.floor(now / DAY), weekdays = [];
  for (let d = today; weekdays.length < 300; d--) if (![0, 6].includes(new Date(d * DAY).getUTCDay())) weekdays.unshift(d);
  const series = {}, quotes = {}, info = {};
  ETFS.forEach((a, k) => {
    const w = walk(101 + k, weekdays.length, 0.0004 * ((k % 7) - 3), 0.015);
    const vols = new Map(weekdays.map((d, i) => [d, 1e6 * (1 + (i % 5))]));
    series[a.id] = etfHist(new Map(weekdays.map((d, i) => [d, +(w[i] * (1 + k % 9)).toPrecision(6)])), vols, a, now);
    info[a.id] = { name: `${a.yahoo} Fund Trust`, exch: a.yahoo === 'QQQ' ? 'NGM' : 'PCX' };
    if (a.id !== 'ksa') quotes[a.id] = { price: series[a.id].c.at(-1), t: now - 10 * 60e3 };
  });
  const snap = etfSnapshot(series, { params: cryptoData.params }, { now, quotes, info });
  Object.assign(snap.markets.find(m => m.id === 'ksa'), { notRefreshed: true, quoteAt: now - 2 * 3600e3 });
  return snap;
}

// rates.json: the fourteen daily markets over ~2 years of weekdays. Canada's curve is inverted, the euro area's flat, the rest normal;
// the US 10-year rose 4 bp on the last day
export function makeRatesFixture(now = Date.now()) {
  const today = Math.floor(now / DAY), weekdays = [];
  for (let d = today - 1; weekdays.length < 520; d--) if (![0, 6].includes(new Date(d * DAY).getUTCDay())) weekdays.unshift(d);
  const slope = { us: 1, ea: 0.3, de: 0.8, uk: 1.2, jp: 1.1, ca: -0.4, au: 0.9, ch: 0.7, se: 0.9, no: 0.6, br: 1.5, cn: 0.6, in: 0.7, za: 2 };
  const level = { us: 4.3, ea: 2.8, de: 2.7, uk: 4.0, jp: 1.5, ca: 3.4, au: 3.6, ch: 0.3, se: 2.5, no: 4.0, br: 13, cn: 1.5, in: 6.5, za: 7 };
  const countries = RATE_MARKETS.map((c, k) => {
    const w = walk(61 + k, weekdays.length, 0, c.id === 'us' ? 0 : 0.004), days = new Map();   // the US flat until its last day
    weekdays.forEach((d, i) => {
      const base = level[c.id] * w[i] / 100 + (c.id === 'us' && i === weekdays.length - 1 ? 0.04 : 0);
      const tenors = c.id === 'uk' ? [0, 5, 10, 20] : [0.25, 2, 5, 10, 30];
      days.set(d, tenors.map(t => [t, +(base + slope[c.id] * Math.min(t, 10) / 10 - (t <= 2 ? slope[c.id] * (2 - t) / 10 : 0)).toFixed(4)]));
    });
    return rateSummary(c, days, now);
  });
  // Europe, monthly: 25 months per country, plus Germany for the gap; Italy 0.8 pp above Germany
  const months = Array.from({ length: 25 }, (_, i) => { const t = 2024 * 12 + 7 + i; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; });
  const by = { DE: months.map((m, i) => [m, +(2.5 + i * 0.01).toFixed(3)]) };
  EU_MONTHLY.forEach((c, k) => { by[c.code] = months.map((m, i) => [m, +(2.5 + (c.code === 'IT' ? 0.8 : 0.1 + k * 0.05) + i * 0.012).toFixed(3)]); });
  // inflation for all but Switzerland (so one card shows no real yield); Japan's curve is a week old (a greyed date)
  const infl = x => x.id === 'ch' ? x : { ...x, infl: { v: 2.5, month: '2026-08', src: 'Test' }, real: +(x.y10 - 2.5).toFixed(4) };
  const daily = countries.map(infl).map(c => c.id === 'jp' ? { ...c, date: new Date((today - 8) * DAY).toISOString().slice(0, 10) } : c);
  return { v: 1, fmt: 1, market: 'rates', generated: now, fetched: now, flatPP: 0.5, countries: daily, monthly: summarizeMonthly(by).map(infl) };
}

// fuel.json: pump prices for three countries (Germany new this week, so no change yet) and two US spot prices
export function makeFuelFixture(now = Date.now()) {
  const d = new Date(now - 2 * DAY).toISOString().slice(0, 10), rate = { EUR: 1.1, GBP: 1.3, USD: 1 };
  const pump = (id, name, flag, region, cur, petrol, diesel, chg) => ({ id, name, flag, badge: id.toUpperCase(), region, cur, unit: 'litre', src: 'Test', srcUrl: '', date: d,
    petrol: { local: petrol, usdL: petrol * rate[cur], chg }, diesel: { local: diesel, usdL: diesel * rate[cur], chg: null }, hist: [] });
  return {
    v: 1, fmt: 1, generated: now, fetched: now, fx: rate,
    pump: [pump('us', 'United States', '🇺🇸', 'Americas', 'USD', 1.15, 1.64, -2.5), pump('uk', 'United Kingdom', '🇬🇧', 'Europe', 'GBP', 1.75, 1.99, 0.8), pump('de', 'Germany', '🇩🇪', 'Europe', 'EUR', 2.35, 2.44, null)],
    spot: [
      { id: 'DDFUELNYH', name: 'Diesel (ULSD)', where: 'New York Harbor', usdGal: 5, date: d, chg1w: -0.2, chg1m: 14.9, series: [[d, 4.9], [d, 5]] },
      { id: 'DJFUELUSGULF', name: 'Jet fuel', where: 'US Gulf Coast', usdGal: 4.4, date: d, chg1w: 1, chg1m: 15.6, series: [[d, 4.3], [d, 4.4]] },
    ],
  };
}
