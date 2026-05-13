/* Fuzzy duplicate detection for the library.
 * ============================================================
 * Strict equality on DOI / ISBN catches obvious duplicates, but most
 * real dupes look like:
 *
 *   - same paper, one entry from preprint, one from journal
 *   - same paper, one with hyphenated DOI, one without
 *   - same paper, one imported from .bib, one from a PDF drop
 *   - same paper, one with full author list, one with "et al."
 *
 * The cheapest way to catch all of these is a normalized
 * (title + first-author surname + year) key. Two papers that share that
 * canonical key are duplicates 99% of the time. False positives — two
 * different papers with the same title and same first author in the
 * same year — are vanishingly rare; we surface a confirm prompt rather
 * than silently merging, so the user has the final say.
 */

/* Title normalized for matching: lowercased, every non-alphanumeric run
 * (hyphens, punctuation, smart quotes, em-dashes…) replaced with a
 * single space. So "Field-Effect, in atomically THIN carbon films."
 * and "Field effect in Atomically Thin Carbon Films" both produce
 * "field effect in atomically thin carbon films". */
function normTitle(t) {
  return String(t || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* All meaningful alphabetic tokens (>=2 chars, not stopwords) from an
 * author string, lowercased. Used as a fuzzy-author fingerprint: two
 * records match if they share at least one token. Shrugs off comma vs.
 * space, surname-first vs. given-first, "et al.", initials, dropped
 * middle names — "Novoselov, K. S." and "K. S. Novoselov" both produce
 * {novoselov}; "Wu, J." and "J. Wu" both produce {wu}. */
const NAME_STOPWORDS = new Set([
  'and','et','al','jr','sr','ii','iii','iv',
  'van','von','de','del','la','le','der','den','dos','das','di','du','el','los',
  'eds','ed','editor','editors',
]);
function nameTokens(authorString) {
  const out = new Set();
  if (!authorString) return out;
  for (const t of String(authorString).toLowerCase().split(/[^a-z]+/)) {
    if (t.length < 2) continue;
    if (NAME_STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

export function canonicalKey(entry) {
  const f = (entry && entry.fields) || {};
  const titleNorm = normTitle(f.title || '');
  if (!titleNorm || titleNorm.length < 6) return null;
  const year = String(f.year || '').trim().match(/\d{4}/)?.[0] || '';
  if (!year) return null;
  return titleNorm + '|' + year;
}

export function findFuzzyDuplicate(draft, entries) {
  if (!draft || !Array.isArray(entries) || !entries.length) return null;
  const draftDoi  = (draft.fields?.doi  || '').toLowerCase().trim();
  const draftIsbn = (draft.fields?.isbn || '').replace(/[\s-]/g, '').toLowerCase().trim();
  // Strict: DOI or ISBN match wins instantly.
  for (const e of entries) {
    if (draft.id && e.id === draft.id) continue;
    const eDoi  = (e.fields?.doi  || '').toLowerCase().trim();
    const eIsbn = (e.fields?.isbn || '').replace(/[\s-]/g, '').toLowerCase().trim();
    if (draftDoi  && eDoi  && draftDoi === eDoi)  return { match: e, reason: 'doi' };
    if (draftIsbn && eIsbn && draftIsbn === eIsbn) return { match: e, reason: 'isbn' };
  }
  // Fuzzy: canonical (normalized title + year) AND at least one shared
  // author token. The author-token guard prevents false positives on
  // generic short titles like "Editorial" or "Preface" that could
  // legitimately appear in the same year by different authors.
  const dk = canonicalKey(draft);
  if (!dk) return null;
  const draftAuthors = nameTokens(draft.fields?.author || draft.fields?.editor || '');
  for (const e of entries) {
    if (draft.id && e.id === draft.id) continue;
    const ek = canonicalKey(e);
    if (!ek || ek !== dk) continue;
    const eAuthors = nameTokens(e.fields?.author || e.fields?.editor || '');
    // If either side has no author info, accept on title+year alone —
    // we don't want to under-match. If both sides have author info,
    // require at least one shared token.
    if (draftAuthors.size === 0 || eAuthors.size === 0) return { match: e, reason: 'fuzzy' };
    for (const t of draftAuthors) if (eAuthors.has(t)) return { match: e, reason: 'fuzzy' };
  }
  return null;
}

/* Merge new field values into an existing entry. The existing entry's
 * values always win; the draft only fills empty slots. Tags merge as a
 * union (no duplicates). Files / notes / rating / reading status are
 * preserved on the existing entry. Returns the merged entry; the
 * caller still needs to persist it via putEntry. */
export function mergeFields(existing, draft) {
  const out = { ...existing };
  out.fields = { ...(existing.fields || {}) };
  for (const [k, v] of Object.entries(draft.fields || {})) {
    if (!v) continue;
    if (out.fields[k] && String(out.fields[k]).trim()) continue;
    out.fields[k] = v;
  }
  const tagSet = new Set([...(existing.tags || []), ...(draft.tags || [])]);
  out.tags = [...tagSet];
  return out;
}
