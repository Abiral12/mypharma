// src/lib/auth.ts
import { SignJWT, jwtVerify } from 'jose';
import type { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export type AuthClaims = { id: number; email: string };

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret) throw new Error('JWT_SECRET is not set');
const SECRET = new TextEncoder().encode(rawSecret);

export async function signToken(
  claims: AuthClaims,
  exp: string | number | Date = '1h'
): Promise<string> {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<AuthClaims | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ['HS256'] });
    return (typeof payload.id === 'number' && typeof payload.email === 'string')
      ? { id: payload.id, email: payload.email }
      : null;
  } catch {
    return null;
  }
}

export function readTokenFromReq(req: NextRequest): string | null {
  return req.cookies.get('token')?.value ?? null;
}

export async function getAuthFromReq(req: NextRequest): Promise<AuthClaims | null> {
  const token = readTokenFromReq(req);
  return token ? verifyToken(token) : null;
}

/**
 * Read auth from server cookies (App Router).
 * NOTE: `cookies()` is synchronous in Next.js App Router.
 */

export async function getAuthFromCookies(): Promise<AuthClaims | null> {
  const jar = await cookies();          // ⬅️ await it
  const token = jar.get('token')?.value ?? null;
  return token ? verifyToken(token) : null;
}

export function setAuthCookie(res: NextResponse, token: string, maxAgeSeconds = 60 * 60): void {
  res.cookies.set('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: maxAgeSeconds,
    path: '/',
  });
}

export function clearAuthCookie(res: NextResponse): void {
  res.cookies.set('token', '', { httpOnly: true, maxAge: 0, path: '/' });
}
