"use client";

import { useParams } from "next/navigation";
import { RefundPanel } from "@/components/admin/RefundPanel";
import { AdminShell } from "@/components/admin/AdminShell";

/** 單一訂位的退款面板（老闆／店長）：訂金狀態、每筆退款的每一步紀錄、處理按鈕、申請退訂金。 */
export default function ReservationRefundsPage() {
  const params = useParams<{ reservationId: string }>();
  return <AdminShell title="這組的退款" backHref="/admin/refunds">
    <RefundPanel reservationId={params.reservationId} />
  </AdminShell>;
}
