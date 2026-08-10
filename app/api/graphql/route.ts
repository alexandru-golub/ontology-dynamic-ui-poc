import { graphql } from "graphql";
import { NextRequest, NextResponse } from "next/server";
import { getSchema } from "@/lib/schema";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { query, variables, operationName } = await request.json();
  // Development identity only. In production verify an IdP JWT and take email/sub from its claims.
  const userEmail = request.headers.get("x-demo-user") ?? process.env.DEMO_USER_EMAIL ?? "john@example.com";
  const schema = await getSchema(userEmail);
  const result = await graphql({ schema, source: query, variableValues: variables, operationName, contextValue: {} });
  return NextResponse.json(result, { status: result.errors ? 400 : 200 });
}
