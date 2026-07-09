import { describe, expect, it } from "vitest";
import {
  extractLastFiveDigits,
  parseBankCsv,
  matchBankRowsToReservations,
} from "./payment-reconcile";

describe("extractLastFiveDigits", () => {
  it("從末五碼關鍵字擷取", () => {
    expect(extractLastFiveDigits("匯款末五碼12345")).toBe("12345");
  });

  it("從數字串取後五碼", () => {
    expect(extractLastFiveDigits("轉帳9876543210")).toBe("43210");
  });
});

describe("parseBankCsv", () => {
  it("解析含金額與備註的 CSV", () => {
    const rows = parseBankCsv(`日期,金額,備註
2026/07/09,1500,末五碼54321`);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1500);
    expect(rows[0].last_five).toBe("54321");
  });
});

describe("matchBankRowsToReservations", () => {
  const reservations = [
    {
      id: "r1",
      booking_code: "ABC123",
      customer_name: "王小明",
      deposit_amount: 1500,
      deposit_payment_note: "末五碼54321",
    },
  ];

  it("金額與末五碼皆符合時為 high", () => {
    const bank = [{ trans_date: "2026/07/09", amount: 1500, last_five: "54321", raw_remark: "" }];
    const { matches } = matchBankRowsToReservations(bank, reservations);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe("high");
  });

  it("僅金額符合時為 medium", () => {
    const bank = [{ trans_date: "2026/07/09", amount: 1500, last_five: null, raw_remark: "" }];
    const { matches } = matchBankRowsToReservations(bank, reservations);
    expect(matches[0].confidence).toBe("medium");
  });
});
