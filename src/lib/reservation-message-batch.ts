import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toTaipei } from "@/lib/datetime";
import { normalizePhone } from "@/lib/phone-utils";

export const MAX_BATCH_MESSAGE_RESERVATIONS = 50;

export type BatchReservationMessageItem = {
  reservation_id: string;
  customer_name: string;
  date_label: string;
  start_time: string;
  end_time: string;
  booking_code: string | null;
  deposit_amount: number | null;
  text: string;
  error?: string;
};

export type BatchReservationMessageValidation = {
  can_batch_copy: boolean;
  warnings: string[];
};

export type BatchReservationMessageContact = {
  customer_name: string | null | undefined;
  phone: string | null | undefined;
  email: string | null | undefined;
  branch_id: string | null | undefined;
  status?: string | null | undefined;
};

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("zh-TW").replace(/\s+/g, "");
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-US");
}

export function batchContactKey(contact: BatchReservationMessageContact): string | null {
  const name = normalizeName(contact.customer_name);
  const phone = normalizePhone(contact.phone ?? "");
  const email = normalizeEmail(contact.email);
  if (!name) return null;
  if (phone) return `name:${name}|phone:${phone}|email:${email || "∅"}`;
  if (email) return `name:${name}|email:${email}`;
  return null;
}

export function validateBatchReservationContacts(
  contacts: BatchReservationMessageContact[]
): BatchReservationMessageValidation {
  const warnings: string[] = [];
  if (contacts.some((contact) => contact.status === "cancelled")) {
    warnings.push("已取消的訂位不可加入批次複製，請改用逐筆複製或重新選取。");
  }
  const branches = new Set(contacts.map((contact) => contact.branch_id).filter(Boolean));
  if (branches.size > 1) {
    warnings.push("批次複製只能選取同一分店的訂位。");
  }

  const contactKeys = contacts.map(batchContactKey);
  if (contactKeys.some((key) => key === null)) {
    warnings.push("有訂位缺少可判定的姓名與電話／Email，為避免誤合併，請改用逐筆複製。");
  }
  const knownKeys = new Set(contactKeys.filter((key): key is string => Boolean(key)));
  if (knownKeys.size > 1) {
    warnings.push("選取的訂位不是同一位客人／聯絡資料，無法複製全部。");
  }

  return { can_batch_copy: warnings.length === 0, warnings };
}

export function formatBatchReservationDate(startTime: string): string {
  return format(toTaipei(startTime), "yyyy/MM/dd (EEE)", { locale: zhTW });
}

export function buildBatchReservationMessage(items: BatchReservationMessageItem[]): string {
  return items
    .map((item, index) => {
      const code = item.booking_code ? `｜訂位碼：${item.booking_code}` : "";
      return [
        `===== 第 ${index + 1} 筆訂位｜${item.date_label}${code} =====`,
        item.error ? `【此筆訊息無法產生：${item.error}】` : item.text,
        "===== 本筆訂位訊息結束 =====",
      ].join("\n");
    })
    .join("\n\n");
}
