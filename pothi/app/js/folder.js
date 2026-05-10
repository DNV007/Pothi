// File System Access API integration. Single linked folder per library;
// the directory handle persists in IndexedDB. Attached files are stored
// as FileSystemFileHandle inside entry.files[]._handle — IDB serializes
// them transparently. Permissions don't survive a tab restart but the
// handle does, so the UX is "click → browser prompts once per session".
//
// Supported in Chromium-based browsers (Chrome, Edge, Brave, Opera).
// Firefox/Safari have no FSA today; the UI shows a clear notice and
// falls back to library-only mode (no file linking).

import { getMeta, setMeta } from './db.js';

const FOLDER_KEY = 'libraryFolderHandle';

export function isFsaSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickFolder() {
  if (!isFsaSupported()) {
    throw new Error('This browser does not support folder linking. Use Chrome, Edge, Brave, or another Chromium-based browser.');
  }
  // The `id` arg makes the picker remember its last location per-app.
  const handle = await window.showDirectoryPicker({
    mode: 'readwrite',
    id: 'refmgr-library',
  });
  await setMeta(FOLDER_KEY, handle);
  return handle;
}

export async function getFolder() {
  return await getMeta(FOLDER_KEY);
}

export async function forgetFolder() {
  await setMeta(FOLDER_KEY, null);
}

export async function checkFolderPermission(handle) {
  if (!handle || !handle.queryPermission) return 'denied';
  return await handle.queryPermission({ mode: 'readwrite' });
}

export async function requestFolderPermission(handle) {
  if (!handle) return 'denied';
  return await handle.requestPermission({ mode: 'readwrite' });
}

/* Open the OS file picker, defaulting to the linked folder if given. */
export async function pickFiles(folderHandle) {
  if (!isFsaSupported()) {
    throw new Error('This browser does not support file picking via the File System Access API.');
  }
  const opts = {
    multiple: true,
    types: [{
      description: 'Reference attachments',
      accept: {
        'application/pdf': ['.pdf'],
        'application/epub+zip': ['.epub'],
        'application/msword': ['.doc'],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        'application/vnd.ms-powerpoint': ['.ppt'],
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
        'text/html': ['.html', '.htm'],
        'text/plain': ['.txt', '.md'],
        'image/*': ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.svg', '.webp'],
      },
    }],
  };
  if (folderHandle) opts.startIn = folderHandle;
  return await window.showOpenFilePicker(opts);
}

/* SHA-256 in hex — used as a stable content anchor so the link can be
   re-resolved in the future even if the file is moved/renamed. */
export async function hashFile(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

const KIND_BY_EXT = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc',
  ppt: 'slide', pptx: 'slide', odp: 'slide', key: 'slide',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet',
  html: 'web', htm: 'web', mhtml: 'web',
  epub: 'book', mobi: 'book', azw3: 'book',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', tif: 'image', tiff: 'image',
  mp3: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio', ogg: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video',
  zip: 'archive', tar: 'archive', gz: 'archive', '7z': 'archive',
};
export function detectKind(name, mime) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (KIND_BY_EXT[ext]) return KIND_BY_EXT[ext];
  if (mime) {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'application/pdf') return 'pdf';
  }
  return 'file';
}

export function newFileId() {
  return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/* Build the metadata record we store in entry.files[]. */
export async function attachFromHandle(handle) {
  const file = await handle.getFile();
  let sha256 = '';
  try { sha256 = await hashFile(file); } catch (e) { /* large files etc — leave empty */ }
  return {
    id: newFileId(),
    name: file.name,
    kind: detectKind(file.name, file.type),
    mime: file.type || '',
    size: file.size,
    sha256,
    addedAt: Date.now(),
    _handle: handle,
  };
}

/* Open an attached file in a new tab. Modern browsers render PDFs,
   images, plain text inline; everything else triggers a download. */
export async function openAttachedFile(fileMeta) {
  const handle = fileMeta && fileMeta._handle;
  if (!handle) throw new Error('Attachment is missing its handle. Re-attach the file.');
  // Permission may have lapsed since the last session.
  const perm = typeof handle.queryPermission === 'function'
    ? await handle.queryPermission({ mode: 'read' }) : 'granted';
  if (perm !== 'granted') {
    const r = await handle.requestPermission({ mode: 'read' });
    if (r !== 'granted') throw new Error('Permission denied — the browser blocked file access.');
  }
  const file = await handle.getFile();
  const url = URL.createObjectURL(file);
  // Same tab won't navigate from a static-served origin to a blob URL on
  // file:// — but we're on http://localhost so window.open works fine.
  window.open(url, '_blank', 'noopener');
  // Revoke after a generous delay so the new tab has time to start
  // streaming. PDFs especially can be large.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}
