#!/bin/bash
# scripts/check-rpc-columns.sh
# Generates Supabase MCP action blocks to detect stale column references
# in deployed SECURITY DEFINER function bodies.
#
# PL/pgSQL validates column references at execution time, not definition
# time. A function can be CREATE OR REPLACE'd successfully even after a
# referenced column is renamed or dropped — it will only fail when that
# line actually executes, producing an opaque internal_error. This is the
# exact failure mode from BUGS.md B1 (session 29).
#
# Usage: bash skills/scripts/check-rpc-columns.sh rpc_name [rpc_name_2 ...]
# Example: bash skills/scripts/check-rpc-columns.sh player_get_teams set_player_status

if [ $# -eq 0 ]; then
  echo "Usage: check-rpc-columns.sh rpc_name [rpc_name_2 ...]"
  exit 1
fi

echo "--- RPC COLUMN STALENESS CHECK ---"
echo "Claude Code: execute each MCP block below via Supabase MCP."
echo "Step 1 retrieves the function body."
echo "Step 2 cross-references all columns in the tables it touches."
echo "Your job: compare the column names in the function body against"
echo "the column names returned by step 2. Any column in the body that"
echo "does NOT appear in information_schema is stale."
echo ""

for RPC_NAME in "$@"; do
  echo "========================================"
  echo "RPC: $RPC_NAME"
  echo "========================================"
  echo ""
  echo "STEP 1 — Get function body:"
  echo "----------------------------------------"
  cat << SQL
SELECT prosrc AS body
FROM pg_proc
WHERE proname = '$RPC_NAME'
AND pronamespace = 'public'::regnamespace
LIMIT 1;
SQL
  echo "----------------------------------------"
  echo "Read the body. Note every column name referenced (e.g. p.column_name,"
  echo "tp.column_name, table_alias.column_name). Then run step 2."
  echo ""
  echo "STEP 2 — List all columns in tables the function touches:"
  echo "----------------------------------------"
  cat << SQL
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
SQL
  echo "----------------------------------------"
  echo ""
  echo "PASS criteria for $RPC_NAME:"
  echo "  Every column referenced in the function body exists in the"
  echo "  information_schema result for its respective table."
  echo ""
  echo "FAIL if: a column appears in the body but not in information_schema."
  echo "  → The column was renamed, moved, or dropped after the RPC was written."
  echo "  → Fix: rewrite the RPC to reference the correct column."
  echo "  → Apply via Supabase MCP (apply_migration), then verify again."
  echo ""
done

exit 0
