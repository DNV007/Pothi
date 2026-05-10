// External metadata lookup. Today: DOI via CrossRef. Future: arXiv,
// OpenLibrary (ISBN), Semantic Scholar.
//
// Returns an entry-shaped { type, fields } record that the caller can
// merge into a draft. CrossRef's CORS policy is open — the request runs
// directly from the browser.

import { ENTRY_TYPES } from './schema.js';

const CROSSREF_TYPE = {
  'journal-article':     'article',
  'book':                'book',
  'monograph':           'book',
  'edited-book':         'book',
  'reference-book':      'book',
  'book-chapter':        'inbook',
  'book-section':        'inbook',
  'book-part':           'inbook',
  'proceedings-article': 'inproceedings',
  'dissertation':        'thesis',
  'report':              'techreport',
  'report-component':    'techreport',
  'posted-content':      'techreport',
  'dataset':             'dataset',
  'standard':            'misc',
  'reference-entry':     'misc',
};

/* Pull a DOI out of an arbitrary string — full URL, journal page link,
 * pasted citation. Returns null if no DOI is present. Used by the
 * auto-fill input so users can paste any flavor of "where the paper
 * lives" and we extract the canonical identifier. */
export function extractDoiFromText(text) {
  if (!text) return null;
  const s = String(text);
  const direct = s.match(/\b10\.\d{4,9}\/[^\s"<>'(){},;]{2,}/i);
  if (direct) return direct[0].replace(/[.,);:!?]+$/, '');
  return null;
}

export async function fetchDoiMetadata(doi) {
  // Accept full URLs, "doi:" prefixes, raw DOIs, or any string with a
  // DOI embedded in it (journal page URLs etc).
  let cleaned = String(doi || '').trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  if (!/^10\.\d{4,9}\//.test(cleaned)) {
    const sniffed = extractDoiFromText(cleaned);
    if (sniffed) cleaned = sniffed;
  }
  if (!cleaned) throw new Error('Empty DOI');
  if (!/^10\.\d{4,9}\//.test(cleaned)) {
    throw new Error('"' + cleaned + '" does not look like a DOI (expected 10.xxxx/…)');
  }
  const url = 'https://api.crossref.org/works/' + encodeURIComponent(cleaned);
  let res;
  try {
    res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
  } catch (e) {
    throw new Error('Network error: ' + e.message);
  }
  if (res.status === 404) throw new Error('CrossRef: DOI not found');
  if (!res.ok) throw new Error('CrossRef returned ' + res.status);
  const json = await res.json();
  const msg = json && json.message;
  if (!msg) throw new Error('CrossRef response missing message');
  const entry = crossrefToEntry(msg);
  // Enrichment chain (each step soft-fails). We try OpenAlex first
  // because its CORS is reliable for browser fetches; Semantic Scholar
  // is increasingly blocked at the browser layer (rate-limit pages
  // strip CORS headers and surface as "Failed to fetch"), but where it
  // works it adds the influentialCitationCount metric that OpenAlex
  // doesn't carry, so we still try.
  try {
    const oa = await fetchOpenAlexMeta(cleaned);
    if (oa) {
      if (!entry.fields.abstract && oa.abstract) entry.fields.abstract = oa.abstract;
      if (typeof oa.citationCount === 'number') entry.fields.citationCount = String(oa.citationCount);
      if (oa.openAccessUrl && !entry.fields.url) entry.fields.url = oa.openAccessUrl;
    }
  } catch (_) { /* optional */ }
  try {
    const ss = await fetchSemanticScholarMeta(cleaned);
    if (ss) {
      if (!entry.fields.abstract && ss.abstract) entry.fields.abstract = ss.abstract;
      if (!entry.fields.citationCount && typeof ss.citationCount === 'number')
        entry.fields.citationCount = String(ss.citationCount);
      if (typeof ss.influentialCitationCount === 'number')
        entry.fields.influentialCitationCount = String(ss.influentialCitationCount);
    }
  } catch (_) { /* optional */ }
  return entry;
}

/* OpenAlex — abstract (as inverted index, reconstructed), citation
 * count, open-access URL. Browser-CORS-clean, free, no key. Returns
 * null on any failure. */
export async function fetchOpenAlexMeta(doi) {
  const url = 'https://api.openalex.org/works/' + encodeURIComponent('doi:' + doi) +
    '?select=cited_by_count,abstract_inverted_index,open_access';
  let res;
  try { res = await fetch(url); }
  catch (_) { return null; }
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json) return null;
  const out = {};
  const abs = reconstructAbstract(json.abstract_inverted_index);
  if (abs) out.abstract = abs;
  if (typeof json.cited_by_count === 'number') out.citationCount = json.cited_by_count;
  if (json.open_access && json.open_access.is_oa && json.open_access.oa_url) out.openAccessUrl = json.open_access.oa_url;
  return Object.keys(out).length ? out : null;
}

/* OpenAlex returns abstracts as an inverted index — { word: [pos, ...] }
 * — for licensing reasons. We reconstruct the linear text by placing
 * each word at its recorded position(s) and joining with spaces. */
function reconstructAbstract(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const words = [];
  let max = -1;
  for (const [word, positions] of Object.entries(inv)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      words[pos] = word;
      if (pos > max) max = pos;
    }
  }
  if (max < 0) return '';
  // Fill any gaps so .join doesn't produce 'undefined' entries
  for (let i = 0; i <= max; i++) if (words[i] == null) words[i] = '';
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

/* Semantic Scholar — abstract + citation counts. Open CORS, rate-
 * limited without an API key. We fetch both fields in one call so a
 * paper without an abstract still gives us its citation metric.
 * Returns { abstract?, citationCount?, influentialCitationCount? }. */
export async function fetchSemanticScholarMeta(doi) {
  const url = 'https://api.semanticscholar.org/graph/v1/paper/DOI:' +
    encodeURIComponent(doi) +
    '?fields=abstract,citationCount,influentialCitationCount';
  let res;
  try { res = await fetch(url); }
  catch (_) { return null; }
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json) return null;
  const out = {};
  if (typeof json.abstract === 'string' && json.abstract.trim())
    out.abstract = json.abstract.replace(/\s+/g, ' ').trim();
  if (typeof json.citationCount === 'number') out.citationCount = json.citationCount;
  if (typeof json.influentialCitationCount === 'number') out.influentialCitationCount = json.influentialCitationCount;
  return Object.keys(out).length ? out : null;
}
// Backwards-compat alias for the v1 enrichment hook
export async function fetchSemanticScholarAbstract(doi) {
  const m = await fetchSemanticScholarMeta(doi);
  return m && m.abstract ? m.abstract : null;
}

function crossrefToEntry(m) {
  const type = CROSSREF_TYPE[m.type] || 'misc';
  const fields = {};
  if (Array.isArray(m.title) && m.title[0]) fields.title = stripHtml(m.title[0]);
  if (Array.isArray(m.author) && m.author.length) {
    fields.author = m.author.map(formatAuthor).filter(Boolean).join(' and ');
  }
  if (Array.isArray(m.editor) && m.editor.length) {
    fields.editor = m.editor.map(formatAuthor).filter(Boolean).join(' and ');
  }
  const container = Array.isArray(m['container-title']) ? m['container-title'][0] : '';
  if (container) {
    if (type === 'inbook' || type === 'inproceedings') {
      fields.booktitle = container;
    } else {
      fields.journal = container;
    }
  }
  if (m.publisher) fields.publisher = m.publisher;
  if (m['publisher-location']) fields.address = m['publisher-location'];
  if (m.volume)  fields.volume  = String(m.volume);
  if (m.issue)   fields.number  = String(m.issue);
  if (m.page)    fields.pages   = String(m.page).replace(/-/g, '–');
  if (m.edition) fields.edition = String(m.edition);
  if (m.ISBN && m.ISBN.length) fields.isbn = m.ISBN[0];

  const dp = (m['published-print'] || m.issued || m['published-online'] || m.created || {})['date-parts'];
  if (Array.isArray(dp) && dp[0]) {
    if (dp[0][0]) fields.year = String(dp[0][0]);
    if (dp[0][1]) fields.month = monthName(dp[0][1]);
  }

  if (m.DOI) fields.doi = m.DOI;
  if (m.URL) fields.url = m.URL;
  if (m.abstract) fields.abstract = stripHtml(m.abstract);

  // CrossRef subject classifications → suggested tags. Many records have
  // none, but for the ones that do (most ACS, RSC, IEEE, Springer) this
  // gives instant, free auto-classification — "Catalysis", "Crystal
  // Engineering", etc.
  const tags = [];
  if (Array.isArray(m.subject)) {
    for (const s of m.subject) {
      const cleaned = String(s).trim();
      if (cleaned && !tags.includes(cleaned)) tags.push(cleaned);
    }
  }
  return { type, fields, tags };
}

/* ── arXiv lookup ─────────────────────────────────────────────────────
 * arXiv's own export API doesn't send CORS headers, so a browser can't
 * fetch it directly. We route through CrossRef using the arXiv DOI form
 * (10.48550/arXiv.<id>) — works for papers minted after Aug 2022. For
 * older preprints CrossRef returns 404; we surface a clear error then.
 * If the user wants to add a pre-2022 arXiv paper, they can paste the
 * abstract-page URL or the title manually and the entry will save. */
export async function fetchArxivMetadata(rawId) {
  const id = String(rawId || '').trim()
    .replace(/^arXiv:\s*/i, '')
    .replace(/v\d+$/, '');
  if (!id) throw new Error('Empty arXiv ID');
  // Bounce off CrossRef. The .toLowerCase() matters — CrossRef stores
  // the segment as 'arXiv.<id>' but accepts case-insensitively in URL.
  const arxivDoi = '10.48550/arXiv.' + id;
  try {
    const r = await fetchDoiMetadata(arxivDoi);
    // Force the type to techreport since CrossRef labels arXiv preprints
    // generically as 'posted-content' which we map to techreport already,
    // but we may also get 'misc'. Normalize.
    if (r.type === 'misc') r.type = 'techreport';
    if (!r.fields.url) r.fields.url = 'https://arxiv.org/abs/' + id;
    return r;
  } catch (e) {
    // Re-throw with arXiv-specific guidance so the UI can show useful help.
    throw new Error(
      'Could not look up arXiv:' + id + ' via CrossRef (' + e.message + '). ' +
      'arXiv’s own API is CORS-blocked from browsers. ' +
      'For pre-2022 preprints, paste the title and authors manually.'
    );
  }
}

function formatAuthor(a) {
  if (a.family && a.given) return a.family + ', ' + a.given;
  if (a.family)            return a.family;
  if (a.name)              return '{' + a.name + '}';   // organizational author
  return '';
}

function stripHtml(s) {
  return String(s)
    .replace(/<jats:[^>]+>|<\/jats:[^>]+>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

function monthName(n) {
  return ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][n - 1] || '';
}

/* ── Keyword web search ────────────────────────────────────────────────
 * Google Scholar has no public API and blocks browser fetches via CORS.
 * Web of Science is paywalled. The two CORS-clean, free, Scholar-grade
 * sources we can hit from a browser are CrossRef and OpenAlex.
 * Together they cover ~400M records, including most of what Google
 * Scholar surfaces. We hit both in parallel, dedupe by DOI (or
 * lowercased title when no DOI is present), and rank by OpenAlex
 * citation count then year. Each result has a `source` array so the
 * UI can show whether a paper was found in CrossRef, OpenAlex, or
 * both.
 *
 * (Semantic Scholar's browser API is increasingly CORS-blocked under
 * the unauthed rate limiter — rate-limit response pages strip CORS
 * headers and the browser surfaces them as "Failed to fetch". We keep
 * S2 as a soft-fail enrichment step inside fetchDoiMetadata only.)
 *
 * Returns: Array<SearchResult>
 *   SearchResult = {
 *     title, authors, year, venue, doi?, abstract?,
 *     citationCount?, influentialCitationCount?, openAccessUrl?,
 *     source: ['crossref'|'openalex', ...]
 *   }
 * The shape is flat for easy display; convert to a full entry via
 * `searchResultToEntry`.
 */
/* Detects "First Last" or "Last F." patterns. We use it to pick author
 * search automatically when the user types a person's name — otherwise
 * a query like "kanchan sarkar" matches every paper that mentions those
 * words anywhere, not papers they authored. */
export function looksLikeName(query) {
  const q = String(query || '').trim();
  if (!q) return false;
  // Split on whitespace AND commas, so "Sarkar, K." parses as a name.
  const tokens = q.split(/[\s,]+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  // alphabetic + accents + apostrophes + hyphens, optional trailing period (initials)
  const namePat = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\-'’]*\.?$/;
  if (!tokens.every(t => namePat.test(t))) return false;
  // Reject when any token is a research-prose keyword that often shows
  // up in 2-3-word title fragments.
  const stop = new Set([
    'the','of','in','on','and','for','with','from','to','an','a','is','are','was','were',
    'about','using','via','toward','towards','effect','effects','study','studies','review','analysis',
    'model','models','system','systems','method','methods','application','applications','approach',
    'theory','theoretical','quantum','classical','dynamics','kinetics','crystal','crystals',
  ]);
  if (tokens.some(t => stop.has(t.toLowerCase()))) return false;
  return true;
}

/* Modes:
 *   'auto'      → use 'author' if looksLikeName(query), else 'anywhere'
 *   'anywhere'  → general full-text search (CrossRef ?query, OpenAlex ?search)
 *   'author'    → author-name match (CrossRef ?query.author, OpenAlex filter)
 *   'title'     → title-only match  (CrossRef ?query.title,  OpenAlex filter)
 */
export async function searchWeb(query, limit = 25, mode = 'auto') {
  const q = String(query || '').trim();
  if (!q) return [];
  const resolvedMode = mode === 'auto' ? (looksLikeName(q) ? 'author' : 'anywhere') : mode;
  const settled = await Promise.allSettled([
    searchCrossRef(q, limit, resolvedMode),
    searchOpenAlex(q, limit, resolvedMode),
  ]);
  const cr = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const oa = settled[1].status === 'fulfilled' ? settled[1].value : [];
  const errors = [];
  const dropPrefix = (msg, prefix) => {
    const s = String(msg || 'failed');
    return s.startsWith(prefix) ? s : prefix + ': ' + s;
  };
  if (settled[0].status === 'rejected') errors.push(dropPrefix(settled[0].reason?.message, 'CrossRef'));
  if (settled[1].status === 'rejected') errors.push(dropPrefix(settled[1].reason?.message, 'OpenAlex'));

  const seen = new Map();
  const keyOf = (r) => (r.doi
    ? 'doi:' + r.doi.toLowerCase()
    : 't:' + (r.title || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80));
  for (const r of [...cr, ...oa]) {
    const k = keyOf(r);
    if (!seen.has(k)) { seen.set(k, r); continue; }
    const a = seen.get(k);
    seen.set(k, mergeResults(a, r));
  }
  const out = [...seen.values()];
  out.sort((x, y) =>
    (y.citationCount || 0) - (x.citationCount || 0) ||
    (y.year || 0) - (x.year || 0) ||
    String(x.title || '').localeCompare(String(y.title || '')));
  // Stash any partial-failure messages and the resolved mode for the UI.
  if (errors.length) out._errors = errors;
  out._resolvedMode = resolvedMode;
  return out;
}

function mergeResults(a, b) {
  // Prefer non-empty fields from either; merge sources.
  const out = { ...a };
  for (const k of ['title','authors','year','venue','doi','abstract','citationCount','influentialCitationCount','openAccessUrl','type','tags']) {
    if ((out[k] == null || out[k] === '' || (Array.isArray(out[k]) && !out[k].length)) && b[k] != null && b[k] !== '') {
      out[k] = b[k];
    }
  }
  out.source = Array.from(new Set([...(a.source || []), ...(b.source || [])]));
  return out;
}

async function searchCrossRef(query, limit, mode = 'anywhere') {
  let qParam;
  if (mode === 'author') qParam = 'query.author=' + encodeURIComponent(query);
  else if (mode === 'title') qParam = 'query.title=' + encodeURIComponent(query);
  else qParam = 'query=' + encodeURIComponent(query);
  const url = 'https://api.crossref.org/works?' + qParam +
    '&rows=' + limit +
    '&select=DOI,title,author,issued,container-title,abstract,subject,type,page,volume,issue,publisher,URL';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('CrossRef returned ' + res.status);
  const json = await res.json();
  const items = json && json.message && Array.isArray(json.message.items) ? json.message.items : [];
  return items.map(crossrefSearchItem).filter(r => r.title);
}

function crossrefSearchItem(m) {
  const type = CROSSREF_TYPE[m.type] || 'misc';
  const title = Array.isArray(m.title) && m.title[0] ? stripHtml(m.title[0]) : '';
  const authors = Array.isArray(m.author) && m.author.length
    ? m.author.map(formatAuthor).filter(Boolean).join(' and ')
    : '';
  const venue = Array.isArray(m['container-title']) ? m['container-title'][0] : '';
  const dp = (m['published-print'] || m.issued || m['published-online'] || m.created || {})['date-parts'];
  const year = Array.isArray(dp) && dp[0] && dp[0][0] ? Number(dp[0][0]) : null;
  return {
    title,
    authors,
    year,
    venue: venue || '',
    doi: m.DOI || null,
    abstract: m.abstract ? stripHtml(m.abstract) : '',
    citationCount: null,
    influentialCitationCount: null,
    openAccessUrl: m.URL || null,
    type,
    tags: Array.isArray(m.subject) ? m.subject.map(s => String(s).trim()).filter(Boolean) : [],
    volume: m.volume ? String(m.volume) : '',
    pages: m.page ? String(m.page) : '',
    publisher: m.publisher || '',
    source: ['crossref'],
  };
}

/* OpenAlex search — has solid browser CORS, no key, no auth. Returns
 * up to `limit` works matching the query. */
async function searchOpenAlex(query, limit, mode = 'anywhere') {
  // OpenAlex filter values aren't standard URL params: commas / colons /
  // pipes are syntactic. We only escape the slashes and encode the user
  // text so a comma-bearing name wouldn't break the filter.
  const encoded = encodeURIComponent(query);
  let queryPart;
  if (mode === 'author')      queryPart = 'filter=raw_author_name.search:' + encoded;
  else if (mode === 'title')  queryPart = 'filter=title.search:' + encoded;
  else                        queryPart = 'search=' + encoded;
  const url = 'https://api.openalex.org/works?' + queryPart +
    '&per-page=' + Math.min(limit, 50) +
    '&select=id,doi,title,authorships,publication_year,primary_location,type,cited_by_count,abstract_inverted_index,open_access';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('OpenAlex returned ' + res.status);
  const json = await res.json();
  const items = json && Array.isArray(json.results) ? json.results : [];
  return items.map(openAlexSearchItem).filter(r => r.title);
}

const OPENALEX_TYPE = {
  'article': 'article',
  'journal-article': 'article',
  'review': 'article',
  'book': 'book',
  'book-chapter': 'inbook',
  'book-section': 'inbook',
  'book-part': 'inbook',
  'dissertation': 'thesis',
  'thesis': 'thesis',
  'report': 'techreport',
  'preprint': 'techreport',
  'posted-content': 'techreport',
  'conference-paper': 'inproceedings',
  'proceedings-article': 'inproceedings',
  'proceedings': 'inproceedings',
  'dataset': 'misc',
  'editorial': 'misc',
};

function openAlexSearchItem(p) {
  const title = String(p.title || '').replace(/\s+/g, ' ').trim();
  const authors = Array.isArray(p.authorships) ? p.authorships.map(a => {
    const name = a && a.author && a.author.display_name
      ? a.author.display_name
      : (a && a.raw_author_name) || '';
    if (!name) return '';
    if (name.includes(',')) return name.trim();   // already "Last, First"
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    const given = parts.slice(0, -1).join(' ');
    return last + ', ' + given;
  }).filter(Boolean).join(' and ') : '';
  const venue =
    (p.primary_location && p.primary_location.source && p.primary_location.source.display_name) ||
    (p.host_venue && p.host_venue.display_name) || '';
  const doi = p.doi ? String(p.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : null;
  const type = OPENALEX_TYPE[p.type] || 'article';
  const oaUrl = (p.open_access && p.open_access.is_oa && p.open_access.oa_url) ? p.open_access.oa_url : null;
  return {
    title,
    authors,
    year: p.publication_year || null,
    venue,
    doi,
    abstract: reconstructAbstract(p.abstract_inverted_index),
    citationCount: typeof p.cited_by_count === 'number' ? p.cited_by_count : null,
    influentialCitationCount: null,
    openAccessUrl: oaUrl,
    type,
    tags: [],
    source: ['openalex'],
  };
}

async function searchSemanticScholar(query, limit) {
  const url = 'https://api.semanticscholar.org/graph/v1/paper/search?query=' + encodeURIComponent(query) +
    '&limit=' + limit +
    '&fields=title,authors,year,venue,abstract,citationCount,influentialCitationCount,externalIds,openAccessPdf,publicationTypes';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Semantic Scholar returned ' + res.status);
  const json = await res.json().catch(() => null);
  const items = json && Array.isArray(json.data) ? json.data : [];
  return items.map(s2SearchItem).filter(r => r.title);
}

function s2SearchItem(p) {
  const authors = Array.isArray(p.authors) ? p.authors.map(a => {
    const name = a && a.name ? String(a.name).trim() : '';
    if (!name) return '';
    const parts = name.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return parts[parts.length - 1] + ', ' + parts.slice(0, -1).join(' ');
  }).filter(Boolean).join(' and ') : '';
  const doi = p.externalIds && p.externalIds.DOI ? p.externalIds.DOI : null;
  // Map S2 publicationTypes to our types where unambiguous.
  let type = 'article';
  if (Array.isArray(p.publicationTypes)) {
    if (p.publicationTypes.includes('Conference')) type = 'inproceedings';
    else if (p.publicationTypes.includes('Book')) type = 'book';
    else if (p.publicationTypes.includes('Thesis')) type = 'thesis';
    else if (p.publicationTypes.includes('Review') || p.publicationTypes.includes('JournalArticle')) type = 'article';
  }
  return {
    title: p.title || '',
    authors,
    year: p.year || null,
    venue: p.venue || '',
    doi,
    abstract: p.abstract ? String(p.abstract).replace(/\s+/g, ' ').trim() : '',
    citationCount: typeof p.citationCount === 'number' ? p.citationCount : null,
    influentialCitationCount: typeof p.influentialCitationCount === 'number' ? p.influentialCitationCount : null,
    openAccessUrl: p.openAccessPdf && p.openAccessPdf.url ? p.openAccessPdf.url : null,
    type,
    tags: [],
    source: ['s2'],
  };
}

/* Convert a flat SearchResult into the same { type, fields, tags } shape
 * that fetchDoiMetadata returns, so the caller can pipe it into the
 * regular "+ Add" path that EntryModal already uses. */
export function searchResultToEntry(r) {
  const fields = {};
  if (r.title)    fields.title = r.title;
  if (r.authors)  fields.author = r.authors;
  if (r.venue)    fields[(r.type === 'inproceedings' || r.type === 'inbook') ? 'booktitle' : 'journal'] = r.venue;
  if (r.year)     fields.year = String(r.year);
  if (r.volume)   fields.volume = r.volume;
  if (r.pages)    fields.pages = r.pages;
  if (r.doi)      fields.doi = r.doi;
  if (r.openAccessUrl) fields.url = r.openAccessUrl;
  if (r.abstract) fields.abstract = r.abstract;
  if (r.publisher) fields.publisher = r.publisher;
  if (typeof r.citationCount === 'number') fields.citationCount = String(r.citationCount);
  if (typeof r.influentialCitationCount === 'number') fields.influentialCitationCount = String(r.influentialCitationCount);
  return { type: r.type || 'article', fields, tags: Array.isArray(r.tags) ? r.tags.slice(0, 5) : [] };
}

/* ── ISBN lookup via OpenLibrary ──────────────────────────────────────
 * OpenLibrary's books API has open CORS, returns details inline (no
 * follow-up author fetches needed when jscmd=details). For ISBNs that
 * aren't in OpenLibrary, the function throws with a useful message
 * — most academic books published since the late 90s are present. */
export async function fetchIsbnMetadata(rawIsbn) {
  const isbn = String(rawIsbn || '').trim()
    .replace(/[\s-]/g, '')
    .replace(/^ISBN:?\s*/i, '');
  if (!/^(?:\d{9}[\dxX]|\d{13})$/.test(isbn)) {
    throw new Error('"' + isbn + '" does not look like an ISBN-10 or ISBN-13');
  }
  const url = 'https://openlibrary.org/api/books?bibkeys=ISBN:' + isbn + '&jscmd=details&format=json';
  let res;
  try { res = await fetch(url); }
  catch (e) { throw new Error('Network error: ' + e.message); }
  if (!res.ok) throw new Error('OpenLibrary returned ' + res.status);
  const json = await res.json();
  const wrapper = json['ISBN:' + isbn];
  if (!wrapper) throw new Error('OpenLibrary: ISBN ' + isbn + ' not found');
  const d = wrapper.details || {};
  const fields = {};
  if (d.title) fields.title = d.title + (d.subtitle ? ': ' + d.subtitle : '');
  if (Array.isArray(d.authors) && d.authors.length) {
    fields.author = d.authors.map(a => {
      const name = (a && a.name) ? a.name : (typeof a === 'string' ? a : '');
      if (!name) return '';
      // OpenLibrary returns "First Middle Last"; convert to BibTeX "Last, First"
      const parts = name.trim().split(/\s+/);
      if (parts.length === 1) return parts[0];
      const last = parts[parts.length - 1];
      const given = parts.slice(0, -1).join(' ');
      return last + ', ' + given;
    }).filter(Boolean).join(' and ');
  }
  if (Array.isArray(d.publishers) && d.publishers.length) {
    const p = d.publishers[0];
    fields.publisher = (p && p.name) || (typeof p === 'string' ? p : '');
  }
  if (d.publish_places && Array.isArray(d.publish_places) && d.publish_places.length) {
    const pl = d.publish_places[0];
    fields.address = (pl && pl.name) || (typeof pl === 'string' ? pl : '');
  }
  if (d.publish_date) {
    const m = String(d.publish_date).match(/\b(\d{4})\b/);
    if (m) fields.year = m[1];
  }
  if (d.number_of_pages) fields.pages = String(d.number_of_pages);
  if (d.identifiers) {
    if (d.identifiers.isbn_13 && d.identifiers.isbn_13[0]) fields.isbn = d.identifiers.isbn_13[0];
    else if (d.identifiers.isbn_10 && d.identifiers.isbn_10[0]) fields.isbn = d.identifiers.isbn_10[0];
    else fields.isbn = isbn;
  } else {
    fields.isbn = isbn;
  }
  if (wrapper.info_url) fields.url = wrapper.info_url;
  let tags = [];
  if (Array.isArray(d.subjects)) {
    tags = d.subjects.slice(0, 5).map(s => typeof s === 'string' ? s : (s && s.name)).filter(Boolean);
  }
  return { type: 'book', fields, tags };
}
