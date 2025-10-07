import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value ?? null;
  if (!token) return NextResponse.json({ user: null }, { status: 200 });

  const claims = await verifyToken(token);
  return NextResponse.json({ user: claims ? { email: claims.email, id: claims.id } : null }, { status: 200 });
}
