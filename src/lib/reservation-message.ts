import { getDepositAmount } from "@/lib/booking-utils";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toTaipei } from "@/lib/datetime";
import {
  buildPaymentMessage,
  resolveStoreName,
  type BranchPaymentConfig,
} from "@/lib/payment-message";

export const RESERVATION_MESSAGE_TEMPLATES = [
  { key: "booking_confirmation", label: "訂位確認" },
  { key: "deposit_request", label: "訂金通知" },
  { key: "deposit_paid", label: "訂金已收到" },
  { key: "arrival_reminder", label: "到店提醒" },
] as const;

export type ReservationMessageTemplateKey =
  (typeof RESERVATION_MESSAGE_TEMPLATES)[number]["key"];

export type ReservationMessageChannel = "manual_line" | "official_line";
export type ReservationMessageAction = "copied" | "manual_sent" | "pushed" | "failed";

export type ReservationMessageReservation = {
  customer_name: string;
  start_time: string;
  end_time: string;
  total_price: number | null;
  guest_count?: number | null;
  booking_code?: string | null;
  created_at?: string | null;
  is_deposit_paid?: boolean | null;
  room_name?: string | null;
};

export function isReservationMessageTemplateKey(
  value: unknown
): value is ReservationMessageTemplateKey {
  return RESERVATION_MESSAGE_TEMPLATES.some((template) => template.key === value);
}

function reservationTime(reservation: ReservationMessageReservation): {
  date: string;
  time: string;
} {
  const start = toTaipei(reservation.start_time);
  const end = toTaipei(reservation.end_time);
  return {
    date: format(start, "yyyy/MM/dd (EEE)", { locale: zhTW }),
    time: `${format(start, "HH:mm")}–${format(end, "HH:mm")}`,
  };
}

function storeName(branch: BranchPaymentConfig): string {
  return resolveStoreName(branch);
}

function bookingCodeLine(bookingCode: string | null | undefined): string | null {
  return bookingCode?.trim() ? `訂位碼：${bookingCode.trim()}` : null;
}

function joinMessageLines(lines: Array<string | null>): string {
  return lines.filter((line): line is string => line !== null).join("\n");
}

/** Render the canonical customer-facing text for every reservation message template. */
export function renderReservationMessage(
  templateKey: ReservationMessageTemplateKey,
  reservation: ReservationMessageReservation,
  branch: BranchPaymentConfig
): string {
  const { date, time } = reservationTime(reservation);
  const name = storeName(branch);
  const code = bookingCodeLine(reservation.booking_code);
  const guestCount =
    reservation.guest_count != null ? `人數：${reservation.guest_count} 位` : null;

  if (templateKey === "deposit_request") {
    if (reservation.total_price == null || Number(reservation.total_price) <= 0) {
      throw new Error("此訂位尚未設定有效總金額");
    }
    return buildPaymentMessage({
      customerName: reservation.customer_name,
      startTime: reservation.start_time,
      endTime: reservation.end_time,
      total: Number(reservation.total_price),
      branch,
      bookingCode: reservation.booking_code,
      createdAt: reservation.created_at,
    });
  }

  if (templateKey === "booking_confirmation") {
    return joinMessageLines([
      `您好，這裡是${name}。`,
      "",
      "您的訂位已確認：",
      `日期：${date}`,
      `時段：${time}`,
      `姓名：${reservation.customer_name}`,
      guestCount,
      code,
      "",
      "如需異動，請提前聯繫店家，謝謝！",
    ]);
  }

  if (templateKey === "deposit_paid") {
    if (!reservation.is_deposit_paid) {
      throw new Error("此訂位尚未標記訂金已收到");
    }
    const amount =
      reservation.total_price != null && Number(reservation.total_price) > 0
        ? ` $${getDepositAmount(Number(reservation.total_price))}`
        : "";
    return joinMessageLines([
      `您好，這裡是${name}。`,
      "",
      `已收到您的訂位訂金${amount}，訂位資料如下：`,
      `日期：${date}`,
      `時段：${time}`,
      `姓名：${reservation.customer_name}`,
      guestCount,
      code,
      "",
      "期待您的光臨，謝謝！",
    ]);
  }

  return joinMessageLines([
    `您好，這裡是${name}。`,
    "",
    `提醒您即將於 ${date} ${time} 到店。`,
    `姓名：${reservation.customer_name}`,
    guestCount,
    code,
    "",
    "如需異動，請提前聯繫店家，謝謝！",
  ]);
}
