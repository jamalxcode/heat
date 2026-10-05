// heat.sala.company: one adapter per market. The same page serves every market (/ is crypto, /forex/ is forex: a copy
// of index.html with its own search tags, made at deploy by scripts/market-page.mjs; /metals/ likewise), and EVERYTHING market-specific
// lives here: data files, color ranges, timeframe names, number formats, wording, which columns and switches exist.
// Tiles, popups, filters, the scorecard and the signal engine are shared and ask `M.…`, so a change to them shows on
// every market. A new market (stocks, commodities) is mostly a new entry here plus its data script.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkCG = '<a class="cg-attr" href="https://www.coingecko.com/" target="_blank" rel="noopener">Powered by CoinGecko</a>';   // required for the free CoinGecko API key
const linkECB = '<a class="cg-attr" href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html" target="_blank" rel="noopener">Source: ECB</a>';

export const MARKETS = {
  crypto: {
    key: 'crypto', data: '/data.json', scorecard: '/scorecard.json', top: 100, noun: 'coins', one: 'coin', nameCol: 'Coin',
    live: true,                       // a live price between daily candles; today's candle is still forming
    liveBuild: true,                  // if data.json goes stale, the page builds it itself (scripts/build-data.mjs)
    ranked: true,                     // tiles show the market-cap rank (#1, #2 …) and the table has a market-cap column
    quoteSwitch: false,               // no USD/… | …/USD switch
    pegPref: 'pegged',                // localStorage key for "show stablecoins"
    bins: { '24h': [1, 3, 6, 10], '7d': [2.5, 7, 15, 25], '30d': [5, 15, 30, 50] },
    // relative strength: measured against this asset (or, without one, an equal-weight basket of every pair); volume: shown when the data has it
    bench: 'bitcoin', benchLabel: 'BTC', volume: true,
    back: { '24h': 1, '7d': 7, '30d': 30 },          // candles back for each change (one candle per day)
    label: { '24h': '24h', '7d': '7d', '30d': '30d' },
    pegLabel: 'Stablecoins', pegTitle: 'Include stablecoins, tokenized gold and wrapped/staked copies',
    pegWords: 'stablecoins, pegged and fund tokens', closeWord: 'daily close (00:00 UTC)', closeShort: 'close', stopWhere: 'your exchange',
    stopDecimals: 1, days: n => `${n} days`, tableCaption: n => `Top ${n} coins`, noHistory: 'No daily history found on Binance, Gate.io, OKX or CoinGecko.',
    price(p) {
      if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
      if (p >= 1) return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (p >= 0.01) return '$' + p.toFixed(4);
      return '$' + Number(p.toPrecision(3)).toString();
    },
    // ✓ = price history from an exchange pair confirmed by the coin's CoinGecko ID; ? = matched by ticker only
    verify: (c, h) => h.ok
      ? `<span class="vf ok" title="Price history: ${esc(h.src)} ${esc(h.pair)}, verified by CoinGecko ID" aria-label="verified">✓</span>`
      : `<span class="vf guess" title="Price history: ${esc(h.src)} ${esc(h.pair)}, matched by ticker only (not verified)" aria-label="not verified">?</span>`,
    sourceLine: (c, h, ind) => `${h.src} ${h.pair} · ${h.ok ? '✓ verified by CoinGecko ID' : '⚠ matched by ticker only (not verified)'} · ${ind.n} daily candles`,
    srcInfo: ({ marketSrc, stale, parts, ok, total }) => `Prices & rankings: ${marketSrc || '—'}${stale ? ' (saved copy, sources busy)' : ''}.`
      + (parts.length ? ` Daily candles: ${parts.join(' · ')}.` : '')
      + (total ? ` ✓ ${ok} of ${total} coins matched to their exchange pair by CoinGecko ID; ? marks a ticker-only match.` : ''),
    excludedName: c => `${c.symbol.toUpperCase()} (#${c.market_cap_rank})`,
    costWords: 'about 0.1% each way on a large exchange', tuneHistory: 'about 2.7 years of history',
    basketNote: `, and the coins are today's top 100, several of which made the list <i>because</i> they rose, so all three lines look better than reality`,
    fresh: ({ tm, ago, next, late, refreshMin }) => `<span>🕒 <b>Last refreshed ${tm}</b> (${ago}) · ${next} · <b>not real-time</b>, every ${refreshMin} min`
      + (late ? ' · <b>⚠ this update is running late: showing the last good data</b>' : '') + '</span>' + linkCG,
  },
  forex: {
    key: 'forex', data: '/forex.json', scorecard: '/forex-scorecard.json', top: 999, noun: 'currencies', one: 'currency', nameCol: 'Currency',
    live: false,                      // one official rate per business day: nothing forms in between
    ranked: false, quoteSwitch: true, pegPref: 'peggedFx',
    bins: { '24h': [0.1, 0.3, 0.6, 1], '7d': [0.25, 0.75, 1.5, 3], '30d': [0.5, 1.5, 3, 6] },
    bench: null, benchLabel: 'basket', volume: false,   // vs the average of every pair shown; forex has no central volume
    back: { '24h': 1, '7d': 5, '30d': 21 },          // business days: 5 ≈ a week, 21 ≈ a month
    label: { '24h': '1d', '7d': '1w', '30d': '1m' },
    pegLabel: 'Pegged', pegTitle: 'Include currencies pegged to the US dollar (Gulf currencies, HKD, JOD, IQD, LBP)',
    pegWords: 'currencies pegged to the dollar', closeWord: 'ECB rate', closeShort: 'rate', stopWhere: 'your broker',
    stopDecimals: 2, days: n => `${n} business days`, tableCaption: () => 'Currencies against the US dollar', noHistory: 'No rate history available for this currency.',
    // exchange rates: no $, decimals as quoted (0.88067 · 157.00 · 1,355); tiny rates (JPY/USD 0.006369,
    // IRR/USD 0.0000005904) keep 4 significant digits
    price(p) {
      const d = p >= 1000 ? 0 : p >= 100 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.1 ? 5 : Math.min(12, 3 - Math.floor(Math.log10(p)));
      return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    // ✓ = official ECB reference rate; ? = the community exchange-api feed
    verify: (c, h) => h.ok
      ? '<span class="vf ok" title="Official ECB reference rate" aria-label="official ECB rate">✓</span>'
      : `<span class="vf guess" title="Rate from the community exchange-api feed (public domain, sources not documented)${c.warn ? '. Official and market rates differ a lot for this currency' : ''}" aria-label="community feed, not official">?</span>`,
    sourceLine: (c, h, ind) => `${h.ok ? '✓ Official ECB reference rate' : '? Community exchange-api feed (public domain)'} · ${ind.n} business days`,
    srcInfo: ({ stale, parts }) => `Rates: ${parts.join(' · ') || '—'}${stale ? ' (saved copy, sources busy)' : ''}. ✓ marks an official ECB reference rate; ? marks the community feed.`,
    excludedName: c => c.symbol,
    costWords: 'the bid-ask spread on major pairs; wider on smaller currencies', tuneHistory: 'ECB rates since 2010 and the other currencies since March 2024',
    basketNote: ', and every rate is quoted against the US dollar, so the "all currencies" line mostly reflects the dollar’s own move',
    // the rate date is what matters: one official rate per business day
    fresh: ({ rateDate, ago, late }) => {
      const rd = rateDate ? new Date(rateDate + 'T12:00:00Z').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
      return `<span>🕒 <b>Rates of ${rd}</b> · <b>not real-time</b>: one rate per business day, published about 16:00 Frankfurt time · checked ${ago}`
        + (late ? ' · <b>⚠ updates are running late</b>' : '') + '</span>' + linkECB;
    },
  },
};
// Metals: precious metals per troy ounce from the public-domain feed, plus PAXG, XAUT and Bitcoin from the crypto data
MARKETS.metals = {
  ...MARKETS.crypto,
  key: 'metals', data: '/metals.json', scorecard: null, top: 999, noun: 'assets', one: 'asset', nameCol: 'Asset',
  live: true,                         // the crypto tiles move all day; the metals file has one value per day (today's is still forming)
  liveBuild: false,                   // the in-browser rebuild makes crypto data: here an older metals.json is shown instead
  ranked: false, quoteSwitch: false, pegPref: null, pegLabel: null,
  bins: { '24h': [0.25, 0.75, 1.5, 3], '7d': [1, 2.5, 5, 8], '30d': [2, 5, 10, 15] },
  bench: 'xau', benchLabel: 'gold', volume: false,     // the metal prices come without volume
  noScorecard: 'There’s no scorecard here: with only a handful of assets there’s nothing to rank each day, so the 🚀/😢 can’t be tested the way they are on the crypto and forex pages. The tiles, charts and stops work as everywhere else.',
  // ✓ once Swissquote's price matched exchange-api's close for the same day (scripts/build-metals.mjs crossCheck)
  verify: (c, h) => c.src === 'crypto' ? MARKETS.crypto.verify(c, h)
    : c.check?.ok ? `<span class="vf ok" title="Confirmed by a second source: Swissquote's price matched the exchange-api close within ${Math.abs(c.check.diff)}% on ${c.check.day}" aria-label="confirmed by two sources">✓</span>`
    : `<span class="vf guess" title="${c.check ? `The two price sources disagree by ${Math.abs(c.check.diff)}% (${c.check.day}): check another source` : 'Not cross-checked yet: price from the community exchange-api feed (public domain, sources not documented)'}" aria-label="not confirmed">?</span>`,
  sourceLine: (c, h, ind) => c.src === 'crypto' ? MARKETS.crypto.sourceLine(c, h, ind)
    : `${c.check?.ok ? `✓ exchange-api and Swissquote agree within ${Math.abs(c.check.diff)}% (${c.check.day})` : c.check ? `⚠ exchange-api and Swissquote differ by ${Math.abs(c.check.diff)}% (${c.check.day})` : '? exchange-api history, not cross-checked yet'} · US dollars per troy ounce · ${ind.n} daily closes`,
  srcInfo: ({ marketSrc, stale }) => `Metals: daily history from the exchange-api feed (public domain), current prices from Swissquote's public quotes, which also cross-check each day's close; US dollars per troy ounce. Tokenized gold and Bitcoin: the crypto page's data (${marketSrc.split(' + ').pop()})${stale ? ', saved copy' : ''}.`,
  costWords: '', tuneHistory: '',
  fresh: ({ tm, ago, next, late, refreshMin, latestDate }) => `<span>🕒 <b>Last refreshed ${tm}</b> (${ago}) · ${next} · <b>not real-time</b>: every ${refreshMin} min while markets are open${latestDate ? ` (latest ${latestDate})` : ''}`
    + (late ? ' · <b>⚠ this update is running late</b>' : '') + '</span>' + linkCG,
};

// Energy: crude oil, refined products and natural gas, front-month futures from Yahoo Finance (scripts/build-energy.mjs).
// Futures trade on weekdays only, so the changes count trading days, like forex.
const linkYahoo = '<a class="cg-attr" href="https://finance.yahoo.com/markets/commodities/" target="_blank" rel="noopener">Source: Yahoo Finance</a>';
MARKETS.energy = {
  ...MARKETS.metals,
  key: 'energy', data: '/energy.json',
  bins: { '24h': [0.5, 1.5, 3, 5], '7d': [1.5, 4, 8, 12], '30d': [3, 8, 15, 25] },
  tradingDays: true,                  // the live price never starts a new day by itself (no weekend candles)
  bench: 'brent', benchLabel: 'Brent', volume: false,  // front-month volume jumps at every contract roll, so it isn't used
  back: { '24h': 1, '7d': 5, '30d': 21 },
  label: { '24h': '1d', '7d': '1w', '30d': '1m' },
  closeWord: 'daily close', stopWhere: 'your broker', days: n => `${n} trading days`,
  noHistory: 'No price history from Yahoo Finance for this contract right now.',
  // prices as quoted, without a currency sign: the units differ (dollars per barrel, per gallon, per MMBtu; TTF in euros per MWh)
  price(p) {
    const d = p >= 10 ? 2 : 3;
    return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  verify: c => c.notRefreshed ? `<span class="vf guess" title="Yahoo Finance didn't answer for this contract in the latest update: showing its last known price" aria-label="not refreshed">?</span>` : '',
  sourceLine: (c, h, ind) => `${c.notRefreshed ? '⚠ not refreshed in the latest update · ' : ''}Front-month futures ${esc(h.pair)} on Yahoo Finance · ${esc(c.where || '')} · ${esc(c.unit || '')} · ${ind.n} trading days`,
  srcInfo: () => 'Energy: front-month futures prices from Yahoo Finance (unofficial, no key), delayed about 10 minutes by the exchanges, so up to about 20–30 minutes old here. Oil and products per barrel or gallon and US gas per MMBtu, in US dollars; European gas (TTF) in euros per MWh.',
  fresh: ({ tm, ago, next, late, refreshMin, latestDate }) => `<span>🕒 <b>Last refreshed ${tm}</b> (${ago}) · ${next} · <b>not real-time</b>: every ${refreshMin} min, futures prices delayed ~10 min, weekdays only${latestDate ? ` (latest ${latestDate})` : ''}`
    + (late ? ' · <b>⚠ this update is running late</b>' : '') + '</span>' + linkYahoo,
};

export const MARKET = ['forex', 'metals', 'energy'].find(m => location.pathname.startsWith('/' + m)) || 'crypto';
export const M = MARKETS[MARKET];
export const TF = tf => M.label[tf];                       // what a timeframe is called on this market (24h / 1d …)
