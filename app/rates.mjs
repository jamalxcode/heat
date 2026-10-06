// heat.sala.company/rates/: government bond yield curves (rates.json, built by scripts/build-rates.mjs).
// Not a price heatmap like the other pages, so it draws its own view: a card per market (10-year yield, its change in
// basis points, a sketch of its curve, its reading and real yield), sortable, groupable by region or shown as a table;
// a small popup beside the card with the curve now vs a week, a month and a year ago, or ten years of its slope. A
// separate row has the European countries the ECB covers only monthly. main.mjs starts it instead of the price pipeline.
import { $, $$, esc, logo, M, S, store } from './core.mjs';
import { renderHealth } from './render.mjs';

const DAY = 864e5, REFRESH = 10 * 60e3;
const TFS = [['1d', 1], ['1w', 7], ['1m', 30]];
const REGIONS = ['Americas', 'Europe', 'Asia-Pacific', 'Africa'];
const SORTS = [['default', 'Default'], ['state', 'Inverted first'], ['y10', '10-year yield'], ['real', 'Real yield'], ['move', 'Biggest move']];
// what each reading means. The recession record is a US finding, so only the US gets it
const STATE = {
  normal: { icon: '🟢', label: 'Normal', note: 'long-term rates above short-term ones, the usual shape' },
  flat: { icon: '🟡', label: 'Flat', note: 'long and short rates close together: markets see little change in rates ahead, which is often late in an economic cycle' },
  inverted: { icon: '🔴', label: 'Inverted', note: 'short-term rates above long-term ones: markets expect rates to fall, often because they expect a slowdown' },
};
const US_INVERTED = ' In the US an inverted curve has come before most recessions since the 1960s, from months to two years ahead, though not every time and not on a fixed timetable.';
const COLORS = { us: '#2f6fd0', ea: '#2f9e6a', de: '#8a6a3c', uk: '#d0453b', jp: '#c9971a', ca: '#8a5cd0', au: '#b8862b', ch: '#d0458f', se: '#1aa3b8', no: '#5d6f93', br: '#e0782a', cn: '#c8102e', in: '#ff9933', za: '#6aa83a' };
const pref = (k, ok, d) => { const v = store.get(k); return ok.includes(v) ? v : d; };
let R = null, sel = null, loadedAt = 0;
let tf = pref('hm.ratesTf', TFS.map(t => t[0]), '1d');
let sortBy = pref('hm.ratesSort', SORTS.map(s => s[0]), 'default');
let groupBy = pref('hm.ratesGroup', ['none', 'region'], 'none');
let viewAs = pref('hm.ratesView', ['cards', 'table'], 'cards');
let popTab = pref('hm.ratesTab', ['curve', 'history'], 'curve');

const fmtY = v => v == null ? '—' : v.toFixed(2) + '%';
const fmtBp = v => { if (v == null) return '—'; const r = Math.round(v); return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r) + ' bp'; };
const fmtPP = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + ' pp';
const fmtReal = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
const dayLabel = iso => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
const monthLabel = (ym, long) => ym ? new Date(ym + '-15T12:00:00Z').toLocaleDateString([], { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const tenorLabel = t => t === 0 ? 'now' : t < 1 ? Math.round(t * 12) + 'm' : (Number.isInteger(t) ? t : t.toFixed(1)) + 'y';
const shortLabel = c => c.short || '2y';                                  // the slope's short leg: 2y, Bank Rate (UK) or 3m (South Africa)
const shortTag = c => c.short === 'Bank Rate' ? 'BR' : shortLabel(c);
const SHORT_WORDS = { '2y': '2-year', 'Bank Rate': 'Bank of England’s Bank Rate', '3m': '3-month Treasury bill' };
const logoOf = c => logo(c, 18);   // the flag (or its country code where the system has no flag emoji)

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
// business days since a date: more than 2 and the card's date is greyed (the source publishes late, or didn't update)
export function bizDaysSince(iso, now = Date.now()) {
  if (!iso) return Infinity;
  let n = 0;
  for (let d = Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY) + 1; d <= Math.floor(now / DAY); d++) { const w = new Date(d * DAY).getUTCDay(); if (w && w !== 6) n++; }
  return n;
}
const inflNote = x => x.infl ? `inflation ${x.infl.v.toFixed(1)}% (${monthLabel(x.infl.month)})` : 'inflation —';
// the real yield as a coloured pill (green above zero, red below) and inflation as a quiet grey note, so they can't be confused
const realPill = x => `<span class="r-real ${x.real == null ? '' : x.real >= 0 ? 'pos' : 'neg'}" title="Real yield: the 10-year yield minus the latest yearly inflation">Real yield <b>${fmtReal(x.real)}</b></span>`;
const inflTag = x => `<span class="r-infl" title="Latest yearly consumer-price inflation${x.infl ? ` (${monthLabel(x.infl.month, true)}, ${esc(x.infl.src)})` : ''}">CPI ${x.infl ? x.infl.v.toFixed(1) + '%' : '—'}${x.infl ? ` · ${monthLabel(x.infl.month).split(' ')[0]}` : ''}</span>`;
const rankNote = c => c.slopePct == null ? null : `steeper than ${c.slopePct}% of the last ${c.longYears >= 9.5 ? '10' : Math.max(1, Math.round(c.longYears))} years`;

/* ---------- sketches: a tiny curve in each card (the 10-year path for the monthly ones) ---------- */
function spark(vals, xs, cls) {
  if (!vals || vals.length < 2) return '';
  const w = 36, h = 16, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1, x0 = xs[0], x1 = xs[xs.length - 1];
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${((xs[i] - x0) / (x1 - x0 || 1) * (w - 2) + 1).toFixed(1)},${(h - 2 - (v - lo) / span * (h - 4)).toFixed(1)}`).join('');
  return `<svg class="rt-spark ${cls || ''}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
const curveSpark = c => spark(c.curve?.map(p => p[1]), c.curve?.map(p => Math.sqrt(p[0])), 'st-' + (c.state || 'none'));
const monthSpark = m => { const s = m.series?.slice(-13) || []; return spark(s.map(p => p[1]), s.map((_, i) => i), ''); };

function tileHTML(c) {
  const k = TFS.find(x => x[0] === tf)[1], bp = changeBp(c, k), st = STATE[c.state], old = bizDaysSince(c.date) > 2;
  return `<button class="rtile ${heat(bp, tf)}${c.id === sel ? ' sel' : ''}" data-id="${esc(c.id)}" data-coin="1" aria-haspopup="dialog" aria-label="${esc(`${c.name}: 10-year ${fmtY(c.y10)}, ${tf} ${fmtBp(bp)}, curve ${st?.label || 'unknown'}, real yield ${fmtReal(c.real)}`)}">
    <div class="rt-top"><span class="rt-name">${logoOf(c)}<b>${esc(c.name)}</b></span><span class="rt-chg">${fmtBp(bp)}</span>
      <span class="rt-y"><span class="rt-yl">10-year</span> ${fmtY(c.y10)}</span><span class="rt-date${old ? ' old' : ''}"${old ? ' title="More than 2 business days old: this source publishes late, or didn’t update"' : ''}>${c.notRefreshed ? '⚠ ' : ''}${dayLabel(c.date)}</span></div>
    <div class="rt-bot"><span class="rt-state st-${esc(c.state || 'none')}">${st ? `${st.icon} ${st.label}` : '—'}</span>${curveSpark(c)}<span class="rt-slope" title="10-year minus ${shortLabel(c)}, in percentage points">10y−${shortTag(c)} ${fmtPP(c.slope).replace(' pp', '')}</span></div>
    <div class="rt-bot rt-real">${realPill(c)}${inflTag(c)}</div>
  </button>`;
}
function mTileHTML(m) {
  return `<button class="rtile mtile ${heat(m.chg1m, '1m')}${m.id === sel ? ' sel' : ''}" data-id="${esc(m.id)}" data-coin="1" aria-haspopup="dialog" aria-label="${esc(`${m.name}: 10-year ${fmtY(m.y10)} in ${monthLabel(m.month, true)}, ${fmtBp(m.chg1m)} on the month, real yield ${fmtReal(m.real)}`)}">
    <div class="rt-top"><span class="rt-name">${logoOf(m)}<b>${esc(m.name)}</b></span><span class="rt-chg">${fmtBp(m.chg1m)}</span>
      <span class="rt-y"><span class="rt-yl">10-year</span> ${fmtY(m.y10)}</span><span class="rt-date">${m.notRefreshed ? '⚠ ' : ''}${monthLabel(m.month)}</span></div>
    <div class="rt-bot"><span>${m.vsDE != null ? `vs 🇩🇪 ${fmtPP(m.vsDE)}` : 'not in the euro'}</span>${monthSpark(m)}<span class="rt-slope">1y ${fmtBp(m.chg12m)}</span></div>
    <div class="rt-bot rt-real">${realPill(m)}${inflTag(m)}</div>
  </button>`;
}

/* ---------- order and grouping ---------- */
// missing values (no inflation figure, no reading yet) always last
const asc = f => (a, b) => { const x = f(a), y = f(b); return x == null ? (y == null ? 0 : 1) : y == null ? -1 : x - y; };
const desc = f => (a, b) => { const x = f(a), y = f(b); return x == null ? (y == null ? 0 : 1) : y == null ? -1 : y - x; };
const absOrNull = v => v == null ? null : Math.abs(v);
export function sorted(list, monthly, by = sortBy, tfKey = tf) {
  const k = TFS.find(x => x[0] === tfKey)[1], cmp = {
    default: () => 0,
    state: monthly ? desc(m => m.vsDE) : asc(c => c.slope),           // inverted first; monthly: the widest gap to Germany
    y10: desc(x => x.y10),
    real: desc(x => x.real),
    move: monthly ? desc(m => absOrNull(m.chg1m)) : desc(c => absOrNull(changeBp(c, k))),
  }[by] || (() => 0);
  return list.map((x, i) => [x, i]).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map(p => p[0]);
}

/* ---------- table view ---------- */
function tableHTML(cs, ms) {
  const k = TFS.map(t => t[1]);
  const daily = cs.map(c => `<tr class="r-row" data-id="${esc(c.id)}" data-coin="1" tabindex="0"><th scope="row">${logoOf(c)} ${esc(c.name)}</th>
    <td class="${bizDaysSince(c.date) > 2 ? 'old' : ''}">${dayLabel(c.date)}</td><td><b>${fmtY(c.y10)}</b></td><td>${fmtY(c.yShort)} <span class="r-muted">${shortTag(c)}</span></td>
    <td>${fmtPP(c.slope)}</td><td>${c.short === '3m' ? '—' : fmtPP(c.slope3m)}</td><td>${STATE[c.state] ? `${STATE[c.state].icon} ${STATE[c.state].label}` : '—'}</td>
    <td>${c.slopePct == null ? '—' : c.slopePct + '%'}</td><td>${c.infl ? c.infl.v.toFixed(1) + '%' : '—'}</td><td>${fmtReal(c.real)}</td>
    ${k.map(d => `<td>${fmtBp(changeBp(c, d))}</td>`).join('')}</tr>`).join('');
  const monthly = ms.map(m => `<tr class="r-row" data-id="${esc(m.id)}" data-coin="1" tabindex="0"><th scope="row">${logoOf(m)} ${esc(m.name)}</th>
    <td>${monthLabel(m.month)}</td><td><b>${fmtY(m.y10)}</b></td><td>${fmtPP(m.vsDE)}</td><td>${fmtBp(m.chg1m)}</td><td>${fmtBp(m.chg12m)}</td>
    <td>${m.infl ? m.infl.v.toFixed(1) + '%' : '—'}</td><td>${fmtReal(m.real)}</td></tr>`).join('');
  return `<div class="r-tblwrap"><table class="r-tbl"><caption>Daily official yields</caption><thead><tr><th>Market</th><th>Date</th><th>10-year</th><th>Short</th><th title="10-year minus the short leg">Gap</th><th title="10-year minus 3-month">10y − 3m</th><th>Reading</th><th title="Share of the last years' weeks when the gap was flatter">Steeper than</th><th>Inflation</th><th title="10-year minus inflation">Real 10y</th><th>1d</th><th>1w</th><th>1m</th></tr></thead><tbody>${daily}</tbody></table></div>`
    + (ms.length ? `<div class="r-tblwrap"><table class="r-tbl"><caption>Europe, monthly (ECB, average of the month)</caption><thead><tr><th>Country</th><th>Month</th><th>10-year</th><th>vs Germany</th><th>1 month</th><th>1 year</th><th>Inflation</th><th>Real 10y</th></tr></thead><tbody>${monthly}</tbody></table></div>` : '');
}

/* ---------- charts (plain SVG) ---------- */
// charts are drawn at the popup's width (set in openPopup), so labels stay 10 px
let W = 420, H = 120;
const PL = 38, PR = 12, PT = 10, PB = 24;
// square-root maturity axis (the short end gets room), up to the longest maturity on the chart
const xAxis = tmax => t => PL + Math.sqrt(Math.max(t, 0) / tmax) * (W - PL - PR);
const TICKS = [0.25, 1, 2, 5, 10, 20, 30];
function yScale(vals, h = H) {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(0.15, (hi - lo) * 0.1); lo -= pad; hi += pad;
  return { y: v => PT + (hi - v) / (hi - lo) * (h - PT - PB), lo, hi };
}
const niceTicks = (lo, hi) => { const step = [0.25, 0.5, 1, 2][[0.25, 0.5, 1, 2].findIndex(s => (hi - lo) / s <= 5)] ?? 2; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(2)); return out; };
const path = (pts, x, y) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('');
// one chart, one line per curve: [{ pts, color, width, dash, label }]
function curveChart(lines, aria) {
  const vals = lines.flatMap(l => l.pts.map(p => p[1]));
  if (!vals.length) return '';
  const tmax = Math.max(10, ...lines.flatMap(l => l.pts.map(p => p[0]))), sc = yScale(vals), x = xAxis(tmax);
  return `<svg class="r-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">`
    + niceTicks(sc.lo, sc.hi).map(v => `<line x1="${PL}" x2="${W - PR}" y1="${sc.y(v)}" y2="${sc.y(v)}" stroke="var(--grid)"/><text x="${PL - 6}" y="${sc.y(v) + 3.5}" font-size="10" text-anchor="end" fill="var(--muted)">${v}%</text>`).join('')
    + TICKS.filter(t => t <= tmax + 0.5).map(t => `<text x="${x(t)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="var(--muted)">${tenorLabel(t)}</text>`).join('')
    + lines.map(l => `<path d="${path(l.pts, x, sc.y)}" fill="none" stroke="${l.color}" stroke-width="${l.width || 2}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''} stroke-linejoin="round"><title>${esc(l.label)}</title></path>`
      + (l.dots ? l.pts.map(([t, v]) => `<circle cx="${x(t)}" cy="${sc.y(v)}" r="2.4" fill="${l.color}"><title>${esc(`${l.label}: ${tenorLabel(t)} ${v.toFixed(2)}%`)}</title></circle>`).join('') : '')).join('')
    + '</svg>';
}
// the slope over time (weekly, up to ten years; the daily two years where that's all there is), inverted stretches shaded
function slopeChart(c) {
  const s = c.long?.d?.length > 20 ? c.long : c.series;
  const pts = s.d.map((d, i) => s.ys[i] == null ? null : [d, s.y10[i] - s.ys[i]]).filter(Boolean);
  if (pts.length < 2) return '<p class="r-muted">Not enough history yet: it builds up week by week.</p>';
  const d0 = pts[0][0], d1 = pts[pts.length - 1][0], sc = yScale(pts.map(p => p[1]).concat(0));
  const y = sc.y, x = d => PL + (d - d0) / Math.max(1, d1 - d0) * (W - PL - PR);
  const zero = y(0), years = (d1 - d0) / 365.25, every = years > 6 ? 2 : years > 2.5 ? 1 : 0.5;
  const area = `M${x(d0)},${zero}` + pts.map(([d, v]) => `L${x(d).toFixed(1)},${(v < 0 ? y(v) : zero).toFixed(1)}`).join('') + `L${x(d1)},${zero}Z`;
  const ticks = [];
  for (let yr = 0; yr <= years + 0.01; yr += every) { const d = d0 + yr * 365.25; ticks.push(`<text x="${x(d)}" y="${H - 8}" font-size="10" text-anchor="${yr === 0 ? 'start' : 'middle'}" fill="var(--muted)">${new Date(s.t0 + (d - d0) * DAY).toLocaleDateString([], every < 1 ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { year: 'numeric', timeZone: 'UTC' })}</text>`); }
  return `<svg class="r-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${c.name}: 10-year minus ${shortLabel(c)} over time`)}">`
    + niceTicks(sc.lo, sc.hi).map(v => `<line x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${PL - 6}" y="${y(v) + 3.5}" font-size="10" text-anchor="end" fill="var(--muted)">${v}</text>`).join('')
    + `<path d="${area}" fill="var(--dn, #d0453b)" opacity=".22"/><line x1="${PL}" x2="${W - PR}" y1="${zero}" y2="${zero}" stroke="var(--ink-2)" stroke-width="1"/>`
    + `<path d="${path(pts, x, y)}" fill="none" stroke="${COLORS[c.id] || 'var(--ink)'}" stroke-width="1.6"/>` + ticks.join('') + '</svg>';
}
// two years of monthly 10-year yields, with Germany's for the euro members
function monthChart(m) {
  const lines = [m.de && { s: m.de, color: COLORS.de, width: 1.4, dash: '5 4', label: 'Germany' }, { s: m.series, color: 'var(--blue, #2f6fd0)', width: 2.4, label: m.name }].filter(Boolean);
  const months = m.series.map(p => p[0]), idx = new Map(months.map((ym, i) => [ym, i]));
  const vals = lines.flatMap(l => l.s.filter(p => idx.has(p[0])).map(p => p[1]));
  if (months.length < 2 || !vals.length) return '';
  const sc = yScale(vals), y = sc.y, x = i => PL + i / (months.length - 1) * (W - PL - PR);
  return `<svg class="r-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${m.name}: monthly 10-year yield`)}">`
    + niceTicks(sc.lo, sc.hi).map(v => `<line x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${PL - 6}" y="${y(v) + 3.5}" font-size="10" text-anchor="end" fill="var(--muted)">${v}%</text>`).join('')
    + months.map((ym, i) => i % 6 === 0 || i === months.length - 1 ? `<text x="${x(i)}" y="${H - 8}" font-size="10" text-anchor="${i === months.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}" fill="var(--muted)">${monthLabel(ym)}</text>` : '').join('')
    + lines.map(l => `<path d="${l.s.filter(p => idx.has(p[0])).map((p, k) => `${k ? 'L' : 'M'}${x(idx.get(p[0])).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="${l.color}" stroke-width="${l.width}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''}><title>${esc(l.label)}</title></path>`).join('')
    + '</svg>';
}
const keyOf = (label, color, width, dash, faint) => `<span class="r-key"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}${faint ? ' opacity=".55"' : ''}/></svg>${esc(label)}</span>`;

/* ---------- popup content ---------- */
function detailHTML(c) {
  const col = COLORS[c.id] || 'var(--ink)', st = STATE[c.state];
  const lines = [
    c.then?.y1 && { pts: c.then.y1.pts, color: 'var(--muted)', width: 1.4, dash: '2 3', label: `A year ago (${dayLabel(c.then.y1.date)})` },
    c.then?.m1 && { pts: c.then.m1.pts, color: col, width: 1.4, dash: '6 4', label: `A month ago (${dayLabel(c.then.m1.date)})` },
    c.then?.w1 && { pts: c.then.w1.pts, color: col, width: 1, label: `A week ago (${dayLabel(c.then.w1.date)})`, faint: true },
    { pts: c.curve, color: col, width: 2.6, dots: true, label: `Latest (${dayLabel(c.date)})` },
  ].filter(Boolean);
  // the yield at maturity t on a curve, straight line between its points (in case a past curve lacks one of today's maturities)
  const at = (snap, t) => { const p = snap?.pts; if (!p?.length || t < p[0][0] - 1e-6 || t > p[p.length - 1][0] + 1e-6) return null; const i = p.findIndex(q => q[0] >= t - 1e-6); return Math.abs(p[i][0] - t) < 1e-6 ? p[i][1] : p[i - 1][1] + (p[i][1] - p[i - 1][1]) * (t - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); };
  const rows = c.curve.map(p => p[0]).map(t => { const now = at({ pts: c.curve }, t), m = at(c.then?.m1, t), y = at(c.then?.y1, t);
    return `<tr><td>${t === 0 ? 'Bank Rate' : tenorLabel(t)}</td><td>${fmtY(now)}</td><td>${m == null ? '—' : fmtBp((now - m) * 100)}</td><td>${y == null ? '—' : fmtBp((now - y) * 100)}</td></tr>`; }).join('');
  const since = c.long?.d?.length > 20 ? new Date(c.long.t0).getUTCFullYear() : null, rank = rankNote(c);
  const chart = popTab === 'history'
    ? `${slopeChart(c)}<div class="r-keys"><span class="r-key">10-year minus ${esc(shortLabel(c))}${since ? `, weekly since ${since}` : ''} · shaded: inverted</span></div>`
    : `${curveChart(lines, `${c.name} yield curve`)}<div class="r-keys">${lines.map(l => keyOf(l.label, l.color, l.width, l.dash, l.faint)).join('')}</div>`;
  // small enough to sit beside the card: the key numbers and a chart first, the explanation and the maturities below
  return `<div class="r-card r-pop" data-country="${esc(c.id)}"><div class="r-head"><h2>${logoOf(c)} ${esc(c.name)} <span class="r-muted">yield curve</span></h2>
      <span class="rt-state st-${esc(c.state || 'none')}">${st ? `${st.icon} ${st.label}` : '—'}</span></div>
    <div class="r-mini">10y <b>${fmtY(c.y10)}</b> · ${shortLabel(c)} <b>${fmtY(c.yShort)}</b> · gap <b>${fmtPP(c.slope)}</b>${c.slope3m != null && c.short !== '3m' ? ` · 10y−3m <b>${fmtPP(c.slope3m)}</b>` : ''} · ${dayLabel(c.date)}</div>
    <div class="r-mini r-mini2">${realPill(c)}${inflTag(c)}${rank ? `<span>${rank}</span>` : ''}</div>
    <div class="seg r-tabs" role="group" aria-label="Chart"><button data-rtab="curve" aria-pressed="${popTab === 'curve'}">Curve</button><button data-rtab="history" aria-pressed="${popTab === 'history'}">History</button></div>
    ${chart}
    <div class="r-more">
    <p class="r-says">${st ? `The 10-year yield is <b>${fmtY(c.y10)}</b> and the ${SHORT_WORDS[shortLabel(c)] || shortLabel(c)} <b>${fmtY(c.yShort)}</b>: a gap of <b>${fmtPP(c.slope)}</b>${rank ? `, ${rank}` : ''}. ${st.label}: ${st.note}.${c.state === 'inverted' && c.id === 'us' ? US_INVERTED : ''}` : 'No reading yet.'}${c.slope3m != null && c.short !== '3m' ? ` The 10-year minus the 3-month yield, the gap the US Federal Reserve watches most, is <b>${fmtPP(c.slope3m)}</b>.` : ''}${c.real != null ? ` After inflation (${inflNote(c)}), the 10-year pays <b>${fmtReal(c.real)}</b> a year.` : ''}</p>
    <details class="r-table"><summary>Every maturity</summary><table><thead><tr><th>Maturity</th><th>Yield</th><th>vs a month ago</th><th>vs a year ago</th></tr></thead><tbody>${rows}</tbody></table></details>
    <p class="r-src">${c.notRefreshed ? '⚠ The source didn’t answer in the latest check: showing its last curve. ' : ''}Source: <a href="${esc(c.srcUrl)}" target="_blank" rel="noopener">${esc(c.src)}</a>, closing yields of ${dayLabel(c.date)}.${c.note ? ' ' + esc(c.note) : ''}${c.infl ? ` Inflation: ${esc(c.infl.src)}, yearly change in consumer prices.` : ''}</p></div></div>`;
}
function monthHTML(m) {
  return `<div class="r-card r-pop" data-country="${esc(m.id)}"><div class="r-head"><h2>${logoOf(m)} ${esc(m.name)} <span class="r-muted">10-year, monthly</span></h2><span class="r-muted">📅 monthly</span></div>
    <div class="r-mini">${monthLabel(m.month)} <b>${fmtY(m.y10)}</b> · month <b>${fmtBp(m.chg1m)}</b> · year <b>${fmtBp(m.chg12m)}</b>${m.vsDE != null ? ` · vs Germany <b>${fmtPP(m.vsDE)}</b>` : ''}</div>
    <div class="r-mini r-mini2">${realPill(m)}${inflTag(m)}</div>
    ${monthChart(m)}
    <div class="r-keys">${keyOf(m.name, 'var(--blue, #2f6fd0)', 2.4)}${m.de ? keyOf('Germany', COLORS.de, 1.4, '5 4') : ''}</div>
    <div class="r-more">
    <p class="r-says">${esc(m.name)}’s 10-year government bond yield averaged <b>${fmtY(m.y10)}</b> in ${monthLabel(m.month, true)}: <b>${fmtBp(m.chg1m)}</b> on the month and <b>${fmtBp(m.chg12m)}</b> on the year${m.vsDE != null ? `, <b>${fmtPP(m.vsDE)}</b> above Germany’s (the gap investors watch as a measure of risk in the euro area)` : ''}.${m.real != null ? ` After inflation (${inflNote(m)}), it pays <b>${fmtReal(m.real)}</b> a year.` : ''}</p>
    <p class="r-src">${m.notRefreshed ? '⚠ The source didn’t answer in the latest check: showing the last figures. ' : ''}Source: <a href="https://data.ecb.europa.eu/data/datasets/IRS" target="_blank" rel="noopener">European Central Bank</a>, long-term interest rates for convergence purposes: the monthly average of the country’s benchmark 10-year government bond yield, published early the next month. No free source has these countries’ daily yields or whole curves, so there is no curve or normal / flat / inverted reading here.${m.infl ? ` Inflation: ${esc(m.infl.src)}.` : ''}</p></div></div>`;
}

/* ---------- "How to read" ---------- */
const HELP = `<div class="r-help" id="rhelp" hidden>
  <p><b>10-year yield:</b> what the government pays a year to borrow for ten years. <b>bp</b> = basis point, 0.01 percentage point (+25 bp: from 4.00% to 4.25%). <b>pp</b> = percentage point.</p>
  <p><b>Card colour:</b> the change in the 10-year yield over 1 day, 1 week or 1 month (the switch). Blue: yields rose, so bond prices fell; red: yields fell. The monthly European cards always show the change on the month.</p>
  <p><b>The reading</b> compares long and short rates: 10-year minus 2-year (UK: minus the Bank Rate, BR; South Africa: minus the 3-month bill). 🟢 Normal: +0.5 pp or more. 🟡 Flat: 0 to +0.5. 🔴 Inverted: below zero. “Steeper than 85% of the last 10 years” compares today’s gap with that country’s own history, which matters more than the fixed bands for a country whose curve is usually steep or usually flat. The popup also gives the 10-year minus 3-month gap where it exists.</p>
  <p><b>Real yield:</b> the 10-year yield minus the latest yearly inflation: roughly what a lender earns after rising prices. It makes Brazil’s 14% and Switzerland’s 0.6% comparable.</p>
  <p><b>The sketch</b> on each card is the shape of today’s curve, short maturities on the left; on the monthly cards it is the 10-year over the last year. A greyed date is more than 2 business days old.</p>
  <p><b>Europe, monthly:</b> countries with no free daily source, from the ECB’s monthly averages (no curve, so no reading), with the gap to Germany for euro members.</p>
</div>`;

/* ---------- drawing ---------- */
function render() {
  if (!R) return;
  const grid = $('#grid'), cs = sorted(R.countries, false), ms = sorted(R.monthly || [], true);
  $('#ratesTable').hidden = viewAs !== 'table';
  grid.hidden = viewAs === 'table';
  $('#ratesMonthly').hidden = viewAs === 'table' || !ms.length;
  if (viewAs === 'table') $('#ratesTable').innerHTML = tableHTML(cs, ms);
  else {
    if (groupBy === 'region') {
      grid.className = 'r-groups';
      grid.innerHTML = REGIONS.map(r => { const g = cs.filter(c => c.region === r); return g.length ? `<section class="r-group"><h3>${r}</h3><div class="grid rgrid">${g.map(tileHTML).join('')}</div></section>` : ''; }).join('')
        + (cs.some(c => !REGIONS.includes(c.region)) ? `<section class="r-group"><div class="grid rgrid">${cs.filter(c => !REGIONS.includes(c.region)).map(tileHTML).join('')}</div></section>` : '');
    } else { grid.className = 'grid rgrid'; grid.innerHTML = cs.map(tileHTML).join(''); }
    if (ms.length) $('#ratesMonthly').innerHTML = `<h2>Europe, monthly <span class="r-muted">📅 10-year yields only, the average of ${monthLabel(ms[0].month, true)} (ECB, published early each month): no free daily source has these countries. Colour: change on the month (the 1d / 1w / 1m switch doesn’t apply).</span></h2><div class="grid rgrid">${ms.map(mTileHTML).join('')}</div>`;
  }
  $$('#rtf button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === tf));
  $$('#rview button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === viewAs));
  $('#rsort').value = sortBy; $('#rgroup').value = groupBy;
  $('#rgroup').disabled = viewAs === 'table';
  const t = M.bins[tf];
  $('#rlegend').innerHTML = `${tf} change in the 10-year yield: <span class="scale">${[['h-4', `≤ −${t[3]}`], ['h-2', `−${t[1]}…${t[2]}`], ['h0', `±${t[0]}`], ['h2', `${t[1]}…${t[2]}`], ['h4', `≥ ${t[3]}`]].map(([k, l]) => `<span class="${k}">${l}</span>`).join('')}</span> bp · <b>blue = yields rose</b> (bond prices fell)`;
  // the address names the open market (?c=jp), so a link opens its curve
  const url = location.pathname + (sel ? '?c=' + encodeURIComponent(sel) : '');
  if (url !== location.pathname + location.search) history.replaceState(null, '', url);
}

// A market's curve in the shared popup (#detail), about two cards wide and two tall, beside its card (or table row).
// Two ways in, as on the price pages:
//   - pinned (a click or tap, or a ?c= link): the shared handlers close it (×, Escape, the backdrop, a click elsewhere);
//     S.pinned tells them it's open. A phone shows it as a bottom sheet (the CSS)
//   - preview (the mouse resting on a card): closes when the mouse moves away; a click pins it where it is
let previewId = null, previewAnchor = null;
const CARD = { w: 226, h: 128 };                     // when there's no card to measure (the table view)
function drawPopup(id, anchor) {
  const c = R?.countries.find(x => x.id === id), m = !c && R?.monthly?.find(x => x.id === id);
  if (!c && !m) return false;
  const box = $('#detail'), body = box.querySelector('.body');
  const card = anchor || $(`.rtile[data-id="${CSS.escape(id)}"]`) || $(`.r-row[data-id="${CSS.escape(id)}"]`);
  const cr = card?.getBoundingClientRect(), isCard = card?.classList.contains('rtile'), phone = innerWidth <= 640;
  const cw = isCard ? cr.width : CARD.w, ch = isCard ? cr.height : CARD.h;
  box.classList.add('show', 'r-compact');
  box.style.width = phone ? '' : Math.round(cw * 2 + 8) + 'px';
  box.style.maxHeight = phone ? '' : Math.round(ch * 2 + 8) + 'px';
  box.scrollTop = 0;
  W = Math.max(260, (body.clientWidth || 420)); H = phone ? 190 : 120;
  body.innerHTML = c ? detailHTML(c) : monthHTML(m);
  const bw = box.offsetWidth, bh = box.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 8, mg = 12;
  let left = (vw - bw) / 2, top = (vh - bh) / 2;
  if (cr) {                                 // to the side of the card if there's room, else below or above it
    if (cr.right + gap + bw <= vw - mg) { left = cr.right + gap; top = cr.top; }
    else if (cr.left - gap - bw >= mg) { left = cr.left - gap - bw; top = cr.top; }
    else { left = cr.left + cr.width / 2 - bw / 2; top = cr.bottom + gap + bh <= vh - mg ? cr.bottom + gap : cr.top - gap - bh; }
  }
  box.style.left = Math.min(Math.max(mg, left), Math.max(mg, vw - bw - mg)) + 'px';
  box.style.top = Math.min(Math.max(mg, top), Math.max(mg, vh - bh - mg)) + 'px';
  return true;
}
function openPopup(id, { pin = true, anchor = null } = {}) {
  const box = $('#detail');
  const pinning = pin && previewId === id && box.classList.contains('show') && !box.classList.contains('pinned');
  if (!pinning && !drawPopup(id, anchor)) return;   // (pinning the preview that's showing keeps it where it is)
  previewId = id; previewAnchor = anchor;
  if (!pin) return;
  sel = id;
  box.classList.add('pinned');
  $('#scrim').classList.add('show');
  S.pinned = 'rates:' + id;
  box.querySelector('.x').focus({ preventScroll: true });
  render();
}
// Curve | History inside the popup: redrawn in place (same size, same spot), remembered
function switchTab(tab) {
  popTab = tab; store.set('hm.ratesTab', tab);
  const box = $('#detail'), c = R?.countries.find(x => x.id === previewId);
  if (!c) return;
  const keep = [box.style.left, box.style.top];
  W = Math.max(260, box.querySelector('.body').clientWidth || 420);
  box.querySelector('.body').innerHTML = detailHTML(c);
  [box.style.left, box.style.top] = keep;
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
  $('main').insertAdjacentHTML('afterbegin', `<div class="r-bar">
    <div class="seg" id="rtf" role="group" aria-label="Change over">${TFS.map(([v]) => `<button data-v="${v}" aria-pressed="${v === tf}">${v}</button>`).join('')}</div>
    <div class="seg" id="rview" role="group" aria-label="View"><button data-v="cards">Cards</button><button data-v="table">Table</button></div>
    <label class="r-sel">Sort <select id="rsort">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    <label class="r-sel">Group <select id="rgroup"><option value="none">None</option><option value="region">Region</option></select></label>
    <button class="btn leg-toggle" id="rhelpBtn" aria-expanded="false" aria-controls="rhelp">ⓘ How to read</button>
    <span id="rlegend" class="leg-item"></span></div>${HELP}`);
  $('#grid').insertAdjacentHTML('afterend', `<section id="ratesMonthly" class="r-month" aria-label="Europe, monthly 10-year yields" hidden></section><section id="ratesTable" aria-label="Yields as a table" hidden></section>`);
  $('#detail').setAttribute('aria-label', 'Yield curve');
  const linked = new URLSearchParams(location.search).get('c');
  $('#rtf').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; tf = b.dataset.v; store.set('hm.ratesTf', tf); render(); });
  $('#rview').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; viewAs = b.dataset.v; store.set('hm.ratesView', viewAs); render(); });
  $('#rsort').addEventListener('change', e => { sortBy = e.target.value; store.set('hm.ratesSort', sortBy); render(); });
  $('#rgroup').addEventListener('change', e => { groupBy = e.target.value; store.set('hm.ratesGroup', groupBy); render(); });
  $('#rhelpBtn').addEventListener('click', e => { const open = $('#rhelp').hidden; $('#rhelp').hidden = !open; e.currentTarget.setAttribute('aria-expanded', open); e.currentTarget.textContent = open ? '✕ Hide' : 'ⓘ How to read'; });
  const pick = e => { const b = e.target.closest('[data-id]'); if (b && R) openPopup(b.dataset.id, { anchor: b }); };
  for (const el of ['#grid', '#ratesMonthly', '#ratesTable']) $(el).addEventListener('click', pick);
  $('#ratesTable').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.r-row')) pick(e); });
  // with a mouse, resting on a card for 0.7 s previews its curve beside it (as the price pages do); moving away closes
  // it unless the mouse goes onto the popup; a click on the card or the popup pins it
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  let openT = 0, hideT = 0;
  const hidePreview = () => { if (!S.pinned && !$('#detail').matches(':hover')) { $('#detail').classList.remove('show'); previewId = null; } };
  for (const el of [$('#grid'), $('#ratesMonthly')]) {
    el.addEventListener('mouseover', e => {
      const card = e.target.closest('.rtile[data-id]');
      if (!finePointer.matches || !card || S.pinned || card.contains(e.relatedTarget)) return;
      clearTimeout(openT); clearTimeout(hideT);
      openT = setTimeout(() => { if (!S.pinned && card.matches(':hover')) openPopup(card.dataset.id, { pin: false, anchor: card }); }, 700);
    });
    el.addEventListener('mouseout', e => {
      const card = e.target.closest('.rtile[data-id]');
      if (!card || card.contains(e.relatedTarget)) return;
      clearTimeout(openT);
      hideT = setTimeout(hidePreview, 250);
    });
  }
  $('#detail').addEventListener('mouseenter', () => clearTimeout(hideT));
  $('#detail').addEventListener('mouseleave', () => { hideT = setTimeout(hidePreview, 250); });
  $('#detail').addEventListener('click', e => {
    const tab = e.target.closest('[data-rtab]');
    if (tab) switchTab(tab.dataset.rtab);
    if (!S.pinned && previewId && !e.target.closest('.x')) openPopup(previewId, { anchor: previewAnchor });
  });
  // closed by the shared handlers: forget the market (and take it off the address)
  new MutationObserver(() => {
    const box = $('#detail');
    if (!box.classList.contains('show')) previewId = null;
    if (sel && !box.classList.contains('pinned')) { sel = null; render(); }
  }).observe($('#detail'), { attributes: true, attributeFilter: ['class'] });
  load().then(() => { if (linked) openPopup(linked); });
  let rz = 0;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
  setInterval(() => { renderFresh(); if (!document.hidden && Date.now() - loadedAt > REFRESH) load(); }, 30e3);
}
