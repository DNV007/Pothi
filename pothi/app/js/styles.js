// Citation style formatters. Two styles ship today; a "bring your own
// CSL" path can be added later by vendoring citeproc-js (~600 KB), but
// these two cover the common case and keep the bundle lean.
//
// Each style exports two functions:
//   formatInline(citations)    — string for in-text replacement
//   formatBibliography(entry, ord) — string for the bibliography
// where citations is an array of { entry, suffix, ord } objects, and
// `ord` is the 1-based citation order (used by numeric styles).

/* Helpers: split BibTeX-style author lists, derive surname / initials. */
function splitAuthors(field) {
  if (!field) return [];
  return String(field).split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
}

function surnameOf(authorChunk) {
  if (!authorChunk) return '';
  // Brace-protected literal name → use as-is
  const m = authorChunk.match(/^\{(.+)\}$/);
  if (m) return m[1];
  if (authorChunk.includes(',')) return authorChunk.split(',')[0].trim();
  const parts = authorChunk.trim().split(/\s+/);
  return parts[parts.length - 1] || authorChunk;
}

function initialsAndSurname(authorChunk) {
  // Returns "Surname, A. B." style — what bibliographies use.
  const m = authorChunk.match(/^\{(.+)\}$/);
  if (m) return m[1];                           // institution → leave alone
  if (authorChunk.includes(',')) {
    const [last, given] = authorChunk.split(',').map(s => s.trim());
    if (!given) return last;
    const initials = given.split(/\s+/).map(p => (p[0] || '').toUpperCase() + '.').join(' ');
    return last + ', ' + initials;
  }
  const parts = authorChunk.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const initials = parts.slice(0, -1).map(p => (p[0] || '').toUpperCase() + '.').join(' ');
  return last + ', ' + initials;
}

function shortAuthorYear(entry) {
  const auths = splitAuthors(entry.fields.author || entry.fields.editor || '');
  const surnames = auths.map(surnameOf);
  if (!surnames.length) return 'Anon.';
  if (surnames.length === 1) return surnames[0];
  if (surnames.length === 2) return surnames[0] + ' and ' + surnames[1];
  return surnames[0] + ' et al.';
}

function fullAuthorList(entry) {
  const auths = splitAuthors(entry.fields.author || '').map(initialsAndSurname);
  if (!auths.length) return splitAuthors(entry.fields.editor || '').map(initialsAndSurname).join(', ') + ' (Eds.)';
  if (auths.length === 1) return auths[0];
  if (auths.length === 2) return auths[0] + ', & ' + auths[1];
  return auths.slice(0, -1).join(', ') + ', & ' + auths[auths.length - 1];
}

/* ── Bibliography body — a roughly-APA-shaped string used by both
 * styles (numeric just prefixes "[N] "). ── */
export function formatBibliographyAuthorYear(entry) {
  const f = entry.fields || {};
  const auth = fullAuthorList(entry);
  const year = f.year || 'n.d.';
  const title = f.title || '(untitled)';
  let line = (auth ? auth + ' ' : '') + '(' + year + '). ' + endWithStop(title);

  if (entry.type === 'article') {
    if (f.journal) line += ' ' + italic(f.journal);
    if (f.volume)  line += ', ' + italic(f.volume);
    if (f.number)  line += '(' + f.number + ')';
    if (f.pages)   line += ', ' + f.pages.replace(/-/g, '–');
    line += '.';
  } else if (entry.type === 'book') {
    if (f.publisher) line += ' ' + f.publisher + '.';
  } else if (entry.type === 'inbook' || entry.type === 'inproceedings') {
    if (f.editor) line += ' In ' + splitAuthors(f.editor).map(initialsAndSurname).join(', ') + ' (Ed.),';
    if (f.booktitle) line += ' ' + italic(f.booktitle);
    if (f.pages) line += ' (pp. ' + f.pages.replace(/-/g, '–') + ')';
    if (f.publisher) line += '. ' + f.publisher;
    line += '.';
  } else if (entry.type === 'thesis') {
    line += ' [' + (f.type || 'PhD thesis') + (f.school ? ', ' + f.school : '') + '].';
  } else if (entry.type === 'techreport') {
    if (f.institution) line += ' ' + f.institution + '.';
    else if (f.publisher) line += ' ' + f.publisher + '.';
  }

  if (f.doi) line += ' https://doi.org/' + f.doi;
  else if (f.url) line += ' ' + f.url;
  return line;
}

export function formatBibliographyNumeric(entry, ord) {
  return '[' + ord + '] ' + formatBibliographyAuthorYear(entry);
}

/* ── Inline citation formatters ── */
export function formatInlineAuthorYear(citations) {
  const valid = citations.filter(Boolean);
  if (!valid.length) return '[?]';
  const parts = valid.map(c => {
    const tag = shortAuthorYear(c.entry) + ' ' + (c.entry.fields.year || 'n.d.');
    return c.suffix ? tag + ', ' + c.suffix : tag;
  });
  return '(' + parts.join('; ') + ')';
}

export function formatInlineNumeric(citations) {
  const valid = citations.filter(Boolean);
  if (!valid.length) return '[?]';
  return '[' + valid.map(c => c.suffix ? c.ord + ', ' + c.suffix : String(c.ord)).join(', ') + ']';
}

/* ── Style registry ── */
export const STYLES = {
  'author-year': {
    label: 'Author-year (APA-ish)',
    inline: formatInlineAuthorYear,
    bib: formatBibliographyAuthorYear,
    sortBibBy: 'author',
  },
  'numeric': {
    label: 'Numeric (IEEE-ish)',
    inline: formatInlineNumeric,
    bib: formatBibliographyNumeric,
    sortBibBy: 'order',
  },
};

/* ── small helpers ── */
function endWithStop(s) {
  s = String(s).trim();
  if (!s) return '';
  return /[.!?]$/.test(s) ? s : s + '.';
}
function italic(s) { return s; /* docx run formatting handles italic; we keep plain text here */ }
