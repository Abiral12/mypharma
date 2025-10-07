import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, setAuthCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RegisterBody = { email: string; password: string };

function parseRegisterBody(v: unknown): RegisterBody | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.email !== 'string' || typeof r.password !== 'string') return null;
  return { email: r.email, password: r.password };
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => null);
    const body = parseRegisterBody(raw);
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const passwordHash = await bcrypt.hash(body.password, 10);

    const admin = await prisma.admin.create({
      data: { email: body.email, passwordHash },
    });

    // Auto-login after registration (optional but nice)
    const token = await signToken({ id: admin.id, email: admin.email }, '1h');
    const res = NextResponse.json({ message: 'Registered', admin: { id: admin.id, email: admin.email } }, { status: 201 });
    setAuthCookie(res, token, 60 * 60);
    return res;
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') {
      return NextResponse.json({ error: 'Email already exists' }, { status: 400 });
    }
    console.error('Registration error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
