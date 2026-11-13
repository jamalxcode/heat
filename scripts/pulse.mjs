// Pulse: a tiny pulse.json (well under 1 KB) with a handful of headline prices, for other pages to show live numbers
// without downloading data.json (hundreds of KB). go.sala.company reads it for its "Live right now" strip.
// Built at the end of the deploy job from the files it just made, so it costs no extra requests.
//   node scripts/pulse.mjs <out pulse.json> <data.json> [metals.json] [energy.json] [forex.json] [etfs.json] [rates.json]
// Each item: { id, label, price, chg (24h %, or null), unit, href }. A missing file or coin is left out, never guessed.
// `xm` (separate, so go.sala.company's strip is unchanged): each market's headline figure, shown on heat's own market
// switch: Bitcoin, the US Dollar Index, gold, Brent, the S&P 500 (SPY) and the US 10-year yield (with its move in bp).
import { dxySeries } from './build-forex.mjs';

// Which tiles to show, in order: [file key, market id, label, unit, page on heat.sala.company]
export const PICKS = [
  ['crypto', 'bitcoin', 'BTC', 'USD', '/'],
  ['crypto', 'ethereum', 'ETH', 'USD', '/'],
  ['metals', 'xau', 'Gold', 'USD/oz', '/metals/'],
  ['energy', 'brent', 'Brent', 'USD/bbl', '/energy/'],
];

const chg24 = m => {
  const v = m.price_change_percentage_24h_in_currency ?? m.price_change_percentage_24h;
  return Number.isFinite(v) ? +v.toFixed(2) : null;
};

// [file key = market page, id, label, unit]
export const XM = [
  ['crypto', 'bitcoin', 'BTC', 'USD'], ['forex', 'dxy', 'DXY', ''], ['metals', 'xau', 'Gold', 'USD/oz'],
  ['energy', 'brent', 'Brent', 'USD/bbl'], ['etfs', 'spy', 'S&P 500', 'USD'], ['rates', 'us10y', 'US 10y', '%'],
];
function headline(key, id, f) {
  if (key === 'forex') {                     // the dollar index, from the six ECB rates in forex.json (as the forex page does)
    const s = dxySeries(f?.hist);
    if (!s || s.length < 2) return null;
    const [a, b] = s.slice(-2).map(p => p[1]);
    return { price: +b.toFixed(2), chg: +((b / a - 1) * 100).toFixed(2) };
  }
  if (key === 'rates') {                     // the US 10-year and its move since the previous close, in basis points
    const c = f?.countries?.find(x => x.id === 'us'), y = c?.series?.y10, n = y?.length;
    if (!(c?.y10 > 0)) return null;
    return { price: +c.y10.toFixed(2), bp: n > 1 ? Math.round((y[n - 1] - y[n - 2]) * 100) : null };
  }
  const m = f?.markets?.find(x => x.id === id);
  return m && m.current_price > 0 ? { price: +m.current_price.toPrecision(6), chg: chg24(m) } : null;
}

export function pulse(files, now = Date.now()) {
  const items = [];
  for (const [key, id, label, unit, path] of PICKS) {
    const m = files[key]?.markets?.find(x => x.id === id);
    if (!m || !(m.current_price > 0)) continue;
    items.push({ id, label, price: +m.current_price.toPrecision(6), chg: chg24(m), unit, href: 'https://heat.sala.company' + path });
  }
  const xm = {};
  for (const [key, id, label, unit] of XM) { const h = headline(key, id, files[key]); if (h) xm[key] = { label, ...h, unit }; }
  return { v: 1, generated: now, items, xm };
}

/* ---------- CLI (Node only) ---------- */
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const [out = 'pulse.json', cryptoFile, metalsFile, energyFile, forexFile, etfsFile, ratesFile] = process.argv.slice(2);
  const load = async f => { if (!f) return null; try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };
  const data = pulse({ crypto: await load(cryptoFile), metals: await load(metalsFile), energy: await load(energyFile),
    forex: await load(forexFile), etfs: await load(etfsFile), rates: await load(ratesFile) });
  if (!data.items.length) { console.error('pulse: no prices found'); process.exit(1); }
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out}: ${data.items.map(i => `${i.label} ${i.price} (${i.chg ?? '?'}%)`).join(', ')}`);
}
