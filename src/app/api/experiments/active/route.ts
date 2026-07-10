import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  assignVariant,
  isExperimentActive,
  parseVariants,
  type ExperimentRecord,
} from "@/lib/experiments";
import { isAdminConfigured } from "@/lib/supabase-admin";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Public: resolve active experiment assignments for client (no PII). */
export async function GET(request: NextRequest) {
  const sessionId =
    request.nextUrl.searchParams.get("session_id")?.trim() || "anonymous";

  if (!isAdminConfigured()) {
    return NextResponse.json({ assignments: [] });
  }

  try {
    const { data, error } = await supabaseAdmin()
      .from("experiments")
      .select("*")
      .eq("status", "running");

    if (error) {
      return NextResponse.json({ assignments: [] });
    }

    const assignments = (data ?? [])
      .map((row) => ({
        id: row.id as string,
        key: row.key as string,
        name: row.name as string,
        description: (row.description as string | null) ?? null,
        target_audience: row.target_audience as string,
        status: row.status as ExperimentRecord["status"],
        variants: parseVariants(row.variants),
        start_at: row.start_at as string | null,
        end_at: row.end_at as string | null,
      }))
      .filter((exp) => isExperimentActive(exp))
      .map((exp) => ({
        key: exp.key,
        variant: assignVariant(exp.key, sessionId, exp.variants),
      }));

    return NextResponse.json({ assignments });
  } catch {
    return NextResponse.json({ assignments: [] });
  }
}
