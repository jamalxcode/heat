// Unit tests for the TradingView chart links (scripts/tradingview.mjs). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, sameAsset, pick, refresh, lookup, chartUrl, assetsOf } from '../scripts/tradingview.mjs';

const btc = { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' };

test('candidates: the exchange pair the candles came from first, then fallbacks; forex both ways; metals spot', () => {
  assert.deepEqual(candidates(btc, { src: 'Gate.io', pair: 'BTC/USDT' }, 'crypto'),
    ['GATE:BTCUSDT', 'BINANCE:BTCUSDT', 'CRYPTO:BTCUSD', 'COINBASE:BTCUSD']);
  assert.deepEqual(candidates(btc, { src: 'Binance', pair: 'BTC/USDT' }, 'crypto'),
    ['BINANCE:BTCUSDT', 'CRYPTO:BTCUSD', 'COINBASE:BTCUSD'], 'no duplicates');
  assert.deepEqual(candidates({ id: 'x', symbol: 'figr_heloc', name: 'F' }, { src: 'CoinGecko', pair: 'FIGR_HELOC/USD' }, 'crypto')[0],
    'BINANCE:FIGRHELOCUSDT', 'CoinGecko candles: no exchange pair; symbols cleaned');
  assert.deepEqual(candidates({ id: 'x', symbol: '币安人生', name: 'B' }, null, 'crypto'), [], 'no Latin symbol: nothing to link');
  assert.deepEqual(candidates({ id: 'jpy' }, null, 'forex'), ['FX_IDC:USDJPY']);
  assert.deepEqual(candidates({ id: 'jpy' }, null, 'forex', true), ['FX_IDC:JPYUSD']);
  assert.deepEqual(candidates({ id: 'xpd', symbol: 'xpd' }, null, 'metals'), ['TVC:PALLADIUM']);
  assert.deepEqual(candidates({ id: 'pax-gold', symbol: 'paxg', name: 'PAX Gold' }, { src: 'Binance', pair: 'PAXG/USDT' }, 'metals')[0], 'BINANCE:PAXGUSDT');
});

test('sameAsset: the generic CRYPTO: symbol must name the same coin', () => {
  assert.ok(sameAsset('Bitcoin', 'Bitcoin'));
  assert.ok(sameAsset('BUILDon', 'BUILDon'));
  assert.ok(sameAsset('Olympus v2', 'Olympus'));
  assert.ok(sameAsset('Gomining', 'GoMining Token'), 'generic words are ignored');
  assert.ok(sameAsset('Strategy PP Variable tokenized stock (xStock)', 'Strategy PP Variable xStock'));
  assert.ok(!sameAsset('Betting Token', 'Beta Coin'));
  assert.ok(!sameAsset('Bitcoin', 'Bitcoin Cash'), 'every word of the name must be there');
  assert.ok(!sameAsset('', 'Bitcoin'));
});

test('pick: the first candidate known to exist; never a missing or a different coin', () => {
  const h = { src: 'Gate.io', pair: 'BTC/USDT' };
  assert.equal(pick(btc, h, 'crypto', { 'GATE:BTCUSDT': [0, 1, ''], 'BINANCE:BTCUSDT': [1, 1, 'Bitcoin / TetherUS'] }), 'BINANCE:BTCUSDT');
  assert.equal(pick(btc, h, 'crypto', {}), null, 'nothing checked yet: no link');
  assert.equal(pick(btc, h, 'crypto', null), null);
  assert.equal(pick(btc, h, 'crypto', { 'CRYPTO:BTCUSD': [1, 1, 'Bitcoin'] }), 'CRYPTO:BTCUSD');
  assert.equal(pick({ ...btc, name: 'Bitcoin Cash' }, h, 'crypto', { 'CRYPTO:BTCUSD': [1, 1, 'Bitcoin'] }), null);
  assert.equal(pick({ ...btc, name: 'Beta Coin' }, h, 'crypto', { 'CRYPTO:BTCUSD': [1, 1, 'Betting Token'] }), null);
  assert.equal(chartUrl('FX_IDC:USDJPY'), 'https://www.tradingview.com/chart/?symbol=FX_IDC%3AUSDJPY');
});

test('refresh: checks only new or expired symbols, stops at the first usable one, and never trusts a failed lookup', async () => {
  const now = 1e12, DAY = 864e5, asked = [];
  const exists = { 'BINANCE:ETHUSDT': 'Ethereum / TetherUS', 'TVC:GOLD': 'Gold' };
  const lookupFn = async s => { asked.push(s); return { found: s in exists, desc: exists[s] || '' }; };
  const eth = { id: 'ethereum', symbol: 'eth', name: 'Ethereum' };
  const assets = [[eth, { src: 'Gate.io', pair: 'ETH/USDT' }, 'crypto'], [{ id: 'xau' }, null, 'metals']];
  const sym = await refresh(assets, {}, { now, lookupFn, log: () => {}, gapMs: 0 });
  assert.deepEqual(asked, ['GATE:ETHUSDT', 'BINANCE:ETHUSDT', 'TVC:GOLD'], 'stops at Binance: no CRYPTO:/COINBASE: lookups');
  assert.deepEqual(sym['GATE:ETHUSDT'], [0, now, '']);
  assert.equal(pick(eth, { src: 'Gate.io', pair: 'ETH/USDT' }, 'crypto', sym), 'BINANCE:ETHUSDT');

  asked.length = 0;
  await refresh(assets, sym, { now: now + DAY, lookupFn, log: () => {}, gapMs: 0 });
  assert.deepEqual(asked, [], 'all fresh: nothing re-checked');
  await refresh(assets, sym, { now: now + 4 * DAY, lookupFn, log: () => {}, gapMs: 0 });
  assert.deepEqual(asked, ['GATE:ETHUSDT'], 'a missing symbol is re-checked after three days');
  asked.length = 0;
  await refresh(assets, sym, { now: now + 15 * DAY, lookupFn, log: () => {}, gapMs: 0 });
  assert.ok(asked.includes('BINANCE:ETHUSDT') && asked.includes('TVC:GOLD'), 'found ones are re-checked after two weeks');

  // TradingView unreachable or rate-limited: keep what we had, stop the run, ask again next time
  asked.length = 0;
  const down = async s => { asked.push(s); return null; };
  const kept = await refresh(assets, { 'TVC:GOLD': [1, now, 'Gold'] }, { now: now + 15 * DAY, lookupFn: down, log: () => {}, gapMs: 0 });
  assert.deepEqual(asked, ['GATE:ETHUSDT'], 'one failure stops the run');
  assert.deepEqual(kept['TVC:GOLD'], [1, now, 'Gold']);
  assert.equal(kept['GATE:ETHUSDT'], undefined, 'not recorded as missing');
});

test('lookup: only TradingView saying "symbol_not_exists" counts as missing', async () => {
  const res = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
  assert.deepEqual(await lookup('X', res(200, { description: 'Gold' })), { found: true, desc: 'Gold' });
  assert.deepEqual(await lookup('X', res(404, { code: 'symbol_not_exists' })), { found: false, desc: '' });
  assert.equal(await lookup('X', res(429, {})), null, 'rate limited');
  assert.equal(await lookup('X', res(500, {})), null);
  assert.equal(await lookup('X', async () => { throw new Error('offline'); }), null);
});

test('assetsOf: metals and currencies (both ways) before the coins', () => {
  const a = assetsOf({ crypto: { markets: [btc], hist: {} }, forex: { markets: [{ id: 'eur' }] }, metals: { markets: [{ id: 'xau' }], hist: {} } });
  assert.deepEqual(a.map(x => `${x[2]}:${x[0].id}${x[3] ? '*' : ''}`), ['metals:xau', 'forex:eur', 'forex:eur*', 'crypto:bitcoin']);
});
