import { createWorker } from 'tesseract.js';
export const runtime = 'nodejs';

export async function ocrBuffer(buf: Buffer, lang: string | string[] = 'eng') {
  // CDN fallbacks (safe for serverless environments where node_modules isn't available at runtime)
  const cdnWorker = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js';
  const cdnCore = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/tesseract-core-simd.wasm';

  // Prefer explicit env overrides. In development prefer the local public/ copy so you can iterate offline.
  const isDev = process.env.NODE_ENV === 'development';
  const envCore = process.env.TESSERACT_CORE_PATH;
  const envWorker = process.env.TESSERACT_WORKER_PATH;

  // const corePath = envCore ?? (isDev ? '/tesseract-core-simd.wasm' : cdnCore);
  const workerPath = envWorker ?? (isDev ? '/tesseract-core-simd.js' : cdnWorker);

  // Create worker WITHOUT passing functions (like logger) which cannot be structured-cloned.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worker: any = await createWorker({
    workerPath,
    corePath: '/node_modules/tesseract.js-core/tesseract-core-simd.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
    cacheMethod: 'none',
  } as any);

  // worker typing in d.ts is conservative; treat as any to call runtime methods
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w: any = worker;

  // Normalize language param: accept 'eng', 'eng+nep', array, comma or space separated
  let langsArr: string[];
  if (Array.isArray(lang)) langsArr = lang;
  else if (typeof lang === 'string') {
    if (lang.includes('+')) langsArr = lang.split('+').map(s => s.trim()).filter(Boolean);
    else if (lang.includes(',')) langsArr = lang.split(',').map(s => s.trim()).filter(Boolean);
    else if (lang.includes(' ')) langsArr = lang.split(/\s+/).map(s => s.trim()).filter(Boolean);
    else langsArr = [lang.trim()];
  } else {
    langsArr = ['eng'];
  }

  try {
    await w.loadLanguage(langsArr);
    await w.initialize(langsArr.join('+'));
    const { data } = await w.recognize(buf);
    return data?.text ?? '';
  } finally {
    // best-effort terminate to free resources; swallow errors
    try { await w.terminate(); } catch { /* ignore */ }
  }
}
