// Unit tests for pulse.json (scripts/pulse.mjs), the small price file go.sala.company reads. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pulse, PICKS } from '../scripts/pulse.mjs';

const crypto = { markets: [
  { id: 'bitcoin', current_price: 91234.5678, price_change_percentage_24h: 1.23456 },
  { id: 'ethereum', current_price: 3100.1, price_change_percentage_24h_in_currency: -0.5, price_change_percentage_24h: 9 },
  { id: 'solana', current_price: 150 },
] };
const metals = { markets: [{ id: 'xau', current_price: 4012.3, price_change_percentage_24h_in_currency: 0.4 }] };
const energy = { markets: [{ id: 'brent', current_price: 64.2, price_change_percentage_24h_in_currency: null }] };

test('pulse: the picked prices in order, rounded, linked to their page', () => {
  const p = pulse({ crypto, metals, energy }, 42);
  assert.equal(p.v, 1);
  assert.equal(p.generated, 42);
  assert.deepEqual(p.items.map(i => i.label), ['BTC', 'ETH', 'Gold', 'Brent']);
  assert.deepEqual(p.items[0], { id: 'bitcoin', label: 'BTC', price: 91234.6, chg: 1.23, unit: 'USD', href: 'https://heat.sala.company/' });
  assert.equal(p.items[1].chg, -0.5, 'the _in_currency change wins over the plain one');
  assert.equal(p.items[2].href, 'https://heat.sala.company/metals/');
  assert.equal(p.items[3].chg, null, 'no change known: null, not 0');
  assert.ok(JSON.stringify(p).length < 1024, 'stays tiny');
});

test('pulse: a missing file, coin or price is left out, never guessed', () => {
  const p = pulse({ crypto: { markets: [{ id: 'bitcoin', current_price: 0 }, { id: 'ethereum', current_price: 3000 }] }, metals: null });
  assert.deepEqual(p.items.map(i => i.id), ['ethereum']);
  assert.deepEqual(pulse({}).items, []);
});

test('pulse picks: every id is a market the builders really publish', () => {
  assert.deepEqual(PICKS.map(p => p[1]), ['bitcoin', 'ethereum', 'xau', 'brent']);
});

test('pulse CLI: writes pulse.json, and fails when there are no prices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pulse-'));
  const f = n => join(dir, n);
  writeFileSync(f('data.json'), JSON.stringify(crypto));
  writeFileSync(f('metals.json'), JSON.stringify(metals));
  const script = new URL('../scripts/pulse.mjs', import.meta.url).pathname;
  execFileSync(process.execPath, [script, f('pulse.json'), f('data.json'), f('metals.json'), f('missing.json')]);
  const out = JSON.parse(readFileSync(f('pulse.json'), 'utf8'));
  assert.deepEqual(out.items.map(i => i.label), ['BTC', 'ETH', 'Gold']);
  assert.throws(() => execFileSync(process.execPath, [script, f('none.json'), f('missing.json')], { stdio: 'pipe' }));
});
