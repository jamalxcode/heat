// heat.sala.company page script: scorecard (split from index.html; see app/main.mjs for the order things start in)
import * as SIG from '/signals.mjs';
import { call, legendName, roleOf, signals } from './render.mjs';
import { P } from './data.mjs';
import { $, esc, fmtPct, heatClass, M, S } from './core.mjs';

/* ================= scorecard (daily check of the 🚀 / 😢, built by scripts/score.mjs) ================= */
export async function loadScorecard() {
  if (!M.scorecard) { S.scorecard = null; return; }   // metals: no scorecard
  try {
    const r = await fetch(`${M.scorecard}?b=${Math.floor(Date.now() / 600e3)}`, { cache: 'no-store' });
    S.scorecard = r.ok ? await r.json() : null;
  } catch { S.scorecard = null; }
}
export const pc = (v, d = 1) => v == null ? '—' : (v * 100).toFixed(d) + '%';
export const spc = (v, d = 2) => fmtPct(v == null ? null : v * 100, d);
export const emo = s => s > 0 ? '🚀'.repeat(s) : s < 0 ? '😢'.repeat(-s) : 'none';
export const edgeWord = (t, n) => t == null || !n ? '—' : n < 20 ? 'too few to tell' : Math.abs(t) >= 2 ? 'consistent' : Math.abs(t) >= 1 ? 'weak hint' : 'looks like noise';
export const icVerdict = ic => ic?.mean == null ? 'not enough data yet'
  : ic.t >= 2 ? 'a real edge: more 🚀 did mean better next days'
  : ic.t <= -2 ? 'backwards: more 🚀 meant worse next days'
  : 'no reliable edge yet, about as good as a coin flip';

export const H_WORD = { 1: 'the next day', 3: 'the next 3 days', 7: 'the next 7 days' };
// v1 scorecards had one horizon per window; v2 has { 1: stats, 3: stats, 7: stats }
export const byH = W => W && W.byScore ? { 1: W } : (W || {});

// 60-day chart: what you'd have made holding each day's 🚀 coins (or 😢 coins, or all coins) for one day, compounded
export function basketChart(daily) {
  if (!daily?.length) return '';
  let r = 1, s = 1, m = 1;
  const pts = daily.map(d => {
    r *= 1 + (d.rockets ?? 0); s *= 1 + (d.sad ?? 0); m *= 1 + (d.mkt ?? 0);
    return { ...d, R: r - 1, S: s - 1, M: m - 1 };
  });
  const W = 720, H = 230, L = 46, Rp = 14, T = 12, B = 26;
  const vals = pts.flatMap(p => [p.R, p.S, p.M, 0]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 0.01; lo -= pad; hi += pad;
  const x = i => L + (pts.length === 1 ? 0 : i / (pts.length - 1)) * (W - L - Rp);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const path = k => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join('');
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];
  const xl = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
  S.chartPts = pts; S.chartGeom = { W, L, Rp, x };
  const end = pts[pts.length - 1];
  return `
    <div class="sc-legend">
      <span><i style="background:#0077be"></i>🚀 ${M.noun} <b>${spc(end.R, 1)}</b></span>
      <span><i style="background:#b8413f"></i>😢 ${M.noun} <b>${spc(end.S, 1)}</b></span>
      <span><i style="background:var(--muted)"></i>All ${M.noun} <b>${spc(end.M, 1)}</b></span>
    </div>
    <div class="sc-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Last ${pts.length} days: 🚀 ${M.noun} ${spc(end.R, 1)}, 😢 ${M.noun} ${spc(end.S, 1)}, all ${M.noun} ${spc(end.M, 1)}">
        ${ticks.map(v => `<line x1="${L}" x2="${W - Rp}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="11" fill="var(--muted)">${spc(v, 0)}</text>`).join('')}
        <line x1="${L}" x2="${W - Rp}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>
        ${xl.map(i => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" font-size="11" fill="var(--muted)">${pts[i].day.slice(5)}</text>`).join('')}
        <path d="${path('M')}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="${path('S')}" fill="none" stroke="#b8413f" stroke-width="2" stroke-linejoin="round"/>
        <path d="${path('R')}" fill="none" stroke="#0077be" stroke-width="2" stroke-linejoin="round"/>
        <line class="sc-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--ink-2)" stroke-width="1" visibility="hidden"/>
        <rect class="sc-hit" x="${L}" y="${T}" width="${W - L - Rp}" height="${H - T - B}" fill="transparent"/>
      </svg>
      <div class="sc-tip" hidden></div>
    </div>
    <p class="sc-muted">Each day: the average next-day move of that day's 🚀 ${M.noun}, 😢 ${M.noun} and all ${M.noun}, compounded over the last ${pts.length} days. It's a scorekeeping line, not a trading result: there are no fees or slippage${M.basketNote}. Compare the lines with each other, not with zero.</p>`;
}
export function wireChart() {
  const box = $('#scorewrap .sc-chart');
  if (!box || !S.chartPts) return;
  const svg = box.querySelector('svg'), cross = box.querySelector('.sc-cross'), tip = box.querySelector('.sc-tip');
  const { W, L, Rp, x } = S.chartGeom, pts = S.chartPts;
  const at = e => {
    const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * W;
    return Math.max(0, Math.min(pts.length - 1, Math.round((vx - L) / (W - L - Rp) * (pts.length - 1))));
  };
  const show = e => {
    const i = at(e), p = pts[i], r = svg.getBoundingClientRect();
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${p.day}</b><br>🚀 ${p.nR} ${M.noun}: ${spc(p.rockets)} · total ${spc(p.R, 1)}<br>😢 ${p.nS} ${M.noun}: ${spc(p.sad)} · total ${spc(p.S, 1)}<br>All ${M.noun}: ${spc(p.mkt)} · total ${spc(p.M, 1)}`;
    tip.hidden = false;
    const px = x(i) / W * r.width;
    tip.style.left = Math.min(Math.max(0, px - tip.offsetWidth / 2), r.width - tip.offsetWidth) + 'px';
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

// Recommended stops: how often they were crossed, and whether getting out was the right call
export function stopsHTML(stp, h, hw) {
  if (!stp?.n) return '';
  const side = (s, name, dir) => !s.hits ? `<b>${name}</b>: never crossed.`
    : `<b>${name}</b>: crossed within ${hw} ${pc(s.hitRate)} of the time. After getting out, price kept ${dir} for ${hw} (a good exit) <b>${pc(s.goodRate)}</b> of the time, and came back (you'd have been shaken out) ${s.goodRate == null ? '—' : pc(1 - s.goodRate)}.`
      + (s.avgSaved != null ? ` On average the exit ${s.avgSaved >= 0 ? 'saved' : 'cost'} <b>${pc(Math.abs(s.avgSaved), 2)}</b>.` : '');
  return `<div class="sc-stops"><p><b>🛑 Recommended stops, judged over ${hw}</b> <span class="sc-muted">(average distance ${pc(stp.avgDist)} from the close, crossed on a daily close)</span></p>
    <ul><li>${side(stp.long, 'Long stops', 'falling')}</li><li>${side(stp.short, 'Short stops', 'rising')}</li></ul></div>`;
}

export function renderScorecard() {
  const box = $('#scorewrap'), sc = S.scorecard;
  if (!sc) {
    box.innerHTML = `<div class="sc-card"><h2>Scorecard</h2><p class="sc-muted">The first scorecard appears after the daily scoring job runs (00:20 UTC). It checks every 🚀 and 😢 against what the ${M.one} actually did afterwards.</p></div>`;
    return;
  }
  const y = sc.yesterday, ys = y.stats;
  const Hs = sc.horizons || [1];
  if (!Hs.includes(S.scoreH)) S.scoreH = 1;
  const h = S.scoreH, hw = H_WORD[h];
  const w = byH(sc.windows[S.scoreWin] || sc.windows.d30)[h];
  const winName = { d30: 'last 30 days', d90: 'last 90 days', all: 'all history' }[S.scoreWin];
  const moved = y.coins.filter(c => c.score !== 0);
  const tile = (title, big, lines) => `<div class="sc-tile"><div class="sc-t">${title}</div><div class="sc-big">${big}</div>${lines.map(l => `<div class="sc-l">${l}</div>`).join('')}</div>`;
  const segBtns = (id, attr, cur, opts) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-${attr}="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;

  const scoreRows = [3, 2, 1, 0, -1, -2, -3].map(s => {
    const b = w.byScore[s];
    if (!b || !b.n) return '';
    const exc = b.avgExc ?? 0, width = Math.min(50, Math.abs(exc) * 100 * 25 / Math.sqrt(h));
    return `<tr><td class="sc-emo">${emo(s)}</td><td>${b.n.toLocaleString()}</td><td>${pc(b.upRate)}</td><td>${spc(b.avgRet)}</td>
      <td><span class="sc-bar"><i class="${exc >= 0 ? 'pos' : 'neg'}" style="${exc >= 0 ? 'left:50%' : 'right:50%'};width:${width}%"></i></span> ${spc(b.avgExc)}</td></tr>`;
  }).join('');

  const compRows = Object.keys(SIG.COMPONENTS).map(k => {
    const c = w.components[k] || {}, testing = SIG.TESTING.includes(k), role = testing ? '🧪 testing' : roleOf(k);
    const wrong = c.n >= 20 && Math.abs(c.t) >= 1 && ((role === '🚀' && c.avgExc < 0) || (role === '😢' && c.avgExc > 0));
    return `<tr><td>${esc(legendName(k))}</td><td class="sc-emo">${role}</td><td>${(c.n || 0).toLocaleString()}</td><td>${pc(c.upRate)}</td>
      <td>${spc(c.avgExc)}</td><td>${edgeWord(c.t, c.n)}${wrong ? ' · <b class="sc-warn">⚠ pointing the wrong way</b>' : ''}</td></tr>`;
  }).join('');

  // costs (a round trip, as a fraction) and the point-in-time check, when the scorer recorded them
  const cost = sc.costs?.roundTrip ?? null;
  const pit = sc.pit;
  const pitW = pit?.windows?.all?.[h];
  const pitHTML = !pit ? '' : `<p class="sc-muted"><b>Point-in-time check:</b> ${pit.days} day${pit.days === 1 ? '' : 's'} scored so far using only the ${M.noun} that were in the list on each day (recording since ${pit.from ?? 'today'}). ${pit.days >= 60 && pitW ? `Verdict on those days: <b>${icVerdict(pitW.ic)}</b> (t = ${pitW.ic.t?.toFixed(1) ?? '—'}).` : 'A verdict needs about 60 days; until then the figures above use today’s list, which flatters the 🚀 (coins are in it because they rose).'}</p>`;
  const t = sc.tuning || {}, last = t.last;
  const foldsHTML = last?.folds ? `<ul>${last.folds.map(f => `<li>${f.from} → ${f.to}: current ${f.before?.toFixed(3) ?? '—'} vs candidate ${f.after?.toFixed(3) ?? '—'} ${f.won ? '✅' : '❌'}</li>`).join('')}</ul>` : '';
  const tuneHTML = !t.lastRun || !last ? '<p class="sc-muted">The tuner hasn\'t run yet. It runs every Sunday.</p>' : `
    <p><b>Last run ${new Date(t.lastRun).toLocaleDateString()}</b>: ${last.adopted ? '✅ <b>adopted new settings</b>: they beat the current ones on periods they weren\'t tuned on.' : 'kept the current settings. The alternative didn\'t clearly beat them on periods it wasn\'t tuned on.'}
      ${last.folds ? `Won <b>${last.wins} of ${last.folds.length}</b> check periods · average score (rank correlation over 1/3/7 days): current <b>${last.testIC.before?.toFixed(3) ?? '—'}</b> vs candidate <b>${last.testIC.after?.toFixed(3) ?? '—'}</b>.` : `Check-period score: current <b>${last.testIC.before?.toFixed(3) ?? '—'}</b> vs candidate <b>${last.testIC.after?.toFixed(3) ?? '—'}</b>.`}</p>
    ${last.holdout ? `<p><b>Untouched check</b> (${last.holdout.from} → ${last.holdout.to}, never used for tuning): current settings scored <b>${last.holdout.current?.toFixed(3) ?? '—'}</b>, the alternative <b>${last.holdout.proposed?.toFixed(3) ?? '—'}</b> <span class="sc-muted">(same score as above; around 0 means no link)</span>.</p>` : ''}
    ${last.stop ? `<p><b>Stop distance</b>: tested ${last.stop.table.map(s => `${s.m}× (exits ${s.avg >= 0 ? 'saved' : 'cost'} ${pc(Math.abs(s.avg), 2)} over 3 days)`).join(', ')}. ${last.stop.adopt ? `✅ <b>Switched from ${last.stop.from}× to ${last.stop.to}×</b>: it did better in ${last.stop.wins} of 3 check periods.` : `Kept <b>${last.stop.from}×</b>: no other distance did clearly better.`}</p>` : ''}
    ${foldsHTML ? `<details><summary>Check periods</summary>${foldsHTML}</details>` : ''}
    <details><summary>What the tuner found for each signal</summary><ul>${(last.notes || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>
    ${(t.history || []).length ? `<details><summary>Settings changes (${t.history.length})</summary><ul>${t.history.map(x => `<li>${x.date}: score ${x.testIC.before?.toFixed(3)} → ${x.testIC.after?.toFixed(3)}</li>`).join('')}</ul></details>` : ''}`;

  box.innerHTML = `
    <div class="sc-card">
      ${S.quote === 'usd' ? `<p class="sc-muted">ⓘ The scorecard is scored on <b>USD/…</b> pairs (USD/EUR, USD/JPY …), so its calls and moves refer to those, not to the …/USD view on the tiles.</p>` : ''}
      <h2>Yesterday's calls <span class="sc-muted">signals at the ${sc.signalDay} ${M.live ? 'close' : 'rate'}, then how the ${M.noun} did by the ${sc.outcomeDay} ${M.live ? 'close (UTC)' : 'ECB rate'}</span></h2>
      <div class="sc-tiles">
        ${tile(`🚀 ${M.noun}`, ys.rockets.n ? `${Math.round(ys.rockets.upRate * ys.rockets.n)} of ${ys.rockets.n} went up` : 'none', ys.rockets.n ? [`average ${spc(ys.rockets.avgRet)}`, `vs market ${spc(ys.rockets.avgExc)}`] : [])}
        ${tile(`😢 ${M.noun}`, ys.sad.n ? `${Math.round(ys.sad.downRate * ys.sad.n)} of ${ys.sad.n} went down` : 'none', ys.sad.n ? [`average ${spc(ys.sad.avgRet)}`, `vs market ${spc(ys.sad.avgExc)}`] : [])}
        ${tile('Whole market', spc(y.market), [`average of all ${sc.coins} ${M.noun}`])}
      </div>
      ${moved.length ? `<div class="sc-chips">${moved.map(c => {
        // a coin still on the page opens its chart card (P&F first) beside the chip; click again or × to close
        const open = S.coins.some(x => x.id === c.id);
        const tip = `${c.sym}: ${c.good.map(k => '🚀 ' + SIG.COMPONENTS[k]).concat(c.bad.map(k => '😢 ' + SIG.COMPONENTS[k])).join(', ')}${open ? ' · click for its chart' : ''}`;
        const inner = `${esc(c.sym)} ${c.score ? emo(c.score) : ''} ${spc(c.ret, 1)}`;
        return open
          ? `<button type="button" class="sc-chip ${heatClass(c.ret * 100, '24h')}" data-coin="${esc(c.id)}" title="${esc(tip)}">${inner}</button>`
          : `<span class="sc-chip ${heatClass(c.ret * 100, '24h')}" title="${esc(tip)}">${inner}</span>`;
      }).join('')}</div>` : ''}
    </div>

    ${sc.daily?.length ? `<div class="sc-card"><h2>Last ${sc.daily.length} days <span class="sc-muted">holding each day's 🚀 ${M.noun} vs 😢 ${M.noun} for one day</span></h2>${basketChart(sc.daily)}</div>` : ''}

    <div class="sc-card">
      <div class="sc-head"><h2>Track record <span class="sc-muted">${winName}, judged over ${hw}</span></h2>
        <div class="sc-segs">
          ${Hs.length > 1 ? segBtns('scoreH', 'h', h, Hs.map(v => [v, v === 1 ? 'Next day' : `${v} days`])) : ''}
          ${segBtns('scoreWin', 'w', S.scoreWin, [['d30', '30 days'], ['d90', '90 days'], ['all', 'All']])}
        </div></div>
      <div class="sc-tiles">
        ${tile(`When a ${M.one} had more 🚀 than 😢`, `${pc(w.rockets.upRate)} went up over ${hw}`, [`${pc(w.rockets.beatRate)} beat the market · ${w.rockets.n.toLocaleString()} calls`,
          ...(cost != null && w.rockets.avgRet != null ? [`buying: average ${spc(w.rockets.avgRet)}, <b>${spc(w.rockets.avgRet - cost)} after costs</b>`] : [])])}
        ${tile(`When a ${M.one} had more 😢 than 🚀`, `${pc(w.sad.downRate)} went down over ${hw}`, [`${pc(w.sad.lagRate)} lagged the market · ${w.sad.n.toLocaleString()} calls`,
          ...(cost != null && w.sad.avgRet != null ? [`selling short: average ${spc(-w.sad.avgRet)}, <b>${spc(-w.sad.avgRet - cost)} after costs</b>`] : [])])}
        ${tile('Coin-flip baseline', `${pc(w.all.upRate)} of all ${M.noun} went up`, [`${w.days} days · ${w.rows.toLocaleString()} ${M.one}-days`])}
      </div>
      ${cost != null ? `<p class="sc-muted">Costs: about ${pc(cost, 2)} per round trip (${M.costWords}), taken off once per holding period. A small edge can disappear after costs.</p>` : ''}
      ${pitHTML}
      <p class="sc-verdict">Verdict: <b>${icVerdict(w.ic)}</b>. <span class="sc-muted">(Daily rank correlation between score and the move over ${hw}: ${w.ic.mean?.toFixed(3) ?? '—'}, t = ${w.ic.t?.toFixed(1) ?? '—'}. Around 0 means no link; t above 2 means it's unlikely to be luck.${h > 1 ? ' Multi-day moves overlap, so t is scaled down to stay honest.' : ''})</span></p>
      ${stopsHTML(w.stops, h, hw)}
      <h3>More 🚀 → bigger move?</h3>
      <div class="tablewrap"><table class="sc-table"><thead><tr><th>Signals</th><th>Coin-days</th><th>Up</th><th>Avg move</th><th>vs market</th></tr></thead><tbody>${scoreRows}</tbody></table></div>
      <h3>Each signal on its own</h3>
      <div class="tablewrap"><table class="sc-table"><thead><tr><th>Signal</th><th>Counts as</th><th>Fired</th><th>Up</th><th>Avg vs market</th><th>Reliability</th></tr></thead><tbody>${compRows}</tbody></table></div>
    </div>

    <div class="sc-card">
      <h2>Self-tuning <span class="sc-muted">weekly, on ${M.tuneHistory}</span></h2>
      ${tuneHTML}
      <p class="sc-muted">How it works: each Sunday the tuner tries other RSI levels, moving-average pairs and momentum thresholds. For each signal it decides whether it should count as a 🚀, a 😢, or be switched off, and it judges them over the next 1, 3 and 7 days. The newest half of history is cut into three check periods. For each one, settings are chosen using only earlier days, then compared with the current settings on that period. New settings are adopted only if they win at least 2 of the 3 and do better on average. A signal also needs a stronger-than-usual result (t ≥ 2.5) to be switched on, because trying many variants makes some look good by luck. The newest 90 days are never used for tuning at all: they are the untouched check shown above. Signals marked 🧪 testing (relative strength and volume) are measured the same way but never counted as 🚀 or 😢: they get an emoji only if they prove themselves over several weeks.</p>
    </div>`;
  wireChart();
}

