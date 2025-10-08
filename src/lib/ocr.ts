// src/lib/ocr.ts
import { createWorker, type Worker } from 'tesseract.js';
export const runtime = 'nodejs';

function langsKey(lang: string | string[]) {
  if (Array.isArray(lang)) return lang.filter(Boolean).map(s => s.trim()).join('+') || 'eng';
  const s = String(lang || 'eng').trim();
  return s ? s.split(/[+,\s]+/).filter(Boolean).join('+') : 'eng';
}

export async function ocrBuffer(buf: Buffer, lang: string | string[] = 'eng'): Promise<string> {
  const worker: Worker = await createWorker(
    langsKey(lang),           // 1) languages (v5/v6)
    undefined,                // 2) OEM (optional)
    {                         // 3) options (this is where core/workerPath MUST go)
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
      corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/tesseract-core-simd.js',
      langPath:   'https://tessdata.projectnaptha.com/4.0.0_best',
      cacheMethod: 'none',
    }
  );

  try {
    const { data } = await worker.recognize(buf);
    return data?.text ?? '';
  } finally {
    try { await worker.terminate(); } catch {}
  }
}
