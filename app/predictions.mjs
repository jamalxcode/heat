// heat.sala.company/predictions/: prediction markets from Polymarket, Kalshi, PredictIt, Manifold and Betfair
// (predictions.json, built by scripts/build-predictions.mjs). Not prices, so like the rates page it draws its own view.
// Built to be read at a glance and dug into:
//   - a tile says what the market thinks in plain words ("Likely: Scott Colom · 89%"); its colour is how sure the market
//     is (light = toss-up, dark = near certain), a chip shows the move (teal ▲ / amber ▼) and a line shows the trend;
//   - tabs ask the reader's question: surest bets, biggest bets, close calls, big movers, ending soon, venues disagree;
//   - a "Today" strip pulls out the news; related questions group into stories; a money map sizes every question by
//     the money on it; a watchlist keeps chosen questions on top;
//   - a click opens the answer first (verdict, big chart, its biggest moves), then each venue, every outcome, related
//     questions and the fine print, with a full-screen view.
// A question listed on several venues is one tile in "All" (matched by the build). main.mjs starts this instead of
// the price pipeline.
import { $, $$, esc, M, S, store } from './core.mjs';
import { renderHealth } from './render.mjs';

const DAY = 864e5, REFRESH = 10 * 60e3, ALL_MAX = 200;
const DECIDED = 0.97;                  // a question whose likeliest outcome is at least this sure counts as decided
const THIN = 1000;                     // less interest than this (in dollars, real money): a thin market, faded
const DIFFER = 0.05;                   // venues disagreeing by at least this much are flagged ⚡
const MOVER_MIN = 1e4;                 // big movers need at least this much interest, or a tiny market's jump leads
const VENUES = [
  ['polymarket', 'Polymarket', 'PM'], ['kalshi', 'Kalshi', 'K'], ['predictit', 'PredictIt', 'PI'],
  ['manifold', 'Manifold', 'MF'], ['betfair', 'Betfair', 'BF'],
];
const VNAME = Object.fromEntries(VENUES.map(v => [v[0], v[1]])), VTAG = Object.fromEntries(VENUES.map(v => [v[0], v[2]]));
const CATS = ['Politics', 'World', 'Economy', 'Business', 'Crypto', 'Tech & science', 'Sports', 'Culture', 'Climate', 'Other'];
const TFS = [['1d', 'd1', 'today', '1 day'], ['1w', 'd7', 'this week', '1 week'], ['1m', 'd30', 'this month', '1 month']];
const COLS = [['rank', '#'], ['title', 'Question'], ['venue', 'Venue'], ['head', 'Answer'], ['p', 'Chance'], ['chg', 'Move'], ['today', 'Bet today'], ['total', 'Bet in total'], ['end', 'Ends'], ['cat', 'Topic']];
// the tabs: each answers a reader's question
const ORDERS = [
  ['sure', 'Surest bets', 'The most certain open questions with the most money behind them'],
  ['money', 'Biggest bets', 'Where the most money is: bet today plus a 30th of all money bet'],
  ['close', 'Close calls', 'Questions near 50/50 with a lot of money on them'],
  ['movers', 'Big movers', 'The biggest moves in the chance shown'],
  ['ending', 'Ending soon', 'Questions that resolve soonest'],
  ['disagree', 'Venues disagree', 'The same question priced differently on two venues'],
];
const pref = (k, ok, d) => { const v = store.get(k); return ok.includes(v) ? v : d; };
const Q = new URLSearchParams(location.search);
let P = null, loadedAt = 0, sel = null, query = '', groups = new Map(), full = false;
const pos = new Map();                 // each question's place in the current order (the #number on its tile)
let venue = (v => ['all', ...VENUES.map(x => x[0])].includes(v) ? v : null)(Q.get('v')) || pref('hm.predVenue', ['all', ...VENUES.map(x => x[0])], 'all');
let tf = pref('hm.predTf', TFS.map(t => t[0]), '1d');
let viewAs = pref('hm.predView2', ['tiles', 'map', 'table'], 'tiles');
let groupBy = pref('hm.predGroup2', ['none', 'cat', 'story'], 'none');
let order = (o => ORDERS.some(x => x[0] === o) ? o : null)(Q.get('o')) || pref('hm.predOrder', ORDERS.map(x => x[0]), 'sure');
let play = store.get('hm.predPlay') === true;                         // Manifold's play money in "All" (off by default)
const hidden = new Set(Array.isArray(store.get('hm.predHide')) ? store.get('hm.predHide') : ['games']);   // topics switched off
const watch = new Set(Array.isArray(store.get('hm.predWatch')) ? store.get('hm.predWatch') : []);       // the watchlist
let sortBy = { key: 'rank', dir: 1 };

/* ---------- numbers and words ---------- */
const pct = p => p == null ? '—' : p >= 0.995 && p < 1 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : Math.round(p * 100) + '%';
// moves in points (percentage points: 40% → 52% is +12 pts)
const pts = v => { if (v == null) return '—'; const x = v * 100, r = Math.abs(x) < 10 ? Math.abs(x).toFixed(1).replace(/\.0$/, '') : Math.round(Math.abs(x)); return (x > 0.05 ? '+' : x < -0.05 ? '−' : '±') + r + ' pts'; };
const arrow = v => v == null || Math.abs(v) < 0.0005 ? '' : v > 0 ? '▲ ' : '▼ ';
const money = (n, cur) => {
  if (n == null) return '—';
  const sign = cur === 'MANA' ? 'M$' : cur === 'GBP' ? '£' : '$';
  for (const [v, s] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (Math.abs(n) >= v) return sign + (n / v).toFixed(n / v >= 100 ? 0 : 1).replace(/\.0$/, '') + s;
  return sign + Math.round(n);
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const dayLabel = iso => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short', year: iso.slice(0, 4) === String(new Date().getUTCFullYear()) ? undefined : 'numeric', timeZone: 'UTC' }) : '—';
const dayOf = d => new Date(d * DAY).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });
const headOf = m => m.outcomes.find(o => o.name === m.head) || m.outcomes[0];
const tfKey = () => TFS.find(t => t[0] === tf)[1];
const normName = n => { let s = String(n).toLowerCase(); const inner = s.match(/\(([^)]{4,})\)/); if (inner && /^(dems?|democrats?|gop|republicans?|rep|ind|independent)\b/.test(s)) s = inner[1]; s = s.replace(/\([^)]{0,3}\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').trim(); return s.split(/\s+/).pop() || ''; };   // as the build matches

// The common yardstick (scripts/build-predictions.mjs interestOf), in dollars on every venue: money bet today (last 24 h)
// and in total; interest = bet today + a 30th of bet in total. PredictIt publishes no money figures: interest 0.
const today$ = m => m.usd24 ?? null, total$ = m => m.usdTotal ?? null;
const interest = m => m.interest ?? ((today$(m) || 0) + (total$(m) || 0) / 30);
const isPlay = m => m.cur === 'MANA';
const isYesNo = m => m.outcomes.length === 1 && /^yes$/i.test(m.outcomes[0].name);
const isLadder = m => m.outcomes.length > 1 && !m.exclusive;   // "above 50 / above 52 seats", "through Oct 31 / Nov 30"
const neg = v => v == null ? null : -v;
const topOf = m => m.outcomes.reduce((a, o) => (o.p ?? -1) > (a.p ?? -1) ? o : a, m.outcomes[0]);
// on a ladder every step is its own yes/no, and the sure steps say nothing: the step nearest 50% is the informative one
const nearHalf = m => m.outcomes.reduce((a, o) => Math.abs((o.p ?? 0) - 0.5) < Math.abs((a.p ?? 0) - 0.5) ? o : a, m.outcomes[0]);

// The answer a tile shows: for yes/no the likelier side (2% yes is "No 98%", its move turned round); for who-wins the
// likeliest; on a ladder the step nearest 50%; for one named option, that option.
function shownOutcome(m) {
  if (isYesNo(m)) {
    const o = m.outcomes[0];
    if (o.p != null && o.p < 0.5) return { name: 'No', p: 1 - o.p, d1: neg(o.d1), d7: neg(o.d7), d30: neg(o.d30), no: true, yn: true };
    return { ...o, name: 'Yes', yn: true };
  }
  return { ...(isLadder(m) ? nearHalf(m) : m.exclusive ? topOf(m) : headOf(m)) };
}
// The verdict, in words that are right whatever the question: how sure the market is about the answer shown. The leader
// of a crowded field is its front-runner even at 30%; a ladder step can be unlikely.
function verdict(m, h = shownOutcome(m)) {
  const p = h.p ?? 0;
  if (!h.yn && !isLadder(m) && m.exclusive && m.outcomes.length > 2 && p < 0.6) return 'Front-runner';   // a two-way race at 55% is a toss-up
  return p >= 0.9 ? 'Almost certain' : p >= 0.75 ? 'Likely' : p >= 0.6 ? 'Leaning' : p > 0.4 ? 'Toss-up' : p > 0.25 ? 'Unlikely' : p > 0.1 ? 'Very unlikely' : 'Long shot';
}
// how sure the market already is (for "decided")
function certainty(m) {
  if (isYesNo(m)) { const p = m.outcomes[0].p ?? 0.5; return Math.max(p, 1 - p); }
  if (isLadder(m)) return Math.min(...m.outcomes.map(o => Math.max(o.p ?? 0.5, 1 - (o.p ?? 0.5))));
  return topOf(m).p ?? 0;
}
// how open it still is (1 = a coin toss): a yes/no or a ladder step near 50%, or a two-horse race
function closeness(m) {
  if (isYesNo(m)) return 1 - Math.abs(2 * (m.outcomes[0].p ?? 0) - 1);
  if (isLadder(m)) return 1 - Math.abs(2 * (nearHalf(m).p ?? 0) - 1);
  // two leaders close together, and holding most of the chance between them: a crowded field at 17% / 15% isn't a close call
  const ps = m.outcomes.map(o => o.p ?? 0).sort((a, b) => b - a);
  return (1 - (ps[0] - (ps[1] ?? 0))) * Math.min(1, ps[0] + (ps[1] ?? 0));
}
const decided = m => (m.end && m.end < todayIso()) || certainty(m) >= DECIDED;
const decidedWhy = m => m.end && m.end < todayIso() ? `past its end date (${dayLabel(m.end)}): waiting for the result` : `${pct(certainty(m))} sure already`;
// tile colour: how sure the market is about the answer shown (c0 toss-up … c4 near certain); a long shot is just as sure
// the other way, so a ladder step at 9% is coloured like 91%
const sureClass = h => { const p = h.p ?? 0.5, s = Math.max(p, 1 - p); return s >= 0.9 ? 'c4' : s >= 0.8 ? 'c3' : s >= 0.7 ? 'c2' : s >= 0.6 ? 'c1' : 'c0'; };
// move chip colours: teal = more likely, amber = less (q classes in index.html), never the parties' blue and red
const heat = v => {
  if (v == null) return 'q0';
  const t = M.bins[tf], a = Math.abs(v * 100), k = a < t[0] ? 0 : a < t[1] ? 1 : a < t[2] ? 2 : a < t[3] ? 3 : 4;
  return k === 0 ? 'q0' : (v > 0 ? 'q' : 'q-') + k;
};
const topicOf = m => m.cat === 'Sports' && /\bvs\.?\b|\bv\b/i.test(m.title) ? 'games' : m.cat;   // single games apart from sport

/* ---------- stories: related questions together ---------- */
// "Alaska Senate (party)", "Alaska Senate (person)" and "which party wins Alaska" are one story; so are every 2028
// presidential question, Senate control and its seat counts, and so on. Words, not ids: a best guess.
const STATES = ['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'west virginia', 'wisconsin', 'wyoming'];
const cap = s => s.replace(/\b\w/g, c => c.toUpperCase());
export function storyOf(title) {
  const t = ' ' + String(title).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ') + ' ';
  const st = STATES.filter(s => t.includes(' ' + s + ' ')).sort((a, b) => b.length - a.length)[0];
  const office = /\bsenate\b/.test(t) ? 'Senate' : /\b(governor|gubernatorial)\b/.test(t) ? 'Governor' : /\bmayor/.test(t) ? 'Mayor' : null;
  if (st && office) return `${cap(st)} ${office}`;
  if (/\b(la|los angeles)\b/.test(t) && office === 'Mayor') return 'Los Angeles Mayor';
  if (/\b2028\b/.test(t) && /\b(presiden\w*|nominee|nomination)\b/.test(t)) return '2028 presidential race';
  if (/\bsenate\b/.test(t) && /\b(seats?|control|majority)\b/.test(t)) return 'Senate control';
  if (/\bhouse\b/.test(t) && /\b(seats?|control|majority|popular vote)\b/.test(t)) return 'House control';
  if (/\b(blue|red) wave\b|\bmidterms?\b/.test(t)) return '2026 midterms';
  if (/\biran\b/.test(t)) return 'Iran';
  if (/\b(russia|ukraine|putin|zelensky|crimea)\b/.test(t)) return 'Russia and Ukraine';
  if (/\b(israel|gaza|hamas|netanyahu)\b/.test(t)) return 'Israel';
  if (/\b(venezuela|maduro)\b/.test(t)) return 'Venezuela';
  if (/\b(bitcoin|btc)\b/.test(t)) return 'Bitcoin price';
  if (/\b(ethereum|eth)\b/.test(t)) return 'Ethereum price';
  if (/\b(fed|fomc|rate cut|rate hike|interest rates?)\b/.test(t)) return 'Fed rates';
  if (/\btrump\b/.test(t)) return 'Trump';
  return null;
}

/* ---------- a picture for each question: a flag for a country's politics, a coin for crypto, and so on ---------- */
// first match wins; flags before topics, so "Prime Minister of Iran" is 🇮🇷 and not 🗳️.
// Hard rule (the site owner's): questions about Israel, Gaza or Palestine show the Palestinian flag 🇵🇸, never the Israeli flag.
const FLAGS = [
  ['🇬🇧', /\b(uk|u\.k\.|britain|british|england|scotland|starmer|labour|tory|tories|reform uk|farage|westminster)\b/],
  ['🇨🇦', /\b(canada|canadian|carney|poilievre|trudeau|ontario|quebec)\b/],
  ['🇫🇷', /\b(france|french|macron|le pen|bardella|m[ée]lenchon)\b/],
  ['🇩🇪', /\b(germany|german|merz|bundestag|afd)\b/],
  ['🇵🇸', /\b(israel|israeli|netanyahu|knesset|gaza|hamas|palestine|palestinian|west bank)\b/],
  ['🇮🇷', /\b(iran|iranian|khamenei|pahlavi|tehran|hormuz)\b/],
  ['🇺🇦', /\b(ukraine|ukrainian|zelensky|kyiv|crimea)\b/],
  ['🇷🇺', /\b(russia|russian|putin|kremlin)\b/],
  ['🇹🇼', /\b(taiwan|taipei|kaohsiung)\b/],
  ['🇸🇪', /\b(sweden|swedish)\b/],
  ['🇪🇸', /\b(spain|spanish|s[aá]nchez)\b/],
  ['🇳🇱', /\b(netherlands|dutch)\b/],
  ['🇮🇹', /\b(italy|italian|meloni)\b/],
  ['🇨🇳', /\b(china|chinese|xi jinping|beijing)\b/],
  ['🇻🇪', /\b(venezuela|maduro|machado)\b/],
  ['🇯🇵', /\b(japan|japanese|takaichi)\b/],
  ['🇰🇷', /\b(south korea|korean)\b/],
  ['🇰🇵', /\b(north korea|kim jong)\b/],
  ['🇮🇳', /\b(india|indian|modi)\b/],
  ['🇧🇷', /\b(brazil|brazilian|lula|bolsonaro)\b/],
  ['🇦🇷', /\b(argentina|milei)\b/],
  ['🇲🇽', /\b(mexico|mexican|sheinbaum)\b/],
  ['🇦🇺', /\b(australia|australian|albanese)\b/],
  ['🇵🇱', /\b(poland|polish)\b/],
  ['🇭🇺', /\b(hungary|orb[aá]n)\b/],
  ['🇹🇷', /\b(turkey|erdo[gğ]an)\b/],
  ['🇻🇦', /\b(pope|vatican)\b/],
];
const US = /\b(us|u\.s\.|usa|america|american|senate|senator|house|congress|governor|gubernatorial|mayor|mayoral|nyc|los angeles|trump|vance|newsom|harris|biden|democrats?|democratic|republicans?|gop|midterms?|supreme court|scotus|alito|white house|electoral|presidential|blue (wave|tsunami)|red wave|[a-z]{2}-\d{1,2}|h\.r\.?\s?\d+)\b/;
const ICONS = [
  ['🪙', /\b(bitcoin|btc|crypto|ethereum|eth|solana|xrp|doge(coin)?|stablecoin|memecoin|coinbase|token)\b/],
  ['🏦', /\b(fed|fomc|interest rates?|rate cuts?|rate hikes?|powell)\b/], ['📈', /\b(s&p|nasdaq|dow|stocks?|recession|gdp|inflation|cpi|jobs|unemployment|tariffs?|layoffs)\b/],
  ['🛢️', /\b(oil|gas prices?|opec)\b/], ['🤖', /\b(ai|openai|chatgpt|gpt|anthropic|claude|gemini|agi|grok)\b/], ['🚀', /\b(spacex|starship|nasa|rocket|moon|mars)\b/], ['👽', /\b(aliens?|ufos?|uap)\b/],
  ['🏈', /\b(nfl|super bowl|pro football|college football|heisman|cfp)\b/], ['🏀', /\b(nba|wnba|ncaa basketball|march madness)\b/], ['⚾', /\b(mlb|world series)\b/], ['🏒', /\b(nhl|stanley cup)\b/],
  ['🎾', /\b(atp|wta|wimbledon|us open|french open|australian open|masters|grand slam)\b/], ['🏎️', /\b(f1|formula 1|grand prix|nascar)\b/], ['🥊', /\b(ufc|boxing|fight)\b/], ['⛳', /\b(pga|golf|masters tournament)\b/],
  ['🎮', /\b(lol|league of legends|worlds|esports|cs2|dota|valorant)\b/], ['⚽', /\b(uefa|champions league|premier league|la liga|serie a|bundesliga|fifa|world cup|laliga|fc|cf|sk|real madrid|liverpool|arsenal|manchester|barcelona|bayern|psg|chelsea|juventus|milan|inter|dortmund|napoli|porto|ajax|psv|celtic|betis|sevilla|atl[eé]tico|tottenham|leipzig)\b/],
  ['📱', /\b(tweets?|truth social|x posts?)\b/], ['🎬', /\b(oscars?|box office|movie|film|netflix)\b/], ['🎵', /\b(grammys?|album|song|billboard|spotify|taylor swift)\b/], ['🏆', /\b(award|person of the year|nobel)\b/],
  ['🌀', /\b(hurricane|storm|typhoon)\b/], ['🌡️', /\b(temperature|heat|warmest|climate)\b/],
];
const CAT_ICON = { Politics: '🗳️', World: '🌍', Economy: '📈', Business: '💼', Crypto: '🪙', 'Tech & science': '🔬', Sports: '🏆', Culture: '🎭', Climate: '🌡️', Other: '🔮' };
export function iconOf(title, cat) {
  const t = ' ' + String(title).toLowerCase() + ' ';
  if (cat === 'Politics' || cat === 'World') {
    const f = FLAGS.find(([, re]) => re.test(t));
    if (f) return f[0];
    if (US.test(t) || STATES.some(s => t.includes(' ' + s + ' '))) return '🇺🇸';
  }
  if (cat === 'Sports' && /\bvs\.?\b/.test(t) && !ICONS.slice(8, 18).some(([, re]) => re.test(t))) return '🏟️';
  const i = ICONS.find(([, re]) => re.test(t));
  return i ? i[0] : CAT_ICON[cat] || '🔮';
}
const icon = m => `<span class="p-ico" aria-hidden="true">${iconOf(m.title, m.cat)}</span>`;

/* ---------- a short headline, the full question under it ---------- */
const MAXHEAD = 52;                    // a headline longer than this is cut (the full question shows under it)
const capFirst = s => s ? s[0].toUpperCase() + s.slice(1) : s;
export function shortTitle(title) {
  let s = String(title).replace(/\s*-\s*More Markets$/i, '').replace(/\s*\((Build Your Map|[A-Z]{2}-\d+|H\.R\.\s?\d+|Directional|Person|Party)\)/gi, '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
  const q = /\?$/.test(s);
  s = s.replace(/\?$/, '');
  let r;
  if ((r = s.match(/^What (?:price )?will (.+?) hit (?:in |by |on )?(.+)$/i))) s = `${r[1].replace(/\s*\((\w+)\)$/, '')} peak ${r[2]}`;
  else if ((r = s.match(/^(.+?) price on (.+?)( at .+)?$/i))) s = `${r[1]} price on ${r[2]}`;
  else if ((r = s.match(/^How many (.+?) will (.+?) (hold|win|have|get)( after| in| by)? (the )?(.+)$/i))) s = `${r[2]}’ ${r[1]}${r[4] ? r[4] : ' in'} ${r[6]}`.replace(/s’ /, 's’ ').replace(/([^s])’ /, '$1’s ');
  else if ((r = s.match(/^How many (.+)$/i))) s = `Number of ${r[1]}`;
  else if ((r = s.match(/^Who will win (the )?(.+)$/i))) s = `${r[2]}: winner`;
  else if ((r = s.match(/^Which party will win (the )?(.+)$/i))) s = `${r[2]}: which party`;
  else if (s.length > MAXHEAD && (r = s.match(/^Will (the )?(.+)$/i))) s = capFirst(r[2]) + (q ? '?' : '');
  else if (q) s += '?';
  s = s.replace(/\s*\.\.\.\?$/, ' …?').replace(/\s+\.\.\.$/, '…');
  if (s.length > MAXHEAD) { const cut = s.slice(0, MAXHEAD - 2); s = cut.slice(0, Math.max(cut.lastIndexOf(' '), 28)).replace(/[,:;\s]+$/, '') + '…'; }
  return capFirst(s);
}
// the shortened headline and, when it differs, the full question
const titleParts = m => { const s = shortTitle(m.title), full = String(m.title).replace(/\u200b/g, ''); const k = x => x.toLowerCase().replace(/[^a-z0-9]+/g, ''); return [s, k(s) === k(full) ? '' : full]; };

/* ---------- time left: a ring that fills up as the end date nears ---------- */
// days to go on a log scale over a year, so a week and a month look different while next year still shows a sliver
const daysLeft = m => m.end ? Math.round((Date.parse(m.end + 'T23:59:59Z') - Date.now()) / DAY) : null;
const leftLabel = d => d == null ? '' : d < 0 ? 'ended' : d === 0 ? 'today' : d === 1 ? '1 day' : d < 14 ? `${d} days` : d < 60 ? `${Math.round(d / 7)} wks` : d < 365 ? `${Math.round(d / 30.4)} mo` : d < 730 ? '1 yr+' : `${Math.floor(d / 365)} yrs+`;
const leftClass = d => d < 0 ? 'e-over' : d <= 1 ? 'e-now' : d <= 7 ? 'e-week' : d <= 31 ? 'e-month' : 'e-far';
function endHTML(m, big = false) {
  const d = daysLeft(m);
  if (d == null) return '';
  const u = d < 0 ? 1 : Math.max(0.04, 1 - Math.log(1 + d) / Math.log(366)), r = 6, c = 2 * Math.PI * r;
  return `<span class="p-end ${leftClass(d)}${big ? ' big' : ''}" title="${d < 0 ? `Ended ${dayLabel(m.end)}` : `Ends ${dayLabel(m.end)}`}"><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2.6"/><circle cx="8" cy="8" r="${r}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-dasharray="${(u * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 8 8)" stroke-linecap="round"/></svg>${d < 0 ? 'ended' : d <= 1 ? `ends ${leftLabel(d)}` : leftLabel(d) + ' left'}</span>`;
}

/* ---------- the same question on several venues (matched by the build: m.group) ---------- */
const membersOf = m => m.group ? groups.get(m.group) || [m] : [m];
const priceOn = (x, name, yn) => {
  if (yn) { const o = x.outcomes[0]; return isYesNo(x) ? o : null; }
  // a number in the outcome ("Below 45", "45", "52+") must match in full: "Below 45" isn't "exactly 45"; a person is
  // matched by surname ("Scott Colom (D)" ≈ "Colom")
  const full = n => String(n).toLowerCase().replace(/\([^)]{0,3}\)/g, ' ').replace(/[^a-z0-9+<> ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\d/.test(name)) return x.outcomes.find(o => full(o.name) === full(name)) || null;
  const k = normName(name);
  return x.outcomes.find(o => normName(o.name) === k) || null;
};
function comparison(m) {
  const ms = membersOf(m);
  if (ms.length < 2) return null;
  const h = shownOutcome(m), rows = ms.map(x => {
    const o = priceOn(x, h.name, h.yn);
    const p = o?.p == null ? null : h.no ? 1 - o.p : o.p;
    return { x, p };
  });
  const ps = rows.filter(r => r.p != null).map(r => r.p);
  return { rows, spread: ps.length > 1 ? Math.max(...ps) - Math.min(...ps) : 0 };
}
const merged = () => venue === 'all';
const combined = (m, f) => { const ms = membersOf(m).filter(x => play || !isPlay(x) || x === m); const v = ms.map(f).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const mToday = m => merged() ? combined(m, today$) : today$(m);
const mTotal = m => merged() ? combined(m, total$) : total$(m);
const mInterest = m => merged() ? (combined(m, interest) || 0) : interest(m);
const playNote = m => isPlay(m) ? ' play money' : '';
const thin = m => !isPlay(m) && m.venue !== 'predictit' && mInterest(m) < THIN;
const lg = m => Math.log10(1 + mInterest(m));

const WEIGHT = {
  sure: m => certainty(m) * lg(m),
  money: mInterest,
  close: m => closeness(m) * lg(m),
  movers: m => Math.abs(shownOutcome(m)[tfKey()] ?? 0) * (mInterest(m) >= MOVER_MIN ? 1 : 0.1),
  ending: m => -(m.end ? Date.parse(m.end) : 9e15),
  disagree: m => comparison(m)?.spread ?? 0,
};
// PredictIt publishes no money, so its own tab keeps its own order unless a non-money order is picked
const weight = m => venue === 'predictit' && ['sure', 'money', 'close'].includes(order) ? -(m.ord ?? 999) : WEIGHT[order](m);

/* ---------- which questions ---------- */
function base() {
  if (!P) return [];
  return merged()
    ? P.markets.filter(m => (!m.group || m.group === m.id) && (play || !isPlay(m) || m.group))
    : P.markets.filter(m => m.venue === venue);
}
function shown() {
  let ms = base();
  if (query) { const q = query.toLowerCase(); ms = ms.filter(m => m.title.toLowerCase().includes(q) || m.outcomes.some(o => o.name.toLowerCase().includes(q))); }
  else ms = ms.filter(m => !hidden.has(topicOf(m)));
  if (order === 'disagree') ms = ms.filter(m => (comparison(m)?.spread ?? 0) >= DIFFER);
  ms = [...ms].sort((a, b) => weight(b) - weight(a) || mInterest(b) - mInterest(a));
  const live = ms.filter(m => !decided(m)), done = ms.filter(decided);
  pos.clear();
  live.forEach((m, i) => { pos.set(m.id, i + 1); });
  return { live: merged() && !query ? live.slice(0, ALL_MAX) : live, done };
}
// tile size from the place in the order: the top 4 or so big (2×2), the next tenth wide (2×1), the rest small
function sizes(ms) {
  const n = ms.length, out = new Map();
  ms.forEach((m, i) => out.set(m.id, weight(m) <= 0 || thin(m) ? 's' : i < Math.min(4, Math.max(1, Math.round(n * 0.03))) ? 'l' : i < Math.max(2, Math.round(n * 0.1)) ? 'w' : 's'));
  return out;
}

/* ---------- trend lines ---------- */
// the shown answer's last 35 days (the history is the headline outcome's; "No" is drawn as 1 − yes; an answer that
// isn't the headline has no line of its own)
function series(m, h = shownOutcome(m)) {
  const hs = P.hist?.[m.id];
  if (!hs || !(h.name === m.head || (h.yn && isYesNo(m)))) return null;
  const s = hs.p.map((v, i) => [hs.d + i, v == null ? null : h.no ? 1 - v : v]).filter(x => x[1] != null);
  return s.length >= 2 ? s : null;
}
function spark(m, w = 64, ht = 18) {
  const s = series(m);
  if (!s) return '';
  const x0 = s[0][0], x1 = s.at(-1)[0], lo = Math.min(...s.map(x => x[1])), hi = Math.max(...s.map(x => x[1])), span = Math.max(hi - lo, 0.05);
  const d = s.map(([x, v], i) => `${i ? 'L' : 'M'}${(1 + (x - x0) / (x1 - x0 || 1) * (w - 2)).toFixed(1)},${(ht - 2 - (v - lo) / span * (ht - 4)).toFixed(1)}`).join('');
  return `<svg class="pt-spark" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/* ---------- tiles ---------- */
const chip = v => `<span class="pt-chg ${heat(v)}" title="Move ${TFS.find(t => t[0] === tf)[2]}">${arrow(v)}${pts(v)}</span>`;
function tileHTML(m, size, done = false) {
  const h = shownOutcome(m), ch = h[tfKey()], cmp = merged() ? comparison(m) : null;
  const badges = (cmp ? cmp.rows.map(r => r.x) : [m]).map(x => `<span class="pv pv-${x.venue}" title="${VNAME[x.venue]}">${VTAG[x.venue]}</span>`).join('');
  const label = `${m.title}: ${verdict(m, h)}, ${h.name}, ${pct(h.p)}. Move ${TFS.find(t => t[0] === tf)[2]} ${pts(ch)}. ${(cmp ? cmp.rows.map(r => VNAME[r.x.venue]) : [VNAME[m.venue]]).join(', ')}`;
  const t$ = mToday(m), T$ = mTotal(m), place = pos.get(m.id), tp = titleParts(m);
  return `<button class="ptile sz-${size} ${sureClass(h)}${m.id === sel ? ' sel' : ''}${m.stale ? ' stale' : ''}${thin(m) ? ' thin' : ''}${done ? ' done' : ''}" data-id="${esc(m.id)}" data-coin="1" aria-haspopup="dialog" aria-label="${esc(label)}">
    <span class="pt-top"><span class="pt-id">${badges}${place && !done ? `<span class="pt-rank">#${place}</span>` : ''}${watch.has(m.id) ? '<span class="pt-star" title="On your watchlist">★</span>' : ''}</span>${chip(ch)}</span>
    <span class="pt-head">${icon(m)}<span class="pt-htxt"><span class="pt-title">${esc(tp[0])}</span>${tp[1] ? `<span class="pt-full">${esc(tp[1])}</span>` : ''}</span></span>
    <span class="pt-verdict">${verdict(m, h)}</span>
    <span class="pt-ans">${esc(h.name)}</span>
    <span class="pt-nums"><b class="pt-p">${pct(h.p)}</b>${spark(m, size === 'l' ? 120 : 64, size === 'l' ? 30 : 18)}</span>
    ${cmp ? `<span class="pt-cmp${cmp.spread >= DIFFER ? ' differ' : ''}" title="The same answer on each venue${cmp.spread >= DIFFER ? `: they differ by ${Math.round(cmp.spread * 100)} points` : ''}">${cmp.spread >= DIFFER ? '⚡ ' : ''}${cmp.rows.map(r => `${VTAG[r.x.venue]} ${pct(r.p)}`).join(' · ')}</span>` : ''}
    <span class="pt-foot">${done ? esc(decidedWhy(m)) : `${endHTML(m, size === 'l')}${t$ != null ? `<b>${money(t$, 'USD')}</b> today · ` : ''}${T$ != null ? `${money(T$, 'USD')} total${playNote(m)}` : 'no money figures'}${thin(m) ? ' · thin market' : ''}`}${m.stale ? ' · ⚠ not refreshed' : ''}</span>
  </button>`;
}
function grid(ms) {
  const sz = sizes(ms);
  return `<div class="grid pgrid">${ms.map(m => tileHTML(m, sz.get(m.id))).join('')}</div>`;
}
function decidedHTML(done) {
  if (!done.length) return '';
  const open = store.get('hm.predDone') === true;
  return `<details class="p-decided" id="pdone"${open ? ' open' : ''}><summary><b>Decided or waiting for the result</b> <span class="r-muted">${done.length} · at least ${Math.round(DECIDED * 100)}% sure already, or past their end date</span></summary>
    <div class="grid pgrid">${done.map(m => tileHTML(m, 's', true)).join('')}</div></details>`;
}

/* ---------- money map: every open question sized by the money on it, in blocks by topic ---------- */
// squarified treemap (Bruls, Huizing & van Wijk): lays items (each with .v) into a rectangle in rows that keep the
// pieces close to square
export function squarify(items, x, y, w, h) {
  const out = [], total = items.reduce((s, i) => s + i.v, 0);
  if (!total || w <= 0 || h <= 0) return out;
  let rest = items.map(i => ({ ...i, a: i.v / total * w * h })).sort((a, b) => b.a - a.a);
  const worst = (row, side) => { const s = row.reduce((t, r) => t + r.a, 0), mx = Math.max(...row.map(r => r.a)), mn = Math.min(...row.map(r => r.a)); return Math.max(side * side * mx / (s * s), (s * s) / (side * side * mn)); };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) { row.push(rest[i]); i++; }
    rest = rest.slice(i);
    const s = row.reduce((t, r) => t + r.a, 0);
    if (w >= h) { const cw = s / h; let cy = y; for (const r of row) { const ch = r.a / cw; out.push({ ...r, x, y: cy, w: cw, h: ch }); cy += ch; } x += cw; w -= cw; }
    else { const rh = s / w; let cx = x; for (const r of row) { const cw = r.a / rh; out.push({ ...r, x: cx, y, w: cw, h: rh }); cx += cw; } y += rh; h -= rh; }
  }
  return out;
}
function mapHTML(live) {
  const ms = live.filter(m => mInterest(m) > 0), left = live.length - ms.length;
  if (!ms.length) return '<p class="p-empty">No money figures to draw a map from.</p>';
  const W = Math.max(320, $('#grid').clientWidth || 1000), H = Math.round(Math.max(420, Math.min(900, W * (innerWidth <= 640 ? 1.6 : 0.62))));
  const byCat = CATS.map(c => ({ c, ms: ms.filter(m => m.cat === c) })).filter(x => x.ms.length).map(x => ({ ...x, v: x.ms.reduce((s, m) => s + mInterest(m), 0) }));
  let html = '';
  for (const b of squarify(byCat, 0, 0, W, H)) {
    const head = b.h > 40 && b.w > 70 ? 16 : 0;
    html += `<div class="pm-block" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px">${head ? `<span class="pm-cat">${esc(b.c)}</span>` : ''}</div>`;
    for (const r of squarify(b.ms.map(m => ({ m, v: mInterest(m) })), b.x + 1, b.y + 1 + head, b.w - 2, b.h - 2 - head)) {
      const m = r.m, h = shownOutcome(m), area = r.w * r.h, sz = area > 26000 ? 'big' : area > 9000 ? 'mid' : area > 2500 ? 'small' : 'tiny';
      html += `<button class="pm-tile ${sureClass(h)} pm-${sz}${m.id === sel ? ' sel' : ''}" data-id="${esc(m.id)}" data-coin="1" style="left:${r.x + 1}px;top:${r.y + 1}px;width:${Math.max(0, r.w - 2)}px;height:${Math.max(0, r.h - 2)}px" title="${esc(`${m.title}: ${verdict(m, h)} ${h.name} ${pct(h.p)} · ${money(mInterest(m), 'USD')} interest`)}" aria-label="${esc(`${m.title}: ${verdict(m, h)}, ${h.name}, ${pct(h.p)}`)}">`
        + `${sz === 'tiny' ? `<span class="pm-title">${iconOf(m.title, m.cat)}</span>` : `<span class="pm-title">${icon(m)}${esc(shortTitle(m.title))}</span>`}<span class="pm-ans">${sz === 'tiny' ? '' : esc(h.name) + ' '}<b>${pct(h.p)}</b></span>${sz === 'big' || sz === 'mid' ? `<span class="pm-foot">${chip(h[tfKey()])} ${endHTML(m)} ${money(mToday(m), 'USD')} today</span>` : ''}</button>`;
    }
  }
  return `<div class="p-map" style="height:${H}px">${html}</div><p class="r-muted p-mapnote">Each rectangle’s area is the money on that question (bet today + a 30th of all money bet); blocks are topics; darker = the market is surer.${left ? ` ${left} question${left > 1 ? 's' : ''} without money figures (PredictIt) aren’t drawn.` : ''}</p>`;
}

/* ---------- the Today strip: the news at a glance ---------- */
function todayHTML(live) {
  const real = live.filter(m => !isPlay(m) && !m.stale);
  const pick = (f, ok = () => true) => real.filter(ok).reduce((a, m) => !a || f(m) > f(a) ? m : a, null);
  const cards = [];
  const mover = pick(m => Math.abs(shownOutcome(m).d1 ?? 0), m => mInterest(m) >= MOVER_MIN * 10 && Math.abs(shownOutcome(m).d1 ?? 0) >= 0.03);
  if (mover) { const h = shownOutcome(mover); cards.push(['Biggest swing today', mover, `${esc(h.name)} ${arrow(h.d1)}${pts(h.d1)} to <b>${pct(h.p)}</b>`]); }
  const big = pick(m => mToday(m) ?? 0);
  if (big) { const h = shownOutcome(big); cards.push(['Most money today', big, `<b>${money(mToday(big), 'USD')}</b> · ${esc(h.name)} ${pct(h.p)}`]); }
  const close = pick(m => closeness(m) * lg(m), m => closeness(m) >= 0.7 && mInterest(m) >= MOVER_MIN * 10);
  if (close) { const h = shownOutcome(close); cards.push(['Closest big call', close, `${esc(h.name)} <b>${pct(h.p)}</b> · ${money(mInterest(close), 'USD')} interest`]); }
  if (merged()) {
    const dis = pick(m => comparison(m)?.spread ?? 0, m => (comparison(m)?.spread ?? 0) >= DIFFER);
    if (dis) { const c = comparison(dis); cards.push(['Venues disagree', dis, `⚡ ${c.rows.map(r => `${VTAG[r.x.venue]} ${pct(r.p)}`).join(' · ')}`]); }
  }
  if (!cards.length) return '';
  return `<section class="p-today" aria-label="Today at a glance">${cards.map(([k, m, line]) => `<button class="p-news" data-id="${esc(m.id)}" data-coin="1"><span class="p-news-k">${k}</span><span class="p-news-t">${icon(m)}${esc(shortTitle(m.title))}</span><span class="p-news-l">${line}</span></button>`).join('')}</section>`;
}

/* ---------- table ---------- */
function tableHTML(ms) {
  const key = { rank: m => pos.get(m.id) ?? 1e9, title: m => m.title.toLowerCase(), venue: m => m.venue, head: m => shownOutcome(m).name.toLowerCase(), p: m => shownOutcome(m).p ?? -1, chg: m => shownOutcome(m)[tfKey()] ?? -9, today: m => mToday(m) ?? -1, total: m => mTotal(m) ?? -1, end: m => m.end || '9999', cat: m => CATS.indexOf(m.cat) }[sortBy.key];
  const rows = [...ms].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sortBy.dir; });
  const th = COLS.map(([k, l]) => `<th scope="col" data-sort="${k}" aria-sort="${sortBy.key === k ? (sortBy.dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}${sortBy.key === k ? (sortBy.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  return `<div class="r-tblwrap"><table class="r-tbl p-tbl"><thead><tr>${th}</tr></thead><tbody>${rows.map(m => {
    const h = shownOutcome(m), ch = h[tfKey()], vs = merged() ? membersOf(m) : [m];
    return `<tr class="r-row${decided(m) ? ' done' : ''}" data-id="${esc(m.id)}" tabindex="0"><td>${pos.get(m.id) ?? (decided(m) ? '✓' : '—')}</td><td class="p-tt">${watch.has(m.id) ? '★ ' : ''}${icon(m)}${esc(m.title)}</td><td>${vs.map(x => `<span class="pv pv-${x.venue}" title="${VNAME[x.venue]}">${VTAG[x.venue]}</span>`).join(' ')}${vs.length === 1 ? ' ' + VNAME[m.venue] : ''}</td>
      <td class="p-tt"><span class="r-muted">${verdict(m, h)}:</span> ${esc(h.name)}</td><td><b>${pct(h.p)}</b></td><td><span class="cell-heat ${heat(ch)}">${arrow(ch)}${pts(ch)}</span></td><td>${money(mToday(m), 'USD')}</td><td>${money(mTotal(m), 'USD')}${playNote(m) ? ' <span class="r-muted">play</span>' : ''}</td><td>${endHTML(m) || '—'}</td><td>${esc(m.cat)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

/* ---------- venue notes (stale / down) ---------- */
function venueNote(v) {
  const s = P?.venues?.[v];
  if (!s || s.state === 'ok' || s.state === 'off') return '';
  if (s.state === 'stale') return `<div class="p-note">⚠ <b>${VNAME[v]} didn’t answer in the latest update</b>: showing its markets from ${s.at ? new Date(s.at).toLocaleString([], { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : 'an earlier update'}.</div>`;
  return `<div class="p-note">✕ <b>${VNAME[v]} isn’t answering right now</b>, so there’s nothing to show for it. It’s retried every 10 minutes.</div>`;
}

/* ---------- render ---------- */
function topicChips() {
  const b = base(), n = k => b.filter(m => topicOf(m) === k).length;
  const keys = [...CATS, 'games'].filter(k => n(k));
  return keys.map(k => `<button class="chip" data-topic="${k}" aria-pressed="${!hidden.has(k)}" title="${hidden.has(k) ? 'Show' : 'Hide'} ${k === 'games' ? 'single games and matches' : k}">${k === 'games' ? 'Single games' : esc(k)} <span class="n">${n(k)}</span></button>`).join('')
    + (merged() ? `<label class="check p-play" title="Manifold is play money: its odds aren't backed by real bets"><input type="checkbox" id="pplay"${play ? ' checked' : ''}> Play money</label>` : '');
}
const filterCount = () => [...hidden].filter(k => k !== 'games').length + (hidden.has('games') ? 0 : 1) + (play ? 1 : 0) + (tf !== '1d' ? 1 : 0) + (groupBy !== 'none' ? 1 : 0) + (viewAs !== 'tiles' ? 1 : 0);
function watchHTML() {
  const ms = P.markets.filter(m => watch.has(m.id));
  if (!ms.length) return '';
  return `<section class="r-group p-watch"><h3>★ Your watchlist <span class="r-muted">${ms.length} · saved in this browser</span></h3><div class="grid pgrid">${ms.map(m => tileHTML(m, 's', decided(m))).join('')}</div></section>`;
}
function sectionsHTML(live) {
  if (groupBy === 'cat') {
    const gs = CATS.map(c => ({ c, g: live.filter(m => m.cat === c) })).filter(x => x.g.length)
      .map(x => ({ ...x, sum: x.g.reduce((s, m) => s + mInterest(m), 0) })).sort((a, b) => b.sum - a.sum);
    return `<div class="r-groups">${gs.map(({ c, g, sum }) => `<section class="r-group"><h3>${esc(c)} <span class="r-muted">${g.length} · ${money(sum, 'USD')} interest</span></h3>${grid(g)}</section>`).join('')}</div>`;
  }
  if (groupBy === 'story') {
    const by = new Map();
    for (const m of live) { const s = storyOf(m.title) || ''; if (!by.has(s)) by.set(s, []); by.get(s).push(m); }
    const solo = [...(by.get('') || [])];
    for (const [s, g] of by) if (s && g.length < 2) { solo.push(...g); by.delete(s); }
    by.delete('');
    const gs = [...by].map(([s, g]) => ({ s, g, sum: g.reduce((t, m) => t + mInterest(m), 0) })).sort((a, b) => b.sum - a.sum);
    solo.sort((a, b) => weight(b) - weight(a));
    return `<div class="r-groups">${gs.map(({ s, g, sum }) => `<section class="r-group p-story"><h3>${esc(s)} <span class="r-muted">${g.length} questions · ${money(sum, 'USD')} interest</span></h3>${grid(g)}</section>`).join('')}${solo.length ? `<section class="r-group"><h3>Other questions <span class="r-muted">${solo.length}</span></h3>${grid(solo)}</section>` : ''}</div>`;
  }
  return grid(live);
}
function render() {
  if (!P) return;
  const vs = VENUES.filter(([k]) => P.venues?.[k]?.state !== 'off');   // Betfair's tab only once it's set up
  if (!vs.some(v => v[0] === venue) && venue !== 'all') venue = 'all';
  if (order === 'disagree' && !merged()) order = 'sure';
  const { live, done } = shown(), main = $('#grid');
  $('#pvenue').innerHTML = [['all', 'All'], ...vs.map(v => [v[0], v[1]])].map(([k, l]) => {
    const st = k === 'all' ? 'ok' : P.venues?.[k]?.state || 'down';
    const n = k === 'all' ? P.markets.filter(m => (!m.group || m.group === m.id) && (play || !isPlay(m))).length : P.markets.filter(m => m.venue === k).length;
    const mark = st === 'ok' ? '' : ` <span class="p-st">${st === 'stale' ? '⚠ late' : 'down'}</span>`;
    return `<button data-v="${k}"${st === 'down' ? ' class="p-out"' : ''} aria-pressed="${k === venue}" title="${k === 'all' ? 'Every venue together; a question on several venues is one tile' : `${l}: ${st === 'ok' ? `${n} markets` : P.venues?.[k]?.err || st}`}">${k === 'all' ? '' : `<span class="pv pv-${k}" aria-hidden="true">${VTAG[k]}</span> `}${l}${n ? ` <span class="n">${n}</span>` : ''}${mark}</button>`;
  }).join('');
  $('#porder').innerHTML = ORDERS.filter(([k]) => k !== 'disagree' || merged()).map(([k, l, t]) => `<button data-o="${k}" role="tab" aria-selected="${k === order}" aria-pressed="${k === order}" title="${esc(t)}">${l}</button>`).join('');
  $('#ptopics').innerHTML = topicChips();
  $$('#ptf button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === tf));
  $$('#pview button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === viewAs));
  $('#pgroup').value = groupBy; $('#pgroup').disabled = viewAs !== 'tiles';
  const n = filterCount();
  $('#pfiltBtn').innerHTML = `⚙ Filters${n ? ` <span class="n">${n}</span>` : ''}`;
  const note = merged() ? VENUES.map(v => P.venues?.[v[0]]?.state === 'stale' ? venueNote(v[0]) : '').join('') : venueNote(venue);
  const all = [...live, ...done];
  const intro = !query && viewAs !== 'table' ? todayHTML(live) + watchHTML() : '';
  if (!all.length) main.innerHTML = note + intro + (query ? `<p class="p-empty">No question matches “${esc(query)}”.</p>` : order === 'disagree' ? '<p class="p-empty">No question is priced 5 or more points apart on two venues right now.</p>' : '<p class="p-empty">No open questions in the topics shown.</p>');
  else if (viewAs === 'table') main.innerHTML = note + tableHTML(all);
  else if (viewAs === 'map') main.innerHTML = note + intro + mapHTML(live) + decidedHTML(done);
  else main.innerHTML = note + intro + sectionsHTML(live) + decidedHTML(done);
  main.className = '';
  $('#plegend').innerHTML = `<span class="p-key"><span class="p-sw c0"></span>toss-up <span class="p-sw c2"></span><span class="p-sw c4"></span> near certain</span> · move ${TFS.find(t => t[0] === tf)[2]}: <span class="p-key-chg q2">▲ more likely</span> <span class="p-key-chg q-2">▼ less</span> · ${esc(ORDERS.find(x => x[0] === order)[2])}${venue === 'predictit' && ['sure', 'money', 'close'].includes(order) ? ' (PredictIt publishes no money: its own order)' : ''}`;
  const q = new URLSearchParams();
  if (venue !== 'all') q.set('v', venue);
  if (order !== 'sure') q.set('o', order);
  if (sel) q.set('m', sel);
  const url = location.pathname + (q.toString() ? '?' + q : '');
  if (url !== location.pathname + location.search) history.replaceState(null, '', url);
}

/* ---------- popup: the answer first, then each venue, every outcome, related questions, the fine print ---------- */
// the days the answer moved most (5 points or more), biggest first
function bigMoves(s) {
  const out = [];
  for (let i = 1; i < s.length; i++) { const chg = s[i][1] - s[i - 1][1]; if (Math.abs(chg) >= 0.05) out.push({ day: s[i][0], chg, to: s[i][1] }); }
  return out.sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
}
function chartHTML(m) {
  const s = series(m);
  if (!s) return '<p class="r-muted">The history of this answer builds up from the first day it’s tracked here.</p>';
  const w = 440, ht = 150, x0 = s[0][0], x1 = s.at(-1)[0];
  const X = d => 30 + (d - x0) / (x1 - x0 || 1) * (w - 40), Y = v => ht - 18 - v * (ht - 30);
  const d = s.map(([dd, v], i) => `${i ? 'L' : 'M'}${X(dd).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const area = `${d}L${X(x1).toFixed(1)},${Y(0)}L${X(x0).toFixed(1)},${Y(0)}Z`;
  const jumps = bigMoves(s).slice(0, 3);
  return `<svg class="r-chart p-chart" viewBox="0 0 ${w} ${ht}" role="img" aria-label="${esc(`Chance of ${shownOutcome(m).name}, last ${s.length} days`)}">
    ${[0, 0.25, 0.5, 0.75, 1].map(v => `<line x1="30" x2="${w - 10}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="26" y="${Y(v) + 3}" text-anchor="end" font-size="9" fill="var(--muted)">${v * 100}%</text>`).join('')}
    <path d="${area}" fill="var(--ink)" opacity=".07"/><path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    ${jumps.map(j => `<circle cx="${X(j.day).toFixed(1)}" cy="${Y(j.to).toFixed(1)}" r="3.5" fill="${j.chg > 0 ? '#16807a' : '#b05f18'}"/>`).join('')}
    <text x="30" y="${ht - 4}" font-size="9" fill="var(--muted)">${dayOf(x0)}</text><text x="${w - 10}" y="${ht - 4}" text-anchor="end" font-size="9" fill="var(--muted)">${dayOf(x1)}</text></svg>`;
}
function compareHTML(m) {
  const cmp = comparison(m);
  if (!cmp) return '';
  const h = shownOutcome(m);
  return `<h3>${esc(h.name)} on each venue${cmp.spread >= DIFFER ? ` <span class="p-differ">⚡ ${Math.round(cmp.spread * 100)} points apart</span>` : ''}</h3>
    <table class="r-tbl p-otbl p-cmp"><thead><tr><th>Venue</th><th>Chance</th><th>Bet today</th><th>Bet in total</th></tr></thead><tbody>${cmp.rows.map(({ x, p }) =>
      `<tr><td class="p-tt"><span class="pv pv-${x.venue}" aria-hidden="true">${VTAG[x.venue]}</span> <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${VNAME[x.venue]} ↗</a></td><td><b>${pct(p)}</b></td><td>${money(today$(x), 'USD')}</td><td>${money(total$(x), 'USD')}${playNote(x) ? ' <span class="r-muted">play</span>' : ''}</td></tr>`).join('')}</tbody></table>
    <p class="r-muted">Matched by wording and outcomes: a best guess. Each venue’s rules for when a question resolves can differ.</p>`;
}
function relatedHTML(m) {
  const story = storyOf(m.title);
  if (!story) return '';
  const ids = new Set(membersOf(m).map(x => x.id));
  const rel = P.markets.filter(x => !ids.has(x.id) && (!x.group || x.group === x.id) && storyOf(x.title) === story && (play || !isPlay(x))).sort((a, b) => interest(b) - interest(a)).slice(0, 8);
  if (!rel.length) return '';
  return `<h3>More on ${esc(story)}</h3><ul class="p-related">${rel.map(x => { const h = shownOutcome(x); return `<li><button class="p-rel" data-rel="${esc(x.id)}"><span class="pv pv-${x.venue}" aria-hidden="true">${VTAG[x.venue]}</span> <span>${esc(x.title)}</span> <b>${esc(h.name)} ${pct(h.p)}</b></button></li>`; }).join('')}</ul>`;
}
function detailHTML(m) {
  const h = shownOutcome(m), s = series(m), jumps = s ? bigMoves(s).slice(0, 3) : [];
  const rows = m.outcomes.map(o => `<tr${o.name === m.head ? ' class="p-headrow"' : ''}><td class="p-tt">${esc(o.name)}</td>
    <td class="p-pbar"><span style="width:${Math.round((o.p || 0) * 100)}%"></span><b>${pct(o.p)}</b></td>
    ${TFS.map(([, k]) => `<td>${o[k] == null ? '—' : `<span class="cell-heat ${heat(o[k])}">${arrow(o[k])}${pts(o[k])}</span>`}</td>`).join('')}</tr>`).join('');
  const sp = headOf(m).sp;
  const kv = [
    ['Venue', `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${VNAME[m.venue]} ↗</a>`],
    ['Topic', esc(m.cat) + (storyOf(m.title) ? ` · ${esc(storyOf(m.title))}` : '')],
    ['Status', decided(m) ? `Decided or as good as: ${esc(decidedWhy(m))}` : 'Open'],
    ['Interest', interest(m) > 0 ? `#${m.rank ?? '—'} of ${P.markets.length} · ${money(interest(m), 'USD')}${thin(m) ? ' · <b>thin market</b>: a small trade can move the price' : ''}` : 'not ranked: no money figures published'],
    ['Bet today', today$(m) == null ? '—' : '≈ ' + money(today$(m), 'USD') + (isPlay(m) ? ` <span class="r-muted">(${money(m.vol24, 'MANA')} play money)</span>` : m.contracts24 ? ` <span class="r-muted">(${m.contracts24.toLocaleString()} contracts)</span>` : '')],
    ['Bet in total', total$(m) == null ? '—' : '≈ ' + money(total$(m), 'USD') + (isPlay(m) ? ` <span class="r-muted">(${money(m.vol, 'MANA')})</span>` : m.cur === 'GBP' ? ` <span class="r-muted">(${money(m.vol, 'GBP')} matched)</span>` : '')],
    m.oi ? ['Money riding on it now', '≈ ' + money(m.oi, 'USD')] : m.liq != null ? ['Liquidity', money(m.liq, m.cur)] : null,
    sp != null ? ['Buy–sell gap', `${(sp * 100).toFixed(1)} points${sp >= 0.05 ? ' · <b>wide</b>: the price is a rough guide' : ''}`] : null,
    m.traders ? ['People who bet', m.traders.toLocaleString()] : null,
    ['Ends', m.end ? dayLabel(m.end) : '—'],
  ].filter(Boolean);
  const moves = TFS.map(([, k, w]) => `<span class="p-mv"><span class="r-muted">${w}</span> <span class="cell-heat ${heat(h[k])}">${arrow(h[k])}${pts(h[k])}</span></span>`).join('');
  return `<div class="r-card r-pop p-pop">
    <div class="p-pophead"><span class="p-popven">${membersOf(m).filter(x => merged() || x === m).map(x => `<span class="pv pv-${x.venue}" title="${VNAME[x.venue]}">${VTAG[x.venue]}</span>`).join('')}</span>
      <button class="btn p-watchbtn" data-watch="${esc(m.id)}" aria-pressed="${watch.has(m.id)}">${watch.has(m.id) ? '★ Watching' : '☆ Watch'}</button>
      <button class="btn p-fullbtn" aria-pressed="${full}" title="${full ? 'Back to the small view' : 'Full screen'}">${full ? '⤡ Smaller' : '⤢ Full view'}</button></div>
    <h2 class="p-q">${icon(m)}${esc(shortTitle(m.title))}</h2>${titleParts(m)[1] ? `<p class="p-qfull">${esc(m.title)}</p>` : ''}
    <p class="p-say"><span class="p-say-v">${verdict(m, h)}:</span> <b class="p-say-a">${esc(h.name)}</b> <b class="p-say-p">${pct(h.p)}</b></p>
    <p class="p-moves">${moves}${m.end ? `<span class="p-mv">${endHTML(m, true)} <span class="r-muted">${dayLabel(m.end)}</span></span>` : ''}</p>
    ${m.stale ? '<p class="r-says">⚠ This venue didn’t answer in the latest update: these are its last known prices.</p>' : ''}
    ${chartHTML(m)}
    ${jumps.length ? `<p class="p-jumps"><b>Biggest moves:</b> ${jumps.map(j => `${dayOf(j.day)} <span class="cell-heat ${heat(j.chg)}">${arrow(j.chg)}${pts(j.chg)}</span>`).join(' · ')}</p>` : ''}
    ${merged() ? compareHTML(m) : ''}
    <h3>Every outcome on ${VNAME[m.venue]}</h3>
    <table class="r-tbl p-otbl"><thead><tr><th>Outcome</th><th>Chance</th>${TFS.map(([l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    ${m.more ? `<p class="r-muted">+${m.more} less likely outcome${m.more > 1 ? 's' : ''} on ${VNAME[m.venue]}.</p>` : ''}
    ${relatedHTML(m)}
    <details class="p-fine"><summary>Money, status and fine print</summary>
      <dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <p class="r-src">${isPlay(m) ? 'Manifold uses play money (mana), so its odds aren’t backed by real bets. ' : ''}${m.cur === 'GBP' ? 'Betfair odds turned into chances (1 ÷ decimal odds, scaled to add up to 100%). ' : ''}${m.venue === 'kalshi' ? 'Kalshi’s chance is the middle of its best buy and sell prices; its dollars are contracts × price. ' : ''}A chance is the price of a contract that pays 1 if the outcome happens. Not advice.</p>
    </details>
  </div>`;
}
function place(box, id) {
  const phone = innerWidth <= 640;
  box.classList.toggle('p-full', full);
  if (full) { box.style.left = box.style.top = box.style.width = box.style.maxHeight = ''; return; }
  box.style.width = phone ? '' : Math.min(500, innerWidth - 24) + 'px';
  box.style.maxHeight = phone ? '' : (innerHeight - 40) + 'px';
  const tile = $(`#grid [data-id="${CSS.escape(id)}"]`), cr = tile?.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight, mg = 12, gap = 8;
  let left = (innerWidth - bw) / 2, top = (innerHeight - bh) / 2;
  if (cr && !phone) {
    if (cr.right + gap + bw <= innerWidth - mg) { left = cr.right + gap; top = cr.top; }
    else if (cr.left - gap - bw >= mg) { left = cr.left - gap - bw; top = cr.top; }
  }
  box.style.left = Math.min(Math.max(mg, left), Math.max(mg, innerWidth - bw - mg)) + 'px';
  box.style.top = Math.min(Math.max(mg, top), Math.max(mg, innerHeight - bh - mg)) + 'px';
}
function openPopup(id) {
  const m = P?.markets.find(x => x.id === id);
  if (!m) return;
  const box = $('#detail');
  box.querySelector('.body').innerHTML = detailHTML(m);
  box.classList.add('show', 'pinned', 'r-compact');
  place(box, id);
  box.scrollTop = 0;
  $('#scrim').classList.add('show');
  S.pinned = 'pred:' + id; sel = id;
  box.querySelector('.x').focus({ preventScroll: true });
  render();
}

/* ---------- fresh line and loading ---------- */
function renderFresh() {
  if (!P) return;
  const mins = Math.floor((Date.now() - P.generated) / 60e3), ago = mins < 1 ? 'just now' : mins < 120 ? `${mins} min ago` : `${Math.floor(mins / 60)} h ago`;
  const tm = new Date(P.generated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const late = Date.now() - P.generated > REFRESH * 2.5;
  const vs = VENUES.filter(([k]) => P.venues?.[k]?.state !== 'off').map(([k, l]) => { const s = P.venues?.[k]?.state; return `${l} ${s === 'ok' ? '✓' : s === 'stale' ? '⚠' : '✕'}`; }).join(' · ');
  const html = `<span>🕒 <b>Last refreshed ${tm}</b> (${ago}) · <b>not real-time</b>, every 10 min · ${vs}${late ? ' · <b>⚠ this update is running late</b>' : ''}</span>`;
  $('#fresh').classList.toggle('late', late);
  if ($('#fresh').innerHTML !== html) $('#fresh').innerHTML = html;
}
async function load() {
  try {
    const r = await fetch(`${M.data}?b=${Math.floor(Date.now() / 60e3)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('predictions.json ' + r.status);
    const d = await r.json();
    if (d?.market !== 'predictions' || !Array.isArray(d.markets)) throw new Error('no prediction markets');
    P = d; loadedAt = Date.now();
    groups = new Map();
    for (const m of P.markets) if (m.group) { if (!groups.has(m.group)) groups.set(m.group, []); groups.get(m.group).push(m); }
    for (const ms of groups.values()) ms.sort((a, b) => interest(b) - interest(a));
    render(); renderFresh();
    const on = VENUES.filter(([k]) => P.venues?.[k]?.state !== 'off'), up = on.filter(([k]) => P.venues?.[k]?.state === 'ok').length;
    $('#status').innerHTML = `<span class="dot live"></span>${P.markets.length} markets · ${up}/${on.length} venues live`;
  } catch (e) {
    $('#status').innerHTML = `<span class="dot"></span>${esc(e.message)}. Retrying automatically.`;
  }
  fetch('/health.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(renderHealth).catch(() => {});
}

const HELP = `<div class="leg-more p-help" id="phelp" hidden>
  <p><b>A tile</b> says what the market thinks: the question, a verdict (almost certain, likely, leaning, toss-up, unlikely, long shot; “front-runner” for the leader of a crowded field), the answer and its chance, the trend over the last weeks, and the money bet. A chance is the price of a contract that pays 1 if it happens: 62% means traders pay 62¢ for a dollar if it does. For yes/no questions the likelier side is shown (2% yes is “No 98%”); on a ladder (“above 50 seats”, “by 31 October”) the step nearest 50%.</p>
  <p><b>Colour is how sure the market is</b>: light for a toss-up, dark for near certain. <b>The chip is the move</b> today, this week or this month, in points (40% → 52% is ▲ +12 pts): teal when the answer became more likely, amber when less. No blue or red, so nothing reads as a party.</p>
  <p><b>The tabs</b> ask a question: <b>Surest bets</b> (the most certain open questions with the most money), <b>Biggest bets</b>, <b>Close calls</b> (near 50/50, lots of money), <b>Big movers</b>, <b>Ending soon</b>, and in “All”, <b>Venues disagree</b>. <b>Today</b> picks out the biggest swing, the most money, the closest big call and the widest disagreement.</p>
  <p><b>Money</b> is in US dollars on every venue: bet today (24 hours) and in total; interest = bet today + a 30th of the total. It’s approximate: Kalshi counts contracts (turned into dollars at their price) and each venue counts trades its own way. Manifold is play money, left out of “All” unless ticked in Filters. PredictIt publishes no money figures. A faded tile is a <b>thin market</b> (under $1K), where one small trade can move the price.</p>
  <p><b>Views</b> (in Filters): tiles; a <b>money map</b> where each question’s area is the money on it, in blocks by topic; or a table. Tiles can be grouped by topic or by <b>story</b> (all the Alaska Senate questions together, all of 2028, Senate control…). Questions at least ${Math.round(DECIDED * 100)}% sure or past their end date fold into a row at the bottom.</p>
  <p><b>Click a question</b> for the answer first, a 35-day chart with its biggest moves, each venue’s price, every outcome, related questions and the fine print; ☆ Watch keeps it at the top of the page (saved in this browser), ⤢ makes it full screen. The same question on several venues is one tile in “All” (⚡ when they differ by ${Math.round(DIFFER * 100)}+ points), matched by wording: a best guess. Not real-time, refreshed every 10 minutes, and not advice.</p></div>`;

export function start() {
  document.body.classList.add('rates-page', 'pred-page');
  for (const s of ['#colorBy', '#quote', '#view', '#density', '.controls .ctl', '#legend', '#reset', '#refresh', '#share', '#excluded']) { const el = $(s); if (el) el.hidden = true; }
  $('main').insertAdjacentHTML('afterbegin', `<div class="r-bar p-bar">
    <div class="seg p-venues" id="pvenue" role="group" aria-label="Venue"></div>
    <input type="search" id="psearch" class="p-search" placeholder="Search questions…" aria-label="Search questions">
    <button class="btn" id="pfiltBtn" aria-expanded="false" aria-controls="pfilters">⚙ Filters</button>
    <button class="btn leg-toggle" id="phelpBtn" aria-expanded="false" aria-controls="phelp">ⓘ How to read</button></div>
    <div class="r-bar p-bar p-filters" id="pfilters" hidden>
      <span class="p-flab">Move over</span><div class="seg" id="ptf" role="group" aria-label="Move over">${TFS.map(([v, , , l]) => `<button data-v="${v}" title="Moves over ${l}">${v}</button>`).join('')}</div>
      <span class="p-flab">View</span><div class="seg" id="pview" role="group" aria-label="View"><button data-v="tiles">Tiles</button><button data-v="map">Money map</button><button data-v="table">Table</button></div>
      <label class="r-sel">Group <select id="pgroup"><option value="none">None</option><option value="story">By story</option><option value="cat">By topic</option></select></label>
      <div class="chips p-topics" id="ptopics" role="group" aria-label="Topics shown"></div>
    </div>
    <div class="seg p-orders" id="porder" role="tablist" aria-label="Show"></div>
    <p id="plegend" class="p-legend"></p>${HELP}`);
  $('#detail').setAttribute('aria-label', 'Question details');
  const linked = Q.get('m');
  const on = (s, ev, f) => $(s).addEventListener(ev, f);
  on('#pvenue', 'click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; venue = b.dataset.v; store.set('hm.predVenue', venue); render(); });
  on('#porder', 'click', e => { const b = e.target.closest('button[data-o]'); if (!b) return; order = b.dataset.o; store.set('hm.predOrder', order); render(); });
  on('#ptf', 'click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; tf = b.dataset.v; store.set('hm.predTf', tf); render(); });
  on('#pview', 'click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; viewAs = b.dataset.v; store.set('hm.predView2', viewAs); render(); });
  on('#pgroup', 'change', e => { groupBy = e.target.value; store.set('hm.predGroup2', groupBy); render(); });
  on('#ptopics', 'click', e => {
    const b = e.target.closest('button[data-topic]');
    if (!b) return;
    const k = b.dataset.topic;
    if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
    store.set('hm.predHide', [...hidden]); render();
  });
  on('#ptopics', 'change', e => { if (e.target.id === 'pplay') { play = e.target.checked; store.set('hm.predPlay', play); render(); } });
  on('#pfiltBtn', 'click', e => { const open = $('#pfilters').hidden; $('#pfilters').hidden = !open; e.currentTarget.setAttribute('aria-expanded', open); });
  let qt = 0;
  on('#psearch', 'input', e => { clearTimeout(qt); qt = setTimeout(() => { query = e.target.value.trim(); render(); }, 150); });
  on('#phelpBtn', 'click', e => { const open = $('#phelp').hidden; $('#phelp').hidden = !open; e.currentTarget.setAttribute('aria-expanded', open); e.currentTarget.textContent = open ? '✕ Hide' : 'ⓘ How to read'; });
  $('#grid').addEventListener('toggle', e => { if (e.target.id === 'pdone') store.set('hm.predDone', e.target.open); }, true);
  on('#grid', 'click', e => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; sortBy = { key: k, dir: sortBy.key === k ? -sortBy.dir : ['rank', 'title', 'venue', 'head', 'end', 'cat'].includes(k) ? 1 : -1 }; render(); return; }
    const t = e.target.closest('[data-id]');
    if (t && P) openPopup(t.dataset.id);
  });
  on('#grid', 'keydown', e => { if (e.key === 'Enter' && e.target.closest('.r-row')) openPopup(e.target.closest('.r-row').dataset.id); });
  // inside the popup: watch, full view, a related question
  on('#detail', 'click', e => {
    const w = e.target.closest('[data-watch]');
    if (w) { const id = w.dataset.watch; if (watch.has(id)) watch.delete(id); else watch.add(id); store.set('hm.predWatch', [...watch]); openPopup(id); return; }
    if (e.target.closest('.p-fullbtn')) { full = !full; openPopup(sel); return; }
    const r = e.target.closest('[data-rel]');
    if (r) openPopup(r.dataset.rel);
  });
  // closed by the shared handlers (×, Escape, the backdrop): forget the question, leave full view, update the address
  new MutationObserver(() => { if (sel && !$('#detail').classList.contains('pinned')) { sel = null; full = false; $('#detail').classList.remove('p-full'); render(); } })
    .observe($('#detail'), { attributes: true, attributeFilter: ['class'] });
  load().then(() => { if (linked) openPopup(linked); });
  let rz = 0;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (viewAs === 'map') render(); }, 200); });
  setInterval(() => { renderFresh(); if (!document.hidden && Date.now() - loadedAt > REFRESH) load(); }, 30e3);
}
