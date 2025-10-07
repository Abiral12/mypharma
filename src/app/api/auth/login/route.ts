import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, setAuthCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LoginBody = { email: string; password: string };

function parseLoginBody(v: unknown): LoginBody | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.email !== 'string' || typeof r.password !== 'string') return null;
  return { email: r.email, password: r.password };
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => null);
    const body = parseLoginBody(raw);
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const admin = await prisma.admin.findUnique({ where: { email: body.email } });
    if (!admin) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    const ok = await bcrypt.compare(body.password, admin.passwordHash);
    if (!ok) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    const token = await signToken({ id: admin.id, email: admin.email }, '1h');

    const res = NextResponse.json({ message: 'Login successful' });
    setAuthCookie(res, token, 60 * 60); // 1 hour
    return res;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
