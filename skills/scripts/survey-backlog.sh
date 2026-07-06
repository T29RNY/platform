#!/bin/bash
# Skills/scripts/survey-backlog.sh
# Deterministic backlog snapshot for the /backlog picker. Pulls the cheap, factual
# signal from the repo's OWN state first (epic manifests + their phase statuses, open
# bugs, the FEATURES tracker, open PRs) so the LLM ranking step in the skill only has
# to reconcile + recommend — not re-derive. Read-only. (L2: deterministic before LLM.)
#
# Usage: bash Skills/scripts/survey-backlog.sh

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 1; }
cd "$ROOT"

echo "===================================================================="
echo " BACKLOG SNAPSHOT — $(git branch --show-current) @ $(git rev-parse --short HEAD)"
echo "===================================================================="

echo ""
echo "### IN-FLIGHT EPICS (docs/epics/*.md) — phase status is the source of truth"
shopt -s nullglob
found=0
for m in docs/epics/*.md; do
  found=1
  echo ""
  echo "  ▸ $m"
  # epic line + every phase header with its status line beneath it
  grep -nE '^- (Epic|Merge mode|Approved):' "$m" | sed 's/^/      /'
  awk '
    /^### P[0-9]/      { hdr=$0; next }
    /^- status:/ && hdr { sub(/^- status:/,"status:"); printf "      %s  [%s]\n", hdr, $0; hdr=""; next }
  ' "$m"
done
[ "$found" = 0 ] && echo "  (none — no epics scoped yet)"

echo ""
echo "### OPEN BUGS / OWED (BUGS.md — flags & headings)"
grep -nE '⛔|owed|^#{2,4} |TODO' BUGS.md 2>/dev/null | head -18 | cut -c1-180 | sed 's/^/  /' || echo "  (BUGS.md not found)"

echo ""
echo "### FEATURES tracker (phase headings / NEXT markers)"
grep -nE 'NEXT|⏭|Phase [0-9]|^#{2,3} ' FEATURES.md 2>/dev/null | head -22 | cut -c1-180 | sed 's/^/  /' || echo "  (FEATURES.md not found)"

echo ""
echo "### OPEN PRs (in-flight work not yet merged)"
gh pr list --state open --limit 15 --json number,title,headRefName \
  -q '.[] | "  #\(.number) \(.title)  («\(.headRefName)»)"' 2>/dev/null || echo "  (gh unavailable)"

echo ""
echo "===================================================================="
echo " Next: the /backlog skill reconciles this against MEMORY recall + the"
echo " actual code (verify-first), tags ship-safety, ranks, and recommends."
echo "===================================================================="
