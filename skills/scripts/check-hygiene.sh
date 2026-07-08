#!/bin/bash
# scripts/check-hygiene.sh
# Runs all deterministic code quality checks across the codebase.
# No judgment needed — these are fixed rules with binary pass/fail.
# Exit code: 0 = all pass, 1 = one or more failures
#
# Usage: bash skills/scripts/check-hygiene.sh [optional: path/to/specific/file]
# Pass a specific file to check only that file.
# Run with no args to check entire apps/ and packages/.
#
# INTENTIONAL EXEMPTIONS — do not widen scan paths without reading this:
#
# scripts/seed-demo.js — uses direct Supabase writes intentionally.
#   This is a standalone seeding script, not client code. It runs
#   with the service role key, not the anon key. Exempt by being
#   outside the scan paths (apps/inorout/src + packages/core).
#
# packages/core/storage/supabase.js — contains supabase.from() and
#   supabase.rpc() calls intentionally. It IS the database layer.
#   Exempt via explicit grep -v "supabase.js" in checks 5 and 6.
#
# packages/core/constants/colors.js — IS the shared colour palette. Its
#   whole job is to hold hex literals. Exempt via grep -v in check 2.
#
# apps/inorout/src/App.jsx /admin/local dev shortcut — one supabase.from
#   call in the local-dev admin-link branch. Pre-RLS read for picking the
#   sole team_id during development. Exempt via grep -v in check 5.
#   Tagged in code with the comment `hygiene-exempt: /admin/local dev`.
#
# apps/inorout/src/views/MyIOView.jsx — IO Intelligence badge renderer.
#   Pure SVG badge crests, gradient overlays, dynamic per-card colour.
#   Per CLAUDE.md: "CSS vars cannot be used in SVG fill/stroke — use
#   hex literals". This file is overwhelmingly SVG; hex usage is
#   structural, not stylistic. Exempt via grep -v in check 2.
#
# rls_migrations/ — SQL files, not JS. Not in scan paths.
#   Contains raw table references by design.
#
# apps/inorout/src/theme/tokens.css, mobile/theme/mobile-tokens.css,
#   views/Gaffer/gaffer-tokens.css — design-token source files. Their whole
#   job is to define the hex values every component references via var().
#   Same exemption class as constants/colors.js. Exempt via grep -v in check 2.
#
# apps/inorout/src/mockup/*.html — static design mockups used for ideation,
#   never imported or shipped in the built app. Exempt via grep -v in
#   checks 2 and 4.
#
# apps/inorout/src/views/Gaffer/_archived_chatbot.jsx — dead file kept for
#   reference only (never imported — confirmed via grep, session 2026-07-03
#   nightly QA). Exempt via grep -v in check 2.
#
# If you need to add a new intentional exemption, add it here
# AND add a grep -v filter in the relevant check below.
# Never silently widen the scan path — document it first.

# No set -e — this script manages its own failure counting.
# Each check uses explicit result capture, not exit code propagation.

ROOT=$(git rev-parse --show-toplevel)
TARGET="${1:-}"
FAILS=0

if [ -n "$TARGET" ]; then
  SCAN_PATH="$ROOT/$TARGET"
  SCOPE="$TARGET"
else
  SCAN_PATH="$ROOT/apps/inorout/src $ROOT/packages/core"
  SCOPE="apps/inorout/src + packages/core"
fi

echo "--- CODE HYGIENE CHECK ---"
echo "Scope: $SCOPE"
echo ""

# CHECK 1: console.log (banned — only console.error allowed)
echo "[1] console.log usage (banned):"
RESULT=$(grep -rHn "console\.log" $SCAN_PATH 2>/dev/null || true)
if [ -z "$RESULT" ]; then
  echo "    PASS — none found"
else
  echo "    FAIL — found:"
  echo "$RESULT" | sed 's/^/    /'
  FAILS=$((FAILS + 1))
fi
echo ""

# CHECK 2: hardcoded hex colours
# Matches hex values in JSX/JS attribute and value positions only.
# Excludes: #60A0FF (Team A), #FF6060 (Team B), Google brand SVG
# (#4285F4 #34A853 #FBBC05 #EA4335 — unavoidable on the "Continue
# with Google" button), comments (//).
# Targets: lines with = or : before the hex (assignment/value context)
# to reduce false positives from prose mentions in strings.
echo "[2] Hardcoded hex colours (only #60A0FF and #FF6060 allowed):"
RESULT=$(grep -rHn "[=:][[:space:]]*[\"']\?#[0-9A-Fa-f]\{3,6\}\b" \
  $SCAN_PATH 2>/dev/null \
  | grep -v "60A0FF" \
  | grep -v "FF6060" \
  | grep -v "4285F4" \
  | grep -v "34A853" \
  | grep -v "FBBC05" \
  | grep -v "EA4335" \
  | grep -v "constants/colors\.js" \
  | grep -v "views/MyIOView\.jsx" \
  | grep -v "theme/tokens\.css" \
  | grep -v "mobile-tokens\.css" \
  | grep -v "gaffer-tokens\.css" \
  | grep -v "src/mockup/" \
  | grep -v "_archived_chatbot\.jsx" \
  | grep -v "^\s*//" \
  | grep -v "//.*#[0-9A-Fa-f]" \
  || true)
if [ -z "$RESULT" ]; then
  echo "    PASS — no violations"
else
  echo "    FAIL — found:"
  echo "$RESULT" | sed 's/^/    /'
  FAILS=$((FAILS + 1))
fi
echo ""

# CHECK 3: Phosphor icon weight (must be weight="thin")
# Only checks files that import from @phosphor-icons to avoid
# false positives from unrelated weight= attributes in HTML
# elements, third-party components, or font-weight props.
echo "[3] Phosphor icon weight (must be weight=\"thin\"):"
PHOSPHOR_FILES=$(grep -rl "@phosphor-icons" $SCAN_PATH 2>/dev/null || true)
if [ -z "$PHOSPHOR_FILES" ]; then
  echo "    PASS — no Phosphor icon files found in scope"
else
  RESULT=""
  while IFS= read -r FILE; do
    MATCH=$(grep -n "weight=" "$FILE" 2>/dev/null \
      | grep -v 'weight="thin"' \
      || true)
    if [ -n "$MATCH" ]; then
      RESULT="$RESULT"$'\n'"$FILE:"$'\n'"$MATCH"
    fi
  done <<< "$PHOSPHOR_FILES"
  if [ -z "$RESULT" ]; then
    echo "    PASS — all weight=\"thin\" in Phosphor files"
  else
    echo "    FAIL — non-thin weights found:"
    echo "$RESULT" | sed 's/^/    /'
    FAILS=$((FAILS + 1))
  fi
fi
echo ""

# CHECK 4: banned display text
echo "[4] Banned display text (MOTM / Man of the Match):"
RESULT=$(grep -rHn "MOTM\|Man of the Match" $SCAN_PATH 2>/dev/null \
  | grep -v "^\s*//" \
  | grep -v "//.*MOTM" \
  | grep -v "src/mockup/" \
  || true)
if [ -z "$RESULT" ]; then
  echo "    PASS — none found"
else
  echo "    FAIL — found:"
  echo "$RESULT" | sed 's/^/    /'
  FAILS=$((FAILS + 1))
fi
echo ""

# CHECK 5: direct Supabase table writes in client code
# Exemption: supabase.js is the database layer — direct writes
# there are intentional. See INTENTIONAL EXEMPTIONS above.
# Exemption: scripts/seed-demo.js is outside the scan path.
echo "[5] Direct Supabase table writes in client code (must use RPCs):"
RESULT=$(grep -rHn "supabase\.from(" $SCAN_PATH 2>/dev/null \
  | grep -v "supabase\.js" \
  | grep -v "hygiene-exempt: /admin/local" \
  | grep -vE ":[0-9]+:[[:space:]]*//.*supabase\.from\(" \
  || true)
if [ -z "$RESULT" ]; then
  echo "    PASS — no direct table writes in client"
else
  echo "    FAIL — direct table writes found outside supabase.js:"
  echo "$RESULT" | sed 's/^/    /'
  FAILS=$((FAILS + 1))
fi
echo ""

# CHECK 6: raw RPC names leaking outside supabase.js
# Exemption: supabase.js is where all supabase.rpc() calls live.
# Any occurrence outside it means a raw RPC name leaked into a
# component — naming convention violation.
echo "[6] Raw RPC names outside supabase.js (snake_case supabase.rpc calls):"
RESULT=$(grep -rHn "supabase\.rpc(" $SCAN_PATH 2>/dev/null \
  | grep -v "supabase\.js" \
  || true)
if [ -z "$RESULT" ]; then
  echo "    PASS — all supabase.rpc() calls inside supabase.js"
else
  echo "    FAIL — raw RPC calls found outside supabase.js:"
  echo "$RESULT" | sed 's/^/    /'
  FAILS=$((FAILS + 1))
fi
echo ""

# CHECK 7: App.jsx state wrapper purity
# State setters (const set[A-Z]*) in App.jsx must be pure — no async DB calls.
# If a setter is async it almost certainly contains a supabase call inside it,
# violating the pattern documented in CLAUDE.md STATE WRAPPER PATTERN.
# Established pattern: child screens own their own persistence via explicit
# RPC calls; App.jsx setters sync React state only.
echo "[7] App.jsx state wrapper purity (set* must not be async):"
APP_FILE="$ROOT/apps/inorout/src/App.jsx"
if [ ! -f "$APP_FILE" ]; then
  echo "    SKIP — App.jsx not found at expected path"
else
  RESULT=$(grep -n "const set[A-Z][a-zA-Z]* = async" "$APP_FILE" 2>/dev/null || true)
  if [ -z "$RESULT" ]; then
    echo "    PASS — no async state setters in App.jsx"
  else
    echo "    FAIL — async state setters found (likely contain DB calls):"
    echo "$RESULT" | sed 's/^/    /'
    echo "    Fix: remove DB calls from the setter. Child screen calls the RPC"
    echo "    directly, then calls the setter for UI sync. See CLAUDE.md."
    FAILS=$((FAILS + 1))
  fi
fi
echo ""

# CHECK 8: Capacitor plugin-proxy thenable-await footgun (PR #278)
# Delegated to check-plugin-proxy.sh — flags an async resolver returning a
# registerPlugin() proxy, or an `await` of a plugin-proxy resolver. Both hang
# forever (the proxy is accidentally thenable; awaiting it never settles).
# See reference_capacitor_proxy_thenable_await_hang.
echo "[8] Capacitor plugin-proxy thenable-await footgun (PR #278):"
if bash "$ROOT/skills/scripts/check-plugin-proxy.sh" "$TARGET"; then
  :
else
  FAILS=$((FAILS + 1))
fi
echo ""

# SUMMARY
echo "--- SUMMARY ---"
if [ $FAILS -eq 0 ]; then
  echo "RESULT: PASS — all 8 hygiene checks clean"
  exit 0
else
  echo "RESULT: FAIL — $FAILS check(s) failed (see above)"
  exit 1
fi
