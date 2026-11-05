import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

import { supabaseEffects } from "./reservation-lifecycle";

function queryBuilder() {
  const query = {
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
  };
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.select.mockResolvedValue({
    data: [{
      id: "r1",
      status: "cancelled",
      room_id: "room-1",
      start_time: "2026-11-01T06:00:00.000Z",
      end_time: "2026-11-01T08:00:00.000Z",
      guest_count: 2,
      is_deposit_paid: false,
      booking_code: "ABC123",
      customer_name: "王",
      phone: "0900",
      line_user_id: "U1",
      review_invited_at: null,
    }],
    error: null,
  });
  return query;
}

describe("reservation lifecycle snapshot CAS null handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [null, "is"],
    [false, "eq"],
    [true, "eq"],
  ] as const)("uses the correct PostgREST filter when paid is %s", async (paid, method) => {
    const query = queryBuilder();
    mockFrom.mockReturnValue(query);

    const changed = await supabaseEffects.updateIfSnapshot!("r1", {
      status: "pending",
      room_id: "room-1",
      start_time: "2026-11-01T06:00:00.000Z",
      end_time: "2026-11-01T08:00:00.000Z",
      guest_count: 2,
      is_deposit_paid: paid,
      review_invited_at: null,
    }, { status: "cancelled" });

    expect(changed).toMatchObject({ status: "cancelled", line_user_id: "U1" });
    expect(mockFrom).toHaveBeenCalledWith("reservations");
    expect(query[method]).toHaveBeenCalledWith("is_deposit_paid", paid);
    expect(query.eq).toHaveBeenCalledWith("status", "pending");
    expect(query.eq).not.toHaveBeenCalledWith("customer_name", expect.anything());
    expect(query.eq).not.toHaveBeenCalledWith("phone", expect.anything());
    expect(query.eq).not.toHaveBeenCalledWith("line_user_id", expect.anything());
    if (method === "is") expect(query.eq).not.toHaveBeenCalledWith("is_deposit_paid", null);
  });
});
