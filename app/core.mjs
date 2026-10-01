// heat.sala.company page script: core (split from index.html; see app/main.mjs for the order things start in)
import * as SIG from '/signals.mjs';

/* ================= market ================= */
// The same page serves every market: / is crypto, /forex/ is forex (a copy of this file with its own search tags,
// made at deploy by scripts/forex-page.mjs). Everything market-specific lives here; tiles, popups, filters, the
// scorecard and the signal engine are shared, so a change to them shows on every market.
export const MARKETS = {
  crypto: {
    data: '/data.json', scorecard: '/scorecard.json', top: 100, noun: 'coins', one: 'coin',
    live: true,                                     // a live price between daily candles; today's candle still forming
    bins: { '24h': [1, 3, 6, 10], '7d': [2.5, 7, 15, 25], '30d': [5, 15, 30, 50] },
    back: { '24h': 1, '7d': 7, '30d': 30 },         // candles back for each change (one candle per day)
    label: { '24h': '24h', '7d': '7d', '30d': '30d' },
    pegLabel: 'Stablecoins', pegTitle: 'Include stablecoins, tokenized gold and wrapped/staked copies',
    pegWords: 'stablecoins, pegged and fund tokens', closeWord: 'daily close (00:00 UTC)', stopWhere: 'your exchange',
  },
  forex: {
    data: '/forex.json', scorecard: '/forex-scorecard.json', top: 999, noun: 'currencies', one: 'currency',
    live: false,                                    // one official rate per business day: nothing forms in between
    bins: { '24h': [0.1, 0.3, 0.6, 1], '7d': [0.25, 0.75, 1.5, 3], '30d': [0.5, 1.5, 3, 6] },
    back: { '24h': 1, '7d': 5, '30d': 21 },         // business days: 5 ≈ a week, 21 ≈ a month
    label: { '24h': '1d', '7d': '1w', '30d': '1m' },
    pegLabel: 'Pegged', pegTitle: 'Include currencies pegged to the US dollar (Gulf currencies, HKD, JOD, IQD, LBP)',
    pegWords: 'currencies pegged to the dollar', closeWord: 'ECB rate', stopWhere: 'your broker',
  },
};
export const MARKET = location.pathname.startsWith('/forex') ? 'forex' : 'crypto';
export const M = MARKETS[MARKET];
export const TF = tf => M.label[tf];                       // what a timeframe is called on this market (24h / 1d …)

/* ================= config ================= */
export const TOP_N = M.top;
export const REFRESH_MIN = 10;              // data.json is rebuilt by GitHub Actions every 10 minutes
export const MARKETS_TTL = REFRESH_MIN * 60e3;
export const SNAPSHOT_GRACE = 2 * 60e3;     // Actions runs start late and Pages takes a minute to publish
export const SNAPSHOT_RETRY = 2 * 60e3;     // poll this often once a new snapshot is due
export const SNAPSHOT_MAX_AGE = 45 * 60e3;  // older than this: the job is stuck, so build the data in the browser instead
export const LIVE_EVERY = REFRESH_MIN * 60e3; // ...but at most once per 10 minutes per browser
export const DAY = 864e5;
export const BINS = M.bins;

/* ================= helpers ================= */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota or blocked */ } },
};
export function fmtPrice(p) {
  if (p == null || !isFinite(p)) return '—';
  if (MARKET === 'forex') {                       // exchange rates: no $, decimals as quoted (1.0842 · 148.21 · 0.30869)
    // tiny rates (JPY/USD 0.006369, IRR/USD 0.0000005904) keep 4 significant digits
    const d = p >= 1000 ? 0 : p >= 100 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.1 ? 5 : Math.min(12, 3 - Math.floor(Math.log10(p)));
    return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + Number(p.toPrecision(3)).toString();
}
export function fmtBig(n) {
  if (n == null) return '—';
  for (const [v, s] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (Math.abs(n) >= v) return '$' + (n / v).toFixed(2) + s;
  return '$' + n.toFixed(0);
}
export const fmtPct = (v, d = 2) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
export const fmtWait = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export function heatClass(v, tf) {
  if (v == null || !isFinite(v)) return 'h0';
  const t = BINS[tf], a = Math.abs(v);
  const lvl = a >= t[3] ? 4 : a >= t[2] ? 3 : a >= t[1] ? 2 : a >= t[0] ? 1 : 0;
  return lvl === 0 ? 'h0' : v > 0 ? 'h' + lvl : 'h-' + lvl;
}
// Price change from the rankings API, or derived from daily candles when that API lacks it (CoinLore has no 30d)
export function chgOf(c, tf) {
  const v = c['price_change_percentage_' + tf + '_in_currency'] ?? (tf === '24h' ? c.price_change_percentage_24h : null);
  return v ?? S.ind[c.id]?.chg?.[tf] ?? null;
}
export const logo = (c, px) => c.flag ? `<span class="flag" style="font-size:${px - 2}px" aria-hidden="true">${c.flag}</span>`
  : c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" width="${px}" height="${px}">`
  : `<span class="ph" style="width:${px}px;height:${px}px" aria-hidden="true">${esc(c.symbol.slice(0, 1).toUpperCase())}</span>`;

/* ================= state ================= */
export const S = {
  markets: [], coins: [], excluded: [], stable: new Set(), gold: new Set(),
  hist: {}, ind: {},
  colorBy: '24h', filter: 'all', view: 'grid', pegged: false,
  sort: { key: 'rank', dir: 1 }, pinned: null, busy: false,
  updated: null, marketSrc: '', stale: false, nextAuto: 0,
  params: SIG.withDefaults(null), scorecard: null, scoreWin: 'd30', scoreH: 1, chart: 'price',
};
export const prefs = store.get('hm.prefs') || {};
export const PEG_PREF = MARKET === 'forex' ? 'peggedFx' : 'pegged';   // each market remembers its own 'show pegged' choice
Object.assign(S, { quote: prefs.fxQuote === 'usd' && MARKET === 'forex' ? 'usd' : 'market', colorBy: prefs.colorBy || '24h', view: prefs.view || 'grid', pegged: !!prefs[PEG_PREF], chart: prefs.chart === 'pnf' ? 'pnf' : 'price', legendOpen: !!prefs.legendOpen });
export const savePrefs = () => store.set('hm.prefs', { ...(store.get('hm.prefs') || {}), ...(MARKET === 'forex' ? { fxQuote: S.quote } : {}), colorBy: S.colorBy, view: S.view, [PEG_PREF]: S.pegged, chart: S.chart, legendOpen: S.legendOpen, theme: document.documentElement.dataset.theme || '' });

export function setStatus(text, kind = '') { $('#status').innerHTML = `<span class="dot ${kind}"></span>${esc(text)}`; }

