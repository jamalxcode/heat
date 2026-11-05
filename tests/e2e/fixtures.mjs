// Deterministic test data for the browser tests: a data.json and scorecard.json shaped exactly like the real ones,
// built from seeded random walks (no network). Includes coins set up to hit each recommended-stop state.
import * as SIG from '../../signals.mjs';
import { assemble, toSnapshot, CURRENCIES, scored, pairOf, isoDay } from '../../scripts/build-forex.mjs';
import { metalSeries, toSnapshot as metalsSnapshot } from '../../scripts/build-metals.mjs';
import { ENERGY, toHist as energyHist, toSnapshot as energySnapshot } from '../../scripts/build-energy.mjs';
import { ETFS, toHist as etfHist, toSnapshot as etfSnapshot } from '../../scripts/build-etfs.mjs';
import { COUNTRIES as RATE_MARKETS, summarize as rateSummary, EU_MONTHLY, summarizeMonthly, dailyRisk } from '../../scripts/build-rates.mjs';

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
  for (let d = today - 1; weekdays.length < 950; d--) if (![0, 6].includes(new Date(d * DAY).getUTCDay())) weekdays.unshift(d);
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
  // Europe, monthly: five years per country (to Aug 2026), plus Germany for the gap. Italy's gap has widened steadily to
  // 0.85 pp (its widest: high risk), Spain's has narrowed (low risk), the rest wobble around their usual gap
  const months = Array.from({ length: 60 }, (_, i) => { const t = 2026 * 12 + 7 - 59 + i; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; });
  const de = i => 2.5 + i * 0.01, by = { DE: months.map((m, i) => [m, +de(i).toFixed(3)]) };
  const gap = (code, k, i) => code === 'IT' ? 0.85 - (59 - i) * 0.004 : code === 'ES' ? 0.4 + (59 - i) * 0.004 : 0.1 + k * 0.05 + 0.03 * Math.sin(i * 1.3);
  EU_MONTHLY.forEach((c, k) => { by[c.code] = months.map((m, i) => [m, +(de(i) + gap(c.code, k, i)).toFixed(3)]); });
  // inflation for all but Switzerland (so one card shows no real yield); Japan's curve is a week old (a greyed date)
  const infl = x => x.id === 'ch' ? x : { ...x, infl: { v: 2.5, month: '2026-08', src: 'Test' }, real: +(x.y10 - 2.5).toFixed(4) };
  const byId = Object.fromEntries(countries.map(c => [c.id, c]));
  const daily = countries.map(infl).map(c => ({ ...c, risk: dailyRisk(c, byId) })).map(c => c.id === 'jp' ? { ...c, date: new Date((today - 8) * DAY).toISOString().slice(0, 10) } : c);
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

// Prediction markets (predictions.json): four venues answering, Betfair not set up. In "All", with play money off and
// single games hidden: pm:mayor (who wins), pm:fed (yes/no, 30% yes), ks:SEN merged with PredictIt's pi:SEN (55% vs
// 61%: ⚡), pm:thin (a thin market), pi:8000 (one named option, no money figures); ks:DONE is 99% sure (decided);
// mf:x is play money; ks:GAME is a single game.
export function makePredictionsFixture(now = Date.now()) {
  const DAY = 864e5, today = Math.floor(now / DAY);
  const m = (id, venue, title, cat, outcomes, extra = {}) => ({ id, venue, title, cat, url: 'https://example.invalid/' + id, end: '2099-12-31', head: outcomes[0].name, exclusive: true, outcomes, more: 0, cur: 'USD', ...extra });
  const markets = [
    m('pm:mayor', 'polymarket', 'NYC mayor winner?', 'Politics', [{ name: 'Alice', p: 0.71, d1: 0.05, d7: 0.12, d30: -0.03, sp: 0.01 }, { name: 'Bob', p: 0.27, d1: -0.04, d7: null, d30: null }, { name: 'Carol', p: 0.02, d1: 0, d7: null, d30: null }], { vol24: 5e6, vol: 9e7, liq: 2e6 }),
    m('pm:fed', 'polymarket', 'Fed cut in December?', 'Economy', [{ name: 'Yes', p: 0.3, d1: -0.08, d7: 0.01, d30: 0.2 }], { vol24: 1e6, vol: 2e7 }),
    m('ks:SEN', 'kalshi', 'Senate control after the midterms?', 'Politics', [{ name: 'Democrats', p: 0.55, d1: 0.02, d7: null, d30: null }, { name: 'Republicans', p: 0.45, d1: -0.02, d7: null, d30: null }], { vol24: 2e6, vol: 5e7, oi: 1e6, group: 'ks:SEN' }),
    m('pi:SEN', 'predictit', 'Which party will control the Senate after the midterms?', 'Politics', [{ name: 'Democrats', p: 0.65, d1: 0, d7: null, d30: null }, { name: 'Republicans', p: 0.36, d1: 0, d7: null, d30: null }], { vol24: null, vol: null, group: 'ks:SEN', ord: 2 }),
    m('pi:8000', 'predictit', 'Who will win the 2028 presidential election?', 'Politics', [{ name: 'Vance', p: 0.31, d1: 0.02, d7: null, d30: null }], { vol24: null, vol: null, ord: 1 }),
    m('pm:thin', 'polymarket', 'Will a tiny thing happen?', 'Other', [{ name: 'Yes', p: 0.4, d1: 0, d7: null, d30: null }], { vol24: 100, vol: 600 }),
    m('ks:DONE', 'kalshi', 'Blue wave in 2026?', 'Politics', [{ name: 'Yes', p: 0.99, d1: 0.3, d7: null, d30: null }], { vol24: 3e6, vol: 1e7 }),
    m('ks:GAME', 'kalshi', 'Lakers vs Celtics', 'Sports', [{ name: 'Lakers', p: 0.6, d1: 0, d7: null, d30: null }, { name: 'Celtics', p: 0.4, d1: 0, d7: null, d30: null }], { vol24: 4e6, vol: 5e6 }),
    // a second Senate-control question (a story card's extra line) and a short-term price bet with a blank in its title
    m('pm:seats', 'polymarket', 'How many Senate seats will Democrats hold after the Midterms?', 'Politics', [{ name: 'Below 50', p: 0.62, d1: 0, d7: null, d30: null }, { name: '50 or more', p: 0.38, d1: 0, d7: null, d30: null }], { vol24: 2, vol: 60 }),
    m('pm:btc', 'polymarket', 'Bitcoin above ___ on November 5?', 'Crypto', [{ name: '↑ 80,000', p: 0.6, d1: 0, d7: null, d30: null }, { name: '↑ 84,000', p: 0.1, d1: 0, d7: null, d30: null }], { exclusive: false, vol24: 60, vol: 600, end: new Date(now + DAY).toISOString().slice(0, 10) }),
    // decided yesterday, an upset (24% a week before); a ladder whose "by...?" title takes the step shown
    m('ks:WON', 'kalshi', 'NC-05 House winner?', 'Politics', [{ name: 'Chuck Hubbard', p: 0.98, d1: 0.5, d7: 0.74, d30: null }, { name: 'Virginia Foxx', p: 0.02, d1: -0.5, d7: -0.74, d30: null }], { vol24: 9e5, vol: 3e6, end: new Date(now - DAY).toISOString().slice(0, 10) }),
    m('pm:by', 'polymarket', 'Netanyahu out by...?', 'World', [{ name: 'June 30, 2027', p: 0.43, d1: 0, d7: null, d30: null }, { name: 'December 31, 2026', p: 0.2, d1: 0, d7: null, d30: null }], { exclusive: false, vol24: 10, vol: 300 }),
    // a both-ways price ladder ("↓ 2,000" is a fall) and a daily weather question whose day was yesterday
    m('pm:eth', 'polymarket', 'What price will Ethereum hit in 2026?', 'Crypto', [{ name: '↓ 2,000', p: 0.27, d1: 0, d7: null, d30: null }, { name: '↑ 3,000', p: 0.25, d1: 0, d7: null, d30: null }], { exclusive: false, vol24: 8, vol: 240 }),
    m('ks:RAIN', 'kalshi', `Where will it rain on ${new Date(now - DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}?`, 'Climate', [{ name: 'Tampa', p: 0.3, d1: 0, d7: null, d30: null }, { name: 'Miami', p: 0.2, d1: 0, d7: null, d30: null }], { exclusive: false, vol24: 5e4, vol: 6e4, end: new Date(now + DAY).toISOString().slice(0, 10) }),
    // called: 95% after +35 points this week (60% a week before: no upset), not yet settled
    m('pm:call', 'polymarket', 'Ohio Senate winner?', 'Politics', [{ name: 'Sherrod Brown', p: 0.95, d1: 0.2, d7: 0.35, d30: null }, { name: 'Jon Husted', p: 0.05, d1: -0.2, d7: -0.35, d30: null }], { vol24: 4e5, vol: 2e6 }),
    m('mf:x', 'manifold', 'Will Bitcoin hit $200k in 2026?', 'Crypto', [{ name: 'Yes', p: 0.12, d1: 0.01, d7: null, d30: null }], { vol24: 5000, vol: 9e4, cur: 'MANA', traders: 40 }),
  ];
  for (const x of markets) { x.usd24 = x.vol24 == null ? null : x.cur === 'MANA' ? x.vol24 / 100 : x.vol24; x.usdTotal = x.vol == null ? null : x.cur === 'MANA' ? x.vol / 100 : x.vol; x.interest = Math.round((x.usd24 || 0) + (x.usdTotal || 0) / 30); }
  markets.sort((a, b) => b.interest - a.interest).forEach((x, i) => { x.rank = i + 1; });
  const ok = n => ({ state: 'ok', n, at: now });
  return {
    v: 1, market: 'predictions', generated: now - 60e3, usdPerGbp: 1.3, kalshi: { scanned: now, tickers: ['SEN'] },
    venues: { polymarket: ok(3), kalshi: ok(3), predictit: ok(2), manifold: ok(1), betfair: { state: 'off', n: 0, at: null, err: 'not connected: needs a Betfair API key' } },
    // the track record: 40 settled answers, those priced 70–90% a week before happening 3 times in 4
    results: [{ id: 'pm:old', t: 'An old question', v: 'polymarket', d: today - 3, w: 'Yes', pairs: Array.from({ length: 40 }, (_, i) => [i < 20 ? 0.8 : 0.05, i < 15 ? 1 : 0]) }],
    markets, hist: { 'pm:mayor': { o: 'Alice', d: today - 3, p: [0.6, 0.64, 0.66, 0.71] } },
  };
}
