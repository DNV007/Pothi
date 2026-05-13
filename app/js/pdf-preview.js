// PDF.js-backed in-app preview. Reuses the same vendored PDF.js that
// pdf-extract.js loads — both modules import from the same path so the
// browser caches the worker setup once.

import * as pdfjsLib from '../vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

/* Open a file attachment as a PDF.js document. Returns { pdf, url }
 * where `pdf` is a PDFDocumentProxy (call .getPage / .numPages / etc.)
 * and `url` is a blob: URL that callers can use as a "Download" or
 * "Open in new tab" target. The caller must revoke `url` when done. */
export async function loadPdfFromFileMeta(fileMeta) {
  const handle = fileMeta && fileMeta._handle;
  if (!handle) throw new Error('file-handle-missing');
  const perm = typeof handle.queryPermission === 'function'
    ? await handle.queryPermission({ mode: 'read' })
    : 'granted';
  if (perm !== 'granted') {
    const r = await handle.requestPermission({ mode: 'read' });
    if (r !== 'granted') throw new Error('Permission denied.');
  }
  const file = await handle.getFile();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf, verbosity: 0, isEvalSupported: false }).promise;
  // Build a separate blob URL for the "Open in new tab" affordance —
  // the buffer is consumed by PDF.js so we re-create from the file.
  const url = URL.createObjectURL(file);
  return { pdf, url };
}

/* Render one page into a given canvas element at the requested scale.
 * Returns the page's natural width × height at scale 1. */
export async function renderPage(pdf, pageNum, canvas, scale = 1.5) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width: viewport.width / scale, height: viewport.height / scale };
}
