/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Reservation } from "@/types";

vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/payment-events-admin", () => ({ fetchPendingPaymentCountsByReservation: vi.fn() }));
vi.mock("@/lib/reservation-preorder", () => ({ fetchPreorderSummaries: vi.fn() }));

import { listReservationsForAdmin, type EnrichDeps } from "@/lib/reservation-list-query";
import { DepositStatusControl } from "./DepositStatusControl";

describe("admin reservation list payment notification status", () => {
  it("shows the accepted state from the projected list response", async () => {
    const row = {
      id: "res-test-1", room_id: "room-1", customer_name: "測試客人", phone: "0900000000",
      start_time: "2026-10-01T06:00:00Z", end_time: "2026-10-01T08:00:00Z", status: "confirmed",
      total_price: 500, guest_count: 2, notes: null, created_at: "2026-09-01T00:00:00Z",
      is_deposit_paid: true, deposit_approved_notified_at: "2026-09-03T00:00:00Z",
      deposit_approved_retry_key: "internal-only",
    };
    const db = {
      from(table: string) {
        const builder: Record<string, unknown> = {};
        for (const method of ["select", "eq", "in", "limit"]) builder[method] = () => builder;
        builder.then = (resolve: (value: unknown) => void) => resolve({
          data: table === "rooms" ? [{ id: "room-1", name: "A 包廂" }] : [row], error: null,
        });
        return builder;
      },
    };
    const enrichDeps: EnrichDeps = {
      pendingCounts: async () => new Map(), preorders: async () => new Map(),
      autoCancelled: async () => new Set(), visitCounts: async () => new Map(),
    };
    const result = await listReservationsForAdmin({
      branchId: "b1", scope: "active", range: "30d", status: "all", q: "", cursor: null, limit: 50, id: row.id, listContract: "v2",
    }, { db: db as never, enrichDeps });
    expect(result.items[0]).not.toHaveProperty("deposit_approved_retry_key");
    render(<DepositStatusControl reservation={result.items[0] as unknown as Reservation} isDepositRequired
      onUpdateDepositStatus={vi.fn()} onUpdateDepositInfo={vi.fn()} />);
    expect(screen.getByText("LINE 平台已接受（不重複）")).toBeDefined();
    expect(screen.queryByText("未推播通知")).toBeNull();
  });
});
