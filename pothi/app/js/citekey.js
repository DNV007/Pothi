// Citekey generator. Given an entry and a template, return a citekey;
// caller is responsible for collision resolution against existing keys.
import { CITEKEY_TEMPLATE } from './schema.js';

const NON_ALNUM = /[^A-Za-z0-9]+/g;
const ASCII_FOLD = {
  'á':'a','à':'a','â':'a','ä':'a','ã':'a','å':'a','æ':'ae',
  'é':'e','è':'e','ê':'e','ë':'e',
  'í':'i','ì':'i','î':'i','ï':'i',
  'ó':'o','ò':'o','ô':'o','ö':'o','õ':'o','ø':'o','œ':'oe',
  'ú':'u','ù':'u','û':'u','ü':'u',
  'ý':'y','ÿ':'y',
  'ñ':'n','ç':'c','ß':'ss','ž':'z','š':'s',
};
function asciiFold(s) {
  return s.toLowerCase().split('').map(c => ASCII_FOLD[c] || c).join('').replace(/[^\x00-\x7f]/g, '');
}

function firstAuthorSurname(authorsField) {
  if (!authorsField) return 'Anon';
  // BibTeX: "Last, First and Last2, First2"
  const first = authorsField.split(/\s+and\s+/i)[0] || '';
  if (first.includes(',')) return first.split(',')[0].trim();
  // "First Last" form: take the last token
  const parts = first.trim().split(/\s+/);
  return parts[parts.length - 1] || 'Anon';
}

function titleWords(title, n) {
  const stop = new Set(['the','a','an','of','for','to','and','in','on','with','from','by']);
  const words = (title || '').toLowerCase().match(/[a-z][a-z0-9]+/gi) || [];
  return words.filter(w => !stop.has(w.toLowerCase())).slice(0, n);
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

const TOKENS = {
  'author1':  e => asciiFold(firstAuthorSurname(e.fields.author || e.fields.editor || '')),
  'Author1':  e => capitalize(asciiFold(firstAuthorSurname(e.fields.author || e.fields.editor || ''))),
  'AUTHOR1':  e => asciiFold(firstAuthorSurname(e.fields.author || e.fields.editor || '')).toUpperCase(),
  'year':     e => String(e.fields.year || 'nd').slice(-4),
  'short':    e => String(e.fields.year || 'nd').slice(-2),
  'title3':   e => titleWords(e.fields.title || '', 3).map(capitalize).join(''),
  'title-slug': e => (e.fields.title || '').toLowerCase().replace(NON_ALNUM, '-').replace(/^-|-$/g, '').slice(0, 30),
  'journal3': e => (e.fields.journal || '').toLowerCase().replace(NON_ALNUM, '').slice(0, 3),
};

export function generateCitekey(entry, template = CITEKEY_TEMPLATE) {
  return template.replace(/\{([^}]+)\}/g, (_, tok) => {
    const fn = TOKENS[tok];
    return fn ? fn(entry) : '';
  });
}

// Resolve collisions by appending a, b, c, …
export function uniqueCitekey(base, existingKeys) {
  if (!existingKeys.has(base)) return base;
  for (let i = 0; i < 26; i++) {
    const k = base + String.fromCharCode(97 + i); // 'a'…'z'
    if (!existingKeys.has(k)) return k;
  }
  // Fall back to a numeric suffix
  for (let i = 2; i < 1000; i++) {
    const k = base + i;
    if (!existingKeys.has(k)) return k;
  }
  return base + Date.now();
}
