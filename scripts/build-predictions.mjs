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
import { nameKeys, nameScore } from '../app/names.mjs';

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
    outcomes: shown.map(o => ({ name: o.name, p: r4(o.p), d1: r4(o.d1), d7: r4(o.d7), d30: r4(o.d30), ...(o.vol24 != null ? { vol24: Math.round(o.vol24) } : {}), ...(o.sp != null ? { sp: r4(o.sp) } : {}) })),
    more: clean.length - shown.length,
    // where the headline's own price history lives (backfill): a Kalshi market ticker or a Polymarket token
    ...(head.src ? { src: head.src } : {}),
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
  // "Build your map" style bundles have no single answer that reads on its own: left out
  if (/build your/i.test(e.title || '')) return null;
  const markets = (e.markets || []).filter(m => m.active !== false && !m.closed);
  if (!markets.length) return null;
  // an event of several options where only one is still open keeps that option's name (not a bare "Yes")
  const multiEvent = (e.markets || []).length > 1;
  const spread = m => { const b = num(m.bestBid), a = num(m.bestAsk); return b != null && a != null && a >= b ? a - b : null; };
  const token = m => parseList(m.clobTokenIds)[0];
  const outcomes = [];
  const yesNo = m => { const o = parseList(m.outcomes); return o.length === 2 && /^yes$/i.test(o[0]) && /^no$/i.test(o[1]); };
  if (markets.length === 1 && !yesNo(markets[0])) {
    const m = markets[0], names = parseList(m.outcomes), prices = parseList(m.outcomePrices).map(num);
    const d1 = num(m.oneDayPriceChange), d7 = num(m.oneWeekPriceChange), d30 = num(m.oneMonthPriceChange);
    const tok = parseList(m.clobTokenIds);
    names.forEach((name, i) => outcomes.push({
      name: String(name), p: clamp01(prices[i]), sp: spread(m), src: tok[i] ? { tok: String(tok[i]) } : null,
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
        name: markets.length === 1 && !multiEvent ? 'Yes' : String(m.groupItemTitle || m.question || 'Yes'),
        p, d1: num(m.oneDayPriceChange), d7: num(m.oneWeekPriceChange), d30: num(m.oneMonthPriceChange), vol24: num(m.volume24hr),
        sp: spread(m), src: token(m) ? { tok: String(token(m)) } : null,
      });
    }
  }
  const labels = (e.tags || []).map(t => t.label || t.slug);
  return finish({
    id: 'pm:' + e.slug, venue: 'polymarket', title: String(e.title || markets[0].question),
    cat: catFrom(labels, e.title), url: `https://polymarket.com/event/${encodeURIComponent(e.slug)}`,
    end: isoOf(e.endDate || markets[0].endDate), vol24: num(e.volume24hr) ?? 0, vol: num(e.volume), liq: num(e.liquidity), oi: num(e.openInterest), cur: 'USD',
  }, outcomes, e.negRisk || (markets.length === 1 && !multiEvent));
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
  // the middle of the best bid and ask (what it would cost to trade now), not the last trade, which in a thin market can
  // be one small order; the last trade only when there's no two-sided quote
  const mid = (bid, ask) => bid != null && ask != null && ask > 0 && ask >= bid ? (bid + ask) / 2 : null;
  const price = m => {
    const last = num(m.last_price_dollars) ?? (num(m.last_price) != null ? num(m.last_price) / 100 : null);
    return mid(num(m.yes_bid_dollars), num(m.yes_ask_dollars)) ?? (last != null && last > 0 ? last : null);
  };
  const prevOf = m => mid(num(m.previous_yes_bid_dollars), num(m.previous_yes_ask_dollars))
    ?? num(m.previous_price_dollars) ?? (num(m.previous_price) != null ? num(m.previous_price) / 100 : null);
  const spreadOf = m => { const b = num(m.yes_bid_dollars), a = num(m.yes_ask_dollars); return b != null && a != null && a > 0 && a >= b ? a - b : null; };
  const outcomes = markets.map(m => {
    const p = clamp01(price(m)), prev = prevOf(m), c24 = num(m.volume_24h_fp) ?? num(m.volume_24h) ?? 0;
    const avg = p == null ? 0 : prev != null && prev > 0 ? (p + prev) / 2 : p;
    return {
      name: String(markets.length === 1 ? 'Yes' : m.yes_sub_title || m.subtitle || m.title || m.ticker),
      p, d1: p != null && prev != null && prev > 0 ? p - prev : null, d7: null, d30: null,
      vol24: c24 * avg, c24, sp: spreadOf(m), src: { tk: m.ticker, series: e.series_ticker || null },
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
    out[r.id] = { o: r.head, d: first, p: Array.from({ length: today - first + 1 }, (_, i) => days.get(first + i) ?? null), ...(series?.bf ? { bf: series.bf } : {}) };
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

/* ---------- backfill: the venues' own daily prices for the days this file hasn't seen ---------- */
// A new record's history starts on the day it's first tracked, so 1w / 1m moves would be blank for a month. Kalshi
// (daily candles) and Polymarket (prices-history) publish their past prices: for a record with under 25 days of history
// the missing days are filled from there, at most BACKFILL_PER_RUN records per venue per update (so a first run
// doesn't hammer them), and each record is asked at most once a day.
const BACKFILL_PER_RUN = 40, BACKFILL_MIN_DAYS = 25;
const dayOfTs = s => Math.floor((s * 1000 - 1) / DAY);   // a candle stamped at the end of its day belongs to that day
async function pastPrices(fetchFn, src, now) {
  const end = Math.floor(now / 1000), start = end - KEEP_DAYS * 86400, out = new Map();
  if (src.tk && src.series) {
    const d = await getJSON(fetchFn, `${KALSHI}/series/${encodeURIComponent(src.series)}/markets/${encodeURIComponent(src.tk)}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=1440`, { tries: 2 });
    for (const c of d.candlesticks || []) {
      const b = num(c.yes_bid?.close_dollars), a = num(c.yes_ask?.close_dollars), last = num(c.price?.close_dollars);
      const p = b != null && a != null && a > 0 && a >= b ? (a + b) / 2 : last;
      if (p != null && c.end_period_ts) out.set(dayOfTs(c.end_period_ts), clamp01(p));
    }
  } else if (src.tok) {
    // Polymarket's prices-history takes either a time range or a named interval, and answers some combinations with an
    // empty or near-empty history: try the forms in turn until one gives 5+ days (several points a day: the day's last)
    const base = `https://clob.polymarket.com/prices-history?market=${encodeURIComponent(src.tok)}`;
    let lastErr = null;
    for (const q of [`&interval=1m&fidelity=1440`, `&interval=max&fidelity=1440`, `&startTs=${start}&endTs=${end}&fidelity=1440`, `&interval=1m&fidelity=60`]) {
      try {
        const d = await getJSON(fetchFn, base + q, { tries: 1 });
        const pts = (d.history || []).filter(x => num(x.p) != null && x.t).sort((a, b) => a.t - b.t);
        for (const x of pts) out.set(Math.floor(x.t * 1000 / DAY), clamp01(num(x.p)));
        if (out.size >= 5) break;          // a day or two only (some forms answer just the latest points): try the next
      } catch (e) { lastErr = e; }
    }
    if (!out.size && lastErr) throw lastErr;
  }
  return out;
}
export async function backfill({ fetchFn, markets, hist, now, log = () => {} }) {
  const today = Math.floor(now / DAY), from = today - KEEP_DAYS + 1;
  const want = markets.filter(m => m.src && !m.stale && hist[m.id] && hist[m.id].p.filter(v => v != null).length < BACKFILL_MIN_DAYS && !(now - (hist[m.id].bf || 0) < DAY));
  const pick = ['kalshi', 'polymarket'].flatMap(v => want.filter(m => m.venue === v).slice(0, BACKFILL_PER_RUN));
  let filled = 0;
  const why = {};                        // the first reason each venue's history came back empty, for the log
  await pool(pick, 4, async m => {
    const h = hist[m.id];
    h.bf = now;
    try {
      const past = await pastPrices(fetchFn, m.src, now);
      if (!past.size) { why[m.venue] ??= 'no past prices returned'; return; }
      const days = new Map(h.p.map((v, i) => [h.d + i, v]).filter(x => x[1] != null));
      for (const [d, v] of past) if (d >= from && d < today && !days.has(d)) days.set(d, v);   // today stays the live price
      const first = Math.min(...days.keys());
      h.d = first; h.p = Array.from({ length: today - first + 1 }, (_, i) => days.get(first + i) ?? null);
      filled++;
    } catch (e) { why[m.venue] ??= String(e.message || e).slice(0, 160); /* tried again tomorrow */ }
  });
  if (pick.length) {
    const by = v => { const n = pick.filter(m => m.venue === v); return n.length ? `${v} ${n.filter(m => (hist[m.id].p.filter(x => x != null).length) > 1).length}/${n.length}` : null; };
    log(`  History: backfilled ${filled}/${pick.length} markets from the venues' past prices (${['kalshi', 'polymarket'].map(by).filter(Boolean).join(', ')})`
      + Object.entries(why).map(([v, w]) => `; ${v}: ${w}`).join(''));
  }
}

/* ---------- the same question on several venues ---------- */
// No shared ids exist, so questions are matched by their words and, for several-outcome questions, their outcomes:
//   - the title's meaningful words (no "will", "who", "winner"…) overlap (Jaccard similarity), years must agree, and
//     a party word on one side and the other party on the other blocks a match (Democratic vs Republican nominee);
//   - two yes/no questions need ≥ 0.7 word overlap; two several-outcome questions ≥ 0.35 plus at least half their
//     leading outcomes in common (2 or more); a yes/no is never matched with a several-outcome question.
// Each venue appears at most once in a group; the group's id is its member with the most interest. Matching is a
// best guess: the page shows each venue's own price and links to it, so a wrong match is visible, not hidden.
const STOP = new Set('will the who what which when where how win wins winner winning be by after before for a an and or of on in to is are at as with than this that next market odds election elections us u.s 2025s'.split(' '));
const words = t => new Set(String(t).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/s$/, '')));
const years = t => new Set(String(t).match(/\b20\d\d\b/g) || []);
// a person's surname, so "J.D. Vance" ≈ "Vance", "Scott Colom (D)" ≈ "Colom" and PredictIt's "Dems (Colom)" ≈ "Colom"
export const normName = n => { let s = String(n).toLowerCase(); const inner = s.match(/\(([^)]{4,})\)/); if (inner && /^(dems?|democrats?|gop|republicans?|rep|ind|independent)\b/.test(s)) s = inner[1]; s = s.replace(/\([^)]{0,3}\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').trim(); return s.split(/\s+/).pop() || ''; };
const PARTY = [/\b(democrat|democratic|democrats|dem|dems)\b/i, /\b(republican|republicans|gop)\b/i];
// places: two questions naming different states or countries are never the same question ("which party wins the
// Senate race in Alaska" vs "… in Maine" share every other word)
const PLACES = ['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'west virginia', 'washington', 'wisconsin', 'wyoming',
  'france', 'french', 'germany', 'german', 'israel', 'canada', 'canadian', 'japan', 'brazil', 'mexico', 'india', 'australia', 'uk', 'britain', 'british', 'italy', 'spain', 'poland', 'hungary', 'chile', 'colombia', 'peru', 'argentina', 'south korea', 'korea', 'netherlands', 'portugal', 'ukraine', 'russia', 'iran', 'venezuela', 'china', 'taiwan', 'romania', 'czech', 'philippines', 'new york city', 'nyc', 'los angeles', 'chicago'];
const placesOf = t => { const s = ' ' + String(t).toLowerCase().replace(/[^a-z ]+/g, ' ') + ' '; const out = new Set(); for (const p of PLACES) if (s.includes(' ' + p + ' ')) out.add(p); for (const p of [...out]) for (const q of out) if (q !== p && q.includes(p)) out.delete(p); return out; };
// US House districts: "NC-03", "North Carolina's 3rd District" and "NC 3" are all nc03; two different districts are never
// the same question, and a district code counts as a word (otherwise "NC-03 House winner" and "AZ-02 House winner" match)
const ABBR = { alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co', connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa', 'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy' };
const ABBRS = new Set(Object.values(ABBR));
export function districtOf(t) {
  const s = String(t);
  let m = s.match(/\b([A-Z]{2})[- ]?(\d{1,2})\b/);
  if (m && ABBRS.has(m[1].toLowerCase())) return m[1].toLowerCase() + m[2].padStart(2, '0');
  m = s.toLowerCase().match(/\b([a-z]+(?: [a-z]+)?)[’']s (\d{1,2})(?:st|nd|rd|th) (?:congressional )?district\b/);
  if (m) { const st = ABBR[m[1]] || ABBR[m[1].split(' ').pop()]; if (st) return st + m[2].padStart(2, '0'); }
  if (/\bat[- ]large\b/i.test(s)) { const st = Object.keys(ABBR).find(k => s.toLowerCase().includes(k)); if (st) return ABBR[st] + '00'; }
  return null;
}
const jaccard = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n || 1); };
function sameQuestion(a, b) {
  if (a.venue === b.venue) return 0;
  const yn = m => m.outcomes.length === 1;
  const ya = years(a.title), yb = years(b.title);
  if (ya.size && yb.size && ![...ya].some(y => yb.has(y))) return 0;
  const pa = placesOf(a.title), pb = placesOf(b.title);
  if (pa.size && pb.size && ![...pa].some(p => pb.has(p))) return 0;
  // a spread, a total or a margin is a different question from who wins: only matched with its own kind
  const kind = t => (String(t).toLowerCase().match(/\b(spread|total|o\/u|over\/under|margin|exact score|handicap)\b/) || [''])[0];
  if (kind(a.title) !== kind(b.title)) return 0;
  const da0 = districtOf(a.title), db0 = districtOf(b.title);
  if ((da0 || db0) && da0 !== db0) return 0;                       // a district on one side only, or two different ones
  // "which party wins the Senate" (the whole country) vs "… in Alaska": only one names a place and the outcomes are
  // just the parties, so nothing else tells them apart
  const parties = m => m.outcomes.length > 1 && m.outcomes.every(o => { const k = nameKeys(o.name); return k.party && !k.words.size; });   // party names only
  if (!pa.size !== !pb.size && (parties(a) || parties(b))) return 0;
  const [da, ra] = PARTY.map(re => re.test(a.title)), [db, rb] = PARTY.map(re => re.test(b.title));
  if ((da && !ra && rb && !db) || (ra && !da && db && !rb)) return 0;
  const wa = words(a.title), wb = words(b.title);
  if (da0) { wa.add(da0); wb.add(db0); }
  const sim = jaccard(wa, wb);
  if (yn(a) !== yn(b)) return 0;
  if (yn(a)) return sim >= 0.7 ? sim : 0;
  // outcomes in common: by words (surnames, teams, a letter's difference), by party for a party-only answer
  // ("Democrats" ≈ "Mary Peltola (D)"), numbers in full; "Other" and the like don't count
  const keep = o => !/^(other|another|none|no one|field|any other)\b/i.test(o.name);
  const ka = a.outcomes.filter(keep).slice(0, 6).map(o => nameKeys(o.name)), kb = b.outcomes.filter(keep).slice(0, 6).map(o => nameKeys(o.name));
  const shared = ka.filter(x => kb.some(y => nameScore(x, y) > 0)).length;
  // the same district, or the same place with well-matched outcomes, needs fewer title words in common: venues word
  // these very differently ("NC-03 House winner?" / "Which party will win … North Carolina's 3rd District?")
  const samePlace = (da0 && da0 === db0) || (pa.size && [...pa].some(p => pb.has(p)));
  const need = da0 && da0 === db0 ? 0.1 : samePlace ? 0.25 : 0.35;
  return sim >= need && shared >= 2 && shared >= Math.min(ka.length, kb.length) / 2 ? sim + shared / 10 : 0;
}
export function matchGroups(markets) {
  const byInterest = [...markets].sort((a, b) => (b.interest || 0) - (a.interest || 0));
  const groupOf = new Map();                  // id → leader id
  const members = new Map();                  // leader id → [records]
  for (const m of byInterest) {
    if (groupOf.has(m.id)) continue;
    let best = null, bestScore = 0;
    for (const [lead, ms] of members) {
      if (ms.some(x => x.venue === m.venue)) continue;
      const score = Math.min(...ms.map(x => sameQuestion(x, m)));
      if (score > bestScore) { best = lead; bestScore = score; }
    }
    if (best) { members.get(best).push(m); groupOf.set(m.id, best); }
    else { members.set(m.id, [m]); groupOf.set(m.id, m.id); }
  }
  let n = 0;
  for (const m of markets) {
    const lead = groupOf.get(m.id);
    if (members.get(lead).length > 1) { m.group = lead; if (lead === m.id) n++; } else delete m.group;
  }
  return n;
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
      res.value.forEach((m, j) => { m.ord = j + 1; });   // the venue's own order (PredictIt's tab follows it)
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
  await backfill({ fetchFn, markets, hist, now, log });
  fillChanges(markets, hist, now);
  const groups = matchGroups(markets);
  log(`  Matched ${groups} questions listed on more than one venue`);
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
