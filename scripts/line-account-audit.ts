import { auditLineAccounts } from "../src/lib/line-account-audit";

// Supply credentials through the authorized runtime. Does not load env files or send messages.
auditLineAccounts().then((accounts) => {
  console.log(JSON.stringify({ source: "line_official_api", accounts }, null, 2));
}).catch(() => {
  console.error("LINE account audit unavailable; no messages sent.");
  process.exitCode = 1;
});
