# SKILL: Casual-Flow Regression Check
## Verify the casual inorout experience is unchanged after a competitive cycle

Triggered when: any cycle that touches `apps/inorout/src/` or
`packages/core/storage/supabase.js` for League Mode work
(Phase 5 onwards), OR any change that adds render-gated logic
to a high-traffic player surface.

Mode: read-only browser + grep. No edits.
Exit condition: every casual-flow surface listed below renders
and behaves identically to the pre-cycle baseline.

---

## PURPOSE

The inorout app is the production application real users rely on
every day. Phase 5 introduces competitive surfaces inside the same
codebase. The "casual flow is sacred" constraint requires explicit,
repeatable verification — not vigilance.

Without this check, a render-gating mistake, an accidental import
side-effect, or a CSS specificity collision could silently break
the experience for the much larger casual user base.

---

## STEP 1 — IDENTIFY CASUAL-FLOW SURFACES TOUCHED

Run from the repo root:

```
git diff --name-only HEAD~1 HEAD | grep -E 'apps/inorout/src/|packages/core/'
```

Cross-reference each changed file against the casual surface
inventory below. Any overlap means a regression test is required
on that surface.

**Casual-flow surface inventory** (all under `apps/inorout/src/views/`):

| Surface | File | What to verify |
|---|---|---|
| In/out flow (default tab) | `PlayerView.jsx` (my-view branch) | StatusBadge, in/out tap, optimistic UI, status colour transitions, vibration haptic |
| My Squads accordion | `MySquads.jsx` | Open/close, ADMIN pill, CURRENT pill, NO LONGER ACTIVE pill, tap-to-switch |
| Stats tab | `StatsView.jsx`, `PlayerLeagueTable.jsx`, `HeadToHead.jsx` | Tab loads, player league table renders, period switcher, H2H modal |
| History tab | `HistoryView.jsx` | Match list, POTM votes, score display |
| My IO tab | `MyIOView.jsx` | All unlock cards, animations, IO Intelligence sections |
| Sign-in flow | `SignIn.jsx`, `AuthCallback.jsx` | Magic link, OTP entry, post-auth redirect |
| Join flow | `JoinTeam.jsx`, `JoinSuccess.jsx` | New-team form, success state |
| Player profile | `PlayerProfile.jsx` | Avatar, nickname edit, account delete |
| POTM voting modal | `POTMVotingModal.jsx` | Vote casting, tiebreak path |
| Email capture overlay | `EmailCaptureOverlay.jsx` | Auto-trigger conditions, dismiss, save |
| Install banner | `InstallBanner.jsx`, `PWAWelcome.jsx` | iOS hint, Android prompt, dismiss |
| Admin schedule | `AdminView/ScheduleScreen.jsx` | Week pagination, open/close week, lock-in |
| Admin squad | `AdminView/SquadScreen.jsx` | Add/remove player, reorder, nicknames |
| Admin score | `AdminView/ScoreScreen.jsx` | Score entry, POTM nomination, save |
| Admin reminders | `AdminView/RemindersScreen.jsx` | Send reminder, template preview |
| Admin payments | `AdminView/PaymentsScreen.jsx` | Mark paid, balance display, ledger |
| Admin bibs | `AdminView/BibsScreen.jsx` | Bib generation, history |
| Admin teams | `AdminView/TeamsScreen.jsx` | Team-A/Team-B picker, save |
| Admin announce | `AdminView/AnnounceModal.jsx` | Post announcement, schedule |
| Game switcher | `GameSwitcher.jsx` | Past-game navigation, current-game pin |

---

## STEP 2 — TWO-TOKEN SMOKE TEST

The casual regression test requires TWO player tokens to be
distinct from any competitive test:

1. **Casual-only player token** — a player whose team has NEVER
   been registered in any `competition_teams` row.
   - For demo: any player on `team_demo_echo` (Echo Wanderers
     was deliberately left as pending+casual in the demo seed,
     mig 110 line 159).
   - For production: any real Footy Tuesdays member.

2. **Casual-on-a-different-squad-but-also-competitive-on-another**
   token — covers the multi-squad case where the same player
   belongs to one casual + one competitive team. Phase 5 must
   show competitive surfaces only when the competitive squad is
   the active context.

For each token, open `https://www.in-or-out.com/p/<token>` and
walk every surface listed in Step 1 that overlaps with the
files changed in this cycle.

---

## STEP 3 — DEVTOOLS CONSOLE CHECK

While walking each surface:

- Console must show ZERO new errors that weren't there before
  the cycle.
- Console must show ZERO new warnings tied to the changed files.
- Network tab: no new failing requests. Specifically, no calls
  to RPCs that should be gated behind `is_competitive=true`.

If new RPC calls fire on a casual-only token, the render-gating
is leaking. STOP and fix before commit.

---

## STEP 4 — SCREENSHOT DIFF (mandatory for cycles touching MySquads, PlayerView)

Before the cycle starts, take a baseline screenshot of every
surface in Step 1 that will be touched. After the cycle, take
the matching after-screenshot.

Compare side-by-side. The ONLY visual difference permitted on
a casual-only token is: no visible difference at all.

Save before/after pairs into `/.playwright-mcp/` or any temp
location. Delete after the cycle commits.

---

## STEP 5 — REAL-DEVICE TEST (hard-rule #13 + extension)

Hard-rule #13 covers PWA-affecting changes. For Phase 5, the
real-device test extends to:

- Open the app on an iPhone (or Android) installed from the
  home screen.
- Use the casual-only player token.
- Walk through 5 actions: tap "in", tap "out", tap a different
  squad in MySquads, navigate to Stats tab, navigate to My IO tab.
- No new errors, no layout shift, no broken interactions.

This catches "tap does nothing" and "layout breaks on small
viewport" bugs that desktop browser testing misses (per the
session-43 PWA incident lineage).

---

## STEP 6 — REPORT

Output format:

```
CASUAL-FLOW REGRESSION CHECK: [cycle name]

FILES CHANGED IN SCOPE:
  [list of apps/inorout/src/ and packages/core/ files]

CASUAL SURFACES VERIFIED:
  [surface]: PASS / FAIL [observation if fail]
  ...

DEVTOOLS CONSOLE:
  Errors:   [count, must be zero]
  Warnings: [count, must be zero new]
  Leaked RPC calls: [list, must be empty]

REAL-DEVICE TEST:
  Device: [iPhone X / Pixel Y / etc]
  Token: [casual-only token used]
  Result: PASS / FAIL [observation if fail]

OVERALL: PASS / FAIL
```

If OVERALL = FAIL: do NOT proceed to commit. Fix the regression,
re-run the full check, report again.

---

## WHY THIS SKILL EXISTS

Phase 5 Plan, locked operating constraint #1:
> "Casual flow is sacred. No change visible to a casual-only
> user, ever."

That constraint is unenforceable without a procedure. This
skill IS the procedure. It is mandatory for any Phase 5+ cycle
that touches `apps/inorout/src/` or `packages/core/`.

---

## READ NEXT
skills/commit.md — proceed only after OVERALL = PASS.
