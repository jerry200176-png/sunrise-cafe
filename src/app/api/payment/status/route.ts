import { NextResponse } from "next/server";
import { isStripeEnabled } from "@/lib/stripe";

/**
 * Public, no-PII status for guest UI gating.
 * Stripe is either fully enabled or fully hidden — never a half-open modal.
 */
export async function GET() {
  const stripe = isStripeEnabled();
  return NextResponse.json({
    stripe_enabled: stripe,
    deposit_capture: stripe ? "stripe" : "manual_review",
    note: stripe
      ? "Online card deposit available"
      : "Deposits via bank/LINE Pay + staff review — online card not active",
  });
}
