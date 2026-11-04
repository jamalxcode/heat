// Builds predictions.json for heat.sala.company/predictions/: the most traded prediction markets on Polymarket, Kalshi,
// PredictIt, Manifold and Betfair, in one shape, so the page can show each venue on its own tab and all of them together.
//   node scripts/build-predictions.mjs <out.json> [forex.json or its address]
//   env PREV_URL = the last published predictions.json (keeps the daily history, Kalshi's event list, and a venue's
//   last good markets when it fails); BETFAIR_APP_KEY + BETFAIR_USERNAME + BETFAIR_PASSWORD switch Betfair on.
//
// One record per question (an "event"): its outcomes with their probability (0–1) and the change in that probability
// over 1 day, 1 week and 1 month in percentage points, the headline outcome the tile shows, volume, end date and a link.
//   - Polymarket (Gamma API, public): the 120 events with the most volume in the last 24 h. Changes come with the data.
//   - Kalshi (public market data): 12,000+ open events, mostly tiny local races, and a full scan takes ~2 minutes, so the
//     full list is scanned hourly and only the 120 most traded events are refreshed in between. The 1-day change comes
//     with the data (yesterday's price); 1 week and 1 month come from the history this file keeps.
//   - PredictIt (public feed, every market at once): no volume figures, so its markets are ordered by its own list.
//   - Manifold (public API, play money "mana"): the 100 most traded open markets. Multiple-choice answers come with
//     their changes; binary markets don't, so theirs come from the history kept here.
//   - Betfair (exchange, needs an API key and an account): politics markets by money matched. Off without the secrets.
// The history: one probability per day (the last one seen that UTC day) for each record's headline outcome, 35 days.
// A venue that fails keeps its last good markets, flagged stale, so one outage never empties a tab.
// build() has no Node dependencies, so tests can run it with a fake fetch.
import { pool } from './build-forex.mjs';

export const DAY = 864e5;
const FMT = 1;
const KEEP_DAYS = 35;
const KALSHI_SCAN_EVERY = 60 * 60e3;
const KALSHI_SCAN_BUDGET = 150e3;             // stop paging after this long and use what was read
const TOP = { polymarket: 120, kalshi: 120, predictit: 80, manifold: 100, betfair: 60 };
const MAX_OUTCOMES = 8;                       // per record; the rest is summarised as "+N more"
const MANA_PER_USD = 100;                     // Manifold's long-standing M$100 = $1, only to rank its markets in "All"

// The common yardstick, in US dollars on every venue: money bet in the last 24 hours (bet today) and since the market
// opened (bet in total). Manifold's play money counts at M$100 = $1; Betfair's pounds at the day's rate.
// Interest = bet today + a 30th of bet in total: today's money counts in full, and a market's long-run money as if it
// were spread over a month, so a big market having a quiet day isn't pushed under a small one having a busy day.
// PredictIt publishes no money figures, so its markets have no interest score and sit below the rest.
const toUsd = (v, cur, usdPerGbp = 1.3) => v == null ? null : cur === 'MANA' ? v / MANA_PER_USD : cur === 'GBP' ? v * usdPerGbp : v;
export function interestOf(m) {
  const today = m.usd24 ?? toUsd(m.vol24, m.cur), total = m.usdTotal ?? toUsd(m.vol, m.cur);
  if (today == null && total == null) return 0;
  return (today || 0) + (total || 0) / 30;
}

export const VENUES = [
  { key: 'polymarket', name: 'Polymarket', cur: 'USD', site: 'https://polymarket.com/' },
  { key: 'kalshi', name: 'Kalshi', cur: 'USD', site: 'https://kalshi.com/' },
  { key: 'predictit', name: 'PredictIt', cur: 'USD', site: 'https://www.predictit.org/' },
  { key: 'manifold', name: 'Manifold', cur: 'MANA', site: 'https://manifold.markets/' },
  { key: 'betfair', name: 'Betfair', cur: 'GBP', site: 'https://www.betfair.com/exchange/plus/politics' },
];
export const CATS = ['Politics', 'World', 'Economy', 'Business', 'Crypto', 'Tech & science', 'Sports', 'Culture', 'Climate', 'Other'];

/* ---------- helpers ---------- */
const num = v => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };
const clamp01 = p => p == null ? null : Math.min(1, Math.max(0, p));
const r4 = v => v == null ? null : Math.round(v * 1e4) / 1e4;
const parseList = s => { if (Array.isArray(s)) return s; try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; } };
const isoOf = v => { if (v == null || v === '') return null; const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; };

// a category from the words of a question, for venues that don't give one (PredictIt, Manifold, Betfair) or as a
// fallback; the order matters: "Fed" before "election", sports before politics ("Senators vs Kings")
const WORDS = [
  ['Crypto', /\b(bitcoin|btc|ethereum|eth|solana|crypto|xrp|dogecoin|stablecoin|memecoin|coinbase)\b/i],
  ['Economy', /\b(fed|fomc|interest rates?|rate (cut|hike)s?|inflation|cpi|gdp|recession|unemployment|jobs report|payrolls|tariffs?|treasury yields?|s&p 500|nasdaq|dow jones|oil price|gas prices?)\b/i],
  ['Sports', /\b(nfl|nba|mlb|nhl|ufc|f1|formula 1|premier league|champions league|world cup|super bowl|world series|stanley cup|grand slam|wimbledon|olympics?|playoffs?|mvp|heisman|match|vs\.?)\b/i],
  ['Tech & science', /\b(ai|openai|chatgpt|gpt-?\d|anthropic|claude|gemini|agi|spacex|starship|nasa|mars|apple|iphone|nvidia|tesla|quantum|fda)\b/i],
  ['Climate', /\b(hurricane|temperature|heat ?wave|climate|snow|rainfall|wildfire|weather|el ni[nñ]o|warmest)\b/i],
  ['Culture', /\b(oscars?|grammys?|emmys?|box office|album|movie|film|taylor swift|billboard|netflix|youtube|tiktok|eurovision|time person of the year|spotify)\b/i],
  ['World', /\b(ukraine|russia|putin|zelensky|israel|gaza|hamas|iran|china|taiwan|xi jinping|north korea|ceasefire|nato|war|invade|invasion|pope|un security)\b/i],
  ['Politics', /\b(election|elected|president(ial)?|senate|senator|house|congress|governor|mayor|primary|nominee|nomination|democrat(ic)?s?|republicans?|gop|trump|vance|newsom|harris|prime minister|parliament|chancellor|cabinet|impeach|supreme court|scotus|seats?|vote|ballot|midterms?|poll)\b/i],
  ['Business', /\b(ipo|ceo|earnings|market cap|acquire|acquisition|merger|layoffs|stock|shares|company|bankrupt)\b/i],
];
export function catOf(text) {
  for (const [cat, re] of WORDS) if (re.test(text || '')) return cat;
  return 'Other';
}
// a venue's own category or tags onto the shared list (falls back to the words)
const TAGS = [
  [/^(politics|elections?|us[- ]politics|us[- ]elections?|midterms|trump|global elections|world elections)$/i, 'Politics'],
  [/^(geopolitics|world|middle east|ukraine|israel|china|foreign policy)$/i, 'World'],
  [/^(economy|economics|fed|fed rates|finance|financials|inflation|macro|commodities|stocks|business & economy)$/i, 'Economy'],
  [/^(business|companies|tech stocks|ipos?)$/i, 'Business'],
  [/^(crypto|bitcoin|ethereum|crypto prices)$/i, 'Crypto'],
  [/^(tech|technology|ai|science|science and technology|space)$/i, 'Tech & science'],
  [/^(sports|nfl|nba|mlb|nhl|soccer|football|tennis|golf|ufc|f1|esports|cricket)$/i, 'Sports'],
  [/^(culture|pop culture|entertainment|movies|music|awards|celebrities|mentions|social)$/i, 'Culture'],
  [/^(climate|weather|climate and weather|climate & weather)$/i, 'Climate'],
];
export function catFrom(labels, text) {
  for (const l of labels || []) for (const [re, cat] of TAGS) if (re.test(String(l).trim())) return cat;
  return catOf(text);
}

// the outcome a tile shows: the likeliest when the outcomes exclude each other (who wins), otherwise the most traded
// one (a ladder of "above 50 seats / above 52 seats…" has no single likeliest)
export function headline(outcomes, exclusive) {
  if (!outcomes.length) return null;
  const by = exclusive ? (o => o.p ?? -1) : (o => o.vol24 ?? o.p ?? -1);
  return outcomes.reduce((a, o) => by(o) > by(a) ? o : a, outcomes[0]);
}
function finish(rec, outcomes, exclusive) {
  const clean = outcomes.filter(o => o.p != null);
  if (!clean.length) return null;
  const head = headline(clean, exclusive);
  const sorted = [...clean].sort((a, b) => (b.p - a.p));
  const shown = sorted.slice(0, MAX_OUTCOMES);
  if (!shown.includes(head)) shown[shown.length - 1] = head;
  return {
    ...rec,
    exclusive: !!exclusive,
    head: head.name,
    outcomes: shown.map(o => ({ name: o.name, p: r4(o.p), d1: r4(o.d1), d7: r4(o.d7), d30: r4(o.d30), ...(o.vol24 != null ? { vol24: Math.round(o.vol24) } : {}) })),
    more: clean.length - shown.length,
  };
}

async function getJSON(fetchFn, url, { tries = 3, timeout = 20e3, ...init } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(timeout), ...init });
      if (r.status === 429 || r.status >= 500) throw new Error(`${r.status}`);
      if (!r.ok) { const e = new Error(`${r.status}`); e.final = true; throw e; }
      return await r.json();
    } catch (e) {
      err = e;
      if (e.final) break;
      await new Promise(res => setTimeout(res, 800 * (i + 1)));
    }
  }
  throw new Error(`${url.split('?')[0]}: ${err?.message || err}`);
}

/* ---------- Polymarket ---------- */
// One Gamma event → one record. A "Yes/No" market is one outcome (its Yes price); a multi-market event (who wins,
// negRisk) has one outcome per market, named by its groupItemTitle; a single market with named outcomes (Team A / Team B)
// has one outcome per name.
export function fromPolymarket(e) {
  const markets = (e.markets || []).filter(m => m.active !== false && !m.closed);
  if (!markets.length) return null;
  const outcomes = [];
  const yesNo = m => { const o = parseList(m.outcomes); return o.length === 2 && /^yes$/i.test(o[0]) && /^no$/i.test(o[1]); };
  if (markets.length === 1 && !yesNo(markets[0])) {
    const m = markets[0], names = parseList(m.outcomes), prices = parseList(m.outcomePrices).map(num);
    const d1 = num(m.oneDayPriceChange), d7 = num(m.oneWeekPriceChange), d30 = num(m.oneMonthPriceChange);
    names.forEach((name, i) => outcomes.push({
      name: String(name), p: clamp01(prices[i]),
      // the changes are for the first outcome; with two outcomes the second moves the other way
      d1: i === 0 ? d1 : names.length === 2 && d1 != null ? -d1 : null,
      d7: i === 0 ? d7 : names.length === 2 && d7 != null ? -d7 : null,
      d30: i === 0 ? d30 : names.length === 2 && d30 != null ? -d30 : null,
    }));
  } else {
    for (const m of markets) {
      const prices = parseList(m.outcomePrices).map(num);
      const p = clamp01(prices[0] ?? num(m.lastTradePrice));
      outcomes.push({
        name: markets.length === 1 ? 'Yes' : String(m.groupItemTitle || m.question || 'Yes'),
        p, d1: num(m.oneDayPriceChange), d7: num(m.oneWeekPriceChange), d30: num(m.oneMonthPriceChange), vol24: num(m.volume24hr),
      });
    }
  }
  const labels = (e.tags || []).map(t => t.label || t.slug);
  return finish({
    id: 'pm:' + e.slug, venue: 'polymarket', title: String(e.title || markets[0].question),
    cat: catFrom(labels, e.title), url: `https://polymarket.com/event/${encodeURIComponent(e.slug)}`,
    end: isoOf(e.endDate || markets[0].endDate), vol24: num(e.volume24hr) ?? 0, vol: num(e.volume), liq: num(e.liquidity), oi: num(e.openInterest), cur: 'USD',
  }, outcomes, e.negRisk || markets.length === 1);
}
async function polymarket({ fetchFn }) {
  const out = [];
  for (const offset of [0, 100]) {
    const page = await getJSON(fetchFn, `https://gamma-api.polymarket.com/events?active=true&closed=false&archived=false&order=volume24hr&ascending=false&limit=100&offset=${offset}`);
    for (const e of page || []) { const r = fromPolymarket(e); if (r) out.push(r); }
    if (!page?.length || page.length < 100) break;
  }
  return out.sort((a, b) => interestOf(b) - interestOf(a)).slice(0, TOP.polymarket);
}

/* ---------- Kalshi ---------- */
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
// One Kalshi event (with its markets) → one record. Prices are dollars per $1 contract, so they are probabilities.
// The price is the last trade, or the middle of the bid and ask when it never traded; the 1-day change is against
// previous_price (the price 24 hours ago). Kalshi counts volume in contracts (each pays $1 if right); the money bet on a
// contract is its price, so dollars = contracts × price: the last day's at the average of today's and yesterday's
// price, the total and the open interest (money riding on it now) at today's. Approximate, but in dollars like the rest.
export function fromKalshi(e) {
  const markets = (e.markets || []).filter(m => !m.status || ['active', 'open'].includes(m.status));
  if (!markets.length) return null;
  const price = m => {
    const last = num(m.last_price_dollars) ?? (num(m.last_price) != null ? num(m.last_price) / 100 : null);
    const bid = num(m.yes_bid_dollars), ask = num(m.yes_ask_dollars);
    if (last != null && last > 0) return last;
    return bid != null && ask != null && ask > 0 ? (bid + ask) / 2 : last;
  };
  const prevOf = m => num(m.previous_price_dollars) ?? (num(m.previous_price) != null ? num(m.previous_price) / 100 : null);
  const outcomes = markets.map(m => {
    const p = clamp01(price(m)), prev = prevOf(m), c24 = num(m.volume_24h_fp) ?? num(m.volume_24h) ?? 0;
    const avg = p == null ? 0 : prev != null && prev > 0 ? (p + prev) / 2 : p;
    return {
      name: String(markets.length === 1 ? 'Yes' : m.yes_sub_title || m.subtitle || m.title || m.ticker),
      p, d1: p != null && prev != null && prev > 0 ? p - prev : null, d7: null, d30: null,
      vol24: c24 * avg, c24,
    };
  });
  const pOf = m => clamp01(price(m)) || 0;
  const vol24 = outcomes.reduce((s, o) => s + (o.vol24 || 0), 0);
  const contracts24 = outcomes.reduce((s, o) => s + o.c24, 0);
  const vol = markets.reduce((s, m) => s + (num(m.volume_fp) ?? num(m.volume) ?? 0) * pOf(m), 0);
  const oi = markets.reduce((s, m) => s + (num(m.open_interest_fp) ?? num(m.open_interest) ?? 0) * pOf(m), 0);
  const end = markets.map(m => m.expected_expiration_time || m.close_time).filter(Boolean).sort()[0];
  const series = String(e.series_ticker || e.event_ticker || '').toLowerCase();
  return finish({
    id: 'ks:' + e.event_ticker, venue: 'kalshi', title: String(e.title) + (e.sub_title && !/^(before|in|by|on) /i.test(e.sub_title) && !/[()]/.test(e.sub_title) && !/ vs\.? /i.test(e.sub_title) ? ` (${e.sub_title})` : ''),
    cat: catFrom([e.category], e.title), url: `https://kalshi.com/markets/${encodeURIComponent(series)}`,
    end: isoOf(end), vol24, vol, oi, contracts24: Math.round(contracts24), cur: 'USD',
  }, outcomes, e.mutually_exclusive || markets.length === 1);
}
// the full list, paged (200 events a page): the event tickers with the most interest (see interestOf)
async function kalshiScan({ fetchFn, log }) {
  const t0 = Date.now(), all = [];
  let cursor = '', pages = 0;
  do {
    const d = await getJSON(fetchFn, `${KALSHI}/events?status=open&with_nested_markets=true&limit=200${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    pages++;
    for (const e of d.events || []) { const r = fromKalshi(e); if (r) all.push(r); }
    cursor = d.cursor;
  } while (cursor && Date.now() - t0 < KALSHI_SCAN_BUDGET);
  log(`  Kalshi: scanned ${pages} pages, ${all.length} events in ${((Date.now() - t0) / 1000).toFixed(0)} s${cursor ? ' (stopped at the time limit)' : ''}`);
  return all.sort((a, b) => interestOf(b) - interestOf(a)).slice(0, TOP.kalshi);
}
async function kalshi({ fetchFn, prev, now, log }) {
  const meta = prev?.kalshi;
  if (!meta?.tickers?.length || now - (meta.scanned || 0) > KALSHI_SCAN_EVERY) {
    const recs = await kalshiScan({ fetchFn, log });
    return { recs, meta: { scanned: now, tickers: recs.map(r => r.id.slice(3)) } };
  }
  // between scans: refresh the known top events one by one (a closed one simply drops out until the next scan)
  const recs = [];
  await pool(meta.tickers, 6, async t => {
    try {
      const d = await getJSON(fetchFn, `${KALSHI}/events/${encodeURIComponent(t)}?with_nested_markets=true`, { tries: 2 });
      const r = fromKalshi({ ...d.event, markets: d.event?.markets || d.markets });
      if (r) recs.push(r);
    } catch { /* gone or busy: skipped this time */ }
  });
  if (recs.length < meta.tickers.length / 2) throw new Error(`only ${recs.length}/${meta.tickers.length} Kalshi events answered`);
  return { recs: recs.sort((a, b) => b.vol24 - a.vol24), meta };
}

/* ---------- PredictIt ---------- */
// One PredictIt market → one record; each contract is an outcome priced in dollars (= probability). lastClosePrice is
// yesterday's close, which gives the 1-day change. No volume is published.
export function fromPredictIt(m) {
  const cs = (m.contracts || []).filter(c => !c.status || c.status === 'Open');
  if (!cs.length) return null;
  const outcomes = cs.map(c => {
    const p = clamp01(num(c.lastTradePrice)), prev = num(c.lastClosePrice);
    return { name: String(cs.length === 1 ? 'Yes' : c.shortName || c.name), p, d1: p != null && prev ? p - prev : null, d7: null, d30: null };
  });
  const end = cs.map(c => c.dateEnd).filter(d => d && d !== 'N/A').sort()[0];
  return finish({
    id: 'pi:' + m.id, venue: 'predictit', title: String(m.name || m.shortName), cat: catOf(m.name),
    url: m.url || `https://www.predictit.org/markets/detail/${m.id}`, end: isoOf(end), vol24: null, vol: null, cur: 'USD',
  }, outcomes, cs.length > 1);
}
async function predictit({ fetchFn }) {
  const d = await getJSON(fetchFn, 'https://www.predictit.org/api/marketdata/all/');
  return (d.markets || []).map(fromPredictIt).filter(Boolean).slice(0, TOP.predictit);
}

/* ---------- Manifold ---------- */
// Binary: one outcome at `probability` (no changes given: the history here supplies them). Multiple choice: the
// answers from the full market, each with probChanges { day, week, month }. Volume is in mana (play money).
export function fromManifold(m, full = null) {
  const base = {
    id: 'mf:' + m.id, venue: 'manifold', title: String(m.question), cat: catFrom(m.groupSlugs, m.question),
    url: m.url || `https://manifold.markets/${m.creatorUsername}/${m.slug}`, end: m.closeTime ? isoOf(m.closeTime) : null,
    vol24: num(m.volume24Hours) ?? 0, vol: num(m.volume), liq: num(m.totalLiquidity), traders: num(m.uniqueBettorCount), cur: 'MANA',
  };
  if (m.outcomeType === 'BINARY') return finish(base, [{ name: 'Yes', p: clamp01(num(m.probability)), d1: null, d7: null, d30: null }], true);
  if (m.outcomeType === 'MULTIPLE_CHOICE' && full?.answers?.length) {
    const outcomes = full.answers.filter(a => !a.isOther || num(a.probability) > 0.001).map(a => ({
      name: String(a.text), p: clamp01(num(a.probability)),
      d1: num(a.probChanges?.day), d7: num(a.probChanges?.week), d30: num(a.probChanges?.month), vol24: null,
    }));
    return finish({ ...base, cat: catFrom(full.groupSlugs, m.question) }, outcomes, full.shouldAnswersSumToOne !== false);
  }
  return null;
}
async function manifold({ fetchFn }) {
  const list = await getJSON(fetchFn, 'https://api.manifold.markets/v0/search-markets?sort=24-hour-vol&filter=open&limit=150');
  const keep = (list || []).filter(m => !m.isResolved && (m.token || 'MANA') === 'MANA' && ['BINARY', 'MULTIPLE_CHOICE'].includes(m.outcomeType)).slice(0, TOP.manifold);
  const out = [];
  await pool(keep, 6, async m => {
    let full = null;
    if (m.outcomeType === 'MULTIPLE_CHOICE') try { full = await getJSON(fetchFn, `https://api.manifold.markets/v0/market/${encodeURIComponent(m.id)}`, { tries: 2 }); } catch { return; }
    const r = fromManifold(m, full);
    if (r) out.push(r);
  });
  return out.sort((a, b) => b.vol24 - a.vol24);
}

/* ---------- Betfair ---------- */
// The exchange's odds become probabilities as 1 / last traded price; a market's runners overlap by the exchange's
// margin, so in a win market they are scaled to add up to 100%. Money matched is in pounds.
export function fromBetfair(cat, book, usdPerGbp) {
  const runners = (book?.runners || []).filter(r => r.status === 'ACTIVE');
  const names = Object.fromEntries((cat.runners || []).map(r => [r.selectionId, r.runnerName]));
  let outcomes = runners.map(r => ({ name: String(names[r.selectionId] || r.selectionId), p: r.lastPriceTraded > 1 ? 1 / r.lastPriceTraded : null, d1: null, d7: null, d30: null }));
  const sum = outcomes.reduce((s, o) => s + (o.p || 0), 0);
  const exclusive = (cat.description?.bettingType ?? 'ODDS') === 'ODDS' && (book?.numberOfWinners ?? 1) === 1;
  if (exclusive && sum > 0) outcomes = outcomes.map(o => ({ ...o, p: o.p == null ? null : o.p / sum }));
  const matched = num(book?.totalMatched) ?? num(cat.totalMatched) ?? 0;
  const ev = cat.event?.name, title = ev && !String(cat.marketName).includes(ev) ? `${ev}: ${cat.marketName}` : String(cat.marketName);
  return finish({
    id: 'bf:' + cat.marketId, venue: 'betfair', title, cat: catOf(title) === 'Other' ? 'Politics' : catOf(title),
    url: `https://www.betfair.com/exchange/plus/politics/market/${cat.marketId}`, end: isoOf(cat.marketStartTime || cat.event?.openDate),
    vol24: null, vol: matched, cur: 'GBP',
  }, outcomes, exclusive);
}
async function betfair({ fetchFn, env, usdPerGbp }) {
  const key = env.BETFAIR_APP_KEY, user = env.BETFAIR_USERNAME, pass = env.BETFAIR_PASSWORD;
  if (!key || !user || !pass) { const e = new Error('not connected: needs a Betfair API key'); e.off = true; throw e; }
  const login = await getJSON(fetchFn, 'https://identitysso.betfair.com/api/login', {
    tries: 1, method: 'POST',
    headers: { 'X-Application': key, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: user, password: pass }).toString(),
  });
  if (login.status !== 'SUCCESS' || !login.token) throw new Error(`login ${login.error || login.status}`);
  const call = (op, params) => getJSON(fetchFn, `https://api.betfair.com/exchange/betting/rest/v1.0/${op}/`, {
    tries: 2, method: 'POST', body: JSON.stringify(params),
    headers: { 'X-Application': key, 'X-Authentication': login.token, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  const cats = await call('listMarketCatalogue', {
    filter: { eventTypeIds: ['2378961'] },        // Politics
    marketProjection: ['EVENT', 'RUNNER_DESCRIPTION', 'MARKET_START_TIME', 'MARKET_DESCRIPTION'],
    sort: 'MAXIMUM_TRADED', maxResults: TOP.betfair,
  });
  const books = [];
  for (let i = 0; i < cats.length; i += 10) books.push(...await call('listMarketBook', { marketIds: cats.slice(i, i + 10).map(c => c.marketId) }));
  const byId = Object.fromEntries(books.map(b => [b.marketId, b]));
  return cats.map(c => fromBetfair(c, byId[c.marketId], usdPerGbp)).filter(Boolean).sort((a, b) => (b.vol || 0) - (a.vol || 0));
}

/* ---------- history and changes ---------- */
// hist[id] = { d: first day number, p: [one probability per day, the last seen that day] } for the headline outcome.
// A change the venue didn't give is computed from it (today's value vs the last day at least k days back).
export function updateHist(prevHist, recs, now) {
  const today = Math.floor(now / DAY), from = today - KEEP_DAYS + 1, out = {};
  for (const r of recs) {
    const head = r.outcomes.find(o => o.name === r.head);
    const old = prevHist?.[r.id];
    // the series keeps the same outcome: a new headline (a different leader) starts it afresh
    const series = old && old.o === r.head ? old : null;
    const days = new Map();
    if (series) series.p.forEach((v, i) => { if (v != null && series.d + i >= from) days.set(series.d + i, v); });
    days.set(today, head.p);
    const first = Math.min(...days.keys());
    out[r.id] = { o: r.head, d: first, p: Array.from({ length: today - first + 1 }, (_, i) => days.get(first + i) ?? null) };
  }
  return out;
}
export function histChange(h, k, today) {
  if (!h?.p?.length) return null;
  const last = h.p[h.p.length - 1], idx = today - k - h.d;
  if (idx < 0 || last == null) return null;
  for (let i = idx; i >= Math.max(0, idx - 2); i--) if (h.p[i] != null) return last - h.p[i];
  return null;
}
function fillChanges(recs, hist, now) {
  const today = Math.floor(now / DAY);
  for (const r of recs) {
    const head = r.outcomes.find(o => o.name === r.head), h = hist[r.id];
    for (const [key, k] of [['d1', 1], ['d7', 7], ['d30', 30]]) if (head[key] == null) head[key] = r4(histChange(h, k, today));
  }
}

/* ---------- build ---------- */
export async function build({ prev = null, forex = null, env = {}, log = console.log, now = Date.now(), fetchFn = fetch } = {}) {
  const usdPerGbp = (() => {
    const g = forex?.markets?.find(m => m.symbol === 'USD/GBP' || m.symbol === 'GBP/USD');
    return g ? (g.symbol === 'USD/GBP' ? 1 / g.current_price : g.current_price) : 1.3;
  })();
  const ok = prev?.v === FMT ? prev : null;
  const runners = {
    polymarket: () => polymarket({ fetchFn }),
    kalshi: async () => { const k = await kalshi({ fetchFn, prev: ok, now, log }); kalshiMeta = k.meta; return k.recs; },
    predictit: () => predictit({ fetchFn }),
    manifold: () => manifold({ fetchFn }),
    betfair: () => betfair({ fetchFn, env, usdPerGbp }),
  };
  let kalshiMeta = ok?.kalshi || null;
  const venues = {}, markets = [];
  const results = await Promise.allSettled(VENUES.map(v => runners[v.key]()));
  VENUES.forEach((v, i) => {
    const res = results[i];
    if (res.status === 'fulfilled' && res.value.length) {
      markets.push(...res.value);
      venues[v.key] = { state: 'ok', n: res.value.length, at: now };
      log(`  ${v.name}: ${res.value.length} markets`);
      return;
    }
    const why = res.status === 'rejected' ? String(res.reason?.message || res.reason) : 'no open markets returned';
    const off = res.status === 'rejected' && res.reason?.off;
    const old = (ok?.markets || []).filter(m => m.venue === v.key);
    const oldAt = ok?.venues?.[v.key]?.at;
    if (old.length && !off) {
      markets.push(...old.map(m => ({ ...m, stale: true })));
      venues[v.key] = { state: 'stale', n: old.length, at: oldAt ?? null, err: why };
    } else venues[v.key] = { state: off ? 'off' : 'down', n: 0, at: null, err: why };
    log(`  ${v.name}: ${off ? 'off' : 'failed'} (${why})${old.length && !off ? `, keeping ${old.length} from the last update` : ''}`);
  });
  for (const m of markets) {
    const usd = v => { const x = toUsd(v, m.cur, usdPerGbp); return x == null ? null : Math.round(x); };
    m.usd24 = usd(m.vol24); m.usdTotal = usd(m.vol);
    m.interest = Math.round(interestOf(m));
  }
  // one ranking across every venue: #1 has the most interest; PredictIt (no money figures) keeps its feed order last
  markets.sort((a, b) => b.interest - a.interest);
  markets.forEach((m, i) => { m.rank = i + 1; });
  const hist = updateHist(ok?.hist, markets, now);
  fillChanges(markets, hist, now);
  return { v: FMT, market: 'predictions', generated: now, venues, kalshi: kalshiMeta, usdPerGbp: r4(usdPerGbp), markets, hist };
}

/* ---------- CLI (Node only) ---------- */
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
if (IS_NODE && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const [out = 'predictions.json', forexFile] = process.argv.slice(2);
  let prev = null, forex = null;
  if (process.env.PREV_URL) {
    try { prev = await (await fetch(process.env.PREV_URL + '?b=' + Date.now(), { signal: AbortSignal.timeout(20e3) })).json(); }
    catch { console.log('No previous predictions.json (first run?)'); }
  } else try { prev = JSON.parse(await readFile(out, 'utf8')); } catch { /* first local run */ }
  // forex.json for the pound (Betfair): a file, or the published one's address (the deploy job starts this build early)
  if (forexFile) try { forex = /^https?:/.test(forexFile) ? await (await fetch(forexFile, { signal: AbortSignal.timeout(15e3) })).json() : JSON.parse(await readFile(forexFile, 'utf8')); }
  catch { console.log(`No ${forexFile}: pounds at 1.30 dollars`); }
  const data = await build({ prev, forex, env: process.env });
  if (!data.markets.length) { console.error('No prediction markets from any venue'); process.exit(1); }
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB, ${data.markets.length} markets)`);
}
