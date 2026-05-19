#!/usr/bin/env bash
# run_migrations.sh
#
# Runs all forward RLS migration files against the Supabase database in order.
#
# Usage:
#   DB_PASSWORD=xxx bash run_migrations.sh
#
# Optional overrides:
#   MIGRATIONS_DIR=path/to/dir   (default: rls_migrations/ relative to this script)
#   DRY_RUN=1                    (print files that would run without executing)

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$SCRIPT_DIR/rls_migrations}"
DB_HOST="aws-1-eu-north-1.pooler.supabase.com"
DB_PORT="5432"
DB_NAME="postgres"
DB_USER="postgres.ktvpzpnqbwhooiaqrigm"
DRY_RUN="${DRY_RUN:-0}"

# ── Preflight checks ───────────────────────────────────────────────────────────
if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "ERROR: DB_PASSWORD is not set."
  echo "  Find it in Supabase dashboard → Settings → Database → Connection string"
  echo "  Then run: DB_PASSWORD=xxx bash run_migrations.sh"
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql is not installed or not in PATH."
  echo "  Install options:"
  echo "    macOS:  brew install libpq && brew link --force libpq"
  echo "    Ubuntu: sudo apt-get install postgresql-client"
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "ERROR: Migrations directory not found: $MIGRATIONS_DIR"
  exit 1
fi

# ── Collect forward migration files (sorted, no _down, no .md) ────────────────
mapfile -t FILES < <(
  find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' \
    ! -name '*_down.sql' \
    | sort
)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "ERROR: No forward migration files found in $MIGRATIONS_DIR"
  exit 1
fi

# ── Connection string (password passed via env, not inline) ───────────────────
export PGPASSWORD="$DB_PASSWORD"
CONN="postgresql://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# ── Summary header ─────────────────────────────────────────────────────────────
echo ""
echo "Supabase RLS Migration Runner"
echo "  Host:       $DB_HOST"
echo "  Database:   $DB_NAME"
echo "  Migrations: $MIGRATIONS_DIR"
echo "  Files:      ${#FILES[@]}"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "  Mode:       DRY RUN (no SQL will execute)"
fi
echo ""
echo "Files to run (in order):"
for f in "${FILES[@]}"; do
  echo "  $(basename "$f")"
done
echo ""

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1 set — exiting without executing."
  exit 0
fi

# ── Run migrations ─────────────────────────────────────────────────────────────
PASS=0
FAIL=0

for FILE in "${FILES[@]}"; do
  NAME="$(basename "$FILE")"
  printf "Running %-45s ... " "$NAME"

  if psql "$CONN" \
       --no-psqlrc \
       --single-transaction \
       --set ON_ERROR_STOP=1 \
       --file "$FILE" \
       >/tmp/psql_out_$$.txt 2>&1; then
    echo "✓ complete"
    PASS=$((PASS + 1))
  else
    echo "✗ FAILED"
    FAIL=$((FAIL + 1))
    echo ""
    echo "─── Error output for $NAME ───────────────────────────────────"
    cat /tmp/psql_out_$$.txt
    echo "──────────────────────────────────────────────────────────────"
    echo ""
    echo "Migration run ABORTED at $NAME."
    echo "  $PASS file(s) succeeded before this failure."
    echo "  Fix the error above, then re-run. Already-applied migrations"
    echo "  use CREATE OR REPLACE / IF NOT EXISTS and are safe to re-run."
    rm -f /tmp/psql_out_$$.txt
    exit 1
  fi
done

rm -f /tmp/psql_out_$$.txt

# ── Final summary ──────────────────────────────────────────────────────────────
echo ""
echo "All $PASS migration(s) applied successfully."
