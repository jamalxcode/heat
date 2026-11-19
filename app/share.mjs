// heat.sala.company: share a card (a coin or price, a prediction market, a bond market) to WhatsApp, Telegram, X, email,
// the phone's own share sheet, the clipboard, or as a picture. Each page builds a payload from what its card shows:
//   { title, kicker, big, sub, words, url, file, tintFrom }  (tintFrom: an element whose --tint / --tint-ink colour the picture)
// Nothing is sent anywhere by the page itself: the links open the visitor's own app, and the picture is drawn in the browser.
const enc = encodeURIComponent;
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const shareButton = () => '<button type="button" class="d-share" data-share aria-expanded="false" title="Share this card: WhatsApp, Telegram, X, email, your phone’s share sheet, or as a picture">↗ Share</button>';

// the message: the card in one or two lines, then the link (apps that take the link separately get it separately)
export function shareText(p) {
  if (p.text) return p.text;
  return [p.title, [p.kicker, p.big].filter(Boolean).join(' '), p.sub, p.words].filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim()
    + ' — heat.sala.company (not financial advice)';
}
export function shareLinks(p) {
  const text = shareText(p);
  return {
    whatsapp: `https://wa.me/?text=${enc(`${text}\n${p.url}`)}`,
    telegram: `https://t.me/share/url?url=${enc(p.url)}&text=${enc(text)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(p.url)}`,
    email: `mailto:?subject=${enc(p.title)}&body=${enc(`${text}\n\n${p.url}`)}`,
  };
}

// The row of options, opened inside the card under its header (so it works the same in the laptop popup and the phone sheet)
export function toggleMenu(btn, p) {
  const card = btn.closest('#detail .body') || btn.parentElement;
  const open = card.querySelector('.share-menu');
  if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const l = shareLinks(p), native = typeof navigator !== 'undefined' && !!navigator.share;
  const a = (k, label, href, extra = '') => `<a class="sh sh-${k}" href="${escH(href)}" target="_blank" rel="noopener noreferrer"${extra}>${label}</a>`;
  const menu = document.createElement('div');
  menu.className = 'share-menu';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Share this card');
  menu.innerHTML = `${native ? '<button type="button" class="sh sh-native" data-sh="native">📲 Share…</button>' : ''}
    ${a('whatsapp', '🟢 WhatsApp', l.whatsapp)}${a('telegram', '✈️ Telegram', l.telegram)}${a('x', '𝕏 X', l.x)}${a('email', '✉️ Email', l.email, ' data-sh="email"')}
    <button type="button" class="sh sh-copy" data-sh="copy">📋 Copy text</button><button type="button" class="sh sh-img" data-sh="image">🖼️ Save image</button>
    <span class="sh-note" aria-live="polite"></span>`;
  const head = btn.closest('.d-head, .p-pophead, .r-head');
  if (head) head.after(menu); else card.prepend(menu);
  btn.setAttribute('aria-expanded', 'true');
  menu.addEventListener('click', async e => {
    const b = e.target.closest('[data-sh]'), note = menu.querySelector('.sh-note');
    if (!b || b.tagName === 'A') return;
    e.preventDefault();
    const say = t => { note.textContent = t; setTimeout(() => { if (note.textContent === t) note.textContent = ''; }, 2500); };
    if (b.dataset.sh === 'copy') {
      try { await navigator.clipboard.writeText(`${shareText(p)}\n${p.url}`); say('✓ Copied'); } catch { prompt('Copy this:', `${shareText(p)}\n${p.url}`); }
    } else if (b.dataset.sh === 'image') {
      const blob = await cardImage(p);
      const url = URL.createObjectURL(blob), dl = document.createElement('a');
      dl.href = url; dl.download = p.file || 'heat-card.png'; document.body.append(dl);
      dl.dispatchEvent(new MouseEvent('click'));   // not bubbling: a bubbling click would reach the page's "click outside closes the card" handler
      dl.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      say('✓ Saved');
    } else if (b.dataset.sh === 'native') {
      const data = { title: p.title, text: shareText(p), url: p.url };
      try {
        const file = new File([await cardImage(p)], p.file || 'heat-card.png', { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) data.files = [file];   // the picture too, where the phone takes files
      } catch { /* no picture: text and link only */ }
      try { await navigator.share(data); } catch { /* cancelled */ }
    }
  });
}

// The card as a 1200×630 picture (the size link previews use), in the card's own heat colour
export async function cardImage(p) {
  const W = 1200, H = 630, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const cs = p.tintFrom ? getComputedStyle(p.tintFrom) : null;
  const bg = cs?.getPropertyValue('--tint').trim() || '#1d2a3a', ink = cs?.getPropertyValue('--tint-ink').trim() || '#ffffff';
  try { await document.fonts?.load('700 40px Inter'); } catch { /* system font */ }
  const F = (w, s) => `${w} ${s}px Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.fillStyle = ink; x.textBaseline = 'top';
  const wrap = (text, font, maxW, lines) => {            // words into at most `lines` lines, the last one cut with …
    x.font = font;
    const out = [];
    let cur = '';
    for (const w of String(text || '').split(/\s+/)) {
      const t = cur ? cur + ' ' + w : w;
      if (x.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    if (out.length > lines) { out.length = lines; let l = out[lines - 1]; while (x.measureText(l + '…').width > maxW && l.length) l = l.slice(0, -1); out[lines - 1] = l + '…'; }
    return out;
  };
  let y = 56;
  x.globalAlpha = 0.85; x.font = F(700, 28); x.fillText('🔥 heat.sala.company' + (p.market ? ` · ${p.market}` : ''), 64, y); x.globalAlpha = 1;
  y += 64;
  for (const l of wrap(p.title, F(800, 54), W - 128, 2)) { x.font = F(800, 54); x.fillText(l, 64, y); y += 66; }
  y += 14;
  if (p.kicker) { x.globalAlpha = 0.85; x.font = F(700, 30); x.fillText(p.kicker.toUpperCase(), 64, y); x.globalAlpha = 1; y += 46; }
  x.font = F(800, 132); x.fillText(p.big || '', 60, y);
  const bw = x.measureText(p.big || '').width;
  if (p.bigNote) { x.globalAlpha = 0.85; x.font = F(600, 38); x.fillText(p.bigNote, 60 + bw + 20, y + 78); x.globalAlpha = 1; }
  y += 150;
  if (p.sub) { x.font = F(700, 36); for (const l of wrap(p.sub, F(700, 36), W - 128, 1)) { x.fillText(l, 64, y); y += 48; } }
  if (p.words) { x.globalAlpha = 0.9; for (const l of wrap(p.words, F(500, 30), W - 128, 2)) { x.font = F(500, 30); x.fillText(l, 64, y); y += 40; } x.globalAlpha = 1; }
  x.globalAlpha = 0.75; x.font = F(500, 22);
  x.fillText(`Not financial advice · ${new Date().toUTCString().replace(/:\d\d GMT$/, ' UTC')}`, 64, H - 52); x.globalAlpha = 1;
  return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
}
