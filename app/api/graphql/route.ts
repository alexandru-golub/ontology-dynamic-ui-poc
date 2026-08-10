import { graphql } from "graphql";
import { NextRequest, NextResponse } from "next/server";
import { getSchema } from "@/lib/schema";
export const runtime = "nodejs";
async function execute(request: NextRequest) {
const { query, variables, operationName } = await request.json();
const userId = request.headers.get("x-user-id") ?? process.env.DEMO_USER_ID ?? "user_101";
const result = await graphql({ schema: getSchema(userId), source: query, variableValues: variables, operationName });
return NextResponse.json(result, { status: result.errors ? 400 : 200 });
}
export const POST = execute;
