import { describe, it, expect } from "vitest";
import { isPaymentMessage, extractBookingCode } from "./payment-keywords";

describe("isPaymentMessage", () => {
  it("命中付款關鍵字回傳 true", () => {
    expect(isPaymentMessage("已匯款，末五碼 12345")).toBe(true);
    expect(isPaymentMessage("我已經付款了")).toBe(true);
    expect(isPaymentMessage("LINE Pay 付過去了")).toBe(true);
  });

  it("關鍵字比對不分大小寫", () => {
    expect(isPaymentMessage("LINEPAY 完成")).toBe(true);
  });

  it("含問句用語視為詢問，不標記付款", () => {
    expect(isPaymentMessage("請問怎麼付款？")).toBe(false);
    expect(isPaymentMessage("付款方式有哪些")).toBe(false); // 含「方式」
    expect(isPaymentMessage("匯款要怎麼弄")).toBe(false); // 含「要怎」
    expect(isPaymentMessage("可以用 LINE Pay 嗎")).toBe(false); // 含「嗎」
  });

  it("無付款關鍵字回傳 false", () => {
    expect(isPaymentMessage("今天天氣真好")).toBe(false);
  });

  it("可用自訂關鍵字清單", () => {
    expect(isPaymentMessage("我用悠遊付了", ["悠遊付"])).toBe(true);
    expect(isPaymentMessage("我用悠遊付了", ["匯款"])).toBe(false);
  });
});

describe("extractBookingCode", () => {
  it("純 6 碼代號", () => {
    expect(extractBookingCode("ABC123")).toBe("ABC123");
  });

  it("小寫自動轉大寫", () => {
    expect(extractBookingCode("abc123")).toBe("ABC123");
  });

  it("從含 ?text= 的網址抽出代號", () => {
    expect(extractBookingCode("https://example.com/?text=ABC123")).toBe("ABC123");
  });

  it("非 6 碼或無代號回傳 null", () => {
    expect(extractBookingCode("hello")).toBeNull();
    expect(extractBookingCode("ABCD12345")).toBeNull();
    expect(extractBookingCode("")).toBeNull();
  });
});
