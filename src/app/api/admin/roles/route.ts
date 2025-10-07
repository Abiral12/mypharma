import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, permissions: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({ roles });
}
