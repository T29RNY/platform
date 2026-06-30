#!/bin/bash
# check-next-migration.sh — report the next safe migration number.
# Usage:
#   bash check-next-migration.sh              → prints next number and exits 0
#   bash check-next-migration.sh <file>       → validates file's NNN prefix
#
# Exit codes:
#   0  — OK (info output or PASS or GAP WARNING)
#   2  — CONFLICT: the file's number is already taken

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

HIGHEST=$(ls "$ROOT/rls_migrations/"*.sql 2>/dev/null \
  | grep -v _down \
  | grep -oE 'rls_migrations/[0-9]+' \
  | grep -oE '[0-9]+$' \
  | sort -n \
  | tail -1)

if [ -z "$HIGHEST" ]; then
  HIGHEST=0
fi

NEXT=$(printf "%03d" $((10#$HIGHEST + 1)))
HIGHEST_PAD=$(printf "%03d" $((10#$HIGHEST)))

if [ $# -eq 0 ]; then
  echo "Next safe migration: $NEXT  (highest committed: $HIGHEST_PAD)"
  exit 0
fi

FILE="$1"
FILE_NUM=$(basename "$FILE" | grep -oE '^[0-9]+')
if [ -z "$FILE_NUM" ]; then
  echo "SKIP: $(basename "$FILE") has no numeric prefix — not a migration file"
  exit 0
fi

FILE_PAD=$(printf "%03d" $((10#$FILE_NUM)))
NEXT_INT=$((10#$NEXT))
FILE_INT=$((10#$FILE_NUM))

if [ "$FILE_INT" -eq "$NEXT_INT" ]; then
  echo "PASS: $FILE_PAD matches next safe migration ($NEXT)"
  exit 0
elif [ "$FILE_INT" -lt "$NEXT_INT" ]; then
  echo "CONFLICT: migration $FILE_PAD already exists (next safe: $NEXT)" >&2
  exit 2
else
  SKIP=$((FILE_INT - NEXT_INT))
  echo "GAP WARNING: migration $FILE_PAD skips $SKIP number(s) (next safe: $NEXT)"
  exit 0
fi
