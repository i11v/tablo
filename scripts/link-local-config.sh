#!/bin/sh
# Link gitignored local config from the main checkout into a linked worktree.
# `apps/ios/Local.xcconfig` holds the Honeycomb ingest key; without it a
# worktree's iOS build is silently key-less and sends no telemetry. Runs from
# lefthook's post-checkout (so on `git worktree add`), or by hand in an
# existing worktree. A no-op in the main checkout and where the file exists.
set -e
top=$(git rev-parse --show-toplevel)
main=$(cd "$top" && cd "$(git rev-parse --git-common-dir)/.." && pwd -P)
[ "$(cd "$top" && pwd -P)" = "$main" ] && exit 0
for file in apps/ios/Local.xcconfig; do
  if [ -e "$main/$file" ] && [ ! -e "$top/$file" ] && [ ! -L "$top/$file" ]; then
    ln -s "$main/$file" "$top/$file"
    echo "linked $file from $main"
  fi
done
