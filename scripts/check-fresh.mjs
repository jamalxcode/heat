// Freshness check for the live site: fails (exit 1) when published data stops updating, even if every job "succeeds".
// Run hourly by .github/workflows/freshness.yml; a failure there sends GitHub's failure email.
//   node scripts/check-fresh.mjs [site URL]      (default https://heat.sala.company)
const SITE = (process.argv[2] || process.env.SITE_URL || 'https://heat.sala.company').replace(/\/$/, '');
const HOUR = 3600e3, DAY = 864e5;

// [file, what to check, limit]. Limits leave room for GitHub's late runs and for weekends / holidays (forex).
export const CHECKS = [
  ['data.json', d => Date.now() - d.generated, HOUR, 'crypto prices last built'],
  ['data.json', d => Date.now() - Math.max(...Object.values(d.hist || {}).map(h => h.t || 0)), 3 * HOUR, 'newest crypto candles fetched'],
  ['forex.json', d => Date.now() - d.generated, HOUR, 'forex file last built'],
  ['forex.json', d => Date.now() - Date.parse(d.rateDate + 'T16:00:00Z'), 4 * DAY + 6 * HOUR, 'latest ECB rate date'],   // Fri rate → Tue, or a holiday
  ['metals.json', d => Date.now() - d.generated, HOUR, 'metals file last built'],
  ['metals.json', d => Date.now() - Date.parse(d.metalsDate + 'T00:00:00Z'), 3 * DAY, 'latest metal price date'],
  ['energy.json', d => Date.now() - d.generated, HOUR, 'energy file last built'],
  ['energy.json', d => Date.now() - (d.sources?.at || 0), 3 * DAY + 6 * HOUR, 'newest energy futures quote'],   // Fri 21:00 UTC → Mon 03:00, or a holiday
  ['scorecard.json', d => Date.now() - d.generated, 30 * HOUR, 'crypto scorecard'],
  ['forex-scorecard.json', d => Date.now() - d.generated, 30 * HOUR, 'forex scorecard'],
];

const ago = ms => ms < 2 * HOUR ? `${Math.round(ms / 60e3)} min` : ms < 2 * DAY ? `${(ms / HOUR).toFixed(1)} h` : `${(ms / DAY).toFixed(1)} days`;

export async function check(site = SITE) {
  const files = {}, problems = [], lines = [];
  for (const [file, age, limit, what] of CHECKS) {
    try {
      files[file] ??= await (await fetch(`${site}/${file}?b=${Date.now()}`, { signal: AbortSignal.timeout(30e3) })).json();
      const a = age(files[file]);
      const ok = Number.isFinite(a) && a <= limit;
      lines.push(`${ok ? 'ok  ' : 'LATE'} ${what}: ${Number.isFinite(a) ? ago(a) + ' ago' : 'missing'} (limit ${ago(limit)})`);
      if (!ok) problems.push(what);
    } catch (e) {
      lines.push(`FAIL ${what}: ${file} could not be read (${e.message})`);
      problems.push(what);
    }
  }
  return { problems, lines };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { problems, lines } = await check();
  console.log(`Freshness of ${SITE}:\n` + lines.join('\n'));
  if (problems.length) { console.log(`::error::Stale data on ${SITE}: ${problems.join(', ')}`); process.exit(1); }
}
