// RIS exporter. RIS is what EndNote, Mendeley, and most journal
// submission systems consume on the import side. The format is
// "TY  - JOUR\nAU  - …\n…\nER  - " with two spaces around the dash.

const TYPE_RIS = {
  article:       'JOUR',
  book:          'BOOK',
  inbook:        'CHAP',
  inproceedings: 'CONF',
  thesis:        'THES',
  techreport:    'RPRT',
  online:        'ELEC',
  presentation:  'GEN',
  dataset:       'DATA',
  misc:          'GEN',
};

export function emitRisEntry(entry) {
  const f = entry.fields || {};
  const lines = [];
  lines.push('TY  - ' + (TYPE_RIS[entry.type] || 'GEN'));
  if (entry.citekey) lines.push('ID  - ' + entry.citekey);

  // Authors — split BibTeX "First and Second" form
  const authors = (f.author || '').split(/\s+and\s+/i).filter(Boolean);
  for (const a of authors) lines.push('AU  - ' + a);
  const editors = (f.editor || '').split(/\s+and\s+/i).filter(Boolean);
  for (const e of editors) lines.push('A2  - ' + e);

  if (f.title)     lines.push('TI  - ' + f.title);
  if (f.journal)   lines.push('JO  - ' + f.journal);
  if (f.booktitle) lines.push('T2  - ' + f.booktitle);
  if (f.publisher) lines.push('PB  - ' + f.publisher);
  if (f.address)   lines.push('CY  - ' + f.address);
  if (f.year)      lines.push('PY  - ' + f.year);

  // Pages — try to split a range into SP/EP, else just SP
  if (f.pages) {
    const m = String(f.pages).match(/^\s*(\d+)\s*[-–—]+\s*(\d+)\s*$/);
    if (m) { lines.push('SP  - ' + m[1]); lines.push('EP  - ' + m[2]); }
    else { lines.push('SP  - ' + f.pages); }
  }

  if (f.volume) lines.push('VL  - ' + f.volume);
  if (f.number) lines.push('IS  - ' + f.number);
  if (f.edition) lines.push('ET  - ' + f.edition);
  if (f.isbn)   lines.push('SN  - ' + f.isbn);
  if (f.doi)    lines.push('DO  - ' + f.doi);
  if (f.url)    lines.push('UR  - ' + f.url);
  if (f.abstract) lines.push('AB  - ' + f.abstract.replace(/\n/g, ' '));
  if (f.note)   lines.push('N1  - ' + f.note.replace(/\n/g, ' '));
  if (entry.notes) lines.push('N1  - ' + String(entry.notes).replace(/\n/g, ' '));

  for (const tag of entry.tags || []) lines.push('KW  - ' + tag);

  lines.push('ER  - ');
  return lines.join('\n');
}

export function emitRis(entries) {
  return entries.map(emitRisEntry).join('\n\n') + '\n';
}
