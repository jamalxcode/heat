// heat.sala.company/predictions/: prediction markets from Polymarket, Kalshi, PredictIt, Manifold and Betfair
// (predictions.json, built by scripts/build-predictions.mjs). Not prices, so like the rates page it draws its own view:
// a tab per venue plus "All", tiles sized by trading volume and coloured by how much the headline outcome's
// probability moved (1 day, 1 week or 1 month, in percentage points), grouped by topic, or a sortable table; a click
// opens every outcome with its moves and the headline's last 35 days. main.mjs starts it instead of the price pipeline.
import { $, $$, esc, M, S, store } from './core.mjs';
import { renderHealth } from './render.mjs';

const DAY = 864e5, REFRESH = 10 * 60e3, ALL_MAX = 200;
const VENUES = [
  ['polymarket', 'Polymarket', 'PM'], ['kalshi', 'Kalshi', 'K'], ['predictit', 'PredictIt', 'PI'],
  ['manifold', 'Manifold', 'MF'], ['betfair', 'Betfair', 'BF'],
];
const VNAME = Object.fromEntries(VENUES.map(v => [v[0], v[1]])), VTAG = Object.fromEntries(VENUES.map(v => [v[0], v[2]]));
const CATS = ['Politics', 'World', 'Economy', 'Business', 'Crypto', 'Tech & science', 'Sports', 'Culture', 'Climate', 'Other'];
const TFS = [['1d', 'd1', '1 day'], ['1w', 'd7', '1 week'], ['1m', 'd30', '1 month']];
const COLS = [['rank', '#'], ['title', 'Market'], ['venue', 'Venue'], ['head', 'Outcome'], ['p', 'Chance'], ['chg', 'Move'], ['today', 'Bet today'], ['total', 'Bet in total'], ['end', 'Ends'], ['cat', 'Topic']];
// what the tiles are ranked by (and so which come first and which are big); interest is the default
const SORTS = [['sure', 'Likeliest + most money'], ['interest', 'Interest'], ['today', 'Bet today'], ['total', 'Bet in total'], ['move', 'Biggest move'], ['ending', 'Ending soonest']];
const pref = (k, ok, d) => { const v = store.get(k); return ok.includes(v) ? v : d; };
const Q = new URLSearchParams(location.search);
let P = null, loadedAt = 0, sel = null, query = '';
const pos = new Map();                 // each market's place in the current order (the #number on its tile)
let venue = (v => ['all', ...VENUES.map(x => x[0])].includes(v) ? v : null)(Q.get('v')) || pref('hm.predVenue', ['all', ...VENUES.map(x => x[0])], 'all');
let tf = pref('hm.predTf', TFS.map(t => t[0]), '1d');
let viewAs = pref('hm.predView', ['heatmap', 'table'], 'heatmap');
let groupBy = pref('hm.predGroup', ['cat', 'none'], 'none');
let rankBy = pref('hm.predRank', SORTS.map(x => x[0]), 'sure');
let sortBy = { key: 'rank', dir: 1 };

/* ---------- numbers ---------- */
const pct = p => p == null ? '—' : p >= 0.995 && p < 1 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : Math.round(p * 100) + '%';
const fmtPP = v => { if (v == null) return '—'; const x = v * 100, r = Math.abs(x) < 10 ? Math.abs(x).toFixed(1) : Math.round(Math.abs(x)); return (x > 0.05 ? '+' : x < -0.05 ? '−' : '±') + r + ' pp'; };
const money = (n, cur) => {
  if (n == null) return '—';
  const sign = cur === 'MANA' ? 'M$' : cur === 'GBP' ? '£' : '$';
  for (const [v, s] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (Math.abs(n) >= v) return sign + (n / v).toFixed(n / v >= 100 ? 0 : 1).replace(/\.0$/, '') + s;
  return sign + Math.round(n);
};
const dayLabel = iso => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short', year: iso.slice(0, 4) === String(new Date().getUTCFullYear()) ? undefined : 'numeric', timeZone: 'UTC' }) : '—';
const headOf = m => m.outcomes.find(o => o.name === m.head) || m.outcomes[0];
const tfKey = () => TFS.find(t => t[0] === tf)[1];
const chgOf = m => headOf(m)[tfKey()];
// The common yardstick (scripts/build-predictions.mjs interestOf), in dollars on every venue: money bet today (last 24 h)
// and in total; interest = bet today + a 30th of bet in total. PredictIt publishes no money figures: interest 0, last.
const today$ = m => m.usd24 ?? null, total$ = m => m.usdTotal ?? null;
const interest = m => m.interest ?? ((today$(m) || 0) + (total$(m) || 0) / 30);
// The likeliest outcome: for a yes/no question the likelier side (2% yes is 98% no, and its move turns round); for
// several outcomes the one with the highest chance. "Likeliest + most money" ranks by that chance × the size of the money
// behind the market in digits (log10 of interest in dollars: $1K = 3, $1M = 6), so the surest outcomes come first and,
// among equally sure ones, those with the most money bet; a sure thing with little money behind it sits lower.
function likeliest(m) {
  if (m.outcomes.length === 1 && /^yes$/i.test(m.outcomes[0].name)) {
    const o = m.outcomes[0], no = o.p != null && o.p < 0.5;
    if (!no) return { name: headLabel(m), p: o.p, d1: o.d1, d7: o.d7, d30: o.d30, no: false };
    const neg = v => v == null ? null : -v;
    return { name: 'No', p: 1 - o.p, d1: neg(o.d1), d7: neg(o.d7), d30: neg(o.d30), no: true };
  }
  const top = m.outcomes.reduce((a, o) => (o.p ?? -1) > (a.p ?? -1) ? o : a, m.outcomes[0]);
  return { ...top, no: false };
}
const sureScore = m => (likeliest(m).p || 0) * Math.log10(1 + interest(m));
// what a tile shows: the likeliest outcome in that ranking, otherwise the headline (yes, the leader, or the most traded)
const shownOutcome = m => rankBy === 'sure' ? likeliest(m) : { ...headOf(m), name: headLabel(m) };
const RANK = {
  sure: sureScore, interest, today: m => today$(m) ?? -1, total: m => total$(m) ?? -1,
  move: m => Math.abs(shownOutcome(m)[tfKey()] ?? 0), ending: m => -(m.end ? Date.parse(m.end) : 9e15),
};
const weight = m => RANK[rankBy](m);
const playNote = m => m.cur === 'MANA' ? ' play money' : '';
const volText = m => today$(m) == null && total$(m) == null ? 'no money figures published'
  : `${money(today$(m), 'USD')} today · ${money(total$(m), 'USD')} total${playNote(m)}`;
const heat = v => {
  if (v == null) return 'h0';
  const t = M.bins[tf], a = Math.abs(v * 100), k = a < t[0] ? 0 : a < t[1] ? 1 : a < t[2] ? 2 : a < t[3] ? 3 : 4;
  return k === 0 ? 'h0' : (v > 0 ? 'h' : 'h-') + k;
};
const headLabel = m => m.head;

/* ---------- which records ---------- */
function shown() {
  if (!P) return [];
  let ms = venue === 'all' ? P.markets : P.markets.filter(m => m.venue === venue);
  if (query) { const q = query.toLowerCase(); ms = ms.filter(m => m.title.toLowerCase().includes(q) || m.outcomes.some(o => o.name.toLowerCase().includes(q))); }
  ms = [...ms].sort((a, b) => weight(b) - weight(a) || interest(b) - interest(a));
  ms.forEach((m, i) => { pos.set(m.id, i + 1); });
  return venue === 'all' && !query ? ms.slice(0, ALL_MAX) : ms;
}
// tile size from the rank within what's shown (by interest unless another order is picked): the top few big (2×2), the next wide (2×1), the rest small
function sizes(ms) {
  const n = ms.length, out = new Map();
  ms.forEach((m, i) => out.set(m.id, weight(m) <= 0 || interest(m) <= 0 ? 's' : i < Math.max(1, Math.round(n * 0.06)) ? 'l' : i < Math.round(n * 0.2) ? 'w' : 's'));
  return out;
}

/* ---------- tiles ---------- */
function tileHTML(m, size) {
  const h = shownOutcome(m), ch = h[tfKey()], yn = m.outcomes.length === 1 && /^yes$/i.test(m.outcomes[0].name);
  const label = `${m.title}: ${h.name} ${pct(h.p)}, ${tf} ${fmtPP(ch)}, ${VNAME[m.venue]}`;
  return `<button class="ptile sz-${size} ${heat(ch)}${m.id === sel ? ' sel' : ''}${m.stale ? ' stale' : ''}" data-id="${esc(m.id)}" data-coin="1" aria-haspopup="dialog" aria-label="${esc(label)}">
    <span class="pt-top"><span class="pt-id"><span class="pv pv-${m.venue}" title="${VNAME[m.venue]}">${VTAG[m.venue]}</span>${pos.get(m.id) && weight(m) > 0 ? `<span class="pt-rank" title="#${pos.get(m.id)} by ${esc(SORTS.find(x => x[0] === rankBy)[1].toLowerCase())}">#${pos.get(m.id)}</span>` : ''}</span><span class="pt-chg">${fmtPP(ch)}</span></span>
    <span class="pt-title">${esc(m.title)}</span>
    <span class="pt-ans">${esc(yn ? (h.no ? 'No' : 'Yes') : h.name)}</span>
    <span class="pt-nums"><b class="pt-p">${pct(h.p)}</b>${today$(m) != null ? `<span class="pt-amt">${money(today$(m), 'USD')} bet today</span>` : total$(m) != null ? `<span class="pt-amt">${money(total$(m), 'USD')} bet</span>` : ''}</span>
    <span class="pt-foot">${total$(m) != null ? `${money(total$(m), 'USD')} total${playNote(m)}` : 'no money figures published'}${m.end ? ` · ends ${dayLabel(m.end)}` : ''}${m.stale ? ' · ⚠ not refreshed' : ''}</span>
  </button>`;
}
function grid(ms) {
  const sz = sizes(ms);
  return `<div class="grid pgrid">${ms.map(m => tileHTML(m, sz.get(m.id))).join('')}</div>`;
}

/* ---------- table ---------- */
function tableHTML(ms) {
  const key = { rank: m => pos.get(m.id) ?? 1e9, title: m => m.title.toLowerCase(), venue: m => m.venue, head: m => shownOutcome(m).name.toLowerCase(), p: m => shownOutcome(m).p ?? -1, chg: m => shownOutcome(m)[tfKey()] ?? -9, today: m => today$(m) ?? -1, total: m => total$(m) ?? -1, end: m => m.end || '9999', cat: m => CATS.indexOf(m.cat) }[sortBy.key];
  const rows = [...ms].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sortBy.dir; });
  const th = COLS.map(([k, l]) => `<th scope="col" data-sort="${k}" aria-sort="${sortBy.key === k ? (sortBy.dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}${sortBy.key === k ? (sortBy.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  return `<div class="r-tblwrap"><table class="r-tbl p-tbl"><thead><tr>${th}</tr></thead><tbody>${rows.map(m => {
    const h = shownOutcome(m), ch = h[tfKey()];
    return `<tr class="r-row" data-id="${esc(m.id)}" tabindex="0"><td>${weight(m) > 0 ? pos.get(m.id) : '—'}</td><td class="p-tt">${esc(m.title)}</td><td><span class="pv pv-${m.venue}">${VTAG[m.venue]}</span> ${VNAME[m.venue]}</td>
      <td class="p-tt">${esc(h.name)}</td><td><b>${pct(h.p)}</b></td><td><span class="cell-heat ${heat(ch)}">${fmtPP(ch)}</span></td><td>${money(today$(m), 'USD')}</td><td>${money(total$(m), 'USD')}${playNote(m) ? ' <span class="r-muted">play</span>' : ''}</td><td>${dayLabel(m.end)}</td><td>${esc(m.cat)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

/* ---------- venue notes (off / down / stale) ---------- */
function venueNote(v) {
  const s = P?.venues?.[v];
  if (!s || s.state === 'ok') return '';
  if (s.state === 'off') return `<div class="p-note"><b>${VNAME[v]} isn’t connected yet.</b> Its exchange data needs an API key and an account, which this page doesn’t have yet. The other venues work as usual.</div>`;
  if (s.state === 'stale') return `<div class="p-note">⚠ <b>${VNAME[v]} didn’t answer in the latest update</b>: showing its markets from ${s.at ? new Date(s.at).toLocaleString([], { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : 'an earlier update'}.</div>`;
  return `<div class="p-note">✕ <b>${VNAME[v]} isn’t answering right now</b>, so there’s nothing to show for it. It’s retried every 10 minutes.</div>`;
}

/* ---------- render ---------- */
function render() {
  if (!P) return;
  const ms = shown(), main = $('#grid');
  // the venue tabs, with how many markets each has (and a mark when it isn't working)
  $('#pvenue').innerHTML = [['all', 'All'], ...VENUES.map(v => [v[0], v[1]])].map(([k, l]) => {
    const st = k === 'all' ? 'ok' : P.venues?.[k]?.state || 'down';
    const n = k === 'all' ? P.markets.length : P.markets.filter(m => m.venue === k).length;
    const mark = st === 'ok' ? '' : ` <span class="p-st">${st === 'stale' ? '⚠ late' : st === 'off' ? 'not set up' : 'down'}</span>`;
    return `<button data-v="${k}"${st === 'off' || st === 'down' ? ' class="p-out"' : ''} aria-pressed="${k === venue}" title="${k === 'all' ? `Every venue together: the ${ALL_MAX} with the most interest` : `${l}: ${st === 'ok' ? `${n} markets` : P.venues?.[k]?.err || st}`}">${k === 'all' ? '' : `<span class="pv pv-${k}" aria-hidden="true">${VTAG[k]}</span> `}${l}${n ? ` <span class="n">${n}</span>` : ''}${mark}</button>`;
  }).join('');
  $$('#ptf button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === tf));
  $$('#pview button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === viewAs));
  $('#pgroup').value = groupBy; $('#pgroup').disabled = viewAs === 'table';
  $('#prank').value = rankBy; $('#prank').disabled = viewAs === 'table';
  const note = venue === 'all' ? VENUES.map(v => P.venues?.[v[0]]?.state === 'stale' ? venueNote(v[0]) : '').join('') : venueNote(venue);
  if (!ms.length) { main.className = ''; main.innerHTML = note + (query ? `<p class="p-empty">No market matches “${esc(query)}”.</p>` : note ? '' : '<p class="p-empty">No open markets.</p>'); }
  else if (viewAs === 'table') { main.className = ''; main.innerHTML = note + tableHTML(ms); }
  else if (groupBy === 'cat') {
    main.className = 'r-groups';
    // topics in order of their total interest, so the busiest topic comes first
    const groups = CATS.map(c => ({ c, g: ms.filter(m => m.cat === c) })).filter(x => x.g.length)
      .map(x => ({ ...x, sum: x.g.reduce((s, m) => s + interest(m), 0) })).sort((a, b) => b.sum - a.sum);
    main.innerHTML = note + groups.map(({ c, g, sum }) => `<section class="r-group"><h3>${esc(c)} <span class="r-muted">${g.length} · ${money(sum, 'USD')} interest</span></h3>${grid(g)}</section>`).join('');
  } else { main.className = ''; main.innerHTML = note + grid(ms); }
  const t = M.bins[tf], scale = cells => `<span class="scale">${cells.map(([k, l]) => `<span class="${k}">${l}</span>`).join('')}</span>`;
  $('#plegend').innerHTML = `${TFS.find(x => x[0] === tf)[2]} move in the chance shown: ${scale([['h-4', `≤ −${t[3]}`], ['h-2', `−${t[1]}…${t[2]}`], ['h0', `±${t[0]}`], ['h2', `${t[1]}…${t[2]}`], ['h4', `≥ ${t[3]}`]])} pp · <b>blue = more likely</b>, red = less · ranked and sized by ${SORTS.find(x => x[0] === rankBy)[1].toLowerCase()}${rankBy === 'interest' ? ' (money bet today + a 30th of all money bet)' : rankBy === 'sure' ? ': the surest outcomes with the most money behind them first' : ''}`;
  const q = new URLSearchParams();
  if (venue !== 'all') q.set('v', venue);
  if (sel) q.set('m', sel);
  const url = location.pathname + (q.toString() ? '?' + q : '');
  if (url !== location.pathname + location.search) history.replaceState(null, '', url);
}

/* ---------- popup: every outcome, its moves, and the headline's last 35 days ---------- */
function sparkHTML(m) {
  const h = P.hist?.[m.id];
  if (!h || h.p.filter(v => v != null).length < 2) return '<p class="r-muted">History builds up from the first day this market is tracked here.</p>';
  const pts = h.p.map((v, i) => [h.d + i, v]).filter(x => x[1] != null), w = 340, ht = 90, x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  const X = d => 4 + (d - x0) / (x1 - x0 || 1) * (w - 8), Y = v => ht - 14 - v * (ht - 22);
  const d = pts.map(([dd, v], i) => `${i ? 'L' : 'M'}${X(dd).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const lab = day => new Date(day * DAY).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `<svg class="r-chart p-chart" viewBox="0 0 ${w} ${ht}" role="img" aria-label="${esc(`Chance of ${headLabel(m)}, last ${pts.length} days`)}">
    ${[0, 0.5, 1].map(v => `<line x1="4" x2="${w - 4}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${w - 4}" y="${Y(v) - 2}" text-anchor="end" font-size="9" fill="var(--muted)">${v * 100}%</text>`).join('')}
    <path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linejoin="round"/>
    <text x="4" y="${ht - 2}" font-size="9" fill="var(--muted)">${lab(x0)}</text><text x="${w - 4}" y="${ht - 2}" text-anchor="end" font-size="9" fill="var(--muted)">${lab(x1)}</text></svg>`;
}
function detailHTML(m) {
  const rows = m.outcomes.map(o => `<tr${o.name === m.head ? ' class="p-headrow"' : ''}><td class="p-tt">${esc(o.name)}</td>
    <td class="p-pbar"><span style="width:${Math.round((o.p || 0) * 100)}%"></span><b>${pct(o.p)}</b></td>
    ${TFS.map(([, k]) => `<td>${o[k] == null ? '—' : `<span class="cell-heat ${heat(o[k])}">${fmtPP(o[k])}</span>`}</td>`).join('')}</tr>`).join('');
  const kv = [
    ['Venue', `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${VNAME[m.venue]} ↗</a>`],
    ['Topic', esc(m.cat)],
    ['Interest', interest(m) > 0 ? `<b>#${m.rank ?? '—'}</b> of ${P.markets.length} · ${money(interest(m), 'USD')}` : 'not ranked: no money figures published'],
    ['Bet today', today$(m) == null ? '—' : money(today$(m), 'USD') + (m.cur === 'MANA' ? ` <span class="r-muted">(${money(m.vol24, 'MANA')} play money)</span>` : m.contracts24 ? ` <span class="r-muted">(${m.contracts24.toLocaleString()} contracts)</span>` : '')],
    ['Bet in total', total$(m) == null ? '—' : money(total$(m), 'USD') + (m.cur === 'MANA' ? ` <span class="r-muted">(${money(m.vol, 'MANA')})</span>` : m.cur === 'GBP' ? ` <span class="r-muted">(${money(m.vol, 'GBP')} matched)</span>` : '')],
    m.oi ? ['Money riding on it now', money(m.oi, 'USD')] : m.liq != null ? ['Liquidity', money(m.liq, m.cur)] : null,
    m.traders ? ['People who bet', m.traders.toLocaleString()] : null,
    ['Ends', m.end ? dayLabel(m.end) : '—'],
  ].filter(Boolean);
  return `<div class="r-card r-pop p-pop">
    <div class="r-head"><h2><span class="pv pv-${m.venue}" aria-hidden="true">${VTAG[m.venue]}</span> ${esc(m.title)}</h2></div>
    ${m.stale ? '<p class="r-says">⚠ This venue didn’t answer in the latest update: these are its last known prices.</p>' : ''}
    <table class="r-tbl p-otbl"><thead><tr><th>Outcome</th><th>Chance</th>${TFS.map(([l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    ${m.more ? `<p class="r-muted">+${m.more} less likely outcome${m.more > 1 ? 's' : ''} on ${VNAME[m.venue]}.</p>` : ''}
    <h3>${esc(headLabel(m))}: last ${P.hist?.[m.id]?.p.length || 0} days</h3>${sparkHTML(m)}
    <dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <p class="r-src">${m.cur === 'MANA' ? 'Manifold uses play money (mana), so its odds aren’t backed by real bets. ' : ''}${m.cur === 'GBP' ? 'Betfair odds turned into chances (1 ÷ decimal odds, scaled to add up to 100%). ' : ''}A chance is the price of a contract that pays 1 if the outcome happens. Not advice.</p>
  </div>`;
}
function openPopup(id) {
  const m = P?.markets.find(x => x.id === id);
  if (!m) return;
  const box = $('#detail'), phone = innerWidth <= 640;
  box.querySelector('.body').innerHTML = detailHTML(m);
  box.classList.add('show', 'pinned', 'r-compact');
  box.style.width = phone ? '' : Math.min(460, innerWidth - 24) + 'px';
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
  const vs = VENUES.map(([k, l]) => { const s = P.venues?.[k]?.state; return `${l} ${s === 'ok' ? '✓' : s === 'stale' ? '⚠' : s === 'off' ? '○' : '✕'}`; }).join(' · ');
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
    render(); renderFresh();
    const up = VENUES.filter(([k]) => P.venues?.[k]?.state === 'ok').length;
    $('#status').innerHTML = `<span class="dot live"></span>${P.markets.length} markets · ${up}/${VENUES.length} venues live`;
  } catch (e) {
    $('#status').innerHTML = `<span class="dot"></span>${esc(e.message)}. Retrying automatically.`;
  }
  fetch('/health.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(renderHealth).catch(() => {});
}

const HELP = `<div class="leg-more p-help" id="phelp" hidden>
  <p><b>What a tile is:</b> one question on one venue. The big number is the market’s chance for the outcome shown: for a yes/no question, “yes”; when several outcomes exclude each other (who wins), the likeliest; otherwise the most traded. A chance is the price of a contract that pays 1 if it happens, so 62% means traders pay 62¢ for a dollar if it does.</p>
  <p><b>Colour:</b> how much that chance moved over 1 day, 1 week or 1 month, in percentage points (40% → 52% is +12 pp). Blue is more likely, red is less.</p>
  <p><b>Order and size: interest.</b> Every venue’s money is counted in US dollars: <b>bet today</b> (the last 24 hours) and <b>bet in total</b> (since the market opened). Interest = bet today + a 30th of bet in total, so today’s money counts in full and a big market having a quiet day isn’t pushed under a small one having a busy day. The #number is a question’s rank across every venue; the biggest tiles have the most interest. Kalshi counts contracts, so its dollars are contracts × price (approximate). Manifold’s play money counts at M$100 = $1. PredictIt publishes no money figures, so its questions sit last. </p>
  <p><b>Rank by: Likeliest + most money</b> (the default) puts the surest outcomes first: its score is the chance of the likeliest outcome × the size of the money behind the market in digits ($1K ≈ 3, $1M ≈ 6, $10M ≈ 7). So 99% with $10M bet comes above 99% with $10K, and both above 60% with $10M. For a yes/no question the tile then shows the likelier side (2% yes is shown as 98% no). <b>Rank by</b> also offers interest alone, bet today, bet in total, the biggest move or the soonest end. The #number is the place in the order picked.</p>
  <p><b>The venues:</b> Polymarket (crypto-settled, worldwide), Kalshi (US-regulated exchange), PredictIt (US, small stakes, no volume published), Manifold (play money, so its odds aren’t backed by real bets: ranked in “All” at M$100 = $1) and Betfair (UK betting exchange, odds turned into chances). The same question on two venues can differ: the rules for when it resolves, fees and who can trade there all differ.</p>
  <p><b>All</b> shows the ${ALL_MAX} questions with the most interest across every venue. Click a tile for every outcome, its moves and the last 35 days. Not real-time, refreshed every 10 minutes, and not advice.</p></div>`;

export function start() {
  document.body.classList.add('rates-page', 'pred-page');
  for (const s of ['#colorBy', '#quote', '#view', '#density', '.controls .ctl', '#legend', '#reset', '#refresh', '#share', '#excluded']) { const el = $(s); if (el) el.hidden = true; }
  $('main').insertAdjacentHTML('afterbegin', `<div class="r-bar p-bar">
    <div class="seg p-venues" id="pvenue" role="group" aria-label="Venue"></div></div>
    <div class="r-bar p-bar">
    <div class="seg" id="ptf" role="group" aria-label="Move over">${TFS.map(([v, , l]) => `<button data-v="${v}" title="Colour by the move over ${l}">${v}</button>`).join('')}</div>
    <div class="seg" id="pview" role="group" aria-label="View"><button data-v="heatmap">Heatmap</button><button data-v="table">Table</button></div>
    <label class="r-sel">Rank by <select id="prank">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    <label class="r-sel">Group <select id="pgroup"><option value="none">None</option><option value="cat">By topic</option></select></label>
    <input type="search" id="psearch" class="p-search" placeholder="Search markets…" aria-label="Search markets">
    <button class="btn leg-toggle" id="phelpBtn" aria-expanded="false" aria-controls="phelp">ⓘ How to read</button>
    <span id="plegend" class="leg-item"></span></div>${HELP}`);
  $('#detail').setAttribute('aria-label', 'Market details');
  const linked = Q.get('m');
  $('#pvenue').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; venue = b.dataset.v; store.set('hm.predVenue', venue); render(); });
  $('#ptf').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; tf = b.dataset.v; store.set('hm.predTf', tf); render(); });
  $('#pview').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; viewAs = b.dataset.v; store.set('hm.predView', viewAs); render(); });
  $('#pgroup').addEventListener('change', e => { groupBy = e.target.value; store.set('hm.predGroup', groupBy); render(); });
  $('#prank').addEventListener('change', e => { rankBy = e.target.value; store.set('hm.predRank', rankBy); render(); });
  let qt = 0;
  $('#psearch').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { query = e.target.value.trim(); render(); }, 150); });
  $('#phelpBtn').addEventListener('click', e => { const open = $('#phelp').hidden; $('#phelp').hidden = !open; e.currentTarget.setAttribute('aria-expanded', open); e.currentTarget.textContent = open ? '✕ Hide' : 'ⓘ How to read'; });
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
