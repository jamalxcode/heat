// Sources health: one line in every page's footer saying which data sources are working, so a source that quietly
// fails (a backup in use, a stale feed) is visible instead of silent. Built at the end of the deploy job from the
// files it just made, so it costs no extra requests.
//   node scripts/health.mjs <out health.json> <data.json> <forex.json> <metals.json> <tv.json> [energy.json] [rates.json]
// state: 'ok' (✓), 'warn' (⚠: working, but on a backup, partly, or a bit old) or 'down' (✕: not working)
const DAY = 864e5, HOUR = 36e5;
const ageDays = (iso, now) => iso ? (now - Date.parse(iso + 'T00:00:00Z')) / DAY : Infinity;

// US energy futures trade Sunday 18:00 to Friday 17:00 New York time (one hour later in UTC in winter); a rough
// UTC window, wide enough for both: closed from Friday 21:00 to Sunday 23:00. Holidays aren't known here.
export function futuresOpen(now) {
  const d = new Date(now), wd = d.getUTCDay(), h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return !(wd === 6 || (wd === 5 && h >= 21) || (wd === 0 && h < 23));
}

export function health({ crypto, forex, metals, energy, rates, tv }, now = Date.now()) {
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

  // Yahoo Finance: the energy futures. Judged by the newest quote's age while the markets trade; over the weekend
  // (Friday ~21:00 to Sunday ~22:00 UTC) a Friday quote is the latest there is
  if (energy !== undefined) {
    const src = energy?.sources, age = src?.at ? now - src.at : Infinity;
    const open = futuresOpen(now), all = src && src.got === src.of;
    add('yahoo', 'Yahoo Finance', 'energy futures prices',
      !src ? 'down' : open ? (age <= 90 * 60e3 && all ? 'ok' : age <= DAY ? 'warn' : 'down') : (age <= 3.5 * DAY ? (all ? 'ok' : 'warn') : 'down'),
      !src ? 'no data' : `${src.got}/${src.of} contracts · newest quote ${Number.isFinite(age) ? (age < 2 * HOUR ? `${Math.round(age / 60e3)} min` : `${(age / HOUR).toFixed(0)} h`) + ' old' : 'missing'}${open ? '' : ' · markets closed'}`);
  }

  // Bond yields: the official curves (US Treasury, ECB, Bank of England, MOF Japan, Bank of Canada, Bank Al-Maghrib).
  // Each publishes once a business day, some a few days late: a curve over a week old, or not refreshed, is a warning
  if (rates !== undefined) {
    const cs = rates?.countries || [], old = cs.filter(c => c.notRefreshed || ageDays(c.date, now) > 7);
    const oldest = cs.reduce((a, c) => !a || c.date < a.date ? c : a, null);
    // the ECB's monthly European figures: month M's average comes out early in M+1, so a month 75+ days old is late
    const ms = rates?.monthly || [], mLate = ms.length && (ms.some(m => m.notRefreshed) || ageDays(ms[0].month + '-01', now) > 75);
    const state = !cs.length ? 'down' : old.length ? (old.length < cs.length ? 'warn' : 'down') : mLate ? 'warn' : 'ok';
    add('yields', 'Bond yields', 'official yield curves', state,
      !cs.length ? 'no data' : `${cs.length - old.length}/${cs.length} markets current${oldest ? ` · oldest ${oldest.badge} ${oldest.date}` : ''}${old.length ? ` · late: ${old.map(c => c.badge).join(', ')}` : ''}`
      + (ms.length ? ` · Europe monthly to ${ms[0].month}${mLate ? ' (late)' : ''}` : ''));
  }

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
  const [crypto, forex, metals, tv, energy = null, rates = null] = await Promise.all(files.map(read));
  const h = health({ crypto, forex, metals, energy, rates, tv });
  await writeFile(out, JSON.stringify(h));
  console.log('Sources: ' + h.sources.map(s => `${s.name} ${s.state === 'ok' ? '✓' : s.state === 'warn' ? '⚠' : '✕'} (${s.note})`).join(' · '));
}
