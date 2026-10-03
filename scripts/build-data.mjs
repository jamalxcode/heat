// Builds data.json for heat.sala.company: top coins by market cap plus ~260 daily closes each.
// Runs in GitHub Actions every 10 minutes (.github/workflows/update-data.yml), so visitors never call
// the market APIs themselves. Usage: node scripts/build-data.mjs <out.json>   (env PREV_URL = last published data.json)
// The build() function has no Node dependencies, so it can also be run in a browser for testing.

const CANDLES = 260;
const RAW_TOP = 150;                   // candles for the top 150 raw coins covers the top 100 after exclusions (stablecoins, wrapped, gold)
const HIST_REUSE = 60 * 60e3;          // exchange candles: refetch hourly (the page patches today's close with the live price)
const HIST_REUSE_CG = 6 * 60 * 60e3;   // CoinGecko candles: its free quota is scarce
const CG = 'https://api.coingecko.com/api/v3';
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
const ALIASES = { 'the-open-network': ['TON'], 'polygon-ecosystem-token': ['POL', 'MATIC'] };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;

// CoinGecko Demo API key (a GitHub Actions secret). Server-side only: the browser fallback never sees it.
// CoinGecko blocks unauthenticated requests from data-centre IPs such as GitHub's runners (HTTP 403).
const cgKey = () => (IS_NODE && process.env.COINGECKO_API_KEY) || null;

export async function getJSON(url, { tries = 3, timeout = 20000 } = {}) {
  const headers = IS_NODE ? { 'user-agent': 'heat.sala.company data job', accept: 'application/json', ...(url.startsWith(CG) && cgKey() ? { 'x-cg-demo-api-key': cgKey() } : {}) } : undefined;
  for (let i = 0; ; i++) {
    let status = 0;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeout);
      const r = await fetch(url, { signal: ctl.signal, headers });
      clearTimeout(t);
      status = r.status;
      if (r.ok) return await r.json();
    } catch { /* network error or timeout */ }
    if (i + 1 >= tries || (status >= 400 && status < 500 && status !== 429)) throw new Error(`HTTP ${status || 'error'} ${url}`);
    await sleep(status === 429 ? 20000 * (i + 1) : 2000);
  }
}

/* ---------- rankings ---------- */
const trim = c => ({
  id: c.id, symbol: c.symbol, name: c.name, image: c.image,
  market_cap_rank: c.market_cap_rank, current_price: c.current_price, market_cap: c.market_cap,
  price_change_percentage_24h_in_currency: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? null,
  price_change_percentage_7d_in_currency: c.price_change_percentage_7d_in_currency ?? null,
  price_change_percentage_30d_in_currency: c.price_change_percentage_30d_in_currency ?? null,
});

async function loadMarkets(prev, log) {
  try {
    const rows = await getJSON(`${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h,7d,30d`);
    return { src: 'CoinGecko', markets: rows.map(trim) };
  } catch (e) { log('CoinGecko markets failed: ' + e.message); }
  try {
    // CoinLore returns at most 100 per call: two pages cover the top 150 we need
    const d = { data: [] };
    for (const start of [0, 100]) d.data.push(...((await getJSON(`https://api.coinlore.net/api/tickers/?start=${start}&limit=100`)).data || []));
    // CoinLore has no CoinGecko ids or logos: borrow them by symbol from the remembered list (see `known` in build())
    const known = { ...(prev?.known || {}) };
    for (const c of prev?.markets || []) if (!c.id.startsWith('cl-')) known[c.symbol.toLowerCase()] ??= { id: c.id, image: c.image };
    const markets = (d.data || []).map(r => {
      const sym = String(r.symbol).toLowerCase(), k = known[sym];
      return {
        id: k ? k.id : 'cl-' + r.nameid, symbol: sym, name: r.name, image: k?.image || '',
        market_cap_rank: +r.rank, current_price: +r.price_usd, market_cap: +r.market_cap_usd,
        price_change_percentage_24h_in_currency: +r.percent_change_24h,
        price_change_percentage_7d_in_currency: +r.percent_change_7d,
        price_change_percentage_30d_in_currency: null,
      };
    });
    if (markets.length) return { src: 'CoinLore', markets };
  } catch (e) { log('CoinLore failed: ' + e.message); }
  if (prev?.markets?.length) return { src: prev.marketSrc, markets: prev.markets, stale: true };
  throw new Error('No market data source available');
}

async function loadCategories(prev, log) {
  if (prev?.cats && Date.now() - (prev.cats.t || 0) < 24 * 60 * 60e3) return prev.cats;
  try {
    await sleep(2500);
    const stable = (await getJSON(`${CG}/coins/markets?vs_currency=usd&category=stablecoins&per_page=250&order=market_cap_desc`)).map(c => c.id);
    await sleep(2500);
    const gold = (await getJSON(`${CG}/coins/markets?vs_currency=usd&category=tokenized-gold&per_page=100&order=market_cap_desc`)).map(c => c.id);
    return { t: Date.now(), stable, gold };
  } catch (e) {
    log('Categories failed: ' + e.message);
    return prev?.cats || { t: 0, stable: [], gold: [] };
  }
}

/* ---------- daily candles ---------- */
const symbolsFor = c => [...new Set([...(ALIASES[c.id] || []), c.symbol.toUpperCase()])].filter(s => /^[A-Z0-9]+$/.test(s));
const sane = (closes, price) => closes.length >= 20 && price > 0 && Math.abs(closes[closes.length - 1][1] / price - 1) < 0.15;

const EXCHANGES = [
  ['Binance', (s, n) => `https://data-api.binance.vision/api/v3/klines?symbol=${s}USDT&interval=1d&limit=${n}`, d => d.map(r => [r[0], +r[4], +r[7]])],
  ['Gate.io', (s, n) => `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${s}_USDT&interval=1d&limit=${n}`, d => d.map(r => [+r[0] * 1000, +r[2], +r[1]])],
  ['OKX', (s, n) => `https://www.okx.com/api/v5/market/candles?instId=${s}-USDT&bar=1Dutc&limit=${Math.min(n, 300)}`, d => (d.data || []).map(r => [+r[0], +r[4], +r[7]])],
  // No CORS on these two, so only the server-side job can use them
  ...(IS_NODE ? [
    ['MEXC', (s, n) => `https://api.mexc.com/api/v3/klines?symbol=${s}USDT&interval=1d&limit=${n}`, d => d.map(r => [r[0], +r[4], +r[7]])],
    ['KuCoin', (s, n) => `https://api.kucoin.com/api/v1/market/candles?type=1day&symbol=${s}-USDT`, d => (d.data || []).map(r => [+r[0] * 1000, +r[2], +r[6]])],
  ] : []),
];

/* ---------- exact trading pairs, by CoinGecko coin ID ---------- */
// CoinGecko's exchange ids → our exchange names
const CG_EXCHANGES = { binance: 'Binance', gate: 'Gate.io', okex: 'OKX', mxc: 'MEXC', kucoin: 'KuCoin' };

// From CoinGecko's /coins/{id}/tickers: the USDT pair base symbol on each exchange we use, e.g. { Binance: 'GRAM' }.
// That endpoint only lists markets of the requested coin, so a different coin sharing the ticker can't sneak in.
// (Don't compare t.coin_id with the id asked for: after a rename, e.g. the-open-network → gram, they differ.)
export function pairsFromTickers(tickers) {
  const out = {};
  for (const t of tickers || []) {
    const ex = CG_EXCHANGES[t.market?.identifier];
    if (!ex || t.target !== 'USDT' || t.is_stale || t.is_anomaly) continue;
    if (!/^[A-Z0-9]+$/.test(t.base || '')) continue;
    out[ex] ??= t.base;
  }
  return out;
}

// One polite CoinGecko call per coin (the free tier allows roughly 5-15 a minute); run weekly by scripts/score.mjs.
// Stops after `budgetMs` and returns what it has: coins it didn't reach are picked up on the next daily run,
// so a rate-limited day can't push the job past its time limit and lose everything.
export async function loadPairs(ids, log = console.log, { budgetMs = 8 * 60e3 } = {}) {
  const out = {}, start = Date.now();
  for (const id of ids) {
    if (Date.now() - start > budgetMs) { log(`Pairs: time budget used, ${ids.length - Object.keys(out).length} coins left for the next run`); break; }
    await sleep(6000);
    try {
      const d = await getJSON(`${CG}/coins/${encodeURIComponent(id)}/tickers?exchange_ids=${Object.keys(CG_EXCHANGES).join(',')}`, { tries: 2 });
      out[id] = pairsFromTickers(d.tickers);
    } catch (e) { log(`Pairs for ${id} failed: ${e.message}`); }
  }
  return out;
}

// pairs = { [coinId]: { Binance: 'BTC', ... } }. Mapped pairs are tried first and marked verified; otherwise the
// ticker is guessed (with a price check) and marked unverified.
export async function fromExchanges(c, preferred, n = CANDLES, pairs = null) {
  const byPref = (a, b) => (b[0] === preferred) - (a[0] === preferred);
  const mapped = pairs?.[c.id];
  let verified = null;
  if (mapped) {
    for (const [name, url, parse] of [...EXCHANGES].filter(([name]) => mapped[name]).sort(byPref)) {
      try {
        const closes = parse(await getJSON(url(mapped[name], n), { tries: 1 })).sort((a, b) => a[0] - b[0]).slice(-n);
        if (sane(closes, c.current_price) && closes.length > (verified?.closes.length ?? 0)) verified = { src: name, pair: mapped[name] + '/USDT', closes, verified: true };
        if (verified && verified.closes.length >= Math.min(n, 220)) return verified;   // long enough for the 200-day average
      } catch { /* exchange hiccup: try the next one */ }
    }
  }
  // Ticker guess: used when no verified pair exists, or when the verified one is too young (a renamed coin, e.g.
  // Toncoin's new GRAM/USDT pair, while its years of history sit on the old TON/USDT pair). Longest history wins.
  for (const [name, url, parse] of [...EXCHANGES].sort(byPref)) {
    for (const s of symbolsFor(c)) {
      try {
        const closes = parse(await getJSON(url(s, n), { tries: 1 })).sort((a, b) => a[0] - b[0]).slice(-n);
        if (sane(closes, c.current_price) && closes.length > (verified?.closes.length ?? 0)) return { src: name, pair: s + '/USDT', closes, verified: false };
      } catch { /* not listed there */ }
    }
  }
  return verified;
}
export async function fromCoinGecko(c, n = CANDLES) {
  if (c.id.startsWith('cl-')) return null;
  const d = await getJSON(`${CG}/coins/${encodeURIComponent(c.id)}/market_chart?vs_currency=usd&days=${n - 1}&interval=daily`);
  const vol = new Map((d.total_volumes || []).map(([t, v]) => [Math.floor(t / DAY), v]));
  const closes = (d.prices || []).map(p => [p[0], p[1], vol.get(Math.floor(p[0] / DAY))]);
  return closes.length >= 20 ? { src: 'CoinGecko', pair: c.symbol.toUpperCase() + '/USD', closes, verified: true } : null;
}

// Compact form: one close per UTC day starting at day t0 (gaps forward-filled), 7 significant digits.
// Closes are [time, close, volume in dollars]. `v` keeps the volume of the last VOL_DAYS days only (3 significant
// digits, null for a gap), lined up with the end of `c`: enough for the volume signal, without doubling the file.
const VOL_DAYS = 60;
export function pack(h, n = CANDLES) {
  const byDay = new Map(h.closes.map(([t, v, vol]) => [Math.floor(t / DAY), [v, vol]]));
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const c = [], v = [];
  let last = byDay.get(days[0])[0];
  for (let d = days[0]; d <= days[days.length - 1]; d++) {
    const x = byDay.get(d);
    if (x) last = x[0];
    c.push(+last.toPrecision(7));
    v.push(x?.[1] > 0 ? +x[1].toPrecision(3) : null);
  }
  const out = { src: h.src, pair: h.pair, ok: h.verified ? 1 : 0, t: h.t, t0: days[0] * DAY, c: c.slice(-n) };
  if (v.some(x => x != null)) out.v = v.slice(-Math.min(VOL_DAYS, out.c.length));
  return out;
}

export async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/* ---------- main ---------- */
// cgCandles: false skips the slow CoinGecko candle fallback (used when a visitor's browser runs this as a backup)
export async function build({ prev = null, log = console.log, params = null, cgCandles = true, pairs = null } = {}) {
  const started = Date.now();
  const { src, markets, stale } = await loadMarkets(prev, log);
  const cats = await loadCategories(prev, log);
  const pegged = new Set([...cats.stable, ...cats.gold]);
  const targets = [...markets].sort((a, b) => a.market_cap_rank - b.market_cap_rank).slice(0, RAW_TOP);

  const hist = {}, slow = [];
  let reused = 0;
  await pool(targets, 6, async c => {
    const old = prev?.hist?.[c.id];
    const maxAge = old?.src === 'CoinGecko' ? HIST_REUSE_CG : HIST_REUSE;
    // reuse recent candles, unless they were a ticker guess and a verified pair is now known
    if (old && started - old.t < maxAge && (old.ok || !pairs?.[c.id])) { hist[c.id] = old; reused++; return; }
    const h = await fromExchanges(c, old?.src, CANDLES, pairs);
    if (h) { h.t = started; hist[c.id] = pack(h); }
    else if (!pegged.has(c.id) && cgCandles) slow.push(c);
    else if (old) hist[c.id] = old;
  });
  for (const c of slow) { // CoinGecko fallback, spaced out for its free tier
    await sleep(3000);
    try {
      const h = await fromCoinGecko(c);
      if (h) { h.t = started; hist[c.id] = pack(h); continue; }
    } catch (e) { log(`CoinGecko candles for ${c.id} failed: ${e.message}`); }
    if (prev?.hist?.[c.id]) hist[c.id] = prev.hist[c.id]; // keep the last good copy
  }

  const inMarkets = new Set(markets.map(c => c.id));
  // Remember every coin's CoinGecko id and logo by symbol, so a CoinLore fallback keeps both (it has neither)
  const known = { ...(prev?.known || {}) };
  for (const c of markets) if (!c.id.startsWith('cl-') && c.image) known[c.symbol.toLowerCase()] = { id: c.id, image: c.image };
  const count = {};
  for (const h of Object.values(hist)) count[h.src] = (count[h.src] || 0) + 1;
  log(`Rankings: ${src}${stale ? ' (previous copy)' : ''} · candles for ${Object.keys(hist).length}/${targets.length} (${reused} reused) · ${JSON.stringify(count)} · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return {
    v: 1,
    generated: Date.now(),
    intervalMin: 10,
    params,
    marketSrc: src,
    marketStale: !!stale,
    markets,
    cats: { t: cats.t, stable: cats.stable.filter(id => inMarkets.has(id)), gold: cats.gold.filter(id => inMarkets.has(id)) },
    hist,
    known,
  };
}

/* ---------- CLI (Node only) ---------- */
if (IS_NODE && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const out = process.argv[2] || 'data.json';
  let prev = null;
  if (process.env.PREV_URL) {
    try { prev = await getJSON(process.env.PREV_URL + '?b=' + Date.now(), { tries: 2 }); console.log('Loaded previous data from ' + process.env.PREV_URL); }
    catch { console.log('No previous data.json (first run?)'); }
  }
  const { readFile } = await import('node:fs/promises');
  let params = null; // signal settings chosen by the tuner (scripts/score.mjs); the page falls back to defaults
  try { params = JSON.parse(await readFile(new URL('../params.json', import.meta.url), 'utf8')); } catch { /* none yet */ }
  let pairs = null; // exact trading pairs by coin ID, refreshed weekly by scripts/score.mjs
  try { pairs = JSON.parse(await readFile(new URL('../data/pairs.json', import.meta.url), 'utf8')).pairs; } catch { /* none yet */ }
  const data = await build({ prev, params, pairs });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}
