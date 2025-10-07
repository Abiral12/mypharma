import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { verifyToken, signToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const normalizeRole = (name: string) =>
  name.trim().toUpperCase().replace(/[\s-]+/g, '_');

type CreateBody = { email: string; password: string; roles: string[]; permissions: string[]; };
type PutBody = { currentPassword?: string; newPassword?: string; newEmail?: string; };

function readAuth(req: NextRequest) {
  const token = req.cookies.get('token')?.value ?? null;
  return token ? verifyToken(token) : Promise.resolve(null);
}

/* ----------------------------- CREATE USER ----------------------------- */
export async function POST(req: NextRequest) {
  try {
    const payload = await readAuth(req);
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = await prisma.admin.findUnique({ where: { id: payload.id } });
    if (!admin) return NextResponse.json({ error: 'Session expired' }, { status: 401 });

    const body = (await req.json()) as Partial<CreateBody>;
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const roles = (body.roles ?? []).map(normalizeRole);
    const permissions = body.permissions ?? [];

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: body.email!, passwordHash, createdById: admin.id },
      });

      if (permissions.length > 0) {
        await tx.permission.createMany({
          data: [...new Set(permissions)].map((name) => ({ name })),
          skipDuplicates: true,
        });
      }

      for (const roleName of roles) {
        const role = await tx.role.upsert({
          where: { name: roleName },
          update: {},
          create: { name: roleName, description: `${roleName} role` },
        });

        if (permissions.length > 0) {
          await tx.role.update({
            where: { id: role.id },
            data: { permissions: { connect: [...new Set(permissions)].map((name) => ({ name })) } },
          });
        }

        await tx.userRole.createMany({
          data: [{ userId: created.id, roleId: role.id }],
          skipDuplicates: true,
        });
      }

      return created;
    });

    return NextResponse.json({ message: 'User created successfully', user }, { status: 201 });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }
    console.error('POST /api/admin/users error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/* ----------------------- UPDATE MY PROFILE (email/pwd) ---------------------- */
export async function PUT(req: NextRequest) {
  try {
    const payload = await readAuth(req);
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as PutBody;
    if (!body || (!body.newEmail && !body.newPassword)) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const me = await prisma.admin.findUnique({ where: { id: payload.id } });
    if (!me) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    if (body.newPassword) {
      if (body.newPassword.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
      }
      if (!body.currentPassword) {
        return NextResponse.json({ error: 'Current password required' }, { status: 400 });
      }
      const ok = await bcrypt.compare(body.currentPassword, me.passwordHash);
      if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }

    const data: { email?: string; passwordHash?: string } = {};
    if (body.newEmail && body.newEmail !== me.email) data.email = body.newEmail;
    if (body.newPassword) data.passwordHash = await bcrypt.hash(body.newPassword, 10);

    const updated = await prisma.admin.update({
      where: { id: me.id },
      data,
      select: { id: true, email: true },
    });

    const res = NextResponse.json({ message: 'Profile updated', user: updated });
    if (data.email) {
      const token = await signToken({ id: updated.id, email: updated.email }, '7d');
      res.cookies.set('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      });
    }
    return res;
  } catch (err) {
    console.error('PUT /api/admin/users error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
