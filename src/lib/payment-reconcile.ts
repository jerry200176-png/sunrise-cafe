/**
 * 銀行 CSV 對帳 MVP（#62）— 純函式
 */

export type BankCsvRow = {
  trans_date: string;
  amount: number;
  last_five: string | null;
  raw_remark: string;
};

export type ReconcileCandidate = {
  reservation_id: string;
  booking_code: string;
  customer_name: string;
  expected_amount: number;
  reported_last_five: string | null;
  bank_amount: number;
  bank_last_five: string | null;
  bank_date: string;
  confidence: "high" | "medium" | "low";
};

export type UnmatchedBankRow = BankCsvRow & { reason: string };

/** 從備註/內容抽出末五碼 */
export function extractLastFiveDigits(text: string): string | null {
  const m = text.match(/(?:末五碼|後五碼|五碼)[:：\s]*(\d{5})/);
  if (m) return m[1];
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 5) return digits.slice(-5);
  return null;
}

/**
 * 簡化富邦/通用 CSV：假設含 amount 欄與備註欄，以逗號分隔。
 * 第一列若含「金額」「備註」視為 header 跳過。
 */
export function parseBankCsv(text: string): BankCsvRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: BankCsvRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /金額|備註|amount|remark/i.test(line)) continue;
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 2) continue;
    const amount = Number(cols.find((c) => /^\d+(\.\d+)?$/.test(c)) ?? cols[1]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const remark = cols[cols.length - 1] ?? "";
    const dateCol = cols[0]?.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/)?.[0] ?? cols[0];
    rows.push({
      trans_date: dateCol,
      amount: Math.round(amount),
      last_five: extractLastFiveDigits(remark + cols.join(",")),
      raw_remark: remark || line,
    });
  }
  return rows;
}

export function matchBankRowsToReservations(
  bankRows: BankCsvRow[],
  reservations: {
    id: string;
    booking_code: string;
    customer_name: string;
    deposit_amount: number;
    deposit_payment_note: string | null;
  }[]
): { matches: ReconcileCandidate[]; unmatched: UnmatchedBankRow[] } {
  const matches: ReconcileCandidate[] = [];
  const unmatched: UnmatchedBankRow[] = [];
  const usedRes = new Set<string>();

  for (const row of bankRows) {
    let best: ReconcileCandidate | null = null;

    for (const r of reservations) {
      if (usedRes.has(r.id)) continue;
      const noteLast5 = r.deposit_payment_note
        ? extractLastFiveDigits(r.deposit_payment_note)
        : null;
      const amountMatch = row.amount === r.deposit_amount;
      const last5Match =
        row.last_five != null &&
        (row.last_five === noteLast5 ||
          r.deposit_payment_note?.includes(row.last_five));

      if (amountMatch && last5Match) {
        best = {
          reservation_id: r.id,
          booking_code: r.booking_code,
          customer_name: r.customer_name,
          expected_amount: r.deposit_amount,
          reported_last_five: noteLast5,
          bank_amount: row.amount,
          bank_last_five: row.last_five,
          bank_date: row.trans_date,
          confidence: "high",
        };
        break;
      }
      if (amountMatch && !best) {
        best = {
          reservation_id: r.id,
          booking_code: r.booking_code,
          customer_name: r.customer_name,
          expected_amount: r.deposit_amount,
          reported_last_five: noteLast5,
          bank_amount: row.amount,
          bank_last_five: row.last_five,
          bank_date: row.trans_date,
          confidence: "medium",
        };
      }
    }

    if (best) {
      matches.push(best);
      usedRes.add(best.reservation_id);
    } else {
      unmatched.push({ ...row, reason: "無法配對訂位" });
    }
  }

  return { matches, unmatched };
}
