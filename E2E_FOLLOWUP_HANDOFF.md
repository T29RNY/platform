# E2E follow-up — 3 fixes queued for next session

Found during the session-153 exhaustive e2e sweep (see `E2E_HANDOFF.md` for the
suite, `BUGS.md` SESSION 153 for the log). All three are scoped + located; none are
fixed yet. Two are cosmetic, **one (#3) is a real reproducible bug**.

Run each through AUDIT → EXECUTE → VERIFY → COMMIT. Add a Playwright spec for each
fix to the existing suite so it stays proven (the suite is the regression net now).

---

## #3 — REAL BUG: "My Squads" hides other squads when sign-ups aren't open

**Symptom:** a multi-squad player (e.g. Alex — admin of 5-a-Side FC, player of
Competitive FC) opens the consumer home, expands **MY SQUADS**, and sees
"Not part of any other squads yet" — even though they belong to 2+ squads.

**Root cause (confirmed):** `apps/inorout/src/views/PlayerView.jsx:1622`
```js
<MySquads currentToken={myId && squad.find(p => p.id === myId)?.token} ... />
```
`squad` is *this week's matchday squad*. When sign-ups aren't open yet it's **empty**,
so `squad.find(p => p.id === myId)` returns `undefined` → `currentToken` is falsy →
`MySquads`'s `useEffect` early-returns (`if (!currentToken) return;`) → `squads`
stays `[]` → the empty-state copy. The data layer is fine: the RPC
`player_get_teams_by_token('p_demo_alex_token')` returns BOTH squads.

**Fix direction:** derive `currentToken` from the player's own identity, not the
matchday squad — e.g. the route/player token already held in PlayerView (`me.token`
or the `token` prop), falling back to the squad lookup only if needed. Confirm the
prop PlayerView already has a stable self-token before wiring.

**Spec to add (tokens or inorout-alex project):** load `/p/p_demo_alex_token`, expand
MY SQUADS, assert "Competitive FC" appears (the cross-squad row).

---

## #1 — Cosmetic: `/classes` "No venue linked" shown for the no-club-selected state

**Symptom:** a member of 2+ clubs lands on `/classes` with no `?club=` param and sees
"No venue linked to this club yet." — which reads like a data error, but is really the
*no club selected* state (the club chips at the top are the selector).

**Location:** `apps/inorout/src/views/ClassesScreen.jsx`
- `pickClub` (L26) returns `null` for 2+ clubs when there's no `?club=` param.
- L145 renders "No venue linked to this club yet." whenever `venues.length === 0`,
  which conflates (a) no-club-selected with (b) selected-club-has-no-venue.

**Fix direction (pick one in audit):**
- (a) distinct copy: if `!selectedClubId` → "Pick a club above to see its classes.";
  else keep "No venue linked…", **or**
- (b) auto-select the first club in `pickClub` (deep-links via `?club=` already win,
  so this only changes the default landing). (a) is lower-risk.

**Spec:** `/classes` with 2 clubs and no param → assert the pick-a-club copy (not the
data-error copy); `/classes?club=club_demo_box` → timetable renders (already covered).

---

## #2 — Cosmetic: paused membership pass shows "Frozen until 1 Jan 1970"

**Symptom:** a paused membership with no freeze-until date renders the epoch.

**Location:** `apps/inorout/src/views/MemberPass.jsx:125-127`
```js
{pass.status === "paused" ? "Frozen until" : ...}
<strong>{fmtDate(pass.status === "paused" ? pass.frozen_until : pass.renews_at)}...</strong>
```
`fmtDate(null)` → "1 Jan 1970". The seed sets `status='paused'` with no freeze record,
which is a legitimate "paused indefinitely" state.

**Fix direction:** when `pass.frozen_until` is null/absent, render just "Frozen" (no
date) — or "Frozen · no end date". Keep the dated form when a freeze-until exists.

**Spec:** `/m/<sam-paused-pass>` → assert "Frozen" with NO "1970" present.

---

## Paste-ready next-session prompt

```
Pick up the 3 e2e follow-up fixes in E2E_FOLLOWUP_HANDOFF.md, in this order:
#3 (real bug: My Squads hides other squads when the matchday squad is empty —
PlayerView.jsx:1622 derives currentToken from the empty squad), then #1 (ClassesScreen
no-club-selected copy), then #2 (MemberPass "Frozen until 1 Jan 1970" epoch).

For EACH: run AUDIT → EXECUTE → VERIFY → COMMIT per CLAUDE.md. These touch
apps/inorout/src only (no RPC/schema changes expected — confirm in audit). After each
fix, ADD a Playwright spec to e2e/specs/ that reproduces the bug and now passes, and
re-run the affected project green (harness + auth injection already built; see
E2E_HANDOFF.md "Coverage (session 153)" for project names/ports). Demo accounts:
alex = tarny+demo@lettrack.co.uk / DemoBoss1!, sam = tarny+family@lettrack.co.uk /
DemoFam2! (DEMO_USERS.md). #3 reproduces as Alex (empty current-week squad);
#2 as Sam (paused boxing pass m_8289db16b6ef4386abaf39c294a828cd).

Hard rule #13: all three touch PWA-affecting consumer files — a real-iPhone walk is
owed before these are considered done. Next free mig = 367 (none expected for these).
```
