// Manuscript helpers — operations on top of the IDB CRUD in db.js.
//
// The manuscript model: each manuscript curates an ordered list of
// references cited from the global library. A reference is identified
// by entry.id; the manuscript carries a per-citation rationale and an
// optional folderHandle for auto-export of `references.bib` / `refs.json`.

import { emitBib } from './bibtex.js';
import { emitCsl } from './export-csl.js';

/* Resolve a manuscript's `cited` array to entry objects, in order.
 * Missing entries (deleted from the global library) are skipped. */
export function manuscriptCitedEntries(ms, allEntries) {
  if (!ms || !Array.isArray(ms.cited)) return [];
  const byId = new Map(allEntries.map(e => [e.id, e]));
  const out = [];
  for (const c of ms.cited) {
    const e = byId.get(c.entryId);
    if (e) out.push(e);
  }
  return out;
}

/* Add a citation to a manuscript. Idempotent — adding an entry that's
 * already cited returns the manuscript unchanged. */
export function citeInManuscript(ms, entryId, rationale = '') {
  if (!ms) return ms;
  if ((ms.cited || []).some(c => c.entryId === entryId)) return ms;
  return {
    ...ms,
    cited: [...(ms.cited || []), { entryId, rationale, addedAt: Date.now() }],
    updatedAt: Date.now(),
  };
}

export function uncite(ms, entryId) {
  if (!ms) return ms;
  return {
    ...ms,
    cited: (ms.cited || []).filter(c => c.entryId !== entryId),
    updatedAt: Date.now(),
  };
}

export function updateRationale(ms, entryId, rationale) {
  if (!ms) return ms;
  return {
    ...ms,
    cited: (ms.cited || []).map(c => c.entryId === entryId ? { ...c, rationale } : c),
    updatedAt: Date.now(),
  };
}

/* Move a citation up or down in the order. */
export function reorderCitation(ms, entryId, delta) {
  if (!ms) return ms;
  const arr = [...(ms.cited || [])];
  const idx = arr.findIndex(c => c.entryId === entryId);
  if (idx < 0) return ms;
  const newIdx = Math.max(0, Math.min(arr.length - 1, idx + delta));
  if (newIdx === idx) return ms;
  const [item] = arr.splice(idx, 1);
  arr.splice(newIdx, 0, item);
  return { ...ms, cited: arr, updatedAt: Date.now() };
}

/* Build the bibliography text in BibTeX + CSL-JSON for export. */
export function buildManuscriptBib(ms, allEntries) {
  const cited = manuscriptCitedEntries(ms, allEntries);
  return emitBib(cited);
}
export function buildManuscriptCsl(ms, allEntries) {
  const cited = manuscriptCitedEntries(ms, allEntries);
  return emitCsl(cited);
}

/* Write `references.bib` + `refs.json` into the manuscript's folder.
 * Soft-fails on permission lapse. Returns true on success. */
export async function writeManuscriptToFolder(ms, allEntries) {
  if (!ms || !ms.folderHandle) return false;
  const fh = ms.folderHandle;
  // Permission may need re-grant
  try {
    if (typeof fh.queryPermission === 'function') {
      let perm = await fh.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await fh.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return false;
    }
    const bib = buildManuscriptBib(ms, allEntries);
    const csl = buildManuscriptCsl(ms, allEntries);
    await writeFile(fh, 'references.bib', bib);
    await writeFile(fh, 'refs.json', csl);
    return true;
  } catch (e) {
    console.warn('[manuscript] auto-export failed:', e);
    return false;
  }
}

async function writeFile(folderHandle, name, contents) {
  const handle = await folderHandle.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(contents);
  await w.close();
}
