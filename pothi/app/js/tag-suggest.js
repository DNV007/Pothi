// TF-IDF tag suggestions. Given the library and a target entry,
// returns the top-N significant terms from the entry's title +
// abstract — judged "significant" by being uncommon across the rest
// of the library.
//
// Fast, in-memory. Recomputes the IDF on each call (cheap up to a few
// thousand entries). Cache later if it ever bites.

const STOP = new Set([
  'the','a','an','of','for','to','and','in','on','with','from','by','at','as','is','are','was','were',
  'be','been','being','this','that','these','those','it','its','their','his','her','they','we','us',
  'or','but','not','no','if','then','than','so','such','can','may','will','would','should','could',
  'have','has','had','do','does','did','done','also','using','use','used','via','based','some',
  'paper','study','present','propose','show','shows','shown','results','result','here','our',
  'one','two','three','first','second','well','more','most','many','much','several','various',
  'however','therefore','thus','also','only','very','where','when','which','what','who','how',
  'between','within','among','across','about','into','onto','upon','toward','towards',
  'data','method','methods','approach','approaches','model','models','case','cases','set',
  'figure','figures','table','tables','section','sections','appendix','reference','references',
  'introduction','conclusion','discussion','overview',
]);

// Tokenize → lowercased alphanumeric words ≥ 3 chars, dropping stopwords.
function tokens(s) {
  if (!s) return [];
  const out = [];
  const m = String(s).toLowerCase().match(/[a-z][a-z0-9\-]{2,}/g);
  if (!m) return [];
  for (const w of m) {
    const trimmed = w.replace(/^-+|-+$/g, '');
    if (trimmed.length < 3) continue;
    if (STOP.has(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

function entryText(e) {
  const f = e.fields || {};
  return [f.title, f.abstract, (e.tags || []).join(' '), f.journal, f.booktitle].filter(Boolean).join(' ');
}

// Returns { idf: Map<term, value>, N: total docs }
function buildIdf(entries) {
  const N = entries.length || 1;
  const df = new Map();
  for (const e of entries) {
    const seen = new Set();
    for (const t of tokens(entryText(e))) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const idf = new Map();
  for (const [t, count] of df) {
    // Smoothed IDF; common terms drop toward zero, rare ones rise.
    idf.set(t, Math.log((1 + N) / (1 + count)) + 1);
  }
  return { idf, N };
}

/* Public API
 *   suggestTags(entry, library, n=6) → string[]
 *
 * Existing tags on the entry are excluded from suggestions. Results are
 * Title-cased and de-duped against library-wide tags so the user sees
 * consistent labels.
 */
export function suggestTags(entry, library, n = 6) {
  if (!entry) return [];
  const corpus = (library || []).filter(e => e && e.fields);
  const { idf } = buildIdf(corpus);

  // Term frequency in the target entry (title weighted higher because
  // the title alone carries most of the topic signal)
  const titleTokens = tokens((entry.fields && entry.fields.title) || '');
  const otherTokens = tokens(
    [(entry.fields && entry.fields.abstract) || '',
     (entry.fields && entry.fields.journal) || '',
     (entry.fields && entry.fields.booktitle) || ''].join(' ')
  );
  const tf = new Map();
  for (const t of titleTokens) tf.set(t, (tf.get(t) || 0) + 3);  // 3× weight
  for (const t of otherTokens) tf.set(t, (tf.get(t) || 0) + 1);

  const scored = [];
  for (const [t, freq] of tf) {
    const i = idf.get(t) || Math.log((1 + corpus.length) / 1) + 1;  // unseen = max IDF
    scored.push({ term: t, score: freq * i });
  }
  scored.sort((a, b) => b.score - a.score);

  // Build a normalized set of tags already present — match case-insensitively
  const existing = new Set((entry.tags || []).map(t => t.toLowerCase()));

  // Map every library tag back to its display form for output normalization
  const libTagsByLower = new Map();
  for (const e of library || []) {
    for (const t of e.tags || []) libTagsByLower.set(t.toLowerCase(), t);
  }

  const out = [];
  for (const { term } of scored) {
    if (out.length >= n) break;
    if (existing.has(term)) continue;
    // If this term matches an existing library tag (case-insensitive),
    // surface the canonical form. Otherwise Title-case.
    const display = libTagsByLower.get(term) || titleCase(term);
    if (out.includes(display)) continue;
    out.push(display);
  }
  return out;
}

function titleCase(s) {
  return s.replace(/(^|[\s\-])(\w)/g, (_, sep, c) => sep + c.toUpperCase());
}
