import { branchCustomerBots } from "./customer-line-bots";
import { extraGroupBots } from "./line-group-bots";
import { fetchLineQuotaAudit } from "./line-usage";

/** Provider GETs only. Never returns tokens, recipient IDs, or provider response bodies. */
export async function auditLineAccounts() {
  const accounts = [
    { role: "group", scope: "default", token: process.env.LINE_CHANNEL_ACCESS_TOKEN },
    { role: "customer", scope: "default", token: process.env.LINE_CUSTOMER_ACCESS_TOKEN },
    ...extraGroupBots().map((bot, i) => ({ role: "group", scope: `extra-${i + 1}`, token: bot.token })),
    ...branchCustomerBots().map((bot) => ({ role: "customer", scope: bot.branchId, token: bot.token })),
  ];
  return Promise.all(accounts.map(async ({ role, scope, token }) => {
    if (!token) return { role, scope, configured: false };
    let identity: { status: number | null; name?: string; basicId?: string } = { status: null };
    try {
      const response = await fetch("https://api.line.me/v2/bot/info", {
        method: "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      identity = { status: response.status };
      if (response.ok) {
        const data = await response.json();
        identity = { status: response.status, name: data.displayName, basicId: data.basicId };
      }
    } catch { /* Network failure is unknown, never evidence of a wrong account. */ }
    const audit = await fetchLineQuotaAudit(token);
    return {
      role, scope, configured: true, identity,
      quota: {
        status: audit.status, snapshot: audit.snapshot,
        endpoints: Object.fromEntries(Object.entries(audit.endpoints).map(([name, endpoint]) => [name, {
          available: endpoint.available,
          // Preserve provider status codes, never arbitrary exception text.
          httpStatus: /^HTTP (\d{3})$/.test(endpoint.error ?? "") ? Number(endpoint.error!.slice(5)) : null,
        }])),
      },
    };
  }));
}
