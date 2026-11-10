// Pulse: a tiny pulse.json (well under 1 KB) with a handful of headline prices, for other pages to show live numbers
// without downloading data.json (hundreds of KB). go.sala.company reads it for its "Live right now" strip.
// Built at the end of the deploy job from the files it just made, so it costs no extra requests.
//   node scripts/pulse.mjs <out pulse.json> <data.json> [metals.json] [energy.json]
// Each item: { id, label, price, chg (24h %, or null), unit, href }. A missing file or coin is left out, never guessed.

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

export function pulse(files, now = Date.now()) {
  const items = [];
  for (const [key, id, label, unit, path] of PICKS) {
    const m = files[key]?.markets?.find(x => x.id === id);
    if (!m || !(m.current_price > 0)) continue;
    items.push({ id, label, price: +m.current_price.toPrecision(6), chg: chg24(m), unit, href: 'https://heat.sala.company' + path });
  }
  return { v: 1, generated: now, items };
}

/* ---------- CLI (Node only) ---------- */
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const [out = 'pulse.json', cryptoFile, metalsFile, energyFile] = process.argv.slice(2);
  const load = async f => { if (!f) return null; try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };
  const data = pulse({ crypto: await load(cryptoFile), metals: await load(metalsFile), energy: await load(energyFile) });
  if (!data.items.length) { console.error('pulse: no prices found'); process.exit(1); }
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out}: ${data.items.map(i => `${i.label} ${i.price} (${i.chg ?? '?'}%)`).join(', ')}`);
}
