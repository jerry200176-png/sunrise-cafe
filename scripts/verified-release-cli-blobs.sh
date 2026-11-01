#!/usr/bin/env bash
# Copy only fixed, bounded, regular Git blobs; never follow checkout symlinks.
set -euo pipefail
destination="${1:?destination required}"
[[ -d "$destination" && ! -L "$destination" ]] || { echo '::error::invalid CLI manifest destination'; exit 1; }
for source in scripts/release-cli/package.json scripts/release-cli/package-lock.json; do
  entry="$(git ls-tree HEAD -- "$source")"
  [[ "$entry" =~ ^100644\ blob\ [a-f0-9]{40}[[:space:]] ]] || { echo '::error::CLI manifest is not a regular blob'; exit 1; }
  size="$(git cat-file -s "HEAD:$source")"
  [[ "$size" =~ ^[0-9]+$ && "$size" -le 2000000 ]] || { echo '::error::CLI manifest is too large'; exit 1; }
  target="$destination/${source##*/}"
  [[ ! -e "$target" && ! -L "$target" ]] || { echo '::error::CLI manifest destination already exists'; exit 1; }
  git cat-file blob "HEAD:$source" > "$target"
done
