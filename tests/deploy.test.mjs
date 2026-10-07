// Unit test for the deploy job: every module the page imports must be published. The browser tests' local server
// serves the whole repo, so they can't catch a file the deploy forgot (Oct 2026: app/dxy.mjs imported
// scripts/build-forex.mjs, which the deploy didn't copy, and no page could load until it was reverted).
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');

test('deploy publishes every /scripts/… and root module the page imports', async () => {
  const yml = await read('.github/workflows/update-data.yml');
  // files copied into _site/ and _site/scripts/ (a cp line may list several)
  const copied = new Set();
  for (const m of yml.matchAll(/^\s*cp ([^\n#]+?) _site\/(scripts\/)?\s*(?:#|$)/gm)) {
    for (const f of m[1].trim().split(/\s+/)) copied.add(m[2] ? f : '/' + f);
  }
  const imports = new Set();
  for (const f of (await readdir(new URL('app/', root))).filter(x => x.endsWith('.mjs'))) {
    for (const m of (await read('app/' + f)).matchAll(/['"](\/(?:scripts\/)?[\w.-]+\.mjs)['"]/g)) imports.add(m[1]);
  }
  assert.ok(imports.has('/signals.mjs') && imports.has('/scripts/build-data.mjs'), 'found the page imports');
  const missing = [...imports].filter(p => !copied.has(p.startsWith('/scripts/') ? p.slice(1) : p));
  assert.deepEqual(missing, [], `imported by the page but not copied by .github/workflows/update-data.yml: ${missing.join(', ')}`);
});
