// Watch-folder scanner. Walks the linked directory recursively, finds
// every PDF, dedupes against entries by SHA-256, returns a list of
// "new" PDFs ready for processing. The actual import pipeline (extract
// → CrossRef → entry creation) lives in app.js so it can share state
// with the React layer.
//
// Recursive `for await … of handle.entries()` is supported in modern
// Chromium. File handles obtained from a directory walk inherit the
// parent directory's permission grant, so attached files don't trigger
// per-file permission prompts post-restart.

import { hashFile } from './folder.js';

const SKIP_DIRS = /^([._]|node_modules$|\.git$|__MACOSX$)/;

/* Recursively collect every file matching `predicate` (default: PDFs)
 * under the given directory handle. Yields { handle, name, path, dir }
 * for each match. */
export async function* walkFolder(handle, opts = {}, prefix = '') {
  const predicate = opts.predicate || ((name) => /\.pdf$/i.test(name));
  for await (const [name, child] of handle.entries()) {
    if (child.kind === 'file') {
      if (predicate(name)) {
        yield { handle: child, name, path: prefix ? prefix + '/' + name : name, dir: prefix };
      }
    } else if (child.kind === 'directory') {
      if (SKIP_DIRS.test(name)) continue;
      yield* walkFolder(child, opts, prefix ? prefix + '/' + name : name);
    }
  }
}

/* Materialize the walk into an array. */
export async function collectPdfs(handle) {
  const out = [];
  for await (const item of walkFolder(handle)) out.push(item);
  return out;
}

/* Build a quick index of (sha256 → file metadata) from a library array,
 * so we can filter out PDFs already represented as attachments. */
export function buildKnownHashIndex(library) {
  const ix = new Map();
  for (const e of library || []) {
    for (const f of e.files || []) {
      if (f.sha256) ix.set(f.sha256, { entryId: e.id, fileId: f.id, name: f.name });
    }
  }
  return ix;
}

/* Hash every file in `items` and return:
 *   { fresh, seenHashes } where
 *     fresh       = items whose hash isn't in knownHashes (with .file, .sha256 attached)
 *     seenHashes  = a Set of EVERY hash encountered this run (used by
 *                   the caller to compute orphan attachments).
 * onProgress({ current, total, label }) is called along the way. */
export async function dedupeByHash(items, knownHashes, onProgress) {
  const fresh = [];
  const seenHashes = new Set();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (onProgress) onProgress({ current: i + 1, total: items.length, label: 'Hashing ' + it.name });
    let file;
    try { file = await it.handle.getFile(); }
    catch (e) { continue; }
    const sha256 = await hashFile(file);
    seenHashes.add(sha256);
    if (knownHashes.has(sha256)) continue;
    fresh.push({ ...it, file, sha256 });
  }
  return { fresh, seenHashes };
}
