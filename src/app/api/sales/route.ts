// app/api/sales/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, Prisma } from '@prisma/client';

export const runtime = 'nodejs';

// Prisma singleton (DO NOT export anything except allowed route fields)
const g = globalThis as unknown as { prisma?: PrismaClient };
const prisma =
  g.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

/** Resolve and VALIDATE the current user. Throws with a helpful message if missing. */
async function resolveUserId(req: NextRequest): Promise<number> {
  // 1) If client sends a header, use it (dev/testing)
  const hdr = req.headers.get('x-user-id');
  if (hdr && /^\d+$/.test(hdr)) {
    const uid = Number(hdr);
    const u = await prisma.user.findUnique({ where: { id: uid } });
    if (!u) {
      throw new Error(
        `User with id=${uid} not found. Pass a valid x-user-id header, or run your seed so a user exists.`
      );
    }
    return u.id;
  }

  // 2) Try the seeded owner
  const owner = await prisma.user.findUnique({ where: { email: 'owner@example.com' } });
  if (owner) return owner.id;

  // 3) As a last resort, try "first user"
  const anyUser = await prisma.user.findFirst({ orderBy: { id: 'asc' } });
  if (anyUser) return anyUser.id;

  // 4) Nothing found -> fail fast with clear message
  throw new Error(
    'No users exist. Run your seed (e.g. `node prisma/seed.js` or `npx prisma db seed`) or send a valid x-user-id header.'
  );
}

type PostLine = { id: string; name: string; price: number; qty: number; lineTotal: number };
type PostBody = { total: number; lines: PostLine[] };

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    const body = (await req.json()) as PostBody;

    // Validate payload
    if (
      !body ||
      !Number.isFinite(body.total) ||
      !Array.isArray(body.lines) ||
      body.lines.length === 0
    ) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    for (const l of body.lines) {
      if (
        !l ||
        typeof l.id !== 'string' ||
        !l.id ||
        typeof l.name !== 'string' ||
        !Number.isFinite(l.price) ||
        !Number.isInteger(l.qty) ||
        !Number.isFinite(l.lineTotal)
      ) {
        return NextResponse.json({ error: 'Invalid line item' }, { status: 400 });
      }
    }

    // Create Sale + lines
    type CreatedSale = Prisma.SaleGetPayload<{ include: { lines: true; user: true } }>;
    const created: CreatedSale = await prisma.sale.create({
      data: {
        userId,
        total: new Prisma.Decimal(body.total),
        lines: {
          create: body.lines.map((l) => ({
            batchNo: l.id,
            name: l.name,
            price: new Prisma.Decimal(l.price),
            qty: l.qty,
            lineTotal: new Prisma.Decimal(l.lineTotal),
          })),
        },
      },
      include: { lines: true, user: true },
    });

    return NextResponse.json({ ok: true, id: created.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Server error';
    const status = /not found|No users exist|seed/i.test(msg) ? 400 : 500;
    // eslint-disable-next-line no-console
    console.error('POST /api/sales error:', e);
    return NextResponse.json({ error: msg }, { status });
  }
}

/** GET /api/sales?q=&page=&limit= */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') ?? '').trim();
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 20)));
    const skip = (page - 1) * limit;

    const where: Prisma.SaleWhereInput =
      q.length > 0
        ? {
            userId,
            lines: {
              some: {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { batchNo: { contains: q, mode: 'insensitive' } },
                ],
              },
            },
          }
        : { userId };

    type SaleWithLinesUser = Prisma.SaleGetPayload<{
      include: { lines: true; user: true };
    }>;

    const [items, totalCount] = await Promise.all([
      prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { lines: true, user: true },
      }),
      prisma.sale.count({ where }),
    ]);

    const pages = Math.max(1, Math.ceil(totalCount / limit));

    const out = (items as SaleWithLinesUser[]).map((s) => ({
      _id: String(s.id),
      total: Number(s.total),
      createdAt: new Date(s.createdAt).toISOString(),
      createdBy: s.user?.email ?? null,
      lines: s.lines.map((l) => ({
        id: l.batchNo,
        name: l.name,
        price: Number(l.price),
        qty: l.qty,
        lineTotal: Number(l.lineTotal),
      })),
    }));

    return NextResponse.json({ items: out, totalCount, page, pages });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Server error';
    const status = /not found|No users exist|seed/i.test(msg) ? 400 : 500;
    // eslint-disable-next-line no-console
    console.error('GET /api/sales error:', e);
    return NextResponse.json({ error: msg }, { status });
  }
}
