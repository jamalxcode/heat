// heat.sala.company page script: render (split from index.html; see app/main.mjs for the order things start in)
import * as SIG from '/signals.mjs';
import { $, $$, BINS, chgOf, esc, fmtBig, fmtPct, fmtPrice, heatClass, logo, M, MARKETS, S, syncURL, TF, TOP_N } from './core.mjs';
import { squarify } from './treemap.mjs';
import { computeFor, match, P } from './data.mjs';
import { emo, pc, renderScorecard } from './scorecard.mjs';
import { showDetail } from './interact.mjs';
import { renderDxy } from './dxy.mjs';

/* ================= rendering ================= */
export const ICON = {
  up: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 11l5-6 5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5l5 6 5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
// window of the relative-strength comparison, as shown: 30 days (crypto, metals) or 21 business days ≈ a month (forex)
export const rsWindow = () => P().momDays === 30 ? '30d' : '1m';
export function rsHTML(ind) {
  if (ind.isBench) return `<span class="s">the benchmark</span>`;
  if (ind.rs == null) return '<span class="s">n/a</span>';
  const cls = ind.rsState === 'up' ? 'up-t' : ind.rsState === 'down' ? 'dn-t' : '';
  const tag = ind.rsState === 'up' ? `<span class="tag rs-up">beating ${esc(M.benchLabel)}</span>` : ind.rsState === 'down' ? `<span class="tag rs-dn">trailing ${esc(M.benchLabel)}</span>` : `<span class="s">vs ${esc(M.benchLabel)}</span>`;
  return `${tag}<span class="v ${cls}">${fmtPct(ind.rs, 1)}</span><span class="s">${rsWindow()}</span>`;
}
export function volHTML(ind) {
  const v = ind.vol;
  if (!v) return '<span class="s">n/a</span>';
  const ratio = `${v.ratio.toFixed(1)}×`;
  if (v.state === 'up') return `${ICON.up}<span class="tag vol-up" title="Volume over the last ${P().volShort} days is ${ratio} the ${P().volLong} days before, while price rose: buyers piling in">${ratio} on a climb</span>`;
  if (v.state === 'down') return `${ICON.down}<span class="tag vol-dn" title="Volume over the last ${P().volShort} days is ${ratio} the ${P().volLong} days before, while price fell: selling pressure">${ratio} on a drop</span>`;
  return `<span class="v">${ratio}</span><span class="s">usual volume</span>`;
}

export function indHTML(ind) {
  if (!ind) return '<div class="loading">Loading candles…</div>';
  if (ind.error) return `<div class="err">${ind.later ? 'Data source paused, retrying at next update' : 'No daily history available'}</div>`;
  const rows = [];
  // RSI
  if (ind.rsiNow != null) {
    const tag = ind.rsiState === 'os' ? '<span class="tag os">Oversold</span>' : ind.rsiState === 'ob' ? '<span class="tag ob">Overbought</span>' : '';
    rows.push(`<div class="row"><span class="k">RSI</span><span class="v">${ind.rsiNow.toFixed(0)}</span><span class="gauge" aria-hidden="true"><i style="left:${ind.rsiNow.toFixed(1)}%"></i></span>${tag}</div>`);
  } else rows.push('<div class="row"><span class="k">RSI</span><span class="s">n/a</span></div>');
  // Trend
  if (ind.trend) {
    const up = ind.trend === 'up';
    const note = ind.cross ? `✦ ${ind.cross.type} ${ind.cross.ago}d` : up ? (ind.strong ? 'strong' : 'pullback') : (ind.strong ? 'strong' : 'bounce');
    rows.push(`<div class="row"><span class="k">MA</span><span class="${up ? 'up-t' : 'dn-t'}" style="display:inline-flex;align-items:center;gap:3px">${up ? ICON.up : ICON.down}<span class="v">${up ? 'Up' : 'Down'}<span class="tw">trend</span></span></span><span class="s">${note}</span></div>`);
  } else {
    rows.push(`<div class="row"><span class="k">MA</span><span class="s">${ind.partial ? (ind.partial === 'above' ? `Above ${P().maFast}MA · ` : `Below ${P().maFast}MA · `) : ''}${P().maSlow}MA n/a</span></div>`);
  }
  // Relative strength: the move over the momentum window vs the benchmark's (Bitcoin / the basket / gold)
  rows.push(`<div class="row"><span class="k">RS</span>${rsHTML(ind)}</div>`);
  // Volume surge (crypto): recent volume vs before, and which way price went on it
  if (M.volume) rows.push(`<div class="row"><span class="k">VOL</span>${volHTML(ind)}</div>`);
  // Recommended stop-loss for long and short positions
  const st = ind.stop;
  if (st) {
    const past = side => side === 'long' ? 'below' : 'above';
    const cell = (side, pct, state) =>
      state === 'closed' ? `<span class="tag stop-x" title="The last daily close finished ${past(side)} the recommended ${side} stop: suggested exit for ${side} positions">🛑 closed ${past(side)} ${side} stop</span>`
      : state === 'intraday' ? `<span class="tag stop-i" title="Price is ${past(side)} today's recommended ${side} stop, not yet confirmed by a daily close: watch">⚠ ${past(side)} ${side} stop intraday</span>`
      : `<span class="sl ${state === 'near' ? 'near' : ''}" title="Recommended stop for ${side} positions${state === 'near' ? ': price is close to it' : ''}">${state === 'near' ? '⚠️ ' : ''}${side === 'long' ? 'L' : 'S'} ${fmtPct(pct, 1)}</span>`;
    const alert = ['closed', 'intraday'].map(s => st.longState === s ? cell('long', st.longPct, s) : st.shortState === s ? cell('short', st.shortPct, s) : '').find(Boolean);
    rows.push(`<div class="row"><span class="k">STOP</span>${alert || `${cell('long', st.longPct, st.longState)}<span class="s">·</span>${cell('short', st.shortPct, st.shortState)}`}</div>`);
  } else rows.push('<div class="row"><span class="k">STOP</span><span class="s">n/a</span></div>');
  return rows.join('');
}

// 🚀 per signal the tuner rates bullish, 😢 per signal it rates bearish (see Scorecard)
export function signals(ind) {
  if (!ind || ind.error || !ind.sig) return { good: [], bad: [] };
  return { good: ind.sig.good.map(k => SIG.COMPONENTS[k]), bad: ind.sig.bad.map(k => SIG.COMPONENTS[k]) };
}
export const roleOf = k => { const w = P().weights[k] || 0; return w > 0 ? '🚀' : w < 0 ? '😢' : 'off'; };
export function legendName(k) {
  const p = P();
  return {
    trendUp: `strong uptrend (${p.maFast}/${p.maSlow} MA)`, trendDown: `strong downtrend (${p.maFast}/${p.maSlow} MA)`,
    oversold: `RSI(${p.rsiPeriod}) under ${p.rsiLow}`, overbought: `RSI(${p.rsiPeriod}) over ${p.rsiHigh}`,
    rsUp: `${rsWindow()} move beats ${M.benchLabel} by ${p.rsPct}%+`, rsDown: `${rsWindow()} move trails ${M.benchLabel} by ${p.rsPct}%+`,
    volUp: `rising on ${p.volRatio}×+ usual volume (${p.volShort}d vs ${p.volLong}d)`, volDown: `falling on ${p.volRatio}×+ usual volume (${p.volShort}d vs ${p.volLong}d)`,
    momUp: `${p.momDays === 30 ? '30-day' : `${p.momDays}-business-day`} move above +${p.momPct}%`, momDown: `${p.momDays === 30 ? '30-day' : `${p.momDays}-business-day`} move below −${p.momPct}%`,
    pnfUp: `point & figure rising (X column)`, pnfDown: `point & figure falling (O column)`,
  }[k];
}
// Apply signal settings everywhere they show (RSI gauge zones, labels) and recompute every tile
export function applyParams(p) {
  const next = SIG.withDefaults(p);
  const changed = JSON.stringify(next) !== JSON.stringify(S.params);
  S.params = next;
  document.documentElement.style.setProperty('--rsi-lo', next.rsiLow + '%');
  document.documentElement.style.setProperty('--rsi-hi', next.rsiHigh + '%');
  if (changed) for (const c of S.coins) if (S.hist[c.id]) S.ind[c.id] = computeFor(c);
  return changed;
}
// Next to the name: the 50/200 MA trend (🚀 / 😢), the point & figure trend (X📈 / O📉) and 30-day momentum (🔥 / 🧊).
// RSI and Bollinger width stay in the tile rows and the chart, not as emoji. All three are what the Scorecard judges:
// X📈 / O📉 and 🔥 / 🧊 count as 🚀 / 😢 calls in their current role, and disappear if the tuner switches them off.
export const NAME_SIGNALS = SIG.SCORED;
export const MOM_EMO = { momUp: '🔥', momDown: '🧊' };
export const LEGEND_EMO = { ...MOM_EMO, pnfUp: '<b>X</b>📈', pnfDown: '<b>O</b>📉' };
export const call = k => roleOf(k) === '🚀' ? '🚀 call' : '😢 call';
export function emojiHTML(ind) {
  const fired = [...(ind?.sig?.good || []), ...(ind?.sig?.bad || [])].filter(k => NAME_SIGNALS.includes(k));
  const trend = fired.filter(k => k.startsWith('trend')), mom = fired.filter(k => MOM_EMO[k]);
  const trendTitle = trend.map(k => `${roleOf(k)} ${SIG.COMPONENTS[k]}`).join(' · ');
  const trendHTML = trend.length ? `<span class="emo" data-k="${trend[0]}" title="${esc(trendTitle)}" aria-label="${esc(trendTitle)}">${trend.map(roleOf).join('')}</span>` : '';
  const m30 = ind?.chg?.['30d'];
  const momHTML = mom.map(k => {
    const t = `${MOM_EMO[k]} ${SIG.COMPONENTS[k]}${m30 != null ? ` (${fmtPct(m30, 1)} in ${M.days(P().momDays)})` : ''}: counts as a ${call(k)}`;
    return `<span class="emo mom" data-k="${k}" title="${esc(t)}" aria-label="${esc(t)}">${MOM_EMO[k]}</span>`;
  }).join('');
  return trendHTML + pnfMark(ind) + momHTML;
}
// X📈 / O📉: the latest point & figure column is rising (X) or falling (O). Scored like the others (see above).
export const PNF_EMO = { X: '<b>X</b>📈', O: '<b>O</b>📉' };
export function pnfMark(ind) {
  const f = ind?.pnf, k = f?.dir === 'X' ? 'pnfUp' : 'pnfDown';
  if (!f || roleOf(k) === 'off') return '';
  const s = f.signal;
  const title = `Point & figure: ${f.dir === 'X' ? 'rising (X)' : 'falling (O)'} column, ${f.boxes} boxes since ${new Date(ind.t[f.since]).toISOString().slice(0, 10)}: counts as a ${call(k)}. `
    + `Next ${f.dir} at a close ${f.dir === 'X' ? 'above' : 'below'} ${fmtPrice(f.next)}; flips to ${f.dir === 'X' ? 'O below' : 'X above'} ${fmtPrice(f.reverse)}.`
    + (s ? ` Latest signal: ${s.type === 'buy' ? 'double-top buy' : 'double-bottom sell'}.` : '');
  return `<span class="pnf-mark pnf-${f.dir}" data-k="${k}" title="${esc(title)}" aria-label="${esc(title)}">${PNF_EMO[f.dir]}</span>`;
}

// ✓ = price history comes from a trading pair confirmed by the coin's CoinGecko ID; ? = matched by ticker only
export function verifyMark(c) {
  const h = S.hist[c.id];
  return h ? M.verify(c, h) : '';
}
// ⚠ on a tile: the rate source can't be trusted (warn), or the price made an unusual jump lately (spike, see
// findSpikes in scripts/build-forex.mjs)
export const cautionNotes = c => [
  c.warn && 'Official and market rates differ a lot for this currency',
  c.check && !c.check.ok && `The two price sources (exchange-api, Swissquote) disagree by ${Math.abs(c.check.diff)}% on ${c.check.day}: check another source`,
  c.spike && `Unusual jump of ${fmtPct(c.spike.pct, 1)} on ${c.spike.date}${c.src === 'x' ? ': a data glitch or a real devaluation, so check another source. Days around it are left out of the scorecard' : ': an official ECB rate, so a real market move'}`,
].filter(Boolean);
export function cautionMark(c) {
  const notes = cautionNotes(c);
  return notes.length ? `<span class="rk caution" title="${esc(notes.join('. '))}" aria-label="caution: ${esc(notes.join('. '))}">⚠</span>` : '';
}

// A price that changed since the last refresh: the tile blinks once in its direction (kept for 1.5 s, since a tile
// can be redrawn a moment later when its candles arrive)
const LAST_PX = new Map();
function flashCls(c) {
  const p = LAST_PX.get(c.id), now = Date.now();
  if (!p) { LAST_PX.set(c.id, { px: c.current_price, at: 0, dir: "" }); return ""; }
  if (c.current_price > 0 && p.px !== c.current_price) Object.assign(p, { dir: c.current_price > p.px ? "up" : "down", at: now, px: c.current_price });
  return now - p.at < 1500 ? ` flash-${p.dir}` : "";
}
// The last week as a small line under the price on heatmap tiles (8 daily closes; 6 trading days on forex, energy and
// ETFs), drawn in the tile's own ink, so a red day in a strong rally reads differently from one in a slide
export function weekLine(ind) {
  const c = ind?.c, n = (M.back['7d'] || 7) + 1;
  if (!c || c.length < n) return '';
  const v = c.slice(-n), lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => `${(i / (n - 1) * 100).toFixed(1)},${(18 - (x - lo) / span * 16).toFixed(1)}`).join(' ');
  return `<svg class="spk" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
export function tileHTML(c) {
  const ind = S.ind[c.id], ch = chgOf(c, S.colorBy);
  const sg = signals(ind);
  const label = `${c.name}, ${fmtPrice(c.current_price)}, ${TF(S.colorBy)} ${fmtPct(ch)}, ${sg.good.length} rockets, ${sg.bad.length} cry faces`;
  const stopCls = !ind?.stop ? '' : [ind.stop.longState, ind.stop.shortState].includes('closed') ? ' stop-closed' : [ind.stop.longState, ind.stop.shortState].includes('intraday') ? ' stop-intraday' : '';
  return `<button class="tile ${heatClass(ch, S.colorBy)}${stopCls}${flashCls(c)}" data-id="${esc(c.id)}" aria-label="${esc(label)}">
    <div class="top">
      <div class="sym">${logo(c, 18)}<span>${esc(c.symbol.toUpperCase())}</span>${verifyMark(c)}${cautionMark(c)}${M.ranked ? `<span class="rk">#${c.market_cap_rank}</span>` : ''}</div>
      <div class="chg">${fmtPct(ch, ch != null && Math.abs(ch) >= 10 ? 1 : 2)}</div>
      <div class="name"><span class="nm">${esc(c.name)}</span>${emojiHTML(ind)}</div>
      <div class="px">${fmtPrice(c.current_price)}</div>
      ${weekLine(ind)}
    </div>
    <div class="ind">${indHTML(ind)}</div>
    <span class="ti" aria-hidden="true" title="Open the chart card now">ⓘ</span>
  </button>`;
}

// The signals' own track record, where people look: last 90 days, next-day moves, from the daily scorecard.
// Until it shows a real edge (t ≥ 2), the 🚀/😢 are dimmed so they don't look more certain than they are.
export function signalEdge() {
  const w = S.scorecard?.windows?.d90;
  const s = w && (w[1] || (w.byScore ? w : null));
  if (!s?.ic || s.ic.mean == null) return null;
  return { proven: s.ic.t >= 2, backwards: s.ic.t <= -2, rocketsUp: s.rockets?.upRate, baseUp: s.all?.upRate, sadDown: s.sad?.downRate };
}
// Short version for the one-line legend: a badge that jumps to the Scorecard
export function edgeBadge() {
  const e = signalEdge();
  if (!e) return '';
  const word = e.proven ? 'a real edge' : e.backwards ? 'backwards lately' : 'no proven edge yet';
  return `<a href="#" class="edge-badge ${e.proven ? 'ok' : 'weak'}" data-goto-score title="Track record, last 90 days: 🚀 coins went up next day ${pc(e.rocketsUp)} of the time vs ${pc(e.baseUp)} for all coins. Open the Scorecard">🚀/😢: ${word} ›</a>`;
}
export function edgeLegend() {
  const e = signalEdge();
  if (!e) return '';
  const verdict = e.proven ? '<b>a real edge</b>' : e.backwards ? '<b>backwards</b> (😢 did better than 🚀)' : '<b>no reliable edge yet</b>, so treat them as hints, not calls';
  return `<span class="leg-item edge ${e.proven ? 'ok' : 'weak'}">Track record, last 90 days: 🚀 coins went up next day ${pc(e.rocketsUp)} of the time vs ${pc(e.baseUp)} for all coins. Verdict: ${verdict} <a href="#" data-goto-score>(Scorecard)</a></span>`;
}
export function applyEdge() {
  // each emoji's size follows its own record: full size once the Scorecard shows it works, small and grey until then
  S.proven = SIG.provenSignals(S.scorecard, P());
  for (const k of SIG.SCORED) document.body.classList.toggle(`proven-${k}`, S.proven.has(k));
}

export function renderLegend() {
  const t = BINS[S.colorBy];
  const cells = [
    ['h-4', `≤ −${t[3]}`], ['h-3', `−${t[2]}…${t[3]}`], ['h-2', `−${t[1]}…${t[2]}`], ['h-1', `−${t[0]}…${t[1]}`], ['h0', `±${t[0]}`],
    ['h1', `${t[0]}…${t[1]}`], ['h2', `${t[1]}…${t[2]}`], ['h3', `${t[2]}…${t[3]}`], ['h4', `≥ +${t[3]}`],
  ];
  $('#legendScale').innerHTML = `${TF(S.colorBy)} change % <span class="scale${S.heat ? ' picking' : ''}" role="group" aria-label="Show only ${M.noun} in this ${TF(S.colorBy)} range">${cells.map(([k, l]) =>
    `<button type="button" class="${k}" data-heat="${k}" aria-pressed="${S.heat === k}" title="Show only ${M.noun} with a ${TF(S.colorBy)} change of ${l}%">${l}</button>`).join('')}</span>`;
  $('#legendEdge').innerHTML = edgeBadge();
  // The one place that explains the page: what a tile shows, then the current rules and track record
  $('#legendMore').innerHTML = `
    <p class="leg-read"><b>What the emoji mean.</b> 🚀/😢, X📈/O📉 and 🔥/🧊 describe a ${M.one}'s <b>current conditions</b> (its trend, point &amp; figure column and momentum), <b>not predictions</b>. The <a href="#" data-goto-score>Scorecard</a> checks every day whether they would have predicted the next moves. <b>Size shows the record:</b> a mark is full size and in colour only once the Scorecard shows it works; small and grey means not proven, so read it as a quick summary of the chart, not as advice.</p>
    <p class="leg-read"><b>Reading a tile.</b> <b>RSI</b>: the marker shows where RSI sits on 0–100; below the lower line is <i>oversold</i>, above the upper line <i>overbought</i>.
      <b>MA</b>: the fast moving average above the slow one is an uptrend, below is a downtrend; "strong" means the price agrees, "pullback" or "bounce" that it doesn't; ✦ marks a golden or death cross in the last 14 days.
      <b>RS</b>: relative strength, the ${M.one}'s move over ${P().momDays === 30 ? 'the last 30 days' : 'about a month'} minus ${M.bench ? `${M.benchLabel}'s` : 'the average of every pair'} ("beating" / "trailing" past ±${P().rsPct}%).
      ${M.volume ? `<b>VOL</b>: the last ${P().volShort} days' volume vs the ${P().volLong} days before; ${P().volRatio}× or more while price climbs means buyers piling in, while it drops, selling pressure.` : ''}
      RS${M.volume ? ' and VOL' : ''} are on trial: the Scorecard tests them every night, but they don't count toward 🚀/😢 yet. The Bollinger Bands are drawn in the price chart.
      <b>✓ / ?</b>: how reliable the price source is (hover it). <b>⚠</b>: a caution about this ${M.one}'s data (hover it). <b>ⓘ</b>: point at it to open the chart card at once.</p>
    <span class="leg-item"><span class="gauge" style="width:60px;flex:none"><i style="left:50%"></i></span> RSI 0–100 (under ${P().rsiLow} oversold · over ${P().rsiHigh} overbought)</span>
    <span class="leg-item"><span class="up-t" style="display:inline-flex">${ICON.up}</span>/<span class="dn-t" style="display:inline-flex">${ICON.down}</span> ${P().maFast}MA vs ${P().maSlow}MA</span>
    <span class="leg-item"><b>STOP</b> = recommended stop-loss: <b>L</b> for long positions, <b>S</b> for short, ${P().stopMult}× the ${M.one}'s average daily move from the last ${M.closeWord}${M.live ? ' · ⚠ past it intraday = watch' : ''} · 🛑 a ${M.live ? 'daily close' : 'rate'} past it = suggested exit</span>
    ${edgeLegend()}
    ${['🚀', '😢'].map(e => {
      const ks = NAME_SIGNALS.filter(k => roleOf(k) === e);
      return ks.length ? `<span class="leg-item">${e} calls: ${ks.map(k => `${LEGEND_EMO[k] || e} ${legendName(k)}`).join(' · ')}</span>` : '';
    }).join('')}`;
}

// Highlight buttons filter the coins: non-matching ones are left out entirely ("All coins" brings them back)
export const FILTER_WORDS = { os: 'oversold', ob: 'overbought', up: 'in an uptrend', down: 'in a downtrend', rs: `beating ${M.benchLabel}`, vol: 'moving on a volume surge', cross: 'showing a recent moving-average cross', stop: 'past a recommended stop' };
// A range on the color scale (S.heat, e.g. 'h-3') narrows it further to coins in that color band
export const inHeat = c => !S.heat || heatClass(chgOf(c, S.colorBy), S.colorBy) === S.heat;
export const visibleCoins = () => S.coins.filter(c => (S.filter === 'all' || match(S.ind[c.id], S.filter)) && inHeat(c));
export const heatWords = () => { const b = $(`#legendScale [data-heat="${S.heat}"]`); return b ? `with a ${TF(S.colorBy)} change of ${b.textContent}%` : ''; };
export const emptyHTML = () => `<div class="empty">No ${M.noun} are ${[S.filter !== 'all' && (FILTER_WORDS[S.filter] || 'matching'), S.heat && heatWords()].filter(Boolean).join(' and ') || 'matching'} right now. <button class="btn" data-show-all>Show all ${M.noun}</button></div>`;

// "avg +0.4% · 7 of 11 up" on a group heading (ETFs)
export function groupAvg(g) {
  const v = g.map(c => chgOf(c, S.colorBy)).filter(x => x != null && isFinite(x));
  if (!v.length) return '';
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  return `<span class="tg-sum">avg <b class="tg-avg ${heatClass(avg, S.colorBy)}">${fmtPct(avg)}</b> · ${v.filter(x => x > 0).length} of ${v.length} up</span>`;
}

/* ---------- the headline above the tiles ---------- */
// The typical move (weighted by market cap on the crypto page; elsewhere the median, so one devaluation or one wild
// fund can't drag it), how many rose and fell with a bar of the split, and the biggest gain and drop (a click opens its
// chart card). It describes what's shown, so a filter narrows it too.
export function summaryOf(list, tf = S.colorBy) {
  const rows = list.map(c => ({ c, v: chgOf(c, tf) })).filter(r => r.v != null && isFinite(r.v));
  if (!rows.length) return null;
  const weighted = M.sizeBy === 'cap' && rows.some(r => r.c.market_cap > 0);
  const w = r => r.c.market_cap > 0 ? r.c.market_cap : 0;
  const vs = rows.map(r => r.v).sort((a, b) => a - b), mid = vs.length >> 1;
  const avg = weighted ? rows.reduce((a, r) => a + r.v * w(r), 0) / rows.reduce((a, r) => a + w(r), 0)
    : vs.length % 2 ? vs[mid] : (vs[mid - 1] + vs[mid]) / 2;
  const best = rows.reduce((a, r) => r.v > a.v ? r : a), worst = rows.reduce((a, r) => r.v < a.v ? r : a);
  return { n: rows.length, avg, weighted, up: rows.filter(r => r.v > 0).length, down: rows.filter(r => r.v < 0).length, best, worst };
}
export function renderSummary() {
  const el = $('#summary');
  const sm = S.view === 'score' ? null : summaryOf(visibleCoins());
  el.hidden = !sm;
  if (!sm) return;
  const tf = TF(S.colorBy), all = S.filter === 'all' && !S.heat;
  const x = (r, word) => `<button type="button" class="sum-x" data-id="${esc(r.c.id)}" data-coin="1" title="Open ${esc(r.c.name)}">${word} <b>${esc(M.grouped && r.c.name ? r.c.name : r.c.symbol.toUpperCase())}</b> <span class="cell-heat ${heatClass(r.v, S.colorBy)}">${fmtPct(r.v, Math.abs(r.v) >= 10 ? 1 : 2)}</span></button>`;
  const note = M.upNote?.(S.quote);
  el.innerHTML = `<span class="sum-avg">${all ? esc(M.sumLabel(sm.n)) : `${sm.n} ${esc(M.noun)} shown`}, ${esc(tf)} <b class="${heatClass(sm.avg, S.colorBy)}" title="${sm.weighted ? 'Average move, weighted by market cap' : 'Median move: half moved more, half less'}">${fmtPct(sm.avg)}</b><span class="sum-note">${sm.weighted ? 'weighted by market cap' : 'median'}</span></span>
    <span class="sum-split" title="${sm.up} up, ${sm.down} down${note ? ` (${esc(note)})` : ''}"><span class="sum-up">▲ ${sm.up}</span><span class="sum-bar" aria-hidden="true"><i class="h2" style="width:${(sm.up / sm.n * 100).toFixed(1)}%"></i><i class="h0" style="width:${((sm.n - sm.up - sm.down) / sm.n * 100).toFixed(1)}%"></i><i class="h-2" style="width:${(sm.down / sm.n * 100).toFixed(1)}%"></i></span><span class="sum-dn">▼ ${sm.down}</span></span>
    ${sm.n > 1 ? x(sm.best, 'Best') + x(sm.worst, 'Worst') : ''}${note ? `<span class="sum-note">${esc(note)}</span>` : ''}`;
}
// ⚙ View on phones: a badge with how many settings differ from the default view
export function renderCtlSum() {
  const n = [S.filter !== 'all', !!S.heat, S.colorBy !== '24h', S.view !== 'grid', S.density !== 'heatmap', M.quoteSwitch && S.quote === 'usd'].filter(Boolean).length;
  $('#ctlSum').textContent = n ? String(n) : '';
}

/* ---------- each market's headline figure on the market switch (pulse.json, built at deploy) ---------- */
export function renderXM(p) {
  for (const a of $$('#market a[data-m]')) {
    const k = a.dataset.m, h = p?.xm?.[k], mk = MARKETS[k];
    a.querySelector('.mk-x')?.remove();
    if (!h || !mk?.xm) continue;
    const bins = Object.values(mk.bins)[0], v = h.bp ?? h.chg;
    const lvl = v == null ? 0 : [0, 1, 2, 3].filter(i => Math.abs(v) >= bins[i]).length;
    const cls = !lvl ? 'h0' : (v > 0 ? 'h' : 'h-') + lvl;
    const txt = h.bp != null ? `${h.bp > 0 ? '+' : h.bp < 0 ? '−' : '±'}${Math.abs(h.bp)}bp` : fmtPct(h.chg, 1);
    const val = h.unit === '%' ? `${h.price.toFixed(2)}%` : h.unit.startsWith('USD') ? '$' + h.price.toLocaleString('en-US', { maximumFractionDigits: h.price >= 1000 ? 0 : 2 }) : h.price.toLocaleString('en-US', { maximumFractionDigits: 2 });
    a.insertAdjacentHTML('beforeend', `<span class="mk-x ${cls}" title="${esc(`${h.label} ${val}, ${txt} on the day`)}">${esc(txt)}</span>`);
  }
}

/* ---------- Map view: each tile's area follows its size ---------- */
// Crypto: market cap; ETFs: dollars traded a day (20-day average). The area is the square root of the size, so the
// smaller ones stay readable next to Bitcoin or SPY (it still orders them by size); ETFs sit in a block per group.
export function sizeOf(c) {
  if (M.sizeBy === 'cap') return c.market_cap > 0 ? c.market_cap : 0;
  if (M.sizeBy === 'dollarVol') {
    const v = S.hist[c.id]?.vols?.filter(x => x > 0).slice(-20);
    return v?.length ? v.reduce((a, b) => a + b, 0) / v.length * c.current_price : 0;
  }
  return 1;
}
function mapTile(c, r) {
  const ch = chgOf(c, S.colorBy), side = Math.min(r.w, r.h), fs = Math.max(9, Math.min(30, Math.sqrt(r.w * r.h) / 4.2));
  const ind = S.ind[c.id], stop = ind?.stop && [ind.stop.longState, ind.stop.shortState].includes('closed') ? ' stop-closed' : '';
  const label = `${c.name}, ${fmtPrice(c.current_price)}, ${TF(S.colorBy)} ${fmtPct(ch)}`;
  const inner = side < 18 ? '' : `<span class="mt-s">${esc(c.symbol.toUpperCase())}</span>${side >= 34 ? `<span class="mt-c">${fmtPct(ch, ch != null && Math.abs(ch) >= 10 ? 1 : 2)}</span>` : ''}${M.grouped && side >= 58 && r.w >= 80 ? `<span class="mt-n">${esc(c.name)}</span>` : ''}`;
  return `<button class="tile mt ${heatClass(ch, S.colorBy)}${stop}" data-id="${esc(c.id)}" aria-label="${esc(label)}" title="${esc(label)}" style="left:${r.x.toFixed(1)}px;top:${r.y.toFixed(1)}px;width:${Math.max(0, r.w - 2).toFixed(1)}px;height:${Math.max(0, r.h - 2).toFixed(1)}px;font-size:${fs.toFixed(1)}px">${inner}</button>`;
}
export function renderMap(list) {
  const grid = $('#grid'), W = grid.clientWidth, H = grid.clientHeight;
  const item = c => ({ c, v: Math.sqrt(sizeOf(c)) || 0 });
  const groups = M.grouped && S.groups
    ? S.groups.map(([k, label]) => ({ label, xs: list.filter(c => c.group === k).map(item) })).filter(g => g.xs.length)
    : [{ label: '', xs: list.map(item) }];
  for (const g of groups) { const min = Math.max(...g.xs.map(i => i.v)) * 0.02 || 1; for (const i of g.xs) i.v = Math.max(i.v, min); g.v = g.xs.reduce((a, i) => a + i.v, 0); }
  let html = '';
  for (const b of squarify(groups, 0, 0, W, H)) {
    const head = b.label ? 16 : 0;
    if (b.label) html += `<div class="mgrp" style="left:${b.x.toFixed(1)}px;top:${b.y.toFixed(1)}px;width:${(b.w - 2).toFixed(1)}px;height:${(b.h - 2).toFixed(1)}px"><span class="mgrp-h">${esc(b.label)}${groupAvg(b.xs.map(i => i.c)).replace('tg-sum', 'tg-sum r-muted')}</span></div>`;
    for (const r of squarify(b.xs, b.x + (b.label ? 2 : 0), b.y + head, b.w - (b.label ? 4 : 0), b.h - head - (b.label ? 2 : 0))) html += mapTile(r.c, r);
  }
  grid.innerHTML = html;
  $('#mapNote')?.remove();
  grid.insertAdjacentHTML('afterend', `<p class="map-note" id="mapNote">Area: ${M.sizeBy === 'cap' ? 'market cap' : 'dollars traded a day (20-day average)'}, on a square-root scale so smaller ones stay readable. Colour: the ${esc(TF(S.colorBy))} change. Hover or tap a tile for its chart card.</p>`);
}

export function renderGrid() {
  const list = visibleCoins();
  if (S.view === 'map') { if (!list.length) { $('#grid').innerHTML = emptyHTML(); return; } renderMap(list); return; }
  $('#mapNote')?.remove();
  if (!list.length) { $('#grid').innerHTML = emptyHTML(); return; }
  // ETFs: a heading per group (US market, sectors, themes, abroad), each with the tiles that are showing
  $('#grid').innerHTML = M.grouped && S.groups ? S.groups.map(([k, label]) => {
    const g = list.filter(c => c.group === k);
    return g.length ? `<h2 class="tgroup" data-g="${esc(k)}">${esc(label)} <span>${g.length}</span>${groupAvg(g)}</h2>${g.map(tileHTML).join('')}` : '';
  }).join('') : list.map(tileHTML).join('');
}

export function updateCoin(c) {
  const el = $(`.tile[data-id="${CSS.escape(c.id)}"]`);
  // with a filter on, a coin can start or stop matching when its numbers update: redraw the grid
  if (S.filter !== 'all' && S.view === 'grid' && !!el !== match(S.ind[c.id], S.filter)) { scheduleGrid(); return; }
  if (S.view === 'map') { scheduleGrid(); return; }        // a map tile's place depends on the others: redraw the map
  if (el) {
    const tmp = document.createElement('div');
    tmp.innerHTML = tileHTML(c);
    el.replaceWith(tmp.firstElementChild);
  }
  scheduleSide();
}
export let gridQueued = false;
export function scheduleGrid() {
  if (gridQueued) return;
  gridQueued = true;
  requestAnimationFrame(() => { gridQueued = false; renderGrid(); scheduleSide(); });
}
export let sideQueued = false;
export function scheduleSide() {
  if (sideQueued) return;
  sideQueued = true;
  requestAnimationFrame(() => { sideQueued = false; renderCounts(); renderSummary(); if (S.view === 'table') renderTable(); if (S.pinned) showDetail(S.pinned, null, true); });
}

export function renderCounts() {
  for (const b of $$('#filters .chip[data-f]')) {
    const f = b.dataset.f;
    if (f === 'all') continue;
    b.querySelector('.n').textContent = S.coins.filter(c => match(S.ind[c.id], f)).length;
  }
}

// "−3.1% ($82,190)" for a recommended stop; "🛑 closed past" once a daily close confirms it, "⚠ intraday" before that
export function stopCell(st, side) {
  if (!st) return '—';
  const state = st[side + 'State'], pct = st[side + 'Pct'], price = st[side];
  if (state === 'closed') return `<b class="sc-warn">🛑 closed past</b> <span style="color:var(--ink-2)">${fmtPrice(price)}</span>`;
  if (state === 'intraday') return `⚠ past intraday <span style="color:var(--ink-2)">${fmtPrice(price)}</span>`;
  return `${state === 'near' ? '⚠️ ' : ''}${fmtPct(pct, 1)} <span style="color:var(--ink-2)">${fmtPrice(price)}</span>`;
}

export const COLS = [
  ['rank', '#', c => c.market_cap_rank],
  ['name', M.nameCol, c => c.name.toLowerCase()],
  ['sig', 'Signals', c => { const s = signals(S.ind[c.id]); return s.good.length - s.bad.length; }],
  ['price', 'Price', c => c.current_price],
  ['24h', TF('24h'), c => chgOf(c, '24h')],
  ['7d', TF('7d'), c => chgOf(c, '7d')],
  ['30d', TF('30d'), c => chgOf(c, '30d')],
  ...(M.ranked ? [['mcap', 'Mkt cap', c => c.market_cap]] : []),   // currencies have no market cap
  ['rsi', 'RSI', c => S.ind[c.id]?.rsiNow],
  ['trend', 'Trend', c => { const i = S.ind[c.id]; return i?.trend ? (i.trend === 'up' ? 2 : 0) + (i.strong ? (i.trend === 'up' ? 1 : -0.5) : 0) : null; }],
  ['dF', 'vs fast MA', c => { const i = S.ind[c.id]; return i?.mF ? (i.last / i.mF - 1) * 100 : null; }],
  ['dS', 'vs slow MA', c => { const i = S.ind[c.id]; return i?.mS ? (i.last / i.mS - 1) * 100 : null; }],
  ['rs', `vs ${M.benchLabel}`, c => S.ind[c.id]?.rs],
  ...(M.volume ? [['vol', 'Volume ×', c => S.ind[c.id]?.vol?.ratio]] : []),
  ['stopL', 'Recommended stop (long)', c => S.ind[c.id]?.stop?.longPct],
  ['stopS', 'Recommended stop (short)', c => S.ind[c.id]?.stop?.shortPct],
];
export function renderTable() {
  const col = COLS.find(x => x[0] === S.sort.key) || COLS[0];
  const rows = visibleCoins().sort((a, b) => {
    const x = col[2](a), y = col[2](b);
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * S.sort.dir;
  });
  const head = COLS.map(([k, l]) => `<th scope="col"><button data-k="${k}"${S.sort.key === k ? ` data-dir="${S.sort.dir > 0 ? '▲' : '▼'}"` : ''}>${l}</button></th>`).join('');
  const body = rows.map(c => {
    const i = S.ind[c.id] || {};
    const heat = tf => `<span class="cell-heat ${heatClass(chgOf(c, tf), tf)}">${fmtPct(chgOf(c, tf))}</span>`;
    const rsi = i.rsiNow != null ? `${i.rsiNow.toFixed(0)}${i.rsiState === 'os' ? ' · Oversold' : i.rsiState === 'ob' ? ' · Overbought' : ''}` : '—';
    const trend = i.trend ? `<span class="${i.trend === 'up' ? 'up-t' : 'dn-t'}">${i.trend === 'up' ? '▲ Up' : '▼ Down'}</span>${i.cross ? ' ✦' : ''}` : '—';
    const rs = i.isBench ? 'benchmark' : i.rs != null ? `<span class="${i.rsState === 'up' ? 'up-t' : i.rsState === 'down' ? 'dn-t' : ''}">${fmtPct(i.rs, 1)}</span>` : '—';
    const vol = i.vol ? `${i.vol.ratio.toFixed(1)}×${i.vol.state === 'up' ? ' ▲ climb' : i.vol.state === 'down' ? ' ▼ drop' : ''}` : '—';
    return `<tr data-id="${esc(c.id)}"><td>${c.market_cap_rank}</td><td><b>${esc(c.symbol.toUpperCase())}</b> <span style="color:var(--ink-2)">${esc(c.name)}</span></td><td style="text-align:left">${emojiHTML(S.ind[c.id]) || ''}</td>
      <td>${fmtPrice(c.current_price)}</td><td>${heat('24h')}</td><td>${heat('7d')}</td><td>${heat('30d')}</td>${M.ranked ? `<td>${fmtBig(c.market_cap)}</td>` : ''}
      <td>${rsi}</td><td>${trend}</td><td>${fmtPct(i.mF ? (i.last / i.mF - 1) * 100 : null, 1)}</td><td>${fmtPct(i.mS ? (i.last / i.mS - 1) * 100 : null, 1)}</td>
      <td>${rs}</td>${M.volume ? `<td>${vol}</td>` : ''}
      <td>${stopCell(i.stop, 'long')}</td><td>${stopCell(i.stop, 'short')}</td></tr>`;
  }).join('');
  $('#tablewrap').innerHTML = `<table><caption class="sr">${M.tableCaption(TOP_N)} with indicators</caption><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${COLS.length}" style="text-align:left">${emptyHTML()}</td></tr>`}</tbody></table>`;
}

export function renderFooter() {
  const src = {};
  for (const c of S.coins) { const h = S.hist[c.id]; if (h) src[h.src] = (src[h.src] || 0) + 1; }
  const parts = Object.entries(src).map(([k, v]) => `${v} from ${k}`);
  const withHist = S.coins.filter(c => S.hist[c.id]), ok = withHist.filter(c => S.hist[c.id].ok).length;
  $('#srcinfo').textContent = M.srcInfo({ marketSrc: S.marketSrc, stale: S.stale, parts, ok, total: withHist.length });
  const ex = $('#excluded');
  ex.hidden = S.pegged || !S.excluded.length;
  ex.querySelector('summary').textContent = `Excluded ${S.excluded.length} ${M.pegWords} (tick "${M.pegLabel}" to show them)`;
  ex.querySelector('div').textContent = S.excluded.slice(0, 60).map(M.excludedName).join(', ');
}

export function renderAll() {
  renderLegend();
  $('#grid').hidden = S.view !== 'grid' && S.view !== 'map';
  $('#grid').classList.toggle('map', S.view === 'map');
  if (S.view !== 'map') $('#mapNote')?.remove();
  $('#tablewrap').hidden = S.view !== 'table';
  $('#scorewrap').hidden = S.view !== 'score';
  $('#grid').classList.toggle('heatmap', S.density === 'heatmap' && S.view !== 'map');   // heatmap tiles: colour, symbol, change, price
  $('#grid').classList.toggle('named', !!M.grouped);                  // ETFs: tickers say little, so heatmap tiles keep the short name
  $('#density').hidden = S.view !== 'grid';
  if (S.view === 'grid' || S.view === 'map') renderGrid(); else if (S.view === 'table') renderTable(); else renderScorecard();
  renderSummary();
  renderCtlSum();
  if (M.key === 'forex') renderDxy();         // the US Dollar Index bar above the grid
  renderCounts();
  renderFooter();
  syncURL();                                  // the address bar always shares what's on screen
}


// Footer: which data sources are working (health.json, made by scripts/health.mjs in every deploy). Hover for details.
const HEALTH_MARK = { ok: '✓', warn: '⚠', down: '✕' };
export function renderHealth(h) {
  const el = $('#health');
  if (!h?.sources?.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = 'Sources: ' + h.sources.map(s => `<span class="hs hs-${esc(s.state)}" data-src="${esc(s.key)}" title="${esc(`${s.name}: ${s.what}. ${s.note}`)}">${esc(s.name)} ${HEALTH_MARK[s.state] || '?'}</span>`).join(' · ');
}
