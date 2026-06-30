# SKILL: Commit
## Step 4 of AUDIT → EXECUTE → VERIFY → COMMIT → POST-DEPLOY

Triggered when: developer approves verify output.
Mode: normal mode.
Exit condition: push confirmed, working tree clean, docs updated.
Gate: DEVELOPER MUST CONFIRM verify output before this step starts.

---

## PURPOSE

Lock the change into version control cleanly. A commit that
includes unintended files, uses a vague message, or skips
documentation updates creates future confusion.

---

## STEP 1 — REVIEW WHAT WILL BE COMMITTED

Before staging anything, run:

```
git diff
git status
```

Read the full diff. Confirm:
- Every changed file was part of the agreed execute scope
- No unintended files are modified (`.env`, generated files, etc.)
- No debug code or console.log was left in
- No partial changes (half-finished execute parts)

If anything unexpected appears in the diff: stop.
Report it to the developer before staging anything.

---

## STEP 2 — STAGE SPECIFIC FILES

Stage the files that changed — do NOT use `git add -A` or `git add .`.
Name each file explicitly:

```
git add apps/inorout/src/views/SomeScreen.jsx
git add packages/core/storage/supabase.js
git add packages/core/index.js
```

Why: `git add -A` risks accidentally staging `.env` files,
build artefacts, or other sensitive files that should never
be committed.

---

## STEP 3 — COMMIT

Use the `type(scope): description` format:

```
git commit -m "$(cat <<'EOF'
type(scope): short description of what changed and why

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

**type:** `fix` / `feat` / `refactor` / `chore` / `docs` / `security`
**scope:** the area of the codebase (e.g. `rpc`, `squad`, `auth`, `payments`)
**description:** one line, present tense, lowercase

Good: `fix(rpc): remove stale is_vice_captain refs from 10 write RPCs`
Good: `feat(squad): add priority toggle with admin_set_player_priority RPC`
Bad: `updated some things` / `fix bug` / `WIP`

The description should say WHY the change was made, not just WHAT.
The diff already shows what — the message explains the reason.

---

## STEP 4 — PUSH

```
git push
```

Do not force push. If push is rejected: report to developer immediately.
Do not attempt to resolve a rejected push without explicit instruction.

---

## STEP 5 — CONFIRM

After push:

```
git status
git log --oneline -3
```

Report:
- Working tree is clean (no modified or staged files)
- Commit hash (first 7 characters)
- Commit message

Format:
```
Committed and pushed.
Hash: abc1234
Message: fix(rpc): remove stale is_vice_captain refs from 10 write RPCs
Working tree: clean
```

---

## STEP 6 — UPDATE DOCUMENTATION

Apply hard rule 8: update any of the following that are affected.

**BUGS.md** — if a bug was resolved:
- Move the bug from active to "RESOLVED THIS SESSION"
- Include: root cause, fix approach, commit hash
- Update the header date

**FEATURES.md** — if a feature shipped:
- Mark it as complete in the phase tracker
- Note the commit hash

**DECISIONS.md** — if an architectural decision was made:
- Add an entry with date, decision, and rationale

**CONTEXT.md** — if schema, RPCs, or infrastructure changed:
- Update the relevant section
- Add a session note with date and summary

If none of the above apply: state explicitly "No documentation updates needed."

---

## STEP 6b — BUGS.md MATCH CHECK

After staging and committing, grep BUGS.md for any open bug whose description
contains the commit's scope or key terms from the commit message. Run:

    grep -i "<scope>" BUGS.md

where `<scope>` is the parenthetical from the commit type (e.g. "rpc", "auth",
"squad"). Also grep for the 2-3 key nouns from the commit description.

If any open bug entries match:
- List the matching bug entries
- Say: "The following open bugs may be resolved by this commit. If so, run
  `skills/post-incident.md` to close them and update BUGS.md, DECISIONS.md,
  and CONTEXT.md."
- Do NOT automatically close the bugs — wait for developer confirmation that
  the bug is actually fixed.

If no matches: state "No open BUGS.md entries matched this commit scope."

---

## AFTER COMMIT

Say:
```
Committed and pushed. Ready to run post-deploy checks
against the live site. Confirm when ready.
```

Do not begin post-deploy until the developer says proceed.

---

## READ NEXT
skills/post-deploy.md — begin only after developer confirms.
