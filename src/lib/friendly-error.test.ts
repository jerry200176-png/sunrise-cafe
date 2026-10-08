import { describe, expect, it } from "vitest";
import { friendlyMessage, responseError } from "./friendly-error";
import { reservationStatusLabel, preorderStatusLabel } from "./status-labels";

describe("friendlyMessage", () => {
  it("maps statuses and English errors to Chinese", () => {
    expect(friendlyMessage("Unauthorized", 401)).toContain("登入");
    expect(friendlyMessage("Forbidden branch")).toContain("分店");
    expect(friendlyMessage("duplicate key value violates unique constraint")).toContain("相同");
    expect(friendlyMessage("後端未設定 SUPABASE_SERVICE_ROLE_KEY")).toContain("工程");
    expect(friendlyMessage("weird", 502)).toContain("系統");
    expect(friendlyMessage("桌號重複")).toBe("桌號重複");
  });
  it("never throws on non-JSON bodies", async () => {
    expect(await responseError(new Response("<html>", { status: 502 }))).toContain("系統");
  });
});

describe("labels", () => {
  it("covers every status without leaking raw values", () => {
    expect(reservationStatusLabel("rejected")).toBe("已拒絕");
    expect(reservationStatusLabel("weird")).toBe("其他");
    expect(preorderStatusLabel("DRAFT")).toBe("客人尚未送出");
  });
});
