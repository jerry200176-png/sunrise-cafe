#!/usr/bin/env python3
"""Reduce private LINE Pay output to fixed, non-sensitive status lines."""
import re
import sys
from pathlib import Path

report_path, output_path, safe_path, mode = sys.argv[1:]
if mode not in {"inspect", "set-sandbox-url", "restore-fixed-link"}:
    sys.exit(1)
try:
    report = Path(report_path).read_text(encoding="utf-8")
    output = Path(output_path).read_text(encoding="utf-8")
except (OSError, UnicodeError):
    sys.exit(1)

# Never echo a rejected line: it could contain the credential itself.
assignment = re.compile(r"LINE_PAY_CHANNEL_(?:ID|SECRET)=([^\s]+)")
if any(value not in {"present", "absent"} for value in assignment.findall(report + "\n" + output)):
    sys.exit(1)

channel = re.compile(r"^(LINE_PAY_CHANNEL_(?:ID|SECRET))=(present|absent) len=(\d+)$")
removed = re.compile(r"^(REMOVED|ABSENT)_(LINE_PAY_(?:CHANNEL_ID|CHANNEL_SECRET|API_BASE_URL))_(production|preview)$")
fixed = {
    "INSPECT_ONLY: no Vercel env changed.",
    "ENV_MUTATION_APPLIED: canonical production activation remains required.",
    "NO_PAYMENT_TEST: do not run live LINE Pay charges.",
    "SANDBOX_URL_ALREADY_SET",
    "SET_LINE_PAY_API_BASE_URL=https://sandbox-api-pay.line.me",
    "DYNAMIC_LINEPAY_STILL_ENABLED",
    "FIXED_LINK_RESTORED",
}
safe = [f"LINE Pay environment check: {mode}"]
presence = set()
url_fields = set()
found_fixed = set()
for line in report.splitlines():
    match = channel.fullmatch(line)
    if match:
        name, status, length = match.groups()
        if (status == "absent") != (length == "0"):
            sys.exit(1)
        presence.add(name)
        safe.append(f"{name}={status}")
    elif line.startswith(("LINE_PAY_CHANNEL_ID=", "LINE_PAY_CHANNEL_SECRET=")):
        sys.exit(1)
    elif re.fullmatch(r"LINE_PAY_API_BASE_URL=(?:present|absent) len=\d+", line):
        safe.append("LINE_PAY_API_BASE_URL=" + line.split("=", 1)[1].split(" ", 1)[0])
    elif line.startswith(("LINE_PAY_API_BASE_URL=", "CURRENT_LINE_PAY_API_BASE_URL=")):
        name, value = line.split("=", 1)
        url_fields.add(name)
        classification = {
            "<unset>": "unset",
            "https://sandbox-api-pay.line.me": "sandbox",
            "https://api-pay.line.me": "live",
        }.get(value, "other-configured")
        safe.append(f"{name}={classification}")
    elif line in fixed:
        found_fixed.add(line)
        safe.append(line)
    elif removed.fullmatch(line):
        safe.append(line)

if presence != {"LINE_PAY_CHANNEL_ID", "LINE_PAY_CHANNEL_SECRET"}:
    sys.exit(1)
if url_fields != {"LINE_PAY_API_BASE_URL", "CURRENT_LINE_PAY_API_BASE_URL"}:
    sys.exit(1)
if mode == "inspect" and "INSPECT_ONLY: no Vercel env changed." not in found_fixed:
    sys.exit(1)
if mode != "inspect" and "ENV_MUTATION_APPLIED: canonical production activation remains required." not in found_fixed:
    sys.exit(1)
Path(safe_path).write_text("\n".join(safe) + "\n", encoding="utf-8")
