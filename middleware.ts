import { NextRequest, NextResponse } from "next/server";

// Edge runtime cannot import lib/auth (node:crypto/bcrypt), so the cookie name
// is duplicated here — keep it in sync with lib/auth.ts (SESSION_COOKIE).
const SESSION_COOKIE = "gs_session";

/**
 * Cheap edge gate: presence of the session cookie. Validity is enforced
 * authoritatively by the GraphQL + auth routes (DB lookup per request).
 * Pages redirect to /login; API routes answer 401 JSON so clients can react.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const publicPaths = ["/login", "/api/auth/login", "/api/auth/session"];
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (!request.cookies.has(SESSION_COOKIE)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
