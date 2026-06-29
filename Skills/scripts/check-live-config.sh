#!/bin/bash
# skills/scripts/check-live-config.sh
# Blast-radius classifier for the dev-loop. Given a set of changed files (args, or
# `git diff --name-only main...HEAD` by default), it classifies the change as
# CLEAR (safe to ship) or PROTECTED (touches a live/irreversible surface) and prints
# WHY. The dev-loop uses this to HARD-STOP on anything that could affect the live
# casual team or the iOS binary currently in Apple review — because the human merge
# tap is a rubber stamp, this script (not the human) is the safety net.
#
# Exit: 0 = CLEAR, 1 = PROTECTED (loop must stop and surface to human), 2 = usage error.
#
# Why these surfaces (see CLAUDE.md Hard Rules + GO_LIVE_ISSUES.md):
#   main auto-deploys to the live app (apps/inorout → platform-clubmanager →
#   app.in-or-out.com), which is BOTH the running casual team's app AND the server.url
#   web bundle inside the iOS binary Apple is reviewing. A bad merge ships to both.

set -o pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 2; }
cd "$ROOT"

if [ "$#" -gt 0 ]; then
  FILES="$*"
else
  FILES=$(git diff --name-only main...HEAD 2>/dev/null; git diff --name-only 2>/dev/null; git diff --name-only --cached 2>/dev/null)
fi
FILES=$(printf '%s\n' $FILES | sort -u | sed '/^$/d')

[ -z "$FILES" ] && { echo "RESULT: CLEAR — no changed files detected."; exit 0; }

hits=""
flag(){ hits="${hits}  [$1] $2 — $3\n"; }

while IFS= read -r f; do
  [ -z "$f" ] && continue
  # Dev-tooling / docs / tests never reach the app bundle — skip outright.
  case "$f" in
    .claude/*|skills/*|docs/*|e2e/*|*.md) continue ;;
  esac
  case "$f" in
    rls_migrations/*.sql)
      flag "DB/RLS" "$f" "migration / RLS change — apply is irreversible; needs sign-off + ephemeral-verify" ;;
  esac
  # Auth / SSO / session storage — broke Apple review twice already
  printf '%s' "$f" | grep -Eiq 'cookieAuthStorage|authStorage|AuthGate|useRequireAuth|AuthCallback|sso|supabaseClient|/auth' \
    && flag "AUTH" "$f" "auth/session surface — the exact class that caused App-Store rejections #1 and #2"
  # PWA / service worker / manifest / install
  printf '%s' "$f" | grep -Eiq 'manifest\.json|\.webmanifest|api/manifest|manifest\.js|service-?worker|/sw\.|serviceWorker|offline\.html' \
    && flag "PWA" "$f" "PWA/manifest/service-worker — must be real-device tested before ship (Hard Rule 13)"
  # Native wrapper
  printf '%s' "$f" | grep -Eiq 'capacitor|Capacitor|/ios/|/android/|native' \
    && flag "NATIVE" "$f" "native wrapper — affects the binary in Apple review; ONE-SESSION rule"
  # App.jsx — routing / auth / realtime / manifest entrypoint
  case "$f" in
    apps/inorout/src/App.jsx) flag "ROUTING" "$f" "App.jsx routing/auth/realtime — PWA-affecting (Hard Rule 13)" ;;
  esac
  # Money
  printf '%s' "$f" | grep -Eiq 'stripe|Stripe|gocardless|payment|nrl|client_account|reconcil' \
    && flag "MONEY" "$f" "payment/finance surface — needs sign-off"
  # Env / prod flags / deploy config
  printf '%s' "$f" | grep -Eiq '\.env|vercel\.json|vite\.config|/api/[^/]+\.(js|ts|mjs)' \
    && flag "ENV/DEPLOY" "$f" "env/deploy/edge-config surface — affects prod runtime"
  # Casual core (the live team's daily path)
  printf '%s' "$f" | grep -Eiq 'PlayerView|MySquads|AdminView/index|squad\.js|result|potm|POTM' \
    && flag "CASUAL" "$f" "casual-core path — run casual-regression before ship (live team depends on it)"
done <<< "$FILES"

if [ -n "$hits" ]; then
  echo "RESULT: PROTECTED — change touches live/irreversible surfaces:"
  printf "$hits"
  echo ""
  echo "ACTION: dev-loop must STOP here (needs-human). State ship-safety explicitly:"
  echo "  - dark-in-prod (flag-gated OFF / dead code / dev-tooling) → safe to merge, say so."
  echo "  - ships-live → HOLD during Apple review; require the matching proof"
  echo "    (real-device walk / casual-regression / ephemeral-verify) before recommending merge."
  exit 1
fi

echo "RESULT: CLEAR — no protected surface touched. Changed files:"
printf '%s\n' $FILES | sed 's/^/  /'
exit 0
