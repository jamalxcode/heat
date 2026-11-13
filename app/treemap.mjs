// heat.sala.company: the treemap layout shared by the prediction markets' money map (app/predictions.mjs) and the price
// pages' Map view (app/render.mjs).
// squarified treemap (Bruls, Huizing & van Wijk): lays items (each with .v) into a rectangle in rows that keep the
// pieces close to square
export function squarify(items, x, y, w, h) {
  const out = [], total = items.reduce((s, i) => s + i.v, 0);
  if (!total || w <= 0 || h <= 0) return out;
  let rest = items.map(i => ({ ...i, a: i.v / total * w * h })).sort((a, b) => b.a - a.a);
  const worst = (row, side) => { const s = row.reduce((t, r) => t + r.a, 0), mx = Math.max(...row.map(r => r.a)), mn = Math.min(...row.map(r => r.a)); return Math.max(side * side * mx / (s * s), (s * s) / (side * side * mn)); };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) { row.push(rest[i]); i++; }
    rest = rest.slice(i);
    const s = row.reduce((t, r) => t + r.a, 0);
    if (w >= h) { const cw = s / h; let cy = y; for (const r of row) { const ch = r.a / cw; out.push({ ...r, x, y: cy, w: cw, h: ch }); cy += ch; } x += cw; w -= cw; }
    else { const rh = s / w; let cx = x; for (const r of row) { const cw = r.a / rh; out.push({ ...r, x: cx, y, w: cw, h: rh }); cx += cw; } y += rh; h -= rh; }
  }
  return out;
}
