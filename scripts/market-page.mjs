// Makes a market's page (forex/index.html, metals/index.html, energy/index.html, etfs/index.html) from index.html: the same page, with that market's search
// tags, About/FAQ text and source credits swapped in between the <!-- SEO:start -->…<!-- SEO:end --> (and ABOUT,
// SOURCES) markers, from seo/<market>-head.html, -about.html and -sources.html. The page picks its market from its
// address (/forex/, /metals/, /energy/), so the rest of the file stays identical and every change shows on all markets.
//   node scripts/market-page.mjs <market> <out.html>     (used by the deploy job and the browser tests' local server)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const root = new URL('../', import.meta.url);
export const PAGES = ['forex', 'metals', 'energy', 'etfs', 'rates'];   // markets with their own page; crypto is index.html itself

// Replace the block between <!-- NAME:start … --> and <!-- NAME:end --> (markers included) with `block`
export function swap(html, name, block) {
  const re = new RegExp(`[ \\t]*<!-- ${name}:start[\\s\\S]*?<!-- ${name}:end -->\\n?`);
  if (!re.test(html)) throw new Error(`index.html has no ${name} markers`);
  return html.replace(re, () => block.endsWith('\n') ? block : block + '\n');
}

export async function marketPage(market) {
  if (!PAGES.includes(market)) throw new Error(`no page for market "${market}"`);
  const read = p => readFile(new URL(p, root), 'utf8');
  let html = await read('index.html');
  html = swap(html, 'SEO', await read(`seo/${market}-head.html`));
  html = swap(html, 'ABOUT', await read(`seo/${market}-about.html`));
  html = swap(html, 'SOURCES', await read(`seo/${market}-sources.html`));
  return html;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [market, out = `${market}/index.html`] = process.argv.slice(2);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await marketPage(market));
  console.log(`Wrote ${out}`);
}
