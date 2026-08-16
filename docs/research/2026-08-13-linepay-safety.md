# Sunrise LINE Pay safety review

## Official documentation

- [Online API v4](https://developers-pay.line.me/online-api-v4) lists request, request-status check, confirm, and payment-detail endpoints.
- [Payment request status](https://developers-pay.line.me/online-api-v4/check-payment-request-status) says the status check is needed after an interrupted request and recommends at least one second between checks.
- [Payment confirmation](https://developers-pay.line.me/online-api-v4/confirm-payment) requires the amount and currency again when confirming.
- [Retrieve payment details](https://developers-pay.line.me/online-api-v4/retrieve-payment-details) supports lookup by order ID or transaction ID for reconciliation.
- [Redirection pages](https://developers-pay.line.me/online-api-v4/merchant/redirection-pages/) passes order ID and transaction ID to the merchant callback.

## Target repository evidence

- Before this change, `src/app/api/linepay/confirm/route.ts` confirmed directly from the redirect and updated the reservation in separate writes.
- Before this change, a group notification failure was only logged; there was no durable retry record.
- `supabase/migration-line-pay-payments.sql` had only `pending`, `paid`, `cancelled`, `expired`, and `failed` states.
- Production was previously observed with the LINE Pay callback routes absent. No production payment data was used in this change.

## Local verification

- Added a `confirming` claim, exact order/transaction/amount checks, status polling, and payment-detail reconciliation.
- Added an atomic SQL finalizer that marks the reservation paid and creates one idempotent notification outbox event.
- Added outbox attempt history with `pending`, `retrying`, `sent`, and `failed` states.
- Added route and unit tests for duplicate callbacks, provider/database failure, redirect reconciliation, cancellation, payment reuse, and notification failure.

## Inference and limits

- A provider success response is not treated as local success until the order, transaction, and amount match.
- A timeout stays `unknown`/`confirming`; it is not changed to failed only because the browser stopped waiting.
- This is a safety skeleton. Real payment activation still needs the migration probe and a LINE Pay sandbox transaction. No Channel Secret is stored in this document or logs.
- The Vercel project currently accepts daily cron precision only. The retry route is ready for an external or upgraded-plan scheduler when more frequent retries are needed.
