# Pothi — design notes

Living document. The README explains *what* this is; this file
explains *why* certain trade-offs were taken so future passes can
rely on them.

## Tech stack — why HTML+CSS+JS

We considered Julia, Python, and a browser-only static site. The
browser path won because:

- Researcher-grade UIs in Julia mean Pluto / Genie / Makie, none of
  which feel native and all of which require shipping a runtime.
- Python with a Flask backend means launching a server and keeping it
  alive; the user has to remember a command. Acceptable but not
  elegant.
- Static-site HTML+CSS+JS is the only option that opens by clicking a
  bookmark. The File System Access API gives us real folder linking
  on Chromium browsers. IndexedDB gives us a database. PDF.js gives us
  preview without an external viewer.

The trade-off we accept: **opening a file in its system default app
isn't possible** from a sandboxed browser. We work around it with
inline preview (PDF.js) for PDFs and `file://` links (with the
browser's permission prompt) for everything else. If that becomes a
hard blocker, the migration to Tauri is bounded — UI code is already
HTML/CSS/JS.

## Framework — Preact + htm

Why not React?
- React's UMD bundle is ~140 KB minified (production). Preact is ~11 KB.
- We're not using anything React-specific that Preact 10 doesn't have.

Why not vanilla JS?
- The detail panel has lots of fields with two-way binding; reactive
  rerenders save real code.

Why htm and not JSX?
- JSX needs a build step. We don't want one. htm is a tagged-template
  library that gives us JSX-like syntax with no compilation: `html\`<App
  foo=${bar}/>\``.

## Data model

Each entry stored in IndexedDB:

```js
{
  id: 'r_<base36-time>_<rand>',     // stable random
  type: 'article',                  // → ENTRY_TYPES[type]
  citekey: 'Smith2024Crystal',      // BibTeX citekey, must be unique
  fields: {                         // per-type fields, free-form map
    author: 'Smith, John and Doe, Jane',
    title: 'Crystal engineering of …',
    year: 2024,
    journal: 'J. Am. Chem. Soc.',
    doi: '10.1021/jacs.4c.01234',
    abstract: '...'
    // user-defined custom fields here too
  },
  tags: ['polymorphism', 'crystallography'],
  collections: ['paper-XX'],        // future: manuscript IDs
  files: [                           // future: linked file pointers
    { kind: 'pdf', path: 'papers/Smith2024.pdf', sha256: '...', size: 1024000 }
  ],
  notes: 'Markdown notes here',
  createdAt: 1715000000000,
  updatedAt: 1715000000000,
}
```

The `files` array is the bridge to the linked-folder Phase 1: paths are
**relative to the linked folder root**, plus a content hash so renames
within the folder can re-anchor.

## Schema as config

`js/schema.js` is the single editable source of:
- entry types and their BibTeX equivalent (article ↔ @article)
- which fields are required vs optional per type
- field metadata (label, control type, hint text)
- the citekey template

To add a custom entry type: append to `ENTRY_TYPES`. To add a custom
field: append to `FIELDS` and reference its key in some entry type's
`required`/`optional` array.

Anything not in the schema still stores cleanly — entries can carry
arbitrary keys in `fields`, and the detail panel surfaces them under
"Custom fields" so they aren't lost.

## Citekey templates

Tokens are evaluated by `js/citekey.js`. `{Author1}` capitalizes,
`{author1}` lowercases, `{AUTHOR1}` uppercases. `{year}` is the year
(or `nd`). `{title3}` joins three significant words from the title.
Stop words (`the`, `a`, `an`, `of`, `for`, `to`, `and`, `in`, `on`,
`with`, `from`, `by`) are dropped from `{title3}` and `{title-slug}`.

On collision, `uniqueCitekey` appends `a`, `b`, `c`, … then numeric
suffixes if all 26 letters are taken.

## BibTeX I/O

The emitter is intentionally minimal: it preserves order (required
fields first, optional in schema order, custom fields last) and
escapes `\`, `%`, `#`. Unicode passes through unchanged — a properly
configured BibLaTeX project handles it natively.

The parser is a hand-rolled state machine: skips `@comment`, `@string`,
`@preamble`, balances `{}` properly, accepts `"`-quoted values too. It
doesn't try to interpret `@string` macro substitutions. If users have
heavy `@string`-using `.bib` files, we'll add macro expansion later.

## Folder layout decisions

- One file per concern: `db.js`, `schema.js`, `bibtex.js`, `citekey.js`.
- `app.js` is the only "framework" file — it imports everything else.
  Components live inline in `app.js` until any one passes ~120 LoC, at
  which point it gets extracted to `js/components/<Name>.js`.
- `vendor/` is committed (small, intentional dependency, no internet at
  runtime).

## What we deliberately skip in 0a

- **Folder linking.** Phase 1.
- **Manuscript model.** Phase 2.
- **DOI / arXiv / ISBN lookup.** Phase 3.
- **PDF preview / annotation extraction.** Phase 4.
- **Citation graph.** Phase 5.
- **Settings export/import.** When we add it, mirror Rohinal's
  `pm_v3_*` sweep pattern.
- **Onboarding tour.** Phase 5.
- **PWA install / offline cache.** Once we have a single-file build.

## Integration API (open by design)

Today `window.Pothi` exposes:

```ts
listEntries():    Promise<Entry[]>
putEntry(e):      Promise<Entry>
deleteEntry(id):  Promise<void>
emitBib(es):      string
parseBib(text):   { bibtype, citekey, fields }[]
generateCitekey(entry, template?): string
ENTRY_TYPES, FIELDS
```

Future additions:
- `getCollectionBib(collectionId)` — returns the curated `.bib` for a
  manuscript.
- `attachFile(entryId, file)` — uploads to the linked folder.
- `subscribe(event, handler)` — react to library changes.

A future Rohinal task could call `Pothi.listEntries({ tag: 'todo-read' })`
and surface unread papers as actionable items.

## Open questions

- **Sync between machines.** Out of scope for now. The plain-text-on-disk
  Phase 1 plus a regular Nextcloud / git workflow probably handles it.
  If conflicts get nasty we'll need a merge strategy.
- **Multi-window.** What happens if the user opens two browser tabs
  pointing at the same library? IndexedDB handles concurrent writes via
  transactions but the UI in one tab won't see the other's changes
  without a `BroadcastChannel`. Add when it bites.
- **PDF metadata extraction.** PDF.js can read embedded metadata
  (DOI is often in the page text or in XMP). Drag-drop → DOI sniff →
  CrossRef lookup → autofill is the goal for Phase 3.
