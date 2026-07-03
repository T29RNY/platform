#!/bin/bash
# scripts/check-db-schema.sh
# Generates Supabase MCP action blocks for Claude Code to execute.
# Claude Code runs each query via Supabase MCP and evaluates the
# result against the JS code — it does not interpret manually.
# Exit code: 0 always (pass/fail evaluated by Claude Code from MCP result)
#
# Usage: bash skills/scripts/check-db-schema.sh table_name [table_name_2 ...]

if [ $# -eq 0 ]; then
  echo "Usage: check-db-schema.sh table_name [table_name_2 ...]"
  exit 1
fi

echo "--- DB SCHEMA CHECK ---"
echo "Claude Code: execute each block below via Supabase MCP."
echo "Do not read the SQL — run it. Compare each result against"
echo "what the JS code reads or writes. Report PASS or FAIL per table."
echo ""

for TABLE in "$@"; do
  echo "========================================"
  echo "TABLE: $TABLE"
  echo "========================================"
  echo ""
  echo "SUPABASE MCP ACTION — run this query:"
  echo "----------------------------------------"
  cat << SQL
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = '$TABLE'
AND table_schema = 'public'
ORDER BY ordinal_position;
SQL
  echo "----------------------------------------"
  echo ""
  echo "PASS criteria for $TABLE:"
  echo "  Every column the change reads or writes must exist."
  echo "  Types must match JS expectations:"
  echo "    text / uuid      → string in JS"
  echo "    bool             → boolean in JS"
  echo "    numeric / int4   → number in JS"
  echo "    timestamptz      → ISO string in JS"
  echo "    jsonb            → object or array in JS"
  echo "  is_nullable = YES  → null checks must exist in JS"
  echo ""
  echo "FAIL if: any expected column is missing (renamed or dropped)."
  echo "FAIL if: type mismatch between DB and JS (e.g. int vs text)."
  echo "FAIL if: nullable column has no null guard in the JS code."
  echo ""
done

exit 0
