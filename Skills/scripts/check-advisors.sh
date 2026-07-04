#!/bin/bash
# check-advisors.sh — baseline-diffed Supabase advisor sweep (nightly routine D).
#
# READ-ONLY. Like check-drift.sh / check-ev-leak.sh, bash cannot reach the
# live DB — this script loads the accepted-known baseline and prints an ACTION
# block for the calling agent to run get_advisors via the Supabase MCP and diff
# the result against the baseline, surfacing ONLY findings that are new since
# the baseline was taken (plus every ERROR-level finding, always).
#
# Why: without a baseline, routine D re-dumps all ~1,300 advisor findings every
# night — 99% of which are this app's by-design RPC architecture (every RPC is
# a SECURITY DEFINER function callable by authenticated/anon; RPC-only tables
# have RLS-enabled-no-policy). That noise buries genuinely new findings. The
# baseline is the set accepted as of its generated date; the nightly reports
# the delta.
#
# Baseline file: Skills/state/advisors-baseline.json
#   { generated, note, counts_by_name, cache_keys: [ <stable per-finding id> ] }
# Each advisor lint carries a stable `cache_key`; the diff is a pure set diff
# on those keys. To intentionally accept a new steady-state finding, regenerate
# the baseline (see REGENERATE below).
#
# Usage: bash skills/scripts/check-advisors.sh
# Exit codes:
#   0 — baseline loaded + ACTION printed (live diff still owed by the agent)
#   1 — baseline file missing/unreadable

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASELINE="$ROOT/Skills/state/advisors-baseline.json"

echo "--- SUPABASE ADVISOR SWEEP (baseline-diffed, read-only) ---"

if [ ! -f "$BASELINE" ]; then
  echo "RESULT: FAIL — baseline not found at $BASELINE"
  echo "Generate it once from a known-good state (see REGENERATE in this script)."
  exit 1
fi

GEN=$(grep -o '"generated"[^,]*' "$BASELINE" | head -1)
KEYS=$(grep -o '"cache_key"' "$BASELINE" | wc -l | tr -d ' ')
# cache_keys is a flat array of strings; count via the array, fall back to note.
KEYCOUNT=$(node -e 'try{const b=require(process.argv[1]);console.log((b.cache_keys||[]).length)}catch(e){console.log("?")}' "$BASELINE" 2>/dev/null || echo "?")

echo ""
echo "Baseline: $BASELINE"
echo "  $GEN"
echo "  accepted-known findings (cache_keys): $KEYCOUNT"
echo ""
echo "Counts by lint in baseline:"
node -e 'try{const b=require(process.argv[1]);for(const [k,v] of Object.entries(b.counts_by_name||{}))console.log("  "+v+"\t"+k)}catch(e){console.log("  (could not parse counts)")}' "$BASELINE" 2>/dev/null

cat <<'ACTION'

ACTION: get_advisors (security) + get_advisors (performance)
description: Run BOTH advisor types via the Supabase MCP against THIS repo's
  live project (confirm which project first — platform vs lettrack), collect
  every lint's `cache_key`, then diff against Skills/state/advisors-baseline.json.

Report:
  1. NEW findings — cache_keys present live but NOT in the baseline. List each
     in full (level, name, detail, remediation URL). These are what changed
     since the baseline; they are the actionable signal.
  2. ERROR-level findings — ALWAYS list every level=ERROR finding in full, even
     if it is in the baseline (e.g. a security_definer_view). Errors never get
     silenced by the baseline.
  3. RESOLVED — cache_keys in the baseline but no longer live (nice-to-know;
     confirms a fix landed). Count is enough.
  4. If NO new findings and NO errors: report "advisors CLEAN vs baseline
     (<N> known findings unchanged)". Do not re-list the known noise.

Do NOT dump the full advisor set. The baseline exists precisely so the nightly
surfaces the delta, not the ~1,300-line by-design steady state.

REGENERATE (only when intentionally accepting a new steady state):
  Re-run both get_advisors, and rebuild Skills/state/advisors-baseline.json as
  { generated, note, counts_by_name, cache_keys: <sorted unique cache_keys> }.
  Commit the regenerated baseline with a message explaining what newly-accepted
  findings it now covers. Never regenerate to silence a finding you have not
  actually triaged.
ACTION

echo ""
echo "RESULT: baseline loaded — awaiting live get_advisors diff via MCP (see ACTION block above)"
exit 0
