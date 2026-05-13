# Pothi User Manual

Pothi is a local-first reference manager for research manuscripts. It keeps your global library searchable, but lets every manuscript maintain its own curated bibliography, citation rationale, BibTeX export, and CSL-JSON export in the same folder as the paper.

The running app also serves this manual from the sidebar **Manual** button, or directly at `http://127.0.0.1:8765/manual.html`.

## Contents

- [Install](#install)
- [What Pothi Manages](#what-pothi-manages)
- [First Launch](#first-launch)
- [Library Workflow](#library-workflow)
- [Manuscript Workflow](#manuscript-workflow)
- [DOCX Article Format Workflow](#docx-article-format-workflow)
- [Web Search](#web-search)
- [Citekeys](#citekeys)
- [Export and Backup](#export-and-backup)
- [Folder Linking](#folder-linking)
- [Word and Pandoc Notes](#word-and-pandoc-notes)
- [Troubleshooting](#troubleshooting)
- [Shortcuts](#shortcuts)

## Install

### Linux and macOS

Run the installer once from the project folder:

```sh
./install.sh
```

Then reload your shell or open a new terminal:

```sh
source ~/.zshrc
```

Start Pothi:

```sh
pothi
```

The installer creates:

- `~/.local/bin/pothi`
- Linux desktop launcher: `~/.local/share/applications/pothi.desktop`
- macOS launcher: `~/Applications/Pothi.command`

Useful commands:

```sh
pothi          # start server and open browser
pothi status   # show running state
pothi open     # open the running app
pothi stop     # stop the server
```

### Windows

Run:

```cmd
install.bat
```

The installer creates:

- `Pothi.cmd` on the Desktop
- `Pothi.cmd` in the Start Menu
- `Pothi Stop.cmd` for clean shutdown

If `dist\Pothi.exe` exists, the Windows launchers use it automatically. Otherwise Python 3 must be installed and available on PATH.

### Self-contained executable

To build a bundled executable:

```sh
python3 build_standalone.py
```

On Linux/macOS this creates:

```text
dist/Pothi
```

On Windows it creates:

```text
dist\Pothi.exe
```

After the bundled executable exists, rerun the installer once. The installed launchers will prefer the bundled executable automatically.

### No-install run

For a temporary run without installing:

```sh
cd app
python3 pothi_launcher.py start
```

Then open:

```text
http://127.0.0.1:8765/
```

## What Pothi Manages

Pothi has two related workspaces.

**Library**

The library is the full local database of references. It supports DOI/arXiv/ISBN lookup, PDF import, BibTeX import, web search, tags, notes, ratings, file attachments, and full-library export.

**Manuscripts**

A manuscript is a curated bibliography drawn from the library. Each manuscript has its own ordered citation list, per-citation rationale notes, export buttons, and optional linked folder. When a manuscript folder is linked, Pothi writes `references.bib` and `refs.json` into that folder.

## First Launch

Start Pothi with:

```sh
pothi
```

The app opens at:

```text
http://127.0.0.1:8765/
```

Pothi stores data locally in the browser's IndexedDB. If you link a folder, Pothi can also write portable files into that folder. This means your data is not tied to a cloud account.

Recommended first setup:

1. Open Pothi.
2. Click **Link a folder** in the sidebar if you use Chromium, Chrome, Edge, or Brave.
3. Import an existing `.bib`, drop PDFs, or add a DOI.
4. Create a manuscript from the sidebar.
5. Link the manuscript folder if you want automatic `references.bib` output.

## Library Workflow

![New reference modal][img-new-reference]

Use **+ Add reference** to create a record. The top field accepts:

- DOI, including DOI URLs such as `https://doi.org/10.xxxx/...`
- arXiv IDs such as `arXiv:2401.04088`
- ISBNs for books
- Manual metadata if lookup is unavailable

![Library detail panel][img-library-detail]

Click any row to open the detail panel. From there you can edit:

- Citekey
- Title
- Authors or editors
- Journal, booktitle, publisher, year, pages, DOI, URL, ISBN
- Abstract
- Tags and smart collection metadata
- Reading status, rating, and notes
- Attached files

Use the main toolbar to:

- Search the library
- Sort by year, author, title, rating, or citation count
- Search CrossRef and OpenAlex
- Import `.bib`
- Export the visible view as BibTeX
- Export the whole library
- Normalize citekeys
- Refresh missing metadata

## Manuscript Workflow

![Manuscript view][img-manuscript]

Create a manuscript with **+ New manuscript** in the sidebar. Opening a manuscript switches the center workspace into manuscript mode.

Manuscript mode includes:

- Direct DOI/arXiv/ISBN add and cite
- Web search with one-click add and cite
- BibTeX import into the manuscript
- Search across uncited library references
- Drag and drop from the library or sidebar
- Click-to-open detail panel for cited and uncited entries
- Per-citation rationale notes
- Citation order controls
- BibTeX export
- CSL-JSON export
- Citekey normalization
- Optional linked folder auto-export

To add a reference to a manuscript:

1. Open the manuscript.
2. Paste a DOI, DOI URL, arXiv ID, or ISBN in the direct capture field.
3. Click **+ Add & cite**.

To cite an existing library entry:

1. Open the manuscript.
2. Use the manuscript search field to filter uncited references.
3. Click the reference row to inspect details, or click **+ Cite** to add it.

To import a manuscript-specific `.bib`:

1. Open the manuscript.
2. Click **Import .bib**.
3. Pothi imports new references into the library and cites them in the manuscript.
4. Existing entries are deduplicated by normalized DOI and citekey.

To remove a reference from the manuscript, click the remove button on the cited row. This only removes it from the manuscript bibliography; it does not delete the library entry.

## DOCX Article Format Workflow

For manuscript writers using Microsoft Word or LibreOffice Writer, Pothi provides a DOCX-focused panel inside each manuscript.

Open a manuscript and use **DOCX article format** to choose the target style:

- APA / author-year
- IEEE / numeric
- Nature / numbered
- Vancouver / biomedical
- ACS / chemistry

Available actions:

- **Copy [@keys]** copies Word/Pandoc placeholders such as `[@Scheffler2022PRL; @Kresse1996PRB]`.
- **Copy citation** copies a formatted in-text citation in the selected article style.
- **Copy bibliography** copies the manuscript bibliography in the selected article style, ready to paste into a DOCX.
- **Format .docx** lets you choose a `.docx` file containing `[@citekey]` placeholders and downloads a formatted `-cited.docx` copy.

Recommended Word workflow:

1. Write the manuscript in `.docx`.
2. Insert citekey placeholders where citations belong, for example `[@Scheffler2022PRL]`.
3. Use **Copy bibliography** if you only need a paste-ready reference list.
4. Use **Format .docx** if you want Pothi to replace placeholders and append the bibliography automatically.

This works without Pandoc for the built-in styles. If a journal requires an exact CSL file, export `refs.json` and use Pandoc with the journal's `.csl` file.

## Web Search

![Search modal][img-search]

Use **Search web** from either the library or a manuscript. Pothi searches CrossRef and OpenAlex, merges duplicate results by DOI, and flags records already present in the library.

Search modes:

- **Auto-detect**: chooses author search for name-shaped queries and general search otherwise.
- **Anywhere**: searches broad metadata.
- **Author**: searches by author name.
- **Title**: searches title text.

Good examples:

```text
graphene field effect transistor
kanchan sarkar
Scheffler density functional theory
10.1103/PhysRevLett.129.042501
```

## Citekeys

Pothi generates compact citekeys in this form:

```text
SurnameYearVenueAbbrev
```

Examples:

```text
Scheffler2022PRL
Kresse1996PRB
Geim2004Science
Doe2020JACS
```

The generator uses:

- First author surname
- Publication year
- Journal or venue abbreviation
- Collision suffix only when needed

Use **Normalize citekeys** to rewrite older long keys into the compact form. Manuscript exports use the same citekeys as the library.

## Export and Backup

### Library export

From the library toolbar:

- **Export BibTeX** exports the current filtered view.
- **Export all** exports the full library.
- Bulk selection can export BibTeX, RIS, or CSL-JSON.

### Manuscript export

From a manuscript:

- **Export BibTeX** downloads that manuscript's bibliography.
- **Export CSL-JSON** downloads that manuscript's CSL data.
- Linked manuscript folders automatically receive `references.bib` and `refs.json`.

Typical manuscript folder:

```text
my-paper/
  draft.tex
  references.bib
  refs.json
  figures/
  notes/
```

LaTeX example:

```tex
\addbibresource{references.bib}
```

Pandoc example:

```sh
pandoc draft.md --bibliography=refs.json --citeproc -o draft.pdf
```

### Backup

If a library folder is linked, Pothi can write a plain JSON backup:

```text
_pothi-library.json
```

This is useful for Nextcloud, Dropbox, iCloud, Syncthing, git, or any folder-based backup workflow.

## Folder Linking

Folder linking uses the browser File System Access API. It works best in Chromium-based browsers:

- Chrome
- Chromium
- Edge
- Brave
- Opera

Firefox and Safari can still use the app, but they do not provide the same folder write permission. In those browsers, manual export still works.

If folder permission expires:

1. Click **Resume** in the sidebar.
2. Grant read/write access again.
3. Pothi resumes writing exports.

## Word and Pandoc Notes

Pothi is designed around portable bibliography files. For Word-style writing, keep citation markers such as:

```text
[@Scheffler2022PRL; @Kresse1996PRB]
```

Then use the exported BibTeX or CSL-JSON with Pandoc, Zotero, or another citation processor.

## Troubleshooting

### The app opens on the wrong port

The default port is:

```text
http://127.0.0.1:8765/
```

Older Pothi development builds may have used `8766`. Current launchers reclaim stale Pothi servers on the old port when safe.

### Start fresh

```sh
pothi stop
pothi
```

Then refresh the browser.

### Manual is not visible

Open:

```text
http://127.0.0.1:8765/manual.html
```

If it still does not appear, hard-refresh the browser tab.

### DOI lookup fails

Check:

- Internet connection
- DOI spelling
- Whether the DOI starts with `10.`
- Whether the DOI is inside a URL that has extra tracking text

Pothi accepts DOI URLs and pasted citation text, but publisher pages sometimes hide metadata. If lookup fails, create a manual entry and add the DOI field yourself.

### Drag and drop does not work

Use one of the non-drag paths:

- Open a manuscript and click **+ Cite** from the uncited library list.
- Paste DOI/arXiv/ISBN into the manuscript direct capture field.
- Import a `.bib` from inside the manuscript.

Drag and drop can be blocked by browser state, iframes, remote desktop sessions, or strict security settings, so every drag workflow has a button-based equivalent.

### BibTeX import creates duplicates

Pothi deduplicates strongest by normalized DOI, then citekey. If an old `.bib` has no DOI and inconsistent citekeys, import it, inspect duplicates, then normalize citekeys.

### Folder export does not update

Check:

1. Browser is Chromium-based.
2. Folder permission is still granted.
3. Manuscript has a linked folder.
4. The entry is cited in that manuscript.

Manual export buttons work even without folder linking.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `/` | Focus library search |
| `Esc` | Clear search, close detail, or back out |
| `Arrow Up` | Move selection up |
| `Arrow Down` | Move selection down |
| `Enter` | Open selected reference |

## Data Ownership

Pothi is local-first. Your data remains in browser storage and plain exported files. It does not require an account, hosted database, or cloud sync service.

Use your own sync layer if needed:

- Nextcloud
- Dropbox
- iCloud Drive
- Syncthing
- Git
- External disk backup

[img-new-reference]: manual-assets/01-new-reference-modal.png
[img-library-detail]: manual-assets/02-library-detail.png
[img-manuscript]: manual-assets/03-manuscript-view.png
[img-search]: manual-assets/04-search-modal.png
