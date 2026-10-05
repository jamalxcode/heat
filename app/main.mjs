// heat.sala.company page script: main (split from index.html; see app/main.mjs for the order things start in)
import * as SIG from '/signals.mjs';
import { applyEdge, applyParams, renderAll, renderCounts, renderFooter, renderHealth } from './render.mjs';
import { $, DAY, fmtWait, linkedCoin, LIVE_EVERY, M, MARKETS_TTL, REFRESH_MIN, S, setStatus, SNAPSHOT_GRACE, SNAPSHOT_MAX_AGE, SNAPSHOT_RETRY, store } from './core.mjs';
import { loadScorecard } from './scorecard.mjs';
import { applyHist, buildBench, pickCoins } from './data.mjs';
import { openLinked } from './interact.mjs';   // hover, clicks, switches and keyboard: sets up its listeners when loaded

/* ================= snapshot (data.json built by GitHub Actions) ================= */
export async function loadSnapshot() {
  try {
    // the minute bucket busts GitHub Pages' 10-minute CDN cache without hammering it
    const r = await fetch(`${M.data}?b=${Math.floor(Date.now() / 60e3)}`, { cache: 'no-store' });
    if (r.status === 404) { S.noSnapshot = true; return null; }
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.v === 1 && Array.isArray(d.markets) ? d : null;
  } catch { return null; }
}
// one close per day from t0 (crypto), or at t0 + d[i] days when the market skips days (forex: business days)
// vols: the volume of each close (data.json keeps only the latest days' volume, lined up with the end of the closes)
export const unpack = h => ({ src: h.src, pair: h.pair, ok: !!h.ok, t: h.t, closes: h.c.map((v, i) => [h.t0 + (h.d ? h.d[i] : i) * DAY, v]), vols: h.v ? new Array(h.c.length - h.v.length).fill(null).concat(h.v) : null });

// Backup when data.json is missing or stale: run the same build script GitHub runs, right here in the browser
// (without the slow CoinGecko candle fallback), at most once per 10 minutes per browser, shared across tabs.
export async function buildLive(stale) {
  const cached = store.get('hm.live');
  if (cached?.v === 1 && Date.now() - cached.generated < LIVE_EVERY) return cached;
  if (Date.now() - (store.get('hm.liveAt') || 0) < LIVE_EVERY) return cached || stale; // another tab or reload just tried
  store.set('hm.liveAt', Date.now());
  setStatus('Fetching live prices…', 'busy');
  const { build } = await import('/scripts/build-data.mjs');
  const prev = cached && (!stale || cached.generated > stale.generated) ? cached : stale;
  let pairs = null;
  try { pairs = (await (await fetch('pairs.json', { cache: 'no-store' })).json()).pairs; } catch { /* none published yet */ }
  const data = await build({ prev, params: stale?.params ?? cached?.params ?? null, cgCandles: false, pairs, log: () => {} });
  store.set('hm.live', data);
  return data;
}

/* ================= main ================= */
export function renderFresh(now) {
  const el = $('#fresh');
  if (!S.updated) return;
  const age = now - S.updated, mins = Math.floor(age / 60e3);
  const tm = new Date(S.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const ago = mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : mins < 120 ? `${mins} min ago` : `${Math.floor(mins / 60)} h ago`;
  const late = age > REFRESH_MIN * 2.5 * 60e3;
  const next = S.busy ? 'refreshing now' : S.nextAuto > now ? `next in ~${Math.max(1, Math.ceil((S.nextAuto - now) / 60e3))} min` : 'checking for new prices';
  el.classList.toggle('late', late);
  const html = M.fresh({ tm, ago, next, late, refreshMin: REFRESH_MIN, rateDate: S.rateDate, latestDate: S.latestDate });   // includes the data credit
  if (el.innerHTML !== html) el.innerHTML = html;
}

// One-second clock: shows the countdown and starts the next update when it's due
export function tick() {
  const now = Date.now(), btn = $('#refresh');
  const wait = (S.nextAuto || 0) - now;
  btn.disabled = S.busy || wait > 0;
  btn.textContent = S.busy ? '↻ Updating…' : wait > 0 ? `↻ Refresh in ${fmtWait(wait)}` : '↻ Refresh';
  renderFresh(now);
  if (!S.busy && !document.hidden && S.nextAuto && now >= S.nextAuto) run();
}

let linkedOpened = false;
export function done() {
  renderFooter();
  fetch('/health.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(renderHealth).catch(() => {});   // sources health line
  renderCounts();   // right away: the deferred refresh is paused in background tabs
  const ok = S.coins.filter(c => S.ind[c.id] && !S.ind[c.id].error).length;
  const via = S.mode === 'live' ? ` · built in your browser from ${S.marketSrc}` : '';
  setStatus(`${ok}/${S.coins.length} ${M.noun} with indicators${via}`, S.stale ? '' : 'live');
  if (linkedCoin && !linkedOpened) { linkedOpened = true; openLinked(); }   // a shared link to one coin
}

// Forex "…/USD" view: every USD/XXX pair turned into XXX/USD, so a blue tile means that currency gained on the dollar.
// Flipping a pair is just 1 / rate, done on the whole history before anything is computed, so tiles, charts, stops
// and the 🚀/😢 all follow. Only the display changes: forex.json and the scorecard stay USD/XXX.
export const flipPct = v => v == null ? null : (1 / (1 + v / 100) - 1) * 100;
export function quoteView(data) {
  if (!M.quoteSwitch || S.quote !== 'usd') return data;
  const flip = id => data.markets.find(m => m.id === id)?.symbol.startsWith('USD/');
  const markets = data.markets.map(m => !m.symbol.startsWith('USD/') ? m : {
    ...m, symbol: m.symbol.slice(4) + '/USD', current_price: 1 / m.current_price,
    price_change_percentage_24h_in_currency: flipPct(m.price_change_percentage_24h_in_currency),
    price_change_percentage_7d_in_currency: flipPct(m.price_change_percentage_7d_in_currency),
    price_change_percentage_30d_in_currency: flipPct(m.price_change_percentage_30d_in_currency),
    spike: m.spike && { ...m.spike, pct: flipPct(m.spike.pct) },
  });
  const hist = Object.fromEntries(Object.entries(data.hist || {}).map(([id, h]) =>
    [id, flip(id) ? { ...h, pair: h.pair.startsWith('USD/') ? h.pair.slice(4) + '/USD' : h.pair, c: h.c.map(v => 1 / v) } : h]));
  return { ...data, markets, hist };
}

export async function show(raw, live) {
  S.raw = raw;                                // kept so the quote switch can redraw without refetching
  const data = quoteView(raw);
  const isNew = data.generated !== S.updated;
  S.mode = live ? 'live' : 'snapshot';
  S.markets = data.markets; S.updated = data.generated; S.marketSrc = data.marketSrc; S.stale = !!data.marketStale; S.rateDate = data.rateDate; S.latestDate = data.latestDate ?? data.metalsDate;
  S.stable = new Set(data.cats?.stable || []); S.gold = new Set(data.cats?.gold || []);
  S.hist = {};
  for (const [id, h] of Object.entries(data.hist || {})) S.hist[id] = unpack(h);
  buildBench();                               // before any tile is computed: relative strength needs it
  const paramsChanged = applyParams(data.params);
  if (isNew || !S.scorecard) { await loadScorecard(); applyEdge(); }
  if (isNew || paramsChanged || !S.coins.length) { pickCoins(); renderAll(); }
  applyHist();
  if (S.filter !== 'all') renderAll();        // indicator filters (e.g. from a shared link) need the indicators first
  done();
  return isNew;
}

export async function run() {
  if (S.busy) return;
  S.busy = true;
  tick();
  try {
    if (!S.coins.length) setStatus('Loading prices…', 'busy');
    const snap = S.noSnapshot ? null : await loadSnapshot();
    // only the crypto page can rebuild its data in the browser; elsewhere (forex, metals, energy) an older file is still the latest
    if (snap && (Date.now() - snap.generated < SNAPSHOT_MAX_AGE || !M.liveBuild)) {
      const isNew = await show(snap, false);
      // the next build lands ~10 min after this one; if it hasn't appeared yet, look again every 2 min
      S.nextAuto = isNew ? Math.max(S.updated + MARKETS_TTL + SNAPSHOT_GRACE, Date.now() + 30e3) : Date.now() + SNAPSHOT_RETRY;
    } else {
      // no data.json (local preview) or the scheduled job is stuck
      let data = null;
      if (M.liveBuild) try { data = await buildLive(snap); } catch { data = null; }
      if (!data) data = snap;
      if (!data) throw new Error('No price data available right now');
      await show(data, data !== snap);
      S.nextAuto = Math.max(Date.now() + 60e3, (store.get('hm.liveAt') || 0) + LIVE_EVERY);
    }
  } catch (e) {
    setStatus(`${e.message}. Retrying automatically.`);
    S.nextAuto = Date.now() + 60e3;
  } finally {
    S.busy = false;
    tick();
  }
}
run();
// TradingView symbols known to exist (checked at deploy by scripts/tradingview.mjs), for the popup's chart link.
// Without it the popup just has no link.
fetch('/tv.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { S.tv = j?.sym || null; }).catch(() => {});
setInterval(tick, 1000);
document.addEventListener('visibilitychange', tick);
