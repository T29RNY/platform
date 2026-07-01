#!/bin/bash
# skills/scripts/check-rpc-consumers.sh — Hard Rule 14 automation.
#
# New RPCs designed for MULTIPLE downstream apps MUST record their consumers in
# RPCS.md in the SAME commit — so a later return-shape change can grep every
# consumer before breaking one. This is the forward extension of the mig-070
# `is_self` incident (Hard Rule 12): a return-shape change to an RPC that
# silently had a second, not-yet-built consumer breaks that consumer when it is
# finally built, because nobody recorded the consumer existed. The fix is to
# record future consumers NOW, in RPCS.md, where the next developer greps.
#
# This is the fourth sibling of the three shipped in ac7def7 (check-mapper-sync
# / check-audit-events / check-realtime-subscriber). For each new RPC in a
# staged migration it decides whether the RPC is *multi-app-designed* via two
# independent signals (EITHER fires) and, if so, confirms the same commit's
# staged RPCS.md diff records the RPC + a CONSUMERS marker:
#
#   Signal A — declaration/drift (precise, primary): the migration's OWN
#     `Consumers (Hard Rule #14):` top-comment header (an existing convention —
#     migs 165, 451, 454) names >=2 distinct apps/* dirs OR a future marker
#     (future / deferred / not-yet-built / Phase N). When it fires the RPC is
#     *declared* multi-app, so require the consumers echoed in RPCS.md.
#   Signal B — omission catch: the RPC's name is referenced in a *_HANDOFF.md
#     or docs/epics/*.md scope doc that ALSO carries a future/multi-app marker
#     near it, AND the migration has NO Consumers header at all. Catches
#     "developer forgot to declare consumers entirely." Noisier, so narrowed by
#     the marker requirement and advisory-only.
#
# Compliance = the STAGED DIFF of RPCS.md (the newly-added session block), not
# the whole file — a whole-file search would false-pass on a stale note for an
# old RPC of the same name. It must carry BOTH the RPC name AND a CONSUMERS
# marker (`CONSUMERS (HR#14)` / `Consumer(s)` variants).
#
# HEURISTIC — the multi-app decision is inferred from a comment header and scope
# docs, so it is ADVISORY in the commit hook (loud warning, never blocks) and
# exits non-zero standalone for use as a dev-loop proof gate.
#
# Usage:  bash skills/scripts/check-rpc-consumers.sh [file ...]
#   No args → staged+working migration files (rls_migrations/NNN_*.sql).
# Exit: 0 = clean/nothing to check; 1 = a multi-app RPC's consumers are unrecorded.

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 0; }
cd "$ROOT" || exit 0

# ── Collect the migration files to inspect ──────────────────────────────────
if [ "$#" -gt 0 ]; then
  MIGS=$(printf '%s\n' "$@" | grep -E '^rls_migrations/[0-9]+_[^/]+\.sql$' | grep -v '_down\.sql$')
else
  MIGS=$( { git diff --cached --name-only --diff-filter=ACM 2>/dev/null; \
            git diff --name-only --diff-filter=ACM 2>/dev/null; } \
          | sort -u \
          | grep -E '^rls_migrations/[0-9]+_[^/]+\.sql$' \
          | grep -v '_down\.sql$')
fi

[ -z "$MIGS" ] && { echo "check-rpc-consumers: no staged migration files — nothing to check."; exit 0; }

# The staged-added lines of RPCS.md (this commit's new session block) — where a
# compliant consumer record must live. Computed once.
RPCS_ADDED=$(git diff --cached -- RPCS.md 2>/dev/null | grep '^+')

# Markers a doc/header carries when an RPC is future/multi-app designed.
FUTURE_RE='future|deferred|not.?yet.?built|not yet built|phase[[:space:]]*[0-9]'
# A compliant CONSUMERS record in the RPCS.md diff: `CONSUMERS (HR#14)` (any
# case/spacing) or the `Consumer(s)` variant.
MARKER_RE='consumers?.{0,8}#?[[:space:]]*14|consumer\(s\)'

MISSES=""
for MIG in $MIGS; do
  [ -f "$MIG" ] || continue

  # Function names defined in this migration. Anchored on CREATE so a mandatory
  # DROP FUNCTION line doesn't feed a dropped name in. Improves on the sibling
  # extraction by stripping an optional schema qualifier (`public.`) — every
  # real mig writes `CREATE ... FUNCTION public.<name>`, and the bare
  # `[a-z_]+$` form would otherwise yield the schema ("public") not the name.
  FN_NAMES=$(grep -oiE 'CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+[a-z0-9_."]+' "$MIG" 2>/dev/null \
               | sed -E 's/.*FUNCTION[[:space:]]+//I; s/"//g; s/^[a-z0-9_]+\.//' \
               | grep -oE '^[a-z0-9_]+' | sort -u)
  [ -z "$FN_NAMES" ] && continue

  # ── Signal A: parse this migration's own Consumers (Hard Rule #14) header ──
  CONS_LINE=$(grep -iE 'consumers?.{0,25}1[[:space:]]*4' "$MIG" 2>/dev/null | head -1)
  SIGNAL_A=0
  if [ -n "$CONS_LINE" ]; then
    # text after the "...14...:" — the declared consumer list
    CONS_TEXT=$(printf '%s' "$CONS_LINE" | sed -E 's/^.*1[[:space:]]*4[^:]*:[[:space:]]*//')
    N_APPS=$(printf '%s' "$CONS_TEXT" | grep -oE 'apps/[a-z]+' | sort -u | wc -l | tr -d ' ')
    if [ "$N_APPS" -ge 2 ] || printf '%s' "$CONS_TEXT" | grep -qiE "$FUTURE_RE"; then
      SIGNAL_A=1
    fi
  fi

  for FN in $FN_NAMES; do
    FLAGGED=0
    REASON=""

    if [ "$SIGNAL_A" -eq 1 ]; then
      FLAGGED=1
      REASON="declared multi-app in the migration's Consumers (HR#14) header"
    elif [ -z "$CONS_LINE" ] && ! git show HEAD:RPCS.md 2>/dev/null | grep -qwE "$FN"; then
      # ── Signal B: no header at all → is the NEW RPC named in a scope doc
      # with a future/multi-app marker nearby? ──────────────────────────────
      # Scoped to NEW RPCs only (Hard Rule 14 / the handoff's "the new RPC's
      # function name"): if FN is ALREADY in committed RPCS.md its consumers
      # were declared long ago, so a CREATE OR REPLACE that merely re-defines
      # it (e.g. to add a field — that's Hard Rule 12's territory) is not an
      # omission and must not fire the omission catch. A genuinely new RPC is
      # never yet in committed RPCS.md, so it still flags.
      for D in $(ls -1 *_HANDOFF.md docs/epics/*.md 2>/dev/null); do
        [ -f "$D" ] || continue
        CTX=$(grep -w -A3 -B3 -E "$FN" "$D" 2>/dev/null)
        [ -z "$CTX" ] && continue
        N_APPS_D=$(printf '%s' "$CTX" | grep -oE 'apps/[a-z]+' | sort -u | wc -l | tr -d ' ')
        if [ "$N_APPS_D" -ge 2 ] || printf '%s' "$CTX" | grep -qiE "$FUTURE_RE"; then
          FLAGGED=1
          REASON="named near a future/multi-app marker in ${D}, no Consumers header in the migration"
          break
        fi
      done
    fi

    [ "$FLAGGED" -eq 0 ] && continue

    # ── Compliance: same commit's staged RPCS.md diff must record FN + marker ─
    HAS_FN=$(printf '%s' "$RPCS_ADDED" | grep -cwE "$FN")
    HAS_MARK=$(printf '%s' "$RPCS_ADDED" | grep -ciE "$MARKER_RE")
    if [ "$HAS_FN" -lt 1 ] || [ "$HAS_MARK" -lt 1 ]; then
      MISSES="${MISSES}  [${MIG}] ${FN}() — ${REASON}; no CONSUMERS record in staged RPCS.md diff\n"
    fi
  done
done

if [ -n "$MISSES" ]; then
  echo "RPC-CONSUMERS (Hard Rule 14) — multi-app RPC(s) with unrecorded consumers:"
  printf "%b" "$MISSES"
  echo ""
  echo "Each RPC above is designed for multiple / future downstream apps but the SAME"
  echo "commit's RPCS.md diff does not record it with a CONSUMERS marker. Add a"
  echo "'**CONSUMERS (HR#14):**' note naming each consumer to this commit's RPCS.md"
  echo "session block, so a later return-shape change can grep every consumer first"
  echo "(the mig-070 is_self class, Hard Rule 12 forward-extended). If the RPC is not"
  echo "actually multi-app (header/scope-doc matched by coincidence), this is a false"
  echo "positive — proceed."
  exit 1
fi

echo "check-rpc-consumers: all multi-app RPCs record their consumers in RPCS.md — clean."
exit 0
