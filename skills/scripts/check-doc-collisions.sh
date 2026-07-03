#!/bin/bash
# skills/scripts/check-doc-collisions.sh — flag open PRs that both touch a
# shared doc file (BUGS.md / RPCS.md / CONTEXT.md / DECISIONS.md).
#
# Two open PRs editing the same shared doc collide on merge: whichever lands
# first wins, the second needs manual conflict resolution. Session 70 hit
# both halves of this at once — duplicate migration 207 AND duplicate BUGS.md/
# RPCS.md appends. check-next-migration.sh guards the migration-number half;
# this script guards the doc half, so babysit-prs can call it mechanically
# instead of relying on a human noticing the overlap.
#
# Usage: bash skills/scripts/check-doc-collisions.sh
# Exit: 0 = no open PR pair collides; 1 = one or more collision pairs found.

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 2; }
cd "$ROOT" || exit 2

command -v gh >/dev/null 2>&1 || { echo "gh CLI unavailable — cannot check doc collisions"; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "jq unavailable — cannot check doc collisions"; exit 0; }

JSON=$(gh pr list --state open --json number,title,files 2>/dev/null)
if [ -z "$JSON" ] || [ "$JSON" = "[]" ]; then
  echo "No open PRs — no doc-collision risk."
  exit 0
fi

HITS_FILE=$(mktemp)
trap 'rm -f "$HITS_FILE"' EXIT

# One line per PR that touches ≥1 shared doc: "<number>\t<title>\t<comma-joined docs>"
echo "$JSON" | jq -r '
  ["BUGS.md","RPCS.md","CONTEXT.md","DECISIONS.md"] as $docs |
  .[] |
  ([.files[].path] | map(select(. as $f | $docs | index($f)))) as $hit |
  select($hit | length > 0) |
  "\(.number)\t\(.title)\t\($hit | join(","))"
' > "$HITS_FILE"

if [ ! -s "$HITS_FILE" ]; then
  echo "No open PR touches BUGS.md / RPCS.md / CONTEXT.md / DECISIONS.md — no doc-collision risk."
  exit 0
fi

echo "Open PRs touching shared docs:"
while IFS=$'\t' read -r NUM TITLE HIT; do
  echo "  #$NUM ($HIT) — $TITLE"
done < "$HITS_FILE"

FOUND=0
while IFS=$'\t' read -r NUM_I TITLE_I HIT_I; do
  while IFS=$'\t' read -r NUM_J TITLE_J HIT_J; do
    [ "$NUM_I" -lt "$NUM_J" ] || continue
    OVERLAP=$(comm -12 \
      <(printf '%s\n' "$HIT_I" | tr ',' '\n' | sort) \
      <(printf '%s\n' "$HIT_J" | tr ',' '\n' | sort))
    if [ -n "$OVERLAP" ]; then
      FOUND=1
      echo ""
      echo "COLLISION RISK: #$NUM_I and #$NUM_J both touch: $(printf '%s ' $OVERLAP)"
      echo "  -> sequence the merge: land one, then rebase/resolve the other before merging it."
    fi
  done < "$HITS_FILE"
done < "$HITS_FILE"

if [ "$FOUND" -eq 1 ]; then
  exit 1
else
  echo ""
  echo "No overlapping shared-doc PRs — no collision risk."
  exit 0
fi
