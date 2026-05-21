#!/bin/bash
# scripts/check-rpc-security.sh
# Generates the Supabase MCP action block for Claude Code to execute.
# Claude Code reads this output and calls Supabase MCP directly —
# it does not interpret SQL manually.
# Exit code: 0 always (execution and pass/fail is handled by Claude Code
# reading the MCP result against the expected criteria below)
#
# Usage: bash skills/scripts/check-rpc-security.sh rpc_name_1 [rpc_name_2 ...]

if [ $# -eq 0 ]; then
  echo "Usage: check-rpc-security.sh rpc_name_1 [rpc_name_2 ...]"
  exit 1
fi

echo "--- RPC SECURITY CHECK ---"
echo "Claude Code: execute each block below via Supabase MCP."
echo "Do not read the SQL — run it. Evaluate each result against"
echo "the PASS criteria. Report PASS or FAIL per RPC."
echo ""

for RPC_NAME in "$@"; do
  echo "========================================"
  echo "RPC: $RPC_NAME"
  echo "========================================"
  echo ""
  echo "SUPABASE MCP ACTION — run this query:"
  echo "----------------------------------------"
  cat << SQL
SELECT
  proname                                    AS name,
  prosecdef                                  AS security_definer,
  proconfig                                  AS config,
  pronargs                                   AS arg_count,
  proargnames                                AS arg_names,
  proacl::text                               AS grants,
  COUNT(*) OVER (PARTITION BY proname)       AS overload_count
FROM pg_proc
WHERE proname = '$RPC_NAME'
AND pronamespace = 'public'::regnamespace;
SQL
  echo "----------------------------------------"
  echo ""
  echo "PASS criteria for $RPC_NAME:"
  echo "  security_definer = true             → FAIL if false (insecure — all writes blocked)"
  echo "  config contains search_path=public  → FAIL if missing (search path injection risk)"
  echo "  overload_count = 1                  → FAIL if >1 (stale overload causes runtime error)"
  echo "  grants includes anon OR authenticated (not both unless explicitly intentional)"
  echo "  row exists                          → FAIL if 0 rows (RPC not yet applied)"
  echo ""
  echo "If security_definer = false or row missing: STOP. Do not proceed."
  echo "If search_path missing from config: add SET search_path TO 'public', 'pg_temp' to the function."
  echo "If overload_count > 1: run the overload resolution block below."
  echo ""
done

echo "========================================"
echo "OVERLOAD RESOLUTION (run if overload_count > 1)"
echo "========================================"
echo ""
echo "SUPABASE MCP ACTION — run this to find all overloads:"
echo "----------------------------------------"
cat << SQL
SELECT proname, proargnames, proargtypes::regtype[]
FROM pg_proc
WHERE proname = 'REPLACE_WITH_RPC_NAME'
AND pronamespace = 'public'::regnamespace;
SQL
echo "----------------------------------------"
echo "Then DROP the old signature explicitly before continuing:"
echo "DROP FUNCTION IF EXISTS fn_name(old_param_type1, old_param_type2);"
echo ""
echo "========================================"
echo "POSTGREST CACHE FLUSH (run if RPC exists in pg_proc but returns 404)"
echo "========================================"
echo ""
echo "SUPABASE MCP ACTION:"
echo "----------------------------------------"
cat << SQL
SELECT pg_notify('pgrst', 'reload schema');
SQL
echo "----------------------------------------"
echo "Wait 30 seconds after running, then retest."
exit 0
