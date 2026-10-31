import { auditLineAccounts } from "../src/lib/line-account-audit";

// Supply credentials through the authorized runtime. Does not load env files or send messages.
auditLineAccounts().then((audit) => {
  console.log(JSON.stringify({ source: "line_official_api", ...audit }, null, 2));
}).catch(() => {
  console.error("LINE account audit unavailable; no messages sent.");
  process.exitCode = 1;
});
