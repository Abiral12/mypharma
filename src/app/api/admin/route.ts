import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const [roles, permissions] = await Promise.all([
      prisma.role.findMany({
        include: { permissions: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.permission.findMany({ orderBy: { name: 'asc' } }),
    ]);

    const rolePermissions: Record<string, string[]> = {};
    for (const r of roles) {
      rolePermissions[r.name] = r.permissions.map((p) => p.name);
    }

    return NextResponse.json({
      roles: roles.map((r) => ({ id: r.id, name: r.name })),
      permissions,
      rolePermissions,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to load metadata' }, { status: 500 });
  }
}
