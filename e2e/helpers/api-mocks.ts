import { Page } from "@playwright/test";

export const MOCK_BRANCH = {
  id: "branch-mock-1",
  name: "測試分店",
  open_time: "09:00",
  close_time: "21:00",
};

export const MOCK_ROOM = {
  id: "room-mock-1",
  name: "測試包廂",
  capacity: 8,
  min_capacity: 2,
  price_weekday: 200,
  price_weekend: 300,
  branch_id: MOCK_BRANCH.id,
};

export const MOCK_BOOKING_CODE = "TST001";
export const MOCK_RESERVATION_ID = "res-mock-1";

/** Date within waitlist max (+30d) and booking max (+1mo) for E2E */
export function e2eFutureDate(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}
function buildMockSlots(date = e2eFutureDate()) {
  const slots = [];
  for (let h = 10; h < 18; h++) {
    const start = `${date}T${String(h).padStart(2, "0")}:00:00+08:00`;
    const end = `${date}T${String(h + 1).padStart(2, "0")}:00:00+08:00`;
    slots.push({ start, end, available: h !== 14 });
  }
  return slots;
}

function branchAvailabilityResponse(date: string) {
  const slots = buildMockSlots(date);
  return {
    rooms: [
      {
        roomId: MOCK_ROOM.id,
        roomName: MOCK_ROOM.name,
        roomType: null,
        min_capacity: MOCK_ROOM.min_capacity,
        capacity: MOCK_ROOM.capacity,
        price_weekday: MOCK_ROOM.price_weekday,
        price_weekend: MOCK_ROOM.price_weekend,
        image_url: null,
        slots,
      },
    ],
    branchName: MOCK_BRANCH.name,
    closed: false,
  };
}

function roomAvailabilityResponse(date: string) {
  return {
    slots: buildMockSlots(date),
    roomName: MOCK_ROOM.name,
    roomType: null,
    min_capacity: MOCK_ROOM.min_capacity,
    branchName: MOCK_BRANCH.name,
    closed: false,
  };
}

export async function mockPublicApis(page: Page) {
  await page.route("**/api/branches", async (route) => {
    await route.fulfill({ json: [MOCK_BRANCH] });
  });

  await page.route("**/api/settings", async (route) => {
    await route.fulfill({
      json: { rental_notes: [], deposit_info: null, closed_dates: [] },
    });
  });

  await page.route("**/api/rooms?**", async (route) => {
    await route.fulfill({ json: [MOCK_ROOM] });
  });

  await page.route("**/api/availability?**", async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get("date") ?? e2eFutureDate();
    const roomId = url.searchParams.get("roomId");
    const body = roomId
      ? roomAvailabilityResponse(date)
      : branchAvailabilityResponse(date);
    await route.fulfill({ json: body });
  });

  await page.route("**/api/analytics", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

export async function mockReservationCreate(page: Page) {
  await page.route(/\/api\/reservations$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          id: MOCK_RESERVATION_ID,
          booking_code: MOCK_BOOKING_CODE,
        }),
      });
      return;
    }
    await route.continue();
  });
}

export async function mockGuestBookingApis(page: Page) {
  await page.route("**/api/my-bookings?**", async (route) => {
    await route.fulfill({
      json: [
        {
          id: MOCK_RESERVATION_ID,
          booking_code: MOCK_BOOKING_CODE,
          room_id: MOCK_ROOM.id,
          branch_id: MOCK_BRANCH.id,
          room_name: MOCK_ROOM.name,
          branch_name: MOCK_BRANCH.name,
          start_time: "2026-08-20T10:00:00+08:00",
          end_time: "2026-08-20T12:00:00+08:00",
          status: "pending",
          total_price: 400,
          guest_count: 4,
          customer_name: "測試客人",
          deposit_required: true,
          deposit_amount: 200,
          is_deposit_paid: false,
        },
      ],
    });
  });

  await page.route("**/api/cancel-booking", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });

  await page.route("**/api/reschedule-booking", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

export async function mockWaitlistApi(page: Page) {
  await page.route(/\/api\/waitlist/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}
