import { NextResponse } from "next/server";

/** Legacy migration APIs must not write without a reviewed, retained backup. */
export function migrationPaused() {
  return NextResponse.json(
    { error: "資料庫遷移暫停中，請使用經審查的備份與修復流程。" },
    { status: 503 }
  );
}
