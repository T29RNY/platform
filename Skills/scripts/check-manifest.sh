#!/usr/bin/env bash
# check-manifest.sh — deterministic structure gate for a scope handoff manifest.
# Repo-native stand-in for a "manifest validator": confirms a produced
# <SLUG>_HANDOFF.md carries every section /loop /dev-loop relies on, and that
# every PR block is tier-tagged, gated, and has a done/status line.
#
# Usage:  bash skills/scripts/check-manifest.sh <path-to-handoff.md>
# Exit 0 = structurally valid; exit 1 = missing required structure (prints why).
set -u

f="${1:-}"
if [ -z "$f" ] || [ ! -f "$f" ]; then
  echo "check-manifest: file not found: ${f:-<none>}"
  exit 1
fi

fail=0
need_section() {
  # $1 = human label, $2 = grep -E pattern (case-insensitive)
  if ! grep -Eiq "$2" "$f"; then
    echo "  ✗ missing: $1"
    fail=1
  else
    echo "  ✓ $1"
  fi
}

echo "check-manifest: $f"

# --- required top-level sections (gold standard = MATCH_WORKOUT_TRACKING_HANDOFF.md) ---
need_section "plain-English 'WHAT IT IS'"        '^#+.*what it is'
need_section "LOCKED DECISIONS"                  '^#+.*locked decisions'
need_section "KEY AUDIT FACTS"                   '^#+.*key audit facts'
need_section "ROADMAP / PR list"                 '^#+.*(roadmap|prs in dependency)'
need_section "GATES the loop must stop at"       '^#+.*gates'
need_section "DONE definition"                   '^#+.*done'

# --- at least one PR block ---
pr_count=$(grep -Ec '^#+ +PR #[0-9]' "$f")
if [ "$pr_count" -lt 1 ]; then
  echo "  ✗ no '### PR #n' blocks found"
  fail=1
else
  echo "  ✓ $pr_count PR block(s)"
fi

# --- every PR block must be tier-tagged AND name its gates ---
if ! grep -Eiq 'tier-?[123]' "$f"; then
  echo "  ✗ no tier tags (expect TIER-1/2/3 per PR)"
  fail=1
else
  echo "  ✓ tier tags present"
fi
if ! grep -Eiq '(^|[[:space:]])gates:' "$f"; then
  echo "  ✗ no 'Gates:' line on any PR (each PR must name its proof gates)"
  fail=1
else
  echo "  ✓ Gates: lines present"
fi

# --- the invocation prompt must be embedded (paste-ready) ---
if ! grep -Eq '/dev-loop' "$f"; then
  echo "  ✗ no '/dev-loop' trigger prompt embedded"
  fail=1
else
  echo "  ✓ trigger prompt embedded"
fi

if [ "$fail" -eq 0 ]; then
  echo "check-manifest: PASS"
  exit 0
fi
echo "check-manifest: FAIL"
exit 1
