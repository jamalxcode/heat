// Local server for the site: serves the repo, with data.json / scorecard.json and forex.json / forex-scorecard.json
// and metals.json from the test fixtures (always fresh), and /forex/ and /metals/ made from index.html like the deploy job.
// Browser tests use it (playwright.config.mjs); it's also a handy local preview: node tests/e2e/serve.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixtures, makeForexFixtures, makeMetalsFixtures, makeTvFixture, makeHealthFixture } from './fixtures.mjs';
import { marketPage, PAGES } from '../../scripts/market-page.mjs';

const root = normalize(fileURLToPath(new URL('../../', import.meta.url)));
const port = +process.env.PORT || 4173;
const TYPES = { '.png': 'image/png', '.txt': 'text/plain', '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.md': 'text/plain' };

let cache = { at: 0 };
const fixtures = () => {
  if (Date.now() - cache.at > 60e3) { const fx = makeForexFixtures(), base = makeFixtures(); cache = { at: Date.now(), ...base, fxData: fx.data, fxScorecard: fx.scorecard, metals: makeMetalsFixtures(base.data), tv: makeTvFixture(), health: makeHealthFixture() }; }
  return cache;
};
const JSON_ROUTES = { '/data.json': 'data', '/scorecard.json': 'scorecard', '/forex.json': 'fxData', '/forex-scorecard.json': 'fxScorecard', '/metals.json': 'metals', '/tv.json': 'tv', '/health.json': 'health' };

http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (JSON_ROUTES[path]) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(fixtures()[JSON_ROUTES[path]]));
  }
  const page = PAGES.find(m => path === '/' + m || path === '/' + m + '/');   // /forex/, /metals/: made from index.html, as the deploy job does
  if (page) {
    if (!path.endsWith('/')) { res.writeHead(301, { location: path + '/' }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(await marketPage(page));
  }
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root) || path.startsWith('/.git')) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(port, () => console.log(`heat preview with test data: http://localhost:${port}/`));
