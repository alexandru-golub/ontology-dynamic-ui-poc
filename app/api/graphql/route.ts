import { graphql } from "graphql";
import { NextRequest, NextResponse } from "next/server";
import { getRequestSession } from "@/lib/auth";
import { getSchema } from "@/lib/schema";
export const runtime = "nodejs";

/**
 * The acting identity comes from the DB-backed session cookie (lib/auth.ts);
 * the legacy `x-user-id` header is no longer trusted. In local dev you may
 * set AUTH_BYPASS_USER to a user id to skip login entirely.
 */
async function execute(request: NextRequest) {
  const { query, variables, operationName } = await request.json();

  const session = await getRequestSession(request);
  const userId = session?.id ?? process.env.AUTH_BYPASS_USER ?? null;
  if (!userId) {
    return NextResponse.json({ errors: [{ message: "Not authenticated" }] }, { status: 401 });
  }
  const result = await graphql({
    schema: getSchema({ userId, roleName: session?.roleName ?? null }),
    source: query,
    variableValues: variables,
    operationName,
  });
  return NextResponse.json(result, { status: result.errors ? 400 : 200 });
}
export const POST = execute;
