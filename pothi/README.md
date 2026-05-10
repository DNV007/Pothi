# Pothi

*your bibliography, in your folder.*

I built **Pothi** because my bibliography was living like a divorced uncle.

A little in Zotero.
A little in BibTeX.
A little in a PDF folder named `old`.
One citation was probably in my head, paying no rent.

Every paper had a home.
The figures had a home.
The draft had a home.

The references were couch-surfing.

So Pothi does one small thing: **it keeps a paper's bibliography with the paper.**

Drop in a DOI, arXiv ID, ISBN, URL, or PDF.
It fetches what it can, fills what it finds, and leaves you with a local `references.bib`.

Nothing mystical.
No cloud cathedral.
No plugin pageant.
No sync séance where three copies enter and one corrupted file leaves.

Just a manuscript and its sources in the same folder, pretending to be adults.

It also lets you write *why* a citation is there, which helps because *"I'll remember"* is academia's longest-running sitcom.

Pothi is local, legible, lightweight, and mildly judgmental.

---

## Install

The repo lays out cleanly: this README and the installers are at the top, the actual app lives in `app/`. Clone, run one script, breathe.

### Linux & macOS

```sh
git clone https://github.com/kanchansarkar/pothi
cd pothi
./install.sh
```

Reload your shell (or just open a new terminal), then:

```sh
pothi
```

Browser opens. You're in.

The installer drops a `pothi` script into `~/.local/bin`, adds a clickable launcher (Linux: search "Pothi" in your menu; macOS: Launchpad → Pothi.command), and prints exactly what it did so nothing is surprising later.

To stop the server: `pothi stop`. To check status: `pothi status`. To open an already-running tab: `pothi open`.

### Windows

```cmd
install.bat
```

Two launchers appear: `Pothi.bat` on the Desktop and another in your Start menu. Double-click either. Close the small "Pothi server" window in the taskbar to stop it. Requires Python 3 on PATH (Pothi rides on Python's built-in `http.server` — no Node, no npm, no node_modules graveyard).

### No-install option

Some people prefer no PATH ceremony. Cut the cake yourself:

```sh
cd app
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/` in a Chromium browser. Same Pothi, fewer footprints.

### Browser

Chrome, Edge, Brave, Opera, or any other Chromium descendant. Folder linking uses the File System Access API, which Firefox and Safari haven't shipped yet. Pothi runs in those too — you just won't get the live `references.bib` writeout.

---

## A typical day

1. **Click *Link folder*** in the sidebar. Pick where your PDFs and drafts live. Pothi remembers it across reloads.
2. **Drop a PDF** anywhere on the page. Pothi sniffs the DOI from the first few pages, calls CrossRef + OpenAlex, fills title / authors / abstract / citation count, and files the PDF away. Hash-deduped — drop the same PDF twice, get one entry.
3. **Click *+ Add reference*** to type a DOI, arXiv ID, ISBN, or URL. Same magic, fewer crumbs.
4. **Click *Search web…*** to find papers by keyword or author name. It auto-detects whether you typed a name. Type *"kanchan sarkar"* — get my papers. Type *"graphene field effect transistor"* — get the field. One click adds.
5. **Click *+ New manuscript*** in the sidebar. Each manuscript has its own folder, its own ordered bibliography, and a per-citation rationale field. Link the folder, and `references.bib` is written and kept current within ~4 seconds of every change. Your LaTeX `\addbibresource{references.bib}` Just Works.
6. **For Word**, sprinkle `[@Smith2024; @Jones2023]` into your `.docx`. Drop the file back on Pothi. You get `…-cited.docx` with formatted citations and a bibliography appended. No ribbon required. No restart required. No pact with a vendor required.

**Keyboard.** `↑/↓` walks the list, `Enter` selects, `/` jumps to search, `Esc` backs out. Delete sends a 10-second `Undo` toast (everyone deletes the wrong row eventually — denial is not a strategy).

**Library cleanup.** *Refresh missing metadata…* under the Export menu fills empty abstracts and citation counts across every entry with a DOI in one go. Run it once after importing an old `.bib` and watch a flat list of citekeys grow into a library with abstracts and impact numbers.

---

## What's in your folder

```
my-paper/
  draft.tex
  references.bib       ← Pothi keeps this current
  refs.json            ← same data in CSL-JSON, for Pandoc
  figures/
  draft.pdf

~/research/library/
  _pothi-library.json  ← whole library, plain JSON, recoverable
  Geim2004.pdf
  Bernstein2002.pdf
  ...
```

If Pothi disappears tomorrow, your data is still readable in any text editor, importable into anything that speaks BibTeX or CSL-JSON, and not held hostage by anyone's cloud.

---

## What Pothi does **not** do

The honest list, since the alternative is a sales pitch:

- **No live Microsoft Word add-in.** Drop your `.docx`, get `.docx` back. That is the whole pipeline.
- **Folder linking needs a Chromium-based browser.** Firefox and Safari work for browsing and editing; folder writeout is graceful-degraded.
- **No cloud sync.** Use Nextcloud, Dropbox, iCloud, git, whatever already syncs your project folder. Pothi syncs nothing for you on purpose.
- **No real-time multi-user editing.** Pothi is local-first, not Google-Docs-first.
- **Public metadata is occasionally a comedy.** CrossRef sometimes returns "Untitled" or off-cased authors; OpenAlex once thought I authored a paper on macrophages. Pothi makes editing easy.

---

## License

MIT. The full text is in `app/LICENSE`. Use it, fork it, fold it into a paper-airplane.

This is a **v0.1** release. I'm a researcher and the maintainer is just me. Issue triage may be slow. The code is small (~10k LoC) and readable, so feel free to fork.

Standing on the shoulders of [Preact](https://preactjs.com/), [htm](https://github.com/developit/htm), [PDF.js](https://mozilla.github.io/pdf.js/), [fflate](https://github.com/101arrowz/fflate), [CrossRef](https://www.crossref.org/), [OpenAlex](https://openalex.org/), [Semantic Scholar](https://www.semanticscholar.org/), [OpenLibrary](https://openlibrary.org/), and [Pandoc](https://pandoc.org/). Local-first framing influenced by Ink & Switch's [*Local-First Software*](https://www.inkandswitch.com/local-first/).

---

Use it if it saves you from bibliography badminton.
Share it if someone else's citations are also living in witness protection.
And if you like it, share it like you own it.

Less reference manager.
More reference manners.

— *Kanchan Sarkar*, 2026
