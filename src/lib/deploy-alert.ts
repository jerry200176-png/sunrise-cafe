/**
 * Production deploy drift alerting — LINE group when live SHA ≠ main.
 */
import { isLineConfigured, sendLineMessage } from "@/lib/line-notify";

export function formatDeployMismatchAlert(params: {
  mainSha: string;
  prodSha: string;
  mainShort: string;
  prodShort: string;
}): string {
  return (
    `🚨【Production 部署異常】\n` +
    `main：${params.mainShort}\n` +
    `prod：${params.prodShort}\n` +
    `請檢查 Vercel deploy 或執行 vercel deploy --prod\n` +
    `時間：${new Date().toISOString()}`
  );
}

/** Best-effort LINE alert; never throws. */
export async function notifyDeployMismatch(params: {
  mainSha: string;
  prodSha: string;
}): Promise<boolean> {
  if (!isLineConfigured()) return false;
  const message = formatDeployMismatchAlert({
    mainSha: params.mainSha,
    prodSha: params.prodSha,
    mainShort: params.mainSha.slice(0, 7),
    prodShort: params.prodSha.slice(0, 7),
  });
  try {
    await sendLineMessage(message);
    return true;
  } catch (err) {
    console.error("[deploy-alert] LINE notify failed:", err);
    return false;
  }
}
