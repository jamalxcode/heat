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

test('pulse xm: each market’s headline figure for the market switch (items unchanged); missing ones left out', () => {
  const day = 20000, packed = v => ({ t0: day * 864e5, c: v });
  const forex = { hist: { eur: packed([0.9, 0.91]), jpy: packed([150, 151]), gbp: packed([0.78, 0.785]), cad: packed([1.36, 1.37]), sek: packed([10.5, 10.6]), chf: packed([0.88, 0.89]) } };
  const rates = { countries: [{ id: 'us', y10: 4.3123, series: { d: [day, day + 1], y10: [4.27, 4.31] } }] };
  const etfs = { markets: [{ id: 'spy', current_price: 580.12, price_change_percentage_24h_in_currency: 0.42 }] };
  const p = pulse({ crypto, metals, energy, forex, etfs, rates }, 1);
  assert.deepEqual(p.items.map(i => i.label), ['BTC', 'ETH', 'Gold', 'Brent'], 'go.sala.company’s strip is unchanged');
  assert.deepEqual(Object.keys(p.xm), ['crypto', 'forex', 'metals', 'energy', 'etfs', 'rates']);
  assert.deepEqual(p.xm.rates, { label: 'US 10y', price: 4.31, bp: 4, unit: '%' });
  assert.equal(p.xm.etfs.chg, 0.42);
  assert.ok(p.xm.forex.chg > 0, 'every currency fell against the dollar, so the index rose');
  assert.ok(JSON.stringify(p).length < 1024, 'still tiny');
  assert.deepEqual(Object.keys(pulse({ crypto }).xm), ['crypto']);
});
