import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

import { extractProductDataFromImages, performOCR } from "@/utils/aiExtraction";
import { fetchUsesFromInternet } from "@/utils/fetchUses";
import { fetchMedicineNotes } from "@/utils/fetchNotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

// Fail-fast guard: ensure helper functions are present (clearer error than a later TypeError)
if (typeof extractProductDataFromImages !== 'function' || typeof performOCR !== 'function') {
  console.error('scanner helpers missing', {
    extractProductDataFromImages: typeof extractProductDataFromImages,
    performOCR: typeof performOCR,
  });
  throw new Error('Internal: OCR helpers not available - check src/utils/aiExtraction.js exports');
}

// Helper: read up to N files named "images"
async function readImageBuffers(form: FormData, max = 20) {
  const files = form.getAll("images").filter(Boolean) as File[];
  if (files.length === 0) throw new Error("No images uploaded (field name: images)");
  if (files.length < 2) throw new Error("Please upload at least 2 images");
  if (files.length > max) throw new Error(`Too many images; max ${max}`);
  const bufs: { buf: Buffer; file: File }[] = [];
  for (const f of files) {
    const arr = new Uint8Array(await f.arrayBuffer());
    bufs.push({ buf: Buffer.from(arr), file: f });
  }
  return bufs;
}

function toISOorNull(s?: string | null) {
  if (!s) return null;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`;
  const d = new Date(t);
  return isNaN(+d) ? null : d.toISOString().slice(0, 10);
}

/* ---------------- OCR noise normalizer (small but effective) ---------------- */
function normalizeOcrNoise(s: string) {
  return String(s || "")
    .replace(/(\d)\s*my\b/gi, "$1 mg")  // "5my" -> "5 mg"
    .replace(/(\d)\s*mq\b/gi, "$1 mg")  // "5mq" -> "5 mg"
    .replace(/\b1O0\b/g, "100")         // "1O0" -> "100"
    .replace(/\bO(\d)\b/g, "0$1");      // "O5" -> "05" (rare but helps)
}

/* ---------------- Dosage-form helpers ---------------- */
function guessDosageForm(label?: string | null, blob?: string | null) {
  const s = `${label || ""} ${blob || ""}`.toLowerCase();
  if (/\btablet(s)?\b/.test(s)) return "TABLET";
  if (/\bcapsule(s)?\b|\bcap(s)?\b/.test(s)) return "CAPSULE";
  if (/\bsyrup\b/.test(s)) return "SYRUP";
  if (/\bsuspension\b/.test(s)) return "SUSPENSION";
  if (/\bsolution\b/.test(s)) return "SOLUTION";
  if (/\bdrop(s)?\b/.test(s)) return "DROPS";
  if (/\binjection\b/.test(s)) return "INJECTION";
  if (/\bointment\b/.test(s)) return "OINTMENT";
  if (/\bcream\b/.test(s)) return "CREAM";
  if (/\bgel\b/.test(s)) return "GEL";
  return null;
}

function parseLiquidMeta(raw: string) {
  // normalize common OCR glitches first
  const t = normalizeOcrNoise(raw);

  const out: {
    bottleVolumeMl?: number | null;
    bottlesPerPack?: number | null;
    doseMl?: number | null;
    concentrationMgPer5ml?: number | null;
    concentrationLabel?: string | null;
  } = {};

  // 1) Bottle volume — prefer plausible 30–500 ml as bottle size.
  const volMatches = [...t.matchAll(/(\d{2,4})\s*ml\b/gi)].map(m => Number(m[1]));
  if (volMatches.length) {
    const plausible = volMatches.filter(v => v >= 30 && v <= 500);
    if (plausible.length) out.bottleVolumeMl = plausible[0];
    else out.bottleVolumeMl = null; // likely dose sizes like 5/10 ml, not bottle
  }

  // 2) Bottles per pack: "2 x 100 ml" / "2×100 ml"
  const mPack = t.match(/(\d{1,2})\s*[x×]\s*\d{2,4}\s*ml/i);
  if (mPack) out.bottlesPerPack = Number(mPack[1]);

  // 3) Dose unit: "per 5 ml", "each 10 ml contains"
  const mDose =
    t.match(/\bper\s*(\d{1,2})\s*ml\b/i) ||
    t.match(/\beach\s*(\d{1,2})\s*ml\b/i) ||
    t.match(/\b(\d{1,2})\s*ml\s*contains\b/i);
  if (mDose) out.doseMl = Number(mDose[1]);

  // 4) Concentration numeric: "X mg / 5 ml" (or 10 ml)
  const mConc5 = t.match(/(\d+(?:[.,]\d+)?)\s*mg\s*(?:\/|per)\s*5\s*ml/i);
  const mConc10 = t.match(/(\d+(?:[.,]\d+)?)\s*mg\s*(?:\/|per)\s*10\s*ml/i);
  if (mConc5) out.concentrationMgPer5ml = Number(mConc5[1].replace(",", "."));
  else if (mConc10) {
    // convert mg/10ml to mg/5ml for consistency
    const v = Number(mConc10[1].replace(",", "."));
    out.concentrationMgPer5ml = Math.round((v / 2) * 1000) / 1000;
  }

  // 5) Fallback readable line: capture any "per 5 ml" or "per 10 ml" line
  const mLine =
    t.match(/([^\n]*?\bper\s*5\s*ml[^\n]*)/i) ||
    t.match(/([^\n]*?\bper\s*10\s*ml[^\n]*)/i) ||
    t.match(/([^\n]*?\beach\s*\d{1,2}\s*ml[^\n]*)/i);
  if (mLine) out.concentrationLabel = mLine[1].trim();

  return out;
}

// Convert Nepali/Devanagari digits to ASCII
function nepaliDigitsToAscii(s: string) {
  const map: Record<string, string> = {
    "०":"0","१":"1","२":"2","३":"3","४":"4",
    "५":"5","६":"6","७":"7","८":"8","९":"9"
  };
  return s.replace(/[०-९]/g, d => map[d] ?? d);
}

// Normalize units & common OCR glitches (English + Nepali)
function normalizeUnitsAndNoise(s: string) {
  let t = nepaliDigitsToAscii(String(s || ""));

  // Nepali/Devanagari variants of "ml"
  t = t
    .replace(/मि\.?\s*ली/gi, " ml")
    .replace(/मिलि/gi, " ml")
    .replace(/मिली/gi, " ml");

  // OCR fixes
  t = t
    .replace(/(\d)\s*my\b/gi, "$1 mg")  // 5my -> 5 mg
    .replace(/(\d)\s*mq\b/gi, "$1 mg")
    .replace(/\b1O0\b/g, "100")
    .replace(/\bO(\d)\b/g, "0$1");

  // Normalize "x" multiply
  t = t.replace(/×/g, "x");

  return t;
}

// Decide dosage form from label + blob text


// Nepali-aware liquid parser: separates dose vs bottle volume
function parseLiquidMetaNepaliAware(raw: string) {
  const t = normalizeUnitsAndNoise(raw);

  const out: {
    bottleVolumeMl?: number | null;
    bottlesPerPack?: number | null;
    doseMl?: number | null;
    concentrationMgPer5ml?: number | null;
    concentrationLabel?: string | null;
  } = {};

  // --- Dose: "per 5 ml", "each 10 ml contains", Nepali "प्रति/प्रत्येक"
  const mDose =
    t.match(/\bper\s*(\d{1,3})\s*ml\b/i) ||
    t.match(/\beach\s*(\d{1,3})\s*ml\b/i) ||
    t.match(/\b(\d{1,3})\s*ml\s*contains\b/i) ||
    t.match(/प्रति\s*(\d{1,3})\s*ml/i) ||
    t.match(/प्रत्येक\s*(\d{1,3})\s*ml/i) ||
    t.match(/(\d{1,3})\s*ml\s*दिनको/i); // e.g., "10 ml दिनको ..."
  if (mDose) out.doseMl = Number(mDose[1]);

  // --- Bottle volume: prefer context words for "quantity"
  // English: Net, Qty, Quantity, Volume, Content
  // Nepali: मात्रा, परिमाण, निवल, शुद्ध, सामग्री
  const lines = t.split(/\n+/);
  const qtyHints = /(net|qty|quantity|volume|content|contains|मात्रा|परिमाण|निवल|शुद्ध|सामग्री)/i;

  let bottle: number | null = null;
  for (const line of lines) {
    if (!qtyHints.test(line)) continue;
    // collect ml numbers in this line
    const nums = [...line.matchAll(/(\d{2,4})\s*ml\b/gi)].map(m => Number(m[1]));
    if (!nums.length) continue;

    // Heuristic: ignore dose-sized nums (<= 20 ml) in quantity lines
    const candidates = nums.filter(v => v >= 30 && v <= 500);
    if (candidates.length) {
      bottle = candidates[0];
      break;
    }
  }

  // If still not found, scan whole text for plausible "xx ml" not near "per/each"
  if (!bottle) {
    const mlAll = [...t.matchAll(/(\d{2,4})\s*ml\b/gi)].map(m => Number(m[1]));
    const plausible = mlAll.filter(v => v >= 30 && v <= 500);
    // discard obvious dose numbers (5,10,15,20 already filtered by >=30)
    if (plausible.length) bottle = plausible[0];
  }

  out.bottleVolumeMl = bottle ?? null;

  // --- Bottles per pack: "2 x 100 ml"
  const mPack = t.match(/(\d{1,2})\s*x\s*\d{2,4}\s*ml/i);
  if (mPack) out.bottlesPerPack = Number(mPack[1]);

  // --- Concentration numeric: mg / 5 ml or mg / 10 ml (convert to /5 ml)
  const mConc5 = t.match(/(\d+(?:[.,]\d+)?)\s*mg\s*(?:\/|per|प्रति)\s*5\s*ml/i);
  const mConc10 = t.match(/(\d+(?:[.,]\d+)?)\s*mg\s*(?:\/|per|प्रति)\s*10\s*ml/i);
  if (mConc5) out.concentrationMgPer5ml = Number(mConc5[1].replace(",", "."));
  else if (mConc10) {
    const v = Number(mConc10[1].replace(",", "."));
    out.concentrationMgPer5ml = Math.round((v / 2) * 1000) / 1000;
  }

  // --- Readable concentration line
  const mLine =
    t.match(/([^\n]*?\b(per|प्रति)\s*5\s*ml[^\n]*)/i) ||
    t.match(/([^\n]*?\b(per|प्रति)\s*10\s*ml[^\n]*)/i) ||
    t.match(/([^\n]*?\beach\s*\d{1,3}\s*ml[^\n]*)/i);
  if (mLine) out.concentrationLabel = mLine[1].trim();

  return out;
}


/* ---------------- Route ---------------- */

export async function POST(req: NextRequest) {
  try {
    // Parse multipart
    const form = await req.formData();
    const imgs = await readImageBuffers(form, 20);

    // 1) Main extractor (vision -> OCR fallback)
    const extracted = await extractProductDataFromImages(imgs.map(x => x.buf));

    // 2) Quick per-image OCR for response display
    const ocrResults: Array<{ originalName: string; text: string; confidence: number }> = [];
    let combinedText = "";
    for (const { buf, file } of imgs) {
      try {
        const { text, confidence } = await performOCR(buf);
        ocrResults.push({
          originalName: file.name || "image",
          text: text || "",
          confidence: Math.round((confidence || 0) as number),
        });
        combinedText += (text || "") + "\n";
      } catch {
        ocrResults.push({
          originalName: file.name || "image",
          text: "",
          confidence: 0,
        });
      }
    }

    // 3) Enrichment (uses + safety notes)
    let inferred_uses: string[] | null = extracted?.inferred_uses ?? null;
    let care_notes: string[] | null = null;
    let side_effects_common: string[] | null = null;
    let avoid_if: string[] | null = null;
    let precautions: string[] | null = null;
    let interactions_key: string[] | null = null;

    if (extracted?.name) {
      try {
        const uses = await fetchUsesFromInternet(extracted.name);
        if (uses && uses.length) {
          const have = new Set((inferred_uses || []).map(s => s.toLowerCase()));
          for (const u of uses) if (!have.has(u.toLowerCase())) (inferred_uses ||= []).push(u);
        }
      } catch {}
      try {
        const notes = await fetchMedicineNotes(extracted.name);
        if (notes) {
          care_notes = notes.careNotes || null;
          side_effects_common = notes.sideEffectsCommon || null;
          avoid_if = notes.avoidIf || null;
          precautions = notes.precautions || null;
          interactions_key = notes.interactionsKey || null;
        }
      } catch {}
    }

    // 4) Dosage-form decision + liquid parsing
    const dosageLabel =
      // @ts-ignore
      (extracted?.dosage_form_on_label as string | null | undefined) ?? null;
    const decided = guessDosageForm(dosageLabel, combinedText);
    const dosageFormEnum = (decided || (dosageLabel ? dosageLabel.toUpperCase() : null)) as
      | Prisma.DosageForm
      | null
      | undefined;

    const isLiquid = ["SYRUP", "SUSPENSION", "SOLUTION", "DROPS"].includes(
      String(dosageFormEnum || "")
    );
    const liquid = isLiquid ? parseLiquidMeta(combinedText) : null;

    // 5) Build extractedData for response (now includes liquid fields)
    const extractedData = {
      name: extracted?.name || null,
      manufacturing_date: toISOorNull(extracted?.manufacturing_date),
      batch_number: extracted?.batch_number || null,
      expiry_date: toISOorNull(extracted?.expiry_date),

      slips_count: extracted?.slips_count ?? null,
      tablets_per_slip: extracted?.tablets_per_slip ?? null,
      total_tablets:
        extracted?.slips_count != null && extracted?.tablets_per_slip != null
          ? extracted.slips_count * extracted.tablets_per_slip
          : null,

      mrp_amount: extracted?.mrp_amount ?? null,
      mrp_currency: extracted?.mrp_currency || null,
      mrp_text: extracted?.mrp_text || null,

      source: extracted?._source || "vision",

      inferred_uses: inferred_uses || null,

      // Optional label hints your extractor may output
      // @ts-ignore
      uses_on_label: extracted?.uses_on_label || null,
      // @ts-ignore
      active_ingredient_on_label: extracted?.active_ingredient_on_label || null,
      // @ts-ignore
      strength_on_label: extracted?.strength_on_label || null,
      // @ts-ignore
      dosage_form_on_label: extracted?.dosage_form_on_label || null,

      // computed dosage form
      dosage_form: dosageFormEnum || null,

      // safety notes
      care_notes,
      side_effects_common,
      avoid_if,
      precautions,
      interactions_key,

      // NEW — liquid fields in API response
      bottle_volume_ml: liquid?.bottleVolumeMl ?? null,
      bottles_per_pack: liquid?.bottlesPerPack ?? (isLiquid ? 1 : null),
      dose_ml: liquid?.doseMl ?? null,
      concentration_mg_per_5ml: liquid?.concentrationMgPer5ml ?? null,
      concentration_label: liquid?.concentrationLabel ?? null,
    };

    // 6) Persist (Scan + Images) and upsert Medicine / MedicineFacts
    let medicineId: number | null = null;

    if (extractedData.name) {
      // Upsert Medicine by name
      const existingMed = await prisma.medicine.findFirst({
        where: { name: extractedData.name },
        select: { id: true },
      });

      if (existingMed) {
        medicineId = existingMed.id;
        await prisma.medicine.update({
          where: { id: existingMed.id },
          data: {
            // @ts-ignore
            strength: extracted?.strength_on_label || undefined,
            dosageForm: (dosageFormEnum as any) ?? undefined,
            updatedAt: new Date(),
          },
        });
      } else {
        const created = await prisma.medicine.create({
          data: {
            name: extractedData.name,
            // @ts-ignore
            strength: extracted?.strength_on_label || null,
            dosageForm: (dosageFormEnum as any) ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          select: { id: true },
        });
        medicineId = created.id;
      }

      // Upsert MedicineFacts (tablet + liquid fields)
      if (medicineId) {
        await prisma.medicineFacts.upsert({
          where: { medicineId },
          create: {
            medicineId,

            // tablet/capsule
            slipsCount: extractedData.slips_count ?? null,
            tabletsPerSlip: extractedData.tablets_per_slip ?? null,
            totalTablets: extractedData.total_tablets ?? null,

            // shared mrp
            mrpAmount: extractedData.mrp_amount != null ? (extractedData.mrp_amount as any) : null,
            mrpCurrency: extractedData.mrp_currency,
            mrpText: extractedData.mrp_text,

            // safety/info
            inferredUses: extractedData.inferred_uses || [],
            careNotes: extractedData.care_notes || [],
            sideEffectsCommon: extractedData.side_effects_common || [],
            avoidIf: extractedData.avoid_if || [],
            precautions: extractedData.precautions || [],
            interactionsKey: extractedData.interactions_key || [],

            // liquid-specific (stored in DB)
            bottleVolumeMl: extractedData.bottle_volume_ml ?? null,
            bottlesPerPack: extractedData.bottles_per_pack ?? (isLiquid ? 1 : null),
            concentrationMgPer5ml:
              extractedData.concentration_mg_per_5ml != null
                ? (extractedData.concentration_mg_per_5ml as any)
                : null,
            concentrationLabel: extractedData.concentration_label ?? null,
            dosageFormLabel:
              // @ts-ignore
              extracted?.dosage_form_on_label || null,

            createdAt: new Date(),
            updatedAt: new Date(),
          },
          update: {
            slipsCount: extractedData.slips_count ?? null,
            tabletsPerSlip: extractedData.tablets_per_slip ?? null,
            totalTablets: extractedData.total_tablets ?? null,

            mrpAmount: extractedData.mrp_amount != null ? (extractedData.mrp_amount as any) : null,
            mrpCurrency: extractedData.mrp_currency,
            mrpText: extractedData.mrp_text,

            inferredUses: extractedData.inferred_uses || [],
            careNotes: extractedData.care_notes || [],
            sideEffectsCommon: extractedData.side_effects_common || [],
            avoidIf: extractedData.avoid_if || [],
            precautions: extractedData.precautions || [],
            interactionsKey: extractedData.interactions_key || [],

            bottleVolumeMl: extractedData.bottle_volume_ml ?? (isLiquid ? undefined : null),
            bottlesPerPack: extractedData.bottles_per_pack ?? (isLiquid ? 1 : null),
            concentrationMgPer5ml:
              extractedData.concentration_mg_per_5ml != null
                ? (extractedData.concentration_mg_per_5ml as any)
                : null,
            concentrationLabel: extractedData.concentration_label ?? null,
            dosageFormLabel:
              // @ts-ignore
              extracted?.dosage_form_on_label || null,

            updatedAt: new Date(),
          },
        });
      }
    }

    // Create Scan + images (archive everything we saw)
    const scan = await prisma.scan.create({
      data: {
        aiData: extractedData as any,
        rawText: combinedText,
        name: extractedData.name,
        batchNumber: extractedData.batch_number,
        mfgDate: extractedData.manufacturing_date ? new Date(extractedData.manufacturing_date) : null,
        expDate: extractedData.expiry_date ? new Date(extractedData.expiry_date) : null,
        images: {
          create: await Promise.all(
            imgs.map(async ({ buf, file }) => ({
              contentType: file.type || "image/jpeg",
              originalName: file.name || "image",
              data: buf,
            }))
          ),
        },
      },
      select: { id: true },
    });

    // Final response
    return NextResponse.json({
      success: true,
      message: "Images processed successfully",
      data: {
        id: scan.id,
        combinedText,
        extractedData,
        ocrResults: ocrResults.map((x) => ({
          originalName: x.originalName,
          text: x.text,
          confidence: x.confidence,
        })),
      },
    });
  } catch (err: any) {
    console.error("scanner error:", err?.message || err);
    return NextResponse.json(
      { success: false, message: err?.message || "Unexpected error" },
      { status: 400 }
    );
  }
}
