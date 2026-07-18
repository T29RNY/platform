#!/bin/bash
# check-drift.sh — migration/source drift check (Hard Rule 11).
#
# READ-ONLY. This script never applies, edits, or rolls back a migration —
# it only lists local source and prints a ready-to-execute MCP action block
# for the calling agent to run via the Supabase MCP list_migrations tool,
# then diff the result against the local list printed below. Mirrors the
# check-ev-leak.sh pattern (bash can't reach the live DB directly; the
# calling agent has the MCP tool, so the script hands it the exact query
# and the exact comparison to make).
#
# Purpose: assert every migration applied to the LIVE Supabase DB has a
# matching source file in rls_migrations/ on main, and vice versa. Catches
# the "DB fix is live, PR never merged" drift Hard Rule 11 forbids, and the
# cloud-session-collision class of bug (duplicate migration numbers landing
# on main while the live DB only ever saw one of them applied).
#
# Usage: bash skills/scripts/check-drift.sh
# Then: run the printed ACTION via the Supabase MCP list_migrations tool
# (mcp__supabase__list_migrations or the project-specific variant) and
# diff its `version`/`name` output against the LOCAL MIGRATIONS list below.
#
# Exit codes:
#   0 — local listing generated OK, action block printed (comparison still
#       owed by the calling agent — bash has no live-DB access)
#   1 — rls_migrations/ directory missing or unreadable

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATIONS_DIR="$ROOT/rls_migrations"

echo "--- MIGRATION/SOURCE DRIFT CHECK (read-only) ---"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "RESULT: FAIL — $MIGRATIONS_DIR not found"
  exit 1
fi

# Local migration numbers: NNN_description.sql, excluding _down.sql pairs
# and non-migration files (e.g. PHASE_B_COMPLETE.md).
LOCAL_LIST=$(ls "$MIGRATIONS_DIR" 2>/dev/null \
  | grep -E '^[0-9]+_.*\.sql$' \
  | grep -v '_down\.sql$' \
  | sort -t_ -k1,1n)

LOCAL_COUNT=$(echo "$LOCAL_LIST" | grep -c . )

echo ""
echo "Local up-migrations found in rls_migrations/: $LOCAL_COUNT"
echo "$LOCAL_LIST" | sed 's/^/  /'

echo ""
echo "LOCAL MIGRATIONS (for diffing against live):"
echo "$LOCAL_LIST" | grep -oE '^[0-9]+' | sort -n | uniq

cat <<'ACTION'

ACTION: list_migrations
description: List every migration Supabase has recorded as APPLIED to the
  live project (via mcp__supabase__list_migrations or the project-specific
  equivalent, e.g. mcp__supabase_lettrack__list_migrations — confirm which
  project this repo's live DB is before running).

Then compare the tool's result against the LOCAL MIGRATIONS list above.

  ┌─────────────────────────────────────────────────────────────────────┐
  │ RULE 0 — COMPARE CONTENT, NOT LABELS. MANDATORY. Read before 1–3.    │
  └─────────────────────────────────────────────────────────────────────┘
  A live migration's recorded `name` (its LABEL, chosen at apply time) is
  NOT required to match the local FILENAME. Migrations applied via the
  Supabase MCP (apply_migration) routinely get a label that differs from
  the .sql filename that holds the same SQL — same body, different name.
  A LABEL/FILENAME mismatch is therefore NOT, by itself, drift.

  Before flagging ANY item under case 1 or 2, you MUST verify by CONTENT:
    • Extract the object(s) the item defines — the actual function/table
      name inside the SQL (e.g. `hq_get_analytics_for_company`), NOT the
      migration label (e.g. `190_hq_get_analytics_for_company_system`).
    • grep rls_migrations/ for that OBJECT name, and check the live DB with
      pg_get_functiondef / information_schema. If the same object body
      exists on BOTH sides, it is CLEAN — a benign label/filename mismatch,
      not drift. Record it, do not report it as drift.
    • Only when the object body is genuinely absent on one side is it drift.

  ANTI-SHORTCUT: re-diff the FULL applied-vs-local list EVERY run. Never
  assume a prior reconciliation migration (e.g. 474) "covered everything
  before it" and skip the historical range — that shortcut is exactly how
  a real pre-474 gap would be missed. Trust the content check, not a date.

  KNOWN-BENIGN LABEL↔FILE MAP (verified content-identical; do NOT re-flag):
    • live label `190_hq_get_analytics_for_company_system`
        == local `190_phase9_hq_weekly_digest_rpc.sql`
        (both define public.hq_get_analytics_for_company; verified
         2026-07-04 — body markers venue_comparison/top_scorers/
         collection_rate/open_incidents/RETURN COALESCE(v_result) all match)

  1. DRIFT — applied live, no local source:
     A live migration whose defined OBJECT(S) (per RULE 0) exist nowhere in
     rls_migrations/ on main. This is the Hard Rule 11 violation: the live
     DB ran ahead of committed source. STOP and surface it — do not silently
     write a matching file after the fact; find out why the commit never
     landed. (Confirm it is not merely a label/filename mismatch first.)

  2. DRIFT — local source, never applied live:
     A file in rls_migrations/ whose defined OBJECT(S) exist nowhere live.
     Could be a migration authored but never run (dead source), or a
     migration applied to a DIFFERENT Supabase project than the one just
     queried (e.g. lettrack vs platform) — confirm which project before
     flagging as a genuine gap.

  3. CLEAN:
     Every applied live migration's object body has a matching definition in
     rls_migrations/, and every source file's object body corresponds to a
     live definition — LABEL/FILENAME mismatches that pass the RULE 0
     content check included. Report CLEAN with the count matched.

Report the verdict (DRIFT + list of mismatches, or CLEAN) in plain English.
This script does not judge the diff itself — it has no live-DB access —
the calling agent makes the comparison and states the verdict, per RULE 0.
ACTION

echo ""
echo "RESULT: local listing generated — awaiting live-DB comparison via MCP (see ACTION block above)"
exit 0
