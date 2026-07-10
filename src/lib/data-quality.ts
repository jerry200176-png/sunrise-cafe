/**
 * Data quality checks and anomaly detection for business data sources.
 */

export type DataQualitySeverity = "info" | "warning" | "error";

export type DataQualityIssue = {
  code: string;
  severity: DataQualitySeverity;
  message: string;
  count: number;
  sample_ids?: string[];
};

export type ReservationRow = {
  id: string;
  room_id: string;
  phone: string;
  start_time: string;
  end_time: string;
  status: string;
  is_deposit_paid?: boolean;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  total_price?: number | null;
  created_at?: string;
};

export function isValidTaiwanPhone(phone: string): boolean {
  const p = phone.trim();
  return /^09\d{8}$/.test(p);
}

export function checkInvalidTimeRange(rows: ReservationRow[]): DataQualityIssue | null {
  const bad = rows.filter(
    (r) => new Date(r.end_time).getTime() <= new Date(r.start_time).getTime()
  );
  if (bad.length === 0) return null;
  return {
    code: "invalid_time_range",
    severity: "error",
    message: "結束時間早於或等於開始時間",
    count: bad.length,
    sample_ids: bad.slice(0, 5).map((r) => r.id),
  };
}

export function checkInvalidPhone(rows: ReservationRow[]): DataQualityIssue | null {
  const bad = rows.filter((r) => r.phone && !isValidTaiwanPhone(r.phone));
  if (bad.length === 0) return null;
  return {
    code: "invalid_phone_format",
    severity: "warning",
    message: "手機格式非台灣 09 開頭 10 碼",
    count: bad.length,
    sample_ids: bad.slice(0, 5).map((r) => r.id),
  };
}

export function checkCancelledWithoutMetadata(rows: ReservationRow[]): DataQualityIssue | null {
  const bad = rows.filter(
    (r) => r.status === "cancelled" && !r.cancelled_at && !r.cancelled_by
  );
  if (bad.length === 0) return null;
  return {
    code: "cancelled_missing_metadata",
    severity: "warning",
    message: "已取消但缺少 cancelled_at / cancelled_by（舊資料或繞過 cancelReservation）",
    count: bad.length,
    sample_ids: bad.slice(0, 5).map((r) => r.id),
  };
}

export function checkPaidFlagWithoutPrice(rows: ReservationRow[]): DataQualityIssue | null {
  const bad = rows.filter(
    (r) =>
      r.is_deposit_paid &&
      r.status !== "cancelled" &&
      (r.total_price == null || Number(r.total_price) <= 0)
  );
  if (bad.length === 0) return null;
  return {
    code: "deposit_paid_no_price",
    severity: "warning",
    message: "已標記訂金但 total_price 為空或 0",
    count: bad.length,
    sample_ids: bad.slice(0, 5).map((r) => r.id),
  };
}

export function checkOrphanRoomIds(
  rows: ReservationRow[],
  validRoomIds: Set<string>
): DataQualityIssue | null {
  const bad = rows.filter((r) => !validRoomIds.has(r.room_id));
  if (bad.length === 0) return null;
  return {
    code: "orphan_room_id",
    severity: "error",
    message: "room_id 不存在於 rooms 表",
    count: bad.length,
    sample_ids: bad.slice(0, 5).map((r) => r.id),
  };
}

export function detectCancellationAnomaly(
  cancellationsToday: number,
  baselineDailyAvg: number
): DataQualityIssue | null {
  if (baselineDailyAvg <= 0) return null;
  const ratio = cancellationsToday / baselineDailyAvg;
  if (ratio < 2.5) return null;
  return {
    code: "cancellation_spike",
    severity: "warning",
    message: `今日取消數為近 30 日日均的 ${ratio.toFixed(1)} 倍`,
    count: cancellationsToday,
  };
}

export function detectLowOccupancy(
  occupancyRate: number | null,
  threshold = 0.15
): DataQualityIssue | null {
  if (occupancyRate == null || occupancyRate >= threshold) return null;
  return {
    code: "low_occupancy",
    severity: "info",
    message: `近 7 日利用率 ${(occupancyRate * 100).toFixed(1)}% 低於 ${threshold * 100}%`,
    count: 1,
  };
}

export function runReservationChecks(
  rows: ReservationRow[],
  validRoomIds: Set<string>
): DataQualityIssue[] {
  return [
    checkInvalidTimeRange(rows),
    checkInvalidPhone(rows),
    checkCancelledWithoutMetadata(rows),
    checkPaidFlagWithoutPrice(rows),
    checkOrphanRoomIds(rows, validRoomIds),
  ].filter((x): x is DataQualityIssue => x != null);
}

export function summarizeIssues(issues: DataQualityIssue[]): {
  error_count: number;
  warning_count: number;
  info_count: number;
  healthy: boolean;
} {
  const error_count = issues.filter((i) => i.severity === "error").length;
  const warning_count = issues.filter((i) => i.severity === "warning").length;
  const info_count = issues.filter((i) => i.severity === "info").length;
  return {
    error_count,
    warning_count,
    info_count,
    healthy: error_count === 0,
  };
}
