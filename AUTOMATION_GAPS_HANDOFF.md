# Epic manifest — Automation Gaps (7 phases)
- Epic: Close the 6 identified gaps in the dev-loop automation stack + nightly QA schedule
- Plan gate: batched
- Merge mode: auto
- Approved: 2026-06-30

---

## Context

Seven self-contained phases. No migrations, no RLS, no auth touches.
All phases are tier-1 or tier-2 (scripts, hooks, skill .md files, settings.json).
P7 (cloud trigger) is tier-3 outward — it creates a live scheduled job and requires
explicit sign-off before the MCP call is made.

The phases reference these existing files:
- `skills/scripts/check-rpc-columns.sh` — already exists; P4 wires it into pre-commit
- `skills/ephemeral-verify.md` — P3 wires check-ev-leak.sh into its STEP 5
- `skills/commit.md` — P5 adds a BUGS.md awareness step
- `.claude/hooks/pre-commit-build.sh` — P4 augments this hook
- `.claude/settings.json` — P1 adds auto-approve entries for new commands
- `CONTEXT.md` — P7 records the created trigger ID there

---

## Phases   (status: pending | in-progress | done | blocked: <why> | needs-human: <what>)

### P1 — settings.json: auto-approve new commands
- status: done
- deps: none
- goal: Add all auto-approve entries that the new scripts (P2/P3) and hook changes (P4)
  will need, so subsequent phases run without permission prompts.
  Add to the `permissions.allow` array in `.claude/settings.json`:
  - `"Bash(bash skills/scripts/check-next-migration.sh)"` — no args version (P4 hook calls it bare)
  - `"Bash(bash skills/scripts/check-next-migration.sh *)"` — with args
  - `"Bash(bash skills/scripts/check-ev-leak.sh)"` — no args version
  - `"Bash(bash skills/scripts/check-ev-leak.sh *)"` — with args
  - `"Bash(chmod +x skills/scripts/*.sh)"` — wildcard chmod for any new script
  - Also add the absolute-path variants (prefix `bash /Users/tarny/platform/` for each of the two new scripts):
    `"Bash(bash /Users/tarny/platform/skills/scripts/check-next-migration.sh)"`,
    `"Bash(bash /Users/tarny/platform/skills/scripts/check-ev-leak.sh)"`
- tier-3 touch: none
- proof: grep settings.json confirms all 8 new entries present; check-build.sh passes
- PR:

### P2 — check-next-migration.sh: new script
- status: done
- deps: P1 (for auto-approve)
- goal: Create `skills/scripts/check-next-migration.sh`. The script:
  1. Reads `rls_migrations/` to find the highest NNN prefix across all `.sql` files
     (forward files only — exclude `_down.sql`). Use: `ls rls_migrations/*.sql | grep -v _down | grep -oE '^rls_migrations/[0-9]+' | sort -t/ -k2 -n | tail -1 | grep -oE '[0-9]+'`
  2. Computes next = highest + 1, zero-padded to 3 digits.
  3. Outputs one line: `Next safe migration: NNN  (highest committed: MMM)`
  4. If called with one argument (a file path), checks whether that file's NNN prefix
     equals `next`. If it equals `next`: exits 0 with PASS message.
     If it is LESS than next: exits 2 with "CONFLICT: migration NNN already exists"
     If it is GREATER than next: exits 0 with "GAP WARNING: migration NNN skips N numbers"
  Make the script executable (chmod +x).
- tier-3 touch: none
- proof: `bash skills/scripts/check-next-migration.sh` outputs the next number correctly;
  `node --check skills/scripts/check-next-migration.sh` is not applicable (it's bash);
  verify the script is executable; check-build.sh passes
- PR:

### P3 — check-ev-leak.sh: new script + wire into ephemeral-verify.md
- status: done
- deps: P1 (for auto-approve)
- goal:
  PART A — Create `skills/scripts/check-ev-leak.sh`. The script outputs a ready-to-execute
  Supabase MCP action block (same pattern as check-rpc-security.sh and check-db-schema.sh —
  outputs text that Claude must then execute via Supabase MCP). Output:

  ```
  ACTION: execute_sql
  description: EV leak check — confirm all _e2e_* rows were rolled back
  query:
  SELECT
    (SELECT count(*)::int FROM venues       WHERE id   LIKE 'v_e2e_%')     AS venues,
    (SELECT count(*)::int FROM leagues      WHERE id   LIKE 'l_e2e_%')     AS leagues,
    (SELECT count(*)::int FROM seasons      WHERE id::text LIKE '%e2e%')   AS seasons,
    (SELECT count(*)::int FROM teams        WHERE id   LIKE '%e2e%')       AS teams,
    (SELECT count(*)::int FROM players      WHERE id   LIKE 'p_e2e_%')     AS players,
    (SELECT count(*)::int FROM player_match WHERE match_id LIKE '%e2e%')   AS player_match_rows,
    (SELECT count(*)::int FROM audit_events
       WHERE created_at > now() - interval '5 minutes'
         AND (metadata->>'home_team_id' LIKE '%e2e%'
           OR metadata->>'away_team_id' LIKE '%e2e%'))                     AS audit_rows;

  EXPECTED: every column = 0. Non-zero = rollback failed. STOP and restore before continuing.
  ```

  Make executable (chmod +x).

  PART B — Edit `skills/ephemeral-verify.md` STEP 5 (the leak check section).
  Replace the raw SQL block currently in STEP 5 with a reference to the script:
  "Run `bash skills/scripts/check-ev-leak.sh` and then execute the output via Supabase MCP execute_sql.
  Every column must return 0. Non-zero means rollback failed."
  Preserve the rest of STEP 5 content (the STOP and restore instruction).
- tier-3 touch: none
- proof: `bash skills/scripts/check-ev-leak.sh` outputs the ACTION block without errors;
  ephemeral-verify.md references the script in STEP 5; check-build.sh passes
- PR:

### P4 — pre-commit-build.sh: migration numbering + rpc-columns guard
- status: done
- deps: P2 (check-next-migration.sh must exist before this hook calls it); P1 merged
- goal: Augment `.claude/hooks/pre-commit-build.sh` with two new gates that run only
  when migration files are staged. Insert them BETWEEN Gate 1 (down-file check) and
  Gate 2 (build check), so they run in sequence: down-file → numbering → rpc-columns → build.

  **Gate 1b — migration number check:**
  After the MISSING_DOWN check, for each file in STAGED_MIGS, call:
  `bash "$ROOT/skills/scripts/check-next-migration.sh" "$MIG"`
  If it exits 2 (CONFLICT), surface the error message and exit 2.

  **Gate 1c — rpc-columns check for RPCs defined in staged migrations:**
  After Gate 1b, for each file in STAGED_MIGS, grep the file for
  function names using: `grep -oE 'FUNCTION\s+[a-z_]+' "$ROOT/$MIG" | grep -oE '[a-z_]+$'`
  For each unique function name found, run:
  `bash "$ROOT/skills/scripts/check-rpc-columns.sh" "$FN_NAME"`
  If check-rpc-columns exits non-zero, surface its stderr and exit 2.
  If no function names are found in a migration file, skip Gate 1c silently.

  Keep all existing comments and exit-code conventions. Do not alter Gate 1 (down-file)
  or Gate 2 (build) — only insert the two new gates between them.
- tier-3 touch: none
- proof: the hook script passes `node --check` is not applicable (bash);
  grep confirms `check-next-migration.sh` appears in the hook;
  grep confirms `check-rpc-columns.sh` appears in the hook;
  check-build.sh passes
- PR:

### P5 — skills/commit.md: BUGS.md awareness step
- status: done
- deps: none
- goal: Add a new STEP 6b to `skills/commit.md` between STEP 6 (UPDATE DOCUMENTATION)
  and the AFTER COMMIT section. Call it "STEP 6b — BUGS.md MATCH CHECK".

  Content of the new step:
  ```
  ## STEP 6b — BUGS.md MATCH CHECK

  After staging and committing, grep BUGS.md for any open bug whose description
  contains the commit's scope or key terms from the commit message. Run:

      grep -i "<scope>" BUGS.md

  where <scope> is the parenthetical from the commit type (e.g. "rpc", "auth", "squad").
  Also grep for the 2-3 key nouns from the commit description.

  If any open bug entries match:
  - List the matching bug entries
  - Say: "The following open bugs may be resolved by this commit. If so, run
    skills/post-incident.md to close them and update BUGS.md, DECISIONS.md, and CONTEXT.md."
  - Do NOT automatically close the bugs — wait for developer confirmation that the
    bug is actually fixed.

  If no matches: state "No open BUGS.md entries matched this commit scope."
  ```
- tier-3 touch: none
- proof: grep confirms the new step appears in skills/commit.md; check-build.sh passes
- PR:

### P6 — /decide skill: scope-to-build bridge
- status: done
- deps: none
- goal: Create `.claude/skills/decide/SKILL.md`. This is a new slash command skill
  that bridges /scope (which produces a HANDOFF.md) and /dev-loop (which builds it).

  The skill should:

  **Trigger:** operator types `/decide <HANDOFF_FILE>` or `/decide` (which looks for
  the most recent *_HANDOFF.md in the repo root).

  **Steps:**
  1. Read the named HANDOFF.md in full.
  2. Extract: feature name, key architectural decisions made, phase list with
     migration numbers if any, tier classification.
  3. DECISIONS.md update: append a new dated entry summarising the feature decision
     (what was decided and why, drawn from the HANDOFF.md rationale section).
     Format: `## [date] — [feature name]\n[2-3 sentence rationale]\nHandoff: [filename]`
  4. FEATURES.md update: find the feature in FEATURES.md (or add it if absent) and
     mark it as "scoped / ready to build" with the date and a reference to the HANDOFF.md.
  5. Report: print a summary of what was updated.
  6. Offer: "Ready to launch. Say 'proceed' to run `/dev-loop` on P1 of this manifest,
     or 'loop' to run the full epic unattended via `/loop /dev-loop <HANDOFF_FILE>`."
  7. Wait for operator confirmation before launching anything.

  The skill is read-only until step 3/4 (writing to DECISIONS.md and FEATURES.md).
  It never calls dev-loop automatically — it stops at step 6 and waits.

  Also: add an entry for `/decide` in CLAUDE.md under the "Skills directory" section,
  after the `/backlog` entry. One line: `- '.claude/skills/decide/SKILL.md' — scope-to-build
  bridge. Reads a HANDOFF.md, updates DECISIONS.md + FEATURES.md, then offers to launch dev-loop.`
- tier-3 touch: none
- proof: file exists at `.claude/skills/decide/SKILL.md`;
  CLAUDE.md references it in the skills directory section;
  check-build.sh passes; check-hygiene.sh is not applicable (no .js files)
- PR:

### P7 — Nightly qa-loop cloud trigger
- status: done (trigger trig_015Q8dEJC9Z9QzmqpRa1b7Wj, created 2026-06-30, first run 2026-07-01 07:06 UTC)
- deps: none (independent of code changes)
- tier-3 touch: outward — creates a live scheduled cloud job
- goal:
  PART A — Create the cloud trigger via `mcp__claude_ai_Claude_Code_Remote__create_trigger`:
  - name: "Nightly QA — In or Out platform"
  - cron_expression: "0 7 * * *"  (07:00 UTC daily — early morning before dev sessions)
  - create_new_session_on_fire: true
  - prompt (standalone, self-contained — this session starts fresh):
    ```
    You are running a scheduled automated QA pass on the In or Out platform monorepo
    at /Users/tarny/platform. Branch: main.

    Run /qa-loop scripted on the monorepo. This scope runs the deterministic regression
    net only: node --check syntax, check-hygiene.sh, check-build.sh (Vite compile for
    all 8 apps), and qa-suite.sh (Playwright e2e, cold-isolated, flake-quarantined).

    Triage all findings:
    - T1/T2 (one objectively-correct fix, check-live-config CLEAR): auto-fix via /dev-loop,
      re-test, report "FIXED: <description>"
    - T3 (tier-3 = migration/RLS/auth/money, or requires product decision): surface in
      plain English as "ACTION NEEDED: <description>"

    After the pass is complete:
    - Append any new T3 findings to BUGS.md under a dated section
    - Append any new T3 findings to GO_LIVE_ISSUES.md
    - Report a summary: "NIGHTLY QA [date]: N tests run, N passed, N T1/T2 fixed, N T3 surfaced"

    Do not merge PRs from auto-fixes — leave them as open PRs for review.
    Do not touch production data. Use scripted scope only (no supervised browser walk).
    ```
  - notifications: {push: true} — so the operator gets a push notification when the
    nightly run finishes

  PART B — Record the trigger in CONTEXT.md. Add a new section if one doesn't exist,
  or append to the existing infrastructure section:
  ```
  ## Scheduled Triggers
  | Name | Trigger ID | Schedule | Created |
  |---|---|---|---|
  | Nightly QA | trig_XXXX | 0 7 * * * (07:00 UTC daily) | 2026-06-30 |
  ```
  Replace trig_XXXX with the actual trigger ID returned by the MCP call.

  Commit CONTEXT.md with the trigger ID so it's not lost.
- proof: MCP call returns a trigger_id; CONTEXT.md contains the trigger ID;
  check-build.sh passes
- PR:

## Log
<!-- one line per phase outcome: date · phase · result · PR# -->
2026-06-30 · P1–P6 · done · PR #TBD
2026-06-30 · P7 · done · trigger trig_015Q8dEJC9Z9QzmqpRa1b7Wj created (nightly QA, 07:00 UTC)
