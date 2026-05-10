## LinkedIn post — copy & paste

---

I built a reference manager.

The tools I had been using — Zotero, Mendeley, EndNote — treat your library as
one big pile and lock it inside their software. I wanted something different:
each paper I write owns its own bibliography file on disk, kept current as
I cite, and sitting next to my .tex source so my next pdflatex run picks it
up automatically.

So I built **Pothi** (पोथी, Sanskrit / Bengali for "manuscript / palm-leaf
book"). It runs entirely in your browser. The library lives as plain JSON in
a folder you choose. No account, no server, no subscription.

For LaTeX users:
• Link a manuscript folder. Cite \cite{Smith2024} as you normally would.
  Pothi keeps references.bib in that folder up-to-date — no export step,
  no plugin, no app running in the background. The .bib file is the
  contract; both Pothi and your TeX engine read and write it as plain text.

For Word users:
• Type [@SmithCrystal2024] in your document. Drag the docx onto Pothi.
  Out comes a polished version with formatted citations and a bibliography.
  No Pandoc install needed.

For everyone:
• Drop a PDF anywhere — DOI sniffed, CrossRef metadata fetched, entry
  created automatically.
• Drop PDFs into your linked folder via your file manager — Pothi scans
  on tab-focus, hash-deduped against your library so renames don't
  break links.
• Each manuscript is a first-class object with its own auto-syncing
  bibliography and per-citation rationale ("why is this cited?").

Honest limitations: Chromium-only for the folder features, no Word add-in,
no cloud sync (by design). This is a v0.1 — I'm the only maintainer; issue
triage may be slow. MIT-licensed, ~10k lines of code, small enough to fork.

📄 Manuscript: [arXiv link]
🛠 Code: [GitHub link]

If you write papers and the existing tools don't fit how *you* work,
give it a try. Feedback welcome.

#ResearchTools #ReferenceManager #AcademicWriting #OpenSource #LocalFirst

---

Notes:
- Replace [arXiv link] and [GitHub link] before posting.
- LinkedIn allows ~3000 chars; this post is ~1700.
- The single emoji line is fine; LinkedIn's algorithm doesn't penalize
  emojis at the document head and they help scannability.
- Tag a few colleagues who might use it. Personal tagging > public hashtag
  for first-day reach.
