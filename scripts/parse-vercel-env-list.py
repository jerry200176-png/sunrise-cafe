#!/usr/bin/env python3
"""Accept the known CLI table format and print names only; reject ambiguity."""
import re
import sys

lines = [re.sub(r"\x1b\[[0-9;]*m", "", line).strip() for line in sys.stdin]
lines = [line for line in lines if line]
if len(lines) < 2 or not re.fullmatch(r"name\s+value\s+type\s+environments\s+created", lines[0], re.I):
    sys.exit(1)
names = []
for line in lines[1:]:
    parts = line.split()
    if len(parts) < 5 or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", parts[0]):
        sys.exit(1)
    names.append(parts[0])
for name in names:
    print(name)
