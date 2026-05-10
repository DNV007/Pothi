// Smart collections — saved searches.
// Each collection has an `id`, a display `name`, and a `filter`
// object that's applied on top of the global view filters. Built-ins
// are non-editable and cover the most common research needs; users
// can save the current view as a custom collection.
//
// Filter shape (all fields optional):
//   search:           free text — matches title/author/journal/abstract/notes/tags
//   filterType:       entry-type id ('article' | 'book' | …)
//   shelf:            tag prefix (matches 'X' and 'X/...')
//   reading:          'unread' | 'reading' | 'read' | 'reviewing'
//   minRating:        1..5 — entries with rating >= minRating
//   missingFile:      true → only entries with NO attachments
//   missingAbstract:  true → only entries with no abstract field

export const BUILTIN_SMART = [
  { id: '_unread',      name: 'Unread',          builtin: true, filter: { reading: 'unread' } },
  { id: '_reading',     name: 'Reading now',     builtin: true, filter: { reading: 'reading' } },
  { id: '_top',         name: 'Top rated (5★)',  builtin: true, filter: { minRating: 5 } },
  { id: '_no_pdf',      name: 'No PDF attached', builtin: true, filter: { missingFile: true } },
  { id: '_no_abstract', name: 'Missing abstract',builtin: true, filter: { missingAbstract: true } },
];

/* Test whether a single entry matches a smart-collection filter. */
export function matchesSmart(entry, filter) {
  if (!filter) return true;
  if (filter.filterType && filter.filterType !== 'all' && entry.type !== filter.filterType) return false;
  if (filter.shelf) {
    const tags = entry.tags || [];
    const ok = tags.some(t => t === filter.shelf || t.startsWith(filter.shelf + '/'));
    if (!ok) return false;
  }
  if (filter.reading && (entry.reading || 'unread') !== filter.reading) return false;
  if (filter.minRating != null && (entry.rating || 0) < filter.minRating) return false;
  if (filter.missingFile && (entry.files && entry.files.length > 0)) return false;
  if (filter.missingAbstract && entry.fields && entry.fields.abstract) return false;
  if (filter.search) {
    const q = filter.search.toLowerCase();
    const f = entry.fields || {};
    const haystack = [
      entry.citekey,
      f.title, f.author, f.editor, f.journal, f.booktitle, f.abstract, f.note,
      entry.notes, (entry.tags || []).join(' ')
    ].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export function countMatching(entries, filter) {
  if (!filter) return entries.length;
  let n = 0;
  for (const e of entries) if (matchesSmart(e, filter)) n++;
  return n;
}

const STORAGE_KEY = 'refmgr_smart_collections';

export function loadCustomSmart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}
export function saveCustomSmart(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  catch (_) { /* quota — ignore */ }
}
