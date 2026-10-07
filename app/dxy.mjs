// heat.sala.company page script: the US Dollar Index bar above the forex grid (see app/main.mjs for the order things start in)
// DXY is computed here from the six ECB rates already in forex.json (dxySeries in scripts/build-forex.mjs): no extra
// requests. It's context, not a tile: not in the filters, counts, basket or scorecard. It always reads "rising = the
// dollar gained", whichever way the pairs are quoted on screen, since it's an index of the dollar itself.
import { dxySeries, DXY_WEIGHTS } from '/scripts/build-forex.mjs';
import { compute, P } from './data.mjs';
import { $, esc, fmtPct, heatClass, S, TF } from './core.mjs';
import { linePath } from './interact.mjs';
import { chartUrl } from '/scripts/tradingview.mjs';

const NAMES = { eur: 'euro', jpy: 'yen', gbp: 'pound', cad: 'Canadian dollar', sek: 'krona', chf: 'franc' };
const ABOUT = `Calculated here with ICE's formula from the daily ECB rates of six currencies: ${Object.entries(DXY_WEIGHTS).map(([k, w]) => `${NAMES[k]} ${(w * 100).toFixed(1)}%`).join(', ')}. `
  + 'Rising means the dollar gained on them. It updates once a business day, at the ECB fix (14:15 Frankfurt). '
  + 'Its level and weekly moves track the official index (ICE futures, traded around the clock) closely, but a 1-day change runs from one ECB fix to the next, '
  + 'so it can differ from the official index\'s daily change (which closes at 17:00 New York).';
// Checked against the official closes (Yahoo DX-Y.NYB), 43 business days to 2026-10-07: level within 0.04% on average
// (0.63% at most), weekly changes correlate 0.92, daily changes only 0.5 (the 9-hour gap between the ECB fix and the close).

let ser = null, ind = null, rawSeen = null;
// The last 120 business days with the fast moving average, scaled to fit
function spark(i) {
  const N = Math.min(120, i.n), s = i.n - N, W = 160, H = 34;
  const c = i.c.slice(s), ma = i.maF.slice(s);
  const all = [...c, ...ma].filter(v => v != null), lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 0.1;
  const x = k => k / (N - 1) * W, y = v => H - (v - lo + pad) / (hi - lo + 2 * pad) * H;
  return `<svg class="dxy-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="US Dollar Index, last ${N} business days, with its ${P().maFast}-day moving average">
    <path d="${linePath(ma, x, y)}" fill="none" stroke="var(--s-ma50)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    <path d="${linePath(c, x, y)}" fill="none" stroke="var(--s-price)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

export function renderDxy() {
  const el = $('#dxy');
  if (!el) return;
  if (S.raw !== rawSeen) {                     // recompute only when new data arrives; a timeframe change just redraws
    rawSeen = S.raw;
    ser = dxySeries(S.raw?.hist);
    ind = ser && ser.length >= 30 ? compute(ser) : null;
  }
  el.hidden = !ind || S.view === 'score';
  if (el.hidden) return;
  const ch = ind.chg[S.colorBy];
  const date = new Date(ind.t[ind.n - 1]).toISOString().slice(0, 10);
  const trend = ind.trend
    ? `<span class="${ind.trend === 'up' ? 'up-t' : 'dn-t'}">${ind.trend === 'up' ? '▲ Uptrend' : '▼ Downtrend'}</span> <span class="s">${P().maFast}/${P().maSlow} MA${ind.strong ? '' : ind.trend === 'up' ? ', pullback' : ', bounce'}</span>`
    : '';
  el.innerHTML = `
    <div class="dxy-name" title="${esc(ABOUT)}"><b>US Dollar Index</b> <span class="s">DXY · from ECB rates ⓘ</span></div>
    <div class="dxy-val">${ind.last.toFixed(2)}</div>
    <span class="dxy-chg ${heatClass(ch, S.colorBy)}" title="${esc(`${TF(S.colorBy)} change, to the ${date} ECB rates`)}">${fmtPct(ch)}</span>
    <span class="dxy-tfs">${['24h', '7d', '30d'].filter(tf => tf !== S.colorBy).map(tf => `<span>${TF(tf)} <b class="${(ind.chg[tf] ?? 0) >= 0 ? 'up-t' : 'dn-t'}">${fmtPct(ind.chg[tf])}</b></span>`).join('')}</span>
    ${spark(ind)}
    <span class="dxy-ind">${trend}${ind.rsiNow != null ? `<span>RSI ${ind.rsiNow.toFixed(0)}${ind.rsiState === 'os' ? ' · Oversold' : ind.rsiState === 'ob' ? ' · Overbought' : ''}</span>` : ''}</span>
    <a class="dxy-tv" href="${chartUrl('TVC:DXY')}" target="_blank" rel="noopener noreferrer" title="The official index (ICE) on TradingView">TradingView ↗</a>`;
}
