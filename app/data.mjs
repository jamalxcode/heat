// heat.sala.company page script: data (split from index.html; see app/main.mjs for the order things start in)
import * as SIG from '/signals.mjs';
import { DAY, M, S, TOP_N } from './core.mjs';
import { updateCoin } from './render.mjs';

/* ================= data ================= */
// Everything normally comes from data.json, rebuilt every 10 minutes by GitHub Actions. If that file is missing or
// stale, the page runs the same build script (scripts/build-data.mjs) itself: see buildLive() below.
export function pickCoins() {
  const cats = { stable: [...S.stable], gold: [...S.gold] };
  S.excluded = [];
  const list = [];
  for (const c of S.markets) {
    if (!S.pegged && SIG.isPegged(c, cats)) { S.excluded.push(c); continue; }
    if (list.length < TOP_N) list.push(c);
  }
  S.coins = list;
}

// Swap today's (still forming) candle close for the latest price, so indicators track the market between candle fetches.
// Forex has no live price: the last ECB rate is the last close.
export function withLive(closes, price) {
  if (!M.live || !(price > 0) || !closes.length) return closes;
  const out = closes.slice(), last = out[out.length - 1];
  const today = Math.floor(Date.now() / DAY), day = Math.floor(last[0] / DAY);
  if (day === today) out[out.length - 1] = [last[0], price];
  else if (day === today - 1) out.push([today * DAY, price]);
  return out;
}
export function setHist(c, h) {
  S.hist[c.id] = h;
  S.ind[c.id] = compute(withLive(h.closes, c.current_price));
  updateCoin(c);
}
// Compute every tile from the candles we have; coins without any show a note
export function applyHist() {
  for (const c of S.coins) {
    if (S.hist[c.id]) setHist(c, S.hist[c.id]);
    else { S.ind[c.id] = { error: true }; updateCoin(c); }
  }
}

/* ================= indicators (shared engine: signals.mjs) ================= */
// Signal settings: tuned weekly by the scorer and shipped in data.json; defaults until the first tuning
export const P = () => S.params;
export function compute(ser) {
  const p = P();
  const t = ser.map(x => x[0]), c = ser.map(x => x[1]);
  const n = c.length, last = c[n - 1];
  const s = SIG.series(c, p);
  const r = { t, c, rsi: s.rsi, maF: s.maF, maS: s.maS, bb: s.bb, n, last };
  const back = k => n - 1 - k >= 0 ? (last / c[n - 1 - k] - 1) * 100 : null;
  r.chg = { '24h': back(M.back['24h']), '7d': back(M.back['7d']), '30d': back(M.back['30d']) };

  r.rsiNow = s.rsi[n - 1];
  r.rsiState = r.rsiNow == null ? null : r.rsiNow < p.rsiLow ? 'os' : r.rsiNow > p.rsiHigh ? 'ob' : 'mid';
  // point & figure trend: the direction of the latest column (same chart as the popup's P&F view)
  const pfOff = Math.max(0, n - SIG.PNF_WINDOW), pf = SIG.pointFigure(c.slice(pfOff)), pfLast = pf.cols[pf.cols.length - 1];   // same window the scorer uses
  r.pnf = pfLast ? { ...pf.now, since: pfOff + pfLast.start, boxes: pfLast.hi - pfLast.lo + 1, signal: pf.lastSignal } : null;

  const mF = s.maF[n - 1], mS = s.maS[n - 1];
  r.mF = mF; r.mS = mS;
  if (mF != null && mS != null) {
    r.trend = mF > mS ? 'up' : 'down';
    r.strong = r.trend === 'up' ? last > mF : last < mF;
    for (let i = n - 1; i >= Math.max(n - 14, p.maSlow); i--) {
      const a = s.maF[i] - s.maS[i], b = s.maF[i - 1] - s.maS[i - 1];
      if (Math.sign(a) !== Math.sign(b)) { r.cross = { type: a > 0 ? 'golden' : 'death', ago: n - 1 - i }; break; }
    }
  } else if (mF != null) {
    r.trend = null; r.partial = last > mF ? 'above' : 'below';
  }

  const w = s.bb.w[n - 1];
  if (w != null && s.bbPct[n - 1] != null) {
    r.bbw = w;
    r.bbPct = s.bbPct[n - 1];
    r.bbState = r.bbPct <= p.bbTightPct ? 'tight' : r.bbPct <= Math.max(25, p.bbTightPct) ? 'squeeze' : r.bbPct >= p.bbWidePct ? 'expanded' : 'normal';
    r.bbShort = s.bb.w.slice(-p.bbLookback).filter(x => x != null).length < 90;
  }
  // 🚀 / 😢: exactly what the daily scorecard measures
  r.sig = SIG.scoreOf(SIG.componentsAt(s, n - 1, p), p);

  // Recommended stops: set once a day from the last completed close, so they don't move with every refresh.
  // Today's candle is still forming, so anchor on the one before it.
  const anchor = M.live && Math.floor(t[n - 1] / DAY) >= Math.floor(Date.now() / DAY) ? n - 2 : n - 1;
  const lv = anchor > 0 ? SIG.stopLevels(c, anchor, p) : null;
  const prev = anchor > 1 ? SIG.stopLevels(c, anchor - 1, p) : null;   // the stop that applied during the last full day
  if (lv) {
    const room = (a, b) => (a - b) / (lv.anchor * lv.dist);         // share of the stop distance still left
    // 'closed'   = the last daily close finished past the stop that applied that day: exit (what the scorecard measures)
    // 'intraday' = the live price is past today's stop, but no daily close has confirmed it yet: watch
    const closedLong = !!prev && c[anchor] < prev.long, closedShort = !!prev && c[anchor] > prev.short;
    r.stop = {
      ...lv, anchorIdx: anchor, prevLong: prev?.long, prevShort: prev?.short,
      longPct: (lv.long / last - 1) * 100, shortPct: (lv.short / last - 1) * 100,
      longState: closedLong ? 'closed' : last <= lv.long ? 'intraday' : room(last, lv.long) < 0.25 ? 'near' : 'ok',
      shortState: closedShort ? 'closed' : last >= lv.short ? 'intraday' : room(lv.short, last) < 0.25 ? 'near' : 'ok',
    };
  }
  return r;
}

export const match = (ind, f) => {
  if (f === 'all') return true;
  if (!ind || ind.error) return false;
  switch (f) {
    case 'os': return ind.rsiState === 'os';
    case 'ob': return ind.rsiState === 'ob';
    case 'up': return ind.trend === 'up';
    case 'down': return ind.trend === 'down';
    case 'sq': return ind.bbState === 'tight' || ind.bbState === 'squeeze';
    case 'cross': return !!ind.cross;
    case 'stop': return ind.stop?.longState === 'closed' || ind.stop?.shortState === 'closed';
  }
  return true;
};

