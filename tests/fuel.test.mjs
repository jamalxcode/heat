// Unit tests for the Energy page's weekly fuel rows (scripts/build-fuel.mjs). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseFred, parseUK, parseBulletin, fxFrom, build, EU, SPOT } from '../scripts/build-fuel.mjs';
import { health } from '../scripts/health.mjs';

const DAY = 864e5, dayNum = iso => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY);
function zip(files) {                       // a minimal deflated zip, like an .xlsx
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), data = deflateRawSync(enc.encode(text)), h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22), k = Object.keys(files).length;
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(k, 8); e.writeUInt16LE(k, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
// the EU bulletin: a date serial in A2, then name | Euro-super 95 | diesel per 1,000 litres (in euros)
function bulletin(serial, rows) {
  const names = ['in EUR', ...rows.map(r => r[0])];
  const strings = `<sst>${names.map(s => `<si><t>${s}</t></si>`).join('')}</sst>`;
  const cell = (ref, v, s) => `<c r="${ref}"${s ? ' t="s"' : ''}><v>${v}</v></c>`;
  const body = rows.map((r, i) => `<row r="${i + 3}">${cell(`A${i + 3}`, i + 1, true)}${cell(`B${i + 3}`, r[1])}${cell(`C${i + 3}`, r[2])}</row>`).join('');
  const sheet = `<worksheet><sheetData><row r="1">${cell('A1', 0, true)}</row><row r="2">${cell('A2', serial)}</row>${body}</sheetData></worksheet>`;
  return zip({ 'xl/sharedStrings.xml': strings, 'xl/worksheets/sheet1.xml': sheet });
}

test('the lists: all 27 EU countries; eight US refined products', () => {
  assert.equal(Object.keys(EU).length, 27);
  assert.equal(SPOT.length, 8);
});

test('parsers: FRED csv, the UK weekly csv, the EU bulletin; exchange rates from forex.json', async () => {
  assert.deepEqual(parseFred('observation_date,GASREGW\n2026-09-28,4.46\n2026-10-05,.\n2026-10-05,4.354\n'), [[dayNum('2026-09-28'), 4.46], [dayNum('2026-10-05'), 4.354]]);
  assert.deepEqual(parseUK('﻿Date,ULSP,ULSD,x\n28/09/2026,173.46,197.58,52.95\n05/10/2026,174.88,199.52,52.95\n').at(-1), [dayNum('2026-10-05'), 1.7488, 1.9952]);
  const b = await parseBulletin(bulletin(46293, [['Germany', 2345, 2437], ['Italy', 2156, 2351], ['Atlantis', 1, 1]]));
  assert.equal(b.day, dayNum('2026-09-28'), 'Excel serial 46293 = 28 Sep 2026');
  assert.deepEqual(b.prices.de, { name: 'Germany', flag: '🇩🇪', petrol: 2.345, diesel: 2.437 });
  assert.equal(Object.keys(b.prices).length, 2, 'only the 27 EU countries');
  const fx = fxFrom({ markets: [{ symbol: 'USD/EUR', current_price: 0.8 }, { symbol: 'USD/GBP', current_price: 0.75 }] });
  assert.equal(fx.EUR, 1.25);
  assert.ok(Math.abs(fx.GBP - 4 / 3) < 1e-12);
});

test('build: dollars per litre, the week’s change, history kept between runs, last figures kept when a source fails', async () => {
  const now = Date.parse('2026-10-07T10:00:00Z');
  const fred = { GASREGW: 'observation_date,GASREGW\n2026-09-28,4.46\n2026-10-05,4.354\n', GASDESW: 'observation_date,GASDESW\n2026-09-28,6.3\n2026-10-05,6.199\n' };
  const files = (euSerial, ok = true) => async url => {
    if (!ok) return { ok: false, status: 500, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    if (url.includes('energy.ec.europa.eu')) { const buf = bulletin(euSerial, Object.keys(EU).map((n, i) => [n, 2000 + i, 2100 + i])); return { ok: true, arrayBuffer: async () => buf }; }
    if (url.includes('www.gov.uk')) return { ok: true, text: async () => '<a href="https://assets.publishing.service.gov.uk/media/x/CSV__2018_-__.csv">CSV</a>' };
    if (url.includes('assets.publishing')) return { ok: true, text: async () => 'Date,ULSP,ULSD\n28/09/2026,173.46,197.58\n05/10/2026,174.88,199.52\n' };
    const id = url.match(/id=([A-Z]+)/)[1];
    return { ok: true, text: async () => fred[id] || `observation_date,${id}\n2026-09-22,4.0\n2026-09-29,4.2\n` };
  };
  const forex = { markets: [{ symbol: 'USD/EUR', current_price: 0.8 }, { symbol: 'USD/GBP', current_price: 0.75 }] };
  const first = await build({ forex, now, fetchFn: files(46286), log: () => {} });
  assert.equal(first.pump.length, 29);
  const us = first.pump.find(p => p.id === 'us'), uk = first.pump.find(p => p.id === 'uk'), de = first.pump.find(p => p.id === 'de');
  assert.ok(Math.abs(us.petrol.usdL - 4.354 / 3.785411784) < 1e-4, 'dollars per gallon → per litre');
  assert.ok(Math.abs(us.petrol.chg - (4.354 / 4.46 - 1) * 100) < 1e-3);
  assert.ok(Math.abs(uk.petrol.usdL - 1.7488 * 4 / 3) < 1e-3, 'pence → pounds → dollars');
  assert.equal(de.petrol.chg, null, 'the EU history starts with this bulletin');
  assert.equal(first.spot.length, 8);
  assert.ok(Math.abs(first.spot[0].chg1w - 5) < 1e-6);
  // a week later: a new bulletin; the change comes from the last file's history
  const next = await build({ prev: first, forex, now: now + 7 * DAY, fetchFn: files(46293), log: () => {} });
  assert.equal(next.pump.find(p => p.id === 'de').hist.length, 2);
  assert.equal(next.pump.find(p => p.id === 'de').petrol.chg, 0);
  // everything failing: the last figures, marked
  const down = await build({ prev: next, forex, now: now + 8 * DAY, fetchFn: files(0, false), log: () => {} });
  assert.equal(down.pump.length, 29);
  assert.ok(down.pump.every(p => p.notRefreshed));
});

test('health: fuel prices current, partly late, or missing', () => {
  const now = Date.parse('2026-10-07T10:00:00Z');
  const fuel = (eu, uk, us, spot) => ({ pump: [{ id: 'de', region: 'Europe', date: eu }, { id: 'uk', region: 'Europe', date: uk }, { id: 'us', region: 'Americas', date: us }], spot: [{ date: spot }] });
  const row = f => health({ fuel: f }, now).sources.find(s => s.key === 'fuel');
  assert.equal(row(fuel('2026-09-28', '2026-10-05', '2026-10-05', '2026-09-29')).state, 'ok');
  assert.equal(row(fuel('2026-08-28', '2026-10-05', '2026-10-05', '2026-09-29')).state, 'warn');
  assert.match(row(fuel('2026-08-28', '2026-10-05', '2026-10-05', '2026-09-29')).note, /late: EU/);
  assert.equal(row(null).state, 'down');
  assert.equal(health({}, now).sources.find(s => s.key === 'fuel'), undefined);
});
