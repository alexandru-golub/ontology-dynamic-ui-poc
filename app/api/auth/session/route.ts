import { NextRequest, NextResponse } from "next/server";
import { getRequestSession } from "@/lib/auth";
export const runtime = "nodejs";

/**
 * Current session state (user + active hat + available hats). Returns
 * `{ user: null }` (200) when there is no valid session so the client can
 * redirect to /login without error handling.
 */
export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: { id: session.id, name: session.name, isAdmin: session.isAdmin },
    roleName: session.roleName,
    roles: session.roles,
  });
}
