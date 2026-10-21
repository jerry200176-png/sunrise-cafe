import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { auditLineAccounts } from "@/lib/line-account-audit";

export const dynamic = "force-dynamic";

/**
 * Owner-only, read-only: which LINE Official Account each configured token belongs to
 * (display name / basic ID) and that account's monthly quota and usage.
 * Sends no message; never returns token values.
 */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "line:audit");
  if (denied) return denied;
  return NextResponse.json(await auditLineAccounts(), { headers: { "Cache-Control": "no-store" } });
}
