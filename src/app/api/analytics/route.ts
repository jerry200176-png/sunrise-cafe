import { NextRequest, NextResponse } from "next/server";
import { recordAnalyticsEvent } from "@/lib/analytics-server";
import {
  isAnalyticsEventName,
  sanitizeAnalyticsProperties,
} from "@/lib/analytics-events";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const event_name = body?.event_name;
    if (!event_name || !isAnalyticsEventName(event_name)) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }

    const session_id =
      typeof body.session_id === "string" ? body.session_id.slice(0, 64) : null;
    const branch_id =
      typeof body.branch_id === "string" ? body.branch_id : null;
    const room_id = typeof body.room_id === "string" ? body.room_id : null;
    const properties = sanitizeAnalyticsProperties(body.properties);

    await recordAnalyticsEvent({
      event_name,
      session_id,
      branch_id,
      room_id,
      properties,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
