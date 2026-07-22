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
#   theme/alias-tokens.css, views/Gaffer/gaffer-tokens.css — design-token source
#   files. Their whole job is to define the hex values every component references
#   via var() (alias-tokens.css is the --u-* shell-unification alias layer; its
#   only literals are the invariant --u-on-color/--u-scrim). Same exemption class
#   as constants/colors.js. Exempt via grep -v in check 2.
#
# apps/inorout/src/mockup/*.html — static design mockups used for ideation,
#   never imported or shipped in the built app. Exempt via grep -v in
#   checks 2 and 4.
#
# apps/inorout/src/views/Gaffer/_archived_chatbot.jsx — dead file kept for
#   reference only (never imported — confirmed via grep, session 2026-07-03
#   nightly QA). Exempt via grep -v in check 2.
#
# Phosphor weight="fill" — NARROW named-set exception (CHECK 3). Thin stays the
#   default everywhere. Fill weight is sanctioned ONLY for the celebratory /
#   status glyph set: the `warning` icon (medical/allergy flag), `star` /
#   `star-four` (POTM / rating / award), the ACTIVE nav-tab icon, and
#   status/celebration badges. Each such use MUST carry an inline
#   `hygiene-exempt: fill-weight` tag on the same line naming which of the set
#   it is (e.g. `weight="fill" /* hygiene-exempt: fill-weight — POTM star */`).
#   Untagged fill — and every OTHER non-thin weight (bold/duotone/regular) —
#   still FAILS. This keeps the set narrow by per-use intent rather than a
#   blanket allowance. Introduced for the DF Sports design PRs (#6/#8/#14).
#   Exempt via grep -v "hygiene-exempt: fill-weight" in check 3.
#
# apps/venue/src, apps/clubmanager/src — these operator consoles have their
#   OWN design-token systems (venue: Manrope + amber --accent #FFC83A, single
#   dark :root; clubmanager: scoped --cp-* white-label navy/gold), NOT the
#   inorout Bebas/gold #60A0FF/#FF6060 palette. So the two inorout-SPECIFIC
#   DESIGN-SYSTEM checks — CHECK 2 (hardcoded hex limited to #60A0FF/#FF6060)
#   and CHECK 3 (Phosphor weight="thin") — do NOT apply to them and are
#   skipped when the target is under apps/venue/ or apps/clubmanager/. The
#   UNIVERSAL safety checks still run for these apps: CHECK 1 (console.log),
#   CHECK 5 (direct supabase.from writes), CHECK 6 (raw supabase.rpc leakage),
#   plus 4/7/8 (harmless no-ops there). See DESIGN_CHECKS gate below.
#
# apps/<app>/api/** — SERVER-SIDE Vercel functions, exempt from CHECK 6 only.
#   CHECK 6 ("raw RPC names live only in supabase.js") is a CLIENT-code rule: a
#   snake_case RPC name in a component means someone bypassed the wrapper layer.
#   A Vercel serverless function is not client code and cannot use the browser
#   supabase client at all — it constructs its own SERVICE-ROLE client, which is
#   the entire point of the form-guard routes (api/club-lead.js mig 615,
#   api/room-hire-enquiry.js mig 616, and phases 3–6 to come): the RPC's
#   anon/authenticated EXECUTE is REVOKED precisely so the ONLY caller is a
#   guarded server route calling it as service_role. Routing those calls through
#   packages/core/storage/supabase.js is impossible — that module is the browser
#   client. These files never enter the browser bundle, so no raw RPC name leaks
#   to a client. Anchored to ^$ROOT/apps/<app>/api/ so (a) a client-side directory
#   that happens to be called "api" (src/api, packages/core/api) is NOT exempted, and
#   (b) a checkout path that itself contains /apps/x/api/ — a CI workspace, a cloud
#   session container — cannot silently disable CHECK 6 repo-wide.
#   CHECKS 1 (console.log) and 5 (direct table writes) still apply. CHECK 5 is
#   deliberately NOT exempted: no guarded route needs a direct table write today, so
#   the narrowest exemption that fixes the observed false positive is the right one.
#   Revisit only when a phase actually needs it.
#   Codified in form-guard phase 2 after phase 1's already-merged club-lead.js was
#   found to trip the same false positive (the PostToolUse hook never fired on it
#   because apps/*/api/ is outside the hook's src/-and-core-only scope).
#   Exempt via grep -Ev in check 6.
#
# If you need to add a new intentional exemption, add it here
# AND add a grep -v filter in the relevant check below.
# Never silently widen the scan path — document it first.

# No set -e — this script manages its own failure counting.
# Each check uses explicit result capture, not exit code propagation.

ROOT=$(git rev-parse --show-toplevel)
TARGET="${1:-}"
FAILS=0

# DESIGN_CHECKS gate — the inorout-specific design-system checks (CHECK 2
# hardcoded hex, CHECK 3 Phosphor weight="thin") only apply to the inorout
# app. The operator consoles apps/venue and apps/clubmanager have their own
# token systems (see exemption note above), so skip those two checks when a
# single target file under those trees is being scanned. The universal
# safety checks (1/5/6) always run. Default (no-arg bulk scan) keeps
# DESIGN_CHECKS=1 — that scan covers inorout+core+clubmanager as before.
case "$TARGET" in
  apps/venue/*|apps/clubmanager/*) DESIGN_CHECKS=0 ;;
  *)                               DESIGN_CHECKS=1 ;;
esac

if [ -n "$TARGET" ]; then
  SCAN_PATH="$ROOT/$TARGET"
  SCOPE="$TARGET"
  # CHECK 9 (telemetry chokepoint) honours the explicit target like the rest.
  TELEMETRY_SCAN_PATH="$SCAN_PATH"
else
  SCAN_PATH="$ROOT/apps/inorout/src $ROOT/packages/core $ROOT/apps/clubmanager/src"
  SCOPE="apps/inorout/src + packages/core + apps/clubmanager/src"
  # The telemetry chokepoint (CHECK 9) governs posthog.capture across MORE apps
  # than the design/console checks do — analytics is emitted from every app, so
  # a raw capture in apps/venue must be caught too. It is a superset scan and
  # deliberately does NOT subject those apps to inorout's hex/phosphor/console
  # rules (which is why it is a separate variable, not a widened SCAN_PATH).
  TELEMETRY_SCAN_PATH="$SCAN_PATH $ROOT/apps/venue/src"
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

if [ "$DESIGN_CHECKS" = "0" ]; then
  echo "[2] Hardcoded hex colours: SKIP — non-inorout console (own token system)"
  echo ""
  echo "[3] Phosphor icon weight: SKIP — non-inorout console (own icon conventions)"
  echo ""
else
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
  | grep -v "alias-tokens\.css" \
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
# NARROW EXCEPTION: weight="fill" is allowed on a line explicitly tagged
# `hygiene-exempt: fill-weight` (celebratory/status glyph set — see header
# note). Untagged fill and every other non-thin weight still fail.
echo "[3] Phosphor icon weight (weight=\"thin\", or fill tagged hygiene-exempt):"
PHOSPHOR_FILES=$(grep -rl "@phosphor-icons" $SCAN_PATH 2>/dev/null || true)
if [ -z "$PHOSPHOR_FILES" ]; then
  echo "    PASS — no Phosphor icon files found in scope"
else
  RESULT=""
  while IFS= read -r FILE; do
    MATCH=$(grep -n "weight=" "$FILE" 2>/dev/null \
      | grep -v 'weight="thin"' \
      | grep -v 'hygiene-exempt: fill-weight' \
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
fi  # end DESIGN_CHECKS gate (CHECK 2 + CHECK 3)

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
# Second exemption: apps/<app>/api/** server-side Vercel functions, which hold their
# own service-role client by design and never reach the browser bundle. See the
# exemption note in the header for the full rationale.
echo "[6] Raw RPC names outside supabase.js (snake_case supabase.rpc calls):"
RESULT=$(grep -rHn "supabase\.rpc(" $SCAN_PATH 2>/dev/null \
  | grep -v "supabase\.js" \
  | grep -Ev "^$ROOT/apps/[^/]+/api/" \
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

# CHECK 9: posthog.capture() outside the telemetry chokepoint
# Every analytics EVENT must go through track() in
# packages/core/telemetry/analytics.js, so that app / event_version / hat
# context / sampling / env-suppression / U18-suppression are applied uniformly.
# A raw posthog.capture() at a call site bypasses all of that. Same shape as
# CHECK 6 (raw supabase.rpc outside supabase.js).
# NOT banned: posthog.identify / reset / register / init / group — those are
# lifecycle calls, legitimately in App.jsx, index.html and supabase.js.
echo "[9] posthog.capture() outside the telemetry chokepoint:"
RESULT=$(grep -rHn "posthog[?.]*\.capture(" $TELEMETRY_SCAN_PATH 2>/dev/null \
  | grep -v "packages/core/telemetry/analytics.js" \
  || true)
if [ -z "$RESULT" ]; then
  echo "    PASS — all analytics events go through track()"
else
  echo "    FAIL — raw posthog.capture() found outside the chokepoint:"
  echo "$RESULT" | sed 's/^/    /'
  echo "    Fix: import { track } from '@platform/core' and call track(name, props)."
  FAILS=$((FAILS + 1))
fi
echo ""

# SUMMARY
echo "--- SUMMARY ---"
if [ $FAILS -eq 0 ]; then
  echo "RESULT: PASS — all 9 hygiene checks clean"
  exit 0
else
  echo "RESULT: FAIL — $FAILS check(s) failed (see above)"
  exit 1
fi
