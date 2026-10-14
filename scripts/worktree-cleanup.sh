#!/usr/bin/env bash
# Remove worktrees whose branch is merged into origin/main-dev (git or GitHub PR) and are clean.
# Dry run by default; pass --apply to remove. Never uses --force; branches are kept.
set -euo pipefail
APPLY=${1:-}
git fetch --quiet
main=$(git rev-parse --show-toplevel)
merged_prs=$(gh pr list --state merged --limit 500 --json headRefName -q '.[].headRefName' 2>/dev/null || true)
git worktree list --porcelain | awk '/^worktree /{p=$2} /^branch /{b=$2; sub("refs/heads/","",b); print p"\t"b}' |
while IFS=$'\t' read -r p b; do
  [ "$p" = "$main" ] && continue
  [ -d "$p" ] || continue
  [ -z "$(git -C "$p" status --porcelain)" ] || { echo "dirty, keep: $p"; continue; }
  if git merge-base --is-ancestor "$b" origin/main-dev || grep -qxF "$b" <<<"$merged_prs"; then
    if [ "$APPLY" = "--apply" ]; then git worktree remove "$p" && echo "removed: $p"; else echo "would remove: $p"; fi
  fi
done
git worktree prune
