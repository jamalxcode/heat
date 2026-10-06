// TradingView chart links for the popup header, without dead links.
// Each asset has a list of candidate TradingView symbols, best first (the exchange pair its candles came from, then
// fallbacks). The deploy job checks the candidates against TradingView's public symbol lookup and caches the results
// in tv.json; the page links to the first candidate known to exist, and shows no link when none does.
//   node scripts/tradingview.mjs <out tv.json> <data.json> [forex.json] [metals.json] [energy.json] [rates.json]   (env PREV_URL = last tv.json)
// The page imports candidates() and pick(), so it has no Node dependencies.

// our candle source → TradingView exchange prefix
const EXCH = { Binance: 'BINANCE', 'Gate.io': 'GATE', OKX: 'OKX', MEXC: 'MEXC', KuCoin: 'KUCOIN' };
const METAL = { xau: 'TVC:GOLD', xag: 'TVC:SILVER', xpt: 'TVC:PLATINUM', xpd: 'TVC:PALLADIUM' };
// energy: the continuous front-month contract, as on Yahoo Finance (same list as scripts/build-energy.mjs)
// rates: the 10-year government bond yield, TVC:XX10Y by country code (the UK is GB, the euro area EU)
const RATE_CODE = { uk: 'GB', ea: 'EU' };
const ENERGY = { wti: 'NYMEX:CL1!', brent: 'ICEEUR:BRN1!', diesel: 'NYMEX:HO1!', gasoline: 'NYMEX:RB1!', natgas: 'NYMEX:NG1!', ttf: 'ICEENDEX:TFM1!' };
const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// symbols that may belong to a different asset with the same ticker: only trusted if TradingView's description
// matches the asset's name (the exchange pairs come from verified trading pairs, so they don't need this)
const loose = sym => sym.startsWith('CRYPTO:') || sym.startsWith('COINBASE:');

// c: the tile (id, symbol, name); h: its hist entry (src, pair); market: 'crypto' | 'forex' | 'metals' | 'energy' | 'rates'; flipped: the
// forex …/USD view
export function candidates(c, h, market, flipped = false) {
  if (market === 'forex') {
    const x = clean(c.id);
    return [flipped ? `FX_IDC:${x}USD` : `FX_IDC:USD${x}`];
  }
  if (market === 'rates') return /^[a-z]{2}$/.test(c.id) ? [`TVC:${(RATE_CODE[c.id] || c.id).toUpperCase()}10Y`] : [];
  if (market === 'energy') return ENERGY[c.id] ? [ENERGY[c.id]] : [];
  if (METAL[c.id]) return [METAL[c.id]];
  const out = [], sym = clean(c.symbol);
  const base = clean(String(h?.pair || '').split('/')[0]);
  if (EXCH[h?.src] && base) out.push(`${EXCH[h.src]}:${base}USDT`);
  if (sym) out.push(`BINANCE:${sym}USDT`, `CRYPTO:${sym}USD`, `COINBASE:${sym}USD`);
  return [...new Set(out)];
}

// does TradingView's description name this asset? Every word of the name must be in it, apart from generic ones
// ("Olympus" ~ "Olympus v2", "GoMining Token" ~ "Gomining", but not "Beta Coin" ~ "Betting Token"). Together with
// the same ticker, that is enough: a different coin would need both the ticker and every word of the name.
const GENERIC = new Set(['token', 'coin', 'network', 'protocol', 'finance', 'the']);
export function sameAsset(desc, name) {
  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const d = new Set(words(desc)), n = words(name).filter(w => !GENERIC.has(w));
  return n.length > 0 && n.every(w => d.has(w));
}

// the first candidate known to exist. cache: tv.json's `sym` map { symbol: [found 1/0, checked at, description] }
export function pick(c, h, market, cache, flipped = false) {
  for (const s of candidates(c, h, market, flipped)) {
    const e = cache?.[s];
    if (e?.[0] === 1 && (!loose(s) || sameAsset(e[2], c.name))) return s;
  }
  return null;
}

export const chartUrl = sym => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`;

/* ---------- the deploy-time check ---------- */
const FOUND_FOR = 14 * 864e5;    // re-check a symbol that exists every two weeks (delistings)
const MISSING_FOR = 3 * 864e5;   // and a missing one every three days (new listings)
const MAX_CHECKS = 80;           // per run, so a first run (or a TradingView hiccup) can't slow the deploy down
const GAP_MS = 250;              // between lookups: TradingView stops answering after a few hundred quick ones

// one symbol: { found, desc } or null when TradingView couldn't be asked (network error, rate limit…): never
// record a symbol as missing unless TradingView said so
export async function lookup(sym, fetchFn = fetch) {
  try {
    const r = await fetchFn(`https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(sym)}&fields=description`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.description != null) return { found: true, desc: j.description };
    if (r.status === 404 && j.code === 'symbol_not_exists') return { found: false, desc: '' };
  } catch { /* unreachable: try again next run */ }
  return null;
}

// assets: [[c, h, market, flipped]…]. Checks candidates in order and stops at the first usable one, so most assets
// need a single lookup. Returns the new cache.
export async function refresh(assets, prev = {}, { now = Date.now(), lookupFn = lookup, log = console.log, gapMs = GAP_MS } = {}) {
  const sym = { ...prev };
  const fresh = s => sym[s] && now - sym[s][1] < (sym[s][0] ? FOUND_FOR : MISSING_FOR);
  let checks = 0, found = 0, missing = 0, failed = 0;
  for (const [c, h, market, flipped] of assets) {
    if (failed || checks >= MAX_CHECKS) break;       // unreachable (likely rate-limited) or enough for this run
    for (const s of candidates(c, h, market, flipped)) {
      if (!fresh(s)) {
        if (checks >= MAX_CHECKS) break;
        if (checks++ && gapMs) await new Promise(r => setTimeout(r, gapMs));
        const r = await lookupFn(s);
        if (!r) { failed++; break; }                 // keep the old entry; the rest is tried again next run
        sym[s] = [r.found ? 1 : 0, now, r.desc];
        r.found ? found++ : missing++;
      }
      if (sym[s]?.[0] === 1 && (!loose(s) || sameAsset(sym[s][2], c.name))) break;   // usable: no need for fallbacks
    }
  }
  log(`TradingView: ${checks} symbols checked (${found} found, ${missing} missing, ${failed} unreachable) · ${Object.keys(sym).length} cached`);
  return sym;
}

// every asset on the five pages (both quote directions for forex); the short lists first, so a first run (80
// checks at most) covers metals and currencies, and the coins over the next few runs
export function assetsOf({ crypto, forex, metals, energy, rates }) {
  const out = [];
  for (const c of [...(rates?.countries || []), ...(rates?.monthly || [])]) out.push([c, null, 'rates']);
  for (const c of energy?.markets || []) out.push([c, energy.hist?.[c.id], 'energy']);
  for (const c of metals?.markets || []) out.push([c, metals.hist?.[c.id], 'metals']);
  for (const c of forex?.markets || []) out.push([c, null, 'forex', false], [c, null, 'forex', true]);
  for (const c of crypto?.markets || []) out.push([c, crypto.hist?.[c.id], 'crypto']);
  return out;
}

/* ---------- CLI (Node only) ---------- */
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
if (IS_NODE && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const [out = 'tv.json', ...files] = process.argv.slice(2);
  const read = async f => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };
  const [crypto, forex, metals, energy, rates] = await Promise.all(files.map(read));
  let prev = {};
  if (process.env.PREV_URL) {
    try { prev = (await (await fetch(process.env.PREV_URL + '?b=' + Date.now(), { signal: AbortSignal.timeout(20e3) })).json()).sym || {}; }
    catch { console.log('No previous tv.json (first run?)'); }
  }
  const sym = await refresh(assetsOf({ crypto, forex, metals, energy, rates }), prev);
  await writeFile(out, JSON.stringify({ v: 1, t: Date.now(), sym }));
}
