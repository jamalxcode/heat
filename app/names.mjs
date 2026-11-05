// Matching outcome names across venues. Shared by the build (which groups the same question on several venues) and
// the page (which reads each venue's price for the answer shown), so both agree on what "the same answer" is.
//
// An outcome becomes keys: its meaningful words and, when it names a party, that party.
//   "Scott Colom (D)", "Dems (Colom)", "Democratic Party — Scott Colom" → words {scott?, colom}, party dem
//   "Democrats", "Democratic party" → no words, party dem (a party-only outcome: it matches a candidate of that party)
//   "San Francisco 49ers" ≈ "San Francisco"; "Eizenkot" ≈ "Eisenkot" (one letter apart)
// Number outcomes ("Below 45", "52+", "At least 238") match only in full: "Below 45" isn't "45".

const PARTY_D = /\b(dem|dems|democrat|democrats|democratic)\b|\(d\)/, PARTY_R = /\b(rep|gop|republican|republicans)\b|\(r\)/;
const DROP = new Set(['party', 'the', 'and', 'jr', 'sr', 'ii', 'iii', 'iv', 'fc', 'cf', 'sc', 'sk', 'club', 'sen', 'gov', 'mr', 'mrs', 'ms', 'dr', 'rep', 'gop', 'dem', 'dems', 'democrat', 'democrats', 'democratic', 'republican', 'republicans', 'win', 'wins']);
const NUMWORDS = /\b(above|below|over|under|at|least|most|more|fewer|less|than|between|to|or|and|exactly|pts|points|seats?|before|after|by|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|million|billion|bps|basis|cut|cuts|hike|hikes|no|change)\b/g;
const fullNum = n => String(n).toLowerCase().replace(/\([^)]{0,3}\)/g, ' ').replace(/[^a-z0-9+<>. ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const isNumberName = n => /\d/.test(n) && !/[a-z]{3,}/.test(String(n).toLowerCase().replace(NUMWORDS, ' ').replace(/\d+(st|nd|rd|th|s)?\b/g, ' '));

export function nameKeys(n) {
  const s = String(n).toLowerCase();
  // a number of its own ("Below 45", "Talarico 12%+", "Democrats, 12 to 14%"; not "49ers") must match in full
  if (isNumberName(s) || /(^|[^a-z0-9])\d+(\.\d+)?($|[^a-z0-9]|%|\+|st\b|nd\b|rd\b|th\b)/.test(s)) return { num: fullNum(s), words: new Set(), party: null };
  const party = PARTY_D.test(s) && !PARTY_R.test(s) ? 'dem' : PARTY_R.test(s) && !PARTY_D.test(s) ? 'rep' : null;
  const words = new Set(s.replace(/[’']s\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !DROP.has(w)));
  return { num: null, words, party };
}
// one letter apart (a typo or a transliteration: Eizenkot / Eisenkot), for longer words only
const near = (a, b) => {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};
// how well two outcome names match: 0 none; 1 by party only; 2+ by words
export function nameScore(a, b) {
  const x = typeof a === 'string' ? nameKeys(a) : a, y = typeof b === 'string' ? nameKeys(b) : b;
  if (x.num != null || y.num != null) return x.num != null && x.num === y.num ? 3 : 0;
  if (x.party && y.party && x.party !== y.party) return 0;
  if (x.words.size && y.words.size) {
    let n = 0;
    for (const w of x.words) if ([...y.words].some(v => near(w, v))) n++;
    return n ? 1 + n : 0;
  }
  return x.party && x.party === y.party ? 1 : 0;   // "Democrats" ≈ "Mary Peltola (D)"
}
// the outcome in a list that best matches a name, or null
export function bestMatch(name, outcomes) {
  const k = nameKeys(name);
  let best = null, score = 0;
  for (const o of outcomes) { const s = nameScore(k, nameKeys(o.name)); if (s > score) { best = o; score = s; } }
  return best;
}
