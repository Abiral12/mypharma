// utils/aiExtraction.js
// const Tesseract = require('tesseract.js');
// const sharp = require('sharp');
// const { OpenAI } = require('openai');

'use server';
import 'server-only';

// require('dotenv').config();
import OpenAI from 'openai';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';

/* ===================== Config ===================== */
const VISION_MODEL = 'qwen/qwen-2.5-vl-72b-instruct';      // vision-capable
const TEXT_MODEL   = 'nvidia/nemotron-nano-9b-v2:free';    // text-only fallback

/* ===================== Image helpers ===================== */
async function preprocessForOCR(imgBuf) {
  return sharp(imgBuf)
    .grayscale()
    .normalise()
    .sharpen()
    .threshold(160)
    .toBuffer();
}

async function toDataUrlJPEG(buf, maxW = 1600, quality = 80) {
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  const w = meta.width || maxW;
  const resized = await img.resize({ width: Math.min(w, maxW) }).jpeg({ quality }).toBuffer();
  const b64 = resized.toString('base64');
  return `data:image/jpeg;base64,${b64}`;
}

/* ===================== OCR ===================== */
export async function performOCR(imageBuffer) {
  const pre = await preprocessForOCR(imageBuffer);
  const result = await Tesseract.recognize(pre, 'eng+nep', {
    logger: m => console.log(m),
    tessedit_pageseg_mode: 6,
    tessedit_char_whitelist:
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./:- '
  });
  return {
    text: result.data.text,
    confidence: result.data.confidence
  };
}

/* ===================== Cleanup & Hints ===================== */
function devnagToAsciiDigits(s) {
  const map = { '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9' };
  return String(s).replace(/[०-९]/g, ch => map[ch] || ch);
}

function cleanupOCR(text) {
  let s = devnagToAsciiDigits(String(text || ''));
  s = s.replace(/Capsu\\?es/gi, 'Capsules');
  s = s.replace(/\bMig\.?\b/gi, 'Mfg.');
  s = s.replace(/\bExpir[yil]+\b/gi, 'Expiry');
  s = s.replace(/\b0CT\b/g, 'OCT');
  s = s.replace(/\bSEF\b/g, 'SEP');
  s = s.replace(/\bSEN\b/g, 'SEP');
  s = s.replace(/[^\S\r\n]+/g, ' ');
  return s;
}

function buildHints(txt) {
  const lines = String(txt).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const pick = (rx) =>
    lines
      .map((l, i) => ({ i, l }))
      .filter(({ l }) => rx.test(l))
      .flatMap(({ i }) => lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)));

  const mfgHints = pick(/(?:Mfg\.?|MFG|DOM|उत्पादन\s*मिति)/i);
  const expHints = pick(/(?:Exp\.?|EXP|Expiry|Use by|Best before|स्याढ\s*सकिने|म्याद\s*सकिने)/i);
  const batchHints = pick(/\b(?:Batch(?:\s*No\.?)?|Lot|LOT|BNo|BN|BATCH)\b/i);
  const priceHints = pick(/\bM\.?R\.?P\.?\b|मूल्य/i);
  const licenseHints = pick(/Mfg\.?\s*Lic\.?\s*No\.?/i);
  const compact = (arr) => [...new Set(arr)].slice(0, 10).join(' | ');

  return {
    mfg: compact(mfgHints),
    exp: compact(expHints),
    batch: compact(batchHints),
    price: compact(priceHints),
    license: compact(licenseHints),
    _lines: lines
  };
}

/* ===================== Date helpers ===================== */
function toIsoDate(str) {
  if (!str) return null;
  const s = String(str).trim();

  // Month + Year only
  let m = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[.\-\/\s]+(\d{2,4})$/i);
  if (m) {
    const monMap = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
    const mo = String(monMap[m[1].toLowerCase()]).padStart(2, '0');
    let y = m[2];
    if (y.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y;
    return `${y}-${mo}-01`;
  }

  // 2025-09-02 / 2025/9/2 / 2025.9.2
  m = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (m) {
    const [_, y, mo, d] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // 02-09-2025 / 2/9/25
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let [_, d, mo, y] = m;
    if (y.length === 2) y = (y >= '70' ? '19' : '20') + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Sep 2, 2025
  m = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s*(\d{4})$/i);
  if (m) {
    const monMap = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
    const mo = String(monMap[m[1].toLowerCase()]).padStart(2, '0');
    const d  = String(m[2]).padStart(2, '0');
    const y  = m[3];
    return `${y}-${mo}-${d}`;
  }

  return s; // unknown/partial
}

function completePartialDate(partialDate, year) {
  const monthMap = {
    JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06',
    JUL:'07', AUG:'08', SEP:'09', SEPT:'09', OCT:'10', NOV:'11', DEC:'12'
  };
  const match = String(partialDate).match(/([A-Za-z]{3,5})[.\-\/\s]?(\d{1,2})/);
  if (match) {
    const monthAbbr = match[1].toUpperCase();
    const day = match[2].padStart(2, '0');
    const month = monthMap[monthAbbr] || '01';
    return `${year}-${month}-${day}`;
  }
  return partialDate;
}

function processExtractedData(data, ocrText) {
  const currentYear = new Date().getFullYear();

  if (data.manufacturing_date) data.manufacturing_date = toIsoDate(data.manufacturing_date);
  if (data.expiry_date)        data.expiry_date        = toIsoDate(data.expiry_date);

  if (data.manufacturing_date && String(data.manufacturing_date).length <= 6) {
    const yr = (String(ocrText).match(/(20\d{2})/) || [])[1] || currentYear;
    data.manufacturing_date = completePartialDate(data.manufacturing_date, yr);
  }
  if (data.expiry_date && String(data.expiry_date).length <= 6) {
    const yr = (String(ocrText).match(/(20\d{2})/) || [])[1] || currentYear;
    data.expiry_date = completePartialDate(data.expiry_date, yr);
  }

  return data;
}

/* ===================== Uses/Indications helpers ===================== */
function extractUsesFromText(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const uses = new Set();

  for (const l of lines) {
    const m1 = l.match(/\b(Indications?|Uses?)\b\s*[:\-]\s*(.+)$/i);
    if (m1 && m1[2]) {
      m1[2].split(/[;,•·]/).forEach(p => {
        const v = p.replace(/\s+/g, ' ').trim();
        if (v) uses.add(v);
      });
    }
  }

  const INLINE_RE = /\bfor (?:the )?(?:relief|treatment|management|control) of ([a-z ,&\-\/]+?)(?:\.|,|;|$)/ig;
  let m;
  while ((m = INLINE_RE.exec(text)) !== null) {
    m[1].split(/[,&\/]/).forEach(part => {
      const v = part.replace(/\s+/g, ' ').trim();
      if (v) uses.add(v);
    });
  }

  const NEP_RE = /(?:का लागि|उपचार|राहत)\s*([^\.\,;]+)/g;
  while ((m = NEP_RE.exec(text)) !== null) {
    const v = m[1].replace(/\s+/g, ' ').trim();
    if (v) uses.add(v);
  }

  return [...uses]
    .map(u => u.replace(/^\b(mild|moderate|severe)\b\s+/i, '').trim())
    .filter(u => u.length >= 3)
    .slice(0, 10);
}

/* ===================== Common uses (optional enrichment) ===================== */
const COMMON_USES_BY_INGREDIENT = {
  'paracetamol': ['pain', 'fever'],
  'acetaminophen': ['pain', 'fever'],
  'ibuprofen': ['pain', 'inflammation', 'fever'],
  'loperamide': ['acute diarrhea'],
  'oral rehydration salts': ['dehydration due to diarrhea'],
  'cetirizine': ['allergic rhinitis', 'itching'],
  'amoxicillin': ['bacterial infections (as prescribed)'],
  'flucloxacillin': ['susceptible staphylococcal infections (as prescribed)'],
};

function inferActiveFromName(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  for (const k of Object.keys(COMMON_USES_BY_INGREDIENT)) {
    if (n.includes(k)) return k;
  }
  return null;
}

/* ===================== Packaging & MRP helpers ===================== */
function extractPackInfo(text) {
  const s = String(text || '');

  // A) 10 x 10 CAPS
  let m = s.match(/\b(\d{1,3})\s*[xX×]\s*(\d{1,3})\s*(?:TAB|TABS|TABLET|TABLETS|CAP|CAPS|CAPSULES)\b/i);
  if (m) return { slipsCount: Number(m[1]), tabletsPerSlip: Number(m[2]) };

  // B) 10 CAPS x 10
  m = s.match(/\b(\d{1,3})\s*(?:TAB|TABS|TABLET|TABLETS|CAP|CAPS|CAPSULES)\s*[xX×]\s*(\d{1,3})\b/i);
  if (m) return { slipsCount: Number(m[2]), tabletsPerSlip: Number(m[1]) };

  // C) Only "10 CAPS" (per slip only)
  m = s.match(/\b(\d{1,3})\s*(?:TAB|TABS|TABLET|TABLETS|CAP|CAPS|CAPSULES)\b/i);
  if (m) return { slipsCount: null, tabletsPerSlip: Number(m[1]) };

  return { slipsCount: null, tabletsPerSlip: null };
}

function extractMRP(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let mrpAmount = null, mrpCurrency = null, mrpText = null;

  for (const l of lines) {
    if (!/(M\.?\s*R\.?\s*P\.?|मूल्य)/i.test(l)) continue;

    const m = l.match(/(?:MRP|M\.?\s*R\.?\s*P\.?|मूल्य)[^0-9]*(?:Rs\.?|INR|NPR|NRs|रु\.?|रु)?[^0-9]*([0-9]+(?:\.[0-9]{1,2})?)/i);
    if (m) {
      mrpAmount = Number(m[1]);
      if (/NPR|NRs|रु/.test(l)) mrpCurrency = 'NPR';
      else if (/INR/.test(l)) mrpCurrency = 'INR';
      else if (/Rs/i.test(l)) mrpCurrency = 'Rs';
      mrpText = l;
      break;
    }
  }
  return { mrpAmount, mrpCurrency, mrpText };
}

/* ===================== Label-based pulls (batch + mfg) ===================== */
function findFirstDateToken(s) {
  if (!s) return null;
  const patterns = [
    /(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/,
    /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/,
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{2,4})/i,
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[.\-\/\s]+\d{2,4})/i,
    /([A-Za-z]{3,5}[.\-\/\s]?\d{1,2})/
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return null;
}

function pullLabeledValue(lines, labelRegex, valueRegexOrFn) {
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) {
      const after = lines[i].replace(labelRegex, ' ').trim();
      let val = typeof valueRegexOrFn === 'function'
        ? valueRegexOrFn(after)
        : (after.match(valueRegexOrFn)?.[1] || null);
      if (val) return val;
      if (i + 1 < lines.length) {
        const nxt = lines[i + 1];
        val = typeof valueRegexOrFn === 'function'
          ? valueRegexOrFn(nxt)
          : (nxt.match(valueRegexOrFn)?.[1] || null);
        if (val) return val;
      }
    }
  }
  return null;
}

function extractBatchAndMfgFromLines(lines) {
  const batchLabel = /\b(?:Batch(?:\s*No\.?)?|Lot|LOT|BNo|BN|BATCH)\b[:\-\s]*/i;
  const batchValue = /([A-Za-z0-9\-]{1,20})/;

  const mfgLabel = /(?:Mfg\.?\s*Date|MFG\s*Date|MFG|DOM|उत्पादन\s*मिति)\s*[:\-]*/i;
  const mfgValueFn = (s) => findFirstDateToken(s);

  const batch = pullLabeledValue(lines, batchLabel, batchValue);
  const mfgRaw = pullLabeledValue(lines, mfgLabel, mfgValueFn);

  return {
    batch_number: batch || null,
    manufacturing_date: mfgRaw || null
  };
}

/* ===================== Batch accuracy: candidates, normalizer, voting ===================== */
function extractBatchCandidates(lines) {
  const where = [];
  for (let i = 0; i < lines.length; i++) {
    if (/\b(?:Batch(?:\s*No\.?)?|Lot|LOT|BNo|BN|BATCH)\b/i.test(lines[i])) where.push(i);
  }
  const around = [];
  for (const i of where) {
    around.push(lines[i]);
    if (i + 1 < lines.length) around.push(lines[i + 1]);
  }
  const CAND_RX = /([A-Z]{2,6}\s*[- ]?\s*\d{4,7})/g;
  const out = new Set();
  for (const s of around) {
    let m;
    const up = String(s || '').toUpperCase();
    while ((m = CAND_RX.exec(up)) !== null) out.add(m[1].trim());
  }
  return [...out];
}

function normalizeBatchToken(raw) {
  if (!raw) return null;
  let s = String(raw).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Common OCR swaps between letters (inside alpha runs)
  s = s.replace(/(?<=\b[A-Z])0(?=[A-Z])/g, 'O'); // 0 used as O between letters
  s = s.replace(/(?<=\b[A-Z])1(?=[A-Z])/g, 'I'); // 1 used as I between letters
  s = s.replace(/(?<=\b[A-Z])5(?=[A-Z])/g, 'S'); // 5 used as S between letters

  // Special: stray L between B and SL → BSL  (e.g., FBLSL → FBSL)
  s = s.replace(/\b([A-Z]*B)L(?=SL\b)/, '$1');

  // Collapse multiple spaces
  s = s.replace(/\s{2,}/g, ' ');

  // Enforce letters+digits shape
  const m = s.match(/\b([A-Z]{2,5})\s*[- ]?\s*(\d{4,6})\b/);
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

function finalizeBatch(s) {
  const n = normalizeBatchToken(s);
  if (!n) return null;
  return /\b[A-Z]{2,5} \d{4,6}\b/.test(n) ? n : null;
}

function pickBestBatch({ ocrTexts = [], hintedLines = [], aiBatch, rxBatch }) {
  const votes = new Map();

  // a) neighborhood of "Batch"
  for (const c of extractBatchCandidates(hintedLines)) {
    const n = normalizeBatchToken(c);
    if (n) votes.set(n, (votes.get(n) || 0) + 2); // extra weight
  }

  // b) all OCR blobs
  for (const blob of ocrTexts) {
    if (!blob) continue;
    const up = String(blob).toUpperCase();
    const re = /([A-Z]{2,6}\s*[- ]?\s*\d{4,7})/g;
    let m;
    while ((m = re.exec(up)) !== null) {
      const n = normalizeBatchToken(m[1]);
      if (n) votes.set(n, (votes.get(n) || 0) + 1);
    }
  }

  // c) AI / regex suggestions
  for (const cand of [aiBatch, rxBatch]) {
    const n = normalizeBatchToken(cand);
    if (n) votes.set(n, (votes.get(n) || 0) + 1);
  }

  let best = null, bestScore = -1;
  for (const [k, v] of votes) {
    if (v > bestScore || (v === bestScore && k.length < (best?.length || 999))) {
      best = k; bestScore = v;
    }
  }
  return best || null;
}

/* ===================== Regex fallback for name/pack/dates ===================== */
function extractWithRegex(text) {
  const src = String(text || '');

  // NOTE: Keep generic – your products vary
  const namePattern = /(Flucloxacillin(?:\s+Capsules?\s*BP)?|FLUCLASS\s*500|BUSTOP|VITAMIN\s*B-?COMPLEX\s*SYRUP)/i;

  const fullDatePattern =
    /\b(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{2,4})\b/gi;
  const monthYearPattern =
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[.\-\/\s]+(\d{2,4})\b/i;

  const batchPattern =
    /\b(?:Batch(?:\s*No\.?)?|Lot|LOT|BNo|BN|BATCH)\s*[:\-]?\s*([A-Z0-9\-]{3,})\b/i;

  const nameMatch = src.match(namePattern);
  const fullDates = [...src.matchAll(fullDatePattern)].map(m => m[0]);
  let batch_number = src.match(batchPattern)?.[1] || null;

  const mfgHint = /(?:Mfg\.?|MFG|DOM|उत्पादन)/i;
  const expHint = /(?:Exp\.?|EXP|Expiry|Use by|Best before|स्याढ\s*सकिने|म्याद\s*सकिने)/i;

  const lines = src.split(/\r?\n/);
  const mfgLine = lines.find(l => mfgHint.test(l)) || '';
  const expLine = lines.find(l => expHint.test(l)) || '';

  function monthYearToIso(m) {
    if (!m) return null;
    const monMap = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
    const mon = monMap[m[1].toLowerCase()];
    let y = m[2];
    if (y.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y;
    return `${y}-${String(mon).padStart(2,'0')}-01`;
  }

  let mfg = null, exp = null;

  const mmMfg = mfgLine.match(monthYearPattern);
  if (mmMfg) mfg = monthYearToIso(mmMfg);

  const mmExp = expLine.match(monthYearPattern);
  if (mmExp) exp = monthYearToIso(mmExp);

  if (!mfg || !exp) {
    if (fullDates.length >= 2) {
      mfg ||= fullDates[0];
      exp ||= fullDates[1];
    } else if (fullDates.length === 1) {
      exp ||= fullDates[0];
    }
  }

  mfg = toIsoDate(mfg) || mfg;
  exp = toIsoDate(exp) || exp;

  const pack = extractPackInfo(src);
  const mrp = extractMRP(src);

  return {
    name: nameMatch ? nameMatch[0].replace(/\s+/g, ' ').trim() : null,
    manufacturing_date: mfg,
    batch_number,
    expiry_date: exp,
    slips_count: pack.slipsCount,
    tablets_per_slip: pack.tabletsPerSlip,
    mrp_amount: mrp.mrpAmount,
    mrp_currency: mrp.mrpCurrency,
    mrp_text: mrp.mrpText
  };
}

/* ===================== Merge logic ===================== */
function safeParseMaybe(raw) {
  let s = String(raw || '').trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch {}
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i !== -1 && j !== -1 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch {} }
  return null;
}

function getBatchContext(lines) {
  const idx = lines.findIndex(l => /\b(?:Batch(?:\s*No\.?)?|Lot|LOT|BNo|BN|BATCH)\b/i.test(l));
  if (idx === -1) return '';
  return lines.slice(Math.max(0, idx - 1), Math.min(lines.length, idx + 2)).join(' ');
}

function preferName(aiName, rxName) {
  if (aiName && aiName.length >= 6) return aiName.trim();
  if (rxName && rxName.length >= 6) return rxName.trim();
  return aiName || rxName || null;
}

function mergeResults(ai, rx, ocrLines, labelHits) {
  const name = preferName(ai?.name, rx?.name);

  // Batch (context-aware, preliminary – final voting happens later)
  const batchCtx = getBatchContext(ocrLines);
  let batch = null;
  if (labelHits.batch_number) {
    batch = labelHits.batch_number;
  } else if (rx.batch_number && batchCtx.toLowerCase().includes(String(rx.batch_number).toLowerCase())) {
    batch = rx.batch_number;
  } else if (ai?.batch_number && batchCtx.toLowerCase().includes(String(ai.batch_number).toLowerCase())) {
    batch = ai.batch_number;
  }

  // Dates
  let mfg = labelHits.manufacturing_date || ai?.manufacturing_date || rx.manufacturing_date || null;
  let exp = ai?.expiry_date || rx.expiry_date || null;

  // Packaging
  const slips_count = ai?.slips_count ?? rx.slips_count ?? null;
  const tablets_per_slip = ai?.tablets_per_slip ?? rx.tablets_per_slip ?? null;

  // MRP
  const mrp_amount = ai?.mrp_amount ?? rx.mrp_amount ?? null;
  const mrp_currency = ai?.mrp_currency ?? rx.mrp_currency ?? null;
  const mrp_text = ai?.mrp_text ?? rx.mrp_text ?? null;

  // Label-only meta
  const uses_on_label = Array.isArray(ai?.uses_on_label) ? ai.uses_on_label.filter(Boolean) : null;
  const active_on_label = ai?.active_ingredient_on_label || null;
  const strength_on_label = ai?.strength_on_label || null;
  const dosage_form_on_label = ai?.dosage_form_on_label || null;

  return {
    name,
    manufacturing_date: mfg,
    batch_number: batch,
    expiry_date: exp,
    slips_count,
    tablets_per_slip,
    mrp_amount,
    mrp_currency,
    mrp_text,

    uses_on_label,
    active_ingredient_on_label: active_on_label,
    strength_on_label,
    dosage_form_on_label
  };
}

/* ===================== Vision-first extraction ===================== */
async function extractWithVision(imageBuffers) {
  const client = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' });

  const schemaHint = `
Return ONLY a valid JSON object (no markdown) with:
{
  "name": string | null,
  "manufacturing_date": string | null,
  "batch_number": string | null,
  "expiry_date": string | null,
  "slips_count": number | null,
  "tablets_per_slip": number | null,
  "mrp_amount": number | null,
  "mrp_currency": string | null,
  "mrp_text": string | null,

  "uses_on_label": string[] | null,
  "active_ingredient_on_label": string | null,
  "strength_on_label": string | null,
  "dosage_form_on_label": string | null
}
Rules:
- Use ONLY what you see on the label images; do not guess.
- "Batch Number" must be the value after Batch/Lot labels.
- Normalize batch to the shape: LETTERS + space + DIGITS (regex: ^[A-Z]{2,5}\\s\\d{4,6}$).
- If you see a stray 'L' between 'B' and 'SL' (e.g., "FBLSL"), correct to "FBSL".
- Dates: keep as Month Year if that’s all that’s visible.
- Packaging + MRP: extract exactly as printed (amount numeric).
`;

  const parts = [];
  for (const b of imageBuffers) {
    const url = await toDataUrlJPEG(b);
    parts.push({ type: 'image_url', image_url: { url } });
  }

  const resp = await client.chat.completions.create({
    model: VISION_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: 500,
    messages: [
      { role: 'system', content: 'You read product labels from images and output strict JSON.' },
      { role: 'user', content: [{ type: 'text', text: schemaHint }, ...parts] }
    ],
    headers: {
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Product Info Extractor (Vision)'
    }
  });

  const raw = resp?.choices?.[0]?.message?.content || '';
  return safeParseMaybe(raw);
}

/* ===================== Public: Vision-first, then OCR fallback ===================== */
export async function extractProductDataFromImages(imageBuffers) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');

  // 1) Vision attempt
  try {
    const vision = await extractWithVision(imageBuffers);
    if (vision) {
      // normalize batch from vision too
      if (vision.batch_number) vision.batch_number = finalizeBatch(vision.batch_number);
      const processed = processExtractedData({ ...vision }, '');
      const enough = Object.values(processed).some(v => v != null && v !== '');
      if (enough) return { ...processed, _source: 'vision' };
    }
  } catch (e) {
    console.error('Vision step failed; falling back to OCR. Reason:', e.message);
  }

  // 2) OCR all images → keep per-image texts & combined text
  const perImageTexts = [];
  let combinedText = '';
  for (const b of imageBuffers) {
    try {
      const { text } = await performOCR(b);
      perImageTexts.push(text || '');
      combinedText += (text || '') + '\n';
    } catch (e) {
      console.error('OCR error on one image (continuing):', e.message);
    }
  }

  const cleanedOriginal = cleanupOCR(combinedText);
  const hints = buildHints(cleanedOriginal);

  // regex-only uses from OCR text (even without LLM)
  const usesRegexOnly = extractUsesFromText(cleanedOriginal);

  // 3) Text model (Nemotron) on OCR + hints
  const client = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' });

  const schemaText = `
Return ONLY a valid JSON object (no markdown) with:
{
  "name": string|null,
  "manufacturing_date": string|null,
  "batch_number": string|null,
  "expiry_date": string|null,
  "slips_count": number|null,
  "tablets_per_slip": number|null,
  "mrp_amount": number|null,
  "mrp_currency": string|null,
  "mrp_text": string|null,

  "uses_on_label": string[] | null,
  "active_ingredient_on_label": string | null,
  "strength_on_label": string | null,
  "dosage_form_on_label": string | null
}
Rules:
- Use ONLY values present in the provided text; do not infer medical uses.
- Batch must match ^[A-Z]{2,5}\\s\\d{4,6}$ after normalization. Correct "FBLSL" → "FBSL" if seen.
- Dates: normalize to YYYY-MM-DD if possible; else keep "OCT 24".
- Packaging & MRP: read as printed.
`;

  let ai = null;
  try {
    const resp = await client.chat.completions.create({
      model: TEXT_MODEL,
      reasoning: { enabled: false },
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 500,
      messages: [
        { role: 'system', content: 'You extract structured data from noisy OCR. Be terse and accurate.' },
        {
          role: 'user',
          content:
`Important snippets (focus here first):
MFG: ${hints.mfg || '(none)'}
EXP: ${hints.exp || '(none)'}
BATCH: ${hints.batch || '(none)'}
PRICE: ${hints.price || '(none)'}
LICENSE: ${hints.license || '(none)'}
---
Full OCR:
${cleanedOriginal}

${schemaText}`
        }
      ],
      headers: {
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Product Info Extractor (OCR)'
      }
    });
    ai = safeParseMaybe(resp?.choices?.[0]?.message?.content || '');
  } catch (e) {
    console.error('Text LLM on OCR failed (will rely more on regex):', e.message);
  }

  const rx = extractWithRegex(cleanedOriginal);
  const labelHits = extractBatchAndMfgFromLines(hints._lines);
  const merged = mergeResults(ai || {}, rx, hints._lines, labelHits);

  // ==== BATCH: voting across all sources ====
  const votedBatch = pickBestBatch({
    ocrTexts: perImageTexts,
    hintedLines: hints._lines,
    aiBatch: ai?.batch_number,
    rxBatch: rx?.batch_number
  });

  // finalize & normalize
  const finalBatch = finalizeBatch(votedBatch || merged.batch_number);

  const processed = processExtractedData(
    { ...merged, batch_number: finalBatch },
    cleanedOriginal
  );

  // Conservative enrichment (optional)
  let inferred_uses = null;
  let active_guess = processed.active_ingredient_on_label || inferActiveFromName(processed.name);
  if (!processed.uses_on_label && active_guess && COMMON_USES_BY_INGREDIENT[active_guess]) {
    inferred_uses = COMMON_USES_BY_INGREDIENT[active_guess].slice(0, 6);
  }

  return {
    ...processed,
    uses_on_label: processed.uses_on_label || (usesRegexOnly.length ? usesRegexOnly : null),
    active_ingredient_on_label: processed.active_ingredient_on_label || active_guess || null,
    strength_on_label: processed.strength_on_label || null,
    dosage_form_on_label: processed.dosage_form_on_label || null,
    inferred_uses: inferred_uses || null,
    _source: ai ? 'ocr_llm' : processed._source
  };
}

/* ===================== Exports ===================== */
// (functions are exported where declared) — avoid duplicate export statement
