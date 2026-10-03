// Sources health: one line in every page's footer saying which data sources are working, so a source that quietly
// fails (a backup in use, a stale feed) is visible instead of silent. Built at the end of the deploy job from the
// files it just made, so it costs no extra requests.
//   node scripts/health.mjs <out health.json> <data.json> <forex.json> <metals.json> <tv.json>
// state: 'ok' (✓), 'warn' (⚠: working, but on a backup, partly, or a bit old) or 'down' (✕: not working)
const DAY = 864e5, HOUR = 36e5;
const ageDays = (iso, now) => iso ? (now - Date.parse(iso + 'T00:00:00Z')) / DAY : Infinity;

export function health({ crypto, forex, metals, tv }, now = Date.now()) {
  const out = [];
  const add = (key, name, what, state, note) => out.push({ key, name, what, state, note });

  // crypto rankings and prices: CoinGecko first, CoinLore as backup, else the last saved copy
  if (!crypto) add('rankings', 'CoinGecko', 'crypto prices and rankings', 'down', 'no data this update');
  else if (crypto.marketStale) add('rankings', 'CoinGecko', 'crypto prices and rankings', 'down', 'sources busy: showing the last saved copy');
  else if (crypto.marketSrc === 'CoinGecko') add('rankings', 'CoinGecko', 'crypto prices and rankings', 'ok', 'live');
  else add('rankings', 'CoinGecko', 'crypto prices and rankings', 'warn', `backup in use (${crypto.marketSrc})`);

  // daily candles: share of coins whose candles were fetched in the last 8 hours (CoinGecko's are refreshed every 6)
  const hs = Object.values(crypto?.hist || {});
  if (hs.length) {
    const fresh = hs.filter(h => now - h.t < 8 * HOUR).length, share = fresh / hs.length;
    const by = {};
    for (const h of hs) by[h.src] = (by[h.src] || 0) + 1;
    add('candles', 'Exchanges', 'daily candles and volume', share >= 0.9 ? 'ok' : share >= 0.5 ? 'warn' : 'down',
      `${fresh}/${hs.length} fresh · ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  } else add('candles', 'Exchanges', 'daily candles and volume', 'down', 'no candles');

  // ECB: one rate a business day (a Friday rate is still current on Monday morning)
  const ecbAge = ageDays(forex?.rateDate, now);
  add('ecb', 'ECB', 'official currency rates', ecbAge <= 4.5 ? 'ok' : ecbAge <= 7 ? 'warn' : 'down', forex?.rateDate ? `rates of ${forex.rateDate}` : 'no rates');

  // exchange-api: the other currencies and the metals' daily history. Forex carries a missing day forward, so its
  // freshness shows in the metals' copy of the same feed: the date of its latest close
  const xm = metals?.sources?.primary, xAge = ageDays(xm?.latest, now);
  add('xapi', 'exchange-api', 'other currencies, metal history', xAge <= 3.5 ? 'ok' : xAge <= 6 ? 'warn' : 'down',
    xm?.latest ? `latest close ${xm.latest}` : 'no recent data');

  // Swissquote: current metal prices, and whether they agree with exchange-api's closes
  const sq = metals?.sources?.second, agree = metals?.sources?.agree;
  const off = (metals?.markets || []).filter(c => c.check && !c.check.ok).map(c => `${c.name} ${Math.abs(c.check.diff)}%`);
  if (!sq) add('swissquote', 'Swissquote', 'current metal prices, cross-check', 'down', 'no data');
  else add('swissquote', 'Swissquote', 'current metal prices, cross-check',
    !sq.ok ? 'warn' : agree === false ? 'warn' : 'ok',
    `${sq.ok ? 'live' : 'unavailable: daily prices only'}${agree === true ? ' · agrees with exchange-api' : agree === false ? ` · disagrees: ${off.join(', ')}` : ' · cross-check pending'}`);

  // TradingView: the chart links, checked in the deploy job
  const n = Object.values(tv?.sym || {}).filter(e => e[0] === 1).length;
  add('tradingview', 'TradingView', 'chart links', tv && now - tv.t < 2 * DAY ? 'ok' : tv ? 'warn' : 'down', tv ? `${n} symbols confirmed` : 'not checked');

  return { v: 1, t: now, sources: out };
}

/* ---------- CLI (Node only) ---------- */
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
if (IS_NODE && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const [out = 'health.json', ...files] = process.argv.slice(2);
  const read = async f => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };
  const [crypto, forex, metals, tv] = await Promise.all(files.map(read));
  const h = health({ crypto, forex, metals, tv });
  await writeFile(out, JSON.stringify(h));
  console.log('Sources: ' + h.sources.map(s => `${s.name} ${s.state === 'ok' ? '✓' : s.state === 'warn' ? '⚠' : '✕'} (${s.note})`).join(' · '));
}
