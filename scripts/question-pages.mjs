// One static page per top prediction question, for search engines and link previews: /predictions/q/<slug>/ with the
// question, the market's answer and chance, each venue's price, the leading answers and the money, plus a link that
// opens it on the live heat map; and /predictions/q/ listing them all. Rebuilt with every update (every 10 minutes)
// from predictions.json, and added to the sitemap.
//   node scripts/question-pages.mjs <predictions.json> <out dir, e.g. _site/predictions/q> [sitemap.xml]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { bestMatch } from '../app/names.mjs';

const SITE = 'https://heat.sala.company', TOP = 80, SETTLED = 0.97;
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='88'%3E%F0%9F%94%A5%3C/text%3E%3C/svg%3E";
const VNAME = { polymarket: 'Polymarket', kalshi: 'Kalshi', predictit: 'PredictIt', manifold: 'Manifold', betfair: 'Betfair' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = p => p == null ? '—' : p >= 0.995 && p < 1 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : Math.round(p * 100) + '%';
const usd = n => n == null ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : `$${Math.round(n)}`;
const day = iso => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null;
export const slugOf = t => String(t).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || 'question';

const isYesNo = m => m.outcomes.length === 1 && /^yes$/i.test(m.outcomes[0].name);
const isGame = m => m.cat === 'Sports' && /\bvs?\.?\b|\bat\b.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(m.title);
const settled = m => m.outcomes.some(o => (o.p ?? 0) >= SETTLED || ((o.p ?? 0) >= 0.9 && (o.d7 ?? 0) >= 0.3)) || (isYesNo(m) && (m.outcomes[0].p ?? 1) <= 1 - SETTLED);
// "Anthropic IPO by...?" / "Bitcoin above ___ on Nov 5?" on a ladder: the step nearest 50% written in, answered yes/no
const blank = m => !isYesNo(m) && !m.exclusive && (/_{2,}/.test(m.title) || /(\.\.\.|…)\s*\??\s*$/.test(m.title));
const step = n => String(n).replace(/^[↑↓≥≤><\s]+/, '').trim();
export const titleOf = (m, a = answerOf(m)) => !a.step ? m.title : m.title.replace(/_{2,}/, step(a.step)).replace(/\s*(\.\.\.|…)\s*(\??)\s*$/, (x, d, q) => ' ' + step(a.step) + (q || '?'));
// the answer in plain words: yes/no as its likelier side, a race as its leader, a ladder as the step nearest 50%
function answerOf(m) {
  if (isYesNo(m)) { const p = m.outcomes[0].p; return p != null && p < 0.5 ? { name: 'No', p: 1 - p, yn: true, no: true } : { name: 'Yes', p, yn: true }; }
  const os = m.outcomes.filter(o => o.p != null);
  if (!m.exclusive) {
    const o = os.reduce((a, x) => Math.abs(x.p - 0.5) < Math.abs(a.p - 0.5) ? x : a, os[0]);
    if (blank(m)) return o.p < 0.5 ? { name: 'No', p: 1 - o.p, yn: true, step: o.name, no: true } : { name: 'Yes', p: o.p, yn: true, step: o.name };
    return { name: o.name, p: o.p };
  }
  const o = os.reduce((a, x) => x.p > a.p ? x : a, os[0]);
  return { name: o.name, p: o.p };
}

// the questions worth a page: open, real money, not single games, one per question (a group's lead), most money first
export function pickQuestions(P, n = TOP) {
  return P.markets.filter(m => !m.stale && m.cur !== 'MANA' && (m.interest || 0) > 0 && !isGame(m) && !settled(m) && (!m.group || m.group === m.id))
    .sort((a, b) => (b.interest || 0) - (a.interest || 0)).slice(0, n);
}

function page(m, P, slug, others) {
  const a = answerOf(m), members = m.group ? P.markets.filter(x => x.group === m.group) : [m];
  const venues = members.map(x => {
    const o = a.step ? bestMatch(a.step, x.outcomes) : a.yn ? (isYesNo(x) ? x.outcomes[0] : null) : bestMatch(a.name, x.outcomes);
    const p = o?.p ?? null;
    return { x, p: p != null && a.yn && a.no ? 1 - p : p };
  });
  const top = a.yn && !a.step ? [] : [...m.outcomes].filter(o => o.p != null).sort((x, y) => y.p - x.p).slice(0, 8);
  const today = members.reduce((t, x) => t + (x.usd24 || 0), 0), total = members.reduce((t, x) => t + (x.usdTotal || 0), 0);
  const vlist = members.map(x => VNAME[x.venue]).join(', ');
  const when = new Date(P.generated).toUTCString().replace(':00 GMT', ' UTC').replace(/ \d\d:\d\d:\d\d GMT$/, ' UTC');
  const head = `${a.name} ${pct(a.p)}`;
  const desc = `${titleOf(m)} The market says ${head} on ${vlist}${total ? `, with ${usd(total)} bet` : ''}. Odds from every prediction market in one place, updated every 10 minutes.`;
  const url = `${SITE}/predictions/q/${slug}/`, live = `/predictions/?m=${encodeURIComponent(m.id)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titleOf(m))} Odds: ${esc(head)} | heat.sala.company</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}"><meta name="robots" content="index, follow">
<meta property="og:type" content="article"><meta property="og:site_name" content="heat.sala.company"><meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(titleOf(m))} ${esc(head)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}/og-image.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${ICON}">
<style>
:root{--bg:#fafaf8;--ink:#1d1c1a;--muted:#6b6a65;--line:#e4e2dc;--bar:#3d6d97;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--ink:#f4f3ee;--muted:#a3a29c;--line:#2e2e2b;--bar:#8fc0ea;--card:#1c1c1b}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 48px}
a{color:inherit} nav{font-size:13px;color:var(--muted)} nav a{color:var(--muted)}
h1{font-size:clamp(24px,5vw,34px);line-height:1.2;margin:14px 0 8px}
.say{font-size:20px;margin:0 0 4px} .say b{font-size:34px} .muted{color:var(--muted);font-size:14px}
table{width:100%;border-collapse:collapse;margin:8px 0 18px;background:var(--card)} td,th{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;font-size:15px}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)} td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.b{height:8px;border-radius:4px;background:var(--bar);display:block}
.go{display:inline-block;margin:6px 0 18px;padding:10px 16px;border-radius:10px;background:var(--ink);color:var(--bg);text-decoration:none;font-weight:700}
ul{padding-left:18px} li{margin:4px 0}
</style></head><body><main>
<nav><a href="/predictions/">Prediction market heatmap</a> › <a href="/predictions/q/">Top questions</a></nav>
<h1>${esc(titleOf(m))}</h1>
<p class="say">The market says: <strong>${esc(a.name)}</strong> <b>${pct(a.p)}</b></p>
<p class="muted">On ${esc(vlist)} · ${today ? `${usd(today)} bet today · ` : ''}${total ? `${usd(total)} bet in total · ` : ''}${m.end ? `ends ${esc(day(m.end))} · ` : ''}updated ${esc(when)}</p>
<a class="go" href="${live}">See it live on the heat map →</a>
${venues.length > 1 ? `<h2>“${esc(a.name)}” on each venue</h2><table><thead><tr><th>Venue</th><th>Chance</th></tr></thead><tbody>${venues.map(v => `<tr><td><a href="${esc(v.x.url)}" rel="noopener nofollow">${VNAME[v.x.venue]}</a></td><td class="n">${pct(v.p)}</td></tr>`).join('')}</tbody></table>` : ''}
${top.length ? `<h2>The leading answers on ${VNAME[m.venue]}</h2><table><thead><tr><th>Answer</th><th>Chance</th><th style="width:40%"></th></tr></thead><tbody>${top.map(o => `<tr><td>${esc(o.name)}</td><td class="n">${pct(o.p)}</td><td><span class="b" style="width:${Math.max(2, Math.round(o.p * 100))}%"></span></td></tr>`).join('')}</tbody></table>` : ''}
<p class="muted">A chance is the price of a contract that pays $1 if the answer happens: ${pct(a.p)} means traders pay about ${Math.round((a.p || 0) * 100)}¢ for it. Prices from ${esc(vlist)}; not advice.</p>
<h2>More questions</h2><ul>${others.map(o => `<li><a href="/predictions/q/${o.slug}/">${esc(titleOf(o.m))}</a> <span class="muted">${esc(o.head)}</span></li>`).join('')}</ul>
</main></body></html>
`;
}

function indexPage(list, P) {
  const url = `${SITE}/predictions/q/`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Top Prediction Market Questions and Odds | heat.sala.company</title>
<meta name="description" content="The ${list.length} most traded prediction market questions right now, with the odds on Polymarket, Kalshi, PredictIt and Manifold. Updated every 10 minutes.">
<link rel="canonical" href="${url}"><link rel="icon" href="${ICON}">
<style>:root{--bg:#fafaf8;--ink:#1d1c1a;--muted:#6b6a65;--line:#e4e2dc}@media (prefers-color-scheme:dark){:root{--bg:#141414;--ink:#f4f3ee;--muted:#a3a29c;--line:#2e2e2b}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:760px;margin:0 auto;padding:20px 16px 48px}
a{color:inherit}nav{font-size:13px}h1{font-size:30px;margin:12px 0}li{margin:6px 0;padding-bottom:6px;border-bottom:1px solid var(--line);list-style:none}ul{padding:0}.muted{color:var(--muted);font-size:14px}</style>
</head><body><main><nav><a href="/predictions/">← Prediction market heatmap</a></nav>
<h1>Top prediction market questions</h1><p class="muted">The ${list.length} most traded open questions across Polymarket, Kalshi, PredictIt and Manifold, updated ${esc(new Date(P.generated).toUTCString())}.</p>
<ul>${list.map(o => `<li><a href="/predictions/q/${o.slug}/">${esc(titleOf(o.m))}</a><br><span class="muted">${esc(o.head)}</span></li>`).join('')}</ul></main></body></html>
`;
}

export function buildPages(P, n = TOP) {
  const qs = pickQuestions(P, n), used = new Set();
  const list = qs.map(m => {
    let slug = slugOf(m.title);   // from the raw title, so the address stays the same when the step shown changes
    if (used.has(slug)) slug = `${slug}-${m.venue}`;
    used.add(slug);
    const a = answerOf(m);
    return { m, slug, head: `${a.name} ${pct(a.p)}` };
  });
  const pages = list.map((o, i) => ({ slug: o.slug, html: page(o.m, P, o.slug, list.filter((_, j) => j !== i).slice(0, 12)) }));
  return { list, pages, index: indexPage(list, P) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [src, out, sitemap] = process.argv.slice(2);
  const P = JSON.parse(await readFile(src, 'utf8'));
  const { list, pages, index } = buildPages(P);
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/index.html`, index);
  for (const p of pages) { await mkdir(`${out}/${p.slug}`, { recursive: true }); await writeFile(`${out}/${p.slug}/index.html`, p.html); }
  if (sitemap) {
    try {
      const sm = await readFile(sitemap, 'utf8'), d = new Date().toISOString().slice(0, 10);
      const urls = [`${SITE}/predictions/q/`, ...list.map(o => `${SITE}/predictions/q/${o.slug}/`)].map(u => `  <url><loc>${u}</loc><lastmod>${d}</lastmod><changefreq>hourly</changefreq></url>`).join('\n');
      await writeFile(sitemap, sm.replace('</urlset>', urls + '\n</urlset>'));
    } catch (e) { console.log(`Sitemap not updated: ${e.message}`); }
  }
  console.log(`Wrote ${pages.length} question pages and the index to ${out}`);
}
