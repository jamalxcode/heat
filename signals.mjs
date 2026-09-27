// Shared signal engine for heat.sala.company: used by the page, the daily scorer and the weekly tuner,
// so the 🚀 / 😢 you see are exactly the ones that get scored and tuned. No dependencies; runs in browsers and Node.

export const DEFAULT_PARAMS = {
  rsiPeriod: 14, rsiLow: 30, rsiHigh: 70,
  maFast: 50, maSlow: 200,
  bbPeriod: 20, bbK: 2, bbLookback: 180, bbTightPct: 10, bbWidePct: 80,
  // +1 = counts as a 🚀, -1 = counts as a 😢, 0 = switched off. The tuner may flip or disable a signal.
  weights: { trendUp: 1, oversold: 1, bbTight: 1, trendDown: -1, overbought: -1, bbWide: -1 },
};

export const COMPONENTS = {
  trendUp:    'strong uptrend',
  oversold:   'RSI oversold',
  bbTight:    'tight Bollinger band',
  trendDown:  'strong downtrend',
  overbought: 'RSI overbought',
  bbWide:     'wide Bollinger band',
};

export const withDefaults = p => ({ ...DEFAULT_PARAMS, ...(p || {}), weights: { ...DEFAULT_PARAMS.weights, ...(p?.weights || {}) } });

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

// Bollinger Bands; w = band width as % of the middle band
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
  return {
    trendUp:    trend ? f > sl && c > f : null,
    trendDown:  trend ? f < sl && c < f : null,
    oversold:   r != null ? r < P.rsiLow : null,
    overbought: r != null ? r > P.rsiHigh : null,
    bbTight:    q != null ? q <= P.bbTightPct : null,
    bbWide:     q != null ? q >= P.bbWidePct : null,
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
  return { good, bad, score: good.length - bad.length };
}

/* ---------- evaluation ---------- */
const DAY = 864e5;

// coins: [{ id, symbol, t0 (ms, UTC midnight of first close), c: [daily closes, complete days only] }]
// Returns one row per coin per day: the signals at that day's close and the return over the following day.
export function signalRows(coins, p) {
  const P = withDefaults(p);
  const warm = Math.max(P.maSlow, P.bbPeriod + 20, P.rsiPeriod + 1);
  const rows = [];
  for (const coin of coins) {
    const s = series(coin.c, P);
    const d0 = Math.floor(coin.t0 / DAY);
    for (let i = warm; i < coin.c.length - 1; i++) {
      const a = componentsAt(s, i, P);
      if (Object.values(a).some(v => v == null)) continue;
      const { good, bad, score } = scoreOf(a, P);
      // Cap at ±30%: a relisting or bad price print can show +500% in a day and swamp every average
      const raw = coin.c[i + 1] / coin.c[i] - 1;
      rows.push({ day: d0 + i, id: coin.id, sym: coin.symbol, a, good, bad, score, raw, ret: Math.max(-0.3, Math.min(0.3, raw)) });
    }
  }
  // excess return = coin's next-day return minus the average of every coin that day (removes the market's move)
  const byDay = new Map();
  for (const r of rows) { if (!byDay.has(r.day)) byDay.set(r.day, []); byDay.get(r.day).push(r); }
  for (const list of byDay.values()) {
    const m = list.reduce((s, r) => s + r.ret, 0) / list.length;
    for (const r of list) { r.mkt = m; r.exc = r.ret - m; }
  }
  return rows;
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
function spearman(x, y) {
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

export function stats(rows) {
  const days = [...new Set(rows.map(r => r.day))].sort((a, b) => a - b);
  const out = { rows: rows.length, days: days.length, from: days[0] ?? null, to: days[days.length - 1] ?? null };

  // by net score (🚀 minus 😢), clamped to ±3
  out.byScore = {};
  for (let s = -3; s <= 3; s++) {
    const g = rows.filter(r => Math.max(-3, Math.min(3, r.score)) === s);
    out.byScore[s] = g.length ? {
      n: g.length, avgRet: mean(g.map(r => r.ret)), avgExc: mean(g.map(r => r.exc)),
      upRate: g.filter(r => r.ret > 0).length / g.length, beatRate: g.filter(r => r.exc > 0).length / g.length,
    } : { n: 0 };
  }

  // each signal on its own: how did coins do the day after it fired?
  out.components = {};
  for (const k of Object.keys(COMPONENTS)) {
    const g = rows.filter(r => r.a[k]);
    const dm = dailyMeans(g, r => r.exc);
    out.components[k] = g.length ? {
      n: g.length, avgRet: mean(g.map(r => r.ret)), avgExc: mean(dm), t: tStat(dm),
      upRate: g.filter(r => r.ret > 0).length / g.length, beatRate: g.filter(r => r.exc > 0).length / g.length,
    } : { n: 0 };
  }

  // headline hit rates
  const pos = rows.filter(r => r.score > 0), neg = rows.filter(r => r.score < 0);
  out.rockets = { n: pos.length, upRate: pos.length ? pos.filter(r => r.ret > 0).length / pos.length : null, beatRate: pos.length ? pos.filter(r => r.exc > 0).length / pos.length : null, avgRet: mean(pos.map(r => r.ret)), avgExc: mean(pos.map(r => r.exc)) };
  out.sad = { n: neg.length, downRate: neg.length ? neg.filter(r => r.ret < 0).length / neg.length : null, lagRate: neg.length ? neg.filter(r => r.exc < 0).length / neg.length : null, avgRet: mean(neg.map(r => r.ret)), avgExc: mean(neg.map(r => r.exc)) };
  out.all = { avgRet: mean(rows.map(r => r.ret)), upRate: rows.length ? rows.filter(r => r.ret > 0).length / rows.length : null };

  // information coefficient: daily rank correlation between score and next-day excess return
  const ics = [];
  for (const d of days) {
    const g = rows.filter(r => r.day === d);
    if (g.length < 10 || new Set(g.map(r => r.score)).size < 2) continue;
    const v = spearman(g.map(r => r.score), g.map(r => r.exc));
    if (v != null) ics.push(v);
  }
  out.ic = { mean: mean(ics), t: tStat(ics), days: ics.length };
  return out;
}

/* ---------- tuning ---------- */
// Walk-forward: pick each signal's setting (and whether it's a 🚀, a 😢 or off) on the older `train` share of days,
// then compare against the current settings on the newer days it never saw. Adopt only if clearly better there.
export function tune(coins, current, { train = 0.7, minT = 2, margin = 0.005 } = {}) {
  const cur = withDefaults(current);
  const probe = signalRows(coins, { ...cur, maSlow: 200 });
  const days = [...new Set(probe.map(r => r.day))].sort((a, b) => a - b);
  const cut = days[Math.floor(days.length * train)];
  const isTrain = r => r.day < cut, isTest = r => r.day >= cut;

  const effect = (rows, k) => {
    const dm = dailyMeans(rows.filter(r => isTrain(r) && r.a[k]), r => r.exc);
    return { t: tStat(dm), n: dm.length, avg: mean(dm) };
  };
  const choose = (variants, k) => {
    let best = null;
    for (const v of variants) {
      const e = effect(signalRows(coins, { ...cur, ...v }), k);
      if (e.n >= 20 && (!best || Math.abs(e.t) > Math.abs(best.e.t))) best = { v, e };
    }
    return best;
  };

  const next = withDefaults(cur), notes = [];
  const setSign = (k, e) => {
    next.weights[k] = Math.abs(e.t) >= minT ? Math.sign(e.avg) : 0;
    notes.push(`${COMPONENTS[k]}: ${next.weights[k] > 0 ? '🚀' : next.weights[k] < 0 ? '😢' : 'off'} (t=${e.t.toFixed(2)}, ${(e.avg * 100).toFixed(2)}%/day vs market)`);
  };

  // RSI: period shared by both sides, each threshold chosen on its own
  let bestRsi = null;
  for (const rsiPeriod of [7, 14, 21]) {
    const lo = choose([20, 25, 30, 35].map(rsiLow => ({ rsiPeriod, rsiLow })), 'oversold');
    const hi = choose([65, 70, 75, 80].map(rsiHigh => ({ rsiPeriod, rsiHigh })), 'overbought');
    const t = Math.abs(lo?.e.t || 0) + Math.abs(hi?.e.t || 0);
    if (!bestRsi || t > bestRsi.t) bestRsi = { rsiPeriod, lo, hi, t };
  }
  if (bestRsi) {
    next.rsiPeriod = bestRsi.rsiPeriod;
    if (bestRsi.lo) { next.rsiLow = bestRsi.lo.v.rsiLow; setSign('oversold', bestRsi.lo.e); }
    if (bestRsi.hi) { next.rsiHigh = bestRsi.hi.v.rsiHigh; setSign('overbought', bestRsi.hi.e); }
  }

  // Trend: which moving-average pair
  const pairs = [{ maFast: 20, maSlow: 50 }, { maFast: 20, maSlow: 100 }, { maFast: 50, maSlow: 200 }];
  let bestPair = null;
  for (const v of pairs) {
    const rows = signalRows(coins, { ...next, ...v });
    const u = effect(rows, 'trendUp'), d = effect(rows, 'trendDown');
    const t = Math.abs(u.t) + Math.abs(d.t);
    if (u.n >= 20 && d.n >= 20 && (!bestPair || t > bestPair.t)) bestPair = { v, u, d, t };
  }
  if (bestPair) { Object.assign(next, bestPair.v); setSign('trendUp', bestPair.u); setSign('trendDown', bestPair.d); }

  // Bollinger: tight and wide thresholds
  const tight = choose([5, 10, 15, 20, 25].map(bbTightPct => ({ ...next, bbTightPct })), 'bbTight');
  if (tight) { next.bbTightPct = tight.v.bbTightPct; setSign('bbTight', tight.e); }
  const wide = choose([75, 80, 85, 90, 95].map(bbWidePct => ({ ...next, bbWidePct })), 'bbWide');
  if (wide) { next.bbWidePct = wide.v.bbWidePct; setSign('bbWide', wide.e); }

  const testIC = p => stats(signalRows(coins, p).filter(isTest)).ic;
  const before = testIC(cur), after = testIC(next);
  const anyOn = Object.values(next.weights).some(w => w !== 0);
  const adopt = anyOn && after.mean != null && after.mean > 0 && after.mean > (before.mean ?? -1) + margin;
  return {
    adopt, params: adopt ? next : cur, proposed: next, notes,
    split: { trainFrom: days[0], cut, testTo: days[days.length - 1] },
    testIC: { before: before.mean, after: after.mean, beforeT: before.t, afterT: after.t },
  };
}

/* ---------- the daily scorecard ---------- */
const isoDay = d => new Date(d * DAY).toISOString().slice(0, 10);
// coins: complete daily closes only. Returns { card, newParams } where newParams is set only if the tuner adopted settings.
export function buildScorecard(coins, current, { prev = null, tuneNow = false, now = Date.now() } = {}) {
  const params = withDefaults(current);
  const rows = signalRows(coins, params);
  const lastDay = Math.max(...rows.map(r => r.day));             // latest close whose next day is complete
  const since = n => rows.filter(r => r.day > lastDay - n);
  const y = rows.filter(r => r.day === lastDay).sort((a, b) => b.score - a.score || b.ret - a.ret);

  const daily = [];
  for (let d = lastDay - 59; d <= lastDay; d++) {
    const g = rows.filter(r => r.day === d);
    if (!g.length) continue;
    const s = stats(g);
    daily.push({ day: isoDay(d), mkt: g[0].mkt, rockets: s.rockets.n ? s.rockets.avgRet : null, sad: s.sad.n ? s.sad.avgRet : null, nR: s.rockets.n, nS: s.sad.n });
  }

  const tuning = structuredClone(prev?.tuning || { history: [] });
  let newParams = null;
  if (tuneNow || !tuning.lastRun) {
    const res = tune(coins, params);
    tuning.lastRun = new Date(now).toISOString();
    tuning.last = { adopted: res.adopt, notes: res.notes, testIC: res.testIC, trainFrom: isoDay(res.split.trainFrom), testFrom: isoDay(res.split.cut), testTo: isoDay(res.split.testTo) };
    if (res.adopt) {
      newParams = res.params;
      tuning.history = [{ date: isoDay(Math.floor(now / DAY)), from: params, to: newParams, testIC: res.testIC, notes: res.notes }, ...(tuning.history || [])].slice(0, 30);
    }
  }

  const card = {
    v: 1, generated: now, params: newParams || params, coins: coins.length,
    signalDay: isoDay(lastDay), outcomeDay: isoDay(lastDay + 1),
    yesterday: {
      market: y[0]?.mkt ?? null,
      coins: y.map(r => ({ id: r.id, sym: r.sym, score: r.score, good: r.good, bad: r.bad, ret: r.raw, exc: r.exc })), // real move shown; averages use the capped one
      stats: stats(y),
    },
    windows: { d30: stats(since(30)), d90: stats(since(90)), all: stats(rows) },
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
