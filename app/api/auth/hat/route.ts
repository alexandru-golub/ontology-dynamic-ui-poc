import { NextRequest, NextResponse } from "next/server";
import {
  sessionTokenFromRequest,
  setSessionHat,
} from "@/lib/auth";
import { writeAudit } from "@/lib/db";
export const runtime = "nodejs";

/**
 * Switch the active hat (Role) of the current session. The hat must be one
 * the user actually holds — the server verifies it against the graph.
 * roleName null clears the hat (back to the user's full role set).
 */
export async function POST(request: NextRequest) {
  const token = sessionTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { roleName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const roleName = body.roleName === null ? null : typeof body.roleName === "string" ? body.roleName : undefined;
  if (roleName === undefined) {
    return NextResponse.json({ error: "roleName must be a string or null" }, { status: 400 });
  }

  const session = await setSessionHat(token, roleName);
  if (!session) {
    return NextResponse.json({ error: "You do not hold that hat (role)" }, { status: 403 });
  }
  await writeAudit({
    actorId: session.id,
    action: "HAT",
    targetId: session.id,
    targetLabel: "User",
    changes: { roleName },
  });
  return NextResponse.json({
    user: { id: session.id, name: session.name, isAdmin: session.isAdmin },
    roleName: session.roleName,
    roles: session.roles,
  });
}
