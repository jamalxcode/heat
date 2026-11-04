// heat.sala.company/predictions/: prediction markets from Polymarket, Kalshi, PredictIt, Manifold and Betfair
// (predictions.json, built by scripts/build-predictions.mjs). Not prices, so like the rates page it draws its own view:
// a tab per venue plus "All", where a question listed on several venues is one tile comparing their prices. Tiles read
// question → answer → chance and money bet, are ranked (likeliest + most money by default, or most contested, interest…)
// and coloured teal / amber by how much the chance moved, so the colours never read as a party. Questions already
// decided sit in a folded row at the bottom; topics can be switched off. main.mjs starts it instead of the price pipeline.
import { $, $$, esc, M, S, store } from './core.mjs';
import { renderHealth } from './render.mjs';

const DAY = 864e5, REFRESH = 10 * 60e3, ALL_MAX = 200;
const DECIDED = 0.97;                  // a question whose likeliest outcome is at least this sure counts as decided
const THIN = 1000;                     // less interest than this (in dollars, real money): a thin market, faded
const DIFFER = 0.05;                   // venues disagreeing by at least this much are flagged ⚡
const VENUES = [
  ['polymarket', 'Polymarket', 'PM'], ['kalshi', 'Kalshi', 'K'], ['predictit', 'PredictIt', 'PI'],
  ['manifold', 'Manifold', 'MF'], ['betfair', 'Betfair', 'BF'],
];
const VNAME = Object.fromEntries(VENUES.map(v => [v[0], v[1]])), VTAG = Object.fromEntries(VENUES.map(v => [v[0], v[2]]));
const CATS = ['Politics', 'World', 'Economy', 'Business', 'Crypto', 'Tech & science', 'Sports', 'Culture', 'Climate', 'Other'];
const TFS = [['1d', 'd1', '1 day'], ['1w', 'd7', '1 week'], ['1m', 'd30', '1 month']];
const COLS = [['rank', '#'], ['title', 'Market'], ['venue', 'Venue'], ['head', 'Outcome'], ['p', 'Chance'], ['chg', 'Move'], ['today', 'Bet today'], ['total', 'Bet in total'], ['end', 'Ends'], ['cat', 'Topic']];
// what the tiles are ranked by (and so which come first and which are big)
const SORTS = [['sure', 'Likeliest + most money'], ['contested', 'Most contested'], ['interest', 'Interest'], ['today', 'Bet today'], ['total', 'Bet in total'], ['move', 'Biggest move'], ['ending', 'Ending soonest']];
const pref = (k, ok, d) => { const v = store.get(k); return ok.includes(v) ? v : d; };
const Q = new URLSearchParams(location.search);
let P = null, loadedAt = 0, sel = null, query = '', groups = new Map();
const pos = new Map();                 // each market's place in the current order (the #number on its tile)
let venue = (v => ['all', ...VENUES.map(x => x[0])].includes(v) ? v : null)(Q.get('v')) || pref('hm.predVenue', ['all', ...VENUES.map(x => x[0])], 'all');
let tf = pref('hm.predTf', TFS.map(t => t[0]), '1d');
let viewAs = pref('hm.predView', ['heatmap', 'table'], 'heatmap');
let groupBy = pref('hm.predGroup', ['cat', 'none'], 'none');
let rankBy = pref('hm.predRank', SORTS.map(x => x[0]), 'sure');
let play = store.get('hm.predPlay') === true;                         // Manifold's play money in "All" (off by default)
const hidden = new Set(Array.isArray(store.get('hm.predHide')) ? store.get('hm.predHide') : ['games']);   // topics switched off
let sortBy = { key: 'rank', dir: 1 };

/* ---------- numbers ---------- */
const pct = p => p == null ? '—' : p >= 0.995 && p < 1 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : Math.round(p * 100) + '%';
const fmtPP = v => { if (v == null) return '—'; const x = v * 100, r = Math.abs(x) < 10 ? Math.abs(x).toFixed(1) : Math.round(Math.abs(x)); return (x > 0.05 ? '+' : x < -0.05 ? '−' : '±') + r + ' pp'; };
const arrow = v => v == null || Math.abs(v) < 0.0005 ? '' : v > 0 ? '▲ ' : '▼ ';
const money = (n, cur) => {
  if (n == null) return '—';
  const sign = cur === 'MANA' ? 'M$' : cur === 'GBP' ? '£' : '$';
  for (const [v, s] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (Math.abs(n) >= v) return sign + (n / v).toFixed(n / v >= 100 ? 0 : 1).replace(/\.0$/, '') + s;
  return sign + Math.round(n);
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const dayLabel = iso => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short', year: iso.slice(0, 4) === String(new Date().getUTCFullYear()) ? undefined : 'numeric', timeZone: 'UTC' }) : '—';
const headOf = m => m.outcomes.find(o => o.name === m.head) || m.outcomes[0];
const tfKey = () => TFS.find(t => t[0] === tf)[1];
const normName = n => { let s = String(n).toLowerCase(); const inner = s.match(/\(([^)]{4,})\)/); if (inner && /^(dems?|democrats?|gop|republicans?|rep|ind|independent)\b/.test(s)) s = inner[1]; s = s.replace(/\([^)]{0,3}\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').trim(); return s.split(/\s+/).pop() || ''; };   // as the build matches (scripts/build-predictions.mjs)

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

// The outcome a tile shows:
//   - yes/no: the likelier side when ranking by likeliest (2% yes is shown as 98% no, its move turned round), else yes;
//   - who wins (outcomes exclude each other): the likeliest;   - a ladder: the step nearest 50%;   - one named option: it.
function shownOutcome(m) {
  if (isYesNo(m)) {
    const o = m.outcomes[0];
    if (rankBy === 'sure' && o.p != null && o.p < 0.5) return { name: 'No', p: 1 - o.p, d1: neg(o.d1), d7: neg(o.d7), d30: neg(o.d30), no: true, yn: true };
    return { ...o, name: 'Yes', yn: true };
  }
  return { ...(isLadder(m) ? nearHalf(m) : m.exclusive ? topOf(m) : headOf(m)) };
}
// how sure the market already is: the likeliest side of a yes/no, the leader of who-wins; a ladder is sure when every
// step is near 0% or 100%
function certainty(m) {
  if (isYesNo(m)) { const p = m.outcomes[0].p ?? 0.5; return Math.max(p, 1 - p); }
  if (isLadder(m)) return Math.min(...m.outcomes.map(o => Math.max(o.p ?? 0.5, 1 - (o.p ?? 0.5))));
  return topOf(m).p ?? 0;
}
// how open it still is (1 = a coin toss): a yes/no or a ladder step near 50%, or two leaders close together
function closeness(m) {
  if (isYesNo(m)) return 1 - Math.abs(2 * (m.outcomes[0].p ?? 0) - 1);
  if (isLadder(m)) return 1 - Math.abs(2 * (nearHalf(m).p ?? 0) - 1);
  const ps = m.outcomes.map(o => o.p ?? 0).sort((a, b) => b - a);
  return 1 - (ps[0] - (ps[1] ?? 0));
}
// decided, or as good as: the end date has passed (waiting for the result to be confirmed), or it's at least 97% sure
const decided = m => (m.end && m.end < todayIso()) || certainty(m) >= DECIDED;
const decidedWhy = m => m.end && m.end < todayIso() ? `past its end date (${dayLabel(m.end)}): waiting for the result` : `${pct(certainty(m))} sure already`;

/* ---------- the same question on several venues (matched by the build: m.group) ---------- */
// In "All" a group shows as one tile: its leader (the most interest) with every venue's price for the same outcome
// and their money added up. Manifold's play money joins the comparison but not the money unless play money is on.
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
const combined = (m, f) => { const ms = membersOf(m).filter(x => venue !== 'all' || play || !isPlay(x) || x === m); const v = ms.map(f).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const mToday = m => venue === 'all' ? combined(m, today$) : today$(m);
const mTotal = m => venue === 'all' ? combined(m, total$) : total$(m);
const mInterest = m => venue === 'all' ? (combined(m, interest) || 0) : interest(m);

const RANK = {
  sure: m => certainty(m) * Math.log10(1 + mInterest(m)),
  contested: m => closeness(m) * Math.log10(1 + mInterest(m)),
  interest: mInterest, today: m => mToday(m) ?? -1, total: m => mTotal(m) ?? -1,
  move: m => Math.abs(shownOutcome(m)[tfKey()] ?? 0), ending: m => -(m.end ? Date.parse(m.end) : 9e15),
};
// PredictIt publishes no money, so its own tab keeps its own order
const weight = m => venue === 'predictit' ? -(m.ord ?? 999) : RANK[rankBy](m);
const playNote = m => isPlay(m) ? ' play money' : '';
const thin = m => !isPlay(m) && m.venue !== 'predictit' && mInterest(m) < THIN;
// party-neutral colours: teal = more likely, amber = less (q classes in index.html), so blue/red never read as a party
const heat = v => {
  if (v == null) return 'q0';
  const t = M.bins[tf], a = Math.abs(v * 100), k = a < t[0] ? 0 : a < t[1] ? 1 : a < t[2] ? 2 : a < t[3] ? 3 : 4;
  return k === 0 ? 'q0' : (v > 0 ? 'q' : 'q-') + k;
};
const topicOf = m => m.cat === 'Sports' && /\bvs\.?\b|\bv\b/i.test(m.title) ? 'games' : m.cat;   // single games apart from sport

/* ---------- which records ---------- */
function shown() {
  if (!P) return { live: [], done: [] };
  let ms = venue === 'all'
    ? P.markets.filter(m => (!m.group || m.group === m.id) && (play || !isPlay(m) || m.group))
    : P.markets.filter(m => m.venue === venue);
  if (query) { const q = query.toLowerCase(); ms = ms.filter(m => m.title.toLowerCase().includes(q) || m.outcomes.some(o => o.name.toLowerCase().includes(q))); }
  else ms = ms.filter(m => !hidden.has(topicOf(m)));
  ms = [...ms].sort((a, b) => weight(b) - weight(a) || mInterest(b) - mInterest(a));
  const live = ms.filter(m => !decided(m)), done = ms.filter(decided);
  pos.clear();
  live.forEach((m, i) => { pos.set(m.id, i + 1); });
  return { live: venue === 'all' && !query ? live.slice(0, ALL_MAX) : live, done };
}
// tile size from the place in the order: the top 4 or so big (2×2), the next tenth wide (2×1), the rest small
function sizes(ms) {
  const n = ms.length, out = new Map();
  ms.forEach((m, i) => out.set(m.id, weight(m) <= 0 || (mInterest(m) <= 0 && venue !== 'predictit') || thin(m) ? 's' : i < Math.min(4, Math.max(1, Math.round(n * 0.03))) ? 'l' : i < Math.max(2, Math.round(n * 0.1)) ? 'w' : 's'));
  return out;
}

/* ---------- tiles ---------- */
function tileHTML(m, size, done = false) {
  const h = shownOutcome(m), ch = h[tfKey()], cmp = venue === 'all' ? comparison(m) : null;
  const badges = (cmp ? cmp.rows.map(r => r.x) : [m]).map(x => `<span class="pv pv-${x.venue}" title="${VNAME[x.venue]}">${VTAG[x.venue]}</span>`).join('');
  const label = `${m.title}: ${h.name} ${pct(h.p)}, ${tf} ${fmtPP(ch)}, ${(cmp ? cmp.rows.map(r => VNAME[r.x.venue]) : [VNAME[m.venue]]).join(', ')}`;
  const t$ = mToday(m), T$ = mTotal(m), place = pos.get(m.id);
  return `<button class="ptile sz-${size} ${heat(ch)}${m.id === sel ? ' sel' : ''}${m.stale ? ' stale' : ''}${thin(m) ? ' thin' : ''}${done ? ' done' : ''}" data-id="${esc(m.id)}" data-coin="1" aria-haspopup="dialog" aria-label="${esc(label)}">
    <span class="pt-top"><span class="pt-id">${badges}${place && !done ? `<span class="pt-rank" title="#${place} by ${esc(SORTS.find(x => x[0] === rankBy)[1].toLowerCase())}">#${place}</span>` : ''}</span><span class="pt-chg">${arrow(ch)}${fmtPP(ch)}</span></span>
    <span class="pt-title">${esc(m.title)}</span>
    <span class="pt-ans">${esc(h.name)}</span>
    <span class="pt-nums"><b class="pt-p">${pct(h.p)}</b>${t$ != null ? `<span class="pt-amt">${money(t$, 'USD')} bet today</span>` : T$ != null ? `<span class="pt-amt">${money(T$, 'USD')} bet</span>` : ''}</span>
    ${cmp ? `<span class="pt-cmp${cmp.spread >= DIFFER ? ' differ' : ''}" title="The same outcome on each venue${cmp.spread >= DIFFER ? `: they differ by ${Math.round(cmp.spread * 100)} points` : ''}">${cmp.spread >= DIFFER ? '⚡ ' : ''}${cmp.rows.map(r => `${VTAG[r.x.venue]} ${pct(r.p)}`).join(' · ')}</span>` : ''}
    <span class="pt-foot">${done ? esc(decidedWhy(m)) : `${T$ != null ? `${money(T$, 'USD')} total${playNote(m)}` : 'no money figures published'}${m.end ? ` · ends ${dayLabel(m.end)}` : ''}${thin(m) ? ' · thin market' : ''}`}${m.stale ? ' · ⚠ not refreshed' : ''}</span>
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

/* ---------- table ---------- */
function tableHTML(ms) {
  const key = { rank: m => pos.get(m.id) ?? 1e9, title: m => m.title.toLowerCase(), venue: m => m.venue, head: m => shownOutcome(m).name.toLowerCase(), p: m => shownOutcome(m).p ?? -1, chg: m => shownOutcome(m)[tfKey()] ?? -9, today: m => mToday(m) ?? -1, total: m => mTotal(m) ?? -1, end: m => m.end || '9999', cat: m => CATS.indexOf(m.cat) }[sortBy.key];
  const rows = [...ms].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sortBy.dir; });
  const th = COLS.map(([k, l]) => `<th scope="col" data-sort="${k}" aria-sort="${sortBy.key === k ? (sortBy.dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}${sortBy.key === k ? (sortBy.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  return `<div class="r-tblwrap"><table class="r-tbl p-tbl"><thead><tr>${th}</tr></thead><tbody>${rows.map(m => {
    const h = shownOutcome(m), ch = h[tfKey()], vs = venue === 'all' ? membersOf(m) : [m];
    return `<tr class="r-row${decided(m) ? ' done' : ''}" data-id="${esc(m.id)}" tabindex="0"><td>${pos.get(m.id) ?? (decided(m) ? '✓' : '—')}</td><td class="p-tt">${esc(m.title)}</td><td>${vs.map(x => `<span class="pv pv-${x.venue}" title="${VNAME[x.venue]}">${VTAG[x.venue]}</span>`).join(' ')}${vs.length === 1 ? ' ' + VNAME[m.venue] : ''}</td>
      <td class="p-tt">${esc(h.name)}${decided(m) ? ' <span class="r-muted">decided</span>' : ''}</td><td><b>${pct(h.p)}</b></td><td><span class="cell-heat ${heat(ch)}">${arrow(ch)}${fmtPP(ch)}</span></td><td>${money(mToday(m), 'USD')}</td><td>${money(mTotal(m), 'USD')}${playNote(m) ? ' <span class="r-muted">play</span>' : ''}</td><td>${dayLabel(m.end)}</td><td>${esc(m.cat)}</td></tr>`;
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
  if (!P) return '';
  const base = venue === 'all' ? P.markets.filter(m => !m.group || m.group === m.id) : P.markets.filter(m => m.venue === venue);
  const n = k => base.filter(m => topicOf(m) === k).length;
  const keys = [...CATS.filter(c => c !== 'Sports' || n('Sports')), 'games'].filter(k => n(k));
  return keys.map(k => `<button class="chip" data-topic="${k}" aria-pressed="${!hidden.has(k)}" title="${hidden.has(k) ? 'Show' : 'Hide'} ${k === 'games' ? 'single games and matches' : k}">${k === 'games' ? 'Single games' : esc(k)} <span class="n">${n(k)}</span></button>`).join('')
    + (venue === 'all' ? `<label class="check p-play" title="Manifold is play money: its odds aren't backed by real bets"><input type="checkbox" id="pplay"${play ? ' checked' : ''}> Play money</label>` : '');
}
function render() {
  if (!P) return;
  // Betfair's tab only once it's set up
  const vs = VENUES.filter(([k]) => P.venues?.[k]?.state !== 'off');
  if (!vs.some(v => v[0] === venue) && venue !== 'all') venue = 'all';
  const { live, done } = shown(), main = $('#grid');
  $('#pvenue').innerHTML = [['all', 'All'], ...vs.map(v => [v[0], v[1]])].map(([k, l]) => {
    const st = k === 'all' ? 'ok' : P.venues?.[k]?.state || 'down';
    const n = k === 'all' ? P.markets.filter(m => (!m.group || m.group === m.id) && (play || !isPlay(m))).length : P.markets.filter(m => m.venue === k).length;
    const mark = st === 'ok' ? '' : ` <span class="p-st">${st === 'stale' ? '⚠ late' : 'down'}</span>`;
    return `<button data-v="${k}"${st === 'down' ? ' class="p-out"' : ''} aria-pressed="${k === venue}" title="${k === 'all' ? 'Every venue together; a question on several venues is one tile' : `${l}: ${st === 'ok' ? `${n} markets` : P.venues?.[k]?.err || st}`}">${k === 'all' ? '' : `<span class="pv pv-${k}" aria-hidden="true">${VTAG[k]}</span> `}${l}${n ? ` <span class="n">${n}</span>` : ''}${mark}</button>`;
  }).join('');
  $('#ptopics').innerHTML = topicChips();
  $$('#ptf button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === tf));
  $$('#pview button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === viewAs));
  $('#pgroup').value = groupBy; $('#pgroup').disabled = viewAs === 'table';
  $('#prank').value = rankBy; $('#prank').disabled = viewAs === 'table' || venue === 'predictit';
  const note = venue === 'all' ? VENUES.map(v => P.venues?.[v[0]]?.state === 'stale' ? venueNote(v[0]) : '').join('') : venueNote(venue);
  const all = [...live, ...done];
  if (!all.length) { main.className = ''; main.innerHTML = note + (query ? `<p class="p-empty">No market matches “${esc(query)}”.</p>` : note ? '' : '<p class="p-empty">No open markets in the topics shown.</p>'); }
  else if (viewAs === 'table') { main.className = ''; main.innerHTML = note + tableHTML(all); }
  else if (groupBy === 'cat') {
    main.className = 'r-groups';
    // topics in order of their total interest, so the busiest topic comes first
    const gs = CATS.map(c => ({ c, g: live.filter(m => m.cat === c) })).filter(x => x.g.length)
      .map(x => ({ ...x, sum: x.g.reduce((s, m) => s + mInterest(m), 0) })).sort((a, b) => b.sum - a.sum);
    main.innerHTML = note + gs.map(({ c, g, sum }) => `<section class="r-group"><h3>${esc(c)} <span class="r-muted">${g.length} · ${money(sum, 'USD')} interest</span></h3>${grid(g)}</section>`).join('') + decidedHTML(done);
  } else { main.className = ''; main.innerHTML = note + grid(live) + decidedHTML(done); }
  const t = M.bins[tf], scale = cells => `<span class="scale">${cells.map(([k, l]) => `<span class="${k}">${l}</span>`).join('')}</span>`;
  const order = venue === 'predictit' ? 'PredictIt’s own order (it publishes no money figures)'
    : `${SORTS.find(x => x[0] === rankBy)[1].toLowerCase()}${rankBy === 'sure' ? ': the surest open questions with the most money first' : rankBy === 'contested' ? ': the closest calls with the most money first' : rankBy === 'interest' ? ' (money bet today + a 30th of all money bet)' : ''}`;
  $('#plegend').innerHTML = `${TFS.find(x => x[0] === tf)[2]} move in the chance shown: ${scale([['q-4', `▼ ${t[3]}+`], ['q-2', `▼ ${t[1]}–${t[2]}`], ['q0', `±${t[0]}`], ['q2', `▲ ${t[1]}–${t[2]}`], ['q4', `▲ ${t[3]}+`]])} pp · <b>teal = more likely</b>, amber = less · ranked by ${order}`;
  const q = new URLSearchParams();
  if (venue !== 'all') q.set('v', venue);
  if (sel) q.set('m', sel);
  const url = location.pathname + (q.toString() ? '?' + q : '');
  if (url !== location.pathname + location.search) history.replaceState(null, '', url);
}

/* ---------- popup: every venue's price, every outcome, its moves and the last 35 days ---------- */
function sparkHTML(m) {
  const h = P.hist?.[m.id];
  if (!h || h.p.filter(v => v != null).length < 2) return '<p class="r-muted">History builds up from the first day this market is tracked here.</p>';
  const pts = h.p.map((v, i) => [h.d + i, v]).filter(x => x[1] != null), w = 340, ht = 90, x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  const X = d => 4 + (d - x0) / (x1 - x0 || 1) * (w - 8), Y = v => ht - 14 - v * (ht - 22);
  const d = pts.map(([dd, v], i) => `${i ? 'L' : 'M'}${X(dd).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const lab = day => new Date(day * DAY).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `<svg class="r-chart p-chart" viewBox="0 0 ${w} ${ht}" role="img" aria-label="${esc(`Chance of ${m.head}, last ${pts.length} days`)}">
    ${[0, 0.5, 1].map(v => `<line x1="4" x2="${w - 4}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${w - 4}" y="${Y(v) - 2}" text-anchor="end" font-size="9" fill="var(--muted)">${v * 100}%</text>`).join('')}
    <path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linejoin="round"/>
    <text x="4" y="${ht - 2}" font-size="9" fill="var(--muted)">${lab(x0)}</text><text x="${w - 4}" y="${ht - 2}" text-anchor="end" font-size="9" fill="var(--muted)">${lab(x1)}</text></svg>`;
}
function compareHTML(m) {
  const cmp = comparison(m);
  if (!cmp) return '';
  const h = shownOutcome(m);
  return `<h3>${esc(h.name)} on each venue${cmp.spread >= DIFFER ? ` <span class="p-differ">⚡ they differ by ${Math.round(cmp.spread * 100)} points</span>` : ''}</h3>
    <table class="r-tbl p-otbl p-cmp"><thead><tr><th>Venue</th><th>Chance</th><th>Bet today</th><th>Bet in total</th></tr></thead><tbody>${cmp.rows.map(({ x, p }) =>
      `<tr><td class="p-tt"><span class="pv pv-${x.venue}" aria-hidden="true">${VTAG[x.venue]}</span> <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${VNAME[x.venue]} ↗</a></td><td><b>${pct(p)}</b></td><td>${money(today$(x), 'USD')}</td><td>${money(total$(x), 'USD')}${playNote(x) ? ' <span class="r-muted">play</span>' : ''}</td></tr>`).join('')}</tbody></table>
    <p class="r-muted">Matched by their wording and outcomes: a best guess. Each venue’s rules for when a question resolves can differ.</p>`;
}
function detailHTML(m) {
  const rows = m.outcomes.map(o => `<tr${o.name === m.head ? ' class="p-headrow"' : ''}><td class="p-tt">${esc(o.name)}</td>
    <td class="p-pbar"><span style="width:${Math.round((o.p || 0) * 100)}%"></span><b>${pct(o.p)}</b></td>
    ${TFS.map(([, k]) => `<td>${o[k] == null ? '—' : `<span class="cell-heat ${heat(o[k])}">${arrow(o[k])}${fmtPP(o[k])}</span>`}</td>`).join('')}</tr>`).join('');
  const sp = headOf(m).sp;
  const kv = [
    ['Venue', `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${VNAME[m.venue]} ↗</a>`],
    ['Topic', esc(m.cat)],
    ['Status', decided(m) ? `Decided or as good as: ${esc(decidedWhy(m))}` : 'Open'],
    ['Interest', interest(m) > 0 ? `<b>#${m.rank ?? '—'}</b> of ${P.markets.length} · ${money(interest(m), 'USD')}${thin(m) ? ' · <b>thin market</b>: a small trade can move the price' : ''}` : 'not ranked: no money figures published'],
    ['Bet today', today$(m) == null ? '—' : '≈ ' + money(today$(m), 'USD') + (isPlay(m) ? ` <span class="r-muted">(${money(m.vol24, 'MANA')} play money)</span>` : m.contracts24 ? ` <span class="r-muted">(${m.contracts24.toLocaleString()} contracts)</span>` : '')],
    ['Bet in total', total$(m) == null ? '—' : '≈ ' + money(total$(m), 'USD') + (isPlay(m) ? ` <span class="r-muted">(${money(m.vol, 'MANA')})</span>` : m.cur === 'GBP' ? ` <span class="r-muted">(${money(m.vol, 'GBP')} matched)</span>` : '')],
    m.oi ? ['Money riding on it now', '≈ ' + money(m.oi, 'USD')] : m.liq != null ? ['Liquidity', money(m.liq, m.cur)] : null,
    sp != null ? ['Buy–sell gap', `${(sp * 100).toFixed(1)} points${sp >= 0.05 ? ' · <b>wide</b>: the price is a rough guide' : ''}`] : null,
    m.traders ? ['People who bet', m.traders.toLocaleString()] : null,
    ['Ends', m.end ? dayLabel(m.end) : '—'],
  ].filter(Boolean);
  return `<div class="r-card r-pop p-pop">
    <div class="r-head"><h2><span class="pv pv-${m.venue}" aria-hidden="true">${VTAG[m.venue]}</span> ${esc(m.title)}</h2></div>
    ${m.stale ? '<p class="r-says">⚠ This venue didn’t answer in the latest update: these are its last known prices.</p>' : ''}
    ${venue === 'all' ? compareHTML(m) : ''}
    <h3>Outcomes on ${VNAME[m.venue]}</h3>
    <table class="r-tbl p-otbl"><thead><tr><th>Outcome</th><th>Chance</th>${TFS.map(([l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    ${m.more ? `<p class="r-muted">+${m.more} less likely outcome${m.more > 1 ? 's' : ''} on ${VNAME[m.venue]}.</p>` : ''}
    <h3>${esc(m.head)}: last ${P.hist?.[m.id]?.p.length || 0} days</h3>${sparkHTML(m)}
    <dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <p class="r-src">${isPlay(m) ? 'Manifold uses play money (mana), so its odds aren’t backed by real bets. ' : ''}${m.cur === 'GBP' ? 'Betfair odds turned into chances (1 ÷ decimal odds, scaled to add up to 100%). ' : ''}${m.venue === 'kalshi' ? 'Kalshi’s chance is the middle of its best buy and sell prices; its dollars are contracts × price. ' : ''}A chance is the price of a contract that pays 1 if the outcome happens. Not advice.</p>
  </div>`;
}
function openPopup(id) {
  const m = P?.markets.find(x => x.id === id);
  if (!m) return;
  const box = $('#detail'), phone = innerWidth <= 640;
  box.querySelector('.body').innerHTML = detailHTML(m);
  box.classList.add('show', 'pinned', 'r-compact');
  box.style.width = phone ? '' : Math.min(480, innerWidth - 24) + 'px';
  box.style.maxHeight = phone ? '' : (innerHeight - 40) + 'px';
  const tile = $(`[data-id="${CSS.escape(id)}"]`), cr = tile?.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight, mg = 12, gap = 8;
  let left = (innerWidth - bw) / 2, top = (innerHeight - bh) / 2;
  if (cr && !phone) {
    if (cr.right + gap + bw <= innerWidth - mg) { left = cr.right + gap; top = cr.top; }
    else if (cr.left - gap - bw >= mg) { left = cr.left - gap - bw; top = cr.top; }
  }
  box.style.left = Math.min(Math.max(mg, left), Math.max(mg, innerWidth - bw - mg)) + 'px';
  box.style.top = Math.min(Math.max(mg, top), Math.max(mg, innerHeight - bh - mg)) + 'px';
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
  <p><b>A tile</b> reads top to bottom: the question, the answer, its chance and the money bet today. A chance is the price of a contract that pays 1 if it happens: 62% means traders pay 62¢ for a dollar if it does. The answer shown: for a yes/no question the likelier side (2% yes is shown as 98% no); when the outcomes exclude each other (who wins) the likeliest; on a ladder (“above 50 seats”, “by 31 October”) the step nearest 50%, since the sure steps say nothing.</p>
  <p><b>Colour:</b> how much that chance moved over 1 day, 1 week or 1 month, in percentage points (40% → 52% is ▲ 12 pp). <b>Teal is more likely, amber less</b>: not blue and red, so the colours never read as a party.</p>
  <p><b>Money, in US dollars on every venue:</b> bet today (24 hours) and bet in total. Interest = bet today + a 30th of bet in total. The figures are approximate: Kalshi counts contracts (turned into dollars at their price) and each venue counts trades its own way. Manifold is play money and is left out of “All” unless <b>Play money</b> is ticked. PredictIt publishes no money figures; its own tab keeps its own order. A faded tile is a <b>thin market</b> (under $1K of interest), where one small trade can move the price.</p>
  <p><b>Rank by:</b> <b>Likeliest + most money</b> (the default) puts the surest open questions with the most money first: the likeliest outcome’s chance × the money in digits ($1K ≈ 3, $1M ≈ 6). <b>Most contested</b> puts the closest calls with the most money first. Also interest, bet today, bet in total, biggest move, ending soonest. The #number is the place in that order.</p>
  <p><b>Decided or waiting for the result:</b> questions at least ${Math.round(DECIDED * 100)}% sure, or past their end date, are folded into a row at the bottom, so they don’t crowd out the open ones.</p>
  <p><b>The same question on several venues</b> is one tile in “All”, with each venue’s chance underneath (⚡ when they differ by ${Math.round(DIFFER * 100)} points or more) and their money added up. Matching is by wording and outcomes, a best guess; the venues’ rules for resolving a question can differ.</p>
  <p><b>Topics</b> can be switched off with the chips; single games and matches are off to start with. Not real-time, refreshed every 10 minutes, and not advice.</p></div>`;

export function start() {
  document.body.classList.add('rates-page', 'pred-page');
  for (const s of ['#colorBy', '#quote', '#view', '#density', '.controls .ctl', '#legend', '#reset', '#refresh', '#share', '#excluded']) { const el = $(s); if (el) el.hidden = true; }
  $('main').insertAdjacentHTML('afterbegin', `<div class="r-bar p-bar">
    <div class="seg p-venues" id="pvenue" role="group" aria-label="Venue"></div>
    <button class="btn p-optbtn" id="popts" aria-expanded="false" aria-controls="poptions">⚙ Options</button></div>
    <div class="r-bar p-bar p-options" id="poptions">
    <div class="seg" id="ptf" role="group" aria-label="Move over">${TFS.map(([v, , l]) => `<button data-v="${v}" title="Colour by the move over ${l}">${v}</button>`).join('')}</div>
    <div class="seg" id="pview" role="group" aria-label="View"><button data-v="heatmap">Heatmap</button><button data-v="table">Table</button></div>
    <label class="r-sel">Rank by <select id="prank">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    <label class="r-sel">Group <select id="pgroup"><option value="none">None</option><option value="cat">By topic</option></select></label>
    <input type="search" id="psearch" class="p-search" placeholder="Search markets…" aria-label="Search markets">
    <button class="btn leg-toggle" id="phelpBtn" aria-expanded="false" aria-controls="phelp">ⓘ How to read</button>
    <div class="chips p-topics" id="ptopics" role="group" aria-label="Topics shown"></div>
    <span id="plegend" class="leg-item"></span></div>${HELP}`);
  $('#detail').setAttribute('aria-label', 'Market details');
  const linked = Q.get('m');
  $('#pvenue').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; venue = b.dataset.v; store.set('hm.predVenue', venue); render(); });
  $('#ptf').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; tf = b.dataset.v; store.set('hm.predTf', tf); render(); });
  $('#pview').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; viewAs = b.dataset.v; store.set('hm.predView', viewAs); render(); });
  $('#pgroup').addEventListener('change', e => { groupBy = e.target.value; store.set('hm.predGroup', groupBy); render(); });
  $('#prank').addEventListener('change', e => { rankBy = e.target.value; store.set('hm.predRank', rankBy); render(); });
  $('#ptopics').addEventListener('click', e => {
    const b = e.target.closest('button[data-topic]');
    if (!b) return;
    const k = b.dataset.topic;
    if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
    store.set('hm.predHide', [...hidden]); render();
  });
  $('#ptopics').addEventListener('change', e => { if (e.target.id === 'pplay') { play = e.target.checked; store.set('hm.predPlay', play); render(); } });
  // phones: the options fold behind one button, so the tiles start near the top
  $('#popts').addEventListener('click', e => { const open = !$('#poptions').classList.contains('open'); $('#poptions').classList.toggle('open', open); e.currentTarget.setAttribute('aria-expanded', open); });
  let qt = 0;
  $('#psearch').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { query = e.target.value.trim(); render(); }, 150); });
  $('#phelpBtn').addEventListener('click', e => { const open = $('#phelp').hidden; $('#phelp').hidden = !open; e.currentTarget.setAttribute('aria-expanded', open); e.currentTarget.textContent = open ? '✕ Hide' : 'ⓘ How to read'; });
  $('#grid').addEventListener('toggle', e => { if (e.target.id === 'pdone') store.set('hm.predDone', e.target.open); }, true);
  $('#grid').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; sortBy = { key: k, dir: sortBy.key === k ? -sortBy.dir : ['rank', 'title', 'venue', 'head', 'end', 'cat'].includes(k) ? 1 : -1 }; render(); return; }
    const t = e.target.closest('[data-id]');
    if (t && P) openPopup(t.dataset.id);
  });
  $('#grid').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.r-row')) openPopup(e.target.closest('.r-row').dataset.id); });
  // closed by the shared handlers (×, Escape, the backdrop): forget the market and take it off the address
  new MutationObserver(() => { if (sel && !$('#detail').classList.contains('pinned')) { sel = null; render(); } })
    .observe($('#detail'), { attributes: true, attributeFilter: ['class'] });
  load().then(() => { if (linked) openPopup(linked); });
  setInterval(() => { renderFresh(); if (!document.hidden && Date.now() - loadedAt > REFRESH) load(); }, 30e3);
}
