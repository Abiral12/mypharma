// src/app/api/inventory/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type {
  Prisma,
  InventoryBatch,
  InventoryShelfAlloc,
  Medicine,
  MedicineFacts,
  Admin,
  User,
} from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* -------------------------------------------------------------------------- */
/* Public API types (what the UI receives)                                     */
/* -------------------------------------------------------------------------- */
type ApiFacts = {
  slipsCount: number | null;
  tabletsPerSlip: number | null;
  totalTablets: number | null;
  mrpAmount: number | null;
  mrpCurrency: string | null;
  mrpText: string | null;
  inferredUses: string[];
  careNotes: string[];
  sideEffectsCommon: string[];
  avoidIf: string[];
  precautions: string[];
  interactionsKey: string[];
};

type ApiBatchRow = {
  id: string; // batchNo
  name: string;
  manufacturingDate: string | '';
  expiryDate: string | '';
  batchNumber: string;
  purchasePrice: number;
  sellingPrice: number;
  supplierName: string | null;
  qtyAvailable: number;
  qty: number; // alias for UI
  minQty: number; // not in DB yet; keep 0
  shelves: Array<{ shelfId: string; shelfName: string; qty: number }>;
  facts?: ApiFacts;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

type Primitive = string | number | boolean | null | undefined;
type Dict = Record<string, unknown>;

const asDate = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const toMoneyString = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '0';
};

const toInt = (v: unknown): number => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** Get first defined key from object and (optionally) coerce. */
function pick<T = unknown>(obj: Dict | null | undefined, keys: string[], coerce?: (x: unknown) => T): T | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const val = obj[k];
    if (val != null) return coerce ? coerce(val) : (val as T);
  }
  return undefined;
}

/** shelves input coming from the client */
type ShelfInput = {
  shelfId?: string | null;
  shelfName?: string;
  qty?: number;
  quantity?: number;
  stock?: number;
  onHand?: number;
};

type QtyAliases = {
  qty?: number | string;
  qtyAvailable?: number | string;
  quantity?: number | string;
  stock?: number | string;
  onHand?: number | string;
  totalQty?: number | string;
};

type BodyWithShelves = QtyAliases & { shelves?: ShelfInput[] };

/** Extract qty from various aliases or sum of shelves. */
function extractQty(body: BodyWithShelves | null | undefined): number {
  const direct = pick<number>(
    body as Dict,
    ['qty', 'qtyAvailable', 'quantity', 'stock', 'onHand', 'totalQty'],
    (x) => Number(x),
  );
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

  if (Array.isArray(body?.shelves)) {
    return body!.shelves.reduce<number>((a, s) => a + toInt(s.qty ?? s.quantity ?? s.stock ?? s.onHand), 0);
  }
  return 0;
}

/** Accept string (comma/newline) or string[] and normalize. */
function coerceStringList(input: unknown): string[] | null {
  if (Array.isArray(input)) {
    return input.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(/[\n,]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return null;
}

/** Normalize medicine details/facts from body (supports snake & camel). */
function normalizeDetails(raw: unknown): ApiFacts | null {
  const obj = (raw && typeof raw === 'object' ? (raw as Dict) : null);
  if (!obj) return null;

  const slipsCount = pick<number>(obj, ['slipsCount', 'slips_count'], Number);
  const tabletsPerSlip = pick<number>(obj, ['tabletsPerSlip', 'tablets_per_slip'], Number);
  const totalTablets = pick<number>(obj, ['totalTablets', 'total_tablets'], Number);

  const mrpAmount = pick<number>(obj, ['mrpAmount', 'mrp_amount'], Number);
  const mrpCurrency = pick<string>(obj, ['mrpCurrency', 'mrp_currency'], String);
  const mrpText = pick<string>(obj, ['mrpText', 'mrp_text'], String);

  return {
    slipsCount: slipsCount ?? null,
    tabletsPerSlip: tabletsPerSlip ?? null,
    totalTablets: totalTablets ?? null,
    mrpAmount: mrpAmount ?? null,
    mrpCurrency: mrpCurrency ?? null,
    mrpText: mrpText ?? null,
    inferredUses: coerceStringList(obj.inferredUses ?? obj.inferred_uses) ?? [],
    careNotes: coerceStringList(obj.careNotes ?? obj.care_notes) ?? [],
    sideEffectsCommon: coerceStringList(obj.sideEffectsCommon ?? obj.side_effects_common) ?? [],
    avoidIf: coerceStringList(obj.avoidIf ?? obj.avoid_if) ?? [],
    precautions: coerceStringList(obj.precautions) ?? [],
    interactionsKey: coerceStringList(obj.interactionsKey ?? obj.interactions_key) ?? [],
  };
}

/** Validate shelves sum and fields */
function validateShelves(totalQty: number, shelves: ShelfInput[]): string | null {
  if (!Array.isArray(shelves) || shelves.length === 0) {
    return 'At least one shelf allocation is required.';
  }
  const sum = shelves.reduce<number>((a, s) => a + toInt(s.qty ?? s.quantity ?? s.stock ?? s.onHand), 0);
  if (sum !== totalQty) {
    return `Shelf quantities (${sum}) must equal Total Qty (${totalQty}).`;
  }
  for (const s of shelves) {
    if (!s.shelfName || String(s.shelfName).trim() === '') {
      return 'shelfName is required for each shelf.';
    }
    if (toInt(s.qty ?? s.quantity ?? s.stock ?? s.onHand) <= 0) {
      return 'Shelf qty must be greater than zero.';
    }
  }
  return null;
}

/** DB row shape used by mapBatchRow (includes joins). */
type BatchJoined = InventoryBatch & {
  medicine: (Medicine & { facts: MedicineFacts | null }) | null;
  shelves: InventoryShelfAlloc[];
};

function mapBatchRow(row: BatchJoined): ApiBatchRow {
  const result: ApiBatchRow = {
    id: row.batchNo,
    name: row.medicine?.name ?? '',
    manufacturingDate: row.manufactureDate ? row.manufactureDate.toISOString().slice(0, 10) : '',
    expiryDate: row.expiryDate ? row.expiryDate.toISOString().slice(0, 10) : '',
    batchNumber: row.batchNo,
    purchasePrice: Number(row.costPrice ?? 0),
    sellingPrice: Number(row.mrp ?? 0),
    supplierName: row.medicine?.manufacturer ?? null,
    qtyAvailable: row.qtyAvailable ?? 0,
    qty: row.qtyAvailable ?? 0,
    minQty: 0,
    shelves: row.shelves.map((s) => ({
      shelfId: String(s.shelfId ?? ''),
      shelfName: s.shelfName,
      qty: s.qty,
    })),
  };

  if (row.medicine?.facts) {
    const f = row.medicine.facts;
    result.facts = {
      slipsCount: f.slipsCount ?? null,
      tabletsPerSlip: f.tabletsPerSlip ?? null,
      totalTablets: f.totalTablets ?? null,
      mrpAmount: f.mrpAmount != null ? Number(f.mrpAmount) : null,
      mrpCurrency: f.mrpCurrency ?? null,
      mrpText: f.mrpText ?? null,
      inferredUses: f.inferredUses ?? [],
      careNotes: f.careNotes ?? [],
      sideEffectsCommon: f.sideEffectsCommon ?? [],
      avoidIf: f.avoidIf ?? [],
      precautions: f.precautions ?? [],
      interactionsKey: f.interactionsKey ?? [],
    };
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Auth fallback (creates minimal admin+user if nothing exists)                */
/* -------------------------------------------------------------------------- */
async function resolveUserId(): Promise<number> {
  const existingUser = await prisma.user.findFirst({ select: { id: true } });
  if (existingUser) return existingUser.id;

  let admin: Pick<Admin, 'id'> | null = await prisma.admin.findFirst({ select: { id: true } });
  if (!admin) {
    admin = await prisma.admin.create({
      data: { email: 'admin@example.com', passwordHash: '!' },
      select: { id: true },
    });
  }

  const createdUser: Pick<User, 'id'> = await prisma.user.create({
    select: { id: true },
    data: {
      email: 'owner@example.com',
      passwordHash: '!',
      createdBy: { connect: { id: admin.id } },
    },
  });

  return createdUser.id;
}

/* -------------------------------------------------------------------------- */
/* GET /api/inventory                                                          */
/* -------------------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveUserId();
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('search') || searchParams.get('q') || '').trim();
    const take = Math.min(Math.max(parseInt(searchParams.get('take') || '20', 10) || 20, 1), 100);
    const cursor = searchParams.get('cursor');

    const or: Prisma.InventoryBatchWhereInput[] = q
      ? [
          { batchNo: { contains: q, mode: 'insensitive' } },
          { medicine: { is: { name: { contains: q, mode: 'insensitive' } } } },
          { medicine: { is: { manufacturer: { contains: q, mode: 'insensitive' } } } },
        ]
      : [];

    const where: Prisma.InventoryBatchWhereInput = { userId, ...(or.length ? { OR: or } : {}) };

    const rows = await prisma.inventoryBatch.findMany({
      where,
      include: { medicine: { include: { facts: true } }, shelves: true },
      orderBy: { createdAt: 'desc' },
      ...(cursor ? { cursor: { id: Number(cursor) }, skip: 1 } : {}),
      take,
    });

    const items = rows.map((r) => mapBatchRow(r as BatchJoined));
    const nextCursor = rows.length ? String(rows[rows.length - 1].id) : null;
    return NextResponse.json({ items, nextCursor });
  } catch (e: unknown) {
    console.error('GET /api/inventory', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

/* -------------------------------------------------------------------------- */
/* POST /api/inventory  (create batch + shelves + facts)                       */
/* -------------------------------------------------------------------------- */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveUserId();
    const bodyRaw: unknown = await req.json();
    const body = (bodyRaw && typeof bodyRaw === 'object' ? (bodyRaw as Dict) : {}) as BodyWithShelves & Dict;

    const medName = String(body.name ?? '').trim();
    const batchNo = String((body.batchNumber ?? body.id ?? '') as Primitive).trim();
    if (!medName || !batchNo) {
      return NextResponse.json({ error: 'name and batchNumber are required' }, { status: 400 });
    }

    const qtyAvailable = extractQty(body);
    const shelves: ShelfInput[] = Array.isArray(body.shelves) ? body.shelves : [];
    const shelfErr = validateShelves(qtyAvailable, shelves);
    if (shelfErr) return NextResponse.json({ error: shelfErr }, { status: 400 });

    const details = normalizeDetails(body.details ?? body.facts);

    const manufacturer: string | null =
      (typeof body.supplierName === 'string' && body.supplierName.trim()) ||
      (typeof body.manufacturer === 'string' && body.manufacturer.trim()) ||
      null;

    let medicine = await prisma.medicine.findFirst({
      where: { name: { equals: medName, mode: 'insensitive' } },
      include: { facts: true },
    });

    if (!medicine) {
      medicine = await prisma.medicine.create({
        data: {
          name: medName,
          strength: (body as Dict).strength as string | null,
          packSize: (body as Dict).packSize as string | null,
          mrp: body.sellingPrice != null ? toMoneyString(body.sellingPrice) : null,
          manufacturer,
        },
        include: { facts: true },
      });
    } else if (manufacturer && medicine.manufacturer !== manufacturer) {
      medicine = await prisma.medicine.update({
        where: { id: medicine.id },
        data: { manufacturer },
        include: { facts: true },
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const batch = await tx.inventoryBatch.create({
        data: {
          userId,
          medicineId: medicine!.id,
          batchNo,
          manufactureDate: asDate(body.manufacturingDate),
          expiryDate: asDate(body.expiryDate),
          qtyAvailable,
          costPrice: toMoneyString(body.purchasePrice),
          mrp: toMoneyString(body.sellingPrice),
          status: 'ACTIVE',
        },
      });

      if (shelves.length) {
        await tx.inventoryShelfAlloc.createMany({
          data: shelves.map((s) => ({
            batchId: batch.id,
            shelfId: s.shelfId ? String(s.shelfId) : null,
            shelfName: String(s.shelfName ?? ''),
            qty: toInt(s.qty ?? s.quantity ?? s.stock ?? s.onHand),
          })),
        });
      }

      if (details) {
        await tx.medicineFacts.upsert({
          where: { medicineId: medicine!.id },
          update: {
            slipsCount: details.slipsCount,
            tabletsPerSlip: details.tabletsPerSlip,
            totalTablets: details.totalTablets,
            mrpAmount: details.mrpAmount,
            mrpCurrency: details.mrpCurrency,
            mrpText: details.mrpText,
            inferredUses: details.inferredUses,
            careNotes: details.careNotes,
            sideEffectsCommon: details.sideEffectsCommon,
            avoidIf: details.avoidIf,
            precautions: details.precautions,
            interactionsKey: details.interactionsKey,
          },
          create: {
            medicineId: medicine!.id,
            slipsCount: details.slipsCount,
            tabletsPerSlip: details.tabletsPerSlip,
            totalTablets: details.totalTablets,
            mrpAmount: details.mrpAmount,
            mrpCurrency: details.mrpCurrency,
            mrpText: details.mrpText,
            inferredUses: details.inferredUses,
            careNotes: details.careNotes,
            sideEffectsCommon: details.sideEffectsCommon,
            avoidIf: details.avoidIf,
            precautions: details.precautions,
            interactionsKey: details.interactionsKey,
          },
        });
      }

      return tx.inventoryBatch.findUnique({
        where: { id: batch.id },
        include: { medicine: { include: { facts: true } }, shelves: true },
      });
    });

    if (!created) return NextResponse.json({ error: 'Create failed' }, { status: 500 });

    const item = mapBatchRow(created as BatchJoined);
    return NextResponse.json({ item }, { status: 201 });
  } catch (e: unknown) {
    console.error('POST /api/inventory', e);
    return NextResponse.json({ error: 'Create failed' }, { status: 500 });
  }
}

/* -------------------------------------------------------------------------- */
/* PUT /api/inventory  (update batch + shelves + facts)                        */
/* -------------------------------------------------------------------------- */
export async function PUT(req: NextRequest) {
  try {
    const userId = await resolveUserId();
    const bodyRaw: unknown = await req.json();
    const body = (bodyRaw && typeof bodyRaw === 'object' ? (bodyRaw as Dict) : {}) as BodyWithShelves & Dict;

    const currentBatchNo = String((body.id ?? body.batchNumber ?? '') as Primitive).trim();
    if (!currentBatchNo) {
      return NextResponse.json({ error: 'id (batchNo) is required' }, { status: 400 });
    }

    const found = await prisma.inventoryBatch.findFirst({
      where: { userId, batchNo: currentBatchNo },
      include: { medicine: { include: { facts: true } }, shelves: true },
    });
    if (!found) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });

    const medUpdates: Prisma.MedicineUpdateInput = {};
    if (typeof body.name === 'string') {
      const newName = body.name.trim();
      if (newName && newName !== found.medicine?.name) medUpdates.name = newName;
    }
    if (typeof body.supplierName === 'string') {
      const newMan = body.supplierName.trim();
      if (newMan && newMan !== (found.medicine?.manufacturer ?? '')) medUpdates.manufacturer = newMan;
    }

    const updates: Prisma.InventoryBatchUpdateInput = {};
    if (typeof body.manufacturingDate === 'string') updates.manufactureDate = asDate(body.manufacturingDate);
    if (typeof body.expiryDate === 'string') updates.expiryDate = asDate(body.expiryDate);
    if (typeof body.purchasePrice !== 'undefined') updates.costPrice = toMoneyString(body.purchasePrice);
    if (typeof body.sellingPrice !== 'undefined') updates.mrp = toMoneyString(body.sellingPrice);
    if (typeof body.batchNumber === 'string') {
      const newBatchNo = body.batchNumber.trim();
      if (newBatchNo && newBatchNo !== found.batchNo) updates.batchNo = newBatchNo;
    }

    const nextQty = extractQty(body);

    let replaceShelves = false;
    let newShelves: Array<{ shelfId: string | null; shelfName: string; qty: number }> = [];

    if (Array.isArray(body.shelves)) {
      const err = validateShelves(nextQty, body.shelves);
      if (err) return NextResponse.json({ error: err }, { status: 400 });

      replaceShelves = true;
      newShelves = body.shelves.map((s) => ({
        shelfId: s.shelfId ? String(s.shelfId) : null,
        shelfName: String(s.shelfName ?? ''),
        qty: toInt(s.qty ?? s.quantity ?? s.stock ?? s.onHand),
      }));
      updates.qtyAvailable = nextQty;
    } else if ('qty' in body || 'qtyAvailable' in body || 'quantity' in body || 'stock' in body || 'onHand' in body) {
      const currentSum = found.shelves.reduce((a, s) => a + s.qty, 0);
      if (currentSum !== nextQty) {
        return NextResponse.json(
          { error: `qty (${nextQty}) must equal current shelves total (${currentSum}). Send shelves to change both.` },
          { status: 400 },
        );
      }
      updates.qtyAvailable = nextQty;
    }

    const details = normalizeDetails(body.details ?? body.facts);

    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(medUpdates).length) {
        await tx.medicine.update({ where: { id: found.medicineId }, data: medUpdates });
      }
      if (Object.keys(updates).length) {
        await tx.inventoryBatch.update({ where: { id: found.id }, data: updates });
      }

      if (replaceShelves) {
        await tx.inventoryShelfAlloc.deleteMany({ where: { batchId: found.id } });
        if (newShelves.length) {
          await tx.inventoryShelfAlloc.createMany({
            data: newShelves.map((s) => ({
              batchId: found.id,
              shelfId: s.shelfId,
              shelfName: s.shelfName,
              qty: s.qty,
            })),
          });
        }
      }

      if (details) {
        await tx.medicineFacts.upsert({
          where: { medicineId: found.medicineId },
          update: {
            slipsCount: details.slipsCount,
            tabletsPerSlip: details.tabletsPerSlip,
            totalTablets: details.totalTablets,
            mrpAmount: details.mrpAmount,
            mrpCurrency: details.mrpCurrency,
            mrpText: details.mrpText,
            inferredUses: details.inferredUses,
            careNotes: details.careNotes,
            sideEffectsCommon: details.sideEffectsCommon,
            avoidIf: details.avoidIf,
            precautions: details.precautions,
            interactionsKey: details.interactionsKey,
          },
          create: {
            medicineId: found.medicineId,
            slipsCount: details.slipsCount,
            tabletsPerSlip: details.tabletsPerSlip,
            totalTablets: details.totalTablets,
            mrpAmount: details.mrpAmount,
            mrpCurrency: details.mrpCurrency,
            mrpText: details.mrpText,
            inferredUses: details.inferredUses,
            careNotes: details.careNotes,
            sideEffectsCommon: details.sideEffectsCommon,
            avoidIf: details.avoidIf,
            precautions: details.precautions,
            interactionsKey: details.interactionsKey,
          },
        });
      }

      return tx.inventoryBatch.findUnique({
        where: { id: found.id },
        include: { medicine: { include: { facts: true } }, shelves: true },
      });
    });

    if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

    const item = mapBatchRow(updated as BatchJoined);
    return NextResponse.json({ item });
  } catch (e: unknown) {
    console.error('PUT /api/inventory', e);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}

/* -------------------------------------------------------------------------- */
/* DELETE /api/inventory?id=<batchNo>                                         */
/* -------------------------------------------------------------------------- */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await resolveUserId();
    const { searchParams } = new URL(req.url);
    const batchNo = String(searchParams.get('id') ?? '').trim();
    if (!batchNo) return NextResponse.json({ error: 'id (batchNo) required' }, { status: 400 });

    const target = await prisma.inventoryBatch.findFirst({
      where: { userId, batchNo },
      select: { id: true },
    });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await prisma.inventoryBatch.delete({ where: { id: target.id } });

    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (e: unknown) {
    console.error('DELETE /api/inventory', e);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
