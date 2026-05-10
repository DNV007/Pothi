// Docx citation processor — Pandoc-bridge equivalent that runs entirely
// in the browser. Drop a docx with [@citekey] placeholders → get a docx
// back with the citations replaced by formatted text and a bibliography
// appended. No Pandoc install required.
//
// Supported placeholder syntax (intentionally a Pandoc subset):
//   [@key]              — basic citation
//   [@key1; @key2]      — multiple in one bracket
//   [@key, p. 42]       — with page locator (passed through as-is)
//
// Out of scope for this version (use the Pandoc bridge instead):
//   • narrative form @key (no brackets)
//   • [-@key] author-suppressed citations
//   • {.suppressed} / {.smart} pandoc-cite extensions
//   • foot-/endnotes
//   • full CSL — only author-year and numeric ship today

import { unzipSync, zipSync, strFromU8, strToU8 } from '../vendor/fflate.module.js';
import { STYLES } from './styles.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Citation bracket: [@key] or [@key1; @key2, p. 42]
const BRACKET_RE = /\[((?:@[^\]\s][^\]]*?))\]/g;
const PIECE_RE = /^\s*@([A-Za-z0-9_:][A-Za-z0-9_:.\-]*)\s*(?:,\s*(.+?))?\s*$/;

/* Find every citation bracket in a piece of plain text. */
function parseCitations(text) {
  const out = [];
  BRACKET_RE.lastIndex = 0;
  let m;
  while ((m = BRACKET_RE.exec(text)) !== null) {
    const inside = m[1];
    const cites = inside.split(';').map(p => {
      const pm = p.trim().match(PIECE_RE);
      if (!pm) return null;
      return { key: pm[1], suffix: pm[2] || null };
    });
    // Only accept brackets where every piece parsed
    if (cites.every(Boolean) && cites.length > 0) {
      out.push({ start: m.index, end: m.index + m[0].length, cites });
    }
  }
  return out;
}

/* Process a docx File object. Returns
 *   { blob, cited[], missing[], citedCount, totalCitations, paragraphsTouched }
 *
 * The library is the array of all entries from RefMgr; we look up by
 * citekey. Style is one of the keys in STYLES (defaults to author-year).
 */
export async function processDocx(file, library, opts = {}) {
  const styleName = opts.style && STYLES[opts.style] ? opts.style : 'author-year';
  const style = STYLES[styleName];

  const buf = new Uint8Array(await file.arrayBuffer());
  let zipped;
  try { zipped = unzipSync(buf); }
  catch (e) { throw new Error('Could not unzip docx — file may be corrupt: ' + e.message); }

  const xmlBytes = zipped['word/document.xml'];
  if (!xmlBytes) throw new Error('Not a docx file (missing word/document.xml).');
  const docXml = strFromU8(xmlBytes);
  const doc = new DOMParser().parseFromString(docXml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('document.xml is malformed.');

  const libByKey = new Map();
  for (const e of library || []) if (e.citekey) libByKey.set(e.citekey, e);

  const cited = [];                   // ordered unique entries (numeric assigns by here)
  const citedById = new Map();        // entry.id → 1-based ord
  const missing = new Set();
  let totalCitations = 0;
  let paragraphsTouched = 0;

  const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));
  for (const p of paragraphs) {
    const runs = Array.from(p.getElementsByTagNameNS(W_NS, 'r'));
    if (!runs.length) continue;
    let pText = '';
    for (const r of runs) {
      const ts = r.getElementsByTagNameNS(W_NS, 't');
      for (const t of ts) pText += t.textContent;
    }
    const cites = parseCitations(pText);
    if (!cites.length) continue;
    paragraphsTouched++;

    let cursor = 0;
    let newText = '';
    for (const c of cites) {
      newText += pText.slice(cursor, c.start);
      const resolved = c.cites.map(piece => {
        const e = libByKey.get(piece.key);
        if (!e) { missing.add(piece.key); return null; }
        let ord = citedById.get(e.id);
        if (!ord) {
          ord = cited.length + 1;
          cited.push(e);
          citedById.set(e.id, ord);
        }
        return { entry: e, suffix: piece.suffix, ord };
      });
      newText += style.inline(resolved);
      totalCitations += resolved.filter(Boolean).length;
      cursor = c.end;
    }
    newText += pText.slice(cursor);

    // Replace paragraph children: keep w:pPr (paragraph properties) if
    // present so alignment/style/list status survive. Drop run-level
    // formatting in the affected paragraph — acceptable trade-off for v1.
    const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0] || null;
    while (p.firstChild) p.removeChild(p.firstChild);
    if (pPr) p.appendChild(pPr);
    const newRun = doc.createElementNS(W_NS, 'w:r');
    const newT = doc.createElementNS(W_NS, 'w:t');
    newT.setAttribute('xml:space', 'preserve');
    newT.textContent = newText;
    newRun.appendChild(newT);
    p.appendChild(newRun);
  }

  // Append bibliography section
  if (cited.length > 0) {
    const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
    if (body) {
      // sectPr (section properties) must remain LAST in body. Detach,
      // append our content, then re-append it so the docx stays valid.
      const sectPr = body.getElementsByTagNameNS(W_NS, 'sectPr')[0] || null;
      if (sectPr && sectPr.parentNode === body) body.removeChild(sectPr);

      // "References" heading
      body.appendChild(makeHeading(doc, 'References'));

      // Sort the bibliography depending on style
      const ordered = (style.sortBibBy === 'author')
        ? [...cited].sort((a, b) => bibSortKey(a).localeCompare(bibSortKey(b)))
        : cited;

      ordered.forEach((entry, i) => {
        const ord = (style.sortBibBy === 'order') ? citedById.get(entry.id) : (i + 1);
        body.appendChild(makeBibParagraph(doc, style.bib(entry, ord)));
      });

      if (sectPr) body.appendChild(sectPr);
    }
  }

  // Serialize and rezip
  const newXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    new XMLSerializer().serializeToString(doc);
  const newZipped = Object.assign({}, zipped, { 'word/document.xml': strToU8(newXml) });
  const outBytes = zipSync(newZipped);

  return {
    blob: new Blob([outBytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    cited: cited.map(e => e.citekey),
    missing: Array.from(missing),
    citedCount: cited.length,
    totalCitations,
    paragraphsTouched,
    style: styleName,
  };
}

function bibSortKey(entry) {
  const author = (entry.fields.author || entry.fields.editor || 'zzz').toLowerCase();
  const year = entry.fields.year || '9999';
  return author + ' ' + year;
}

/* DOM helpers */
function makeHeading(doc, text) {
  const p = doc.createElementNS(W_NS, 'w:p');
  // Paragraph properties: bold, larger size, space-before
  const pPr = doc.createElementNS(W_NS, 'w:pPr');
  const spacing = doc.createElementNS(W_NS, 'w:spacing');
  spacing.setAttribute('w:before', '480');
  spacing.setAttribute('w:after', '120');
  pPr.appendChild(spacing);
  p.appendChild(pPr);

  const r = doc.createElementNS(W_NS, 'w:r');
  const rPr = doc.createElementNS(W_NS, 'w:rPr');
  rPr.appendChild(doc.createElementNS(W_NS, 'w:b'));
  const sz = doc.createElementNS(W_NS, 'w:sz');
  sz.setAttribute('w:val', '32');
  rPr.appendChild(sz);
  r.appendChild(rPr);

  const t = doc.createElementNS(W_NS, 'w:t');
  t.textContent = text;
  r.appendChild(t);
  p.appendChild(r);
  return p;
}

function makeBibParagraph(doc, line) {
  const p = doc.createElementNS(W_NS, 'w:p');
  const pPr = doc.createElementNS(W_NS, 'w:pPr');
  // Hanging indent — 720 twips (~0.5 in)
  const ind = doc.createElementNS(W_NS, 'w:ind');
  ind.setAttribute('w:left', '720');
  ind.setAttribute('w:hanging', '720');
  pPr.appendChild(ind);
  const spacing = doc.createElementNS(W_NS, 'w:spacing');
  spacing.setAttribute('w:after', '120');
  pPr.appendChild(spacing);
  p.appendChild(pPr);

  const r = doc.createElementNS(W_NS, 'w:r');
  const t = doc.createElementNS(W_NS, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.textContent = line;
  r.appendChild(t);
  p.appendChild(r);
  return p;
}
