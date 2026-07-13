#!/usr/bin/env bash
# Load key=value env file (no export of comments).
set -a
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  export "$line"
done < "$1"
set +a
