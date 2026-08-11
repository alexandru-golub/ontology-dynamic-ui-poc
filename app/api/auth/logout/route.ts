import { NextRequest, NextResponse } from "next/server";
import {
  deleteSession,
  resolveSession,
  sessionCookieOptions,
  sessionTokenFromRequest,
  SESSION_COOKIE,
} from "@/lib/auth";
import { writeAudit } from "@/lib/db";
export const runtime = "nodejs";

/** Revoke the current session in the DB and clear the cookie. */
export async function POST(request: NextRequest) {
  const token = sessionTokenFromRequest(request);
  if (token) {
    const session = await resolveSession(token);
    await deleteSession(token);
    if (session) {
      await writeAudit({
        actorId: session.id,
        action: "LOGOUT",
        targetId: session.id,
        targetLabel: "User",
        changes: null,
      });
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(new Date(0)));
  return response;
}
