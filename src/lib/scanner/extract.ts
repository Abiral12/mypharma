// server-only ensures this file never gets included on the client
import 'server-only';

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
/** Use centralized OCR helper (server-only) */
import { ocrBuffer } from '../ocr';
export async function performOCR(buffer: Buffer): Promise<{ text: string; confidence: number }> {
  const text = await ocrBuffer(buffer, 'eng');
  return { text: text ?? '', confidence: 0 };
}

// Use the aiExtraction.js utilities for OCR and extraction (ESM)
import { extractProductDataFromImages as aiExtract } from '../../utils/aiExtraction.js';

export async function extractProductDataFromImages(buffers: Buffer[]) {
  // Run OCR and extraction using the aiExtraction.js logic
  try {
    // aiExtraction expects imageBuffers (array of Buffer)
  const result = await aiExtract(buffers);
    // Defensive: ensure at least _source is set
    return result || { _source: 'ocr@aiExtraction-null' };
  } catch (err) {
    console.error('extractProductDataFromImages failed:', err);
    return { _source: 'ocr@aiExtraction-error' };
  }
}

export async function fetchUsesFromInternet(_name: string) { void _name; return []; }
export async function fetchMedicineNotes(_name: string) { void _name; return {}; }
