// IndexedDB wrapper. Storage shape:
//   entries: keyPath 'id', indexed by citekey + year
//   meta:    key/value (singletons like 'folderHandle', 'tweaks')
//
// The DB is a CACHE. Truth lives on disk in the user-linked folder once
// folder linking is in (Phase 1). Keep operations small and explicit.
const DB_NAME = 'refmgr';
const DB_VERSION = 2;

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('citekey', 'citekey', { unique: false });
        s.createIndex('year', 'fields.year', { unique: false });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      // v2 — manuscripts store. Created during a v1→v2 upgrade for
      // existing users; entries store is untouched.
      if (!db.objectStoreNames.contains('manuscripts')) {
        const s = db.createObjectStore('manuscripts', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return open().then(db => db.transaction(store, mode).objectStore(store));
}

// Generate an entry ID — random string, low collision risk.
export function newId() {
  return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ── entries ───────────────────────────────────────────────────────────
export async function listEntries() {
  const store = await tx('entries');
  return new Promise((res, rej) => {
    const out = [];
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { out.push(cursor.value); cursor.continue(); }
      else res(out);
    };
    req.onerror = () => rej(req.error);
  });
}

export async function getEntry(id) {
  const store = await tx('entries');
  return new Promise((res, rej) => {
    const req = store.get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}

export async function putEntry(entry) {
  const now = Date.now();
  const e = { ...entry, updatedAt: now, createdAt: entry.createdAt || now };
  const store = await tx('entries', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put(e);
    req.onsuccess = () => res(e);
    req.onerror = () => rej(req.error);
  });
}

export async function deleteEntry(id) {
  const store = await tx('entries', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

export async function bulkPut(entries) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction('entries', 'readwrite');
    const store = t.objectStore('entries');
    for (const e of entries) store.put({ ...e, updatedAt: Date.now(), createdAt: e.createdAt || Date.now() });
    t.oncomplete = () => res(entries.length);
    t.onerror = () => rej(t.error);
  });
}

// ── meta (singletons) ────────────────────────────────────────────────
export async function getMeta(key) {
  const store = await tx('meta');
  return new Promise((res, rej) => {
    const req = store.get(key);
    req.onsuccess = () => res(req.result ? req.result.value : null);
    req.onerror = () => rej(req.error);
  });
}

export async function setMeta(key, value) {
  const store = await tx('meta', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put({ key, value });
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

// ── manuscripts ──────────────────────────────────────────────────────
export function newManuscriptId() {
  return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export async function listManuscripts() {
  const store = await tx('manuscripts');
  return new Promise((res, rej) => {
    const out = [];
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { out.push(cursor.value); cursor.continue(); }
      else res(out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    };
    req.onerror = () => rej(req.error);
  });
}

export async function getManuscript(id) {
  const store = await tx('manuscripts');
  return new Promise((res, rej) => {
    const req = store.get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}

export async function putManuscript(ms) {
  const now = Date.now();
  const m = { ...ms, updatedAt: now, createdAt: ms.createdAt || now };
  const store = await tx('manuscripts', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put(m);
    req.onsuccess = () => res(m);
    req.onerror = () => rej(req.error);
  });
}

export async function deleteManuscript(id) {
  const store = await tx('manuscripts', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
