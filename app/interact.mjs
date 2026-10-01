// heat.sala.company page script: interact (split from index.html; see app/main.mjs for the order things start in)
import * as SIG from '/signals.mjs';
import { applyHist, match, P, pickCoins } from './data.mjs';
import { renderScorecard } from './scorecard.mjs';
import { $, $$, chgOf, DAY, esc, fmtBig, fmtPct, fmtPrice, logo, M, MARKET, prefs, S, savePrefs, store, TF } from './core.mjs';
import { done, run, show } from './main.mjs';
import { BB_LABEL, renderAll, renderTable, signals } from './render.mjs';

/* ================= detail popover ================= */
export function linePath(vals, x, y) {
  let d = '', pen = false;
  vals.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
    pen = true;
  });
  return d;
}
// [ Price | P&F ] switch above the popup chart (remembered)
export const chartSwitch = () => `<div class="seg d-switch" role="group" aria-label="Chart type">${[['price', 'Price'], ['pnf', 'P&F']].map(([v, l]) => `<button data-chart="${v}" aria-pressed="${S.chart === v}">${l}</button>`).join('')}</div>`;

// Point & figure: X = rising column, O = falling column, each box a fixed % move, 3-box reversal (signals.mjs)
export function pnfChart(ind) {
  const pfOff = Math.max(0, ind.c.length - SIG.PNF_WINDOW), pf = SIG.pointFigure(ind.c.slice(pfOff));
  if (pf.cols.length < 2) return '<p class="d-src">Not enough movement yet for a point & figure chart.</p>';
  // show the most recent columns, as many as fit in about 40 rows of boxes
  let cols = pf.cols.slice(-36);
  while (cols.length > 12 && Math.max(...cols.map(c => c.hi)) - Math.min(...cols.map(c => c.lo)) + 1 > 40) cols = cols.slice(1);
  const lo = Math.min(...cols.map(c => c.lo)), hi = Math.max(...cols.map(c => c.hi)), rows = hi - lo + 1;
  // Boxes stretch to fill the chart (capped at 14px) instead of staying square: square boxes squeezed a
  // 25-column × 40-row chart into a narrow strip of tiny marks.
  const W = 332, PAD_R = 50, PAD_T = 12, H = 212;
  const cw = Math.min(14, (W - PAD_R) / cols.length), ch = Math.min(14, (H - PAD_T) / rows);
  const x0 = W - PAD_R - cw * cols.length;                    // right-align: the latest column sits next to the price labels
  const xc = i => x0 + (i + 0.5) * cw, yc = j => H - (j - lo + 0.5) * ch;
  const day = i => new Date(ind.t[pfOff + i]).toISOString().slice(5, 10);
  const rx = cw * 0.34, ry = ch * 0.34, sw = Math.max(1.1, Math.min(cw, ch) * 0.14);
  const marks = cols.map((c, i) => {
    const boxes = [];
    for (let j = c.lo; j <= c.hi; j++) boxes.push(c.dir === 'X'
      ? `<path d="M${xc(i) - rx} ${yc(j) - ry}L${xc(i) + rx} ${yc(j) + ry}M${xc(i) + rx} ${yc(j) - ry}L${xc(i) - rx} ${yc(j) + ry}"/>`
      : `<ellipse cx="${xc(i)}" cy="${yc(j)}" rx="${rx}" ry="${ry}"/>`);
    const tip = `${c.dir === 'X' ? 'Rising (X)' : 'Falling (O)'}: ${fmtPrice(pf.price(c.lo))} → ${fmtPrice(pf.price(c.hi + 1))} · ${day(c.start)} to ${day(c.end)}${c.signal ? ` · ${c.signal.type === 'buy' ? 'double-top buy' : 'double-bottom sell'} at ${fmtPrice(pf.price(c.signal.box))}` : ''}`;
    const band = `<rect x="${x0 + i * cw}" y="${yc(c.hi) - ch / 2}" width="${cw}" height="${(c.hi - c.lo + 1) * ch}" fill="${i === cols.length - 1 ? 'var(--band)' : 'transparent'}"><title>${esc(tip)}</title></rect>`;
    const fs = Math.max(8, Math.min(11, cw * 0.9));
    const sig = c.signal ? `<text x="${xc(i)}" y="${c.signal.type === 'buy' ? yc(c.hi) - ch / 2 - 2 : yc(c.lo) + ch / 2 + fs}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${c.signal.type === 'buy' ? '#0077be' : '#b8413f'}" pointer-events="none">${c.signal.type === 'buy' ? 'B' : 'S'}</text>` : '';
    return `${band}<g stroke="${c.dir === 'X' ? '#0077be' : '#b8413f'}" stroke-width="${sw}" fill="none" stroke-linecap="round" pointer-events="none">${boxes.join('')}</g>${sig}`;
  }).join('');
  const every = Math.max(1, Math.ceil(rows / 7));
  const grid = [];
  for (let j = lo; j <= hi + 1; j += every) grid.push(`<line x1="${x0}" x2="${W - PAD_R}" y1="${yc(j) + ch / 2}" y2="${yc(j) + ch / 2}" stroke="var(--grid)"/><text x="${W - PAD_R + 6}" y="${yc(j) + ch / 2 + 3.5}" font-size="10" fill="var(--muted)">${fmtPrice(pf.price(j)).replace('$', '')}</text>`);
  const now = pf.now, s = pf.lastSignal;
  return `<div class="d-legend"><span><b style="color:#0077be">X</b> rising</span><span><b style="color:#b8413f">O</b> falling</span><span>box ${pf.boxPct}% · ${pf.reversal}-box reversal</span><span><b style="color:#0077be">B</b>/<b style="color:#b8413f">S</b> double-top buy / double-bottom sell</span></div>
    <div class="d-chart"><svg class="pnf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Point and figure chart, last ${cols.length} columns">${grid.join('')}${marks}</svg></div>
    <p class="d-src">Now in ${now.dir === 'X' ? 'a <b>rising (X)</b>' : 'a <b>falling (O)</b>'} column: the next ${now.dir} at a close ${now.dir === 'X' ? 'above' : 'below'} <b>${fmtPrice(now.next)}</b>; it flips to ${now.dir === 'X' ? 'O below' : 'X above'} <b>${fmtPrice(now.reverse)}</b>.${s ? ` Latest signal: <b>${s.type === 'buy' ? 'double-top buy' : 'double-bottom sell'}</b> at ${fmtPrice(pf.price(s.box))} (${day(s.day)}).` : ''} Built from daily closes; hover a column for details.</p>`;
}

export function detailChart(ind) {
  const N = Math.min(120, ind.n), s = ind.n - N;
  const W = 332, H = 130, PAD_L = 0, PAD_R = 44;
  const sl = a => a.slice(s);
  const c = sl(ind.c), m50 = sl(ind.maF), m200 = sl(ind.maS), up = sl(ind.bb.up), lo = sl(ind.bb.lo), rsi = sl(ind.rsi);
  const stp = ind.stop;
  const all = [...c, ...m50, ...m200, ...up, ...lo, ...(stp ? [stp.long, stp.short] : [])].filter(v => v != null);
  let min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.06 || max * 0.01; min -= pad; max += pad;
  const x = i => PAD_L + i / (N - 1) * (W - PAD_L - PAD_R);
  const y = v => H - (v - min) / (max - min) * H;
  // band polygon
  let band = '';
  const idx = [...Array(N).keys()].filter(i => up[i] != null);
  if (idx.length) band = 'M' + idx.map(i => `${x(i).toFixed(1)} ${y(up[i]).toFixed(1)}`).join('L') + 'L' + idx.reverse().map(i => `${x(i).toFixed(1)} ${y(lo[i]).toFixed(1)}`).join('L') + 'Z';
  const ticks = [max - pad, (max + min) / 2, min + pad];
  const priceSvg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price with moving averages and Bollinger Bands, last ${N} days">
    ${ticks.map(v => `<line x1="0" x2="${W - PAD_R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/><text x="${W - PAD_R + 6}" y="${y(v) + 3.5}" font-size="10" fill="var(--muted)">${fmtPrice(v).replace('$', '')}</text>`).join('')}
    <path d="${band}" fill="var(--band)"/>
    <path d="${linePath(m200, x, y)}" fill="none" stroke="var(--s-ma200)" stroke-width="2" stroke-linejoin="round"/>
    <path d="${linePath(m50, x, y)}" fill="none" stroke="var(--s-ma50)" stroke-width="2" stroke-linejoin="round"/>
    <path d="${linePath(c, x, y)}" fill="none" stroke="var(--s-price)" stroke-width="1.5" stroke-linejoin="round"/>
    ${stp ? [['long', stp.long, '#b8413f'], ['short', stp.short, '#0077be']].map(([k, v, col]) => `<line x1="${x(Math.max(0, N - 30))}" x2="${W - PAD_R}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-width="1.5"/><text x="${W - PAD_R + 6}" y="${y(v) + 3.5}" font-size="10" font-weight="700" fill="${col}">${k === 'long' ? 'L stop' : 'S stop'}</text>`).join('') : ''}
    <circle cx="${x(N - 1)}" cy="${y(c[N - 1])}" r="3.5" fill="var(--s-price)" stroke="var(--surface)" stroke-width="2"/>
  </svg>`;
  const RH = 46, ry = v => RH - v / 100 * RH;
  const rsiSvg = `<svg viewBox="0 0 ${W} ${RH}" role="img" aria-label="RSI 14, last ${N} days">
    <rect x="0" y="${ry(100)}" width="${W - PAD_R}" height="${ry(P().rsiHigh) - ry(100)}" fill="color-mix(in oklab, var(--orange) 12%, transparent)"/>
    <rect x="0" y="${ry(P().rsiLow)}" width="${W - PAD_R}" height="${ry(0) - ry(P().rsiLow)}" fill="color-mix(in oklab, var(--blue) 12%, transparent)"/>
    ${[P().rsiHigh, P().rsiLow].map(v => `<line x1="0" x2="${W - PAD_R}" y1="${ry(v)}" y2="${ry(v)}" stroke="var(--axis)" stroke-width="1"/><text x="${W - PAD_R + 6}" y="${ry(v) + 3.5}" font-size="10" fill="var(--muted)">${v}</text>`).join('')}
    <path d="${linePath(rsi, x, ry)}" fill="none" stroke="var(--s-price)" stroke-width="1.5" stroke-linejoin="round"/>
    ${rsi[N - 1] != null ? `<circle cx="${x(N - 1)}" cy="${ry(rsi[N - 1])}" r="3" fill="var(--s-price)" stroke="var(--surface)" stroke-width="2"/>` : ''}
  </svg>`;
  return `<div class="d-legend"><span><i style="background:var(--s-price)"></i>Price</span><span><i style="background:var(--s-ma50)"></i>${P().maFast}-day MA</span><span><i style="background:var(--s-ma200)"></i>${P().maSlow}-day MA</span><span><i class="band"></i>Bollinger (${P().bbPeriod}, ${P().bbK})</span>${ind.stop ? '<span><i style="background:#b8413f"></i>Stop (long)</span><span><i style="background:#0077be"></i>Stop (short)</span>' : ''}</div>
    <div class="d-chart">${priceSvg}<p class="ttl">RSI (14)</p>${rsiSvg}</div>`;
}

export function showDetail(id, anchor, keepPos) {
  S.hoverId = id;
  const c = S.coins.find(x => x.id === id);
  const box = $('#detail');
  if (!c) return hideDetail(true);
  const ind = S.ind[id], h = S.hist[id];
  let body = `<div class="d-head">${logo(c, 22)}<b>${esc(c.name)}</b><span style="color:var(--ink-2)">${esc(c.symbol.toUpperCase())}${c.fx ? '' : ` · #${c.market_cap_rank}`}</span></div>
    <div class="d-price">${fmtPrice(c.current_price)}</div>
    <div class="d-chg"><span>${TF('24h')} ${fmtPct(chgOf(c, '24h'))}</span><span>${TF('7d')} ${fmtPct(chgOf(c, '7d'))}</span><span>${TF('30d')} ${fmtPct(chgOf(c, '30d'))}</span>${c.fx ? '' : `<span>Cap ${fmtBig(c.market_cap)}</span>`}</div>
    ${c.warn ? `<div class="d-src">⚠ <b>${esc(c.name)}: the official rate and the street (market) rate differ a lot.</b> This rate comes from a community feed whose sources aren't documented, so it may not match what you'd actually get. It is left out of the scorecard.</div>` : ''}`;
  if (ind && !ind.error) {
    body += `<div class="d-cols"><div class="d-left">${chartSwitch()}${S.chart === 'pnf' ? pnfChart(ind) : detailChart(ind)}</div><div class="d-right">`;
    const trendTxt = ind.trend ? `${ind.trend === 'up' ? '▲ Uptrend' : '▼ Downtrend'} (${ind.strong ? 'price agrees' : ind.trend === 'up' ? `price below ${P().maFast}MA` : `price above ${P().maFast}MA`})` : `${P().maSlow}-day history not available yet`;
    body += `<dl class="kv">
      <dt>RSI (14)</dt><dd>${ind.rsiNow != null ? ind.rsiNow.toFixed(1) + (ind.rsiState === 'os' ? ' · Oversold' : ind.rsiState === 'ob' ? ' · Overbought' : ' · Neutral') : '—'}</dd>
      <dt>${P().maFast}-day MA</dt><dd>${fmtPrice(ind.mF)} (${fmtPct(ind.mF ? (ind.last / ind.mF - 1) * 100 : null, 1)})</dd>
      <dt>${P().maSlow}-day MA</dt><dd>${fmtPrice(ind.mS)} (${fmtPct(ind.mS ? (ind.last / ind.mS - 1) * 100 : null, 1)})</dd>
      <dt>Trend</dt><dd>${trendTxt}</dd>
      ${ind.cross ? `<dt>MA cross</dt><dd>✦ ${ind.cross.type === 'golden' ? 'Golden' : 'Death'} cross ${ind.cross.ago === 0 ? 'today' : ind.cross.ago + ' day' + (ind.cross.ago > 1 ? 's' : '') + ' ago'}</dd>` : ''}
      <dt>BB width</dt><dd>${ind.bbw != null ? `${ind.bbw.toFixed(2)}% · ${ordinal(Math.round(ind.bbPct))} pctl · ${BB_LABEL[ind.bbState]}` : '—'}</dd>
    </dl>
    ${ind.stop ? `<div class="d-stops">
      ${['long', 'short'].map(side => {
        const s = ind.stop[side + 'State'], below = side === 'long' ? 'below' : 'above';
        const note = s === 'closed' ? `🛑 <b>The last daily close finished ${below} the stop (${fmtPrice(ind.stop[side === 'long' ? 'prevLong' : 'prevShort'])}): suggested exit for ${side} positions.</b>`
          : s === 'intraday' ? `⚠ Price is ${below} the stop now, but a daily close hasn't confirmed it. Watch the close (00:00 UTC).`
          : s === 'near' ? '⚠️ Price is close to the stop.'
          : `Exit a ${side} if the price closes ${below} this.`;
        return `<div class="d-stop ${s}"><div class="d-st">Recommended stop · <b>${side}</b> positions</div><div class="d-sv">${fmtPrice(ind.stop[side])} <span>${fmtPct(ind.stop[side + 'Pct'], 1)}</span></div><div class="d-sn">${note}</div></div>`;
      }).join('')}
    </div>
    <div class="d-src">Stops = ${P().stopMult}× the average daily move (${(ind.stop.dist / P().stopMult * 100).toFixed(c.fx ? 2 : 1)}%) from the ${new Date(ind.t[ind.stop.anchorIdx ?? ind.n - 2] ?? Date.now()).toISOString().slice(0, 10)} ${c.fx ? 'rate' : 'close'}. Suggested levels, not advice: set them with ${M.stopWhere}, as this page isn't real-time.</div>` : ''}
    <div class="d-src">${!h ? '' : c.fx
      ? `${h.ok ? '✓ Official ECB reference rate' : '? Community exchange-api feed (public domain)'} · ${ind.n} business days`
      : `${h.src} ${h.pair} · ${h.ok ? '✓ verified by CoinGecko ID' : '⚠ matched by ticker only (not verified)'} · ${ind.n} daily candles`}${ind.bbShort ? ' · BBW percentile uses under 90 days' : ''}</div>`;
    body += '</div></div>';
  } else body += `<div class="d-src">${ind?.error ? (c.fx ? 'No rate history available for this currency.' : 'No daily history found on Binance, Gate.io, OKX or CoinGecko.') : 'Loading candles…'}</div>`;
  box.querySelector('.body').innerHTML = body;
  box.classList.add('show');
  if (keepPos) {                              // redrawn in place (e.g. chart switch): stay inside the window
    const b = box.getBoundingClientRect();
    if (b.bottom > innerHeight - 12) box.style.top = Math.max(12, innerHeight - b.height - 12) + 'px';
    return;
  }
  if (anchor) {
    // Place it behind the mouse: on the side it came from, so the tiles it's heading for stay visible.
    // Beside the tile if there's room, otherwise above/below; always clamped inside the window.
    const r = anchor.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 10, m = 12;
    const tv = ptr.travel;                                 // last clear direction of mouse travel (unit vector)
    const fitsR = r.right + gap + bw <= vw - m, fitsL = r.left - gap - bw >= m;
    const side = (tv.x > 0.2 ? ['left', 'right'] : ['right', 'left']).find(s => s === 'right' ? fitsR : fitsL);
    let left, top;
    if (side) { left = side === 'right' ? r.right + gap : r.left - gap - bw; top = r.top; }
    else {
      const fitsB = r.bottom + gap + bh <= vh - m, fitsA = r.top - gap - bh >= m;
      const above = tv.y > 0.2 ? fitsA || !fitsB : tv.y < -0.2 ? !fitsB && fitsA : !fitsB && fitsA;
      top = above ? r.top - gap - bh : r.bottom + gap;
      left = tv.x > 0.2 ? r.right - bw : tv.x < -0.2 ? r.left : r.left + r.width / 2 - bw / 2;   // lean away from where it's heading
    }
    left = Math.min(Math.max(m, left), Math.max(m, vw - bw - m));
    top = Math.min(Math.max(m, top), Math.max(m, vh - bh - m));
    box.style.left = left + 'px'; box.style.top = top + 'px';
  }
}
export const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
export function hideDetail(force) {
  if (S.pinned && !force) return;
  S.pinned = null;
  S.hoverId = null; overDetail = false;
  $$('#scorewrap [aria-expanded="true"]').forEach(x => x.setAttribute('aria-expanded', 'false'));
  $('#detail').classList.remove('show', 'pinned');
  $('#scrim').classList.remove('show');
}
export function pinDetail(id, anchor) {
  S.pinned = id;
  showDetail(id, anchor);
  $('#detail').classList.add('pinned');
  $('#scrim').classList.add('show');
  $('#detail .x').focus({ preventScroll: true });
}

/* ================= events ================= */
export const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
// Hover rules:
// - a popup opens only once the mouse RESTS on a coin (~2 s), so gliding across tiles opens nothing
// - it opens on the side the mouse came from (see showDetail), out of the way of where it's heading
// - it's solid, so the mouse can rest on it; heading TOWARD it keeps it open
// - moving off it toward another coin closes it quickly; that coin opens once the mouse rests there
export const ptr = { pts: [], travel: { x: 0, y: 0 } };
document.addEventListener('mousemove', e => {
  const now = performance.now();
  ptr.pts.push({ x: e.clientX, y: e.clientY, t: now });
  while (ptr.pts.length > 2 && now - ptr.pts[0].t > 120) ptr.pts.shift();
  const a = ptr.pts[0], dx = e.clientX - a.x, dy = e.clientY - a.y, d = Math.hypot(dx, dy);
  if (d > 24) ptr.travel = { x: dx / d, y: dy / d };      // remember the last clear direction of travel
}, { passive: true });
export const ptrSpeed = () => {                                   // px per ms over the last ~120 ms
  const p = ptr.pts; if (p.length < 2) return 0;
  const a = p[0], b = p[p.length - 1];
  return performance.now() - b.t > 80 ? 0 : Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t);
};
// Is the mouse moving toward this rectangle? (ray from the mouse along its motion, against the rect grown by 16px)
export function headingInto(rect) {
  const p = ptr.pts; if (p.length < 2) return false;
  const a = p[0], b = p[p.length - 1], dx = b.x - a.x, dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 4) return false;
  let tmin = 0, tmax = Infinity;
  for (const [o, d, lo, hi] of [[b.x, dx, rect.left - 16, rect.right + 16], [b.y, dy, rect.top - 16, rect.bottom + 16]]) {
    if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) return false; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}
export let openTimer = 0, hideTimer = 0, overDetail = false, pendingId = null;
export const HOVER_OPEN_MS = 2000, HOVER_HIDE_MS = 250, HOVER_AWAY_MS = 120;
export const cancelHide = () => { clearTimeout(hideTimer); hideTimer = 0; };
export const cancelOpen = () => { clearTimeout(openTimer); pendingId = null; };
export const hideSoon = ms => { if (!hideTimer) hideTimer = setTimeout(() => { hideTimer = 0; if (!overDetail) hideDetail(); }, ms); };
export function armOpen(t) {
  if (pendingId === t.dataset.id) return;                // already waiting on this coin
  clearTimeout(openTimer); pendingId = t.dataset.id;
  const tryOpen = () => {
    if (S.pinned || overDetail || pendingId !== t.dataset.id || !t.isConnected) return;
    if (ptrSpeed() > 0.25) { openTimer = setTimeout(tryOpen, 120); return; }   // still moving: wait for it to rest
    pendingId = null; cancelHide();
    showDetail(t.dataset.id, t);
  };
  openTimer = setTimeout(tryOpen, HOVER_OPEN_MS);
}
$('#grid').addEventListener('mousemove', e => {
  if (S.pinned || !finePointer.matches) return;
  const t = e.target.closest('.tile'), box = $('#detail'), shown = box.classList.contains('show');
  if (!t) { cancelOpen(); return; }
  if (shown && S.hoverId === t.dataset.id) { cancelHide(); cancelOpen(); return; }   // still on the open coin
  if (shown && headingInto(box.getBoundingClientRect())) { cancelHide(); cancelOpen(); return; }   // on the way to the popup
  if (shown) hideSoon(HOVER_AWAY_MS);                      // moving away toward another coin
  armOpen(t);
}, { passive: true });
$('#grid').addEventListener('mouseleave', () => { cancelOpen(); if (!overDetail) hideSoon(HOVER_HIDE_MS); });
$('#detail').addEventListener('mouseenter', () => { overDetail = true; cancelHide(); cancelOpen(); });
$('#detail').addEventListener('mouseleave', () => { overDetail = false; hideSoon(HOVER_HIDE_MS); });
// clicking the hover popup pins it open, like clicking the tile
$('#detail').addEventListener('click', e => {
  const sw = e.target.closest('[data-chart]');
  if (sw) {                                   // Price / P&F switch: redraw in place, remember the choice
    S.chart = sw.dataset.chart; savePrefs();
    showDetail(S.pinned || S.hoverId, null, true);
    return;
  }
  if (S.pinned || !S.hoverId || e.target.closest('.x')) return;
  // pin in place: no redraw, no move
  S.pinned = S.hoverId;
  $('#detail').classList.add('pinned');
  $('#scrim').classList.add('show');
});
// Keyboard users get the preview on Tab focus; a tap or click also focuses the tile, but that's handled by 'click'
$('#grid').addEventListener('focusin', e => { const t = e.target.closest('.tile'); if (t && !S.pinned && t.matches(':focus-visible')) showDetail(t.dataset.id, t); });
$('#grid').addEventListener('focusout', () => { if (!overDetail) hideDetail(); });
$('#grid').addEventListener('click', e => {
  const t = e.target.closest('.tile');
  if (!t) return;
  if (S.pinned === t.dataset.id) hideDetail(true); else pinDetail(t.dataset.id, t);
});
$('#tablewrap').addEventListener('click', e => {
  const b = e.target.closest('th button');
  if (b) {
    const k = b.dataset.k;
    S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === 'rank' || k === 'name' ? 1 : -1) };
    renderTable(); return;
  }
  const tr = e.target.closest('tr[data-id]');
  if (tr) pinDetail(tr.dataset.id, tr);
});
$('#detail .x').addEventListener('click', () => hideDetail(true));
$('#scrim').addEventListener('click', () => hideDetail(true));
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideDetail(true); });
// Close a pinned popup on a click elsewhere. Uses the click's original path, because a redraw can detach e.target.
document.addEventListener('click', e => {
  if (!S.pinned) return;
  const inside = e.composedPath().some(n => n.id === 'detail' || n.classList?.contains('tile') || n.dataset?.coin || (n.tagName === 'TR' && n.dataset?.id));
  if (!inside) hideDetail(true);
});
addEventListener('scroll', () => { if (!S.pinned) hideDetail(); }, { passive: true });

export function seg(id, key, after) {
  $('#' + id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S[key] = b.dataset.v;
    $$('#' + id + ' button').forEach(x => x.setAttribute('aria-pressed', x === b));
    savePrefs(); after();
  });
  $$('#' + id + ' button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === S[key]));
}
seg('colorBy', 'colorBy', renderAll);
seg('view', 'view', () => { hideDetail(true); renderAll(); });
// Forex: USD/… | …/USD. Redraws everything from the same rates, flipped or not (see quoteView)
$('#quote').hidden = MARKET !== 'forex';
seg('quote', 'quote', () => { hideDetail(true); if (S.raw) { S.coins = []; show(S.raw, S.mode === 'live'); } });
// "How to read": the full legend opens below the one-line legend, and stays open or closed per browser
export const setLegend = open => { S.legendOpen = open; $('#legendMore').hidden = !open; $('#legendToggle').setAttribute('aria-expanded', open); $('#legendToggle').textContent = open ? '✕ Hide legend' : 'ⓘ How to read'; };
setLegend(S.legendOpen);
$('#legendToggle').addEventListener('click', () => { setLegend(!S.legendOpen); savePrefs(); });
$('#scorewrap').addEventListener('click', e => {
  const b = e.target.closest('[data-w]');
  if (b) { S.scoreWin = b.dataset.w; renderScorecard(); return; }
  const hb = e.target.closest('[data-h]');
  if (hb) { S.scoreH = +hb.dataset.h; renderScorecard(); return; }
  // Yesterday's coins: open the coin's chart card beside the chip, the same card as a grid click (Price / P&F
  // switch included); the same chip again, ×, Escape or a click elsewhere closes it
  const chip = e.target.closest('[data-coin]');
  if (!chip) return;
  if (S.pinned === chip.dataset.coin) { hideDetail(true); return; }
  pinDetail(chip.dataset.coin, chip);
  $$('#scorewrap [data-coin]').forEach(x => x.setAttribute('aria-expanded', x === chip));
});
export function setFilter(f) {
  S.filter = f;
  if (f === 'all') S.heat = null;               // "All coins" / "Show all coins" also clears a color-scale range
  $$('#filters .chip').forEach(x => x.setAttribute('aria-pressed', x.dataset.f === S.filter));
  hideDetail(true);
  renderAll();
}
// clicking the active filter again (or "All coins") shows every coin
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  setFilter(S.filter === b.dataset.f && b.dataset.f !== 'all' ? 'all' : b.dataset.f);
});
// Color scale: click a range to show only coins in it; click it again to show every coin
$('#legendScale').addEventListener('click', e => {
  const b = e.target.closest('[data-heat]'); if (!b) return;
  S.heat = S.heat === b.dataset.heat ? null : b.dataset.heat;
  hideDetail(true);
  renderAll();
});
document.addEventListener('click', e => {
  if (e.target.closest('[data-show-all]')) setFilter('all');
  if (e.target.closest('[data-goto-score]')) { e.preventDefault(); $('#view button[data-v=score]').click(); window.scrollTo({ top: $('#scorewrap').offsetTop - 12 }); }
});
// This market's names on the shared controls
$$('#market a').forEach(a => { if (a.dataset.m === MARKET) a.setAttribute('aria-current', 'page'); });
$$('#colorBy button').forEach(b => { b.textContent = TF(b.dataset.v); b.title = `Color by ${TF(b.dataset.v)} change`; });
$('#filters .chip[data-f="all"]').textContent = `All ${M.noun}`;
$('#pegged').parentElement.lastChild.textContent = ' ' + M.pegLabel;
$('#pegged').parentElement.title = M.pegTitle;
$('#pegged').checked = S.pegged;
$('#pegged').addEventListener('change', e => { S.pegged = e.target.checked; savePrefs(); pickCoins(); renderAll(); applyHist(); done(); });

export const THEMES = ['', 'light', 'dark'], THEME_LABEL = { '': '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
export const applyTheme = th => { if (th) document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme; $('#theme').textContent = THEME_LABEL[th]; };
applyTheme(prefs.theme || '');
$('#theme').addEventListener('click', () => { const cur = document.documentElement.dataset.theme || ''; applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % 3]); savePrefs(); });

$('#refresh').addEventListener('click', () => { if (Date.now() >= (S.nextAuto || 0)) run(); });

// Work-in-progress notice: shown on first visit, then again 30 days after it was dismissed
export const WIP_AGAIN = 30 * DAY;
export const showWip = () => { $('#wip').hidden = false; $('#wipOk').focus({ preventScroll: true }); };
export const hideWip = () => { $('#wip').hidden = true; store.set('hm.wip', Date.now()); };
$('#wipOk').addEventListener('click', hideWip);
$('#wipBtn').addEventListener('click', () => ($('#wip').hidden ? showWip() : hideWip()));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#wip').hidden) hideWip(); });
if (!(Date.now() - (store.get('hm.wip') || 0) < WIP_AGAIN)) setTimeout(showWip, 600);

