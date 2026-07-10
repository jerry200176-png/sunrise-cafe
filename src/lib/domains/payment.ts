/** Domain facade — payments & deposits */
export {
  isPaymentEventsTableReady,
} from "@/lib/payment-events-admin";

export { buildPaymentMessage } from "@/lib/payment-message";
export { buildPaymentFlex } from "@/lib/line";
export { logDepositStatusChange } from "@/lib/payment-log";
export {
  computeDepositDeadline,
  shouldAutoRelease,
  shouldSendDepositReminder,
} from "@/lib/deposit-deadline";
