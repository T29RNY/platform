#!/bin/bash
# scripts/check-schema-column.sh
# Impact map for a column before any rename, move, or drop.
# Searches the full codebase for references and generates a Supabase MCP
# action to confirm the column's current state in information_schema.
#
# Run this BEFORE touching any ALTER TABLE statement. Every reference
# found is a file that will need updating in the execute step.
#
# Usage: bash skills/scripts/check-schema-column.sh table_name column_name
# Example: bash skills/scripts/check-schema-column.sh players is_vice_captain

if [ $# -ne 2 ]; then
  echo "Usage: check-schema-column.sh table_name column_name"
  echo "Example: check-schema-column.sh players is_vice_captain"
  exit 1
fi

TABLE="$1"
COLUMN="$2"
ROOT=$(git rev-parse --show-toplevel)

echo "--- SCHEMA COLUMN IMPACT MAP ---"
echo "Column: $TABLE.$COLUMN"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 1. Migrations — references in SQL files
# ─────────────────────────────────────────────────────────────────────────────
echo "[1] rls_migrations/ (SQL source of truth):"
RESULT=$(grep -rn "$COLUMN" "$ROOT/rls_migrations/" 2>/dev/null || true)
if [ -z "$RESULT" ]; then
  echo "    none"
else
  echo "$RESULT" | sed 's/^/    /'
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 2. supabase.js — wrapper functions
# ─────────────────────────────────────────────────────────────────────────────
echo "[2] packages/core/storage/supabase.js (JS wrappers):"
RESULT=$(grep -n "$COLUMN" "$ROOT/packages/core/storage/supabase.js" 2>/dev/null || true)
if [ -z "$RESULT" ]; then
  echo "    none"
else
  echo "$RESULT" | sed 's/^/    /'
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 3. App and component files
# ─────────────────────────────────────────────────────────────────────────────
echo "[3] apps/ and packages/ (components and hooks):"
RESULT=$(grep -rn "$COLUMN" "$ROOT/apps" "$ROOT/packages" 2>/dev/null \
  | grep -v "supabase\.js" \
  || true)
if [ -z "$RESULT" ]; then
  echo "    none"
else
  echo "$RESULT" | sed 's/^/    /'
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 4. Documentation
# ─────────────────────────────────────────────────────────────────────────────
echo "[4] Documentation (SCHEMA.md, RPCS.md, CONTEXT.md):"
RESULT=$(grep -n "$COLUMN" "$ROOT/SCHEMA.md" "$ROOT/RPCS.md" "$ROOT/CONTEXT.md" 2>/dev/null || true)
if [ -z "$RESULT" ]; then
  echo "    none"
else
  echo "$RESULT" | sed 's/^/    /'
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 5. MCP action — verify current DB state
# ─────────────────────────────────────────────────────────────────────────────
echo "========================================"
echo "SUPABASE MCP ACTION — run to confirm current DB state:"
echo "========================================"
echo ""
cat << SQL
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = '$TABLE'
  AND column_name  = '$COLUMN';
SQL
echo ""
echo "PASS: column exists → safe to proceed with rename/move (update all refs above)."
echo "PASS: 0 rows        → column already gone or wrong table name."
echo ""
echo "========================================"
echo "SUPABASE MCP ACTION — check if any deployed RPCs reference this column:"
echo "========================================"
echo ""
cat << SQL
SELECT
  proname   AS rpc_name,
  prosrc    AS body
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosrc ILIKE '%$COLUMN%'
ORDER BY proname;
SQL
echo ""
echo "Every RPC returned here references '$COLUMN' in its body."
echo "These MUST be updated before the column is renamed or dropped."
echo "Stale column references in SECURITY DEFINER functions fail silently"
echo "at runtime — they pass CREATE OR REPLACE but throw internal_error"
echo "when executed. (See BUGS.md B1, session 29.)"
echo ""

exit 0
