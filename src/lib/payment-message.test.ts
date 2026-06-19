import { describe, it, expect } from "vitest";
import { buildPaymentMessage, resolveStoreName } from "./payment-message";

const base = {
  customerName: "王小明",
  startTime: "2026-06-20T02:00:00Z", // 台灣 10:00
  endTime: "2026-06-20T04:00:00Z", // 台灣 12:00
  total: 1000,
};

describe("resolveStoreName", () => {
  it("優先採用 display_name", () => {
    expect(resolveStoreName({ display_name: "昇昇咖啡 (大安店)", name: "大安" })).toBe(
      "昇昇咖啡 (大安店)"
    );
  });

  it("無 display_name 時由分店名稱推導", () => {
    expect(resolveStoreName({ name: "信義" })).toBe("昇昇咖啡 (信義)");
  });

  it("皆無時用通用店名", () => {
    expect(resolveStoreName({})).toBe("昇昇咖啡");
  });
});

describe("buildPaymentMessage", () => {
  it("含分店匯款資訊與 LINE Pay 時組出完整話術", () => {
    const msg = buildPaymentMessage({
      ...base,
      branch: {
        display_name: "昇昇咖啡 (大安店)",
        payment_info: "【匯款資訊】\n銀行：台北富邦銀行 (012)",
        line_pay_url: "https://pay.example/abc",
      },
    });
    expect(msg).toContain("昇昇咖啡 (大安店)");
    expect(msg).toContain("台北富邦銀行");
    expect(msg).toContain("https://pay.example/abc");
    expect(msg).toContain("末五碼");
    expect(msg).toContain("10:00–12:00"); // 時區正確
    expect(msg).toContain("訂金 $500"); // 進位一半
  });

  it("無付款資訊時降級為通用指示，不外洩任何分店帳號", () => {
    const msg = buildPaymentMessage({ ...base, branch: { name: "信義" } });
    expect(msg).toContain("昇昇咖啡 (信義)");
    expect(msg).toContain("請依照官網或現場指示完成付款");
    expect(msg).not.toContain("末五碼");
    expect(msg).not.toContain("台北富邦銀行");
  });

  it("不含任何寫死的大安店帳號（除非由設定帶入）", () => {
    const msg = buildPaymentMessage({ ...base, branch: { name: "新分店" } });
    expect(msg).not.toContain("8212-00000-8489-6");
  });
});
