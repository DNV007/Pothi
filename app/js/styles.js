// Citation style formatters. Each style exports two functions:
//   formatInline(citations)      — string for in-text replacement
//   formatBibliography(entry, ord) — string for the bibliography
// where citations is an array of { entry, suffix, ord } objects, and
// `ord` is the 1-based citation order (used by numeric styles).
//
// Styles implemented: APA 7, Harvard, Chicago author-date, MLA 9,
// IEEE, Nature, Science (AAAS), Cell Press, PNAS, Vancouver/NLM,
// Elsevier, RSC/Wiley, ACS.

/* Helpers: split BibTeX-style author lists, derive surname / initials. */
export function splitAuthors(field) {
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

function compactAuthorList(entry) {
  const auths = splitAuthors(entry.fields.author || entry.fields.editor || '').map(initialsAndSurname);
  if (!auths.length) return 'Anonymous';
  if (auths.length <= 6) return auths.join(', ');
  return auths.slice(0, 6).join(', ') + ', et al.';
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

export function formatBibliographyNature(entry, ord) {
  const f = entry.fields || {};
  const parts = [
    ord + '. ' + compactAuthorList(entry) + '.',
    endWithStop(f.title || '(untitled)'),
  ];
  if (f.journal || f.booktitle) {
    let venue = f.journal || f.booktitle;
    if (f.volume) venue += ' ' + f.volume;
    if (f.pages) venue += ', ' + String(f.pages).replace(/-/g, '-');
    if (f.year) venue += ' (' + f.year + ')';
    parts.push(endWithStop(venue));
  } else if (f.publisher) {
    parts.push(endWithStop(f.publisher + (f.year ? ' (' + f.year + ')' : '')));
  } else if (f.year) {
    parts.push('(' + f.year + ').');
  }
  if (f.doi) parts.push('doi:' + f.doi + '.');
  else if (f.url) parts.push(f.url);
  return parts.filter(Boolean).join(' ');
}

export function formatBibliographyVancouver(entry, ord) {
  const f = entry.fields || {};
  let line = ord + '. ' + compactAuthorList(entry) + '. ' + endWithStop(f.title || '(untitled)');
  const venue = f.journal || f.booktitle || f.publisher || '';
  if (venue) {
    line += ' ' + venue + '.';
    if (f.year) line += ' ' + f.year;
    if (f.volume) line += ';' + f.volume;
    if (f.number) line += '(' + f.number + ')';
    if (f.pages) line += ':' + String(f.pages).replace(/-/g, '-');
    line += '.';
  } else if (f.year) {
    line += ' ' + f.year + '.';
  }
  if (f.doi) line += ' doi: ' + f.doi + '.';
  else if (f.url) line += ' Available from: ' + f.url;
  return line;
}

export function formatBibliographyAcs(entry, ord) {
  const f = entry.fields || {};
  let line = '(' + ord + ') ' + compactAuthorList(entry) + '. ' + endWithStop(f.title || '(untitled)');
  const venue = f.journal || f.booktitle || '';
  if (venue) {
    line += ' ' + venue;
    if (f.year) line += ' ' + f.year;
    if (f.volume) line += ', ' + f.volume;
    if (f.pages) line += ', ' + String(f.pages).replace(/-/g, '-');
    line += '.';
  } else if (f.publisher || f.year) {
    line += ' ' + [f.publisher, f.year].filter(Boolean).join(', ') + '.';
  }
  if (f.doi) line += ' DOI: ' + f.doi + '.';
  else if (f.url) line += ' ' + f.url;
  return line;
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

export function formatInlineAcs(citations) {
  const valid = citations.filter(Boolean);
  if (!valid.length) return '(?)';
  return '(' + valid.map(c => c.suffix ? c.ord + ', ' + c.suffix : String(c.ord)).join(', ') + ')';
}

export function formatInlineHarvard(citations) {
  return formatInlineAuthorYear(citations);
}

export function formatInlineChicago(citations) {
  return formatInlineAuthorYear(citations);
}

export function formatInlineMla(citations) {
  // MLA uses (Surname page) or (Surname) in-text
  const valid = citations.filter(Boolean);
  if (!valid.length) return '(?)';
  const parts = valid.map(c => {
    const s = surnameOf(splitAuthors(c.entry.fields.author || c.entry.fields.editor || '')[0] || '');
    const label = s || 'Anon';
    return c.suffix ? label + ' ' + c.suffix : label;
  });
  return '(' + parts.join('; ') + ')';
}

export function formatInlineElsevier(citations) {
  return formatInlineNumeric(citations);
}

/* ── New author helpers ── */

function fullAuthorListAnd(entry) {
  // "Surname, A., Surname, B. and Surname, C." — Harvard/Chicago style
  const auths = splitAuthors(entry.fields.author || '').map(initialsAndSurname);
  if (!auths.length) return splitAuthors(entry.fields.editor || '').map(initialsAndSurname).join(', ') + ' (eds)';
  if (auths.length === 1) return auths[0];
  if (auths.length === 2) return auths[0] + ' and ' + auths[1];
  return auths.slice(0, -1).join(', ') + ' and ' + auths[auths.length - 1];
}

function pnasAuthorList(entry) {
  // "Surname AB, Surname CD" — initials after surname, no periods in initials
  function pnasAuthor(chunk) {
    const m = chunk.match(/^\{(.+)\}$/);
    if (m) return m[1];
    if (chunk.includes(',')) {
      const [last, given] = chunk.split(',').map(s => s.trim());
      if (!given) return last;
      const initials = given.split(/\s+/).map(p => (p[0] || '').toUpperCase()).join('');
      return last + ' ' + initials;
    }
    const parts = chunk.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    const initials = parts.slice(0, -1).map(p => (p[0] || '').toUpperCase()).join('');
    return last + ' ' + initials;
  }
  const auths = splitAuthors(entry.fields.author || entry.fields.editor || '').map(pnasAuthor);
  if (!auths.length) return 'Anonymous';
  if (auths.length <= 5) return auths.join(', ');
  return auths.slice(0, 5).join(', ') + ', et al.';
}

function scienceAuthorList(entry) {
  // "A. Surname, B. Surname" — given initials before surname
  function sciAuth(chunk) {
    const m = chunk.match(/^\{(.+)\}$/);
    if (m) return m[1];
    if (chunk.includes(',')) {
      const [last, given] = chunk.split(',').map(s => s.trim());
      if (!given) return last;
      const initials = given.split(/\s+/).map(p => (p[0] || '').toUpperCase() + '.').join(' ');
      return initials + ' ' + last;
    }
    const parts = chunk.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    const initials = parts.slice(0, -1).map(p => (p[0] || '').toUpperCase() + '.').join(' ');
    return initials + ' ' + last;
  }
  const auths = splitAuthors(entry.fields.author || entry.fields.editor || '').map(sciAuth);
  if (!auths.length) return 'Anonymous';
  if (auths.length <= 5) return auths.join(', ');
  return auths.slice(0, 5).join(', ') + ', et al.';
}

/* ── New bibliography formatters ── */

export function formatBibliographyHarvard(entry) {
  // Harvard: Author (Year) Title. Journal, vol(no), pp. doi
  const f = entry.fields || {};
  const auth = fullAuthorListAnd(entry);
  const year = f.year || 'n.d.';
  const title = f.title || '(untitled)';
  let line = (auth ? auth + ' ' : '') + '(' + year + ') ' + endWithStop(title);

  if (entry.type === 'article') {
    if (f.journal) line += ' ' + italic(f.journal) + ',';
    if (f.volume)  line += ' ' + f.volume;
    if (f.number)  line += '(' + f.number + ')';
    if (f.pages)   line += ', pp. ' + f.pages.replace(/-/g, '–');
    line += '.';
  } else if (entry.type === 'book') {
    if (f.edition) line += ' ' + f.edition + ' edn.';
    if (f.publisher) line += ' ' + f.publisher + '.';
  } else if (entry.type === 'inbook' || entry.type === 'inproceedings') {
    if (f.editor) line += ' In: ' + splitAuthors(f.editor).map(initialsAndSurname).join(', ') + ' (eds)';
    if (f.booktitle) line += ' ' + italic(f.booktitle);
    if (f.pages) line += ', pp. ' + f.pages.replace(/-/g, '–');
    if (f.publisher) line += '. ' + f.publisher;
    line += '.';
  } else if (entry.type === 'thesis') {
    line += ' ' + (f.type || 'PhD thesis') + (f.school ? ', ' + f.school : '') + '.';
  }

  if (f.doi) line += ' doi:' + f.doi + '.';
  else if (f.url) line += ' Available at: ' + f.url;
  return line;
}

export function formatBibliographyChicago(entry) {
  // Chicago author-date: Author. Year. "Title." Journal vol, no. (year): pages. doi.
  const f = entry.fields || {};
  const auth = fullAuthorListAnd(entry);
  const year = f.year || 'n.d.';
  const title = f.title || '(untitled)';
  let line = (auth ? auth + '. ' : '') + year + '. "' + title.replace(/[.!?]$/, '') + '."';

  if (entry.type === 'article') {
    if (f.journal) line += ' ' + italic(f.journal);
    if (f.volume)  line += ' ' + f.volume;
    if (f.number)  line += ', no. ' + f.number;
    if (f.pages)   line += ': ' + f.pages.replace(/-/g, '–');
    line += '.';
  } else if (entry.type === 'book') {
    if (f.publisher) line += ' ' + f.publisher + '.';
  } else if (entry.type === 'inbook' || entry.type === 'inproceedings') {
    if (f.editor) line += ' In ' + splitAuthors(f.editor).map(initialsAndSurname).join(', ') + ', edited by ' + splitAuthors(f.editor).map(surnameOf).join(' and ') + '.';
    if (f.booktitle) line += ' ' + italic(f.booktitle);
    if (f.pages) line += ', ' + f.pages.replace(/-/g, '–');
    if (f.publisher) line += '. ' + f.publisher;
    line += '.';
  } else if (entry.type === 'thesis') {
    line += ' ' + (f.type || 'PhD diss.') + (f.school ? ', ' + f.school : '') + '.';
  }

  if (f.doi) line += ' https://doi.org/' + f.doi + '.';
  else if (f.url) line += ' ' + f.url + '.';
  return line;
}

export function formatBibliographyMla(entry) {
  // MLA 9: Author. "Title." Journal, vol. V, no. N, Year, pp. P–P.
  const f = entry.fields || {};
  const auths = splitAuthors(f.author || f.editor || '');
  let auth = '';
  if (auths.length === 1) {
    auth = initialsAndSurname(auths[0]);
  } else if (auths.length === 2) {
    auth = initialsAndSurname(auths[0]) + ', and ' + initialsAndSurname(auths[1]);
  } else if (auths.length > 2) {
    auth = initialsAndSurname(auths[0]) + ', et al.';
  }
  const title = f.title || '(untitled)';
  let line = (auth ? auth + '. ' : '');

  if (entry.type === 'book') {
    line += italic(title) + '.';
    if (f.publisher) line += ' ' + f.publisher + ',';
    if (f.year) line += ' ' + f.year + '.';
  } else {
    line += '"' + title.replace(/[.!?]$/, '') + '."';
    if (entry.type === 'article' && f.journal) {
      line += ' ' + italic(f.journal) + ',';
      if (f.volume) line += ' vol. ' + f.volume + ',';
      if (f.number) line += ' no. ' + f.number + ',';
      if (f.year)   line += ' ' + f.year + ',';
      if (f.pages)  line += ' pp. ' + f.pages.replace(/-/g, '–') + '.';
    } else if ((entry.type === 'inbook' || entry.type === 'inproceedings') && f.booktitle) {
      line += ' ' + italic(f.booktitle) + ',';
      if (f.editor) line += ' edited by ' + splitAuthors(f.editor).map(a => {
        const parts = a.split(',').map(s => s.trim());
        return parts.length === 2 ? parts[1] + ' ' + parts[0] : a;
      }).join(' and ') + ',';
      if (f.publisher) line += ' ' + f.publisher + ',';
      if (f.year) line += ' ' + f.year + ',';
      if (f.pages) line += ' pp. ' + f.pages.replace(/-/g, '–') + '.';
    } else {
      if (f.year) line += ' ' + f.year + '.';
    }
  }

  if (f.doi) line += ' DOI: ' + f.doi + '.';
  else if (f.url) line += ' ' + f.url + '.';
  return line.trim();
}

export function formatBibliographyCell(entry, ord) {
  // Cell Press: numbered, compact author list, title in sentence case, journal in italics
  const f = entry.fields || {};
  let line = ord + '. ' + compactAuthorList(entry) + ' (' + (f.year || 'n.d.') + '). ' + endWithStop(f.title || '(untitled)');
  const venue = f.journal || f.booktitle || '';
  if (venue) {
    line += ' ' + italic(venue);
    if (f.volume) line += ' ' + italic(f.volume);
    if (f.number) line += ', ' + f.number;
    if (f.pages)  line += ', ' + String(f.pages).replace(/-/g, '–');
    line += '.';
  } else if (f.publisher) {
    line += ' ' + f.publisher + '.';
  }
  if (f.doi) line += ' https://doi.org/' + f.doi + '.';
  else if (f.url) line += ' ' + f.url;
  return line;
}

export function formatBibliographyScience(entry, ord) {
  // Science/AAAS: N. A. Surname et al., Journal vol, pages (year).
  const f = entry.fields || {};
  let line = ord + '. ' + scienceAuthorList(entry) + ',';
  const venue = f.journal || f.booktitle || '';
  if (venue) {
    line += ' ' + italic(venue);
    if (f.volume) line += ' ' + f.volume;
    if (f.pages)  line += ', ' + String(f.pages).replace(/-/g, '–');
    if (f.year)   line += ' (' + f.year + ')';
    line += '.';
  } else {
    if (f.publisher) line += ' ' + f.publisher;
    if (f.year) line += ' (' + f.year + ')';
    line += '.';
  }
  if (f.doi) line += ' doi:' + f.doi + '.';
  return line;
}

export function formatBibliographyRsc(entry, ord) {
  // RSC/Wiley: N A. Surname, Journal, Year, vol, pages.
  const f = entry.fields || {};
  let line = ord + ' ' + compactAuthorList(entry) + ', ';
  const venue = f.journal || f.booktitle || '';
  if (venue) {
    line += italic(venue) + ', ' + (f.year || 'n.d.') + ', ' + (f.volume || '');
    if (f.pages) line += ', ' + String(f.pages).replace(/-/g, '–');
    line += '.';
  } else {
    line += endWithStop(f.title || '(untitled)');
    if (f.publisher) line += ' ' + f.publisher + ',';
    line += ' ' + (f.year || 'n.d.') + '.';
  }
  if (f.doi) line += ' DOI: ' + f.doi + '.';
  else if (f.url) line += ' ' + f.url;
  return line;
}

export function formatBibliographyPnas(entry, ord) {
  // PNAS: N. Surname AB, Surname CD (year) Title. Journal vol:pages.
  const f = entry.fields || {};
  let line = ord + '. ' + pnasAuthorList(entry) + ' (' + (f.year || 'n.d.') + ') ' + endWithStop(f.title || '(untitled)');
  const venue = f.journal || f.booktitle || '';
  if (venue) {
    line += ' ' + italic(venue);
    if (f.volume) line += ' ' + f.volume;
    if (f.pages)  line += ':' + String(f.pages).replace(/-/g, '–');
    line += '.';
  } else if (f.publisher) {
    line += ' ' + f.publisher + '.';
  }
  if (f.doi) line += ' https://doi.org/' + f.doi + '.';
  return line;
}

export function formatBibliographyElsevier(entry, ord) {
  // Elsevier: [N] Author, Title, Journal Vol (Year) pages. doi.
  const f = entry.fields || {};
  let line = '[' + ord + '] ' + compactAuthorList(entry) + ', ' + endWithStop(f.title || '(untitled)');
  const venue = f.journal || f.booktitle || '';
  if (venue) {
    line += ' ' + italic(venue) + ' ' + (f.volume || '');
    if (f.year) line += ' (' + f.year + ')';
    if (f.pages) line += ' ' + String(f.pages).replace(/-/g, '–');
    line += '.';
  } else if (f.publisher || f.year) {
    line += ' ' + [f.publisher, f.year].filter(Boolean).join(', ') + '.';
  }
  if (f.doi) line += ' https://doi.org/' + f.doi + '.';
  else if (f.url) line += ' ' + f.url;
  return line;
}

/* ── Style registry ── */
export const STYLES = {
  'author-year': {
    label: 'APA 7 / author-year',
    inline: formatInlineAuthorYear,
    bib: formatBibliographyAuthorYear,
    sortBibBy: 'author',
  },
  'harvard': {
    label: 'Harvard / author-date',
    inline: formatInlineHarvard,
    bib: formatBibliographyHarvard,
    sortBibBy: 'author',
  },
  'chicago': {
    label: 'Chicago / author-date',
    inline: formatInlineChicago,
    bib: formatBibliographyChicago,
    sortBibBy: 'author',
  },
  'mla': {
    label: 'MLA 9 / humanities',
    inline: formatInlineMla,
    bib: formatBibliographyMla,
    sortBibBy: 'author',
  },
  'numeric': {
    label: 'IEEE / numeric',
    inline: formatInlineNumeric,
    bib: formatBibliographyNumeric,
    sortBibBy: 'order',
  },
  'nature': {
    label: 'Nature / numbered',
    inline: formatInlineNumeric,
    bib: formatBibliographyNature,
    sortBibBy: 'order',
  },
  'science': {
    label: 'Science (AAAS) / numbered',
    inline: formatInlineNumeric,
    bib: formatBibliographyScience,
    sortBibBy: 'order',
  },
  'cell': {
    label: 'Cell Press / numbered',
    inline: formatInlineNumeric,
    bib: formatBibliographyCell,
    sortBibBy: 'order',
  },
  'pnas': {
    label: 'PNAS / numbered',
    inline: formatInlineNumeric,
    bib: formatBibliographyPnas,
    sortBibBy: 'order',
  },
  'vancouver': {
    label: 'Vancouver / biomedical',
    inline: formatInlineNumeric,
    bib: formatBibliographyVancouver,
    sortBibBy: 'order',
  },
  'elsevier': {
    label: 'Elsevier / numbered',
    inline: formatInlineElsevier,
    bib: formatBibliographyElsevier,
    sortBibBy: 'order',
  },
  'rsc': {
    label: 'RSC / Wiley chemistry',
    inline: formatInlineNumeric,
    bib: formatBibliographyRsc,
    sortBibBy: 'order',
  },
  'acs': {
    label: 'ACS / chemistry',
    inline: formatInlineAcs,
    bib: formatBibliographyAcs,
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
