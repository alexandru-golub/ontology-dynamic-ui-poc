import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  findUserByLogin,
  resolveSession,
  sessionCookieOptions,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";
import { writeAudit } from "@/lib/db";
export const runtime = "nodejs";

/**
 * DB-backed login: the username is the User node id (the hat rack), the
 * password is verified against the bcrypt hash stored on the User node.
 * Success issues an opaque session token in an httpOnly cookie; the DB keeps
 * only the token's SHA-256 hash.
 */
export async function POST(request: NextRequest) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  const user = await findUserByLogin(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const { token, expiresAt } = await createSession(user.id, null, {
    ip: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });
  const session = await resolveSession(token);
  await writeAudit({
    actorId: user.id,
    action: "LOGIN",
    targetId: user.id,
    targetLabel: "User",
    changes: null,
  });

  const response = NextResponse.json({
    user: { id: user.id, name: user.name, isAdmin: user.isAdmin },
    roleName: session?.roleName ?? null,
    roles: session?.roles ?? [],
  });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(new Date(expiresAt)));
  return response;
}
