// server-only ensures this file never gets included on the client
import 'server-only';
import type { Worker as TesseractWorker } from 'tesseract.js';
import Tesseract from 'tesseract.js';

// ✅ shared type for everything the route expects
export type ExtractedScan = {
  _source?: string;
  name?: string | null;
  batch_number?: string | null;
  manufacturing_date?: string | null;
  expiry_date?: string | null;
  slips_count?: number | null;
  tablets_per_slip?: number | null;
  mrp_amount?: number | null;
  mrp_currency?: string | null;
  mrp_text?: string | null;
  uses_on_label?: string[];
  inferred_uses?: string[];
};
/** Lazy import tesseract ONLY when the function runs (Node runtime) */
export async function performOCR(buffer: Buffer): Promise<{ text: string; confidence: number }> {
  const { createWorker } = await import('tesseract.js');
      
const { data } = await Tesseract.recognize(buffer, 'eng');

  return {
    text: data?.text ?? '',
    confidence: typeof data?.confidence === 'number' ? data.confidence : 0,
  };

}



// Use the aiExtraction.js utilities for OCR and extraction
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const aiExtraction = require('../../utils/aiExtraction.js');

export async function extractProductDataFromImages(buffers: Buffer[]) {
  // Run OCR and extraction using the aiExtraction.js logic
  try {
    // aiExtraction expects imageBuffers (array of Buffer)
    const result = await aiExtraction.extractProductDataFromImages(buffers);
    // Defensive: ensure at least _source is set
    return result || { _source: 'ocr@aiExtraction-null' };
  } catch (err) {
    console.error('extractProductDataFromImages failed:', err);
    return { _source: 'ocr@aiExtraction-error' };
  }
}

export async function fetchUsesFromInternet(_name: string) { return []; }
export async function fetchMedicineNotes(_name: string) { return {}; }
