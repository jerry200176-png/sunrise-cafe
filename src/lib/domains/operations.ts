/** Domain facade — operations, BI, cron context */
export { buildMorningSummaryContext, todayTaipeiDateString } from "@/lib/morning-summary-context";
export { buildOpsExceptions, formatMorningSummaryText } from "@/lib/ops-exceptions";
export { runReservationChecks } from "@/lib/data-quality";
export { buildOperationalRecommendations } from "@/lib/operational-recommendations";
export { processInBatches, mapInBatches } from "@/lib/cron-batch";
