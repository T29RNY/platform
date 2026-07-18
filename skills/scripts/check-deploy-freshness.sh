#!/bin/bash
# scripts/check-deploy-freshness.sh
# Deploy-freshness sweep (FEATURES.md "Deploy-freshness sweep (03:50 UTC)").
#
# READ-ONLY. This script NEVER deploys, NEVER pushes, NEVER calls any Vercel
# deploy/promote/rollback action. It only reads git history and (best-effort)
# Vercel deployment metadata to report drift. Safe to run unattended.
#
# What it checks:
#   MANUAL-DEPLOY apps — these do NOT auto-deploy on push to `main`. Per repo
#   memory/docs (project_venue_deploy.md, project_hq_deploy.md,
#   project_reception_display.md, project_ref_v2.md,
#   project_superadmin_analytics.md — all confirmed "manual prebuilt-static,
#   does NOT auto-deploy on push"), a merge to main updates SOURCE only; a
#   human/agent must run `vercel deploy --prebuilt --prod` to actually ship it:
#     apps/venue          -> platform-venue        (venue.in-or-out.com)
#     apps/hq             -> platform-hq
#     apps/display        -> platform-display
#     apps/ref            -> platform-ref
#     apps/superadmin      -> platform-superadmin
#   For each, this script finds the last commit on `main` touching that app's
#   directory OR packages/core OR packages/ui (both are bundled into every
#   app's build output, so a core/ui change is a real redeploy trigger even
#   with zero lines changed under apps/<name>), then — IF the `vercel` CLI is
#   available and authenticated non-interactively — fetches that project's
#   current production deployment's createdAt timestamp and compares the two.
#   Newer merged commit than the live deployment = DRIFT (merged, unshipped).
#
#   AUTO-DEPLOY apps — apps/inorout is git-integrated on Vercel project
#   platform-clubmanager (aliases app.in-or-out.com); confirmed in
#   project_inorout_deploy_and_pwa_update.md: "push branch -> preview;
#   merge PR to main -> production" happens automatically. No drift check is
#   needed or attempted here beyond an informational confirmation.
#
#   NOT CURRENTLY DEPLOYED — apps/clubmanager (the club-OS app directory,
#   distinct from the platform-clubmanager Vercel PROJECT which actually
#   hosts apps/inorout) and apps/league have no linked .vercel/project.json
#   in this checkout as of the last audit. Reported informational only, not
#   scored as drift.
#
# Known limitation (see script comments + PR description): the Vercel CLI
# fetch of "what's actually live" only works when a session is already
# `vercel login`-linked (or VERCEL_TOKEN is exported) AND has network access.
# In any unattended run where that isn't true, the script degrades to
# printing the last-merged-commit-touching-that-app info and instructs the
# operator/agent to cross-check it against the live bundle hash (the same
# "curl the live bundle, grep for a string" technique used elsewhere in this
# repo's deploy memory notes) — it does NOT claim full automation in that case.
#
# Exit codes:
#   0 = no drift detected (or Vercel check unavailable — degraded, not a fail)
#   1 = at least one manual-deploy app has a merged-but-unshipped commit
#
# Usage: bash skills/scripts/check-deploy-freshness.sh

set -u
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

echo "--- DEPLOY-FRESHNESS SWEEP (read-only, never deploys) ---"
echo ""

# app_dir:vercel_project_name
MANUAL_APPS=(
  "apps/venue:platform-venue"
  "apps/hq:platform-hq"
  "apps/display:platform-display"
  "apps/ref:platform-ref"
  "apps/superadmin:platform-superadmin"
)

AUTO_APPS=(
  "apps/inorout:platform-clubmanager"
)

UNDEPLOYED_APPS=(
  "apps/clubmanager"
  "apps/league"
)

DRIFT_FOUND=0

# --- Vercel CLI availability probe (best-effort, never blocks) -------------
VERCEL_AVAILABLE=0
VERCEL_LS_CACHE=""
if command -v vercel >/dev/null 2>&1; then
  # Merge stderr: vercel CLI prints its progress/table on a mix of both
  # streams depending on version; a short timeout keeps this from hanging
  # an unattended run if the CLI tries an interactive login prompt.
  if VERCEL_LS_CACHE=$(timeout 20 vercel project ls 2>&1) && echo "$VERCEL_LS_CACHE" | grep -qi "Project Name"; then
    VERCEL_AVAILABLE=1
  fi
fi

if [ "$VERCEL_AVAILABLE" -eq 1 ]; then
  echo "Vercel CLI: available and authenticated — live deployment timestamps will be checked."
else
  echo "Vercel CLI: NOT available/authenticated in this run — degrading to source-only check."
  echo "  (last-merged-commit info below still stands; cross-check manually against the"
  echo "   live bundle, e.g. curl the site and grep the JS bundle for an expected string —"
  echo "   see project_venue_deploy.md / project_hq_deploy.md for the exact recipe.)"
fi
echo ""

echo "=== MANUAL-DEPLOY APPS (does NOT auto-deploy on push) ==="
for entry in "${MANUAL_APPS[@]}"; do
  app_dir="${entry%%:*}"
  project="${entry##*:}"

  # Last commit on main touching this app OR the shared packages it bundles.
  LAST_COMMIT_INFO=$(git log -1 --format='%H|%cI|%s' -- "$app_dir" packages/core packages/ui 2>/dev/null)
  if [ -z "$LAST_COMMIT_INFO" ]; then
    echo "[$project ($app_dir)] no commits found touching this app or packages/core|ui — skipping."
    continue
  fi
  LAST_SHA="${LAST_COMMIT_INFO%%|*}"
  REST="${LAST_COMMIT_INFO#*|}"
  LAST_ISO="${REST%%|*}"
  LAST_SUBJECT="${REST#*|}"
  LAST_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S%z" "$LAST_ISO" "+%s" 2>/dev/null || date -d "$LAST_ISO" "+%s" 2>/dev/null)

  echo ""
  echo "[$project ($app_dir)]"
  echo "  last merged commit touching app or packages/core|ui: ${LAST_SHA:0:8} ($LAST_ISO) \"$LAST_SUBJECT\""

  if [ "$VERCEL_AVAILABLE" -ne 1 ]; then
    echo "  live deployment: UNKNOWN (Vercel CLI unavailable) — cross-check manually."
    continue
  fi

  PROD_URL=$(echo "$VERCEL_LS_CACHE" | grep -E "^  ${project}[[:space:]]" | grep -oE 'https://[^ ]+' | head -1)
  if [ -z "$PROD_URL" ]; then
    echo "  live deployment: UNKNOWN (project '$project' not found in 'vercel project ls' output) — cross-check manually."
    continue
  fi

  DEPLOY_JSON=$(timeout 20 vercel inspect "$PROD_URL" --format json 2>/dev/null)
  DEPLOY_CREATED_MS=$(echo "$DEPLOY_JSON" | jq -r '.createdAt // empty' 2>/dev/null)
  if [ -z "$DEPLOY_CREATED_MS" ]; then
    echo "  live deployment: UNKNOWN ('vercel inspect $PROD_URL' returned no createdAt) — cross-check manually."
    continue
  fi
  DEPLOY_EPOCH=$((DEPLOY_CREATED_MS / 1000))
  DEPLOY_ISO=$(date -u -r "$DEPLOY_EPOCH" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "@$DEPLOY_EPOCH" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null)
  echo "  current production deployment ($PROD_URL) created: $DEPLOY_ISO"

  if [ -n "$LAST_EPOCH" ] && [ "$LAST_EPOCH" -gt "$DEPLOY_EPOCH" ]; then
    echo "  RESULT: DRIFT — a merged commit (${LAST_SHA:0:8}) postdates the live deployment. Manual redeploy owed."
    DRIFT_FOUND=1
  else
    echo "  RESULT: CURRENT — live deployment postdates the last relevant merged commit."
  fi
done

echo ""
echo "=== AUTO-DEPLOY APPS (git-integrated — ships automatically on merge to main) ==="
for entry in "${AUTO_APPS[@]}"; do
  app_dir="${entry%%:*}"
  project="${entry##*:}"
  echo "[$project ($app_dir)] auto-deploys on merge to main (confirmed via project_inorout_deploy_and_pwa_update.md) — always current, no drift check needed."
done

echo ""
echo "=== NOT CURRENTLY DEPLOYED (informational only, not scored) ==="
for app_dir in "${UNDEPLOYED_APPS[@]}"; do
  echo "[$app_dir] no linked .vercel/project.json found in this checkout — no live target to compare against."
done

echo ""
if [ "$DRIFT_FOUND" -eq 1 ]; then
  echo "RESULT: DRIFT DETECTED — at least one manual-deploy app has a merged, unshipped change."
  exit 1
else
  echo "RESULT: CURRENT — no drift detected on manual-deploy apps (or Vercel check was unavailable this run; see per-app notes above)."
  exit 0
fi
