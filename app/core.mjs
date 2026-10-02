// heat.sala.company page script: core (split from index.html; see app/main.mjs for the order things start in)
import * as SIG from '/signals.mjs';

/* ================= market ================= */
// Everything market-specific (crypto, forex) is in markets.mjs; re-exported here so modules import it with the rest
import { MARKETS, MARKET, M, TF } from './markets.mjs';
export { MARKETS, MARKET, M, TF };

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
  return p == null || !isFinite(p) ? '—' : M.price(p);   // $84,109 for crypto, 0.88067 for an exchange rate
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
// Flag emoji: real flags on phones and Macs, but Windows has none and shows two bare letters. Detect it once (a color
// emoji draws colored pixels; the letter fallback is black text) and show a small country-code badge there instead.
export const FLAG_EMOJI = (() => {
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 24;
    const x = cv.getContext('2d', { willReadFrequently: true });
    x.font = '18px sans-serif'; x.textBaseline = 'top'; x.fillStyle = '#000'; x.fillText('🇺🇸', 0, 0);
    const d = x.getImageData(0, 0, 24, 24).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40 && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) return true;
    return false;
  } catch { return true; }
})();
const flagCode = f => [...f].map(ch => String.fromCharCode(ch.codePointAt(0) - 0x1F1E6 + 65)).join('');   // 🇪🇺 → EU
export const logo = (c, px) => c.flag
  ? FLAG_EMOJI ? `<span class="flag" style="font-size:${px - 2}px" aria-hidden="true">${c.flag}</span>` : `<span class="flag-code" aria-hidden="true">${flagCode(c.flag)}</span>`
  : c.badge ? `<span class="metal metal-${esc(c.id)}" style="width:${px}px;height:${px}px" aria-hidden="true">${esc(c.badge)}</span>`   // metals: their chemical symbol (Au, Ag …)
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
export const PEG_PREF = M.pegPref;   // each market remembers its own 'show pegged' choice
Object.assign(S, { quote: prefs.fxQuote === 'usd' && M.quoteSwitch ? 'usd' : 'market', colorBy: prefs.colorBy || '24h', view: prefs.view || 'grid', pegged: !!prefs[PEG_PREF], chart: prefs.chart === 'pnf' ? 'pnf' : 'price', legendOpen: !!prefs.legendOpen });
if (!M.scorecard && S.view === 'score') S.view = 'grid';   // metals has no Scorecard view
export const savePrefs = () => store.set('hm.prefs', { ...(store.get('hm.prefs') || {}), ...(M.quoteSwitch ? { fxQuote: S.quote } : {}), colorBy: S.colorBy, view: S.view, ...(PEG_PREF ? { [PEG_PREF]: S.pegged } : {}), chart: S.chart, legendOpen: S.legendOpen, theme: document.documentElement.dataset.theme || '' });

export function setStatus(text, kind = '') { $('#status').innerHTML = `<span class="dot ${kind}"></span>${esc(text)}`; }

