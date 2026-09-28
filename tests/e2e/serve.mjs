// Local server for the site: serves the repo, with data.json / scorecard.json from the test fixtures (always fresh).
// Browser tests use it (playwright.config.mjs); it's also a handy local preview: node tests/e2e/serve.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixtures } from './fixtures.mjs';

const root = normalize(fileURLToPath(new URL('../../', import.meta.url)));
const port = +process.env.PORT || 4173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.md': 'text/plain' };

let cache = { at: 0 };
const fixtures = () => { if (Date.now() - cache.at > 60e3) cache = { at: Date.now(), ...makeFixtures() }; return cache; };

http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/data.json' || path === '/scorecard.json') {
    const f = fixtures();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(path === '/data.json' ? f.data : f.scorecard));
  }
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root) || path.startsWith('/.git')) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(port, () => console.log(`heat preview with test data: http://localhost:${port}/`));
