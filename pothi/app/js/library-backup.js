// Full-library backup / restore.
//   - JSON dump of every entry (file handles stripped — they're per-origin
//     and don't survive a backup anyway; restore re-anchors via SHA-256
//     during the next folder scan).
//   - Optional auto-write of `_pothi-library.json` into the linked
//     folder so port changes / browser-profile changes don't lose the
//     library: the folder file is the persistent source of truth.

import { listEntries, deleteEntry, bulkPut } from './db.js';

export const BACKUP_FILENAME = '_pothi-library.json';
// Earlier name; readBackupFromFolder still picks it up so existing
// users who linked a folder under the previous name keep their backup.
const LEGACY_BACKUP_FILENAME = '_refmgr-library.json';
const SCHEMA = 1;

export async function buildLibraryBackup() {
  const entries = await listEntries();
  return {
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    app: 'Pothi',
    entries: entries.map(stripHandlesFromEntry),
  };
}

function stripHandlesFromEntry(e) {
  return {
    ...e,
    files: (e.files || []).map(f => {
      const out = { ...f };
      delete out._handle;
      return out;
    }),
  };
}

export function backupAsBlob(backup) {
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
}

/* Apply a backup. mode 'replace' wipes existing entries first; 'merge'
 * (default) just upserts — backup entry IDs collide → existing entries
 * are overwritten. */
export async function applyLibraryBackup(backup, opts = {}) {
  if (!backup || !Array.isArray(backup.entries)) {
    throw new Error('Not a valid library backup (no entries array).');
  }
  if (opts.mode === 'replace') {
    const existing = await listEntries();
    for (const e of existing) await deleteEntry(e.id);
  }
  // bulkPut handles upsert by ID; entries from the backup are stamped
  // with new updatedAt, original createdAt preserved if present.
  await bulkPut(backup.entries);
  return backup.entries.length;
}

/* Look for the auto-backup file in a linked folder. Returns the parsed
 * JSON or null. Silent on failure — many folders won't have one.
 * Tries the new name first, then falls back to the legacy name so
 * pre-Pothi backups still load. */
export async function readBackupFromFolder(folderHandle) {
  if (!folderHandle) return null;
  for (const name of [BACKUP_FILENAME, LEGACY_BACKUP_FILENAME]) {
    try {
      const fh = await folderHandle.getFileHandle(name);
      const file = await fh.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.entries)) return parsed;
    } catch (_) { /* try next name */ }
  }
  return null;
}

export async function writeBackupToFolder(folderHandle, backup) {
  if (!folderHandle) return false;
  try {
    const fh = await folderHandle.getFileHandle(BACKUP_FILENAME, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(backup, null, 2));
    await w.close();
    return true;
  } catch (e) {
    console.warn('[refmgr] auto-backup write failed:', e);
    return false;
  }
}
