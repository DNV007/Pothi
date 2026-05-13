// CSL-JSON (Citation Style Language JSON) exporter. This is the format
// Pandoc consumes via `--citeproc --bibliography refs.json`. Also what
// Zotero exports natively as "CSL JSON".
//
// Spec reference: https://github.com/citation-style-language/schema/blob/master/csl-data.json

const TYPE_CSL = {
  article:       'article-journal',
  book:          'book',
  inbook:        'chapter',
  inproceedings: 'paper-conference',
  thesis:        'thesis',
  techreport:    'report',
  online:        'webpage',
  presentation:  'speech',
  dataset:       'dataset',
  misc:          'document',
};

export function entryToCsl(entry) {
  const f = entry.fields || {};
  const out = {
    id: entry.citekey || entry.id,
    type: TYPE_CSL[entry.type] || 'document',
  };

  if (f.title) out.title = f.title;

  const authors = (f.author || '').split(/\s+and\s+/i).filter(Boolean).map(parseName);
  if (authors.length) out.author = authors;
  const editors = (f.editor || '').split(/\s+and\s+/i).filter(Boolean).map(parseName);
  if (editors.length) out.editor = editors;

  if (f.journal)   out['container-title'] = f.journal;
  else if (f.booktitle) out['container-title'] = f.booktitle;
  if (f.publisher) out.publisher = f.publisher;
  if (f.address)   out['publisher-place'] = f.address;
  if (f.volume)    out.volume = f.volume;
  if (f.number)    out.issue = f.number;
  if (f.pages)     out.page = String(f.pages).replace(/[-–—]+/g, '–');
  if (f.edition)   out.edition = f.edition;
  if (f.school)    out.publisher = f.school;
  if (f.institution) out.publisher = f.institution;
  if (f.isbn)      out.ISBN = f.isbn;
  if (f.doi)       out.DOI = f.doi;
  if (f.url)       out.URL = f.url;
  if (f.abstract)  out.abstract = f.abstract;

  if (f.year) {
    const y = parseInt(f.year, 10);
    if (!Number.isNaN(y)) out.issued = { 'date-parts': [[y]] };
  }
  if (f.note) out.note = f.note;
  else if (entry.notes) out.note = entry.notes;

  if (entry.tags && entry.tags.length) out.keyword = entry.tags.join(', ');
  return out;
}

function parseName(s) {
  s = s.trim();
  // Brace-protected literal name → treat as institutional
  if (/^\{.*\}$/.test(s)) return { literal: s.slice(1, -1) };
  if (s.includes(',')) {
    const [family, ...rest] = s.split(',');
    const given = rest.join(',').trim();
    return given ? { family: family.trim(), given } : { family: family.trim() };
  }
  // "Given Family" form: assume last token is family name
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { family: parts[0] };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
}

export function emitCsl(entries) {
  return JSON.stringify(entries.map(entryToCsl), null, 2);
}
