import { createWorker } from 'tesseract.js';
export const runtime = 'nodejs';

export async function ocrBuffer(buf: Buffer, lang = 'eng') {
  // prefer explicit env/public path for Vercel reliability
  const envCore = process.env.TESSERACT_CORE_PATH || '/tesseract-core-simd.wasm';
  const envWorker = process.env.TESSERACT_WORKER_PATH || '/tesseract-core-simd.js';
  const cdnWorker = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js';
  const cdnCore = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/tesseract-core-simd.wasm';

  // cast options to any to avoid mismatched TS defs from tesseract.js typings
  const worker = await createWorker({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: (m: any) => process.env.NODE_ENV === 'development' && console.log(m),

    workerPath: envWorker || cdnWorker,
    corePath: envCore || cdnCore,
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',

    cacheMethod: 'none', // avoid FS issues on Vercel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as any;

  // worker typing in d.ts is conservative; treat as any to call runtime methods
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w: any = worker;
  await w.loadLanguage(lang);
  await w.initialize(lang);
  const { data } = await w.recognize(buf);
  await w.terminate();
  return data.text;
}
