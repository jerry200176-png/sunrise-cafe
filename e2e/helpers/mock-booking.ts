import type { Page } from "@playwright/test";

export const MOCK_BRANCH = {
  id: "e2e-branch-1",
  name: "E2E 測試分店",
  address: "台北市大安區測試路 1 號",
  open_time: "08:00",
  close_time: "22:00",
};

export const MOCK_ROOM = {
  roomId: "e2e-room-1",
  roomName: "E2E 包廂 A",
  roomType: "包廂",
  min_capacity: 2,
  capacity: 8,
  price_weekday: 800,
  price_weekend: 1000,
  image_url: null,
};

/** Tomorrow's date YYYY-MM-DD (UTC+8 approximation for E2E). */
export function bookingDateOffset(days = 1): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Hourly slots 10:00–18:00 local +08:00, all available. */
export function mockSlotsForDate(date: string) {
  const slots: { start: string; end: string; available: boolean }[] = [];
  for (let h = 10; h < 18; h++) {
    const start = new Date(`${date}T${pad(h)}:00:00+08:00`).toISOString();
    const end = new Date(`${date}T${pad(h + 1)}:00:00+08:00`).toISOString();
    slots.push({ start, end, available: true });
  }
  return slots;
}

export async function setupBookingApiMocks(page: Page, date: string) {
  const slots = mockSlotsForDate(date);

  await page.route("**/api/branches", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([MOCK_BRANCH]),
    });
  });

  await page.route("**/api/settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rental_notes: [],
        deposit_info: null,
        closed_dates: [],
      }),
    });
  });

  await page.route("**/api/availability**", async (route) => {
    const url = new URL(route.request().url());
    const roomId = url.searchParams.get("roomId");
    if (roomId) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slots,
          roomName: MOCK_ROOM.roomName,
          branchName: MOCK_BRANCH.name,
          openTime: MOCK_BRANCH.open_time,
          closeTime: MOCK_BRANCH.close_time,
          image_url: null,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        branchName: MOCK_BRANCH.name,
        rooms: [{ ...MOCK_ROOM, slots }],
      }),
    });
  });

  await page.route("**/api/reservations", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "e2e-res-1",
        booking_code: "E2E001",
        status: "pending",
      }),
    });
  });
}

export async function setupMyBookingsMock(page: Page) {
  await page.route("**/api/my-bookings**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "e2e-res-1",
          booking_code: "E2E001",
          room_id: MOCK_ROOM.roomId,
          branch_id: MOCK_BRANCH.id,
          room_name: MOCK_ROOM.roomName,
          branch_name: MOCK_BRANCH.name,
          branch_display_name: MOCK_BRANCH.name,
          payment_info: "銀行：012-1234567890 戶名：測試",
          line_pay_url: null,
          start_time: new Date(`${bookingDateOffset(3)}T12:00:00+08:00`).toISOString(),
          end_time: new Date(`${bookingDateOffset(3)}T14:00:00+08:00`).toISOString(),
          status: "confirmed",
          total_price: 2000,
          guest_count: 4,
          customer_name: "測試客人",
          deposit_required: true,
          deposit_amount: 1000,
          is_deposit_paid: false,
          created_at: new Date().toISOString(),
        },
      ]),
    });
  });
}
