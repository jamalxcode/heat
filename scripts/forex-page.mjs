// Makes forex/index.html from index.html: the same page, with the forex search tags, About/FAQ text and source
// credits swapped in between the <!-- SEO:start -->…<!-- SEO:end --> (and ABOUT, SOURCES) markers. The page picks
// its market from its address (/forex/), so the rest of the file stays identical and every change shows on both.
//   node scripts/forex-page.mjs <out.html>        (used by the deploy job and the browser tests' local server)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const root = new URL('../', import.meta.url);

// Replace the block between <!-- NAME:start … --> and <!-- NAME:end --> (markers included) with `block`
export function swap(html, name, block) {
  const re = new RegExp(`[ \\t]*<!-- ${name}:start[\\s\\S]*?<!-- ${name}:end -->\\n?`);
  if (!re.test(html)) throw new Error(`index.html has no ${name} markers`);
  return html.replace(re, () => block.endsWith('\n') ? block : block + '\n');
}

export async function forexPage() {
  const read = p => readFile(new URL(p, root), 'utf8');
  let html = await read('index.html');
  html = swap(html, 'SEO', await read('seo/forex-head.html'));
  html = swap(html, 'ABOUT', await read('seo/forex-about.html'));
  html = swap(html, 'SOURCES', await read('seo/forex-sources.html'));
  return html;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const out = process.argv[2] || 'forex/index.html';
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await forexPage());
  console.log(`Wrote ${out}`);
}
