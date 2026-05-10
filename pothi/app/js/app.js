// RefMgr — Phase 0b.
// Entry CRUD, BibTeX import, multi-format export (BibTeX / RIS / CSL-JSON),
// DOI auto-fill via CrossRef, Pandoc workflow helper for docx writing.
//
// Layout: sidebar (entry-type filters) | toolbar + list | detail panel.

import { h, render } from 'preact';
import { useState, useEffect, useMemo, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { ENTRY_TYPES, FIELDS } from './schema.js';
import { listEntries, putEntry, deleteEntry, newId, bulkPut, listManuscripts, putManuscript, deleteManuscript, newManuscriptId } from './db.js';
import { manuscriptCitedEntries, citeInManuscript, uncite as uncite_, updateRationale, reorderCitation, writeManuscriptToFolder, buildManuscriptBib, buildManuscriptCsl } from './manuscripts.js';
import { emitBib, parseBib, bibtypeToType } from './bibtex.js';
import { generateCitekey, uniqueCitekey } from './citekey.js';
import { fetchDoiMetadata, fetchArxivMetadata, fetchIsbnMetadata, fetchSemanticScholarMeta, searchWeb, searchResultToEntry, extractDoiFromText, looksLikeName } from './lookup.js';
import { emitRis } from './export-ris.js';
import { emitCsl } from './export-csl.js';
import {
  isFsaSupported, pickFolder, getFolder, forgetFolder,
  checkFolderPermission, requestFolderPermission,
  pickFiles, attachFromHandle, openAttachedFile, fmtBytes,
  detectKind, hashFile, newFileId,
} from './folder.js';
import { extractFromPdf } from './pdf-extract.js';
import { suggestTags } from './tag-suggest.js';
import { processDocx } from './docx.js';
import { STYLES } from './styles.js';
import { collectPdfs, buildKnownHashIndex, dedupeByHash } from './folder-scan.js';
import { loadPdfFromFileMeta, renderPage } from './pdf-preview.js';
import { buildLibraryBackup, backupAsBlob, applyLibraryBackup, readBackupFromFolder, writeBackupToFolder } from './library-backup.js';
import { BUILTIN_SMART, matchesSmart, countMatching, loadCustomSmart, saveCustomSmart } from './smart-collections.js';
import { renderMarkdownInto } from './markdown.js';
import { findFuzzyDuplicate, mergeFields } from './dedup.js';

const html = htm.bind(h);

/* Per-entry-type tone (color + label + 4-char tag) used by the
   editorial row layout and detail eyebrow pill. */
const TYPE_TONE = {
  article:       { color: 'var(--tone-article)', label: 'Article',     short: 'ART' },
  inproceedings: { color: 'var(--tone-conf)',    label: 'Conference',  short: 'CONF' },
  inbook:        { color: 'var(--tone-book)',    label: 'Book chapter',short: 'CHAP' },
  incollection:  { color: 'var(--tone-book)',    label: 'In collection', short: 'COLL' },
  book:          { color: 'var(--tone-book)',    label: 'Book',        short: 'BOOK' },
  thesis:        { color: 'var(--tone-thesis)',  label: 'Thesis',      short: 'THES' },
  phdthesis:     { color: 'var(--tone-thesis)',  label: 'PhD thesis',  short: 'PHD'  },
  mastersthesis: { color: 'var(--tone-thesis)',  label: 'MSc thesis',  short: 'MSC'  },
  techreport:    { color: 'var(--tone-tech)',    label: 'Tech report', short: 'TECH' },
  manual:        { color: 'var(--tone-tech)',    label: 'Manual',      short: 'MAN'  },
  unpublished:   { color: 'var(--tone-tech)',    label: 'Preprint',    short: 'PREP' },
  misc:          { color: 'var(--tone-misc)',    label: 'Misc',        short: 'MISC' },
};
const toneFor = (type) => TYPE_TONE[type] || TYPE_TONE.misc;

/* Short author rendering: "Doe, J. and Smith, R." → "Doe & Smith"
   for one or two authors; "Doe et al." for three+. Used in the
   row-meta byline, where we want it tight. */
function shortAuthors(s) {
  if (!s) return '—';
  const parts = String(s).split(/\s+and\s+/i).map(a => a.trim()).filter(Boolean);
  const lastNames = parts.map(a => {
    if (a.includes(',')) return a.split(',')[0].trim();
    const toks = a.split(/\s+/);
    return toks[toks.length - 1];
  });
  if (lastNames.length === 0) return '—';
  if (lastNames.length === 1) return lastNames[0];
  if (lastNames.length === 2) return lastNames[0] + ' & ' + lastNames[1];
  return lastNames[0] + ' et al.';
}

/* ─── App ──────────────────────────────────────────────────────────── */
function App() {
  const [entries, setEntries] = useState([]);
  const [filterType, setFilterType] = useState('all');
  const [activeShelf, setActiveShelf] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('refmgr_sort') || 'year-desc');
  useEffect(() => { localStorage.setItem('refmgr_sort', sortBy); }, [sortBy]);
  const [customSmart, setCustomSmart] = useState(() => loadCustomSmart());
  useEffect(() => { saveCustomSmart(customSmart); }, [customSmart]);
  const [activeSmart, setActiveSmart] = useState(null);
  const allSmartCollections = useMemo(() => [...BUILTIN_SMART, ...customSmart], [customSmart]);

  // Manuscripts
  const [manuscripts, setManuscripts] = useState([]);
  const [activeManuscriptId, setActiveManuscriptId] = useState(null);
  useEffect(() => { listManuscripts().then(setManuscripts); }, []);
  const activeManuscript = useMemo(
    () => manuscripts.find(m => m.id === activeManuscriptId) || null,
    [manuscripts, activeManuscriptId]
  );

  const createManuscript = useCallback(async () => {
    const name = prompt('Name this manuscript:');
    if (!name || !name.trim()) return;
    const ms = {
      id: newManuscriptId(),
      name: name.trim(),
      folderHandle: null,
      cited: [],
      citationStyle: 'author-year',
    };
    const saved = await putManuscript(ms);
    setManuscripts(prev => [saved, ...prev]);
    setActiveManuscriptId(saved.id);
  }, []);

  const renameManuscript = useCallback(async (id) => {
    const ms = manuscripts.find(m => m.id === id);
    if (!ms) return;
    const name = prompt('Rename manuscript:', ms.name);
    if (!name || !name.trim()) return;
    const saved = await putManuscript({ ...ms, name: name.trim() });
    setManuscripts(prev => prev.map(m => m.id === id ? saved : m));
  }, [manuscripts]);

  const removeManuscript = useCallback(async (id) => {
    const ms = manuscripts.find(m => m.id === id);
    if (!ms) return;
    if (!confirm('Delete manuscript "' + ms.name + '"? Its references stay in the library; only this curated bibliography is removed.')) return;
    await deleteManuscript(id);
    setManuscripts(prev => prev.filter(m => m.id !== id));
    if (activeManuscriptId === id) setActiveManuscriptId(null);
  }, [manuscripts, activeManuscriptId]);

  const updateManuscript = useCallback(async (next) => {
    const saved = await putManuscript(next);
    setManuscripts(prev => prev.map(m => m.id === saved.id ? saved : m));
  }, []);

  const linkManuscriptFolder = useCallback(async (id) => {
    const ms = manuscripts.find(m => m.id === id);
    if (!ms) return;
    if (!isFsaSupported()) { alert('Folder linking requires Chrome / Edge / Brave.'); return; }
    try {
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
        id: 'refmgr-manuscript-' + id,
      });
      const next = { ...ms, folderHandle: handle };
      const saved = await putManuscript(next);
      setManuscripts(prev => prev.map(m => m.id === id ? saved : m));
      setToast('Linked folder: ' + handle.name);
    } catch (e) {
      if (e.name !== 'AbortError') alert('Could not link folder: ' + e.message);
    }
  }, [manuscripts]);

  // Auto-export: write references.bib + refs.json to the active
  // manuscript's folder on every change. Debounced 4 s.
  useEffect(() => {
    if (!activeManuscript || !activeManuscript.folderHandle) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      await writeManuscriptToFolder(activeManuscript, entries);
    }, 4000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [activeManuscript, entries]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [modal, setModal] = useState(null); // 'new' | 'editId' | null
  const [toast, setToast] = useState(null);
  const [accent, setAccent] = useState(() => localStorage.getItem('refmgr_accent') || 'brick');
  const [paper, setPaper] = useState(() => localStorage.getItem('pothi_paper') || 'warm');
  const [citationStyle, setCitationStyle] = useState(() => localStorage.getItem('refmgr_style') || 'author-year');
  useEffect(() => { localStorage.setItem('refmgr_style', citationStyle); }, [citationStyle]);
  const [folder, setFolder] = useState(null);
  const [folderPerm, setFolderPerm] = useState('unknown'); // 'granted'|'prompt'|'denied'|'unknown'
  // Library-wide metadata refresh progress. null when idle, otherwise
  // { current, total, label, cancel }.
  const [refreshProgress, setRefreshProgress] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
    localStorage.setItem('refmgr_accent', accent);
  }, [accent]);
  useEffect(() => {
    document.documentElement.setAttribute('data-paper', paper);
    localStorage.setItem('pothi_paper', paper);
  }, [paper]);

  // Initial load
  useEffect(() => { listEntries().then(setEntries); }, []);
  useEffect(() => {
    (async () => {
      const h = await getFolder();
      if (h) {
        setFolder(h);
        setFolderPerm(await checkFolderPermission(h));
      }
    })();
  }, []);

  /* Folder linking ----------------------------------------------------- */
  const linkFolder = useCallback(async () => {
    try {
      const h = await pickFolder();
      setFolder(h);
      setFolderPerm(await checkFolderPermission(h));
      setToast('Linked folder: ' + (h.name || 'library'));
    } catch (e) {
      if (e.name !== 'AbortError') alert('Folder link failed: ' + e.message);
    }
  }, []);
  const unlinkFolder = useCallback(async () => {
    if (!confirm('Unlink the library folder? Existing file attachments stay on entries but won\'t default to this folder anymore.')) return;
    await forgetFolder();
    setFolder(null);
    setFolderPerm('unknown');
    setToast('Folder unlinked.');
  }, []);
  const ensureFolderPerm = useCallback(async () => {
    if (!folder) return false;
    const p = await checkFolderPermission(folder);
    if (p === 'granted') { setFolderPerm('granted'); return true; }
    const r = await requestFolderPermission(folder);
    setFolderPerm(r);
    return r === 'granted';
  }, [folder]);

  /* File attachments --------------------------------------------------- */
  const attachFilesToEntry = useCallback(async (entryId) => {
    let folderHandle = folder;
    if (folderHandle) {
      // Need permission to use as `startIn`
      const ok = await ensureFolderPerm();
      if (!ok) folderHandle = null;
    }
    let handles;
    try { handles = await pickFiles(folderHandle); }
    catch (e) {
      if (e.name === 'AbortError') return;
      alert('Could not pick files: ' + e.message);
      return;
    }
    const newAttachments = [];
    for (const h of handles) {
      try { newAttachments.push(await attachFromHandle(h)); }
      catch (e) { console.warn('Failed to attach', h.name, e); }
    }
    if (!newAttachments.length) return;
    setEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      const merged = { ...e, files: [...(e.files || []), ...newAttachments] };
      // Persist
      putEntry(merged);
      return merged;
    }));
    setToast('Attached ' + newAttachments.length + ' file' + (newAttachments.length === 1 ? '' : 's') + '.');
  }, [folder, ensureFolderPerm]);

  const removeFileFromEntry = useCallback((entryId, fileId) => {
    setEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      const merged = { ...e, files: (e.files || []).filter(f => f.id !== fileId) };
      putEntry(merged);
      return merged;
    }));
    setToast('Detached.');
  }, []);

  const [previewFile, setPreviewFile] = useState(null);
  const openFile = useCallback(async (fileMeta) => {
    if (fileMeta && fileMeta.kind === 'pdf') {
      setPreviewFile(fileMeta);
      return;
    }
    try { await openAttachedFile(fileMeta); }
    catch (e) { alert('Open failed: ' + e.message); }
  }, []);

  /* PDF drop zone ----------------------------------------------------- */
  const [dropOver, setDropOver] = useState(false);
  const [dropProgress, setDropProgress] = useState(null); // { current, total, label }
  useEffect(() => {
    let depth = 0;
    const isPdfDrag = (e) => Array.from(e.dataTransfer?.items || []).some(it => it.kind === 'file' && (it.type === 'application/pdf' || /\.pdf$/i.test(it.getAsFile?.()?.name || '')));
    const onDragEnter = (e) => {
      if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
      depth++;
      e.preventDefault();
      setDropOver(true);
    };
    const onDragOver = (e) => {
      if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e) => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropOver(false);
    };
    const onDrop = async (e) => {
      depth = 0;
      setDropOver(false);
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      const all = Array.from(e.dataTransfer.files);
      const pdfs  = all.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      const docxs = all.filter(f => /\.docx$/i.test(f.name));
      if (!pdfs.length && !docxs.length) {
        setToast('Drop PDFs (auto-detect references) or .docx files (insert citations).');
        return;
      }
      if (pdfs.length)  await processPdfDrop(pdfs);
      for (const d of docxs) await processDocxDrop(d);
    };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  const processPdfDrop = useCallback(async (files) => {
    const total = files.length;
    let added = 0;
    const existingKeys = new Set(entries.map(e => e.citekey));
    const created = [];
    for (let i = 0; i < total; i++) {
      const file = files[i];
      setDropProgress({ current: i + 1, total, label: 'Reading ' + file.name });
      let extracted;
      try { extracted = await extractFromPdf(file, { maxPages: 3 }); }
      catch (e) { console.warn('PDF parse failed', file.name, e); continue; }

      // Try DOI first, then arXiv. If neither, fall back to extracted XMP.
      let entryShape = null;
      if (extracted.doi) {
        setDropProgress({ current: i + 1, total, label: 'Looking up DOI ' + extracted.doi });
        try { entryShape = await fetchDoiMetadata(extracted.doi); }
        catch (e) { console.warn('CrossRef failed', extracted.doi, e.message); }
      }
      if (!entryShape && extracted.arxivId) {
        setDropProgress({ current: i + 1, total, label: 'Looking up arXiv ' + extracted.arxivId });
        try { entryShape = await fetchArxivMetadata(extracted.arxivId); }
        catch (e) { console.warn('arXiv failed', extracted.arxivId, e.message); }
      }
      if (!entryShape) {
        // Fall back to whatever we pulled out of the PDF
        entryShape = {
          type: 'misc',
          fields: {
            title: extracted.title || file.name.replace(/\.pdf$/i, ''),
            author: extracted.author || '',
          },
          tags: [],
        };
      }

      const entry = {
        id: newId(),
        type: entryShape.type,
        citekey: '',
        fields: entryShape.fields,
        tags: entryShape.tags || [],
        collections: [],
        files: [],
        notes: '',
      };
      const base = generateCitekey(entry) || 'untitled';
      entry.citekey = uniqueCitekey(base, existingKeys);
      existingKeys.add(entry.citekey);

      // Try to write the PDF into the linked folder so it persists with a real handle.
      if (folder) {
        const ok = await ensureFolderPerm();
        if (ok) {
          try {
            const filename = await uniqueFileName(folder, entry.citekey + '.pdf');
            const fileHandle = await folder.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(file);
            await writable.close();
            const sha256 = await hashFile(file).catch(() => '');
            entry.files.push({
              id: newFileId(),
              name: filename,
              kind: detectKind(filename, file.type),
              mime: file.type || 'application/pdf',
              size: file.size,
              sha256,
              addedAt: Date.now(),
              _handle: fileHandle,
            });
          } catch (e) {
            console.warn('Could not save PDF into linked folder', e);
          }
        }
      }

      created.push(entry);
      added++;
    }

    setDropProgress(null);
    if (created.length) {
      await bulkPut(created);
      setEntries(prev => [...created, ...prev]);
      setToast('Imported ' + added + ' PDF' + (added === 1 ? '' : 's') + '.');
    } else {
      setToast('No PDFs imported.');
    }
  }, [entries, folder, ensureFolderPerm]);

  /* Folder scan — Phase 2 watch-folder model. Walk the linked folder
   * recursively, hash-dedupe against existing attachments, run the
   * extract-→ CrossRef pipeline on the unknowns, auto-classify with
   * one TF-IDF tag suggestion, and persist. Idempotent — running it
   * twice on the same folder is a no-op. */
  const scanLinkedFolder = useCallback(async (opts = {}) => {
    if (!folder || scanning) return;
    const ok = await ensureFolderPerm();
    if (!ok) { if (!opts.silent) setToast('Permission denied for the linked folder.'); return; }
    setScanning(true);
    try {
      const all = await collectPdfs(folder);
      const knownHashes = new Set();
      for (const e of entries) for (const f of e.files || []) if (f.sha256) knownHashes.add(f.sha256);
      const { fresh, seenHashes } = await dedupeByHash(all, knownHashes, (p) => setDropProgress(p));

      // Orphan detection: any entry attachment with a sha256 not in the
      // set of files we just walked is missing from the linked folder.
      const orphanUpdates = [];
      for (const e of entries) {
        let changed = false;
        const newFiles = (e.files || []).map(f => {
          if (!f.sha256) return f;
          const isOrphan = !seenHashes.has(f.sha256);
          if (!!f.orphan !== isOrphan) { changed = true; return { ...f, orphan: isOrphan }; }
          return f;
        });
        if (changed) orphanUpdates.push({ ...e, files: newFiles });
      }
      if (orphanUpdates.length) {
        await bulkPut(orphanUpdates);
        setEntries(prev => prev.map(e => orphanUpdates.find(o => o.id === e.id) || e));
      }
      const newlyOrphaned = orphanUpdates
        .filter(e => (e.files || []).some(f => f.orphan))
        .length;

      if (!fresh.length) {
        setDropProgress(null);
        const note = newlyOrphaned ? ' · ' + newlyOrphaned + ' orphan' + (newlyOrphaned === 1 ? '' : 's') + ' flagged' : '';
        if (!opts.silent) setToast('Scanned ' + all.length + ' PDF' + (all.length === 1 ? '' : 's') + '. Nothing new.' + note);
        return;
      }
      const created = [];
      const existingKeys = new Set(entries.map(e => e.citekey));
      for (let i = 0; i < fresh.length; i++) {
        const it = fresh[i];
        setDropProgress({ current: i + 1, total: fresh.length, label: 'Importing ' + it.name });
        let extracted;
        try { extracted = await extractFromPdf(it.file, { maxPages: 3 }); }
        catch (e) { console.warn('PDF parse failed for', it.path, e); continue; }
        let entryShape = null;
        if (extracted.doi) {
          try { entryShape = await fetchDoiMetadata(extracted.doi); }
          catch (e) { /* CrossRef miss is fine; fall through */ }
        }
        if (!entryShape && extracted.arxivId) {
          try { entryShape = await fetchArxivMetadata(extracted.arxivId); }
          catch (e) { /* ditto */ }
        }
        if (!entryShape) {
          entryShape = {
            type: 'misc',
            fields: {
              title: extracted.title || it.name.replace(/\.pdf$/i, ''),
              author: extracted.author || '',
            },
            tags: [],
          };
        }
        const entry = {
          id: newId(),
          type: entryShape.type,
          citekey: '',
          fields: entryShape.fields,
          tags: entryShape.tags || [],
          collections: [],
          files: [{
            id: newFileId(),
            name: it.name,
            kind: detectKind(it.name, it.file.type),
            mime: it.file.type || 'application/pdf',
            size: it.file.size,
            sha256: it.sha256,
            addedAt: Date.now(),
            _handle: it.handle,            // inherits permission from linked folder
            _path: it.path,                // displayable path within the folder
          }],
          notes: '',
        };
        const base = generateCitekey(entry) || 'untitled';
        entry.citekey = uniqueCitekey(base, existingKeys);
        existingKeys.add(entry.citekey);
        created.push(entry);
      }
      // Auto-classify: append the top TF-IDF suggestion to each new entry,
      // computed against the union of existing library + new candidates so
      // the IDF reflects the post-scan vocabulary.
      const fullLib = entries.concat(created);
      for (const e of created) {
        const sugg = suggestTags(e, fullLib, 3);
        if (sugg.length && !(e.tags || []).map(t => t.toLowerCase()).includes(sugg[0].toLowerCase())) {
          e.tags = [...(e.tags || []), sugg[0]];
        }
      }
      if (created.length) {
        await bulkPut(created);
        setEntries(prev => [...created, ...prev]);
      }
      setDropProgress(null);
      setToast('Scanned ' + all.length + ' PDF' + (all.length === 1 ? '' : 's') + '. Imported ' + created.length + ' new.');
    } catch (e) {
      console.error('Scan failed:', e);
      setDropProgress(null);
      if (!opts.silent) setToast('Scan failed: ' + e.message);
    } finally {
      setScanning(false);
    }
  }, [folder, scanning, entries, ensureFolderPerm]);

  // Auto-backup the library to the linked folder on every change.
  // Debounced 4 s so a burst of edits coalesces. The backup file lives
  // beside your PDFs, survives port changes / browser-profile changes,
  // and lets the restore-on-link path repopulate IndexedDB on a fresh
  // install.
  useEffect(() => {
    if (!folder || folderPerm !== 'granted') return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      try {
        const backup = await buildLibraryBackup();
        await writeBackupToFolder(folder, backup);
      } catch (_) { /* best effort */ }
    }, 4000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [entries, folder, folderPerm]);

  // Restore prompt — when a folder is linked AND the library is empty
  // (or near-empty) AND a backup file exists in the folder, offer to
  // repopulate. One-shot per session.
  const restorePromptedRef = useRef(false);
  useEffect(() => {
    if (restorePromptedRef.current) return;
    if (!folder || folderPerm !== 'granted') return;
    if (entries.length > 5) return;
    let cancelled = false;
    (async () => {
      const backup = await readBackupFromFolder(folder);
      if (!backup || cancelled) return;
      const n = (backup.entries || []).length;
      if (n === 0) return;
      restorePromptedRef.current = true;
      const go = confirm(
        'Found a library backup in this folder with ' + n + ' entries' +
        (backup.exportedAt ? ' (last saved ' + new Date(backup.exportedAt).toLocaleString() + ')' : '') +
        '.\n\nYour current library has ' + entries.length + ' entries.\n\n' +
        'Restore from the folder backup? (Cancel to start fresh.)'
      );
      if (!go) return;
      try {
        const count = await applyLibraryBackup(backup, { mode: 'replace' });
        const fresh = await listEntries();
        setEntries(fresh);
        setToast('Restored ' + count + ' entries from folder backup.');
      } catch (e) {
        alert('Restore failed: ' + e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [folder, folderPerm, entries.length]);

  // Auto-scan on first folder grant + when the tab regains visibility.
  // Coming back to the tab after a download is the natural cue to look
  // for new PDFs. visibilitychange is gentler than a periodic timer and
  // doesn't hit the network when the user isn't watching.
  useEffect(() => {
    if (!folder || folderPerm !== 'granted') return;
    let cancelled = false;
    const initial = setTimeout(() => {
      if (!cancelled) scanLinkedFolder({ silent: true });
    }, 1500);
    const onVisible = () => {
      if (document.visibilityState === 'visible') scanLinkedFolder({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [folder, folderPerm, scanLinkedFolder]);

  const processDocxDrop = useCallback(async (file) => {
    setDropProgress({ current: 1, total: 1, label: 'Processing ' + file.name });
    let result;
    try { result = await processDocx(file, entries, { style: citationStyle }); }
    catch (e) { setDropProgress(null); alert('Docx processing failed: ' + e.message); return; }
    setDropProgress(null);
    // Trigger download of the new docx
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    const stem = file.name.replace(/\.docx$/i, '');
    a.download = stem + '-cited.docx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    // Toast summary
    const parts = ['Inserted ' + result.totalCitations + ' citation' + (result.totalCitations === 1 ? '' : 's')];
    parts.push(result.citedCount + ' unique reference' + (result.citedCount === 1 ? '' : 's'));
    if (result.missing.length) parts.push('Missing: ' + result.missing.slice(0, 3).join(', ') + (result.missing.length > 3 ? '…' : ''));
    setToast(parts.join(' · '));
  }, [entries, citationStyle]);

  // Auto-dismiss toast. Action toasts (Undo, etc.) hold longer so the
  // user has time to react; plain status toasts vanish quickly.
  useEffect(() => {
    if (!toast) return;
    const dur = (typeof toast === 'object' && toast && toast.action) ? 10000 : 2400;
    const t = setTimeout(() => setToast(null), dur);
    return () => clearTimeout(t);
  }, [toast]);

  // Derived: filtered + sorted entries
  const visible = useMemo(() => {
    let r = entries;
    if (activeSmart) {
      const sc = allSmartCollections.find(c => c.id === activeSmart);
      if (sc) r = r.filter(e => matchesSmart(e, sc.filter));
    }
    if (activeShelf) {
      // Prefix match: clicking "Chemistry" matches "Chemistry",
      // "Chemistry/Crystallography", "Chemistry/Crystallography/X", …
      const prefix = activeShelf + '/';
      r = r.filter(e => (e.tags || []).some(t => t === activeShelf || t.startsWith(prefix)));
    }
    if (filterType !== 'all') r = r.filter(e => e.type === filterType);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(e => entryMatchesSearch(e, q));
    }
    r = [...r].sort(sortFnFor(sortBy));
    return r;
  }, [entries, filterType, search, activeShelf, activeSmart, allSmartCollections, sortBy]);

  const selected = entries.find(e => e.id === selectedId) || null;

  /* Bulk selection ----------------------------------------------------- */
  const toggleBulk = useCallback((id) => {
    setBulkSelected(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }, []);
  const clearBulk = useCallback(() => setBulkSelected(new Set()), []);
  const bulkCount = bulkSelected.size;

  // Keyboard navigation. Active when no modal is open and the user
  // isn't typing into a field. Esc cascades: clear search → close detail
  // → clear bulk. Arrow keys walk the visible list. "/" focuses search.
  // Attached to window since list rows aren't focusable.
  useEffect(() => {
    const isEditableTarget = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const onKey = (ev) => {
      if (modal) return;
      if (refreshProgress) return;
      const editable = isEditableTarget(ev.target);
      if (ev.key === '/' && !editable && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        const el = document.querySelector('.search-input');
        if (el) { ev.preventDefault(); el.focus(); el.select && el.select(); }
        return;
      }
      if (ev.key === 'Escape') {
        if (editable && ev.target.classList && ev.target.classList.contains('search-input')) {
          ev.preventDefault(); ev.target.blur();
          if (search) setSearch('');
          return;
        }
        if (selectedId) { ev.preventDefault(); setSelectedId(null); return; }
        if (bulkSelected.size > 0) { ev.preventDefault(); clearBulk(); return; }
        return;
      }
      if (editable) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!visible.length) return;
        ev.preventDefault();
        const idx = selectedId ? visible.findIndex(e => e.id === selectedId) : -1;
        const next = ev.key === 'ArrowDown'
          ? (idx < 0 ? 0 : Math.min(visible.length - 1, idx + 1))
          : (idx <= 0 ? 0 : idx - 1);
        const target = visible[next];
        if (target) {
          setSelectedId(target.id);
          requestAnimationFrame(() => {
            const row = document.querySelector('.row[aria-selected="true"]');
            if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
          });
        }
        return;
      }
      if (ev.key === 'Enter' && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
        if (!selectedId && visible.length) { ev.preventDefault(); setSelectedId(visible[0].id); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, refreshProgress, visible, selectedId, search, bulkSelected, clearBulk]);

  /* CRUD --------------------------------------------------------------- */
  const onSave = useCallback(async (entry) => {
    let toSave = entry;
    // Fuzzy dedup — only on new entries (those without an id). Match by
    // DOI / ISBN exact, or canonical (title + first-author + year). The
    // user picks: merge new metadata into the existing entry, or add as
    // a fresh duplicate anyway.
    if (!toSave.id) {
      const dup = findFuzzyDuplicate(toSave, entries);
      if (dup) {
        const reasonText = dup.reason === 'doi'
          ? 'has the same DOI'
          : dup.reason === 'isbn'
            ? 'has the same ISBN'
            : 'has the same title, first author, and year';
        const existingTitle = (dup.match.fields?.title || '(untitled)').slice(0, 80);
        const choice = confirm(
          'A reference already in your library ' + reasonText + ':\n\n' +
          '  ' + (dup.match.citekey || '?') + ' — ' + existingTitle +
          '\n\n[OK] Merge new metadata into the existing entry (fills any empty fields).\n' +
          '[Cancel] Add as a new entry anyway.'
        );
        if (choice) {
          // Merge path — fills empty fields on the existing record.
          const merged = mergeFields(dup.match, toSave);
          const saved = await putEntry({ ...merged, updatedAt: Date.now() });
          setEntries(prev => {
            const idx = prev.findIndex(e => e.id === saved.id);
            if (idx >= 0) { const copy = prev.slice(); copy[idx] = saved; return copy; }
            return [saved, ...prev];
          });
          setSelectedId(saved.id);
          setToast('Merged into “' + saved.citekey + '”.');
          return saved;
        }
        // else fall through and add as a fresh entry
      }
      toSave = { ...toSave, id: newId() };
    }
    if (!toSave.citekey || !toSave.citekey.trim()) {
      const existing = new Set(entries.filter(e => e.id !== toSave.id).map(e => e.citekey));
      const base = generateCitekey(toSave) || 'untitled';
      toSave = { ...toSave, citekey: uniqueCitekey(base, existing) };
    }
    const saved = await putEntry(toSave);
    setEntries(prev => {
      const idx = prev.findIndex(e => e.id === saved.id);
      if (idx >= 0) { const copy = prev.slice(); copy[idx] = saved; return copy; }
      return [saved, ...prev];
    });
    setSelectedId(saved.id);
    setToast(entry.id ? 'Saved.' : 'Added “' + saved.citekey + '”.');
    return saved;
  }, [entries]);

  // Soft-delete with Undo: stash the deleted record(s) and offer a
  // 10-second window in the toast to restore via putEntry. After the
  // toast expires the deletion is permanent (DB row already removed).
  const onDelete = useCallback(async (id) => {
    const e = entries.find(x => x.id === id);
    if (!e) return;
    if (!confirm('Delete reference “' + (e.citekey || e.fields?.title || id) + '”?')) return;
    await deleteEntry(id);
    setEntries(prev => prev.filter(x => x.id !== id));
    if (selectedId === id) setSelectedId(null);
    bulkSelected.delete(id);
    setBulkSelected(new Set(bulkSelected));
    setToast({
      message: 'Deleted “' + (e.citekey || 'entry') + '”.',
      action: {
        label: 'Undo',
        run: async () => {
          await putEntry(e);
          setEntries(prev => prev.some(x => x.id === e.id) ? prev : [e, ...prev]);
          setSelectedId(e.id);
        }
      }
    });
  }, [entries, selectedId, bulkSelected]);

  /* Export ------------------------------------------------------------- */
  // Export targets the current visible view by default — so an active
  // shelf / category / search filter narrows the export to exactly what
  // the user sees. A bulk-selection beats the view filter.
  const exportSelection = useCallback((format) => {
    const set = bulkSelected.size > 0
      ? entries.filter(e => bulkSelected.has(e.id))
      : visible;
    if (!set.length) { setToast('Nothing to export.'); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const base = bulkSelected.size > 0
      ? 'selection-' + stamp
      : (activeShelf ? activeShelf.replace(/[^a-zA-Z0-9]+/g, '-') + '-' + stamp : 'library-' + stamp);
    let body, name, mime;
    if (format === 'ris') {
      body = emitRis(set); name = base + '.ris'; mime = 'application/x-research-info-systems';
    } else if (format === 'csl-json' || format === 'csl') {
      body = emitCsl(set); name = base + '.json'; mime = 'application/vnd.citationstyles.csl+json';
    } else {
      body = emitBib(set); name = base + '.bib'; mime = 'application/x-bibtex';
    }
    downloadBlob(body, name, mime);
    setToast('Exported ' + set.length + ' entr' + (set.length === 1 ? 'y' : 'ies') + ' as ' + format.toUpperCase() + '.');
  }, [entries, bulkSelected, visible, activeShelf]);
  // Backwards-compat name used by some callers
  const exportSelectionAsBib = useCallback(() => exportSelection('bibtex'), [exportSelection]);

  /* Library backup / restore ------------------------------------------- */
  const exportFullLibrary = useCallback(async () => {
    const backup = await buildLibraryBackup();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    const url = URL.createObjectURL(backupAsBlob(backup));
    a.href = url; a.download = 'refmgr-library-' + stamp + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setToast('Backed up ' + backup.entries.length + ' entries.');
  }, []);

  const importFullLibrary = useCallback(() => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      let parsed;
      try { parsed = JSON.parse(await f.text()); }
      catch { alert('Not valid JSON.'); return; }
      const incomingCount = Array.isArray(parsed.entries) ? parsed.entries.length : 0;
      if (!incomingCount) { alert('No entries in that backup.'); return; }
      const action = confirm(
        'Restore ' + incomingCount + ' entries from this backup?\n\n' +
        '"OK" REPLACES your current ' + entries.length + ' entries with the backup\'s ' + incomingCount + '.\n' +
        '"Cancel" merges instead — backup entries are added/upserted on top of yours.'
      );
      try {
        const n = await applyLibraryBackup(parsed, { mode: action ? 'replace' : 'merge' });
        const fresh = await listEntries();
        setEntries(fresh);
        setToast((action ? 'Replaced library with ' : 'Merged in ') + n + ' entries.');
      } catch (err) {
        alert('Restore failed: ' + err.message);
      }
    };
    inp.click();
  }, [entries]);

  /* Library-wide metadata refresh -------------------------------------
   * For every entry that has a DOI (or a URL containing one) but is
   * missing an abstract or citation count, fetch CrossRef + Semantic
   * Scholar and fill the gaps. Polite serial fetching with a 250ms gap
   * to avoid rate-limit clamps. User can cancel mid-flight; partial
   * progress is preserved (each fetched entry is persisted as we go). */
  const refreshLibraryMetadata = useCallback(async () => {
    const candidates = entries
      .map(e => {
        const doi = (e.fields?.doi && extractDoiFromText(e.fields.doi)) ||
                    (e.fields?.url && extractDoiFromText(e.fields.url)) || null;
        if (!doi) return null;
        const hasAbstract = !!(e.fields?.abstract && e.fields.abstract.trim().length >= 40);
        const hasCites    = e.fields?.citationCount != null && String(e.fields.citationCount).length > 0;
        if (hasAbstract && hasCites) return null;
        return { entry: e, doi };
      })
      .filter(Boolean);

    if (candidates.length === 0) {
      setToast('All entries already have abstracts and citation counts. Nothing to fetch.');
      return;
    }
    if (!confirm(
      'Fetch missing metadata for ' + candidates.length + ' entr' + (candidates.length === 1 ? 'y' : 'ies') + '?\n\n' +
      'This pulls abstracts + citation counts from CrossRef and Semantic Scholar. ' +
      'It may take ' + Math.ceil(candidates.length * 0.6) + ' second' + (candidates.length === 1 ? '' : 's') + '. ' +
      'You can cancel anytime.'
    )) return;

    const cancelRef = { cancelled: false };
    setRefreshProgress({ current: 0, total: candidates.length, label: 'Starting…', cancel: () => { cancelRef.cancelled = true; } });
    let filled = 0; let failed = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (cancelRef.cancelled) break;
      const { entry: e, doi } = candidates[i];
      const titleHint = (e.fields?.title || e.citekey || '').slice(0, 50);
      setRefreshProgress({ current: i + 1, total: candidates.length, label: titleHint, cancel: cancelRef.cancel || (() => {}) });
      try {
        const r = await fetchDoiMetadata(doi);
        const patch = {};
        if (r.fields?.abstract && !(e.fields?.abstract && e.fields.abstract.trim())) patch.abstract = r.fields.abstract;
        if (r.fields?.citationCount && !(e.fields?.citationCount && String(e.fields.citationCount).trim())) patch.citationCount = r.fields.citationCount;
        if (r.fields?.influentialCitationCount && !(e.fields?.influentialCitationCount && String(e.fields.influentialCitationCount).trim())) patch.influentialCitationCount = r.fields.influentialCitationCount;
        if (Object.keys(patch).length > 0) {
          const merged = { ...e, fields: { ...(e.fields || {}), ...patch }, updatedAt: Date.now() };
          await putEntry(merged);
          setEntries(prev => {
            const idx = prev.findIndex(x => x.id === merged.id);
            if (idx < 0) return prev;
            const copy = prev.slice(); copy[idx] = merged; return copy;
          });
          filled++;
        }
      } catch (_) { failed++; /* keep going */ }
      // 250ms throttle — be polite to S2's unauthed rate limiter
      await new Promise(res => setTimeout(res, 250));
    }
    setRefreshProgress(null);
    if (cancelRef.cancelled) {
      setToast('Cancelled. Filled ' + filled + ' so far.');
    } else {
      setToast('Filled metadata on ' + filled + ' entr' + (filled === 1 ? 'y' : 'ies') + '.' + (failed ? ' ' + failed + ' failed.' : ''));
    }
  }, [entries]);

  /* Import ------------------------------------------------------------- */
  const importBibFile = useCallback(() => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.bib,application/x-bibtex,text/plain';
    inp.onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      let text;
      try { text = await f.text(); } catch (err) { alert('Import failed: ' + err.message); return; }
      const records = parseBib(text);
      if (!records.length) { setToast('No entries found in that file.'); return; }
      // Build dedup indexes from the existing library
      const existingByDoi = new Map();
      const existingByCitekey = new Map();
      for (const e of entries) {
        if (e.fields?.doi) existingByDoi.set(String(e.fields.doi).toLowerCase(), e);
        if (e.citekey) existingByCitekey.set(e.citekey, e);
      }
      const existingKeys = new Set(entries.map(e => e.citekey));
      const incoming = [];
      const skipped = [];
      for (const r of records) {
        const doi = r.fields.doi ? String(r.fields.doi).toLowerCase() : null;
        // Skip if the DOI matches an existing entry — strongest dedup signal
        if (doi && existingByDoi.has(doi)) {
          skipped.push({ key: r.citekey, dup: existingByDoi.get(doi).citekey, why: 'doi' });
          continue;
        }
        // Skip if the citekey matches AND no DOI to override
        if (!doi && r.citekey && existingByCitekey.has(r.citekey)) {
          skipped.push({ key: r.citekey, dup: r.citekey, why: 'citekey' });
          continue;
        }
        const entry = {
          id: newId(),
          type: bibtypeToType(r.bibtype),
          citekey: r.citekey || '',
          fields: r.fields,
          tags: [],
          collections: [],
          files: [],
          notes: '',
        };
        if (!entry.citekey || existingKeys.has(entry.citekey)) {
          entry.citekey = uniqueCitekey(entry.citekey || generateCitekey(entry), existingKeys);
        }
        existingKeys.add(entry.citekey);
        incoming.push(entry);
      }
      if (incoming.length) await bulkPut(incoming);
      setEntries(prev => [...incoming, ...prev]);
      const parts = ['Imported ' + incoming.length];
      if (skipped.length) {
        parts.push('skipped ' + skipped.length + ' duplicate' + (skipped.length === 1 ? '' : 's') +
          ' (' + skipped.slice(0, 3).map(s => s.key).join(', ') + (skipped.length > 3 ? '…' : '') + ')');
      }
      setToast(parts.join(' · '));
    };
    inp.click();
  }, [entries]);

  /* Render ------------------------------------------------------------- */
  const counts = useMemo(() => {
    const c = { all: entries.length };
    for (const e of entries) c[e.type] = (c[e.type] || 0) + 1;
    return c;
  }, [entries]);

  const smartCounts = useMemo(() => {
    const m = {};
    for (const sc of allSmartCollections) m[sc.id] = countMatching(entries, sc.filter);
    return m;
  }, [entries, allSmartCollections]);

  // Auto-classified shelves. Tags split on "/" into a tree, so a tag
  // like "Chemistry/Crystallography/Polymorphism" renders as nested
  // shelves and clicking a parent prefix-matches all descendants.
  const shelfTree = useMemo(() => buildShelfTree(entries), [entries]);

  const showDetail = !!selected && bulkCount === 0 && !activeManuscript;

  return html`
    <div class=${'app-shell' + (showDetail ? ' has-detail' : '')}>
      <${Sidebar}
        manuscripts=${manuscripts}
        activeManuscriptId=${activeManuscriptId}
        onSelectManuscript=${(id) => setActiveManuscriptId(activeManuscriptId === id ? null : id)}
        onCreateManuscript=${createManuscript}
        onRenameManuscript=${renameManuscript}
        onDeleteManuscript=${removeManuscript}
        counts=${counts}
        active=${filterType}
        onChange=${setFilterType}
        smartCollections=${allSmartCollections}
        activeSmart=${activeSmart}
        onChangeSmart=${(id) => setActiveSmart(activeSmart === id ? null : id)}
        onSaveCurrentView=${() => {
          const name = prompt('Name this saved view:');
          if (!name) return;
          const filter = {};
          if (search.trim()) filter.search = search.trim();
          if (filterType !== 'all') filter.filterType = filterType;
          if (activeShelf) filter.shelf = activeShelf;
          const sc = { id: 'u_' + Date.now().toString(36), name, filter };
          setCustomSmart(prev => [...prev, sc]);
          setActiveSmart(sc.id);
        }}
        onDeleteSmart=${(id) => {
          setCustomSmart(prev => prev.filter(c => c.id !== id));
          if (activeSmart === id) setActiveSmart(null);
        }}
        smartCounts=${smartCounts}
        shelfTree=${shelfTree}
        activeShelf=${activeShelf}
        onChangeShelf=${(t) => setActiveShelf(activeShelf === t ? null : t)}
        accent=${accent}
        setAccent=${setAccent}
        paper=${paper}
        setPaper=${setPaper}
        folder=${folder}
        folderPerm=${folderPerm}
        onLinkFolder=${linkFolder}
        onUnlinkFolder=${unlinkFolder}
        onResumeFolderPerm=${ensureFolderPerm}
        onScanFolder=${scanLinkedFolder}
        scanning=${scanning}
        fsaSupported=${isFsaSupported()}
      />
      <div class="main">
      ${activeManuscript ? html`
        <${ManuscriptView}
          manuscript=${activeManuscript}
          allEntries=${entries}
          onUpdate=${updateManuscript}
          onLinkFolder=${() => linkManuscriptFolder(activeManuscript.id)}
          onClose=${() => setActiveManuscriptId(null)}
          onToast=${setToast}
        />
      ` : html`
        <${Toolbar}
          search=${search}
          setSearch=${setSearch}
          onAdd=${() => setModal('new')}
          onSearchWeb=${() => setModal('search')}
          onImport=${importBibFile}
          onExport=${exportSelection}
          onPandocHelp=${() => setModal('pandoc')}
          onBackupLibrary=${exportFullLibrary}
          onRestoreLibrary=${importFullLibrary}
          onRefreshMetadata=${refreshLibraryMetadata}
          bulkCount=${bulkCount}
          totalCount=${entries.length}
          visibleCount=${visible.length}
          activeShelf=${activeShelf}
          activeFilterLabel=${
            (activeSmart && (allSmartCollections.find(s => s.id === activeSmart)?.name)) ||
            (activeShelf ? '#' + activeShelf : null) ||
            (filterType !== 'all' ? (ENTRY_TYPES[filterType]?.label || filterType) : 'All references')
          }
          sortBy=${sortBy}
          setSortBy=${setSortBy}
        />
        ${bulkCount > 0 ? html`
          <${BulkBar}
            count=${bulkCount}
            onExport=${exportSelection}
            onDelete=${async () => {
              if (!confirm('Delete ' + bulkCount + ' references?')) return;
              const stash = entries.filter(e => bulkSelected.has(e.id));
              for (const id of bulkSelected) await deleteEntry(id);
              setEntries(prev => prev.filter(e => !bulkSelected.has(e.id)));
              clearBulk();
              setSelectedId(null);
              setToast({
                message: 'Deleted ' + stash.length + ' entr' + (stash.length === 1 ? 'y' : 'ies') + '.',
                action: {
                  label: 'Undo',
                  run: async () => {
                    for (const e of stash) await putEntry(e);
                    setEntries(prev => {
                      const known = new Set(prev.map(x => x.id));
                      const restored = stash.filter(x => !known.has(x.id));
                      return restored.length ? [...restored, ...prev] : prev;
                    });
                  }
                }
              });
            }}
            onClear=${clearBulk}
          />
        ` : null}
        <${EntryList}
          entries=${visible}
          selectedId=${selectedId}
          bulkSelected=${bulkSelected}
          onSelect=${setSelectedId}
          onToggleBulk=${toggleBulk}
        />
      `}
      </div>
      ${showDetail ? html`
        <${Detail}
          entry=${selected}
          allEntries=${entries}
          onChange=${(patch) => onSave({ ...selected, ...patch, fields: { ...selected.fields, ...(patch.fields || {}) } })}
          onClose=${() => setSelectedId(null)}
          onDelete=${() => onDelete(selected.id)}
          onAttachFiles=${() => attachFilesToEntry(selected.id)}
          onOpenFile=${openFile}
          onRemoveFile=${(fileId) => removeFileFromEntry(selected.id, fileId)}
          onAddTag=${(tag) => {
            const tags = Array.from(new Set([...(selected.tags || []), tag]));
            onSave({ ...selected, tags });
          }}
          onRemoveTag=${(tag) => {
            const tags = (selected.tags || []).filter(t => t !== tag);
            onSave({ ...selected, tags });
          }}
          onSetReading=${(reading) => onSave({ ...selected, reading })}
          onSetRating=${(rating) => onSave({ ...selected, rating })}
          folderLinked=${!!folder}
          onToast=${setToast}
        />
      ` : null}
      ${modal === 'new' ? html`
        <${EntryModal}
          onClose=${() => setModal(null)}
          onSave=${async (e) => { await onSave(e); setModal(null); }}
          onToast=${setToast}
          existingEntries=${entries}
        />
      ` : null}
      ${modal === 'pandoc' ? html`
        <${PandocHelpModal}
          onClose=${() => setModal(null)}
          onExportCsl=${() => exportSelection('csl-json')}
          bulkCount=${bulkCount}
          totalCount=${entries.length}
        />
      ` : null}
      ${modal === 'search' ? html`
        <${WebSearchModal}
          onClose=${() => setModal(null)}
          existingEntries=${entries}
          onAddResult=${async (r) => {
            const shape = searchResultToEntry(r);
            await onSave({ type: shape.type, citekey: '', fields: shape.fields, tags: shape.tags || [], collections: [], files: [], notes: '' });
            setToast('Added "' + (r.title || 'untitled').slice(0, 60) + '" to your library.');
          }}
        />
      ` : null}
      ${previewFile ? html`
        <${PdfPreviewModal}
          fileMeta=${previewFile}
          onClose=${() => setPreviewFile(null)}
        />
      ` : null}
      ${dropOver ? html`
        <div class="drop-overlay" role="status" aria-label="Drop PDFs or docx to import or process">
          <div class="drop-overlay-card">
            <div class="drop-eyebrow">Drop PDFs or .docx here</div>
            <div class="drop-title">PDF → import metadata · DOCX → insert citations</div>
            <div class="drop-hint">${folder
              ? 'Dropped PDFs will be copied into ' + folder.name + '. Dropped .docx files get a “-cited.docx” companion using the ' + (STYLES[citationStyle]?.label || citationStyle) + ' style.'
              : 'PDFs only persist as attachments when a library folder is linked. .docx still works.'
            }</div>
          </div>
        </div>
      ` : null}
      ${dropProgress ? html`
        <div class="drop-progress" role="status">
          <span>${dropProgress.label}</span>
          <span style="margin-left:auto;font-family:var(--font-mono);font-size:11px;color:var(--ink-muted)">${dropProgress.current} / ${dropProgress.total}</span>
        </div>
      ` : null}
      ${refreshProgress ? html`
        <div class="drop-progress" role="status" aria-live="polite">
          <span style="font-family:var(--font-serif);font-style:italic">Refreshing metadata · ${refreshProgress.label}</span>
          <span style="margin-left:auto;font-family:var(--font-mono);font-size:11px;color:var(--ink-muted)">${refreshProgress.current} / ${refreshProgress.total}</span>
          <button class="btn-tiny" style="background:rgba(255,255,255,0.10);border-color:rgba(255,255,255,0.20);color:var(--ink-inverse);margin-left:8px" onClick=${refreshProgress.cancel}>Cancel</button>
        </div>
      ` : null}
      ${toast ? html`
        <div class="toast" role="status">
          <span>${typeof toast === 'string' ? toast : toast.message}</span>
          ${(typeof toast === 'object' && toast && toast.action) ? html`
            <button class="toast-action"
                    onClick=${() => { try { toast.action.run(); } finally { setToast(null); } }}>
              ${toast.action.label}
            </button>
          ` : null}
        </div>
      ` : null}
    </div>
  `;
}

/* ─── Shelf tree (hierarchical tags) ─────────────────────────────────
 * Tags split on "/". buildShelfTree returns a virtual root with .children
 * — each node has { tag, label, count (own), totalCount, children }.
 * Counts: `count` is entries tagged exactly with this path; `totalCount`
 * sums the subtree so a parent shelf shows the full descendant total.
 */
function buildShelfTree(entries) {
  const root = { children: [], totalCount: 0 };
  // Map keyed by full tag-path so we can find/extend nodes incrementally
  const nodeByPath = new Map();
  function ensureNode(parts) {
    let parent = root;
    let path = '';
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      path = path ? path + '/' + seg : seg;
      let child = parent.children.find(c => c.label === seg);
      if (!child) {
        child = { tag: path, label: seg, count: 0, totalCount: 0, children: [] };
        parent.children.push(child);
        nodeByPath.set(path, child);
      }
      parent = child;
    }
    return parent;
  }
  for (const e of entries || []) {
    for (const tag of e.tags || []) {
      const parts = String(tag).split('/').map(s => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      const leaf = ensureNode(parts);
      leaf.count += 1;
    }
  }
  function rollup(node) {
    let total = node.count || 0;
    for (const c of node.children) total += rollup(c);
    node.totalCount = total;
    node.children.sort((a, b) => b.totalCount - a.totalCount || a.label.localeCompare(b.label));
    return total;
  }
  rollup(root);
  // Cap the top-level depth (limit visual noise) — show top 12 roots
  root.children = root.children.slice(0, 12);
  return root;
}

function ShelfNode({ node, depth, active, onChange }) {
  const isActive = active === node.tag;
  const indent = 8 + depth * 14;
  const pad = depth === 0 ? '' : 'padding-left:' + indent + 'px;';
  return html`
    <button class="nav-item shelf-item" style=${pad} aria-current=${isActive ? 'true' : 'false'} onClick=${() => onChange(node.tag)} title=${'Filter by tag: ' + node.tag}>
      <span>${node.label}</span>
      <span class="count">${node.totalCount}</span>
    </button>
    ${node.children.map(c => html`<${ShelfNode} node=${c} depth=${depth + 1} active=${active} onChange=${onChange} />`)}
  `;
}

/* ─── Sidebar ──────────────────────────────────────────────────────── */
function Sidebar({
  manuscripts, activeManuscriptId, onSelectManuscript, onCreateManuscript, onRenameManuscript, onDeleteManuscript,
  counts, active, onChange,
  smartCollections, activeSmart, onChangeSmart, onSaveCurrentView, onDeleteSmart, smartCounts,
  shelfTree, activeShelf, onChangeShelf,
  accent, setAccent,
  paper, setPaper,
  folder, folderPerm, onLinkFolder, onUnlinkFolder, onResumeFolderPerm,
  onScanFolder, scanning,
  fsaSupported,
}) {
  // First letter of each library type, for the leader glyph.
  const typeGlyph = {
    all: '∗', article: 'a', inproceedings: 'c', inbook: 'b', incollection: 'b',
    book: 'b', thesis: 't', phdthesis: 't', mastersthesis: 't',
    techreport: 'r', manual: 'm', unpublished: 'p', misc: '?',
  };
  const items = [
    { id: 'all', label: 'All references' },
    ...Object.entries(ENTRY_TYPES).map(([id, def]) => ({ id, label: def.label })),
  ];
  const papers = [
    { id: 'light', color: '#FAFAF7' },
    { id: 'warm',  color: '#F2EFE6' },
    { id: 'sepia', color: '#EDE6D2' },
    { id: 'ink',   color: '#E2E5EC' },
  ];
  return html`
    <nav class="sidebar" aria-label="Library navigation">
      <div class="brand" title="Pothi — manuscript / palm-leaf book (Sanskrit / Bengali)">
        <div class="brand-mark">P</div>
        <div>
          <div class="brand-name">Pothi</div>
          <div class="brand-sub">your bibliography, in your folder</div>
        </div>
      </div>

      <div class="nav-group">
        <div class="nav-group-label" title="Each manuscript curates its own bibliography from your library.">Manuscripts</div>
        ${(manuscripts || []).map(ms => html`
          <button class="nav-item" aria-current=${activeManuscriptId === ms.id ? 'true' : 'false'} onClick=${() => onSelectManuscript(ms.id)} title=${ms.folderHandle ? 'Linked to folder: ' + ms.folderHandle.name : 'No folder linked'}>
            <span class="ni-glyph" aria-hidden="true">${ms.folderHandle ? '§' : '¶'}</span>
            <span class="ni-label">${ms.name}</span>
            <button class="nav-item-x" onClick=${(e) => { e.stopPropagation(); onRenameManuscript(ms.id); }} title="Rename" aria-label=${'Rename ' + ms.name}>✎</button>
            <button class="nav-item-x" onClick=${(e) => { e.stopPropagation(); onDeleteManuscript(ms.id); }} title="Delete" aria-label=${'Delete ' + ms.name}>×</button>
            <span class="count">${(ms.cited || []).length}</span>
          </button>
        `)}
        <button class="nav-group-action" onClick=${onCreateManuscript}>+ New manuscript</button>
      </div>

      <div class="nav-group">
        <div class="nav-group-label">Library</div>
        ${items.map(it => html`
          <button class="nav-item" aria-current=${active === it.id ? 'true' : 'false'} onClick=${() => onChange(it.id)}>
            <span class="ni-glyph" aria-hidden="true">${typeGlyph[it.id] || '·'}</span>
            <span class="ni-label">${it.label}</span>
            <span class="count">${counts[it.id] || 0}</span>
          </button>
        `)}
      </div>

      ${smartCollections && smartCollections.length > 0 ? html`
        <div class="nav-group">
          <div class="nav-group-label" title="Saved searches: built-in suggestions + your own. Click to apply; click again to clear.">Smart collections</div>
          ${smartCollections.map(sc => html`
            <button class="nav-item" aria-current=${activeSmart === sc.id ? 'true' : 'false'} onClick=${() => onChangeSmart(sc.id)}>
              <span class="ni-glyph" aria-hidden="true">${sc.builtin ? '◇' : '◆'}</span>
              <span class="ni-label">${sc.name}</span>
              ${!sc.builtin ? html`<button class="nav-item-x" title="Delete this saved view" onClick=${(e) => { e.stopPropagation(); onDeleteSmart(sc.id); }} aria-label=${'Delete saved view ' + sc.name}>×</button>` : null}
              <span class="count">${(smartCounts && smartCounts[sc.id]) || 0}</span>
            </button>
          `)}
          <button class="nav-group-action" onClick=${onSaveCurrentView}>+ Save current view</button>
        </div>
      ` : null}

      ${shelfTree && shelfTree.children && shelfTree.children.length > 0 ? html`
        <div class="nav-group">
          <div class="nav-group-label" title="Auto-built from your tags. Click any shelf to filter; click a parent to filter all sub-shelves. Click again to clear.">Shelves</div>
          ${shelfTree.children.map(node => html`<${ShelfNode} node=${node} depth=${0} active=${activeShelf} onChange=${onChangeShelf} />`)}
        </div>
      ` : null}

      <div class="nav-group">
        <div class="nav-group-label">Library folder</div>
        ${!fsaSupported ? html`
          <div class="folder-info folder-warn">
            <div style="font-size:11px;line-height:1.4">
              File linking needs Chrome, Edge, or Brave. Your browser doesn't expose the File System Access API; the rest of Pothi works fine.
            </div>
          </div>
        ` : folder ? html`
          <div class="folder-info">
            <span class="folder-name" title=${folder.name}>${folder.name}</span>
            ${folderPerm === 'granted' ? html`
              <span class="folder-perm-dot" title="Read/write granted"></span>
            ` : html`
              <button class="btn-tiny" onClick=${onResumeFolderPerm} title="Browser permission lapsed — click to re-grant">Resume</button>
            `}
          </div>
          <div style="display:flex;gap:4px;margin-top:6px">
            <button class="btn-tiny" style="flex:1" onClick=${onScanFolder} disabled=${scanning} title="Walk the folder, hash all PDFs, and import any new ones">
              ${scanning ? 'Scanning…' : 'Scan now'}
            </button>
            <button class="btn-tiny" onClick=${onLinkFolder} title="Pick a different folder">Change</button>
            <button class="btn-tiny btn-tiny-danger" onClick=${onUnlinkFolder} title="Unlink (entries keep their files)" aria-label="Unlink folder">×</button>
          </div>
          <p class="hint" style="margin-top:4px">Drop PDFs into <em>${folder.name}</em> from anywhere — Pothi scans on load and on demand, hash-deduped against the library.</p>
        ` : html`
          <button class="btn" style="width:100%" onClick=${onLinkFolder}>Link a folder…</button>
          <p class="hint">Where your PDFs, slides, and other reference files live. Pick once; the link persists.</p>
        `}
      </div>

      <div class="nav-group">
        <div class="nav-group-label">Paper tone</div>
        <div class="swatch-row">
          ${papers.map(p => html`
            <button
              aria-label=${'Paper: ' + p.id}
              aria-pressed=${paper === p.id ? 'true' : 'false'}
              onClick=${() => setPaper(p.id)}
              style=${'background:' + p.color}
              title=${'Paper: ' + p.id}
            ></button>
          `)}
        </div>
      </div>

      <div class="sidebar-foot">
        Pothi v0.1 — pōthī, "manuscript"<br/>
        © 2026 Kanchan Sarkar · MIT licensed
      </div>
    </nav>
  `;
}

/* ─── ManuscriptView ────────────────────────────────────────────────
 * The "manuscript-first" surface. Searches the global library (top
 * input) and lets the user click + Cite to add references with a
 * per-citation rationale. Auto-export to the manuscript's folder is
 * driven by App-level effect; this component is a controlled view —
 * every change calls onUpdate(nextManuscript). */
function ManuscriptView({ manuscript, allEntries, onUpdate, onLinkFolder, onClose, onToast }) {
  const [search, setSearch] = useState('');
  const ms = manuscript;
  const cited = manuscriptCitedEntries(ms, allEntries);
  const citedIds = new Set((ms.cited || []).map(c => c.entryId));

  const candidates = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return (allEntries || [])
      .filter(e => !citedIds.has(e.id) && entryMatchesSearch(e, q))
      .slice(0, 12);
  }, [search, allEntries, ms.cited]);

  const onCite = (entryId, rationale = '') => {
    onUpdate(citeInManuscript(ms, entryId, rationale));
    onToast && onToast('Added to manuscript.');
  };
  const onUncite = (entryId) => onUpdate(uncite_(ms, entryId));
  const onRationale = (entryId, val) => onUpdate(updateRationale(ms, entryId, val));
  const onMove = (entryId, delta) => onUpdate(reorderCitation(ms, entryId, delta));
  const onStyle = (s) => onUpdate({ ...ms, citationStyle: s, updatedAt: Date.now() });

  const exportBibNow = () => {
    const text = buildManuscriptBib(ms, allEntries);
    downloadBlob(text, (ms.name.replace(/[^a-zA-Z0-9]+/g, '-') || 'manuscript') + '-references.bib', 'application/x-bibtex');
  };
  const exportCslNow = () => {
    const text = buildManuscriptCsl(ms, allEntries);
    downloadBlob(text, (ms.name.replace(/[^a-zA-Z0-9]+/g, '-') || 'manuscript') + '-refs.json', 'application/json');
  };

  return html`
    <div class="ms-view">
      <div class="ms-head">
        <button class="btn btn-ghost" onClick=${onClose} aria-label="Back to library" title="Back to library">← Library</button>
        <h2 class="ms-name">${ms.name}</h2>
        <span class="ms-cite-count">${(ms.cited || []).length} cited</span>
        <span style="flex:1"></span>
        ${ms.folderHandle
          ? html`<span class="ms-folder" title=${'Auto-exporting to ' + ms.folderHandle.name}>📁 ${ms.folderHandle.name} <span style="color:var(--status-success)">●</span></span>`
          : html`<button class="btn btn-ghost" onClick=${onLinkFolder}>+ Link folder</button>`
        }
      </div>

      <div class="ms-search">
        <input
          type="search"
          class="input"
          placeholder="Search the library to add a reference (title, author, DOI, tag…)"
          value=${search}
          onInput=${(e) => setSearch(e.target.value)}
          aria-label="Search library to cite"
        />
        ${candidates.length > 0 ? html`
          <div class="ms-search-results">
            ${candidates.map(e => html`
              <div class="ms-result">
                <div class="ms-result-body">
                  <div class="ms-result-title">${e.fields?.title || '(untitled)'}</div>
                  <div class="ms-result-meta">
                    <span>${e.citekey}</span>
                    <span>·</span>
                    <span>${e.fields?.author || e.fields?.editor || '—'}</span>
                    <span>·</span>
                    <span>${e.fields?.year || '—'}</span>
                  </div>
                </div>
                <button class="btn btn-primary btn-tiny" onClick=${() => { onCite(e.id); setSearch(''); }}>+ Cite</button>
              </div>
            `)}
          </div>
        ` : (search.trim() ? html`<div class="ms-empty">No matches in your library.</div>` : null)}
      </div>

      <div class="ms-bib">
        <div class="ms-bib-header">
          <h3 style="margin:0">Bibliography</h3>
          <span style="flex:1"></span>
          <select aria-label="Citation style" value=${ms.citationStyle || 'author-year'} onChange=${(e) => onStyle(e.target.value)} style="padding:4px 6px;border:1px solid var(--rule);border-radius:var(--r-md);font-size:12px">
            <option value="author-year">Author-year</option>
            <option value="numeric">Numeric</option>
          </select>
          <button class="btn btn-ghost" onClick=${exportBibNow} title="Download .bib now">.bib</button>
          <button class="btn btn-ghost" onClick=${exportCslNow} title="Download CSL-JSON now">.json</button>
        </div>
        ${cited.length === 0 ? html`
          <div class="ms-empty">No references cited yet. Search above and click <strong>+ Cite</strong> to add the first one.</div>
        ` : html`
          <div class="ms-cited-list">
            ${(ms.cited || []).map((c, i) => {
              const e = allEntries.find(x => x.id === c.entryId);
              return html`
                <div class="ms-cited-row">
                  <div class="ms-cited-ord">${i + 1}.</div>
                  <div class="ms-cited-body">
                    ${e ? html`
                      <div class="ms-cited-title">${e.fields?.title || '(untitled)'}</div>
                      <div class="ms-cited-meta">
                        <span class="row-citekey" style="display:inline">${e.citekey}</span>
                        <span> · ${e.fields?.author || e.fields?.editor || '—'}</span>
                        <span> · ${e.fields?.year || '—'}</span>
                      </div>
                    ` : html`
                      <div class="ms-cited-title" style="color:var(--status-error);font-style:italic">Missing entry (deleted from library)</div>
                      <div class="ms-cited-meta">id: ${c.entryId}</div>
                    `}
                    <textarea
                      class="ms-rationale"
                      placeholder="Why is this cited? (notes that stay with this manuscript only)"
                      value=${c.rationale || ''}
                      onInput=${(ev) => onRationale(c.entryId, ev.target.value)}
                    ></textarea>
                  </div>
                  <div class="ms-cited-actions">
                    <button class="btn-tiny" onClick=${() => onMove(c.entryId, -1)} title="Move up" aria-label="Move up" disabled=${i === 0}>↑</button>
                    <button class="btn-tiny" onClick=${() => onMove(c.entryId, +1)} title="Move down" aria-label="Move down" disabled=${i === (ms.cited || []).length - 1}>↓</button>
                    <button class="btn-tiny btn-tiny-danger" onClick=${() => onUncite(c.entryId)} title="Remove from manuscript" aria-label="Uncite">×</button>
                  </div>
                </div>
              `;
            })}
          </div>
        `}
      </div>
    </div>
  `;
}

/* ─── Dropdown (button + menu) ─────────────────────────────────────── */
function Dropdown({ label, ariaLabel, items, align, btnClass }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (!e.target.closest('.dropdown')) setOpen(false);
    };
    const k = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [open]);
  return html`
    <div class=${'dropdown' + (align === 'right' ? ' align-right' : '')}>
      <button class=${btnClass || 'btn'} aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'} aria-label=${ariaLabel || ''} onClick=${() => setOpen(o => !o)}>
        ${label}
        <span class="dropdown-caret" aria-hidden="true">▾</span>
      </button>
      ${open ? html`
        <div class="dropdown-menu" role="menu">
          ${items.map((it, i) => it.divider ? html`<div class="dropdown-divider" role="separator"></div>` : html`
            <button
              class="dropdown-item"
              role="menuitem"
              onClick=${() => { setOpen(false); it.onClick(); }}
            >
              <span class="dropdown-label">${it.label}</span>
              ${it.hint ? html`<span class="dropdown-hint">${it.hint}</span>` : null}
            </button>
          `)}
        </div>
      ` : null}
    </div>
  `;
}

/* ─── Toolbar ──────────────────────────────────────────────────────── */
function Toolbar({ search, setSearch, onAdd, onSearchWeb, onImport, onExport, onPandocHelp, onBackupLibrary, onRestoreLibrary, onRefreshMetadata, bulkCount, totalCount, visibleCount, activeShelf, activeFilterLabel, sortBy, setSortBy }) {
  const setLabel = bulkCount > 0
    ? bulkCount + ' selected'
    : (activeShelf || (typeof visibleCount === 'number' && visibleCount !== totalCount))
      ? visibleCount + ' visible'
      : 'all (' + totalCount + ')';
  const exportItems = [
    { label: 'BibTeX (.bib)',     hint: 'for LaTeX',  onClick: () => onExport('bibtex') },
    { label: 'RIS (.ris)',        hint: 'for EndNote / Mendeley import', onClick: () => onExport('ris') },
    { label: 'CSL-JSON (.json)',  hint: 'for Pandoc / docx',  onClick: () => onExport('csl-json') },
    { divider: true },
    { label: 'Use with Word + Pandoc…', onClick: onPandocHelp },
    { divider: true },
    { label: 'Refresh missing metadata…', hint: 'fill empty abstracts + citation counts from CrossRef + OpenAlex', onClick: onRefreshMetadata },
    { divider: true },
    { label: 'Backup full library (.json)', hint: 'tags, files, ratings, notes — everything', onClick: onBackupLibrary },
    { label: 'Restore library from backup…', hint: 'JSON file from a previous backup', onClick: onRestoreLibrary },
  ];
  const sortLabels = {
    'year-desc':  'Year ↓ (newest)',
    'year-asc':   'Year ↑ (oldest)',
    'title-asc':  'Title A→Z',
    'title-desc': 'Title Z→A',
    'author-asc': 'Author A→Z',
    'author-desc':'Author Z→A',
    'citekey':    'Citekey',
    'added-desc': 'Recently added',
    'added-asc':  'Oldest added',
  };
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();
  const titleLabel = activeFilterLabel || (activeShelf ? '#' + activeShelf : 'All references');
  return html`
    <header class="toolbar">
      <div class="masthead">
        <div class="masthead-eyebrow">
          <span>POTHI · LIBRARY</span>
          <span class="sep">/</span>
          <span>VOL. I</span>
          <span class="sep">/</span>
          <span>${today}</span>
        </div>
        <h1 class="masthead-title">
          ${titleLabel} <em>· ${visibleCount} of ${totalCount}</em>
        </h1>
        <div class="masthead-meta">
          A working bibliography, sorted by ${(sortLabels[sortBy] || 'year ↓ (newest)').toLowerCase()}.
        </div>
      </div>
      <div class="toolbar-actions">
        <div class="search-wrap">
          <svg class="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5"></circle>
            <path d="M10.5 10.5 14 14"></path>
          </svg>
          <input
            class="search-input"
            type="search"
            placeholder=${'Search title, author, abstract…'}
            value=${search}
            onInput=${(e) => setSearch(e.target.value)}
            aria-label="Search references"
          />
        </div>
        <select
          aria-label="Sort"
          value=${sortBy || 'year-desc'}
          onChange=${(e) => setSortBy && setSortBy(e.target.value)}
          title="Sort the list"
          style="padding:6px 8px;border:1px solid var(--bg-rule);border-radius:var(--r-md);font-size:12.5px;background:var(--bg-card);color:var(--ink-primary);font-family:var(--font-sans)"
        >
          ${Object.entries(sortLabels).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
        </select>
        <button class="btn" onClick=${onSearchWeb} title="Search CrossRef + OpenAlex by keywords and import">Search web…</button>
        <button class="btn" onClick=${onImport} title="Import .bib file">Import .bib</button>
        <${Dropdown}
          label=${'Export ' + setLabel}
          ariaLabel="Export references"
          align="right"
          items=${exportItems}
        />
        <button class="btn btn-primary" onClick=${onAdd}>+ Add reference</button>
      </div>
    </header>
  `;
}

/* ─── BulkBar ──────────────────────────────────────────────────────── */
function BulkBar({ count, onExport, onDelete, onClear }) {
  return html`
    <div class="bulkbar" role="toolbar" aria-label="Bulk actions">
      <span>${count} selected</span>
      <span style="flex:1"></span>
      <button class="btn btn-ghost" style="color:var(--ink-inverse);border-color:rgba(255,255,255,0.2)" onClick=${() => onExport('bibtex')}>BibTeX</button>
      <button class="btn btn-ghost" style="color:var(--ink-inverse);border-color:rgba(255,255,255,0.2)" onClick=${() => onExport('ris')}>RIS</button>
      <button class="btn btn-ghost" style="color:var(--ink-inverse);border-color:rgba(255,255,255,0.2)" onClick=${() => onExport('csl-json')}>CSL-JSON</button>
      <button class="btn btn-ghost" style="color:#ffd1c8;border-color:rgba(255,209,200,0.3)" onClick=${onDelete}>Delete</button>
      <button class="btn btn-ghost" style="color:var(--ink-inverse)" onClick=${onClear} aria-label="Clear selection">×</button>
    </div>
  `;
}

/* ─── WebSearchModal ───────────────────────────────────────────────────
 * Keyword search across CrossRef + OpenAlex (the two free,
 * CORS-clean, Scholar-grade sources). Results are deduped by DOI and
 * sorted by Semantic Scholar citation count, then year. Each row has a
 * "+ Add to library" button. Already-imported DOIs are flagged so the
 * user doesn't add the same paper twice.
 *
 * Why not Google Scholar / Web of Science? Scholar has no public API
 * and blocks browser fetches via CORS; WoS is paywalled and requires an
 * institutional API key. Our two sources together cover ~350M records
 * and most of what Scholar surfaces. */
function WebSearchModal({ onClose, onAddResult, existingEntries }) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('auto');     // 'auto'|'anywhere'|'author'|'title'
  const [resolvedMode, setResolvedMode] = useState(null);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [touched, setTouched] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [adding, setAdding] = useState(() => new Set());
  const inputRef = useRef(null);
  // Live "auto" interpretation hint so the user can see what mode their
  // query will resolve to before pressing Search.
  const autoHint = mode === 'auto'
    ? (q.trim() ? (looksLikeName(q) ? 'author' : 'anywhere') : null)
    : null;

  // DOIs already in the user's library, lower-cased.
  const knownDois = useMemo(() => {
    const s = new Set();
    for (const e of (existingEntries || [])) {
      if (e.fields?.doi) s.add(String(e.fields.doi).toLowerCase());
    }
    return s;
  }, [existingEntries]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async () => {
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    setErrors([]);
    setTouched(true);
    setExpanded(new Set());
    try {
      const res = await searchWeb(query, 25, mode);
      setResults(res);
      setResolvedMode(res._resolvedMode || mode);
      if (res._errors) setErrors(res._errors);
    } catch (e) {
      setErrors([e.message || String(e)]);
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (ev) => { ev.preventDefault(); run(); };
  const toggleExpand = (i) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const onAdd = async (i, r) => {
    setAdding(prev => new Set(prev).add(i));
    try { await onAddResult(r); }
    finally { setAdding(prev => { const n = new Set(prev); n.delete(i); return n; }); }
  };

  return html`
    <div class="modal-backdrop" onClick=${onClose}>
      <div class="modal" onClick=${(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search the web for references" style="max-width:780px;width:780px;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-head">
          <div>
            <h2 style="margin:0">Search the web for references</h2>
            <div style="font-family:var(--font-serif);font-style:italic;font-size:12.5px;color:var(--ink-muted);margin-top:4px">
              CrossRef + OpenAlex — free, no key. Google Scholar and Web of Science aren't browser-accessible without paid keys.
            </div>
          </div>
          <button class="btn btn-ghost" onClick=${onClose} aria-label="Close">×</button>
        </div>
        <form class="modal-body" onSubmit=${onSubmit}>
          <div style="display:flex;gap:var(--s-2);align-items:center">
            <input
              ref=${inputRef}
              class="input"
              type="search"
              placeholder=${mode === 'author' ? 'Author name (e.g. Sarkar K.)' : mode === 'title' ? 'Title fragment' : 'Keywords, author name, or title fragment…'}
              value=${q}
              onInput=${(e) => setQ(e.target.value)}
              aria-label="Search query"
              style="flex:1"
            />
            <select aria-label="Search mode" value=${mode} onChange=${(e) => setMode(e.target.value)}
                    style="padding:7px 8px;border:1px solid var(--bg-rule);border-radius:var(--r-md);font-size:12.5px;background:var(--bg-card);color:var(--ink-primary);font-family:var(--font-sans)">
              <option value="auto">Auto-detect</option>
              <option value="anywhere">Anywhere</option>
              <option value="author">Author</option>
              <option value="title">Title</option>
            </select>
            <button class="btn btn-primary" type="submit" disabled=${busy || !q.trim()}>
              ${busy ? 'Searching…' : 'Search'}
            </button>
          </div>
          <div style="font-family:var(--font-serif);font-style:italic;font-size:11.5px;color:var(--ink-muted);min-height:14px">
            ${mode === 'auto' && autoHint
              ? 'Auto: this query will be sent as ' + (autoHint === 'author' ? 'an author search' : 'a general search') + '.'
              : mode === 'auto'
                ? 'Auto-detect picks author search for name-shaped queries, general search otherwise.'
                : mode === 'author'
                  ? 'Searching by author name.'
                  : mode === 'title'
                    ? 'Searching by title only.'
                    : 'Searching anywhere (title, abstract, author).'}
          </div>
          ${errors.length > 0 ? html`
            <div style="padding:8px 10px;background:rgba(224, 142, 31, 0.10);border:0.5px solid rgba(224, 142, 31, 0.30);border-radius:var(--r-md);font-size:12px;color:var(--ink-secondary);font-family:var(--font-serif);font-style:italic">
              ${errors.map((e, i) => html`<div key=${i}>${e}</div>`)}
            </div>
          ` : null}
        </form>
        <div style="flex:1;overflow-y:auto;margin-top:var(--s-3);min-height:200px">
          ${busy ? html`
            <div class="empty">Searching CrossRef + OpenAlex…</div>
          ` : !touched ? html`
            <div class="empty">Type a query above and press <strong>Search</strong>. Results stream from both sources, deduped by DOI, ranked by citation count.</div>
          ` : results.length === 0 ? html`
            <div class="empty">
              No matches found${resolvedMode === 'author' ? ' for author search' : resolvedMode === 'title' ? ' in titles' : ''}.
              ${resolvedMode === 'author' ? html`<div style="margin-top:8px;font-size:12px">Try <button class="btn-tiny" onClick=${() => setMode('anywhere')}>Anywhere</button> mode if the author has few indexed papers.</div>` : null}
            </div>
          ` : html`
            <div style="display:flex;flex-direction:column;gap:6px">
              ${results.map((r, i) => {
                const isDup = r.doi && knownDois.has(String(r.doi).toLowerCase());
                const open = expanded.has(i);
                return html`
                  <div key=${i} style=${'padding:10px 12px;background:var(--bg-card);border:0.5px solid var(--bg-rule);border-radius:var(--r-sm);' + (isDup ? 'opacity:0.7' : '')}>
                    <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:3px;flex-wrap:wrap">
                      ${(r.source || []).map(src => html`
                        <span style=${'font-family:var(--font-sans);font-size:9px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;padding:1px 5px;border-radius:2px;' + (src === 'crossref' ? 'background:rgba(26,58,107,0.12);color:var(--accent-deep)' : src === 'openalex' ? 'background:rgba(111,78,147,0.14);color:var(--accent-plum)' : 'background:rgba(43,140,124,0.14);color:var(--accent-spring)')}>${src === 'crossref' ? 'CrossRef' : src === 'openalex' ? 'OpenAlex' : 'S2'}</span>
                      `)}
                      ${typeof r.citationCount === 'number' ? html`
                        <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--ink-secondary);font-weight:600">cited ${shortNumber(r.citationCount)}</span>
                      ` : null}
                      ${r.year ? html`<span style="font-family:var(--font-mono);font-size:10.5px;color:var(--ink-muted)">${r.year}</span>` : null}
                      ${isDup ? html`<span style="font-family:var(--font-sans);font-size:9.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:1px 5px;border-radius:2px;background:var(--bg-tint);color:var(--ink-muted)">already in library</span>` : null}
                    </div>
                    <div style="font-family:var(--font-serif);font-weight:600;font-size:14.5px;line-height:1.32;letter-spacing:-0.005em;color:var(--ink-primary);text-wrap:balance">
                      ${r.title}
                    </div>
                    <div style="font-size:12.5px;color:var(--ink-secondary);margin-top:3px">
                      ${shortAuthors(r.authors)}${r.venue ? html` · <em style="font-family:var(--font-serif)">${r.venue}</em>` : null}
                    </div>
                    ${r.doi ? html`
                      <div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-muted);margin-top:3px;word-break:break-all">
                        doi:<a href=${'https://doi.org/' + r.doi} target="_blank" rel="noopener" style="color:var(--accent-signal)">${r.doi}</a>
                      </div>
                    ` : null}
                    ${r.abstract ? html`
                      <div style="margin-top:6px">
                        <button type="button" class="btn-tiny" onClick=${() => toggleExpand(i)} aria-expanded=${open ? 'true' : 'false'}>
                          ${open ? '− Hide abstract' : '+ Abstract'}
                        </button>
                        ${open ? html`
                          <div style="margin-top:6px;font-family:var(--font-serif);font-size:12.5px;line-height:1.55;color:var(--ink-primary);padding:8px 10px;background:var(--bg-paper);border-left:2px solid var(--accent-signal);border-radius:0 var(--r-sm) var(--r-sm) 0">
                            ${r.abstract}
                          </div>
                        ` : null}
                      </div>
                    ` : null}
                    <div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                      <button type="button" class=${'btn ' + (isDup ? '' : 'btn-primary')} onClick=${() => onAdd(i, r)} disabled=${adding.has(i)}>
                        ${adding.has(i) ? 'Adding…' : (isDup ? '+ Add anyway' : '+ Add to library')}
                      </button>
                      ${r.openAccessUrl && r.openAccessUrl !== ('https://doi.org/' + (r.doi || '')) ? html`
                        <a class="btn-tiny" href=${r.openAccessUrl} target="_blank" rel="noopener">Open access PDF</a>
                      ` : null}
                    </div>
                  </div>
                `;
              })}
            </div>
          `}
        </div>
        <div class="modal-foot">
          <span style="margin-right:auto;font-family:var(--font-serif);font-style:italic;font-size:11.5px;color:var(--ink-muted)">
            ${results.length > 0 ? results.length + ' result' + (results.length === 1 ? '' : 's') : ''}
          </span>
          <button class="btn btn-ghost" onClick=${onClose}>Close</button>
        </div>
      </div>
    </div>
  `;
}

/* ─── PdfPreviewModal ──────────────────────────────────────────────── */
function PdfPreviewModal({ fileMeta, onClose }) {
  const [pdf, setPdf] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.4);
  const [error, setError] = useState(null);
  const canvasRef = useRef(null);

  // Load the PDF once on mount
  useEffect(() => {
    let cancelled = false;
    let urlCleanup = null;
    (async () => {
      try {
        const { pdf, url } = await loadPdfFromFileMeta(fileMeta);
        if (cancelled) {
          URL.revokeObjectURL(url);
          await pdf.destroy().catch(() => {});
          return;
        }
        setPdf(pdf);
        setBlobUrl(url);
        urlCleanup = url;
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (urlCleanup) URL.revokeObjectURL(urlCleanup);
    };
  }, [fileMeta]);

  // Render page on (pdf, page, scale) change
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try { await renderPage(pdf, page, canvasRef.current, scale); }
      catch (e) { if (!cancelled) console.warn('PDF render failed:', e); }
    })();
    return () => { cancelled = true; };
  }, [pdf, page, scale]);

  // Keyboard navigation: ←/→ for pages, Esc to close, +/- for zoom
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setPage(p => pdf ? Math.min(pdf.numPages, p + 1) : p);
      }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setPage(p => Math.max(1, p - 1));
      }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); setScale(s => Math.min(3, s + 0.2)); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setScale(s => Math.max(0.5, s - 0.2)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pdf, onClose]);

  return html`
    <div class="modal-backdrop" onClick=${onClose}>
      <div class="pdf-modal" onClick=${(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label=${'Preview ' + fileMeta.name}>
        <div class="pdf-toolbar">
          <span class="pdf-name" title=${fileMeta.name}>${fileMeta.name}</span>
          <span style="flex:1"></span>
          <button class="btn-tiny" onClick=${() => setPage(p => Math.max(1, p - 1))} disabled=${page <= 1} aria-label="Previous page">‹</button>
          <span class="pdf-pager">${page} / ${pdf ? pdf.numPages : '…'}</span>
          <button class="btn-tiny" onClick=${() => setPage(p => pdf ? Math.min(pdf.numPages, p + 1) : p)} disabled=${pdf ? page >= pdf.numPages : true} aria-label="Next page">›</button>
          <span style="width:8px"></span>
          <button class="btn-tiny" onClick=${() => setScale(s => Math.max(0.5, s - 0.2))} aria-label="Zoom out">−</button>
          <span class="pdf-zoom">${Math.round(scale * 100)}%</span>
          <button class="btn-tiny" onClick=${() => setScale(s => Math.min(3, s + 0.2))} aria-label="Zoom in">+</button>
          <span style="width:8px"></span>
          ${blobUrl ? html`<a class="btn-tiny" href=${blobUrl} target="_blank" rel="noopener">↗ Open</a>` : null}
          <button class="btn-tiny" onClick=${onClose} aria-label="Close">×</button>
        </div>
        <div class="pdf-canvas-wrap">
          ${error ? html`
            <div style="padding:var(--s-6);color:var(--status-error);font-size:13px">${error}</div>
          ` : html`
            <canvas ref=${canvasRef}></canvas>
          `}
        </div>
      </div>
    </div>
  `;
}

/* ─── PandocHelpModal ──────────────────────────────────────────────── */
function PandocHelpModal({ onClose, onExportCsl, bulkCount, totalCount }) {
  const setLabel = bulkCount > 0 ? bulkCount + ' selected' : 'all ' + totalCount + ' references';
  const cmd = 'pandoc paper.docx --citeproc --bibliography refs.json --csl=apa.csl -o paper-final.docx';
  const [copied, setCopied] = useState(false);
  return html`
    <div class="modal-backdrop" onClick=${onClose}>
      <div class="modal" onClick=${(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Use Pothi with Word and Pandoc" style="max-width:620px">
        <div class="modal-head">
          <h2>Use Pothi with Word + Pandoc</h2>
          <button class="btn btn-ghost" onClick=${onClose} aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <ol style="display:flex;flex-direction:column;gap:var(--s-3);padding-left:var(--s-5);font-size:13px;line-height:1.55">
            <li>
              <strong>Cite in your docx</strong> using square-bracket placeholders that
              reference your citekeys, e.g. <code>[@Bernstein2020Polymorphism]</code>
              for one cite, <code>[@Smith2024; @Jones2023]</code> for several. Pandoc
              also accepts page locators: <code>[@Smith2024, p. 42]</code>.
            </li>
            <li>
              <strong>Export ${setLabel}</strong> as CSL-JSON.
              <div style="margin-top:6px">
                <button class="btn btn-primary" onClick=${onExportCsl}>Download CSL-JSON</button>
              </div>
            </li>
            <li>
              <strong>Run Pandoc</strong> in the folder that contains your docx, the
              downloaded JSON (rename to <code>refs.json</code>), and your chosen
              CSL style file (e.g. <code>apa.csl</code> from
              <a href="https://www.zotero.org/styles" target="_blank" rel="noopener">zotero.org/styles</a>).
              <div style="position:relative;margin-top:8px;padding:10px 12px;background:var(--bg-tint);border-radius:var(--r-md);font-family:var(--font-mono);font-size:12px;overflow-x:auto;white-space:pre">
                ${cmd}
                <button
                  class="btn btn-ghost"
                  style="position:absolute;top:6px;right:6px;padding:3px 8px;font-size:11px"
                  onClick=${() => { navigator.clipboard?.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                >${copied ? 'Copied!' : 'Copy'}</button>
              </div>
            </li>
            <li>
              The output <code>paper-final.docx</code> has every <code>[@key]</code>
              replaced with a formatted citation in your chosen style and a
              bibliography appended at the end.
            </li>
          </ol>
          <div style="margin-top:var(--s-4);padding:var(--s-3);background:var(--rh-accent-soft);border-radius:var(--r-md);font-size:12px;color:var(--ink-secondary);line-height:1.5">
            <strong style="color:var(--rh-accent)">Tip.</strong> Click any citekey
            in the list to copy it to your clipboard. Pandoc is the same engine
            that drives Quarto and many academic tools — and an in-browser
            "drop your docx in" version of this workflow is on the roadmap.
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" onClick=${onClose}>Close</button>
        </div>
      </div>
    </div>
  `;
}

/* ─── EntryList ────────────────────────────────────────────────────── */
function EntryList({ entries, selectedId, bulkSelected, onSelect, onToggleBulk }) {
  if (!entries.length) {
    return html`<div class="empty">
      <div style="font-size:16px;margin-bottom:8px">Nothing matches.</div>
      <div style="font-size:13px">Use <strong>+ Add reference</strong>, <strong>Import .bib</strong>, or drop a PDF onto the page.</div>
    </div>`;
  }
  return html`
    <div class="list" role="list">
      ${entries.map(e => {
        const tone = toneFor(e.type);
        const isSel = selectedId === e.id;
        const isBulk = bulkSelected.has(e.id);
        const hasPdf = (e.files || []).some(f => f.kind === 'pdf');
        const venue = e.fields?.journal || e.fields?.booktitle || e.fields?.publisher || e.fields?.school || '';
        const volume = e.fields?.volume || '';
        const pages = e.fields?.pages || '';
        const cites = e.fields?.citationCount;
        const tags = (e.tags || []).slice(0, 4);
        return html`
          <div
            class="row"
            role="listitem"
            aria-selected=${isSel ? 'true' : 'false'}
            data-bulk=${isBulk ? 'true' : 'false'}
            style=${'--row-tone: ' + tone.color}
            onClick=${(ev) => {
              if (ev.shiftKey || ev.metaKey || ev.ctrlKey || bulkSelected.size > 0) {
                onToggleBulk(e.id);
              } else {
                onSelect(e.id);
              }
            }}
          >
            <button
              class="row-check"
              role="checkbox"
              aria-checked=${isBulk ? 'true' : 'false'}
              aria-label=${'Select ' + (e.citekey || 'entry')}
              onClick=${(ev) => { ev.stopPropagation(); onToggleBulk(e.id); }}
            ></button>
            <div class="row-type">
              <span class="row-type-tag">${tone.short}</span>
              <span class="row-year">${e.fields?.year || '—'}</span>
            </div>
            <div class="row-body">
              <div class="row-title">
                ${(e.rating && e.rating >= 5) ? html`<span style="color:var(--accent-spotlight);margin-right:4px" aria-hidden="true">★</span>` : null}
                ${e.fields?.title || '(untitled)'}
              </div>
              <div class="row-meta">
                <span class="row-authors">${shortAuthors(e.fields?.author || e.fields?.editor || '')}</span>
                ${venue ? html`<span class="dot"></span><span class="row-venue">${venue}</span>` : null}
                ${volume ? html`<span class="row-volume"><strong style="font-weight:700;font-style:normal">${volume}</strong>${pages ? ', ' + pages : ''}</span>` : null}
              </div>
              ${tags.length > 0 ? html`
                <div class="row-tagline">
                  ${tags.map(t => html`<span class="row-tag">${t}</span>`)}
                </div>
              ` : null}
            </div>
            <div class="row-aside">
              ${cites != null ? html`
                <span class="row-cites" title=${'Citation count from Semantic Scholar (' + cites + ')'}>
                  <span class="cite-arrow">cited</span> ${shortNumber(cites)}
                </span>
              ` : null}
              ${hasPdf ? html`<span class="row-pdf">PDF</span>` : html`<span class="row-pdf muted">no pdf</span>`}
              ${e.rating ? html`
                <span class="row-rating" title=${e.rating + ' / 5'} aria-label=${'Rating: ' + e.rating + ' of 5'}>
                  ${[1,2,3,4,5].map(i => html`<span class=${i <= e.rating ? 'on' : ''}>●</span>`)}
                </span>
              ` : null}
            </div>
            <button
              class="row-citekey"
              title=${'Click to copy: [@' + (e.citekey || '') + ']'}
              onClick=${(ev) => {
                ev.stopPropagation();
                if (e.citekey) navigator.clipboard?.writeText('[@' + e.citekey + ']');
              }}
              aria-label=${'Copy citation placeholder for ' + (e.citekey || 'this entry')}
            >@${e.citekey || '—'}</button>
          </div>
        `;
      })}
    </div>
  `;
}

/* ─── Detail (inline editor) ───────────────────────────────────────── */
function Detail({ entry, allEntries, onChange, onClose, onDelete, onAttachFiles, onOpenFile, onRemoveFile, onAddTag, onRemoveTag, onSetReading, onSetRating, folderLinked, onToast }) {
  const suggestedTags = useMemo(() => suggestTags(entry, allEntries || [], 6), [entry, allEntries]);
  const [notesMode, setNotesMode] = useState('preview');   // 'edit' | 'preview'
  const previewRef = useRef(null);
  useEffect(() => {
    if (notesMode === 'preview' && previewRef.current) {
      renderMarkdownInto(previewRef.current, entry.notes || '');
    }
  }, [entry.id, entry.notes, notesMode]);

  // Sniff a DOI from either the doi field or a DOI-shaped URL.
  const sniffedDoi = useMemo(() => {
    const direct = entry.fields?.doi && extractDoiFromText(entry.fields.doi);
    if (direct) return direct;
    return (entry.fields?.url && extractDoiFromText(entry.fields.url)) || null;
  }, [entry.fields?.doi, entry.fields?.url]);

  // Track which (entry, DOI) pairs we've already auto-fetched so we don't
  // loop or re-fetch on every render. Cleared on entry switch.
  const fetchedRef = useRef(new Set());
  useEffect(() => { fetchedRef.current = new Set(); setFetchState({ phase: 'idle' }); }, [entry.id]);

  // State machine for the abstract slot. Phases:
  //   'idle'       – haven't tried (or no DOI)
  //   'fetching'   – network call in flight
  //   'no-abstract'– fetch succeeded but neither CrossRef nor OpenAlex
  //                  carries an abstract for this DOI (common for older
  //                  papers, conference proceedings, books, theses)
  //   'failed'     – network error / blocked / 404
  //   'filled'     – abstract was filled (callout renders, this state is
  //                  unused once entry.fields.abstract is non-empty)
  const [fetchState, setFetchState] = useState({ phase: 'idle' });

  // Run the chained fetch. Used by both the auto-fetch effect and the
  // manual "Fetch from DOI" button. Sets fetchState so the UI can show
  // exactly what happened — silent failure is the worst UX.
  const runDoiFetch = useCallback(async (opts = {}) => {
    if (!sniffedDoi) {
      onToast && onToast('No DOI on this entry to fetch from.');
      return;
    }
    setFetchState({ phase: 'fetching' });
    try {
      const r = await fetchDoiMetadata(sniffedDoi);
      const fillable = opts.allFields
        ? ['title','author','editor','journal','booktitle','publisher','address','volume','number','pages','year','month','doi','url','isbn','abstract','citationCount','influentialCitationCount']
        : ['abstract','citationCount','influentialCitationCount','doi'];
      const patch = {};
      for (const k of fillable) {
        if (r.fields?.[k] && !(entry.fields?.[k] && String(entry.fields[k]).trim())) patch[k] = r.fields[k];
      }
      const gotAbstract = !!patch.abstract;
      if (Object.keys(patch).length > 0) onChange({ fields: patch });
      if (gotAbstract) {
        setFetchState({ phase: 'filled' });
        onToast && onToast('Filled abstract from CrossRef + OpenAlex.');
      } else {
        // Fetch worked but no abstract is published anywhere we can see.
        setFetchState({ phase: 'no-abstract' });
        if (opts.allFields) {
          onToast && onToast(Object.keys(patch).length > 0
            ? 'Filled ' + Object.keys(patch).length + ' field' + (Object.keys(patch).length === 1 ? '' : 's') + '. No abstract available from public sources for this DOI.'
            : 'Already complete — and no abstract is available from public sources for this DOI.');
        }
      }
    } catch (e) {
      setFetchState({ phase: 'failed', error: e.message || 'network error' });
      if (opts.allFields) onToast && onToast('Fetch failed: ' + (e.message || 'unknown'));
    }
  }, [sniffedDoi, entry.fields, onChange, onToast]);

  // Auto-fetch on entry-switch when DOI is present and abstract is empty.
  // Debounce is short (400 ms) — entries don't switch many times per
  // second and waiting longer just makes the empty state feel broken.
  useEffect(() => {
    if (!sniffedDoi) { setFetchState({ phase: 'idle' }); return; }
    const hasAbstract = !!(entry.fields?.abstract && entry.fields.abstract.trim().length >= 40);
    if (hasAbstract) { setFetchState({ phase: 'filled' }); return; }
    const key = entry.id + '|' + sniffedDoi.toLowerCase();
    if (fetchedRef.current.has(key)) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      fetchedRef.current.add(key);
      runDoiFetch({ allFields: false });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [entry.id, sniffedDoi, entry.fields?.abstract, runDoiFetch]);

  // Manual refetch — fills any empty field, surfaces full toast.
  const refetchFromDoi = useCallback(() => runDoiFetch({ allFields: true }), [runDoiFetch]);
  const autoFetchBusy = fetchState.phase === 'fetching';
  const typeDef = ENTRY_TYPES[entry.type] || ENTRY_TYPES.misc;
  const tone = toneFor(entry.type);
  const fields = [...(typeDef.required || []), ...(typeDef.optional || [])];
  const customFields = Object.keys(entry.fields || {}).filter(k => !fields.includes(k));
  const venue = entry.fields?.journal || entry.fields?.booktitle || entry.fields?.publisher || entry.fields?.school || '';
  const volume = entry.fields?.volume || '';
  const pages = entry.fields?.pages || '';
  const cites = entry.fields?.citationCount;
  const influential = entry.fields?.influentialCitationCount;
  const readingLabel = (entry.reading || 'unread').replace(/^./, c => c.toUpperCase());
  return html`
    <aside class="detail" aria-label="Entry detail" style=${'--row-tone: ' + tone.color}>
      <div class="detail-eyebrow">
        <span class="pill">${tone.label}</span>
        <span class="citekey">@${entry.citekey || '—'}</span>
        <button class="detail-close" onClick=${onClose} aria-label="Close detail">×</button>
      </div>

      <h2 class="detail-title">${entry.fields?.title || '(untitled)'}</h2>
      <div class="detail-byline">${entry.fields?.author || entry.fields?.editor || '—'}</div>
      ${venue || entry.fields?.year || entry.fields?.doi ? html`
        <div class="detail-venue">
          <div class="venue-line">
            ${venue ? html`<em>${venue}</em>` : null}
            ${volume ? html`<span><strong style="font-style:normal;font-weight:700">${volume}</strong>${pages ? ', ' + pages : ''}</span>` : null}
            ${entry.fields?.year ? html`<span>· ${entry.fields.year}</span>` : null}
            ${sniffedDoi ? html`
              <button class="btn-tiny" onClick=${refetchFromDoi} disabled=${autoFetchBusy} title=${'Fill empty fields from CrossRef + OpenAlex (DOI: ' + sniffedDoi + ')'} style="margin-left:auto">
                ${autoFetchBusy ? 'Fetching…' : '↻ Fetch metadata'}
              </button>
            ` : null}
          </div>
          ${entry.fields?.doi ? html`<span class="doi">doi:${entry.fields.doi}</span>` : null}
        </div>
      ` : null}

      <div class="detail-divider"></div>

      ${entry.fields?.abstract ? html`
        <div class="detail-abstract">${entry.fields.abstract}</div>
      ` : (sniffedDoi ? html`
        <div class="detail-abstract" style=${'background:var(--bg-tint);font-style:italic;color:var(--ink-muted);border-left-color:' + (fetchState.phase === 'failed' ? 'var(--accent-signal)' : 'var(--accent-amber)')}>
          ${fetchState.phase === 'fetching' ? 'Fetching abstract from CrossRef + OpenAlex…'
            : fetchState.phase === 'no-abstract' ? html`
                No abstract is published in CrossRef or OpenAlex for this DOI.
                Older papers, conference proceedings, books, and theses often have none on file.
                <button class="btn-tiny" style="margin-left:6px;vertical-align:baseline" onClick=${refetchFromDoi}>Try again</button>
              `
            : fetchState.phase === 'failed' ? html`
                <span style="color:var(--accent-signal)">Fetch failed: ${fetchState.error}.</span>
                <button class="btn-tiny" style="margin-left:6px;vertical-align:baseline" onClick=${refetchFromDoi}>Retry</button>
              `
            : html`No abstract yet. <button class="btn-tiny" style="margin-left:6px;vertical-align:baseline" onClick=${refetchFromDoi}>Fetch from DOI</button>`}
        </div>
      ` : null)}

      <div class="detail-stats">
        <div class="detail-stat">
          <div class="stat-num">${cites != null ? shortNumber(cites) : '—'}</div>
          <div class="stat-label">Citations</div>
        </div>
        <div class="detail-stat">
          <div class="stat-num">${influential != null ? shortNumber(influential) : '—'}</div>
          <div class="stat-label">Influential</div>
        </div>
        <div class="detail-stat">
          <div class="stat-num" style="color:var(--accent-signal)">${readingLabel}</div>
          <div class="stat-label">Status</div>
        </div>
      </div>

      <div style="display:flex;align-items:baseline;gap:var(--s-3);margin-top:var(--s-2)">
        <div class="section-label" style="margin:0">Citekey</div>
        <input
          class="input"
          style="font-family:var(--font-mono);padding:4px 8px;font-size:12px;flex:1"
          value=${entry.citekey || ''}
          onChange=${(e) => onChange({ citekey: e.target.value })}
          aria-label="Citation key"
        />
      </div>
      <div>
        <div class="detail-row">
          <span class="label">Type</span>
          <select class="select" value=${entry.type} onChange=${(e) => onChange({ type: e.target.value })} aria-label="Entry type">
            ${Object.entries(ENTRY_TYPES).map(([id, def]) => html`<option value=${id}>${def.label}</option>`)}
          </select>
        </div>
        ${fields.map(name => {
          const meta = FIELDS[name] || { type: 'string', label: name };
          const isRequired = typeDef.required?.includes(name);
          return html`
            <div class="detail-row">
              <span class="label">${meta.label}${isRequired ? ' *' : ''}</span>
              ${meta.type === 'text' ? html`
                <textarea
                  rows="3"
                  value=${entry.fields?.[name] || ''}
                  onInput=${(e) => onChange({ fields: { [name]: e.target.value } })}
                  placeholder=${meta.desc || ''}
                ></textarea>
              ` : html`
                <input
                  type=${meta.type === 'year' ? 'number' : meta.type === 'url' || meta.type === 'doi' ? 'text' : 'text'}
                  value=${entry.fields?.[name] || ''}
                  onInput=${(e) => onChange({ fields: { [name]: e.target.value } })}
                  placeholder=${meta.desc || ''}
                />
              `}
            </div>
          `;
        })}
        ${customFields.length > 0 ? html`
          <div style="margin-top:var(--s-4);padding-top:var(--s-3);border-top:0.5px solid var(--bg-rule)">
            <div class="section-label">Custom fields</div>
            ${customFields.map(name => html`
              <div class="detail-row">
                <span class="label">${name}</span>
                <input
                  value=${entry.fields[name] || ''}
                  onInput=${(e) => onChange({ fields: { [name]: e.target.value } })}
                />
              </div>
            `)}
          </div>
        ` : null}
      </div>
      <div class="reading-section" style="margin-top:var(--s-4);padding-top:var(--s-3);border-top:0.5px solid var(--bg-rule);display:flex;align-items:center;gap:var(--s-4);flex-wrap:wrap">
        <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:140px">
          <div class="section-label" style="margin:0">Reading</div>
          <select aria-label="Reading status" value=${entry.reading || 'unread'} onChange=${(e) => onSetReading(e.target.value)} style="background:var(--bg-card);border:1px solid var(--bg-rule);border-radius:var(--r-md);padding:5px 8px;font-size:12.5px;color:var(--ink-primary);font-family:var(--font-sans)">
            <option value="unread">Unread</option>
            <option value="reading">Reading</option>
            <option value="read">Read</option>
            <option value="reviewing">Reviewing</option>
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div class="section-label" style="margin:0">Rating</div>
          <div class="stars" role="radiogroup" aria-label="Rating">
            ${[1,2,3,4,5].map(n => html`
              <button class=${'star ' + ((entry.rating || 0) >= n ? 'on' : 'off')}
                      onClick=${() => onSetRating((entry.rating === n) ? n - 1 : n)}
                      role="radio"
                      aria-checked=${(entry.rating || 0) >= n ? 'true' : 'false'}
                      aria-label=${n + ' star' + (n === 1 ? '' : 's')}>★</button>
            `)}
          </div>
        </div>
      </div>
      <div class="tags-section" style="margin-top:var(--s-4);padding-top:var(--s-3);border-top:0.5px solid var(--bg-rule)">
        <div class="section-label">Tags</div>
        <div class="tag-row">
          ${(entry.tags || []).map(t => html`
            <span class="tag-chip">
              ${t}<button class="tx" onClick=${() => onRemoveTag(t)} aria-label=${'Remove tag ' + t}>×</button>
            </span>
          `)}
          ${(entry.tags || []).length === 0 ? html`
            <span class="tag-empty">No tags yet.</span>
          ` : null}
        </div>
        ${suggestedTags.length > 0 ? html`
          <div class="suggested-row">
            <span class="suggested-label">Suggested:</span>
            ${suggestedTags.map(t => html`
              <button class="tag-suggest" onClick=${() => onAddTag(t)} title=${'Add tag #' + t} aria-label=${'Add tag ' + t}>
                + #${t}
              </button>
            `)}
          </div>
        ` : null}
      </div>
      <div class="files-section" style="margin-top:var(--s-4);padding-top:var(--s-3);border-top:0.5px solid var(--bg-rule)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--s-2)">
          <div class="section-label" style="margin:0">Files</div>
          ${onAttachFiles ? html`
            <button class="btn-tiny" onClick=${onAttachFiles} title=${folderLinked ? 'Pick files from your linked library folder' : 'Pick files from anywhere (no library folder linked)'}>+ Attach</button>
          ` : null}
        </div>
        ${(entry.files || []).length === 0 ? html`
          <div style="font-size:12px;color:var(--ink-muted);font-style:italic;padding:var(--s-2) 0">
            ${folderLinked ? 'No files attached. Click + Attach to add a PDF / slides / etc.' : 'No files attached. Link a library folder in the sidebar first.'}
          </div>
        ` : html`
          <div style="display:flex;flex-direction:column;gap:4px">
            ${(entry.files || []).map(f => html`
              <div class="file-row" data-kind=${f.kind} data-orphan=${f.orphan ? 'true' : 'false'}>
                <span class="file-kind-badge">${f.kind}</span>
                <button class="file-name" title=${f.orphan ? 'File is missing from the linked folder. Last seen: ' + f.name : 'Open ' + f.name} onClick=${() => onOpenFile(f)}>${f.name}</button>
                <span class="file-size">${fmtBytes(f.size)}</span>
                <button class="btn-tiny btn-tiny-danger" onClick=${() => onRemoveFile(f.id)} aria-label=${'Detach ' + f.name}>×</button>
              </div>
            `)}
          </div>
        `}
      </div>
      <div class="notes-section" style="margin-top:var(--s-4);padding-top:var(--s-3);border-top:0.5px solid var(--bg-rule)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--s-2)">
          <div class="section-label" style="margin:0">Notes (Markdown)</div>
          <div style="display:flex;gap:4px">
            <button class=${'btn-tiny' + (notesMode === 'edit' ? ' btn-tiny-active' : '')} onClick=${() => setNotesMode('edit')} aria-pressed=${notesMode === 'edit' ? 'true' : 'false'}>Edit</button>
            <button class=${'btn-tiny' + (notesMode === 'preview' ? ' btn-tiny-active' : '')} onClick=${() => setNotesMode('preview')} aria-pressed=${notesMode === 'preview' ? 'true' : 'false'}>Preview</button>
          </div>
        </div>
        ${notesMode === 'edit' ? html`
          <textarea
            class="notes-editor"
            placeholder="Markdown supported: # heading, **bold**, *italic*, \`code\`, [label](url), - bullet, > quote"
            value=${entry.notes || ''}
            onInput=${(e) => onChange({ notes: e.target.value })}
          ></textarea>
        ` : html`
          <div class="notes-preview" ref=${previewRef}>
            ${(!entry.notes) ? html`<div style="font-style:italic;color:var(--ink-muted);font-size:12px">No notes yet. Click Edit to write some.</div>` : null}
          </div>
        `}
      </div>
      <div class="detail-actions">
        <button class="btn btn-danger" onClick=${onDelete}>Delete entry</button>
        <span style="flex:1"></span>
      </div>
    </aside>
  `;
}

/* ─── EntryModal (new entry) ───────────────────────────────────────── */
function EntryModal({ onClose, onSave, onToast, existingEntries }) {
  const [draft, setDraft] = useState({
    type: 'article',
    citekey: '',
    fields: {},
    tags: [], collections: [], files: [], notes: '',
  });
  const [doi, setDoi] = useState('');
  const [doiBusy, setDoiBusy] = useState(false);
  const [doiErr, setDoiErr] = useState(null);
  const typeDef = ENTRY_TYPES[draft.type] || ENTRY_TYPES.misc;
  const fields = [...(typeDef.required || []), ...(typeDef.optional || [])];
  const update = (patch) => setDraft(d => ({ ...d, ...patch, fields: { ...d.fields, ...(patch.fields || {}) } }));

  const fetchByIdentifier = async () => {
    setDoiErr(null);
    const v = doi.trim();
    if (!v) { setDoiErr('Paste a DOI, arXiv ID, or ISBN.'); return; }
    setDoiBusy(true);
    try {
      let r, source = 'CrossRef';
      // DOI: starts with "10.<digits>/"
      if (/^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\//i.test(v)) {
        r = await fetchDoiMetadata(v);
      // arXiv: "arXiv:1234.56789" or bare "1234.56789"
      } else if (/^(?:arXiv:)?\s*\d{4}\.\d{4,5}(?:v\d+)?$/i.test(v)) {
        r = await fetchArxivMetadata(v);
        source = 'arXiv';
      // ISBN: 10 or 13 digits, optionally hyphenated
      } else if (/^(?:ISBN:?\s*)?[\d-]{10,17}[xX]?$/.test(v) && v.replace(/[\s-]/g, '').replace(/^ISBN:?/i, '').match(/^\d{9,13}[xX]?$/)) {
        r = await fetchIsbnMetadata(v);
        source = 'OpenLibrary';
      } else {
        throw new Error('Not recognized as a DOI, arXiv ID, or ISBN.');
      }
      // Duplicate detection — warn if this DOI/ISBN is already in the
      // library. We don't block: the user might want to refresh metadata
      // on an existing entry. Just surface the conflict clearly.
      const dupKey = (r.fields.doi && r.fields.doi.toLowerCase()) || (r.fields.isbn && r.fields.isbn.toLowerCase()) || null;
      let dup = null;
      if (dupKey && existingEntries) {
        dup = existingEntries.find(e =>
          (e.fields?.doi && e.fields.doi.toLowerCase() === dupKey) ||
          (e.fields?.isbn && e.fields.isbn.toLowerCase() === dupKey));
      }
      if (dup) {
        const goAhead = confirm(
          'A reference with this DOI/ISBN is already in your library:\n\n' +
          '  ' + dup.citekey + ' — ' + (dup.fields?.title || '(untitled)').slice(0, 80) +
          '\n\nFill this form anyway? (Cancel to leave the existing entry alone.)'
        );
        if (!goAhead) { setDoiBusy(false); return; }
      }
      setDraft(d => ({
        ...d,
        type: r.type || d.type,
        fields: { ...d.fields, ...r.fields },
        tags: Array.from(new Set([...(d.tags || []), ...(r.tags || [])])),
      }));
      onToast && onToast('Filled from ' + source + '.' + (dup ? ' Note: duplicate of ' + dup.citekey + '.' : ''));
    } catch (e) {
      setDoiErr(e.message || String(e));
    } finally {
      setDoiBusy(false);
    }
  };

  return html`
    <div class="modal-backdrop" onClick=${onClose}>
      <div class="modal" onClick=${(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New reference">
        <div class="modal-head">
          <h2>New reference</h2>
          <button class="btn btn-ghost" onClick=${onClose} aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="doi-row" style="display:flex;gap:var(--s-2);align-items:flex-end;padding:var(--s-3);background:var(--rh-accent-soft);border-radius:var(--r-md);margin-bottom:var(--s-2)">
            <div style="flex:1">
              <label class="label" style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--rh-accent);display:block;margin-bottom:4px">Auto-fill from DOI / arXiv ID / ISBN</label>
              <input
                class="input"
                placeholder="10.1021/jacs.0c12345 — or — 2401.04088 — or — 9780471185437"
                value=${doi}
                onInput=${(e) => setDoi(e.target.value)}
                onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchByIdentifier(); } }}
                disabled=${doiBusy}
                style="background:var(--bg-elevated)"
              />
              ${doiErr ? html`<div style="color:var(--status-error);font-size:11px;margin-top:4px">${doiErr}</div>` : null}
            </div>
            <button class="btn btn-primary" onClick=${fetchByIdentifier} disabled=${doiBusy}>
              ${doiBusy ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
          <div class="detail-row">
            <span class="label">Type</span>
            <select class="select" value=${draft.type} onChange=${(e) => update({ type: e.target.value })}>
              ${Object.entries(ENTRY_TYPES).map(([id, def]) => html`<option value=${id}>${def.label}</option>`)}
            </select>
          </div>
          ${fields.map(name => {
            const meta = FIELDS[name] || { type: 'string', label: name };
            const isRequired = typeDef.required?.includes(name);
            return html`
              <div class="detail-row">
                <span class="label">${meta.label}${isRequired ? ' *' : ''}</span>
                ${meta.type === 'text' ? html`
                  <textarea rows="2" value=${draft.fields[name] || ''}
                            onInput=${(e) => update({ fields: { [name]: e.target.value } })}
                            placeholder=${meta.desc || ''}></textarea>
                ` : html`
                  <input value=${draft.fields[name] || ''}
                         onInput=${(e) => update({ fields: { [name]: e.target.value } })}
                         placeholder=${meta.desc || ''} />
                `}
              </div>
            `;
          })}
          <div class="detail-row">
            <span class="label">Citekey</span>
            <input value=${draft.citekey} onInput=${(e) => update({ citekey: e.target.value })}
                   placeholder="auto-generated if blank" style="font-family:var(--font-mono);font-size:12px" />
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" onClick=${onClose}>Cancel</button>
          <button class="btn btn-primary" onClick=${() => onSave(draft)}>Save reference</button>
        </div>
      </div>
    </div>
  `;
}

/* ─── helpers ──────────────────────────────────────────────────────── */
function entryMatchesSearch(e, q) {
  if ((e.citekey || '').toLowerCase().includes(q)) return true;
  const f = e.fields || {};
  for (const k of ['title', 'author', 'editor', 'journal', 'booktitle', 'abstract', 'note']) {
    if ((f[k] || '').toLowerCase().includes(q)) return true;
  }
  if ((e.tags || []).some(t => t.toLowerCase().includes(q))) return true;
  return false;
}

function shortNumber(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return String(n);
  if (v >= 1000) return Math.round(v / 100) / 10 + 'k';
  return String(v);
}

// Sort comparator factory. Modes are stable strings persisted in
// localStorage; new modes can be added freely without migration.
function sortFnFor(mode) {
  const yearOf  = (e) => parseInt(e.fields?.year || '0', 10) || 0;
  const titleOf = (e) => (e.fields?.title || '').toLowerCase();
  const firstAuthor = (e) => {
    const a = e.fields?.author || e.fields?.editor || '';
    if (!a) return 'zzz';
    const first = a.split(/\s+and\s+/i)[0] || '';
    if (first.includes(',')) return first.split(',')[0].trim().toLowerCase();
    const parts = first.trim().split(/\s+/);
    return (parts[parts.length - 1] || '').toLowerCase();
  };
  const ckOf = (e) => (e.citekey || '').toLowerCase();
  const addedOf = (e) => e.createdAt || 0;

  switch (mode) {
    case 'year-asc':    return (a, b) => yearOf(a) - yearOf(b)  || ckOf(a).localeCompare(ckOf(b));
    case 'title-asc':   return (a, b) => titleOf(a).localeCompare(titleOf(b));
    case 'title-desc':  return (a, b) => titleOf(b).localeCompare(titleOf(a));
    case 'author-asc':  return (a, b) => firstAuthor(a).localeCompare(firstAuthor(b)) || yearOf(b) - yearOf(a);
    case 'author-desc': return (a, b) => firstAuthor(b).localeCompare(firstAuthor(a)) || yearOf(b) - yearOf(a);
    case 'citekey':     return (a, b) => ckOf(a).localeCompare(ckOf(b));
    case 'added-asc':   return (a, b) => addedOf(a) - addedOf(b);
    case 'added-desc':  return (a, b) => addedOf(b) - addedOf(a);
    case 'year-desc':
    default:            return (a, b) => yearOf(b) - yearOf(a) || ckOf(a).localeCompare(ckOf(b));
  }
}

async function uniqueFileName(folderHandle, desired) {
  // Ensure the chosen filename doesn't collide. If it does, append " (2)".
  const dot = desired.lastIndexOf('.');
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext  = dot > 0 ? desired.slice(dot) : '';
  let attempt = desired;
  for (let i = 2; i < 200; i++) {
    try {
      await folderHandle.getFileHandle(attempt);
      attempt = stem + ' (' + i + ')' + ext;
    } catch (e) {
      // NotFoundError = available
      return attempt;
    }
  }
  return attempt;
}

function downloadBlob(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ─── boot ─────────────────────────────────────────────────────────── */
const mount = document.getElementById('app');
mount.removeAttribute('aria-busy');
mount.innerHTML = '';
render(html`<${App}/>`, mount);

// Expose a tiny inspection API for now.
window.Pothi = {
  listEntries, putEntry, deleteEntry,
  emitBib, parseBib, emitRis, emitCsl,
  fetchDoiMetadata, fetchArxivMetadata,
  generateCitekey,
  isFsaSupported, getFolder, pickFolder,
  extractFromPdf, suggestTags,
  processDocx, STYLES,
  ENTRY_TYPES, FIELDS,
};
// Legacy alias — old smoke tests + any earlier external scripts keep
// working. Safe to remove once nothing references the old global.
window.RefMgr = window.Pothi;
