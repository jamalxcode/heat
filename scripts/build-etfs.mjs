// Builds etfs.json for heat.sala.company/etfs/: 112 US-listed stock ETFs (the US market, its sectors, industries and
// themes, and markets abroad). Runs in the deploy job right after data.json (every 10 minutes).
//   node scripts/build-etfs.mjs <out.json> <data.json>      (env PREV_URL = the last published etfs.json)
// Source: Yahoo Finance's public chart data (unofficial, no key), as for the energy page.
//   - The list (Oct 2026): the most traded stock ETFs by dollars a day (3-month average), keeping one fund per index
//     (SPY, not VOO/IVV/SPYM too) and dropping any under $5m a day. No bond, cash, leveraged or inverse funds; gold,
//     silver and crypto funds are on the metals and crypto pages. Re-check it now and then: ETFs come and go.
//   - Every 10 minutes: one bulk request per 20 funds (Yahoo's limit) for today's 5-minute bars, whose last close is
//     the latest price. US ETF quotes there are close to real time, so a price here is at most about 10–20 minutes old.
//   - Hourly: each fund's two-year daily history with volume (112 small requests), which also corrects the day's
//     close to the official one and picks up the fund's full name and exchange.
//   - Stocks trade on weekdays (9:30–16:00 New York time): one close per trading day, so the changes are 1 trading
//     day, 1 week (5) and 1 month (21), as for energy. Nothing is carried over weekends or holidays.
//   - A fund Yahoo doesn't answer for keeps its last price, flagged as not refreshed; if Yahoo fails entirely, the last
//     good etfs.json is republished (see the deploy job).
// build() has no Node dependencies, so tests can run it with a fake fetch.
import { pool, isoDay, DAY } from './build-forex.mjs';
import { parseChart } from './build-energy.mjs';

const HISTORY_DAYS = 760;               // calendar days kept (~2 years): indicators need 260 trading days
const VOL_DAYS = 60;                    // trading days of volume kept (the volume signal compares 7 days with the 30 before)
const REFETCH = 60 * 60e3;              // the full history, hourly
const BATCH = 20;                       // Yahoo's bulk endpoint takes at most 20 symbols
const FMT = 1;

// [ticker, group, short name, flag]. The order is the page's order: by group, then as listed.
export const GROUPS = [
  ['us', 'US stock market'],
  ['sector', 'Sectors'],
  ['theme', 'Industries & themes'],
  ['intl', 'International'],
];
const LIST = [
  // the US market: benchmarks, size, style, factors, dividends and income
  ['SPY', 'us', 'S&P 500'], ['RSP', 'us', 'S&P 500 equal weight'], ['QQQ', 'us', 'Nasdaq-100'], ['DIA', 'us', 'Dow Jones'],
  ['VTI', 'us', 'Total US market'], ['IJH', 'us', 'Mid caps (S&P 400)'], ['IWM', 'us', 'Small caps (Russell 2000)'], ['IJR', 'us', 'Small caps (S&P 600)'],
  ['VUG', 'us', 'Large-cap growth'], ['VTV', 'us', 'Large-cap value'], ['IWO', 'us', 'Small-cap growth'], ['IWN', 'us', 'Small-cap value'],
  ['AVUV', 'us', 'Small-cap value (Avantis)'], ['MTUM', 'us', 'Momentum'], ['QUAL', 'us', 'Quality'], ['USMV', 'us', 'Minimum volatility'],
  ['VLUE', 'us', 'Value factor'], ['COWZ', 'us', 'Free cash flow'], ['MOAT', 'us', 'Wide-moat companies'], ['DYNF', 'us', 'Factor rotation'],
  ['SCHD', 'us', 'Dividend stocks'], ['VIG', 'us', 'Dividend growers'], ['HDV', 'us', 'High dividend'], ['NOBL', 'us', 'Dividend Aristocrats'],
  ['DVY', 'us', 'Select dividend'], ['CGDV', 'us', 'Dividend value (active)'], ['JEPI', 'us', 'S&P 500 covered calls'], ['JEPQ', 'us', 'Nasdaq covered calls'],
  // the eleven S&P 500 sectors
  ['XLK', 'sector', 'Technology'], ['XLF', 'sector', 'Financials'], ['XLV', 'sector', 'Health care'], ['XLE', 'sector', 'Energy'],
  ['XLI', 'sector', 'Industrials'], ['XLY', 'sector', 'Consumer discretionary'], ['XLP', 'sector', 'Consumer staples'], ['XLU', 'sector', 'Utilities'],
  ['XLB', 'sector', 'Materials'], ['XLRE', 'sector', 'Real estate'], ['XLC', 'sector', 'Communication services'],
  // industries and themes, by the sector they sit in
  ['SMH', 'theme', 'Semiconductors'], ['XSD', 'theme', 'Semiconductors (equal weight)'], ['DRAM', 'theme', 'Memory chips'], ['IGV', 'theme', 'Software'],
  ['SKYY', 'theme', 'Cloud computing'], ['CIBR', 'theme', 'Cybersecurity'], ['AIQ', 'theme', 'Artificial intelligence'], ['BOTZ', 'theme', 'Robotics & AI'],
  ['FDN', 'theme', 'Internet'],
  ['XBI', 'theme', 'Biotech (equal weight)'], ['IBB', 'theme', 'Biotech'], ['IHI', 'theme', 'Medical devices'], ['IHF', 'theme', 'Healthcare providers'],
  ['PPH', 'theme', 'Pharma'], ['ARKG', 'theme', 'Genomics'],
  ['KRE', 'theme', 'Regional banks'], ['KBWB', 'theme', 'Big banks'], ['KIE', 'theme', 'Insurance'],
  ['XOP', 'theme', 'Oil & gas producers'], ['AMLP', 'theme', 'Pipelines'], ['URA', 'theme', 'Uranium'],
  ['GDX', 'theme', 'Gold miners'], ['XME', 'theme', 'Metals & mining'], ['COPX', 'theme', 'Copper miners'], ['REMX', 'theme', 'Rare earths'],
  ['LIT', 'theme', 'Lithium & batteries'],
  ['ITA', 'theme', 'Aerospace & defence'], ['SHLD', 'theme', 'Defence tech'], ['UFO', 'theme', 'Space'], ['IYT', 'theme', 'Transport'],
  ['JETS', 'theme', 'Airlines'], ['PAVE', 'theme', 'US infrastructure'],
  ['XRT', 'theme', 'Retail'], ['ITB', 'theme', 'Homebuilders'],
  ['ICLN', 'theme', 'Clean energy'], ['TAN', 'theme', 'Solar'], ['GRID', 'theme', 'Power grid'],
  ['ARKK', 'theme', 'Disruptive innovation (ARK)'], ['MAGS', 'theme', 'Magnificent Seven'],
  // markets abroad: the world, regions, then single countries
  ['VT', 'intl', 'Whole world'], ['VXUS', 'intl', 'World outside the US'], ['EFA', 'intl', 'Developed markets'], ['EFV', 'intl', 'Developed markets value'],
  ['EEM', 'intl', 'Emerging markets'], ['EMXC', 'intl', 'Emerging markets ex-China'],
  ['VGK', 'intl', 'Europe', '🇪🇺'], ['FEZ', 'intl', 'Euro Stoxx 50', '🇪🇺'], ['EWU', 'intl', 'United Kingdom', '🇬🇧'], ['EWG', 'intl', 'Germany', '🇩🇪'],
  ['EWL', 'intl', 'Switzerland', '🇨🇭'], ['EWQ', 'intl', 'France', '🇫🇷'], ['EWN', 'intl', 'Netherlands', '🇳🇱'],
  ['EWJ', 'intl', 'Japan', '🇯🇵'], ['DXJ', 'intl', 'Japan (currency hedged)', '🇯🇵'], ['AAXJ', 'intl', 'Asia ex-Japan'],
  ['EWY', 'intl', 'South Korea', '🇰🇷'], ['EWT', 'intl', 'Taiwan', '🇹🇼'], ['EWA', 'intl', 'Australia', '🇦🇺'], ['EWH', 'intl', 'Hong Kong', '🇭🇰'],
  ['EWS', 'intl', 'Singapore', '🇸🇬'],
  ['FXI', 'intl', 'China large caps', '🇨🇳'], ['KWEB', 'intl', 'China internet', '🇨🇳'], ['ASHR', 'intl', 'China A-shares', '🇨🇳'], ['INDA', 'intl', 'India', '🇮🇳'],
  ['EWZ', 'intl', 'Brazil', '🇧🇷'], ['EWC', 'intl', 'Canada', '🇨🇦'], ['EWW', 'intl', 'Mexico', '🇲🇽'], ['ILF', 'intl', 'Latin America'],
  ['ECH', 'intl', 'Chile', '🇨🇱'], ['ARGT', 'intl', 'Argentina', '🇦🇷'],
  ['KSA', 'intl', 'Saudi Arabia', '🇸🇦'], ['EZA', 'intl', 'South Africa', '🇿🇦'], ['TUR', 'intl', 'Turkey', '🇹🇷'],
];
export const ETFS = LIST.map(([yahoo, group, name, flag]) => ({ id: yahoo.toLowerCase(), yahoo, group, name, flag: flag || null }));

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const HEADERS = { 'user-agent': 'Mozilla/5.0 (heat.sala.company)', accept: 'application/json' };
const chartUrl = (host, sym) => `${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d&includePrePost=false`;
const sparkUrl = (host, syms) => `${host}/v8/finance/spark?symbols=${syms.map(encodeURIComponent).join(',')}&range=1d&interval=5m`;

async function getJSON(urls, fetchFn) {
  for (const url of urls) {
    try {
      const r = await fetchFn(url, { headers: HEADERS, signal: AbortSignal.timeout(15e3) });
      if (r.ok) return await r.json();
    } catch { /* try the other host */ }
  }
  return null;
}

// Yahoo's bulk answer { SPY: { timestamp: [...], close: [...] }, … } → { id: { day, price, t } }: each fund's latest
// 5-minute close and when that bar started. A US session (13:30–21:00 UTC) never spans midnight UTC, so the bar's
// UTC date is the trading day.
export function parseSpark(j) {
  const out = {};
  for (const [sym, s] of Object.entries(j || {})) {
    const ts = s?.timestamp, cl = s?.close;
    if (!Array.isArray(ts) || !Array.isArray(cl)) continue;
    for (let i = cl.length - 1; i >= 0; i--) {
      if (cl[i] > 0 && ts[i] > 0) { out[sym.toLowerCase()] = { day: Math.floor(ts[i] * 1000 / DAY), price: +cl[i].toPrecision(6), t: ts[i] * 1000 }; break; }
    }
  }
  return out;
}

// change over k trading days, in %
const chg = (c, k) => c.length > k ? (c[c.length - 1] / c[c.length - 1 - k] - 1) * 100 : null;

// closes (and volumes) by day → the hist entry the page reads: t0 + d (day offsets, trading days only) + c, and v =
// the volume of the last VOL_DAYS days, lined up with the end of c (null for a day without one, such as today's)
export function toHist(days, vols, a, fetched) {
  const ds = [...days.keys()].sort((x, y) => x - y);
  if (!ds.length) return null;
  const h = { src: 'Yahoo Finance', pair: a.yahoo, ok: 1, t: fetched, t0: ds[0] * DAY, d: ds.map(d => d - ds[0]), c: ds.map(d => days.get(d)) };
  const v = ds.slice(-VOL_DAYS).map(d => vols.get(d) ?? null);
  if (v.some(x => x != null)) h.v = v;
  return h;
}

// the closes and volumes by day, recovered from a previous etfs.json of the same format
function fromPrev(prev, id) {
  const h = prev?.hist?.[id], days = new Map(), vols = new Map();
  if (!h?.c || !h.d) return { days, vols };
  const d0 = Math.floor(h.t0 / DAY), ds = h.d.map(x => d0 + x);
  h.c.forEach((v, i) => days.set(ds[i], v));
  (h.v || []).forEach((v, i) => { if (v != null) vols.set(ds[ds.length - h.v.length + i], v); });
  return { days, vols };
}

export function toSnapshot(series, crypto, { now = Date.now(), fetched = now, quotes = {}, info = {} } = {}) {
  const markets = [], hist = {};
  ETFS.forEach((a, k) => {
    const h = series[a.id];
    if (!h) return;
    const q = quotes[a.id], i = info[a.id] || {};
    markets.push({
      id: a.id, symbol: a.yahoo, name: a.name, group: a.group, flag: a.flag, fund: i.name || null, exch: i.exch || null,
      image: '', market_cap_rank: k + 1, current_price: q?.price ?? h.c.at(-1), market_cap: null, src: 'yahoo', quoteAt: q?.t ?? null,
      price_change_percentage_24h_in_currency: chg(h.c, 1),
      price_change_percentage_7d_in_currency: chg(h.c, 5),
      price_change_percentage_30d_in_currency: chg(h.c, 21),
    });
    hist[a.id] = h;
  });
  const at = Math.max(0, ...Object.values(quotes).map(q => q.t || 0));
  const last = Math.max(0, ...Object.values(series).map(h => h.t0 / DAY + h.d.at(-1)));
  return {
    v: 1, fmt: FMT, market: 'etfs', generated: now, fetched, intervalMin: 10, params: crypto?.params ?? null,
    marketSrc: 'Yahoo Finance', marketStale: false,
    latestDate: last ? isoDay(last) : null,
    groups: GROUPS,
    sources: { name: 'Yahoo Finance', got: Object.keys(quotes).length, of: ETFS.length, at: at || null },
    markets, cats: { t: now, stable: [], gold: [] }, hist,
  };
}

export async function build({ prev = null, crypto = null, log = console.log, now = Date.now(), fetchFn = fetch } = {}) {
  const same = prev?.market === 'etfs' && prev?.fmt === FMT;
  const full = !same || now - (prev.fetched || 0) >= REFETCH;
  const fetched = full ? now : prev.fetched;
  const cut = Math.floor(now / DAY) - HISTORY_DAYS;
  const data = {}, quotes = {}, info = {}, histFailed = [];
  for (const a of ETFS) {
    data[a.id] = same ? fromPrev(prev, a.id) : { days: new Map(), vols: new Map() };
    const m = same && prev.markets?.find(x => x.id === a.id);
    if (m) info[a.id] = { name: m.fund, exch: m.exch };
  }

  // hourly: the full daily history of each fund, with volume and its latest price
  if (full) {
    await pool(ETFS, 6, async a => {
      const got = parseChart(await getJSON(HOSTS.map(h => chartUrl(h, a.yahoo)), fetchFn));
      if (!got) { histFailed.push(a.yahoo); return; }
      data[a.id] = { days: got.days, vols: got.vols };
      info[a.id] = { name: got.name || info[a.id]?.name || null, exch: got.exch || info[a.id]?.exch || null };
      quotes[a.id] = { price: got.price, t: got.t };
    });
  }
  // every 10 minutes: the latest price of every fund the history didn't just give, 20 per request
  const need = ETFS.filter(a => !quotes[a.id]);
  const batches = [];
  for (let i = 0; i < need.length; i += BATCH) batches.push(need.slice(i, i + BATCH));
  await pool(batches, 3, async b => {
    const got = parseSpark(await getJSON(HOSTS.map(h => sparkUrl(h, b.map(a => a.yahoo))), fetchFn));
    for (const a of b) {
      const q = got[a.id];
      if (!q) continue;
      data[a.id].days.set(q.day, q.price);
      quotes[a.id] = { price: q.price, t: q.t };
    }
  });

  const series = {}, stale = [];
  for (const a of ETFS) {
    const { days, vols } = data[a.id];
    for (const d of [...days.keys()]) if (d < cut) { days.delete(d); vols.delete(d); }
    if (!days.size) continue;
    series[a.id] = toHist(days, vols, a, full && !histFailed.includes(a.yahoo) ? fetched : (prev?.hist?.[a.id]?.t ?? fetched));
    if (!quotes[a.id]) stale.push(a.id);
  }
  if (!Object.keys(quotes).length) throw new Error('Yahoo Finance answered for none of the ETFs');
  const snap = toSnapshot(series, crypto, { now, fetched, quotes, info });
  // a fund Yahoo didn't answer for keeps its last price, flagged as not refreshed
  for (const m of snap.markets) if (stale.includes(m.id)) {
    const old = prev?.markets?.find(x => x.id === m.id);
    if (old) { m.current_price = old.current_price; m.quoteAt = old.quoteAt; }
    m.notRefreshed = true;
  }
  log(`ETFs: ${full ? 'full history' : 'latest prices'} · ${snap.markets.length} tiles · ${snap.sources.got}/${ETFS.length} quotes · prices to ${snap.latestDate} · newest quote ${snap.sources.at ? new Date(snap.sources.at).toISOString() : '—'}`
    + `${histFailed.length ? ` · no history for ${histFailed.join(', ')}` : ''}${stale.length ? ` · not refreshed: ${stale.map(s => s.toUpperCase()).join(', ')}` : ''}`);
  return snap;
}

/* ---------- CLI (Node only) ---------- */
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
if (IS_NODE && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const [out = 'etfs.json', dataFile = 'data.json'] = process.argv.slice(2);
  let prev = null, crypto = null;
  if (process.env.PREV_URL) {
    try { prev = await (await fetch(process.env.PREV_URL + '?b=' + Date.now(), { signal: AbortSignal.timeout(20e3) })).json(); }
    catch { console.log('No previous etfs.json (first run?)'); }
  }
  try { crypto = JSON.parse(await readFile(dataFile, 'utf8')); } catch { console.log(`No ${dataFile}: default signal settings`); }
  const data = await build({ prev, crypto });
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}
