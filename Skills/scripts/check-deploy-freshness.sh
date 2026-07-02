#!/bin/bash
# skills/scripts/check-deploy-freshness.sh
# Deploy-freshness sweep. Flags manual-deploy apps (venue/hq — prebuilt-static,
# see project_venue_deploy / project_hq_deploy) sitting on merged-but-unshipped
# changes, and confirms auto-deploy apps (inorout/ref/display/superadmin —
# git-linked Vercel builds) are current. Read-only: never deploys, never
# redeploys — it only reports.
#
# Usage: bash skills/scripts/check-deploy-freshness.sh
# Exit code: 0 always. Read the printed report — STALE/LAGGING lines are the
# findings, not script failures.

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT" || exit 1

# app_path|vercel_project|mode  (mode: manual = prebuilt-static redeploy owed by
# an operator; auto = git-linked, Vercel builds on push to main)
#
# Classification is empirical, not assumed: only platform-ref and
# platform-clubmanager show up as GitHub Vercel status checks on PRs (confirmed
# by inspecting statusCheckRollup on several recent merged PRs) — those two are
# the only true git-auto-deploys. venue/hq are documented manual prebuilt-static
# deploys ([[project_venue_deploy]] / [[project_hq_deploy]]); display/superadmin
# show no PR-check integration either, so they're treated as manual too rather
# than flagged as "broken automation" every night.
APPS=(
  "apps/venue|platform-venue|manual"
  "apps/hq|platform-hq|manual"
  "apps/display|platform-display|manual"
  "apps/superadmin|platform-superadmin|manual"
  "apps/inorout|platform-clubmanager|auto"
  "apps/ref|platform-ref|auto"
)

# Grace window for auto-deploy apps: Vercel's git-triggered build+deploy takes a
# few minutes. Only flag LAGGING once a commit has sat unshipped longer than this.
AUTO_BUILD_BUFFER_SECS=900

echo "--- DEPLOY-FRESHNESS SWEEP ---"
echo ""

for entry in "${APPS[@]}"; do
  IFS='|' read -r APP_PATH PROJECT MODE <<< "$entry"

  COMMIT_EPOCH=$(git log -1 --format=%ct main -- "$APP_PATH" packages/core packages/ui 2>/dev/null)
  if [ -z "$COMMIT_EPOCH" ]; then
    echo "[$PROJECT] no commits on main touching $APP_PATH, packages/core, or packages/ui — nothing to check"
    continue
  fi

  DEPLOY_URL=$(vercel ls "$PROJECT" --prod --yes 2>/dev/null | grep -oE 'https://[^ ]+\.vercel\.app' | head -1)
  if [ -z "$DEPLOY_URL" ]; then
    echo "[$PROJECT] FAIL — could not find a Ready production deployment via 'vercel ls $PROJECT --prod'"
    continue
  fi

  DEPLOY_JSON=$(vercel inspect "$DEPLOY_URL" --format json 2>/dev/null)
  DEPLOY_EPOCH_MS=$(node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.createdAt||''))}catch(e){}" <<< "$DEPLOY_JSON")
  if [ -z "$DEPLOY_EPOCH_MS" ]; then
    echo "[$PROJECT] FAIL — could not parse deployment createdAt from 'vercel inspect $DEPLOY_URL'"
    continue
  fi
  DEPLOY_EPOCH=$(( DEPLOY_EPOCH_MS / 1000 ))
  LAG=$(( COMMIT_EPOCH - DEPLOY_EPOCH ))

  if [ "$LAG" -le 0 ]; then
    echo "[$PROJECT] OK — current ($MODE, live deploy is newer than the latest relevant commit)"
  elif [ "$MODE" = "manual" ]; then
    echo "[$PROJECT] STALE — manual redeploy owed. Latest relevant commit on main is $((LAG/60))min newer than the live production deployment ($DEPLOY_URL). $APP_PATH deploys as prebuilt-static and does NOT auto-deploy on push."
  else
    if [ "$LAG" -gt "$AUTO_BUILD_BUFFER_SECS" ]; then
      echo "[$PROJECT] LAGGING — auto-deploy should have shipped the latest commit by now (it's $((LAG/60))min old) but the live deployment ($DEPLOY_URL) predates it. Check the Vercel build for $PROJECT for a failed/stuck deploy."
    else
      echo "[$PROJECT] OK — auto-deploy within the normal build window (${LAG}s behind latest commit)."
    fi
  fi
done

echo ""
echo "Read-only sweep — no deploys triggered. STALE/LAGGING findings need an operator-approved redeploy; report, don't act."
exit 0
