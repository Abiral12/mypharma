// ./src/lib/ocr.ts
import { createWorker, type Worker } from 'tesseract.js';

export const runtime = 'nodejs';

function normalizeLangs(lang: string | string[]): string {
  if (Array.isArray(lang)) return lang.filter(Boolean).map(s => s.trim()).join('+') || 'eng';
  const s = String(lang || 'eng').trim();
  return s ? s.split(/[+,\s]+/).filter(Boolean).join('+') : 'eng';
}

/**
 * Works with tesseract.js v5/v6.
 * DEV (local): put these in /public/tesseract/
 *   - worker.min.js
 *   - tesseract-core-simd.js
 *   - tesseract-core-simd.wasm
 * PROD: falls back to CDN unless env overrides are set.
 *
 * Env (optional):
 *   TESSERACT_WORKER_PATH -> URL/path to worker.min.js
 *   TESSERACT_CORE_PATH   -> URL/path to tesseract-core-simd.js (JS loader, not the .wasm)
 */
export async function ocrBuffer(buf: Buffer, lang: string | string[] = 'eng'): Promise<string> {
  const isProd = process.env.NODE_ENV === 'production';

  const cdnWorker = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js';
  const cdnCoreJs = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/tesseract-core-simd.js';

  const workerPath =
    process.env.TESSERACT_WORKER_PATH ??
    (isProd ? cdnWorker : '/tesseract/worker.min.js');

  // IMPORTANT: JS loader (not the .wasm)
  const corePath =
    process.env.TESSERACT_CORE_PATH ??
    (isProd ? cdnCoreJs : '/tesseract/tesseract-core-simd.js');

  const langs = normalizeLangs(lang);

  // v5/v6 signature: createWorker(langsOrOptions?, oem?, options?)
  const worker: Worker = await createWorker(
    langs,           // languages, e.g. "eng+nep"
    undefined,       // OEM (optional)
    {
      workerPath,
      corePath,      // JS loader; it will fetch the adjacent .wasm
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
      cacheMethod: 'none',
    }
  );

  try {
    const { data } = await worker.recognize(buf);
    return data?.text ?? '';
  } finally {
    try { await worker.terminate(); } catch { /* ignore */ }
  }
}
