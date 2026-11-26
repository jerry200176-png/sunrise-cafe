/**
 * Pick the fields staff check on a bank-transfer screenshot out of raw OCR text.
 * Pure text rules, no guessing: anything not clearly found stays empty and staff read the image.
 * @see docs/PAYMENT_STATE_MODEL.md
 */

export type TransferReading = {
  /** The expected deposit amount appears in the text as a standalone number. */
  amountFound: boolean;
  /** First plausible transfer date, YYYY-MM-DD (Taipei calendar date as printed). */
  date: string | null;
  /** Last five digits of each account-like number on the image (payer, payee or a serial). */
  lastFives: string[];
};

const MAX_CANDIDATES = 3;

function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/(?<=\d),(?=\d{3}(?!\d))/g, ""); // 1,200 -> 1200
}

function findDate(text: string, today: string): string | null {
  for (const m of text.matchAll(/(?<!\d)(20\d{2}|1\d{2})\s?[/.\-年]\s?(\d{1,2})\s?[/.\-月]\s?(\d{1,2})(?!\d)/g)) {
    const year = m[1].length === 3 ? Number(m[1]) + 1911 : Number(m[1]); // 民國年
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (iso <= today) return iso; // a transfer cannot be dated in the future
  }
  return null;
}

function findLastFives(text: string): string[] {
  const found = new Set<string>();
  // Masked account (****12345; OCR turns some of the stars into letters, so one star directly
  // before the digits is enough) a long digit run with dashes
  // (012-345-678901), or card-style groups of four (0000 1234 5675 4321). Other spaces end the number,
  // so two numbers side by side are never glued into one.
  for (const m of text.matchAll(/[*＊][-. ]?(\d{5})(?!\d)|(?<![\d/.:])(?:\d{4}(?: \d{4}){2,3}|\d(?:-?\d){9,})(?![\d/.:])/g)) {
    if (m[1]) {
      found.add(m[1]);
      continue;
    }
    const digits = m[0].replace(/\D/g, "");
    if (digits.length > 16) continue; // longer than any bank account: a timestamp or serial
    if (digits.length === 10 && digits.startsWith("09")) continue; // mobile number
    if (/^20\d{12}$/.test(digits)) continue; // YYYYMMDDHHMMSS
    found.add(digits.slice(-5));
  }
  return [...found];
}

/**
 * @param today Taipei date YYYY-MM-DD (passed in so the rule is testable).
 * @returns null when nothing useful was read (not a transfer screenshot, or OCR failed).
 */
export function readTransferText(text: string, expectedAmount: number | null, today: string): TransferReading | null {
  const clean = normalize(text);
  const amountFound =
    expectedAmount != null && expectedAmount > 0 &&
    // Standalone number: not inside an account (digits, dashes), a time or a date; ".00" allowed.
    new RegExp(`(?<![\\d.:/])(?<!\\d-)${expectedAmount}(?:\\.0{1,2})?(?![\\d:/-]|\\.\\d)`).test(clean);
  const date = findDate(clean, today);
  const lastFives = findLastFives(clean);
  if (!amountFound && !date && lastFives.length === 0) return null;
  // Too many account-like numbers means we cannot tell which is the payer: show none.
  return { amountFound, date, lastFives: lastFives.length > MAX_CANDIDATES ? [] : lastFives };
}
