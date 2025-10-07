import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// same fallback user resolver you use
async function resolveUserId(): Promise<number> {
  const u = await prisma.user.findFirst({ select: { id: true } });
  if (u) return u.id;
  let admin = await prisma.admin.findFirst({ select: { id: true } });
  if (!admin) admin = await prisma.admin.create({ data: { email: 'admin@example.com', passwordHash: '!' }, select: { id: true } });
  const created = await prisma.user.create({
    select: { id: true },
    data: { email: 'owner@example.com', passwordHash: '!', createdById: admin.id }
  });
  return created.id;
}

// GET ?q=…  -> list shelves (active)
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveUserId();
    const q = new URL(req.url).searchParams.get('q')?.trim() || '';
    const rows = await prisma.pharmacyShelf.findMany({
      where: { userId, isActive: true, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
      take: 100
    });
    return NextResponse.json({ items: rows.map(r => ({ id: r.id, name: r.name, code: r.code ?? null })) });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load shelves' }, { status: 500 });
  }
}

// POST { name, code? } -> create shelf
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveUserId();
    const body = await req.json();
    const name = String(body?.name || '').trim();
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const shelf = await prisma.pharmacyShelf.upsert({
      where: { userId_name: { userId, name } },
      update: { isActive: true, code: body?.code ?? null },
      create: { userId, name, code: body?.code ?? null }
    });
    return NextResponse.json({ item: { id: shelf.id, name: shelf.name, code: shelf.code } }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Create failed' }, { status: 500 });
  }
}
