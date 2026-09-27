// Builds data.json for heat.sala.company: top coins by market cap plus ~260 daily closes each.
// Runs in GitHub Actions every 10 minutes (.github/workflows/update-data.yml), so visitors never call
// the market APIs themselves. Usage: node scripts/build-data.mjs <out.json>   (env PREV_URL = last published data.json)
// The build() function has no Node dependencies, so it can also be run in a browser for testing.

const CANDLES = 260;
const RAW_TOP = 80;                    // candles for the top 80 raw coins covers the top 50 after exclusions
const HIST_REUSE = 60 * 60e3;          // exchange candles: refetch hourly (the page patches today's close with the live price)
const HIST_REUSE_CG = 6 * 60 * 60e3;   // CoinGecko candles: its free quota is scarce
const CG = 'https://api.coingecko.com/api/v3';
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
const ALIASES = { 'the-open-network': ['TON'], 'polygon-ecosystem-token': ['POL', 'MATIC'] };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;

export async function getJSON(url, { tries = 3, timeout = 20000 } = {}) {
  for (let i = 0; ; i++) {
    let status = 0;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeout);
      const r = await fetch(url, { signal: ctl.signal, headers: IS_NODE ? { 'user-agent': 'heat.sala.company data job', accept: 'application/json' } : undefined });
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
    const rows = await getJSON(`${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h,7d,30d`);
    return { src: 'CoinGecko', markets: rows.map(trim) };
  } catch (e) { log('CoinGecko markets failed: ' + e.message); }
  try {
    const d = await getJSON('https://api.coinlore.net/api/tickers/?start=0&limit=100');
    const known = {};
    for (const c of prev?.markets || []) known[c.symbol.toLowerCase()] ??= c;
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
  ['Binance', (s, n) => `https://data-api.binance.vision/api/v3/klines?symbol=${s}USDT&interval=1d&limit=${n}`, d => d.map(r => [r[0], +r[4]])],
  ['Gate.io', (s, n) => `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${s}_USDT&interval=1d&limit=${n}`, d => d.map(r => [+r[0] * 1000, +r[2]])],
  ['OKX', (s, n) => `https://www.okx.com/api/v5/market/candles?instId=${s}-USDT&bar=1Dutc&limit=${Math.min(n, 300)}`, d => (d.data || []).map(r => [+r[0], +r[4]])],
  // No CORS on these two, so only the server-side job can use them
  ...(IS_NODE ? [
    ['MEXC', (s, n) => `https://api.mexc.com/api/v3/klines?symbol=${s}USDT&interval=1d&limit=${n}`, d => d.map(r => [r[0], +r[4]])],
    ['KuCoin', (s, n) => `https://api.kucoin.com/api/v1/market/candles?type=1day&symbol=${s}-USDT`, d => (d.data || []).map(r => [+r[0] * 1000, +r[2]])],
  ] : []),
];

export async function fromExchanges(c, preferred, n = CANDLES) {
  const order = [...EXCHANGES].sort((a, b) => (b[0] === preferred) - (a[0] === preferred));
  for (const [name, url, parse] of order) {
    for (const s of symbolsFor(c)) {
      try {
        const closes = parse(await getJSON(url(s, n), { tries: 1 })).sort((a, b) => a[0] - b[0]).slice(-n);
        if (sane(closes, c.current_price)) return { src: name, pair: s + '/USDT', closes };
      } catch { /* not listed there */ }
    }
  }
  return null;
}
export async function fromCoinGecko(c, n = CANDLES) {
  if (c.id.startsWith('cl-')) return null;
  const d = await getJSON(`${CG}/coins/${encodeURIComponent(c.id)}/market_chart?vs_currency=usd&days=${n - 1}&interval=daily`);
  const closes = (d.prices || []).map(p => [p[0], p[1]]);
  return closes.length >= 20 ? { src: 'CoinGecko', pair: c.symbol.toUpperCase() + '/USD', closes } : null;
}

// Compact form: one close per UTC day starting at day t0 (gaps forward-filled), 7 significant digits
export function pack(h, n = CANDLES) {
  const byDay = new Map(h.closes.map(([t, v]) => [Math.floor(t / DAY), v]));
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const c = [];
  let last = byDay.get(days[0]);
  for (let d = days[0]; d <= days[days.length - 1]; d++) { if (byDay.has(d)) last = byDay.get(d); c.push(+last.toPrecision(7)); }
  return { src: h.src, pair: h.pair, t: h.t, t0: days[0] * DAY, c: c.slice(-n) };
}

export async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/* ---------- main ---------- */
export async function build({ prev = null, log = console.log, params = null } = {}) {
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
    if (old && started - old.t < maxAge) { hist[c.id] = old; reused++; return; }
    const h = await fromExchanges(c, old?.src);
    if (h) { h.t = started; hist[c.id] = pack(h); }
    else if (!pegged.has(c.id)) slow.push(c);
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
  const data = await build({ prev, params });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}
