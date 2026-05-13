// BibTeX emit + parse. Faithful enough for round-tripping our own
// fields. Doesn't try to handle every legacy BibTeX dialect; aim is
// "works with what JabRef and Zotero+BBT produce."

import { ENTRY_TYPES } from './schema.js';

/* BibLaTeX → canonical BibTeX-name aliases.
 *
 * Modern .bib files (biblatex-format arXiv exports, IEEE biblatex
 * style, ACM Reference Format) write `journaltitle` instead of
 * `journal` and `date = {YYYY-MM-DD}` instead of separate `year` and
 * `month`. Pothi's schema, UI, sort, citekey, and lookup all key off
 * the BibTeX-canonical names. Without this alias step the BibLaTeX
 * fields end up in the catch-all "Custom fields" section of Detail
 * and the workflow silently degrades (no journal-column in the row,
 * no year-sort, no enrichment). The alias is one-way on read, with
 * date → year extracting a four-digit year from the ISO string.
 *
 * Round-trip: a value originally tagged `journaltitle = {Science}`
 * will emit as `journal = {Science}`; biblatex.sty treats the two as
 * synonyms so the manuscript compiles either way. Users who require
 * the original key verbatim can paste the field back manually. */
const BIBLATEX_FIELD_ALIAS = {
  journaltitle: 'journal',
  date:         'year',   // value is also normalised to four-digit year below
};

// ── EMIT ──────────────────────────────────────────────────────────────
export function emitEntry(entry) {
  const typeDef = ENTRY_TYPES[entry.type] || ENTRY_TYPES.misc;
  const bibtype = typeDef.bibtex;
  const lines = ['@' + bibtype + '{' + (entry.citekey || 'untitled') + ','];
  // Stable ordering: required fields first, then optional in schema order,
  // then any custom fields the user added.
  const order = [...(typeDef.required || []), ...(typeDef.optional || [])];
  const seen = new Set(order);
  const fields = entry.fields || {};
  for (const k of order) {
    if (fields[k] != null && String(fields[k]).trim() !== '') {
      lines.push('  ' + k + ' = {' + escapeValue(String(fields[k])) + '},');
    }
  }
  for (const k of Object.keys(fields)) {
    if (seen.has(k)) continue;
    if (fields[k] != null && String(fields[k]).trim() !== '') {
      lines.push('  ' + k + ' = {' + escapeValue(String(fields[k])) + '},');
    }
  }
  // Trim trailing comma from the last field line
  if (lines.length > 1) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
  }
  lines.push('}');
  return lines.join('\n');
}

export function emitBib(entries) {
  return entries.map(emitEntry).join('\n\n') + '\n';
}

function escapeValue(s) {
  // Preserve braces (they're protective in BibTeX). Escape the chars
  // that would otherwise terminate or corrupt a {…} value.
  return s.replace(/\\/g, '\\\\').replace(/[%#]/g, '\\$&');
}

// ── PARSE ─────────────────────────────────────────────────────────────
// Intentionally small. Walks character by character, balances braces,
// extracts @type{key, k = v, …}. Returns an array of { type, citekey,
// fields } records that can be lifted into our entry shape by the caller.
export function parseBib(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    // Skip until '@'
    while (i < text.length && text[i] !== '@') i++;
    if (i >= text.length) break;
    i++; // skip '@'
    const typeStart = i;
    while (i < text.length && /[A-Za-z]/.test(text[i])) i++;
    const bibtype = text.slice(typeStart, i).toLowerCase();
    // Allow @comment / @string / @preamble — skip body
    if (bibtype === 'comment' || bibtype === 'string' || bibtype === 'preamble') {
      // Skip a balanced { … } block
      while (i < text.length && text[i] !== '{') i++;
      i = skipBalanced(text, i);
      continue;
    }
    // Expect '{'
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '{') continue;
    i++;
    // Citekey up to ','
    while (i < text.length && /\s/.test(text[i])) i++;
    const keyStart = i;
    while (i < text.length && text[i] !== ',' && text[i] !== '}') i++;
    const citekey = text.slice(keyStart, i).trim();
    if (text[i] === ',') i++;
    const fields = {};
    // Read field-name = value pairs until '}'
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] === '}') { i++; break; }
      // field name
      const nameStart = i;
      while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) i++;
      const name = text.slice(nameStart, i).toLowerCase();
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] !== '=') break;
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;
      // value: either {balanced}, "quoted", or bare token
      let value = '';
      if (text[i] === '{') {
        const end = skipBalanced(text, i);
        value = text.slice(i + 1, end - 1);
        i = end;
      } else if (text[i] === '"') {
        i++;
        const vStart = i;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\' && i + 1 < text.length) i += 2;
          else i++;
        }
        value = text.slice(vStart, i);
        i++;
      } else {
        const vStart = i;
        while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
        value = text.slice(vStart, i);
      }
      let storeName = BIBLATEX_FIELD_ALIAS[name] || name;
      let storeValue = unescapeValue(value);
      // BibLaTeX `date = {YYYY-MM-DD}` (or YYYY, YYYY-MM, intervals)
      // collapses to a four-digit `year` since Pothi's schema doesn't
      // carry full ISO dates yet. Anything that doesn't contain four
      // consecutive digits is kept verbatim — let the user notice.
      if (storeName === 'year' && name === 'date') {
        const m = String(storeValue).match(/(\d{4})/);
        if (m) storeValue = m[1];
      }
      // If the entry already carries the canonical key (rare but
      // legal — both `journal` and `journaltitle` present), keep the
      // first one read rather than clobber.
      if (!(storeName in fields)) fields[storeName] = storeValue;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] === ',') i++;
    }
    out.push({ bibtype, citekey, fields });
  }
  return out;
}

function skipBalanced(text, i) {
  if (text[i] !== '{') return i;
  let depth = 0;
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) { i += 2; continue; }
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return i;
}

function unescapeValue(s) {
  // Collapse multi-line whitespace
  let out = s.replace(/\s+/g, ' ').trim();
  // BibTeX → Unicode for the diacritics commonly seen in author names
  // and titles. Survives the {…}-protection that BibTeX uses for case.
  out = bibtexUnicodify(out);
  // Standard backslash unescapes (after the diacritics pass — those need
  // the literal backslash to match)
  out = out.replace(/\\([%#&_$\\{}])/g, '$1');
  // Stray empty braces left behind by stripped commands
  out = out.replace(/\{\s*\}/g, '').replace(/\{([^{}]*)\}/g, '$1');
  return out;
}

// LaTeX-escaped diacritic → real Unicode. Handles the four most common
// "broken bib" patterns:
//   \"o   \"{o}   {\"o}   {\"{o}}     →  ö
// Symbol commands (\ss, \aa, \AE, \o, \O, \L, \l, \i, \j) get their
// Unicode equivalents; LaTeX dashes and quotes too.
const DIACRITIC_MAP = {
  '"': { a:'ä', A:'Ä', e:'ë', E:'Ë', i:'ï', I:'Ï', o:'ö', O:'Ö', u:'ü', U:'Ü', y:'ÿ', Y:'Ÿ' },
  "'": { a:'á', A:'Á', e:'é', E:'É', i:'í', I:'Í', o:'ó', O:'Ó', u:'ú', U:'Ú', y:'ý', Y:'Ý', n:'ń', N:'Ń', c:'ć', C:'Ć', s:'ś', S:'Ś', z:'ź', Z:'Ź' },
  '`': { a:'à', A:'À', e:'è', E:'È', i:'ì', I:'Ì', o:'ò', O:'Ò', u:'ù', U:'Ù' },
  '^': { a:'â', A:'Â', e:'ê', E:'Ê', i:'î', I:'Î', o:'ô', O:'Ô', u:'û', U:'Û', s:'ŝ', S:'Ŝ' },
  '~': { a:'ã', A:'Ã', n:'ñ', N:'Ñ', o:'õ', O:'Õ' },
  '=': { a:'ā', A:'Ā', e:'ē', E:'Ē', i:'ī', I:'Ī', o:'ō', O:'Ō', u:'ū', U:'Ū' },
  '.': { c:'ċ', C:'Ċ', e:'ė', E:'Ė', g:'ġ', G:'Ġ', z:'ż', Z:'Ż' },
  c: { c:'ç', C:'Ç', s:'ş', S:'Ş', t:'ţ', T:'Ţ' },           // cedilla
  k: { a:'ą', A:'Ą', e:'ę', E:'Ę', i:'į', I:'Į', u:'ų', U:'Ų' }, // ogonek
  v: { c:'č', C:'Č', s:'š', S:'Š', z:'ž', Z:'Ž', n:'ň', N:'Ň', r:'ř', R:'Ř', t:'ť', T:'Ť' }, // caron
  H: { o:'ő', O:'Ő', u:'ű', U:'Ű' },                          // Hungarian umlaut
  u: { a:'ă', A:'Ă', g:'ğ', G:'Ğ' },                          // breve
  r: { a:'å', A:'Å', u:'ů', U:'Ů' },                          // ring
  d: { d:'ḍ' },                                                 // dot below (sparse)
};
const SYMBOL_MAP = {
  ss: 'ß', AE: 'Æ', ae: 'æ', OE: 'Œ', oe: 'œ',
  AA: 'Å', aa: 'å',
  o: 'ø', O: 'Ø', l: 'ł', L: 'Ł',
  i: 'ı', j: 'ȷ',
  TH: 'Þ', th: 'þ', DH: 'Ð', dh: 'ð',
  copyright: '©', S: '§', P: '¶',
  textemdash: '—', textendash: '–',
  textquoteleft: '‘', textquoteright: '’',
  textquotedblleft: '“', textquotedblright: '”',
  ldots: '…',
};
function bibtexUnicodify(s) {
  if (!s || s.indexOf('\\') === -1 && s.indexOf('--') === -1 && s.indexOf('``') === -1) return s;
  let out = s;
  // \X{c} or {\X c} or \X c for diacritics. Order: longest patterns first.
  // {\X{c}}, {\Xc}, \X{c}, \Xc
  for (const [marker, table] of Object.entries(DIACRITIC_MAP)) {
    const escMarker = marker.replace(/[\\^$.|?*+()\[\]{}]/g, '\\$&');
    const isAlpha = /^[a-zA-Z]$/.test(marker);
    // Word-boundary required if marker is a letter (so "v" command doesn't
    // eat random "v"s in words). Non-letter markers just need backslash.
    const wb = isAlpha ? '(?![A-Za-z])' : '';
    // Pattern 1: {\X{c}}, {\X c}
    out = out.replace(new RegExp('\\{\\\\' + escMarker + wb + '\\s*\\{?(\\w)\\}?\\s*\\}', 'g'), (_, c) => table[c] || c);
    // Pattern 2: \X{c} or \Xc (no outer braces)
    out = out.replace(new RegExp('\\\\' + escMarker + wb + '\\s*\\{?(\\w)\\}?', 'g'), (_, c) => table[c] || c);
  }
  // Symbol commands like \ss, \AE, \aa{}, \o, \L
  out = out.replace(/\{?\\([A-Za-z]+)\}?(?:\{\})?/g, (m, cmd) => SYMBOL_MAP[cmd] != null ? SYMBOL_MAP[cmd] : m);
  // Dashes and quotes
  out = out.replace(/---/g, '—').replace(/--/g, '–');
  out = out.replace(/``/g, '“').replace(/''/g, '”');
  out = out.replace(/`(\S)/g, '‘$1');
  return out;
}
export { bibtexUnicodify };

// Map a parsed bibtype back to one of our entry type ids.
export function bibtypeToType(bibtype) {
  const direct = Object.entries(ENTRY_TYPES).find(([_, def]) => def.bibtex === bibtype);
  if (direct) return direct[0];
  return 'misc';
}
