/**
 * Operational exception detection for daily management alerts.
 */
import type { DataQualityIssue } from "@/lib/data-quality";

export type OpsException = {
  code: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  count?: number;
};

export function buildOpsExceptions(params: {
  cancellations_today: number;
  cancellation_baseline: number;
  occupancy_rate_7d: number | null;
  pending_deposit: number;
  payment_pending_review: number;
  slot_conflicts_detected?: number;
  data_quality_issues: DataQualityIssue[];
}): OpsException[] {
  const exceptions: OpsException[] = [];

  if (params.cancellation_baseline > 0) {
    const ratio = params.cancellations_today / params.cancellation_baseline;
    if (ratio >= 2.5) {
      exceptions.push({
        code: "unusual_cancellations",
        severity: "warning",
        title: "取消數異常偏高",
        detail: `今日 ${params.cancellations_today} 筆，約為近 30 日日均 ${params.cancellation_baseline.toFixed(1)} 筆的 ${ratio.toFixed(1)} 倍`,
        count: params.cancellations_today,
      });
    }
  }

  if (params.occupancy_rate_7d != null && params.occupancy_rate_7d < 0.15) {
    exceptions.push({
      code: "low_occupancy",
      severity: "info",
      title: "利用率偏低",
      detail: `近 7 日利用率 ${(params.occupancy_rate_7d * 100).toFixed(1)}%，可考慮離峰促銷`,
    });
  }

  if (params.pending_deposit > 0) {
    exceptions.push({
      code: "pending_deposits",
      severity: "warning",
      title: "待付訂金",
      detail: `${params.pending_deposit} 筆今日訂位尚未付訂金`,
      count: params.pending_deposit,
    });
  }

  if (params.payment_pending_review > 0) {
    exceptions.push({
      code: "payment_review_queue",
      severity: "warning",
      title: "付款待審核",
      detail: `${params.payment_pending_review} 筆 LINE 截圖待人工審核`,
      count: params.payment_pending_review,
    });
  }

  if ((params.slot_conflicts_detected ?? 0) > 0) {
    exceptions.push({
      code: "booking_conflicts",
      severity: "error",
      title: "訂位衝突風險",
      detail: `偵測到 ${params.slot_conflicts_detected} 組重疊時段（需立即處理）`,
      count: params.slot_conflicts_detected,
    });
  }

  for (const issue of params.data_quality_issues) {
    if (issue.severity === "error") {
      exceptions.push({
        code: `dq_${issue.code}`,
        severity: "error",
        title: "資料品質",
        detail: issue.message,
        count: issue.count,
      });
    }
  }

  return exceptions;
}

export function formatMorningSummaryText(params: {
  date: string;
  reservations_today: number;
  revenue_today: number;
  pending_deposit: number;
  waitlist_waiting: number;
  exceptions: OpsException[];
}): string {
  const lines = [
    `☀️ 昇昇咖啡 營運晨報 ${params.date}`,
    `今日預約：${params.reservations_today} 筆 · 預估營收 NT$ ${params.revenue_today.toLocaleString()}`,
    `待付訂金：${params.pending_deposit} 筆 · 等位清單：${params.waitlist_waiting} 人`,
  ];
  if (params.exceptions.length === 0) {
    lines.push("✅ 無異常警示");
  } else {
    lines.push(`⚠️ 異常 ${params.exceptions.length} 項：`);
    for (const ex of params.exceptions.slice(0, 5)) {
      lines.push(`· ${ex.title}：${ex.detail}`);
    }
  }
  return lines.join("\n");
}
