// Unit tests for the prediction markets page data (scripts/build-predictions.mjs). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromPolymarket, fromKalshi, fromPredictIt, fromManifold, fromBetfair, catOf, catFrom, headline, updateHist, histChange, interestOf, matchGroups, normName, backfill, build, DAY } from '../scripts/build-predictions.mjs';
import { health } from '../scripts/health.mjs';
import { PAGES } from '../scripts/market-page.mjs';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≈ ${b}`);

test('Polymarket: a who-wins event has one outcome per market, the likeliest is the headline, changes come with it', () => {
  const r = fromPolymarket({
    slug: 'nyc-mayor', title: 'NYC mayor', negRisk: true, volume24hr: 5e6, volume: 9e7, liquidity: 2e6, endDate: '2026-11-04T00:00:00Z',
    tags: [{ label: 'Politics' }],
    markets: [
      { groupItemTitle: 'Alice', outcomes: '["Yes","No"]', outcomePrices: '["0.71","0.29"]', oneDayPriceChange: 0.05, oneWeekPriceChange: -0.02, volume24hr: 3e6 },
      { groupItemTitle: 'Bob', outcomes: '["Yes","No"]', outcomePrices: '["0.27","0.73"]', oneDayPriceChange: -0.04, volume24hr: 2e6 },
      { groupItemTitle: 'Gone', closed: true, outcomes: '["Yes","No"]', outcomePrices: '["0","1"]' },
    ],
  });
  assert.equal(r.id, 'pm:nyc-mayor');
  assert.equal(r.url, 'https://polymarket.com/event/nyc-mayor');
  assert.equal(r.cat, 'Politics');
  assert.equal(r.head, 'Alice');
  assert.deepEqual(r.outcomes.map(o => o.name), ['Alice', 'Bob'], 'closed markets left out, likeliest first');
  near(r.outcomes[0].d1, 0.05); near(r.outcomes[0].d7, -0.02);
  assert.equal(r.outcomes[0].d30, null);
  assert.equal(r.end, '2026-11-04');
});

test('Polymarket: a single market with named outcomes (Team A / Team B) gets both, the second moving the other way', () => {
  const r = fromPolymarket({ slug: 'lakers-celtics', title: 'Lakers vs Celtics', volume24hr: 1e5, tags: [],
    markets: [{ question: 'Lakers vs Celtics', outcomes: '["Lakers","Celtics"]', outcomePrices: '["0.4","0.6"]', oneDayPriceChange: 0.1 }] });
  assert.deepEqual(r.outcomes.map(o => [o.name, o.p]), [['Celtics', 0.6], ['Lakers', 0.4]]);
  assert.equal(r.head, 'Celtics');
  near(r.outcomes.find(o => o.name === 'Lakers').d1, 0.1);
  near(r.outcomes.find(o => o.name === 'Celtics').d1, -0.1);
  assert.equal(r.cat, 'Sports', 'from the words when there are no tags');
});

test('Kalshi: dollar prices are probabilities, the 1-day change is against the previous price, mid when never traded; contracts become dollars', () => {
  const r = fromKalshi({
    event_ticker: 'KXSENATEMS-26', series_ticker: 'KXSENATEMS', title: 'Mississippi Senate winner?', sub_title: 'In 2026', category: 'Elections', mutually_exclusive: true,
    markets: [
      { ticker: 'A', yes_sub_title: 'Colom', last_price_dollars: '0.9200', previous_price_dollars: '0.1400', volume_24h_fp: '1000.00', volume_fp: '5000', open_interest_fp: '300', close_time: '2027-01-04T15:00:00Z', status: 'active' },
      { ticker: 'B', yes_sub_title: 'Hyde-Smith', last_price_dollars: '0', yes_bid_dollars: '0.06', yes_ask_dollars: '0.10', previous_price_dollars: '0', volume_24h_fp: '10', status: 'active' },
    ],
  });
  assert.equal(r.title, 'Mississippi Senate winner?', 'a bare "In 2026" subtitle is dropped');
  assert.equal(r.cat, 'Politics');
  assert.equal(r.head, 'Colom');
  near(r.outcomes[0].d1, 0.78);
  near(r.outcomes[1].p, 0.08, 'never traded: the middle of bid and ask');
  assert.equal(r.outcomes[1].d1, null, 'no previous price: no change');
  assert.equal(r.contracts24, 1010);
  near(r.vol24, 1000 * (0.92 + 0.14) / 2 + 10 * 0.08, 'dollars bet today: contracts × the average of today’s and yesterday’s price');
  near(r.vol, 5000 * 0.92, 'in total: contracts × today’s price');
  near(r.oi, 300 * 0.92);
  assert.equal(r.url, 'https://kalshi.com/markets/kxsenatems');
});

test('Kalshi: a ladder of non-exclusive markets headlines the most traded, not the likeliest', () => {
  const r = fromKalshi({ event_ticker: 'SEATS', title: 'Seats?', mutually_exclusive: false, markets: [
    { yes_sub_title: 'Above 45', last_price_dollars: '0.99', volume_24h_fp: '5' },
    { yes_sub_title: 'Above 50', last_price_dollars: '0.55', volume_24h_fp: '900' },
  ] });
  assert.equal(r.head, 'Above 50');
});

test('PredictIt: contracts are outcomes, lastClosePrice gives the 1-day change, no volume', () => {
  const r = fromPredictIt({ id: 8000, name: 'Who will win the 2028 presidential election?', url: 'https://www.predictit.org/markets/detail/8000',
    contracts: [{ name: 'Vance', shortName: 'Vance', lastTradePrice: 0.31, lastClosePrice: 0.29, status: 'Open' }, { name: 'Newsom', shortName: 'Newsom', lastTradePrice: 0.22, lastClosePrice: 0.25, status: 'Open' }] });
  assert.equal(r.head, 'Vance');
  near(r.outcomes[0].d1, 0.02); near(r.outcomes[1].d1, -0.03);
  assert.equal(r.vol24, null);
  assert.equal(r.cat, 'Politics');
});

test('Manifold: binary has no changes of its own; multiple choice takes each answer\'s probChanges; volume in mana', () => {
  const b = fromManifold({ id: 'x', question: 'Will Bitcoin hit $200k in 2026?', outcomeType: 'BINARY', probability: 0.12, volume24Hours: 5000, url: 'https://manifold.markets/a/b', closeTime: Date.UTC(2026, 11, 31) });
  assert.equal(b.cur, 'MANA');
  assert.equal(b.cat, 'Crypto');
  assert.deepEqual(b.outcomes, [{ name: 'Yes', p: 0.12, d1: null, d7: null, d30: null }]);
  const m = fromManifold({ id: 'y', question: 'Who wins?', outcomeType: 'MULTIPLE_CHOICE', url: 'u' },
    { answers: [{ text: 'A', probability: 0.6, probChanges: { day: 0.1, week: 0.2, month: 0.3 } }, { text: 'B', probability: 0.4, probChanges: { day: -0.1 } }] });
  assert.equal(m.head, 'A');
  near(m.outcomes[0].d30, 0.3);
  assert.equal(fromManifold({ id: 'z', question: 'Poll', outcomeType: 'POLL' }), null, 'polls and other kinds are skipped');
});

test('Betfair: odds become chances (1 / odds), scaled to 100% in a win market; money matched turned into dollars', () => {
  const r = fromBetfair(
    { marketId: '1.23', marketName: 'Next Prime Minister', event: { name: 'UK Politics' }, runners: [{ selectionId: 1, runnerName: 'A' }, { selectionId: 2, runnerName: 'B' }], description: { bettingType: 'ODDS' } },
    { numberOfWinners: 1, totalMatched: 1000, runners: [{ selectionId: 1, status: 'ACTIVE', lastPriceTraded: 1.5 }, { selectionId: 2, status: 'ACTIVE', lastPriceTraded: 2.5 }] }, 1.3);
  const sum = 1 / 1.5 + 1 / 2.5;
  near(r.outcomes.find(o => o.name === 'A').p, Math.round(1 / 1.5 / sum * 1e4) / 1e4);
  near(r.outcomes.reduce((s, o) => s + o.p, 0), 1, 'adds up to 100%');
  assert.equal(r.vol, 1000);
  assert.equal(r.cur, 'GBP', 'pounds here; the build turns them into dollars');
  assert.equal(r.title, 'UK Politics: Next Prime Minister');
  assert.equal(r.cat, 'Politics');
});

test('interest: bet today + a 30th of bet in total, in dollars; play money at M$100 = $1; nothing published = 0', () => {
  assert.equal(interestOf({ vol24: 1e6, vol: 3e7, cur: 'USD' }), 2e6);
  assert.equal(interestOf({ vol24: 0, vol: 9e7, cur: 'USD' }), 3e6, 'a big market on a quiet day still ranks high');
  assert.equal(interestOf({ vol24: 5e5, vol: 3e6, cur: 'MANA' }), 5e3 + 1e3);
  assert.equal(interestOf({ vol24: null, vol: null, cur: 'USD' }), 0);
  assert.equal(interestOf({ usd24: 10, usdTotal: 300 }), 20, 'the build’s dollar figures win when present');
});

test('topics: venue tags first, then the words of the question', () => {
  assert.equal(catFrom(['Economics'], 'anything'), 'Economy');
  assert.equal(catFrom(['nonsense'], 'Will the Fed cut rates in December?'), 'Economy');
  assert.equal(catOf('Will Russia and Ukraine agree a ceasefire?'), 'World');
  assert.equal(catOf('Will OpenAI release GPT-6 this year?'), 'Tech & science');
  assert.equal(catOf('Something unrelated'), 'Other');
  assert.equal(headline([], true), null);
});

test('history: one value per day, a new leader starts afresh, changes look back k days (or up to 2 more)', () => {
  const d0 = 20000, at = d => d * DAY + 12 * 36e5;
  const rec = (p, head = 'Yes') => ({ id: 'a', head, outcomes: [{ name: head, p }] });
  let h = updateHist(null, [rec(0.5)], at(d0));
  h = updateHist(h, [rec(0.6)], at(d0 + 1));
  h = updateHist(h, [rec(0.65)], at(d0 + 1) + 36e5);           // later the same day: replaces today's value
  assert.deepEqual(h.a.p, [0.5, 0.65]);
  near(histChange(h.a, 1, d0 + 1), 0.15);
  assert.equal(histChange(h.a, 7, d0 + 1), null, 'not a week of history yet');
  for (let i = 2; i <= 8; i++) h = updateHist(h, [rec(0.5 + i / 100)], at(d0 + i));
  near(histChange(h.a, 7, d0 + 8), 0.58 - 0.65);
  const fresh = updateHist(h, [rec(0.4, 'Other')], at(d0 + 9));
  assert.deepEqual(fresh.a.p, [0.4], 'a different headline outcome starts a new series');
});

test('build: venues in one file; a failing venue keeps its last markets (stale), Betfair without a key is off', async () => {
  const now = Date.UTC(2026, 10, 4, 12);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  const fetchFn = async url => {
    if (url.includes('gamma-api.polymarket.com')) return json([{ slug: 'p1', title: 'Fed cut in December?', volume24hr: 100, markets: [{ outcomes: '["Yes","No"]', outcomePrices: '["0.3","0.7"]', oneDayPriceChange: 0.01 }] }]);
    if (url.includes('kalshi.com/trade-api/v2/events?')) return json({ events: [{ event_ticker: 'K1', title: 'Blue wave?', markets: [{ last_price_dollars: '0.9', previous_price_dollars: '0.8', volume_24h_fp: '50' }] }], cursor: '' });
    if (url.includes('predictit.org')) return { ok: false, status: 403, json: async () => ({}) };
    if (url.includes('manifold.markets/v0/search-markets')) return json([{ id: 'm1', question: 'Will it snow?', outcomeType: 'BINARY', probability: 0.2, volume24Hours: 300, url: 'u' }]);
    throw new Error('unexpected ' + url);
  };
  const prev = { v: 1, venues: { predictit: { state: 'ok', at: now - 3600e3 } }, markets: [{ id: 'pi:1', venue: 'predictit', title: 'Old', head: 'Yes', outcomes: [{ name: 'Yes', p: 0.4 }], cur: 'USD' }], hist: {} };
  const d = await build({ prev, now, fetchFn, log: () => {} });
  assert.equal(d.market, 'predictions');
  assert.deepEqual(Object.fromEntries(Object.entries(d.venues).map(([k, v]) => [k, v.state])), { polymarket: 'ok', kalshi: 'ok', predictit: 'stale', manifold: 'ok', betfair: 'off' });
  assert.ok(d.markets.find(m => m.id === 'pi:1').stale);
  assert.equal(d.markets.find(m => m.id === 'mf:m1').usd24, 3, 'mana at M$100 = $1');
  assert.deepEqual(d.markets.map(m => m.rank), d.markets.map((_, i) => i + 1), 'ranked by interest, #1 first');
  assert.ok(d.markets.every((m, i) => !i || d.markets[i - 1].interest >= m.interest));
  assert.equal(d.markets.at(-1).id, 'pi:1', 'no money figures: last');
  assert.deepEqual(d.kalshi.tickers, ['K1'], 'the scan remembers the top events for the next 10-minute refresh');
  assert.ok(d.hist['ks:K1'] && d.hist['mf:m1']);
});

test('health: one line for the prediction markets; Betfair not set up doesn\'t count as down', () => {
  const now = Date.UTC(2026, 10, 4, 12);
  const row = p => health({ predictions: p }, now).sources.find(s => s.key === 'predictions');
  const v = (s, n = 10) => ({ state: s, n });
  assert.equal(row({ generated: now, venues: { polymarket: v('ok'), kalshi: v('ok'), betfair: v('off', 0) } }).state, 'ok');
  assert.equal(row({ generated: now, venues: { polymarket: v('ok'), kalshi: v('stale') } }).state, 'warn');
  assert.equal(row({ generated: now, venues: { polymarket: v('down', 0), kalshi: v('down', 0) } }).state, 'down');
  assert.equal(row(null).state, 'down');
  assert.equal(health({}, now).sources.find(s => s.key === 'predictions'), undefined, 'not asked: no row');
  assert.ok(PAGES.includes('predictions'));
});

test('Polymarket: "Build your map" bundles are left out; an event with one option left open keeps its name', () => {
  assert.equal(fromPolymarket({ slug: 'b', title: 'Which swing states will Republicans win? (Build Your Map)', markets: [{ outcomes: '["Yes","No"]', outcomePrices: '["0.5","0.5"]' }] }), null);
  const r = fromPolymarket({ slug: 'f1', title: 'F1 Drivers’ Champion', markets: [
    { groupItemTitle: 'Max', closed: true, outcomes: '["Yes","No"]', outcomePrices: '["0","1"]' },
    { groupItemTitle: 'Lando', outcomes: '["Yes","No"]', outcomePrices: '["0.996","0.004"]', bestBid: 0.99, bestAsk: 0.999, clobTokenIds: '["t1","t2"]' },
  ] });
  assert.equal(r.head, 'Lando');
  near(r.outcomes[0].sp, 0.009);
  assert.deepEqual(r.src, { tok: 't1' }, 'where its price history lives');
});

test('Kalshi: the chance is the middle of bid and ask (not a stray last trade); the spread and ticker are kept', () => {
  const r = fromKalshi({ event_ticker: 'E', series_ticker: 'S', title: 'Q?', markets: [
    { ticker: 'E-A', last_price_dollars: '0.30', yes_bid_dollars: '0.50', yes_ask_dollars: '0.54', previous_yes_bid_dollars: '0.40', previous_yes_ask_dollars: '0.44' },
  ] });
  near(r.outcomes[0].p, 0.52);
  near(r.outcomes[0].d1, 0.10);
  near(r.outcomes[0].sp, 0.04);
  assert.deepEqual(r.src, { tk: 'E-A', series: 'S' });
});

test('names: surnames match across the venues’ styles', () => {
  assert.deepEqual(['Scott Colom (D)', 'Dems (Colom)', 'J.D. Vance', 'Vance', 'GOP (Hyde-Smith)', 'Cindy Hyde-Smith'].map(normName), ['colom', 'colom', 'vance', 'vance', 'smith', 'smith']);
});

test('matching: the same question on several venues is one group; different parties or places never match', () => {
  const rec = (id, venue, title, outcomes, interest) => ({ id, venue, title, interest, outcomes: outcomes.map(([name, p]) => ({ name, p })) });
  const ms = [
    rec('pm:dem', 'polymarket', 'Democratic Presidential Nominee 2028', [['Gavin Newsom', 0.3], ['Jon Ossoff', 0.2], ['AOC', 0.1]], 900),
    rec('ks:dem', 'kalshi', '2028 Democratic presidential nominee', [['Newsom', 0.31], ['Ossoff', 0.21], ['Shapiro', 0.05]], 500),
    rec('pi:dem', 'predictit', 'Who will win the 2028 Democratic presidential nomination?', [['Newsom', 0.29], ['Ossoff', 0.2]], 0),
    rec('pm:rep', 'polymarket', 'Republican Presidential Nominee 2028', [['J.D. Vance', 0.5], ['Marco Rubio', 0.2]], 800),
    rec('ks:rep', 'kalshi', '2028 Republican presidential nominee', [['Vance', 0.52], ['Rubio', 0.19]], 400),
    rec('mf:ak', 'manifold', 'Which party will win the 2026 Alaska Senate race?', [['Democrats', 0.6], ['Republicans', 0.4]], 10),
    rec('pi:me', 'predictit', 'Which party will win the 2026 US Senate election in Maine?', [['Democrats', 0.7], ['Republicans', 0.3]], 0),
    rec('pi:us', 'predictit', 'Which party will win the 2026 US Senate?', [['Democrats', 0.5], ['Republicans', 0.5]], 0),
    rec('pm:yes', 'polymarket', 'Fed rate cut in December 2026?', [['Yes', 0.3]], 50),
    rec('ks:yes', 'kalshi', 'Fed rate cut in December 2026?', [['Yes', 0.32]], 40),
  ];
  assert.equal(matchGroups(ms), 3);
  const g = id => ms.find(m => m.id === id).group;
  assert.equal(g('ks:dem'), 'pm:dem'); assert.equal(g('pi:dem'), 'pm:dem');
  assert.equal(g('ks:rep'), 'pm:rep', 'Republican nominees together, not with the Democratic ones');
  assert.equal(g('ks:yes'), 'pm:yes');
  assert.equal(g('mf:ak'), undefined, 'Alaska ≠ Maine ≠ the whole Senate');
  assert.equal(g('pi:me'), undefined); assert.equal(g('pi:us'), undefined);
});

test('backfill: missing days filled from Kalshi daily candles (mid of bid and ask), today left as the live price', async () => {
  const now = Date.UTC(2026, 10, 4, 12), today = Math.floor(now / DAY);
  const hist = { 'ks:E': { o: 'Yes', d: today, p: [0.6] } };
  const end = d => (d + 1) * DAY / 1000;   // a candle is stamped at the end of its day
  const fetchFn = async url => ({ ok: true, status: 200, json: async () => ({ candlesticks: [
    { end_period_ts: end(today - 8), yes_bid: { close_dollars: '0.30' }, yes_ask: { close_dollars: '0.34' } },
    { end_period_ts: end(today - 1), price: { close_dollars: '0.55' } },
    { end_period_ts: end(today), price: { close_dollars: '0.99' } },
  ] }) });
  await backfill({ fetchFn, markets: [{ id: 'ks:E', venue: 'kalshi', src: { tk: 'E-A', series: 'S' } }], hist, now });
  assert.equal(hist['ks:E'].d, today - 8);
  near(hist['ks:E'].p[0], 0.32);
  near(hist['ks:E'].p.at(-2), 0.55);
  near(hist['ks:E'].p.at(-1), 0.6, 'today stays the live price');
  near(histChange(hist['ks:E'], 7, today), 0.6 - 0.32);
  assert.ok(hist['ks:E'].bf, 'asked at most once a day');
});

test('backfill: Polymarket price history, trying its other request forms when one comes back empty', async () => {
  const now = Date.UTC(2026, 10, 4, 12), today = Math.floor(now / DAY);
  const hist = { 'pm:x': { o: 'Yes', d: today, p: [0.5] } };
  const asked = [];
  const fetchFn = async url => {
    asked.push(url);
    const history = url.includes('interval=max') ? [{ t: (today - 3) * DAY / 1000 + 3600, p: 0.4 }, { t: (today - 3) * DAY / 1000 + 7200, p: 0.42 }] : [];
    return { ok: true, status: 200, json: async () => ({ history }) };
  };
  await backfill({ fetchFn, markets: [{ id: 'pm:x', venue: 'polymarket', src: { tok: '123' } }], hist, now });
  assert.ok(asked[0].includes('interval=1m') && asked[1].includes('interval=max'), 'the first form was empty, so the next was tried');
  assert.equal(hist['pm:x'].d, today - 3);
  near(hist['pm:x'].p[0], 0.42, 'the day’s last point');
});
