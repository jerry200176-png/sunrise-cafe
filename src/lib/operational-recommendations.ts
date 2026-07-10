/**
 * Operational recommendations — insight → suggested business action.
 */
export type OpsRecommendation = {
  code: string;
  title: string;
  detail: string;
  suggested_action_type: "campaign" | "promotion" | "engagement" | "ops_recommendation";
  branch_id?: string;
  priority: "high" | "medium" | "low";
};

export function buildOperationalRecommendations(params: {
  occupancy_rate_7d: number | null;
  pending_deposit: number;
  inactive_customers: number;
  cancellation_spike: boolean;
  branch_id?: string;
}): OpsRecommendation[] {
  const recs: OpsRecommendation[] = [];
  const branch = params.branch_id ? { branch_id: params.branch_id } : {};

  if (params.occupancy_rate_7d != null && params.occupancy_rate_7d < 0.2) {
    recs.push({
      code: "off_peak_promo",
      title: "離峰促銷",
      detail: `近 7 日利用率 ${(params.occupancy_rate_7d * 100).toFixed(0)}%，建議週一至週四折扣方案`,
      suggested_action_type: "promotion",
      priority: "high",
      ...branch,
    });
  }

  if (params.pending_deposit > 3) {
    recs.push({
      code: "deposit_followup",
      title: "訂金追蹤",
      detail: `${params.pending_deposit} 筆待付訂金，建議 LINE 提醒或電話確認`,
      suggested_action_type: "ops_recommendation",
      priority: "medium",
      ...branch,
    });
  }

  if (params.inactive_customers > 10) {
    recs.push({
      code: "win_back_campaign",
      title: "沉睡客召回",
      detail: `${params.inactive_customers} 位 90 天未回訪，可建立回訪優惠（需人工審核）`,
      suggested_action_type: "campaign",
      priority: "medium",
      ...branch,
    });
  }

  if (params.cancellation_spike) {
    recs.push({
      code: "cancellation_review",
      title: "取消率檢視",
      detail: "今日取消異常偏高，檢視原因碼與時段熱點",
      suggested_action_type: "ops_recommendation",
      priority: "high",
      ...branch,
    });
  }

  return recs;
}
