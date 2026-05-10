// PDF metadata extractor. Given a File, returns a small descriptor:
//   { doi?, arxivId?, title?, author?, abstract?, pages, source }
// `source` reports where each non-null piece came from
// (`text`/`info`/`xmp`) so callers can choose how much to trust.
//
// Strategy:
//   1. Use PDF.js to grab embedded metadata (XMP + Info dict).
//   2. Pull text content from the first three pages. That's where the
//      DOI sits in 99% of journal articles. Larger PDFs cost too much
//      to read fully in-browser; if the DOI isn't there it usually
//      isn't anywhere.
//   3. Run regexes for DOI and arXiv ID.

import * as pdfjsLib from '../vendor/pdf.min.mjs';

// Worker URL. PDF.js requires this be a fully resolvable path; we point
// it at the same vendor folder we're loaded from.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const DOI_RE = /\b10\.\d{4,9}\/[^\s"<>'(){},;]{2,}/i;
// Stricter end character set: DOIs end on alphanumerics or a few
// punctuation chars but commonly get glued to ',' '.' ')' etc. in PDFs.
const DOI_TRAILING_PUNCT = /[.,);:!?]+$/;
const ARXIV_RE = /arXiv\s*:?\s*(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i;

export async function extractFromPdf(file, opts = {}) {
  const maxPages = opts.maxPages || 3;
  const out = { source: {}, pages: 0 };
  const buf = await file.arrayBuffer();
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({
      data: buf,
      // Quiet down PDF.js warnings about font subsets / cross-origin.
      verbosity: 0,
      isEvalSupported: false,
    }).promise;
  } catch (e) {
    throw new Error('Could not parse PDF: ' + (e.message || e));
  }
  out.pages = pdf.numPages;

  // 1) Embedded metadata
  try {
    const md = await pdf.getMetadata();
    const info = md && md.info || {};
    const xmp = md && md.metadata;   // XMP is a Metadata object with .get()
    const xmpGet = (k) => { try { return xmp && xmp.get && xmp.get(k); } catch (_) { return null; } };
    const xmpTitle    = xmpGet('dc:title');
    const xmpCreator  = xmpGet('dc:creator');
    const xmpDoi      = xmpGet('prism:doi') || xmpGet('xapMM:DocumentID') || xmpGet('xmp:Identifier');
    const xmpDesc     = xmpGet('dc:description');
    if (xmpTitle && !out.title) { out.title = String(xmpTitle).trim(); out.source.title = 'xmp'; }
    if (xmpCreator && !out.author) { out.author = String(xmpCreator).trim(); out.source.author = 'xmp'; }
    if (xmpDesc && !out.abstract) { out.abstract = String(xmpDesc).trim(); out.source.abstract = 'xmp'; }
    if (xmpDoi && !out.doi) {
      const m = String(xmpDoi).match(DOI_RE);
      if (m) { out.doi = stripTrailingPunct(m[0]); out.source.doi = 'xmp'; }
    }
    if (info.Title && !out.title) { out.title = String(info.Title).trim(); out.source.title = 'info'; }
    if (info.Author && !out.author) { out.author = String(info.Author).trim(); out.source.author = 'info'; }
  } catch (_) { /* metadata is optional */ }

  // 2) Text from the first N pages
  let fullText = '';
  for (let i = 1; i <= Math.min(maxPages, pdf.numPages); i++) {
    try {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map(it => ('str' in it) ? it.str : '').join(' ');
      fullText += '\n' + text;
    } catch (e) {
      // Skip a bad page; keep going
    }
  }

  // 3) DOI / arXiv detection
  if (!out.doi) {
    const m = fullText.match(DOI_RE);
    if (m) { out.doi = stripTrailingPunct(m[0]); out.source.doi = 'text'; }
  }
  const arxiv = fullText.match(ARXIV_RE);
  if (arxiv) { out.arxivId = arxiv[1]; out.source.arxivId = 'text'; }

  // 4) Heuristic title from text — only if we still don't have one. Take the
  //    first non-trivial line (skip "Open Access", page headers, journal
  //    banners, etc.). Imperfect; just a hint.
  if (!out.title) {
    const lines = fullText.split(/\n+/).map(l => l.trim()).filter(Boolean);
    for (const l of lines) {
      if (l.length < 20 || l.length > 240) continue;
      if (/^(www\.|http|doi:|copyright|published|received|accepted|received:|accepted:|vol\.\s|issue\s|journal of|©)/i.test(l)) continue;
      out.title = l.replace(/\s+/g, ' ');
      out.source.title = 'text';
      break;
    }
  }

  return out;
}

function stripTrailingPunct(doi) {
  return doi.replace(DOI_TRAILING_PUNCT, '');
}

// Extract just the DOI/arXiv ID from arbitrary text — useful for callers
// that already have text (e.g. clipboard paste, manual import).
export function findDoiInText(text) {
  const m = String(text || '').match(DOI_RE);
  return m ? stripTrailingPunct(m[0]) : null;
}
export function findArxivInText(text) {
  const m = String(text || '').match(ARXIV_RE);
  return m ? m[1] : null;
}
