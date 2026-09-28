// Shared signal engine for heat.sala.company: used by the page, the daily scorer and the weekly tuner,
// so the 🚀 / 😢 you see are exactly the ones that get scored and tuned. No dependencies; runs in browsers and Node.

export const DEFAULT_PARAMS = {
  rsiPeriod: 14, rsiLow: 30, rsiHigh: 70,
  maFast: 50, maSlow: 200,
  bbPeriod: 20, bbK: 2, bbLookback: 180, bbTightPct: 10, bbWidePct: 80,
  // Recommended stop-loss: stopMult × the coin's average daily move over the last stopLookback days
  stopMult: 2, stopLookback: 20,
  // Momentum: the coin's move over the last 30 days is above +momPct% (momUp) or below −momPct% (momDown)
  momPct: 20,
  // +1 = counts as a 🚀, -1 = counts as a 😢, 0 = switched off. The tuner may flip or disable a signal.
  // Momentum starts off: it's on trial, and the tuner switches it on only if it proves itself on unseen data.
  weights: { trendUp: 1, oversold: 1, trendDown: -1, overbought: -1, bbWide: -1, momUp: 0, momDown: 0 },
};

// Directional signals: each one adds a 🚀 or a 😢 (or nothing while its weight is 0)
export const COMPONENTS = {
  trendUp:    'strong uptrend',
  oversold:   'RSI oversold',
  trendDown:  'strong downtrend',
  overbought: 'RSI overbought',
  bbWide:     'wide Bollinger band',
  momUp:      'strong 30-day momentum',
  momDown:    'weak 30-day momentum',
};

// Stop distances the tuner compares (× the average daily move)
export const STOP_MULTS = [1.5, 2, 2.5];
// Non-directional: a Bollinger squeeze says a big move is likely, not which way, so it's ⚡ rather than 🚀 or 😢
export const SQUEEZE_LABEL = 'tight Bollinger band (big move likely, direction unknown)';

// How far ahead each signal is judged, in days
export const HORIZONS = [1, 3, 7];

export const withDefaults = p => {
  const out = { ...DEFAULT_PARAMS, ...(p || {}), weights: { ...DEFAULT_PARAMS.weights } };
  for (const k of Object.keys(COMPONENTS)) if (p?.weights?.[k] != null) out.weights[k] = p.weights[k];
  return out;
};

/* ---------- indicators (full series, null until warmed up) ---------- */
export function sma(a, n) {
  const out = new Array(a.length).fill(null);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= n) s -= a[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

// Wilder's RSI
export function rsi(a, n = 14) {
  const out = new Array(a.length).fill(null);
  if (a.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

// Bollinger Bands (population standard deviation); w = band width as % of the middle band
export function bollinger(a, n = 20, k = 2) {
  const mid = sma(a, n), up = [], lo = [], w = [];
  for (let i = 0; i < a.length; i++) {
    if (mid[i] == null) { up.push(null); lo.push(null); w.push(null); continue; }
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (a[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd); w.push((2 * k * sd) / mid[i] * 100);
  }
  return { mid, up, lo, w };
}

// Percentile rank (0-100) of each width within its trailing `lookback` window, current value included
export function rollingPct(w, lookback) {
  const out = new Array(w.length).fill(null);
  for (let i = 0; i < w.length; i++) {
    if (w[i] == null) continue;
    let n = 0, below = 0;
    for (let j = Math.max(0, i - lookback + 1); j <= i; j++) if (w[j] != null) { n++; if (w[j] <= w[i]) below++; }
    if (n >= 20) out[i] = below / n * 100;
  }
  return out;
}

export function series(closes, p) {
  const P = withDefaults(p);
  const bb = bollinger(closes, P.bbPeriod, P.bbK);
  return {
    c: closes,
    rsi: rsi(closes, P.rsiPeriod),
    maF: sma(closes, P.maFast),
    maS: sma(closes, P.maSlow),
    bb,
    bbPct: rollingPct(bb.w, P.bbLookback),
  };
}

// Which signals are on at candle i (null = not enough history for that signal)
export function componentsAt(s, i, p) {
  const P = withDefaults(p);
  const c = s.c[i], r = s.rsi[i], f = s.maF[i], sl = s.maS[i], q = s.bbPct[i];
  const trend = f != null && sl != null;
  const m30 = i >= 30 ? (c / s.c[i - 30] - 1) * 100 : null;
  return {
    momUp:      m30 != null ? m30 >= P.momPct : null,
    momDown:    m30 != null ? m30 <= -P.momPct : null,
    trendUp:    trend ? f > sl && c > f : null,
    trendDown:  trend ? f < sl && c < f : null,
    oversold:   r != null ? r < P.rsiLow : null,
    overbought: r != null ? r > P.rsiHigh : null,
    bbWide:     q != null ? q >= P.bbWidePct : null,
    squeeze:    q != null ? q <= P.bbTightPct : null,
  };
}

export function scoreOf(active, p) {
  const P = withDefaults(p);
  const good = [], bad = [];
  for (const k of Object.keys(COMPONENTS)) {
    if (!active[k]) continue;
    const wgt = P.weights[k] || 0;
    if (wgt > 0) good.push(k); else if (wgt < 0) bad.push(k);
  }
  return { good, bad, score: good.length - bad.length, squeeze: !!active.squeeze };
}

/* ---------- recommended stop-loss ---------- */
// Distance (as a fraction of price) = stopMult × average absolute daily move over the last stopLookback closes.
// Roughly 3% for BTC and 7% for a typical top-50 coin.
export function stopDistance(closes, i, p) {
  const P = withDefaults(p), n = P.stopLookback;
  if (i < n) return null;
  let s = 0;
  for (let j = i - n + 1; j <= i; j++) s += Math.abs(closes[j] / closes[j - 1] - 1);
  return P.stopMult * s / n;
}
// Levels anchored at close i: exit a long below `long`, exit a short above `short`
export function stopLevels(closes, i, p) {
  const d = stopDistance(closes, i, p);
  if (d == null) return null;
  const c = closes[i];
  return { dist: d, anchor: c, long: c * (1 - d), short: c * (1 + d) };
}

/* ---------- evaluation ---------- */
const DAY = 864e5;
const cap = h => 0.3 * Math.sqrt(h);   // ±30% a day, wider for longer horizons: stops one bad print swamping averages

// coins: [{ id, symbol, t0 (ms, UTC midnight of first close), c: [daily closes, complete days only] }]
// One row per coin per day: the signals at that close and the move over the following 1 / 3 / 7 days.
export function signalRows(coins, p) {
  const P = withDefaults(p);
  const warm = Math.max(P.maSlow, P.bbPeriod + 20, P.rsiPeriod + 1);
  const rows = [];
  for (const coin of coins) {
    const s = series(coin.c, P);
    const d0 = Math.floor(coin.t0 / DAY), n = coin.c.length;
    for (let i = warm; i < n - 1; i++) {
      const a = componentsAt(s, i, P);
      if (Object.values(a).some(v => v == null)) continue;
      const { good, bad, score, squeeze } = scoreOf(a, P);
      const raw = {}, ret = {};
      for (const h of HORIZONS) {
        if (i + h >= n) { raw[h] = ret[h] = null; continue; }
        raw[h] = coin.c[i + h] / coin.c[i] - 1;
        ret[h] = Math.max(-cap(h), Math.min(cap(h), raw[h]));
      }
      // Stops set at this close: were they crossed (on a daily close) within h days? And after the exit, did price
      // keep going the wrong way for another h days (good exit) or come back (shaken out)? null = too recent to tell.
      const stopD = stopDistance(coin.c, i, P), stop = {};
      if (stopD != null) {
        const lo = coin.c[i] * (1 - stopD), hi = coin.c[i] * (1 + stopD);
        for (const h of HORIZONS) {
          if (i + h >= n) { stop[h] = null; continue; }
          let jL = -1, jS = -1;
          for (let k = i + 1; k <= i + h; k++) {
            if (jL < 0 && coin.c[k] < lo) jL = k;
            if (jS < 0 && coin.c[k] > hi) jS = k;
          }
          const after = (j, dir) => j < 0 || j + h >= n ? null : dir < 0 ? coin.c[j + h] < coin.c[j] : coin.c[j + h] > coin.c[j];
          // how much the exit saved over the next h days (negative = it cost you: price came back)
          const saved = (j, dir) => j < 0 || j + h >= n ? null : dir < 0 ? (coin.c[j] - coin.c[j + h]) / coin.c[j] : (coin.c[j + h] - coin.c[j]) / coin.c[j];
          stop[h] = { longHit: jL >= 0, longGood: after(jL, -1), longSaved: saved(jL, -1), shortHit: jS >= 0, shortGood: after(jS, 1), shortSaved: saved(jS, 1) };
        }
      }
      rows.push({ day: d0 + i, id: coin.id, sym: coin.symbol, a, good, bad, score, squeeze, raw, ret, mkt: {}, exc: {}, stopD, stop });
    }
  }
  // excess = coin's move minus the average of every coin over the same days (removes the market's move)
  for (const list of byDay(rows).values()) {
    for (const h of HORIZONS) {
      const g = list.filter(r => r.ret[h] != null);
      const m = g.length ? g.reduce((s, r) => s + r.ret[h], 0) / g.length : null;
      for (const r of list) { r.mkt[h] = m; r.exc[h] = r.ret[h] == null ? null : r.ret[h] - m; }
    }
  }
  return rows;
}

function byDay(rows) {
  const m = new Map();
  for (const r of rows) { if (!m.has(r.day)) m.set(r.day, []); m.get(r.day).push(r); }
  return m;
}
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
function tStat(a) {
  if (a.length < 3) return 0;
  const m = mean(a), v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
  return v > 0 ? m / Math.sqrt(v / a.length) : 0;
}
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
export function spearman(x, y) {
  const rx = ranks(x), ry = ranks(y), mx = mean(rx), my = mean(ry);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : null;
}
// Per-day averages, so one wild day (or 50 coins moving together) counts once, not 50 times
function dailyMeans(rows, f) {
  const m = new Map();
  for (const r of rows) { const v = f(r); if (v == null) continue; if (!m.has(r.day)) m.set(r.day, []); m.get(r.day).push(v); }
  return [...m.values()].map(mean);
}

// Stats for one horizon h (days). Multi-day moves overlap from one day to the next, so t-values are divided
// by √h: without that, a 7-day horizon would look ~2.6× more certain than it is.
export function stats(rows, h = 1) {
  rows = rows.filter(r => r.ret[h] != null);
  const adj = Math.sqrt(h);
  const days = [...new Set(rows.map(r => r.day))].sort((a, b) => a - b);
  const out = { h, rows: rows.length, days: days.length, from: days[0] ?? null, to: days[days.length - 1] ?? null };
  const up = g => g.length ? g.filter(r => r.ret[h] > 0).length / g.length : null;
  const beat = g => g.length ? g.filter(r => r.exc[h] > 0).length / g.length : null;

  // by net score (🚀 minus 😢), clamped to ±3
  out.byScore = {};
  for (let s = -3; s <= 3; s++) {
    const g = rows.filter(r => Math.max(-3, Math.min(3, r.score)) === s);
    out.byScore[s] = g.length ? { n: g.length, avgRet: mean(g.map(r => r.ret[h])), avgExc: mean(g.map(r => r.exc[h])), upRate: up(g), beatRate: beat(g) } : { n: 0 };
  }

  // each signal on its own: how did coins do after it fired?
  out.components = {};
  for (const k of Object.keys(COMPONENTS)) {
    const g = rows.filter(r => r.a[k]);
    const dm = dailyMeans(g, r => r.exc[h]);
    out.components[k] = g.length ? { n: g.length, avgRet: mean(g.map(r => r.ret[h])), avgExc: mean(dm), t: tStat(dm) / adj, upRate: up(g), beatRate: beat(g) } : { n: 0 };
  }

  // Recommended stops: how often were they crossed within h days, and was getting out the right call?
  const st = rows.filter(r => r.stop?.[h]);
  const side = k => {
    const hits = st.filter(r => r.stop[h][k + 'Hit']), judged = hits.filter(r => r.stop[h][k + 'Good'] != null);
    return { hitRate: st.length ? hits.length / st.length : null, goodRate: judged.length ? judged.filter(r => r.stop[h][k + 'Good']).length / judged.length : null, hits: hits.length, avgSaved: mean(judged.map(r => r.stop[h][k + 'Saved'])) };
  };
  out.stops = { n: st.length, avgDist: mean(st.map(r => r.stopD)), long: side('long'), short: side('short') };

  // ⚡ squeeze: are the following moves really bigger than usual?
  const sq = rows.filter(r => r.squeeze);
  const absAll = mean(rows.map(r => Math.abs(r.ret[h]))), absSq = mean(sq.map(r => Math.abs(r.ret[h])));
  out.squeeze = { n: sq.length, avgAbs: absSq, baseAbs: absAll, ratio: absSq != null && absAll ? absSq / absAll : null, upRate: up(sq) };

  // headline hit rates
  const pos = rows.filter(r => r.score > 0), neg = rows.filter(r => r.score < 0);
  out.rockets = { n: pos.length, upRate: up(pos), beatRate: beat(pos), avgRet: mean(pos.map(r => r.ret[h])), avgExc: mean(pos.map(r => r.exc[h])) };
  out.sad = { n: neg.length, downRate: neg.length ? neg.filter(r => r.ret[h] < 0).length / neg.length : null, lagRate: neg.length ? neg.filter(r => r.exc[h] < 0).length / neg.length : null, avgRet: mean(neg.map(r => r.ret[h])), avgExc: mean(neg.map(r => r.exc[h])) };
  out.all = { avgRet: mean(rows.map(r => r.ret[h])), upRate: up(rows) };

  // information coefficient: daily rank correlation between score and excess move
  const ics = [];
  for (const g of byDay(rows).values()) {
    if (g.length < 10 || new Set(g.map(r => r.score)).size < 2) continue;
    const v = spearman(g.map(r => r.score), g.map(r => r.exc[h]));
    if (v != null) ics.push(v);
  }
  out.ic = { mean: mean(ics), t: tStat(ics) / adj, days: ics.length };
  return out;
}

/* ---------- tuning ---------- */
// For each signal, pick its setting and whether it's a 🚀, a 😢 or off, using only days before `until`.
// A signal is switched on only if its effect clears |t| ≥ minT on average across the 1/3/7-day horizons;
// the bar is above the usual 2 because about 30 variants get tried, and some would clear 2 by luck.
function selectParams(cur, rowsFor, until, minT) {
  const next = withDefaults(cur), notes = [];
  const effect = (rows, k) => {
    let tSum = 0, avgSum = 0, n = Infinity;
    for (const h of HORIZONS) {
      const dm = dailyMeans(rows.filter(r => r.day < until && r.a[k]), r => r.exc[h]);
      tSum += tStat(dm) / Math.sqrt(h); avgSum += mean(dm) ?? 0; n = Math.min(n, dm.length);
    }
    return { t: tSum / HORIZONS.length, avg: avgSum / HORIZONS.length, n };
  };
  const setSign = (k, e) => {
    next.weights[k] = Math.abs(e.t) >= minT ? Math.sign(e.avg) : 0;
    notes.push(`${COMPONENTS[k]}: ${next.weights[k] > 0 ? '🚀' : next.weights[k] < 0 ? '😢' : 'off'} (t=${e.t.toFixed(2)}, ${(e.avg * 100).toFixed(2)}% vs market, avg over 1/3/7 days)`);
  };
  const best = (variants, k) => {
    let b = null;
    for (const v of variants) {
      const e = effect(rowsFor({ ...next, ...v }), k);
      if (e.n >= 20 && (!b || Math.abs(e.t) > Math.abs(b.e.t))) b = { v, e };
    }
    return b;
  };

  // RSI: the period is shared by both sides, each threshold chosen on its own
  let bestRsi = null;
  for (const rsiPeriod of [7, 14, 21]) {
    const lo = best([20, 25, 30, 35].map(rsiLow => ({ rsiPeriod, rsiLow })), 'oversold');
    const hi = best([65, 70, 75, 80].map(rsiHigh => ({ rsiPeriod, rsiHigh })), 'overbought');
    const t = Math.abs(lo?.e.t || 0) + Math.abs(hi?.e.t || 0);
    if (!bestRsi || t > bestRsi.t) bestRsi = { rsiPeriod, lo, hi, t };
  }
  if (bestRsi) {
    next.rsiPeriod = bestRsi.rsiPeriod;
    if (bestRsi.lo) { next.rsiLow = bestRsi.lo.v.rsiLow; setSign('oversold', bestRsi.lo.e); }
    if (bestRsi.hi) { next.rsiHigh = bestRsi.hi.v.rsiHigh; setSign('overbought', bestRsi.hi.e); }
  }

  // Trend: which moving-average pair
  let bestPair = null;
  for (const v of [{ maFast: 20, maSlow: 50 }, { maFast: 20, maSlow: 100 }, { maFast: 50, maSlow: 200 }]) {
    const rows = rowsFor({ ...next, ...v });
    const u = effect(rows, 'trendUp'), d = effect(rows, 'trendDown');
    const t = Math.abs(u.t) + Math.abs(d.t);
    if (u.n >= 20 && d.n >= 20 && (!bestPair || t > bestPair.t)) bestPair = { v, u, d, t };
  }
  if (bestPair) { Object.assign(next, bestPair.v); setSign('trendUp', bestPair.u); setSign('trendDown', bestPair.d); }

  // Wide Bollinger band threshold (the ⚡ squeeze threshold stays fixed: it isn't a direction call)
  const wide = best([75, 80, 85, 90, 95].map(bbWidePct => ({ bbWidePct })), 'bbWide');
  if (wide) { next.bbWidePct = wide.v.bbWidePct; setSign('bbWide', wide.e); }

  // Momentum (on trial): which 30-day threshold, and whether strong/weak momentum should be a 🚀, a 😢 or off
  let bestMom = null;
  for (const momPct of [10, 20, 30]) {
    const rows = rowsFor({ ...next, momPct });
    const u = effect(rows, 'momUp'), d = effect(rows, 'momDown');
    const t = Math.abs(u.t) + Math.abs(d.t);
    if (u.n >= 20 && d.n >= 20 && (!bestMom || t > bestMom.t)) bestMom = { momPct, u, d, t };
  }
  if (bestMom) { next.momPct = bestMom.momPct; setSign('momUp', bestMom.u); setSign('momDown', bestMom.d); }
  return { params: next, notes };
}

// Average information coefficient across the 1/3/7-day horizons, on days in [from, to).
// Settings that make no calls at all (every signal off) score 0: no edge, rather than "unknown".
function objective(rows, from, to) {
  const g = rows.filter(r => r.day >= from && r.day < to);
  return mean(HORIZONS.map(h => stats(g, h).ic.mean ?? 0));
}

// Walk-forward in several folds: the newest half of history is cut into `folds` check periods. For each one, settings
// are chosen only on the days before it, then compared with the current settings on it. The new settings (chosen on
// all history) are adopted only if that procedure beat the current settings in most folds and on average.
export function tune(coins, current, { folds = 3, minT = 2.5, margin = 0.003 } = {}) {
  const cur = withDefaults(current);
  const cache = new Map();
  const rowsFor = p => { const k = JSON.stringify(withDefaults(p)); if (!cache.has(k)) cache.set(k, signalRows(coins, p)); return cache.get(k); };

  const days = [...new Set(rowsFor(cur).map(r => r.day))].sort((a, b) => a - b);
  const start = Math.floor(days.length * 0.5), block = Math.floor((days.length - start) / folds);
  const results = [];
  for (let k = 0; k < folds; k++) {
    const from = days[start + k * block], to = k === folds - 1 ? Infinity : days[start + (k + 1) * block];
    const sel = selectParams(cur, rowsFor, from, minT).params;
    const before = objective(rowsFor(cur), from, to), after = objective(rowsFor(sel), from, to);
    results.push({ from, to: Number.isFinite(to) ? to - 1 : days[days.length - 1], before, after, won: after > before });
  }
  const avg = f => mean(results.map(f));
  const before = avg(r => r.before), after = avg(r => r.after), wins = results.filter(r => r.won).length;

  const final = selectParams(cur, rowsFor, Infinity, minT);
  const anyOn = Object.values(final.params.weights).some(w => w !== 0);
  const changed = JSON.stringify(final.params) !== JSON.stringify(cur);
  const adopt = changed && anyOn && after > 0 && after > before + margin && wins >= Math.ceil(folds / 2);

  // Stop distance: on the same check periods, which multiplier's exits saved the most over the next 3 days
  // (averaged over long and short exits; negative = exits were mostly shake-outs)? Switch only if one beats the
  // current multiplier in most periods and on average by at least 0.1%.
  const stopScore = (m, from, to) => {
    const v = [];
    for (const r of rowsFor({ ...cur, stopMult: m })) {
      if (r.day < from || r.day >= to || !r.stop?.[3]) continue;
      for (const k of ['longSaved', 'shortSaved']) if (r.stop[3][k] != null) v.push(r.stop[3][k]);
    }
    return v.length ? mean(v) : 0;
  };
  const periods = results.map(f => [f.from, f.to + 1]);
  const stopTable = STOP_MULTS.map(m => ({ m, perFold: periods.map(([a, b]) => stopScore(m, a, b)) }));
  const curRow = stopTable.find(s => s.m === cur.stopMult) || { m: cur.stopMult, perFold: periods.map(([a, b]) => stopScore(cur.stopMult, a, b)) };
  let bestStop = null;
  for (const s of stopTable) {
    if (s.m === cur.stopMult) continue;
    const winsS = s.perFold.filter((v, i) => v > curRow.perFold[i]).length, gain = mean(s.perFold) - mean(curRow.perFold);
    if (winsS >= Math.ceil(folds / 2) && gain >= 0.001 && (!bestStop || gain > bestStop.gain)) bestStop = { m: s.m, wins: winsS, gain };
  }
  const stop = { adopt: !!bestStop, from: cur.stopMult, to: bestStop?.m ?? cur.stopMult, table: stopTable.map(s => ({ m: s.m, avg: mean(s.perFold) })), wins: bestStop?.wins ?? 0 };

  const params = withDefaults(adopt ? final.params : cur);
  if (stop.adopt) params.stopMult = stop.to;
  return {
    adopt, params, proposed: final.params, notes: final.notes, stop,
    folds: results, wins, split: { trainFrom: days[0], cut: days[start], testTo: days[days.length - 1] },
    testIC: { before, after },
  };
}

/* ---------- the daily scorecard ---------- */
const isoDay = d => new Date(d * DAY).toISOString().slice(0, 10);
// coins: complete daily closes only. Returns { card, newParams } where newParams is set only if the tuner adopted settings.
export function buildScorecard(coins, current, { prev = null, tuneNow = false, now = Date.now() } = {}) {
  const params = withDefaults(current);
  const rows = signalRows(coins, params);
  const lastDay = Math.max(...rows.filter(r => r.ret[1] != null).map(r => r.day)); // latest close whose next day is complete
  const since = n => rows.filter(r => r.day > lastDay - n);
  const y = rows.filter(r => r.day === lastDay).sort((a, b) => b.score - a.score || b.raw[1] - a.raw[1]);
  const perH = g => Object.fromEntries(HORIZONS.map(h => [h, stats(g, h)]));

  // last 60 days: average next-day move of the 🚀 coins, the 😢 coins and all coins (for the chart)
  const daily = [];
  const days = byDay(rows);
  for (let d = lastDay - 59; d <= lastDay; d++) {
    const g = (days.get(d) || []).filter(r => r.ret[1] != null);
    if (!g.length) continue;
    const pos = g.filter(r => r.score > 0), neg = g.filter(r => r.score < 0);
    daily.push({ day: isoDay(d), mkt: g[0].mkt[1], rockets: pos.length ? mean(pos.map(r => r.ret[1])) : null, sad: neg.length ? mean(neg.map(r => r.ret[1])) : null, nR: pos.length, nS: neg.length });
  }

  const tuning = structuredClone(prev?.tuning || { history: [] });
  let newParams = null;
  if (tuneNow || !tuning.lastRun) {
    const res = tune(coins, params);
    tuning.lastRun = new Date(now).toISOString();
    tuning.last = {
      adopted: res.adopt, notes: res.notes, testIC: res.testIC, wins: res.wins, folds: res.folds.map(f => ({ from: isoDay(f.from), to: isoDay(f.to), before: f.before, after: f.after, won: f.won })),
      trainFrom: isoDay(res.split.trainFrom), testFrom: isoDay(res.split.cut), testTo: isoDay(res.split.testTo),
      stop: res.stop,
    };
    if (res.adopt || res.stop.adopt) {
      newParams = res.params;
      tuning.history = [{ date: isoDay(Math.floor(now / DAY)), from: params, to: newParams, testIC: res.testIC, notes: res.notes, stop: res.stop.adopt ? `stops ${res.stop.from}× → ${res.stop.to}×` : null }, ...(tuning.history || [])].slice(0, 30);
    }
  }

  const card = {
    v: 2, generated: now, params: newParams || params, coins: coins.length, horizons: HORIZONS,
    signalDay: isoDay(lastDay), outcomeDay: isoDay(lastDay + 1),
    yesterday: {
      market: y[0]?.mkt[1] ?? null,
      // real move shown per coin; the averages use the capped one
      coins: y.map(r => ({ id: r.id, sym: r.sym, score: r.score, squeeze: r.squeeze, good: r.good, bad: r.bad, ret: r.raw[1], exc: r.exc[1] })),
      stats: stats(y, 1),
    },
    windows: { d30: perH(since(30)), d90: perH(since(90)), all: perH(rows) },
    daily, tuning,
  };
  return { card, newParams };
}

/* ---------- universe (same exclusions as the page) ---------- */
const EXCLUDE_NAME = /\b(fund|treasur\w*|t-bills?|securities|money market|heloc|wrapped|staked|bridged|restaked|gold|yield)\b/i;
const EXCLUDE_SYMBOL = /^(w|st|wst|cb|we|bn|jito|m|r|ez|rs|l|solv|t)(btc|eth|bnb|sol|steth|beth|eeth)$/i;
export function isPegged(c, cats) {
  if (cats?.stable?.includes(c.id) || cats?.gold?.includes(c.id)) return true;
  if (EXCLUDE_NAME.test(c.name) || EXCLUDE_SYMBOL.test(c.symbol)) return true;
  if (/usd|eur/i.test(c.symbol) && c.current_price > 0.9 && c.current_price < 1.1) return true;
  const a = Math.abs(c.price_change_percentage_24h_in_currency ?? 9), b = Math.abs(c.price_change_percentage_7d_in_currency ?? 9), d = Math.abs(c.price_change_percentage_30d_in_currency ?? 0);
  return a < 0.6 && b < 1.5 && d < 3 && c.current_price > 0.85 && c.current_price < 1.35;
}
export const pickUniverse = (markets, cats, n = 50) => markets.filter(c => !isPegged(c, cats)).slice(0, n);
