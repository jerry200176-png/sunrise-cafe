#!/usr/bin/env python3
"""Print bounded, escaped output from a credential-free sandbox."""
from pathlib import Path
import sys


def escaped(line: str) -> str:
    value = line[:1000].encode("unicode_escape").decode("ascii")
    # GitHub Actions supports both ::command:: and legacy ##[command] forms.
    # Escape their ASCII delimiters even when they occur inside a log line.
    for char in ("#", "[", "]", ":", "%"):
        value = value.replace(char, "\\x%02x" % ord(char))
    return " | " + value


def main():
    lines = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace").splitlines()
    for line in lines[-30:]:
        print(escaped(line))


if __name__ == "__main__":
    main()
