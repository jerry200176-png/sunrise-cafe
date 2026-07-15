import type { BranchDepositConfig } from "@/types";

/**
 * 分店訂金設定
 * 控制各分店是否啟用訂金、Stripe 線上支付。
 */
/**
 * stripeEnabled must stay false unless Stripe is production-ready
 * (keys + webhook + E2E + rollback). Guest UI must not open a 503 modal.
 * See Commercial Maturity A — binary Stripe rule.
 */
export const BRANCH_DEPOSIT_CONFIG: Record<string, BranchDepositConfig> = {
  daan: {
    isDepositRequired: true,
    stripeEnabled: false,
    defaultDepositAmount: 500,
  },
};

/** 取得指定分店的訂金設定，無設定時回退安全預設 */
export function getBranchDepositConfig(branchId: string): BranchDepositConfig {
  return (
    BRANCH_DEPOSIT_CONFIG[branchId] ?? {
      isDepositRequired: false,
      stripeEnabled: false,
      defaultDepositAmount: 0,
    }
  );
}
