// heat.sala.company/rates/: government bond yield curves (rates.json, built by scripts/build-rates.mjs).
// Not a price heatmap like the other pages, so it draws its own view: one tile per market (10-year yield, its change in
// basis points, the curve's health), every curve on one chart, and the chosen market's curve now vs a week, a month and
// a year ago plus its slope history. main.mjs starts it instead of the price pipeline (M.custom).
import { $, $$, esc, logo, M, S, store } from './core.mjs';
import { renderHealth } from './render.mjs';

const DAY = 864e5, REFRESH = 10 * 60e3;
const TFS = [['1d', 1], ['1w', 7], ['1m', 30]];
const STATE = {
  normal: { icon: '🟢', label: 'Normal', note: 'long-term rates above short-term ones, as usual' },
  flat: { icon: '🟡', label: 'Flat', note: 'long and short rates close together: often a late-cycle sign' },
  inverted: { icon: '🔴', label: 'Inverted', note: 'short-term rates above long-term ones: this has come before most US recessions' },
};
const COLORS = { us: '#2f6fd0', ea: '#2f9e6a', de: '#8a6a3c', uk: '#d0453b', jp: '#c9971a', ca: '#8a5cd0', au: '#b8862b', ch: '#d0458f', se: '#1aa3b8', no: '#5d6f93', br: '#e0782a', cn: '#c8102e', in: '#ff9933', za: '#6aa83a' };
let R = null, tf = (store.get('hm.ratesTf') || '1d'), sel = null, loadedAt = 0;

const fmtY = v => v == null ? '—' : v.toFixed(2) + '%';
const fmtBp = v => { if (v == null) return '—'; const r = Math.round(v); return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r) + ' bp'; };
const fmtPP = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + ' pp';
const dayLabel = iso => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
const tenorLabel = t => t === 0 ? 'now' : t < 1 ? Math.round(t * 12) + 'm' : (Number.isInteger(t) ? t : t.toFixed(1)) + 'y';
const shortLabel = c => c.short || '2y';                                  // the slope's short leg: 2y, Bank Rate (UK) or 3m (South Africa)
const SHORT_WORDS = { '2y': '2-year', 'Bank Rate': 'Bank of England’s Bank Rate', '3m': '3-month Treasury bill' };

// change in the 10-year yield over k calendar days, in basis points: vs the last observation on or before that day
// (within 4 days, so a long gap shows no change rather than a misleading one)
export function changeBp(c, k) {
  const s = c.series, n = s?.d?.length;
  if (!n) return null;
  const last = s.d[n - 1];
  for (let i = n - 2; i >= 0; i--) if (s.d[i] <= last - k) return s.d[i] >= last - k - 4 ? (s.y10[n - 1] - s.y10[i]) * 100 : null;
  return null;
}
const heat = (bp, tfKey) => {
  if (bp == null) return 'h0';
  const t = M.bins[tfKey], a = Math.abs(bp), k = a < t[0] ? 0 : a < t[1] ? 1 : a < t[2] ? 2 : a < t[3] ? 3 : 4;
  return k === 0 ? 'h0' : (bp > 0 ? 'h' : 'h-') + k;
};
const logoOf = c => logo(c, 18);   // the flag (or its country code where the system has no flag emoji)

function tileHTML(c) {
  const k = TFS.find(x => x[0] === tf)[1], bp = changeBp(c, k), st = STATE[c.state];
  return `<button class="rtile ${heat(bp, tf)}${c.id === sel ? ' sel' : ''}" data-id="${esc(c.id)}" data-coin="1" aria-haspopup="dialog" aria-label="${esc(`${c.name}: 10-year ${fmtY(c.y10)}, ${tf} ${fmtBp(bp)}, curve ${st?.label || 'unknown'}`)}">
    <div class="rt-top"><span class="rt-name">${logoOf(c)}<b>${esc(c.name)}</b></span><span class="rt-chg">${fmtBp(bp)}</span>
      <span class="rt-y"><span class="rt-yl">10-year</span> ${fmtY(c.y10)}</span><span class="rt-date">${c.notRefreshed ? '⚠ ' : ''}${dayLabel(c.date)}</span></div>
    <div class="rt-bot"><span class="rt-state st-${esc(c.state || 'none')}">${st ? `${st.icon} ${st.label}` : '—'}</span><span class="rt-slope" title="10-year minus ${shortLabel(c)}">10y − ${c.short === 'Bank Rate' ? 'BR' : shortLabel(c)} ${fmtPP(c.slope)}</span></div>
  </button>`;
}

/* ---------- charts (plain SVG) ---------- */
// charts are drawn at their on-screen width (set in render()), so labels stay 10 px on a phone and on a wide screen
let W = 900, H = 300;
const PL = 38, PR = 12, PT = 12, PB = 26;
// square-root maturity axis (the short end gets room), up to the longest maturity on the chart
const xAxis = tmax => t => PL + Math.sqrt(Math.max(t, 0) / tmax) * (W - PL - PR);
const TICKS = [0.25, 1, 2, 5, 10, 20, 30];
function yScale(vals) {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(0.15, (hi - lo) * 0.1); lo -= pad; hi += pad;
  return { y: v => PT + (hi - v) / (hi - lo) * (H - PT - PB), lo, hi };
}
const niceTicks = (lo, hi) => { const step = [0.25, 0.5, 1, 2][[0.25, 0.5, 1, 2].findIndex(s => (hi - lo) / s <= 6)] ?? 2; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(2)); return out; };
const path = (pts, x, y) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('');
function frame(sc, x, tmax) {
  const ys = niceTicks(sc.lo, sc.hi);
  return ys.map(v => `<line x1="${PL}" x2="${W - PR}" y1="${sc.y(v)}" y2="${sc.y(v)}" stroke="var(--grid)"/><text x="${PL - 6}" y="${sc.y(v) + 3.5}" font-size="10" text-anchor="end" fill="var(--muted)">${v}%</text>`).join('')
    + TICKS.filter(t => t <= tmax + 0.5).map(t => `<text x="${x(t)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="var(--muted)">${tenorLabel(t)}</text>`).join('');
}
// one chart, one line per curve: [{ pts, color, width, dash, label }]
function curveChart(lines, aria) {
  const vals = lines.flatMap(l => l.pts.map(p => p[1]));
  if (!vals.length) return '';
  const tmax = Math.max(10, ...lines.flatMap(l => l.pts.map(p => p[0])));
  const sc = yScale(vals), x = xAxis(tmax);
  return `<svg class="r-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${frame(sc, x, tmax)}`
    + lines.map(l => `<path d="${path(l.pts, x, sc.y)}" fill="none" stroke="${l.color}" stroke-width="${l.width || 2}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''} stroke-linejoin="round"><title>${esc(l.label)}</title></path>`
      + (l.dots ? l.pts.map(([t, v]) => `<circle cx="${x(t)}" cy="${sc.y(v)}" r="2.6" fill="${l.color}"><title>${esc(`${l.label}: ${tenorLabel(t)} ${v.toFixed(2)}%`)}</title></circle>`).join('') : '')).join('')
    + '</svg>';
}
// slope history: 10-year minus the short leg, with the inverted stretches (below zero) shaded
function slopeChart(c) {
  const s = c.series, pts = s.d.map((d, i) => s.ys[i] == null ? null : [d, s.y10[i] - s.ys[i]]).filter(Boolean);
  if (pts.length < 2) return '<p class="r-muted">Not enough history yet for the slope chart.</p>';
  const W2 = W, H2 = W < 600 ? 150 : 180, d0 = pts[0][0], d1 = pts[pts.length - 1][0];
  const vals = pts.map(p => p[1]).concat(0), sc = yScale(vals);
  const y = v => PT + (sc.hi - v) / (sc.hi - sc.lo) * (H2 - PT - PB);
  const x = d => PL + (d - d0) / Math.max(1, d1 - d0) * (W2 - PL - PR);
  const zero = y(0), line = path(pts, x, y);
  const area = `M${x(d0)},${zero}` + pts.map(([d, v]) => `L${x(d).toFixed(1)},${(v < 0 ? y(v) : zero).toFixed(1)}`).join('') + `L${x(d1)},${zero}Z`;
  const ys = niceTicks(sc.lo, sc.hi), t0 = s.t0;
  const yearTicks = [];
  for (let m = 0; m <= (d1 - d0) / 30; m += 6) { const d = d0 + m * 30.44; yearTicks.push(`<text x="${x(d)}" y="${H2 - 8}" font-size="10" text-anchor="middle" fill="var(--muted)">${new Date(t0 + (d - d0) * DAY).toLocaleDateString([], { month: 'short', year: '2-digit', timeZone: 'UTC' })}</text>`); }
  return `<svg class="r-chart" viewBox="0 0 ${W2} ${H2}" role="img" aria-label="${esc(`${c.name}: 10-year minus ${shortLabel(c)} over time`)}">`
    + ys.map(v => `<line x1="${PL}" x2="${W2 - PR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${PL - 6}" y="${y(v) + 3.5}" font-size="10" text-anchor="end" fill="var(--muted)">${v}</text>`).join('')
    + `<path d="${area}" fill="var(--dn, #d0453b)" opacity=".22"/><line x1="${PL}" x2="${W2 - PR}" y1="${zero}" y2="${zero}" stroke="var(--ink-2)" stroke-width="1"/>`
    + `<path d="${line}" fill="none" stroke="${COLORS[c.id] || 'var(--ink)'}" stroke-width="1.8"/>` + yearTicks.join('') + '</svg>';
}

function detailHTML(c) {
  const col = COLORS[c.id] || 'var(--ink)', st = STATE[c.state];
  const lines = [
    c.then?.y1 && { pts: c.then.y1.pts, color: 'var(--muted)', width: 1.4, dash: '2 3', label: `A year ago (${dayLabel(c.then.y1.date)})` },
    c.then?.m1 && { pts: c.then.m1.pts, color: col, width: 1.4, dash: '6 4', label: `A month ago (${dayLabel(c.then.m1.date)})` },
    c.then?.w1 && { pts: c.then.w1.pts, color: col, width: 1.2, dash: '1 0', label: `A week ago (${dayLabel(c.then.w1.date)})`, faint: true },
    { pts: c.curve, color: col, width: 2.6, dots: true, label: `Latest (${dayLabel(c.date)})` },
  ].filter(Boolean);
  const key = lines.map(l => `<span class="r-key"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="${l.color}" stroke-width="${l.width}"${l.dash && l.dash !== '1 0' ? ` stroke-dasharray="${l.dash}"` : ''}${l.faint ? ' opacity=".55"' : ''}/></svg>${esc(l.label)}</span>`).join('');
  const tenors = c.curve.map(p => p[0]);
  // the yield at maturity t on a curve, straight line between its points (in case a past curve lacks one of today's maturities)
  const at = (snap, t) => { const p = snap?.pts; if (!p?.length || t < p[0][0] - 1e-6 || t > p[p.length - 1][0] + 1e-6) return null; const i = p.findIndex(q => q[0] >= t - 1e-6); return Math.abs(p[i][0] - t) < 1e-6 ? p[i][1] : p[i - 1][1] + (p[i][1] - p[i - 1][1]) * (t - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); };
  const rows = tenors.map(t => { const now = at({ pts: c.curve }, t), m = at(c.then?.m1, t), y = at(c.then?.y1, t);
    return `<tr><td>${t === 0 ? 'Bank Rate' : tenorLabel(t)}</td><td>${fmtY(now)}</td><td>${m == null ? '—' : fmtBp((now - m) * 100)}</td><td>${y == null ? '—' : fmtBp((now - y) * 100)}</td></tr>`; }).join('');
  return `<div class="r-card r-pop" data-country="${esc(c.id)}"><div class="r-head"><h2>${logoOf(c)} ${esc(c.name)}: yield curve</h2>
      <span class="rt-state st-${esc(c.state || 'none')}">${st ? `${st.icon} ${st.label}` : '—'}</span></div>
    <p class="r-says">${st ? `The 10-year yield is <b>${fmtY(c.y10)}</b> and the ${SHORT_WORDS[shortLabel(c)] || shortLabel(c)} <b>${fmtY(c.yShort)}</b>: a gap of <b>${fmtPP(c.slope)}</b>. ${st.label}: ${st.note}.` : 'No reading yet.'}</p>
    ${curveChart(lines.map(l => ({ ...l, color: l.faint ? col : l.color, width: l.faint ? 1 : l.width })), `${c.name} yield curve`)}
    <div class="r-keys">${key}</div>
    <h3>10-year minus ${shortLabel(c)}, last two years <span class="r-muted">(shaded: inverted)</span></h3>
    ${slopeChart(c)}
    <details class="r-table"><summary>Every maturity</summary><table><thead><tr><th>Maturity</th><th>Yield</th><th>vs a month ago</th><th>vs a year ago</th></tr></thead><tbody>${rows}</tbody></table></details>
    <p class="r-src">${c.notRefreshed ? '⚠ The source didn’t answer in the latest check: showing its last curve. ' : ''}Source: <a href="${esc(c.srcUrl)}" target="_blank" rel="noopener">${esc(c.src)}</a>, closing yields of ${dayLabel(c.date)}.${c.note ? ' ' + esc(c.note) : ''}</p></div>`;
}

function allCurves() {
  const cs = R.countries.filter(c => c.curve?.length);
  const lines = cs.map(c => ({ pts: c.curve, color: COLORS[c.id] || 'var(--ink)', width: c.id === sel ? 3 : 1.6, label: `${c.name} (${dayLabel(c.date)})`, dots: c.id === sel }));
  const key = cs.map(c => `<button class="r-key r-pick${c.id === sel ? ' on' : ''}" data-id="${esc(c.id)}" data-coin="1" aria-haspopup="dialog"><svg width="18" height="8" aria-hidden="true"><line x1="0" x2="18" y1="4" y2="4" stroke="${COLORS[c.id]}" stroke-width="3"/></svg>${esc(c.name)}</button>`).join('');
  return `<h2>All curves, latest</h2>${curveChart(lines, 'Every market’s latest yield curve')}<div class="r-keys">${key}</div>`;
}

/* ---------- Europe, monthly (ECB): 10-year yields only, one value a month ---------- */
const monthLabel = (ym, long) => ym ? new Date(ym + '-15T12:00:00Z').toLocaleDateString([], { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
function mTileHTML(m) {
  return `<button class="rtile mtile ${heat(m.chg1m, '1m')}${m.id === sel ? ' sel' : ''}" data-id="${esc(m.id)}" data-coin="1" aria-haspopup="dialog" aria-label="${esc(`${m.name}: 10-year ${fmtY(m.y10)} in ${monthLabel(m.month, true)}, ${fmtBp(m.chg1m)} on the month`)}">
    <div class="rt-top"><span class="rt-name">${logoOf(m)}<b>${esc(m.name)}</b></span><span class="rt-chg">${fmtBp(m.chg1m)}</span>
      <span class="rt-y"><span class="rt-yl">10-year</span> ${fmtY(m.y10)}</span><span class="rt-date">${m.notRefreshed ? '⚠ ' : ''}${monthLabel(m.month)}</span></div>
    <div class="rt-bot"><span>${m.vsDE != null ? `vs 🇩🇪 ${fmtPP(m.vsDE)}` : 'not in the euro'}</span><span class="rt-slope">1y ${fmtBp(m.chg12m)}</span></div>
  </button>`;
}
// two years of monthly 10-year yields, with Germany's for the euro members
function monthChart(m) {
  const lines = [m.de && { s: m.de, color: COLORS.de, width: 1.4, dash: '5 4', label: 'Germany' }, { s: m.series, color: 'var(--blue, #2f6fd0)', width: 2.4, label: m.name }].filter(Boolean);
  const months = m.series.map(p => p[0]), idx = new Map(months.map((ym, i) => [ym, i]));
  const vals = lines.flatMap(l => l.s.filter(p => idx.has(p[0])).map(p => p[1]));
  if (months.length < 2 || !vals.length) return '';
  const H2 = W < 600 ? 170 : 200, sc = yScale(vals), y = v => PT + (sc.hi - v) / (sc.hi - sc.lo) * (H2 - PT - PB);
  const x = i => PL + i / (months.length - 1) * (W - PL - PR);
  return `<svg class="r-chart" viewBox="0 0 ${W} ${H2}" role="img" aria-label="${esc(`${m.name}: monthly 10-year yield`)}">`
    + niceTicks(sc.lo, sc.hi).map(v => `<line x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${PL - 6}" y="${y(v) + 3.5}" font-size="10" text-anchor="end" fill="var(--muted)">${v}%</text>`).join('')
    + months.map((ym, i) => i % 6 === 0 || i === months.length - 1 ? `<text x="${x(i)}" y="${H2 - 8}" font-size="10" text-anchor="${i === months.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}" fill="var(--muted)">${monthLabel(ym)}</text>` : '').join('')
    + lines.map(l => `<path d="${l.s.filter(p => idx.has(p[0])).map((p, k) => `${k ? 'L' : 'M'}${x(idx.get(p[0])).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="${l.color}" stroke-width="${l.width}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''}><title>${esc(l.label)}</title></path>`).join('')
    + '</svg>';
}
function monthHTML(m) {
  const key = [`<span class="r-key"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="var(--blue, #2f6fd0)" stroke-width="2.4"/></svg>${esc(m.name)}</span>`,
    m.de ? `<span class="r-key"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="${COLORS.de}" stroke-width="1.4" stroke-dasharray="5 4"/></svg>Germany</span>` : ''].join('');
  return `<div class="r-card r-pop" data-country="${esc(m.id)}"><div class="r-head"><h2>${logoOf(m)} ${esc(m.name)}: 10-year yield, monthly</h2><span class="r-muted">📅 monthly</span></div>
    <p class="r-says">${esc(m.name)}’s 10-year government bond yield averaged <b>${fmtY(m.y10)}</b> in ${monthLabel(m.month, true)}: <b>${fmtBp(m.chg1m)}</b> on the month and <b>${fmtBp(m.chg12m)}</b> on the year${m.vsDE != null ? `, <b>${fmtPP(m.vsDE)}</b> above Germany’s (the gap investors watch as a measure of risk in the euro area)` : ''}.</p>
    ${monthChart(m)}
    <div class="r-keys">${key}</div>
    <p class="r-src">${m.notRefreshed ? '⚠ The source didn’t answer in the latest check: showing the last figures. ' : ''}Source: <a href="https://data.ecb.europa.eu/data/datasets/IRS" target="_blank" rel="noopener">European Central Bank</a>, long-term interest rates for convergence purposes: the monthly average of the country’s benchmark 10-year government bond yield, published early the next month. No free source has these countries’ daily yields or whole curves, so there is no curve or normal / flat / inverted reading here.</p></div>`;
}

function render() {
  if (!R) return;
  const grid = $('#grid');
  grid.className = 'grid rgrid';
  grid.innerHTML = R.countries.map(tileHTML).join('');
  const ms = R.monthly || [];
  $('#ratesMonthly').hidden = !ms.length;
  if (ms.length) $('#ratesMonthly').innerHTML = `<h2>Europe, monthly <span class="r-muted">📅 10-year yields only, the average of ${monthLabel(ms[0].month, true)} (ECB, published early each month): no free daily source has these countries. Colour: change on the month.</span></h2><div class="grid rgrid">${ms.map(mTileHTML).join('')}</div>`;
  W = Math.max(300, Math.min(1100, ($('#ratesAll').clientWidth || 900) - 32)); H = W < 600 ? 230 : 300;
  $('#ratesAll').innerHTML = allCurves();
  $$('#rtf button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === tf));
  const t = M.bins[tf];
  $('#rlegend').innerHTML = `${tf} change in the 10-year yield: <span class="scale">${[['h-4', `≤ −${t[3]}`], ['h-2', `−${t[1]}…${t[2]}`], ['h0', `±${t[0]}`], ['h2', `${t[1]}…${t[2]}`], ['h4', `≥ ${t[3]}`]].map(([k, l]) => `<span class="${k}">${l}</span>`).join('')}</span> bp · <b>blue = yields rose</b> (bond prices fell)`;
  // the address names the open market (?c=jp), so a link opens its curve
  const url = location.pathname + (sel ? '?c=' + encodeURIComponent(sel) : '');
  if (url !== location.pathname + location.search) history.replaceState(null, '', url);
}

// A market's curve in the shared popup (#detail): centred over the page, a bottom sheet on a phone (the CSS). The
// shared handlers close it (×, Escape, the backdrop, a click elsewhere); S.pinned tells them it's open.
function openPopup(id) {
  const c = R?.countries.find(x => x.id === id), m = !c && R?.monthly?.find(x => x.id === id);
  if (!c && !m) return;
  sel = id;
  const box = $('#detail'), body = box.querySelector('.body');
  box.classList.add('show', 'pinned');
  $('#scrim').classList.add('show');
  S.pinned = 'rates:' + id;
  const keep = [W, H];                      // the charts are drawn at the popup's width, then the page's again
  W = Math.max(280, (body.clientWidth || 640)); H = W < 600 ? 220 : 270;
  body.innerHTML = c ? detailHTML(c) : monthHTML(m);
  [W, H] = keep;
  const bw = box.offsetWidth, bh = box.offsetHeight;
  box.style.left = Math.max(12, (innerWidth - bw) / 2) + 'px';
  box.style.top = Math.max(12, (innerHeight - bh) / 2) + 'px';
  box.querySelector('.x').focus({ preventScroll: true });
  render();
}

function renderFresh() {
  if (!R) return;
  const mins = Math.floor((Date.now() - R.generated) / 60e3), ago = mins < 1 ? 'just now' : mins < 120 ? `${mins} min ago` : `${Math.floor(mins / 60)} h ago`;
  const latest = R.countries.map(c => `${c.badge} ${dayLabel(c.date)}`).join(' · ');
  const eu = R.monthly?.length ? ` · Europe monthly: ${monthLabel(R.monthly[0].month)}` : '';
  const html = `<span>🕒 <b>Official closing yields</b>, published once a business day · <b>not real-time</b> · latest: ${latest}${eu} · checked ${ago}</span>`;
  if ($('#fresh').innerHTML !== html) $('#fresh').innerHTML = html;
}

async function load() {
  try {
    const r = await fetch(`${M.data}?b=${Math.floor(Date.now() / 60e3)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('rates.json ' + r.status);
    const d = await r.json();
    if (d?.market !== 'rates' || !d.countries?.length) throw new Error('no yield curves');
    R = d; loadedAt = Date.now();
    render(); renderFresh();
    $('#status').innerHTML = `<span class="dot live"></span>${R.countries.length} markets · ${R.countries.filter(c => c.state === 'inverted').length} inverted${R.monthly?.length ? ` · ${R.monthly.length} monthly` : ''}`;
  } catch (e) {
    $('#status').innerHTML = `<span class="dot"></span>${esc(e.message)}. Retrying automatically.`;
  }
  fetch('/health.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(renderHealth).catch(() => {});
}

export function start() {
  document.body.classList.add('rates-page');
  // this page has none of the price controls: no filters, views, tile styles, quote switch, legend or refresh button
  for (const s of ['#colorBy', '#quote', '#view', '#density', '.controls .ctl', '#legend', '#reset', '#refresh', '#share', '#excluded']) { const el = $(s); if (el) el.hidden = true; }
  const main = $('main');
  main.insertAdjacentHTML('afterbegin', `<div class="r-bar"><div class="seg" id="rtf" role="group" aria-label="Change over">${TFS.map(([v]) => `<button data-v="${v}" aria-pressed="${v === tf}">${v}</button>`).join('')}</div><span id="rlegend" class="leg-item"></span></div>`);
  $('#grid').insertAdjacentHTML('afterend', `<section id="ratesMonthly" class="r-month" aria-label="Europe, monthly 10-year yields" hidden></section><section id="ratesAll" class="r-card" aria-label="All yield curves"></section>`);
  $('#detail').setAttribute('aria-label', 'Yield curve');
  const linked = new URLSearchParams(location.search).get('c');
  $('#rtf').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; tf = b.dataset.v; store.set('hm.ratesTf', tf); render(); });
  const pick = e => { const b = e.target.closest('[data-id]'); if (b && R) openPopup(b.dataset.id); };
  $('#grid').addEventListener('click', pick);
  $('#ratesAll').addEventListener('click', pick);
  $('#ratesMonthly').addEventListener('click', pick);
  // closed by the shared handlers: forget the market (and take it off the address)
  new MutationObserver(() => { if (sel && !$('#detail').classList.contains('pinned')) { sel = null; render(); } }).observe($('#detail'), { attributes: true, attributeFilter: ['class'] });
  load().then(() => { if (linked) openPopup(linked); });
  let rz = 0;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
  setInterval(() => { renderFresh(); if (!document.hidden && Date.now() - loadedAt > REFRESH) load(); }, 30e3);
}
