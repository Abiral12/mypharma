// app/api/reports/route.ts
import type { Summary, AlertRow, ApiReports } from '@/types/reports';
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

export const runtime = 'nodejs';

const g = globalThis as unknown as { prisma?: PrismaClient };
const prisma =
  g.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

// same user resolver style you used in /api/sales
async function resolveUserId(req: NextRequest): Promise<number> {
  const hdr = req.headers.get('x-user-id');
  if (hdr && /^\d+$/.test(hdr)) {
    const u = await prisma.user.findUnique({ where: { id: Number(hdr) } });
    if (u) return u.id;
  }
  const owner = await prisma.user.findUnique({ where: { email: 'owner@example.com' } });
  if (owner) return owner.id;
  const firstUser = await prisma.user.findFirst({ orderBy: { id: 'asc' } });
  if (firstUser) return firstUser.id;
  throw new Error('No users exist. Seed the DB or send x-user-id header.');
}

// Safe number conversion
const toNum = (x: unknown): number => {
  if (x === null || x === undefined) return 0;
  if (typeof x === 'number') return x;
  const parsed = Number(x);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    const { searchParams } = new URL(req.url);

    const fromStr = (searchParams.get('from') ?? '').trim();
    const toStr = (searchParams.get('to') ?? '').trim();

    const today = new Date();
    const from = fromStr ? new Date(fromStr) : new Date(today.getFullYear(), today.getMonth(), 1);
    const to = toStr ? new Date(toStr) : today;
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);

    // --- Sales (MTD) ---
    const salesMTD = await prisma.sale.findMany({
      where: { userId, createdAt: { gte: from, lte: toEnd } },
      select: { id: true, total: true, createdAt: true, lines: true },
      orderBy: { createdAt: 'asc' },
    });

    // collect all batchNos used to estimate cost -> profit
    const batchNos = Array.from(new Set(salesMTD.flatMap((s) => s.lines.map((l) => l.batchNo))));
    const batches = batchNos.length
      ? await prisma.inventoryBatch.findMany({
          where: { userId, batchNo: { in: batchNos } },
          select: {
            batchNo: true,
            costPrice: true,
            mrp: true,
            medicine: { select: { manufacturer: true } },
          },
        })
      : [];
    const costMap = new Map<string, number>(batches.map((b) => [b.batchNo, toNum(b.costPrice)]));
    const manuMap = new Map<string, string | null>(
      batches.map((b) => [b.batchNo, b.medicine?.manufacturer ?? null])
    );

    // compute MTD revenue/profit/orders
    let revenue = 0;
    let profit = 0;
    for (const s of salesMTD) {
      revenue += toNum(s.total);
      for (const l of s.lines) {
        const cp = costMap.get(l.batchNo) ?? 0;
        profit += (toNum(l.price) - cp) * l.qty;
      }
    }
    const orders = salesMTD.length;

    // --- Trend: last 14 days ---
    const since = new Date();
    since.setDate(since.getDate() - 13);
    since.setHours(0, 0, 0, 0);

    const sales14 = await prisma.sale.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { total: true, createdAt: true, lines: true },
      orderBy: { createdAt: 'asc' },
    });

    const dayKey = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
    const trendMap = new Map<string, { sales: number; profit: number }>();
    // seed 14 days
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      trendMap.set(dayKey(d), { sales: 0, profit: 0 });
    }
    for (const s of sales14) {
      const key = dayKey(s.createdAt);
      const bucket = trendMap.get(key) ?? { sales: 0, profit: 0 };
      bucket.sales += toNum(s.total);
      for (const l of s.lines) {
        const cp = costMap.get(l.batchNo) ?? 0;
        bucket.profit += (toNum(l.price) - cp) * l.qty;
      }
      trendMap.set(key, bucket);
    }
    const trend = Array.from(trendMap.entries()).map(([k, v]) => ({
      date: new Date(k).toLocaleDateString(),
      sales: Math.round(v.sales),
      profit: Math.round(v.profit),
    }));

    // --- Inventory balance ---
    const invAgg = await prisma.inventoryBatch.aggregate({
      where: { userId },
      _sum: { qtyAvailable: true },
    });
    const inventoryItems = toNum(invAgg._sum.qtyAvailable);

    // --- Alerts (low stock + expiring in 30d) ---
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const lowAndExp = await prisma.inventoryBatch.findMany({
      where: {
        userId,
        OR: [{ qtyAvailable: { lte: 10 } }, { expiryDate: { lte: soon } }],
      },
      select: {
        batchNo: true,
        qtyAvailable: true,
        expiryDate: true,
        medicine: { select: { name: true } },
      },
      orderBy: { qtyAvailable: 'asc' },
      take: 10,
    });
    const alerts: AlertRow[] = lowAndExp.map((b) => ({
      id: b.batchNo,
      name: b.medicine?.name ?? 'Unknown',
      qty: b.qtyAvailable,
      expiry: b.expiryDate ? b.expiryDate.toISOString().slice(0, 10) : null,
    }));

    // --- Aging buckets ---
    const allBatches = await prisma.inventoryBatch.findMany({
      where: { userId },
      select: { qtyAvailable: true, expiryDate: true },
    });
    const agingBuckets = { '0–30d': 0, '31–60d': 0, '61–90d': 0, '90–180d': 0, '180+d': 0 };
    const now = new Date().getTime();
    for (const b of allBatches) {
      const q = b.qtyAvailable ?? 0;
      if (!b.expiryDate) {
        agingBuckets['180+d'] += q;
        continue;
      }
      const days = Math.ceil((b.expiryDate.getTime() - now) / (1000 * 60 * 60 * 24));
      if (days <= 30) agingBuckets['0–30d'] += q;
      else if (days <= 60) agingBuckets['31–60d'] += q;
      else if (days <= 90) agingBuckets['61–90d'] += q;
      else if (days <= 180) agingBuckets['90–180d'] += q;
      else agingBuckets['180+d'] += q;
    }
    const aging = Object.entries(agingBuckets).map(([bucket, qty]) => ({ bucket, qty }));

    // --- Category share ---
    const manuAgg = new Map<string, number>();
    for (const s of salesMTD) {
      for (const l of s.lines) {
        const manu = (manuMap.get(l.batchNo) || 'Other') as string;
        manuAgg.set(manu, (manuAgg.get(manu) ?? 0) + toNum(l.lineTotal));
      }
    }
    const cats = Array.from(manuAgg.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, val]) => ({ name, value: Math.round(val) }));

    const summary: Summary = {
      revenue: Math.round(revenue),
      profit: Math.round(profit),
      orders,
      items: inventoryItems,
    };

    return NextResponse.json(
      { trend, top: [], cats, aging, alerts, summary } satisfies ApiReports
    );
  } catch (e: unknown) {
    console.error('/api/reports error:', e);
    const msg = e instanceof Error ? e.message : 'Server error';
    const status = /No users exist/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
