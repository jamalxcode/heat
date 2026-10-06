// The Energy page's two weekly sections under the futures (fuel.json, built by scripts/build-fuel.mjs):
//   - pump prices by country (US, UK, the 27 EU countries), petrol and diesel, in US dollars per litre and local money
//   - US refined-product spot prices (diesel, jet fuel, gasoline, heating oil, propane), official but about a week behind
// Both are clearly marked as weekly / a week behind, unlike the futures above. Started by main.mjs on the Energy page.
import { $, esc, logo, store } from './core.mjs';

let F = null;
const SORTS = [['petrol', 'Petrol price'], ['diesel', 'Diesel price'], ['chg', 'Change on the week'], ['name', 'Country']];
let sortBy = (v => SORTS.some(s => s[0] === v) ? v : 'petrol')(store.get('hm.fuelSort'));
const usd = v => v == null ? '—' : '$' + v.toFixed(2);
const day = iso => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
const LOCAL = { EUR: '€', GBP: '£', USD: '$' };
const local = (p, cur) => p?.local == null ? '—' : `${LOCAL[cur] || ''}${p.local.toFixed(cur === 'GBP' ? 3 : 2)}`;
// a change as ▲ / ▼ with its value (shape as well as colour: readable without telling colours apart)
const chg = v => v == null ? '<span class="f-muted" title="Not yet: the weekly change shows from the next bulletin">new</span>'
  : `<span class="f-chg ${v > 0 ? 'up' : v < 0 ? 'dn' : ''}">${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${Math.abs(v).toFixed(1)}%</span>`;

function pumpHTML() {
  const rows = [...F.pump], max = Math.max(...rows.map(r => Math.max(r.petrol.usdL || 0, r.diesel.usdL || 0)), 0.01);
  const by = { petrol: r => -(r.petrol.usdL ?? -1), diesel: r => -(r.diesel.usdL ?? -1), chg: r => -(r.petrol.chg ?? -999), name: () => 0 }[sortBy];
  rows.sort((a, b) => by(a) - by(b) || a.name.localeCompare(b.name));
  const bar = (v, cls) => v == null ? '' : `<span class="f-track"><span class="f-bar ${cls}" style="width:${Math.round(v / max * 100)}%"></span></span>`;
  const dates = [...new Set(F.pump.map(p => p.date))].sort();
  return `<h2>⛽ Pump prices <span class="f-tag">📅 weekly</span></h2>
    <p class="f-note">What drivers pay at the pump, taxes included, converted to <b>US dollars per litre</b> at the latest exchange rates (the local price is beside it). Official weekly figures: the EU Weekly Oil Bulletin for the 27 EU countries, the UK government, and the US Energy Information Administration; latest weeks ${dates.map(day).join(', ')}. The change is petrol’s, on the week before.</p>
    <div class="f-ctl"><label class="r-sel">Sort <select id="fsort">${SORTS.map(([v, l]) => `<option value="${v}"${v === sortBy ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="f-key"><span class="f-bar petrol"></span> petrol <span class="f-bar diesel"></span> diesel</span></div>
    <div class="r-tblwrap"><table class="r-tbl f-tbl"><thead><tr><th>Country</th><th>Petrol, $/litre</th><th>Diesel, $/litre</th><th>Petrol, week</th><th>Local price</th><th>Week of</th></tr></thead><tbody>
    ${rows.map(r => `<tr${r.notRefreshed ? ' class="f-stale" title="The source didn’t answer in the latest check: last week’s figures"' : ''}><th scope="row">${logo(r, 16)} ${esc(r.name)}</th>
      <td class="f-cell"><b>${usd(r.petrol.usdL)}</b>${bar(r.petrol.usdL, 'petrol')}</td><td class="f-cell"><b>${usd(r.diesel.usdL)}</b>${bar(r.diesel.usdL, 'diesel')}</td>
      <td>${chg(r.petrol.chg)}</td><td>${local(r.petrol, r.cur)} · ${local(r.diesel, r.cur)}</td><td>${day(r.date)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function spotHTML() {
  const spark = s => {
    const v = (s.series || []).map(p => p[1]);
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), w = 70, h = 16;
    return `<svg class="f-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${v.map((y, i) => `${i ? 'L' : 'M'}${(i / (v.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 2 - (y - lo) / (hi - lo || 1) * (h - 4)).toFixed(1)}`).join('')}" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
  };
  return `<h2>🏭 US refined products, spot <span class="f-tag">🕐 about a week behind</span></h2>
    <p class="f-note">Wholesale prices of fuel bought for prompt delivery at the main US trading hubs, in <b>US dollars per gallon</b> (3.785 litres): the US Energy Information Administration’s daily figures, which it publishes about a week late. The live futures above (diesel and gasoline, New York Harbor) move first.</p>
    <div class="r-tblwrap"><table class="r-tbl f-tbl"><thead><tr><th>Product</th><th>Where</th><th>$/gallon</th><th>1 week</th><th>1 month</th><th>Last 3 months</th><th>Date</th></tr></thead><tbody>
    ${F.spot.map(s => `<tr${s.notRefreshed ? ' class="f-stale"' : ''}><th scope="row">${esc(s.name)}</th><td>${esc(s.where)}</td><td><b>${usd(s.usdGal)}</b></td><td>${chg(s.chg1w)}</td><td>${chg(s.chg1m)}</td><td>${spark(s)}</td><td>${day(s.date)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function render() {
  const sec = $('#fuel');
  if (!F || !sec) return;
  sec.hidden = !(F.pump?.length || F.spot?.length);
  sec.innerHTML = `${F.pump?.length ? `<section class="f-sec" id="fuelPump">${pumpHTML()}</section>` : ''}${F.spot?.length ? `<section class="f-sec" id="fuelSpot">${spotHTML()}</section>` : ''}`;
}
async function load() {
  try {
    const r = await fetch(`/fuel.json?b=${Math.floor(Date.now() / 60e3)}`, { cache: 'no-store' });
    if (r.ok) { F = await r.json(); render(); }
  } catch { /* the futures above still work */ }
}
export function start() {
  $('main').insertAdjacentHTML('beforeend', '<div id="fuel" class="f-wrap" hidden></div>');
  $('#fuel').addEventListener('change', e => { if (e.target.id === 'fsort') { sortBy = e.target.value; store.set('hm.fuelSort', sortBy); render(); } });
  load();
  setInterval(load, 30 * 60e3);
}
