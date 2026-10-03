// Shared signal engine for heat.sala.company: used by the page, the daily scorer and the weekly tuner,
// so the 🚀 / 😢 you see are exactly the ones that get scored and tuned. No dependencies; runs in browsers and Node.

export const DEFAULT_PARAMS = {
  rsiPeriod: 14, rsiLow: 30, rsiHigh: 70,
  maFast: 50, maSlow: 200,
  bbPeriod: 20, bbK: 2,          // Bollinger Bands: drawn in the price chart only, not a signal
  // Relative strength: over the same momDays window, the asset's move beat (rsUp) or trailed (rsDown) its benchmark's
  // by rsPct% or more. Benchmark: Bitcoin for crypto, an equal-weight basket of every pair for forex, gold for metals.
  rsPct: 10,
  // Volume surge: the average volume of the last volShort days is at least volRatio × that of the volLong days before,
  // while price rose (volUp) or fell (volDown) over those volShort days. Crypto only: forex has no central volume.
  volShort: 7, volLong: 30, volRatio: 1.5,
  // Recommended stop-loss: stopMult × the coin's average daily move over the last stopLookback days
  stopMult: 2, stopLookback: 20,
  // Momentum: the move over the last momDays candles is above +momPct% (momUp) or below −momPct% (momDown).
  // Crypto: 30 daily candles = 30 days. Forex (business days only): 21 candles ≈ one month, and a much smaller momPct.
  momPct: 20, momDays: 30,
  // +1 = counts as a 🚀, -1 = counts as a 😢, 0 = switched off. The tuner may flip or disable a signal.
  // Only what's shown next to the name is scored: the moving-average trend (🚀 / 😢), the point & figure trend
  // (X📈 / O📉) and 30-day momentum (🔥 / 🧊). RSI stays in the tiles as information, and relative strength and
  // volume are being tested: the tuner measures them and logs what it would do, but keeps them off.
  weights: { trendUp: 1, oversold: 0, trendDown: -1, overbought: 0, momUp: 1, momDown: -1, pnfUp: 1, pnfDown: -1, rsUp: 0, rsDown: 0, volUp: 0, volDown: 0 },
};
// The signals that may count as a 🚀 / 😢 call (the tuner can flip or disable them, but never switch on the others)
export const SCORED = ['trendUp', 'trendDown', 'momUp', 'momDown', 'pnfUp', 'pnfDown'];
// New signals on trial: scored on the Scorecard every night, never counted as 🚀 / 😢. They may be missing (no
// benchmark, no volume data) without the rest of that day being left out of the scoring.
export const TESTING = ['rsUp', 'rsDown', 'volUp', 'volDown'];

// Directional signals: each one adds a 🚀 or a 😢 (or nothing while its weight is 0)
export const COMPONENTS = {
  trendUp:    'strong uptrend',
  oversold:   'RSI oversold',
  trendDown:  'strong downtrend',
  overbought: 'RSI overbought',
  momUp:      'strong 1-month momentum',
  momDown:    'weak 1-month momentum',
  pnfUp:      'point & figure rising (X column)',
  pnfDown:    'point & figure falling (O column)',
  rsUp:       'beating its benchmark',
  rsDown:     'trailing its benchmark',
  volUp:      'rising on growing volume',
  volDown:    'falling on growing volume',
};

// Stop distances the tuner compares (× the average daily move)
export const STOP_MULTS = [1.5, 2, 2.5];

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

// extra.bench: the benchmark's close on each of these candles (alignBench); extra.vol: each candle's volume
// (null where unknown, e.g. today's candle, still forming)
export function series(closes, p, { bench = null, vol = null } = {}) {
  const P = withDefaults(p);
  return {
    c: closes,
    rsi: rsi(closes, P.rsiPeriod),
    maF: sma(closes, P.maFast),
    maS: sma(closes, P.maSlow),
    bb: bollinger(closes, P.bbPeriod, P.bbK),
    b: bench,
    v: vol,
  };
}

// Relative strength and volume surge at candle i:
//   rs  = how much more (or less) the asset moved than its benchmark over momDays, in % (null without a benchmark)
//   vol = { ratio: recent average volume ÷ the volLong days before, move: % price move over the recent days }
//         (null without enough volume data: at least half the days in each window must have a volume)
export function extrasAt(s, i, p) {
  const P = withDefaults(p), d = P.momDays, b = s.b, v = s.v;
  const rs = b && i >= d && b[i] > 0 && b[i - d] > 0 ? ((s.c[i] / s.c[i - d]) / (b[i] / b[i - d]) - 1) * 100 : null;
  let vol = null;
  if (v && i >= P.volShort + P.volLong) {
    const avg = (from, to) => {
      let sum = 0, n = 0;
      for (let k = from; k <= to; k++) if (v[k] > 0) { sum += v[k]; n++; }
      return n * 2 >= to - from + 1 ? sum / n : null;
    };
    const recent = avg(i - P.volShort + 1, i), before = avg(i - P.volShort - P.volLong + 1, i - P.volShort);
    if (recent != null && before) vol = { ratio: recent / before, move: (s.c[i] / s.c[i - P.volShort] - 1) * 100 };
  }
  return { rs, vol };
}

// Which signals are on at candle i (null = not enough history for that signal)
export function componentsAt(s, i, p) {
  const P = withDefaults(p);
  const c = s.c[i], r = s.rsi[i], f = s.maF[i], sl = s.maS[i];
  const trend = f != null && sl != null;
  const md = P.momDays, m30 = i >= md ? (c / s.c[i - md] - 1) * 100 : null;
  const pf = pnfDirAt(s.c, i);
  const { rs, vol } = extrasAt(s, i, P);
  return {
    pnfUp:      pf ? pf === 'X' : null,
    pnfDown:    pf ? pf === 'O' : null,
    momUp:      m30 != null ? m30 >= P.momPct : null,
    momDown:    m30 != null ? m30 <= -P.momPct : null,
    trendUp:    trend ? f > sl && c > f : null,
    trendDown:  trend ? f < sl && c < f : null,
    oversold:   r != null ? r < P.rsiLow : null,
    overbought: r != null ? r > P.rsiHigh : null,
    rsUp:       rs != null ? rs >= P.rsPct : null,
    rsDown:     rs != null ? rs <= -P.rsPct : null,
    volUp:      vol ? vol.ratio >= P.volRatio && vol.move > 0 : null,
    volDown:    vol ? vol.ratio >= P.volRatio && vol.move < 0 : null,
  };
}

export function scoreOf(active, p) {
  const P = withDefaults(p);
  const good = [], bad = [];
  for (const k of Object.keys(COMPONENTS)) {
    if (!active[k] || TESTING.includes(k)) continue;   // signals on trial never count
    const wgt = P.weights[k] || 0;
    if (wgt > 0) good.push(k); else if (wgt < 0) bad.push(k);
  }
  return { good, bad, score: good.length - bad.length };
}

/* ---------- benchmarks for relative strength ---------- */
// The benchmark's close on each of an asset's days (ascending UTC day numbers), from a Map(day → close), carried
// forward over the benchmark's gaps; null before its first close
export function alignBench(days, benchByDay) {
  const keys = [...benchByDay.keys()].sort((a, b) => a - b), out = [];
  let j = -1, last = null;
  for (const d of days) {
    while (j + 1 < keys.length && keys[j + 1] <= d) last = benchByDay.get(keys[++j]);
    out.push(last);
  }
  return out;
}
// Equal-weight basket: each day the index moves by the average % change of every series that closed that day and on
// its previous close. list: [{ days, c }] → Map(day → index level, starting at 100)
export function basketIndex(list) {
  const chg = new Map();
  for (const { days, c } of list) {
    for (let i = 1; i < c.length; i++) {
      if (!(c[i] > 0 && c[i - 1] > 0)) continue;
      if (!chg.has(days[i])) chg.set(days[i], []);
      chg.get(days[i]).push(c[i] / c[i - 1]);
    }
  }
  const out = new Map();
  let level = 100;
  for (const d of [...chg.keys()].sort((a, b) => a - b)) {
    const g = chg.get(d);
    level *= g.reduce((s, x) => s + x, 0) / g.length;
    out.set(d, level);
  }
  return out;
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

/* ---------- point & figure ---------- */
// The page draws P&F from the last PNF_WINDOW daily closes. To score it without looking ahead, the direction on each
// past day is worked out the same way: from the PNF_WINDOW closes up to that day, with the box size from that
// window's own last 60 days. It doesn't depend on any tuned setting, so it's cached per price series.
export const PNF_WINDOW = 260;
const PNF_CACHE = new WeakMap();
export function pnfDirAt(closes, i) {
  let m = PNF_CACHE.get(closes);
  if (!m) PNF_CACHE.set(closes, m = new Map());
  if (!m.has(i)) {
    const cols = pointFigure(closes.slice(Math.max(0, i - PNF_WINDOW + 1), i + 1)).cols;
    m.set(i, cols.length ? cols[cols.length - 1].dir : null);
  }
  return m.get(i);
}
// Box size from the coin's own volatility: its average daily move over the last 60 closes, snapped to a clean step.
// About 1-1.5% for BTC and 2-3% for a typical coin, so every chart has a readable number of columns. The small
// steps are for currencies: EUR/USD moves about 0.3% a day.
const PNF_STEPS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
export function autoBoxPct(closes, lookback = 60) {
  const n = closes.length, from = Math.max(1, n - lookback);
  let s = 0, k = 0;
  for (let i = from; i < n; i++) { s += Math.abs(closes[i] / closes[i - 1] - 1); k++; }
  const avg = k ? s / k * 100 : 2;
  return PNF_STEPS.reduce((best, v) => Math.abs(v - avg) < Math.abs(best - avg) ? v : best, PNF_STEPS[0]);
}

// Close-only point & figure on a log scale: box j spans prices [r^j, r^(j+1)) with r = 1 + boxPct/100, so boxes are
// equal percentage moves. X columns rise, O columns fall; a new column needs a move of `reversal` boxes the other way.
// Columns: { dir: 'X'|'O', lo, hi (box indices, inclusive), start, end (candle indices), signal? }.
// signal = double-top buy (an X column tops the previous X column) or double-bottom sell (an O column breaks the previous O).
export function pointFigure(closes, { boxPct = autoBoxPct(closes), reversal = 3 } = {}) {
  const lr = Math.log(1 + boxPct / 100);
  const box = p => Math.floor(Math.log(p) / lr + 1e-9);
  const cols = [];
  let col = null;
  const b0 = box(closes[0]);
  const breakout = (c, i) => {
    const prev = cols[cols.length - 3];                 // columns alternate X/O, so the previous same-direction one is 2 back
    if (!prev || c.signal) return;
    if (c.dir === 'X' && c.hi > prev.hi) c.signal = { type: 'buy', day: i, box: prev.hi + 1 };
    if (c.dir === 'O' && c.lo < prev.lo) c.signal = { type: 'sell', day: i, box: prev.lo - 1 };
  };
  for (let i = 1; i < closes.length; i++) {
    const b = box(closes[i]);
    if (!col) {
      if (b > b0) col = { dir: 'X', lo: b0, hi: b, start: i, end: i };
      else if (b < b0) col = { dir: 'O', lo: b, hi: b0, start: i, end: i };
      if (col) cols.push(col);
      continue;
    }
    if (col.dir === 'X') {
      if (b > col.hi) { col.hi = b; col.end = i; breakout(col, i); }
      else if (b <= col.hi - reversal) { col = { dir: 'O', lo: b, hi: col.hi - 1, start: i, end: i }; cols.push(col); breakout(col, i); }
    } else {
      if (b < col.lo) { col.lo = b; col.end = i; breakout(col, i); }
      else if (b >= col.lo + reversal) { col = { dir: 'X', lo: col.lo + 1, hi: b, start: i, end: i }; cols.push(col); breakout(col, i); }
    }
  }
  const price = j => Math.pow(1 + boxPct / 100, j);   // lower edge of box j
  const last = cols[cols.length - 1];
  const now = !last ? null : last.dir === 'X'
    ? { dir: 'X', next: price(last.hi + 1), reverse: price(last.hi - reversal + 1) }   // add an X above / flip to O below
    : { dir: 'O', next: price(last.lo), reverse: price(last.lo + reversal) };          // add an O below / flip to X above
  const lastSignal = [...cols].reverse().find(c => c.signal)?.signal || null;
  return { boxPct, reversal, cols, price, now, lastSignal };
}

/* ---------- evaluation ---------- */
const DAY = 864e5;
const cap = h => 0.3 * Math.sqrt(h);   // ±30% a day, wider for longer horizons: stops one bad print swamping averages

// coins: [{ id, symbol, t0 (ms, UTC midnight of first close), c: [daily closes, complete days only], days? }]
// `days` (optional): the UTC day number of each close, for markets that skip days (forex: business days only).
// Without it the closes are one per calendar day from t0 (crypto). Horizons count closes, so for forex the
// "next 1 / 3 / 7 days" are trading days.
// `skip` (optional): a Set of close indices to leave out, e.g. the days around an unusual jump in a currency feed.
// `bench` / `v` (optional): the benchmark's close and the volume on each day, for the relative-strength and volume
// signals (alignBench; null where unknown). Without them those signals are simply never on.
// One row per coin per day: the signals at that close and the move over the following 1 / 3 / 7 days.
export function signalRows(coins, p) {
  const P = withDefaults(p);
  const warm = Math.max(P.maSlow, P.rsiPeriod + 1);
  const core = Object.keys(COMPONENTS).filter(k => !TESTING.includes(k));
  const rows = [];
  for (const coin of coins) {
    const s = series(coin.c, P, { bench: coin.bench, vol: coin.v });
    const d0 = Math.floor(coin.t0 / DAY), n = coin.c.length;
    const dayOf = coin.days ? i => coin.days[i] : i => d0 + i;
    for (let i = warm; i < n - 1; i++) {
      if (coin.skip?.has(i)) continue;   // days around an unusual jump (possible data glitch) are left out of the scoring
      const a = componentsAt(s, i, P);
      if (core.some(k => a[k] == null)) continue;
      const { good, bad, score } = scoreOf(a, P);
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
      rows.push({ day: dayOf(i), next: dayOf(i + 1), id: coin.id, sym: coin.symbol, a, good, bad, score, raw, ret, mkt: {}, exc: {}, stopD, stop });
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
function selectParams(cur, rowsFor, until, minT, momPcts = [10, 20, 30]) {
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
    const w = Math.abs(e.t) >= minT ? Math.sign(e.avg) : 0, scored = SCORED.includes(k);
    next.weights[k] = scored ? w : 0;
    const role = w > 0 ? '🚀' : w < 0 ? '😢' : 'off';
    notes.push(`${COMPONENTS[k]}: ${scored ? role : `not scored${w ? ` (would be ${role})` : ''}`} (t=${e.t.toFixed(2)}, ${(e.avg * 100).toFixed(2)}% vs market, avg over 1/3/7 days)`);
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

  // Momentum (🔥 / 🧊 on the tiles): which threshold, and whether strong/weak momentum should be a 🚀, a 😢 or off
  let bestMom = null;
  for (const momPct of momPcts) {
    const rows = rowsFor({ ...next, momPct });
    const u = effect(rows, 'momUp'), d = effect(rows, 'momDown');
    const t = Math.abs(u.t) + Math.abs(d.t);
    if (u.n >= 20 && d.n >= 20 && (!bestMom || t > bestMom.t)) bestMom = { momPct, u, d, t };
  }
  if (bestMom) { next.momPct = bestMom.momPct; setSign('momUp', bestMom.u); setSign('momDown', bestMom.d); }

  // Point & figure trend (X📈 / O📉): nothing to tune, only whether a rising / falling column is a 🚀, a 😢 or off
  const pfRows = rowsFor(next), pu = effect(pfRows, 'pnfUp'), pd = effect(pfRows, 'pnfDown');
  if (pu.n >= 20) setSign('pnfUp', pu);
  if (pd.n >= 20) setSign('pnfDown', pd);

  // Signals on trial (relative strength, volume): measured at their current settings and reported, never switched on
  for (const k of TESTING) { const e = effect(pfRows, k); if (e.n >= 20) setSign(k, e); }
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
export function tune(coins, current, { folds = 3, minT = 2.5, margin = 0.003, momPcts, holdoutDays = 90 } = {}) {
  const cur = withDefaults(current);
  // Rows for a given setting (~80k rows for 100 coins × 2.7 years). Keep only the 8 most recently used: caching every
  // variant tried across all folds ran GitHub's runner out of memory (4 GB) once momentum and stop variants were added.
  const cache = new Map(), CACHE_MAX = 8;
  const rowsFor = p => {
    const k = JSON.stringify(withDefaults(p));
    let rows = cache.get(k);
    if (rows) cache.delete(k); else rows = signalRows(coins, p);
    cache.set(k, rows);                                     // most recently used goes last
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return rows;
  };

  // Holdout: the newest holdoutDays are never used to choose anything (check periods, signal roles, stops), so how the
  // current and the proposed settings did there is a genuinely unseen test. Skipped on short histories (tests).
  const allDays = [...new Set(rowsFor(cur).map(r => r.day))].sort((a, b) => a - b);
  const hold = allDays.length && allDays[allDays.length - 1] - allDays[0] >= holdoutDays * 4 ? holdoutDays : 0;
  const lastDay = allDays[allDays.length - 1], cutoff = lastDay - hold;   // the last day the tuner may look at
  const days = allDays.filter(d => d <= cutoff);
  const start = Math.floor(days.length * 0.5), block = Math.floor((days.length - start) / folds);
  const results = [];
  for (let k = 0; k < folds; k++) {
    const from = days[start + k * block], to = k === folds - 1 ? cutoff + 1 : days[start + (k + 1) * block];
    const sel = selectParams(cur, rowsFor, from, minT, momPcts).params;
    const before = objective(rowsFor(cur), from, to), after = objective(rowsFor(sel), from, to);
    results.push({ from, to: to - 1, before, after, won: after > before });
  }
  const avg = f => mean(results.map(f));
  const before = avg(r => r.before), after = avg(r => r.after), wins = results.filter(r => r.won).length;

  const final = selectParams(cur, rowsFor, cutoff + 1, minT, momPcts);
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
    folds: results, wins, split: { trainFrom: days[0], cut: days[start], testTo: cutoff },
    testIC: { before, after },
    // the untouched newest days: how the current and the proposed settings did there (null when too short to hold out)
    holdout: hold ? { from: cutoff + 1, to: lastDay, current: objective(rowsFor(cur), cutoff + 1, Infinity), proposed: objective(rowsFor(final.params), cutoff + 1, Infinity) } : null,
  };
}

/* ---------- the daily scorecard ---------- */
const isoDay = d => new Date(d * DAY).toISOString().slice(0, 10);
// coins: complete daily closes only. Returns { card, newParams } where newParams is set only if the tuner adopted settings.
// costPct: an estimated round-trip trading cost (fraction, e.g. 0.002 = 0.2%), recorded on the card so results can be
//   shown after costs; it doesn't change the rank-based verdicts.
// universe: { 'YYYY-MM-DD': [ids] }, the coins that were in the list on each day. Rows for days with a snapshot are
//   also scored point-in-time (only coins that were in that day's list), which removes survivorship bias.
export function buildScorecard(coins, current, { prev = null, tuneNow = false, now = Date.now(), momPcts, costPct = 0, universe = null } = {}) {
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
    const res = tune(coins, params, { momPcts });
    tuning.lastRun = new Date(now).toISOString();
    tuning.last = {
      adopted: res.adopt, notes: res.notes, testIC: res.testIC, wins: res.wins, folds: res.folds.map(f => ({ from: isoDay(f.from), to: isoDay(f.to), before: f.before, after: f.after, won: f.won })),
      trainFrom: isoDay(res.split.trainFrom), testFrom: isoDay(res.split.cut), testTo: isoDay(res.split.testTo),
      stop: res.stop,
      holdout: res.holdout && { ...res.holdout, from: isoDay(res.holdout.from), to: isoDay(res.holdout.to) },
    };
    if (res.adopt || res.stop.adopt) {
      newParams = res.params;
      tuning.history = [{ date: isoDay(Math.floor(now / DAY)), from: params, to: newParams, testIC: res.testIC, notes: res.notes, stop: res.stop.adopt ? `stops ${res.stop.from}× → ${res.stop.to}×` : null }, ...(tuning.history || [])].slice(0, 30);
    }
  }

  const card = {
    v: 2, generated: now, params: newParams || params, coins: coins.length, horizons: HORIZONS,
    signalDay: isoDay(lastDay), outcomeDay: isoDay(y[0]?.next ?? lastDay + 1),   // next close: the next business day for forex
    yesterday: {
      market: y[0]?.mkt[1] ?? null,
      // real move shown per coin; the averages use the capped one
      coins: y.map(r => ({ id: r.id, sym: r.sym, score: r.score, good: r.good, bad: r.bad, ret: r.raw[1], exc: r.exc[1] })),
      stats: stats(y, 1),
    },
    windows: { d30: perH(since(30)), d90: perH(since(90)), all: perH(rows) },
    daily, tuning, costs: { roundTrip: costPct },
  };
  // Point-in-time: only coin-days where the coin was in that day's list (snapshots start when recording began)
  if (universe) {
    const inList = new Map(Object.entries(universe).map(([d, ids]) => [d, new Set(ids)]));
    const pit = rows.filter(r => inList.get(isoDay(r.day))?.has(r.id));
    const pitDays = new Set(pit.map(r => r.day));
    card.pit = { days: pitDays.size, from: pitDays.size ? isoDay(Math.min(...pitDays)) : null, windows: pit.length ? { all: perH(pit) } : null };
  }
  return { card, newParams };
}

/* ---------- universe (same exclusions as the page) ---------- */
const EXCLUDE_NAME = /\b(fund|treasur\w*|t-bills?|securities|money market|heloc|wrapped|staked|bridged|restaked|gold|yield)\b/i;
const EXCLUDE_SYMBOL = /^(w|st|wst|cb|we|bn|jito|m|r|ez|rs|l|solv|t)(btc|eth|bnb|sol|steth|beth|eeth)$/i;
export function isPegged(c, cats) {
  if (c.fx) return !!c.pegged;   // currencies: an explicit list (the crypto rules below would flag quiet pairs like EUR/USD)
  if (cats?.stable?.includes(c.id) || cats?.gold?.includes(c.id)) return true;
  if (EXCLUDE_NAME.test(c.name) || EXCLUDE_SYMBOL.test(c.symbol)) return true;
  if (/usd|eur/i.test(c.symbol) && c.current_price > 0.9 && c.current_price < 1.1) return true;
  const a = Math.abs(c.price_change_percentage_24h_in_currency ?? 9), b = Math.abs(c.price_change_percentage_7d_in_currency ?? 9), d = Math.abs(c.price_change_percentage_30d_in_currency ?? 0);
  return a < 0.6 && b < 1.5 && d < 3 && c.current_price > 0.85 && c.current_price < 1.35;
}
export const pickUniverse = (markets, cats, n = 100) => markets.filter(c => !isPegged(c, cats)).slice(0, n);
