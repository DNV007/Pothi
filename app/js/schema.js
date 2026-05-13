// Schema as plain config. Edit this file to add entry types, fields, or
// rename labels. The UI reads from here at render time — no plugins, no
// build step. Mirrors BibLaTeX's notion of required vs optional fields.
//
// Each entry stored in IndexedDB has shape:
//   { id, type, citekey, fields: {...}, tags: [...], collections: [...],
//     files: [...], notes: '', createdAt, updatedAt }
// where `type` references ENTRY_TYPES[type] and `fields` is a free-form
// map keyed by FIELDS[name].

export const ENTRY_TYPES = {
  article: {
    label: 'Article',
    bibtex: 'article',
    desc: 'Journal article',
    required: ['author', 'title', 'journal', 'year'],
    optional: ['volume', 'number', 'pages', 'month', 'doi', 'url', 'note', 'abstract'],
  },
  book: {
    label: 'Book',
    bibtex: 'book',
    desc: 'Book or monograph',
    required: ['author', 'title', 'publisher', 'year'],
    optional: ['editor', 'volume', 'edition', 'series', 'address', 'month', 'isbn', 'url', 'note'],
  },
  inbook: {
    label: 'Book chapter',
    bibtex: 'inbook',
    desc: 'Chapter or section in a book',
    required: ['author', 'title', 'booktitle', 'publisher', 'year'],
    optional: ['editor', 'chapter', 'pages', 'volume', 'edition', 'address', 'month', 'isbn', 'url', 'note'],
  },
  inproceedings: {
    label: 'Conference paper',
    bibtex: 'inproceedings',
    desc: 'Paper in conference proceedings',
    required: ['author', 'title', 'booktitle', 'year'],
    optional: ['editor', 'volume', 'pages', 'organization', 'publisher', 'address', 'month', 'doi', 'url', 'note'],
  },
  thesis: {
    label: 'Thesis',
    bibtex: 'phdthesis',
    desc: 'PhD or master’s thesis',
    required: ['author', 'title', 'school', 'year'],
    optional: ['type', 'address', 'month', 'note', 'url'],
  },
  techreport: {
    label: 'Technical report',
    bibtex: 'techreport',
    desc: 'Tech report or preprint',
    required: ['author', 'title', 'institution', 'year'],
    optional: ['type', 'number', 'address', 'month', 'doi', 'url', 'note'],
  },
  online: {
    label: 'Web page',
    bibtex: 'misc',
    desc: 'Online resource (uses @misc with howpublished)',
    required: ['title', 'url'],
    optional: ['author', 'year', 'month', 'urldate', 'note'],
  },
  presentation: {
    label: 'Presentation',
    bibtex: 'misc',
    desc: 'Talk, slides, or poster',
    required: ['author', 'title', 'year'],
    optional: ['howpublished', 'organization', 'address', 'month', 'url', 'note'],
  },
  dataset: {
    label: 'Dataset',
    bibtex: 'misc',
    desc: 'Dataset, software, or model',
    required: ['author', 'title', 'year'],
    optional: ['publisher', 'version', 'doi', 'url', 'note'],
  },
  misc: {
    label: 'Misc',
    bibtex: 'misc',
    desc: 'Anything else',
    required: ['title'],
    optional: ['author', 'howpublished', 'month', 'year', 'note', 'url'],
  },
};

// Field metadata. `type` drives the input control and the citekey/sort behavior.
// Add a new field by adding an entry below and naming it in ENTRY_TYPES.
export const FIELDS = {
  author:       { type: 'authors', label: 'Author(s)', desc: 'Use "Lastname, First" separated by " and "' },
  editor:       { type: 'authors', label: 'Editor(s)' },
  title:        { type: 'string',  label: 'Title' },
  journal:      { type: 'string',  label: 'Journal' },
  booktitle:    { type: 'string',  label: 'Book / proceedings title' },
  publisher:    { type: 'string',  label: 'Publisher' },
  school:       { type: 'string',  label: 'School / institution' },
  institution:  { type: 'string',  label: 'Institution' },
  organization: { type: 'string',  label: 'Organization' },
  address:      { type: 'string',  label: 'Address' },
  series:       { type: 'string',  label: 'Series' },
  volume:       { type: 'string',  label: 'Volume' },
  number:       { type: 'string',  label: 'Number / issue' },
  edition:      { type: 'string',  label: 'Edition' },
  chapter:      { type: 'string',  label: 'Chapter' },
  pages:        { type: 'string',  label: 'Pages',  desc: 'e.g. 123–135' },
  year:         { type: 'year',    label: 'Year' },
  month:        { type: 'month',   label: 'Month' },
  type:         { type: 'string',  label: 'Type',   desc: 'e.g. "PhD thesis", "preprint"' },
  isbn:         { type: 'string',  label: 'ISBN' },
  doi:          { type: 'doi',     label: 'DOI' },
  url:          { type: 'url',     label: 'URL' },
  urldate:      { type: 'date',    label: 'Accessed' },
  howpublished: { type: 'string',  label: 'How published' },
  note:         { type: 'text',    label: 'Note' },
  abstract:     { type: 'text',    label: 'Abstract' },
};

// Default citekey template. Edit to taste. Tokens:
//   {author1}    surname of first author, lowercased, ASCII-folded
//   {AuthorN}    surname-cap variant
//   {year}       4-digit year (or 'nd' if none)
//   {short}      shortened year (last 2 digits)
//   {title3}     first 3 alpha-only words of title, capitalized, joined
//   {title-slug} kebab-cased title, max 30 chars
//   {journal3}   first 3 chars of journal, lowercase
//   {venue}      compact journal/booktitle abbreviation, e.g. PRL, JACS, CGD
export const CITEKEY_TEMPLATE = '{Author1}{year}{venue}';

// Default sort order in the list view
export const DEFAULT_SORT = { field: 'fields.year', direction: 'desc' };
