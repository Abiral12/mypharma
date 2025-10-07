import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Use your JWT secret
const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'your-secret-key');

// Public pages you can always visit
const PUBLIC_ROUTES = ['/', '/login', '/register'];

// Prefixes that require auth
const PROTECTED_PREFIXES = ['/dashboard'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes and static assets without checks
  if (
    PUBLIC_ROUTES.includes(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icons') ||
    pathname.match(/\.(png|jpg|jpeg|svg|gif|ico|css|js|txt|webp)$/)
  ) {
    return NextResponse.next();
  }

  // Only guard the protected prefixes
  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (!needsAuth) return NextResponse.next();

  // Read token cookie
  const token = req.cookies.get('token')?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  try {
    await jwtVerify(token, secret); // valid → continue
    return NextResponse.next();
  } catch {
    // Invalid/expired → clear cookie and send to login
    const res = NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete('token');
    return res;
  }
}

// Limit middleware to /dashboard only (avoids running on everything)
export const config = {
  matcher: ['/dashboard', '/dashboard/:path*'],
};
