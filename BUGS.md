# In or Out — Known Bugs & Tech Debt
*Last updated: May 26 2026 (session 47 — VC parity sweep on player-token state RPC + Live Board dedupe + OTP UX bundle)*

**Read this at the start of every session before touching any code.**

> For the operator-facing pre-onboarding pre-flight (every production
> issue grouped by failure domain with a device-level check for each),
> see **`GO_LIVE_ISSUES.md`**. New production issues must be added there
> in the same commit as the fix.

---

## RESOLVED — Live Board: privileged caller (VC/admin) appears twice on their own MyView (session 47)

**Symptom:** Tarny (VC of Footy Tuesdays) reported he appeared twice
on his own MyView Live Board on game day. Screenshots from other
teammates correctly showed Tarny once. Two side-by-side cards for
him on his team column.

**Root cause:** Migration 080 (this session) changed
`get_team_state_by_player_token` so privileged callers (VCs and
team admins) get the caller's own row included in `state.squad` with
`is_self=true` — needed so AdminView features read all rows
uniformly. App.jsx (five sites) still unconditionally prepended
`state.player` on top of `state.squad`, written before mig 080 when
the caller was always excluded. Result for privileged callers: the
client squad contained two entries with the same `id`, the Live
Board render had no dedupe by id, both passed `status='in'` + team
filters, both rendered. Confirmed via live DB: only 1 `team_players`
row for Tarny on this team; the duplicate was purely client-side.

**Fix:** new `buildPlayerSquad(player, squad)` helper in App.jsx —
finds the caller's row in `state.squad`, merges its fields onto
`state.player` (gaining `group_number` + `is_self`, preserving
`user_id` which the squad-row jsonb_build_object lacks), then
filters the duplicate from the squad. No-op for ordinary players
(server still excludes them). Applied at all five prepend sites:
initial load, postgres_changes refresh, broadcast refresh, and
both `computeDeeperIntel` calls. Commit `8f30b67`.

**Lesson:** any RPC change that adds the caller's row to a list it
was previously excluded from creates a duplicate-on-client trap for
every site that prepends the caller. Cross-check call sites of any
collection the RPC return-shape now includes.

---

## RESOLVED — Player-token state RPC missed payments / locks / stats / groups for VCs and admins (session 47)

**Symptom:** Tarny (VC) on his /p/ route couldn't see groups persist
on reopen (the morning's primary complaint) and downstream — payment
badges blank, locked-in shields missing, stats columns zero, POTM
tally counts missing on the squad leaderboard. Other admins running
AdminView via their /p/ link would have hit the same. Server data
was correct; client display was hobbled.

**Root cause:** `get_team_state_by_player_token` (mig 071, "no
financial/stats") was deliberately limited for ordinary-player
privacy. The mig 075 VC parity sweep made VCs/admins able to *write*
admin_* RPCs via their player_token, but didn't broaden the
*read* RPC. So VCs running AdminView via /p/ saw saves succeed
server-side and silently fail to display on reload.

**Fix (mig 080 — `get_team_state_by_player_token` VC parity):**
when `v_privileged` (VC or team admin) is true, return the full
admin-shape squad including `group_number`, `paid`/`owes`/
`self_paid`/`paid_by`/`pay_count`, `goals`/`motm`/`attended`/
`total`/`w`/`l`/`d`, `late_dropouts`/`injured_since`,
`admin_locked_in`, `token`, plus the caller's own row with
`is_self=true`. Ordinary players keep the existing limited shape
(no privacy regression). Also adds `group_labels` to settings
unconditionally. JS wrapper `getTeamStateByPlayerToken` updated to
read `group_labels`. Commit `500ec6e`.

**Companion (mig 079 source-of-truth):** an out-of-band hotfix was
applied to the live DB at 12:38 UTC from a mobile/cloud Claude
session — it restored `group_number` + `group_labels` to
`get_team_state_by_admin_token` (silently dropped in mig 070). The
cloud session couldn't write the migration file. Same commit
(`500ec6e`) captures the source verbatim so the repo matches deploy
per rule #11.

**Lesson:** see new DECISIONS.md entries on (a) cloud-session source
control and (b) read-RPC return shape must match the privilege
profile of writes that have already been granted.

---

## RESOLVED — submit_potm_vote silent for anon clients; admin_upsert_schedule overload trap (session 47)

**Symptom (vote):** anon-token admins (and players on /p/) would
not see live POTM tally updates after a player voted. Authenticated
clients picked it up via the `matches` postgres_changes subscriber,
but anon clients depend on the `team_live` broadcast channel which
`submit_potm_vote` never fired.

**Symptom (schedule overload):** none yet — latent trap. Any future
caller that omits `p_game_is_live` would have silently routed to the
stale 13-arg overload that doesn't update the live flag.

**Root cause (vote):** `submit_potm_vote` writes `potm_votes` +
audits but lacked the `PERFORM notify_team_change(...)` call that
every other write RPC has. Regression against rule #10 (realtime
publisher/subscriber pairing).

**Root cause (schedule):** `admin_upsert_schedule` had two
overloads in pg_proc — original 13-arg + a 14-arg version added
when `p_game_is_live` was introduced. Two overloads also fails the
`rpc-security-sweep` (overload_count must be 1).

**Fix (mig 081 — RPC sweep cleanup):** added
`notify_team_change(p_team_id, 'potm_vote_cast')` to
`submit_potm_vote`. Dropped the 13-arg `admin_upsert_schedule`
overload. Same migration also dropped four genuinely-dead RPCs
confirmed zero-callers in the repo:
`player_create_cash_payment_entry`, `unregister_push_subscription`,
`admin_set_player_note`, `join_team_as_returning_player`. Down-
migration restores all four verbatim. Commit `4481103`.

**Audit note:** the Explore agent initially flagged 9 RPCs as
"dead". Cross-checking against actual call sites cut the list to 4 —
`set_player_paid`, `set_player_injured`, `set_guest_payment`, and
`closePOTMVoting` were all wired and called (engine/payments.js,
POTMTiebreakModal.jsx). Lesson: agent dead-RPC findings are a
starting point, not a verdict. Always grep call sites yourself before
dropping anything.

---

## RESOLVED — Sign-in OTP "expired or invalid" UX trap (session 47)

**Symptom:** Tarny was prompted to sign back into the PWA, requested
a code, typed it, got "token has expired or invalid". Tried again,
same error.

**Root cause (per Supabase auth logs, parallel investigation):** two
distinct failures.
1. **Attempt 1** — 63 min elapsed between `/otp` (200) and `/verify`
   (403). Supabase default OTP TTL is ~60 min, so the code had
   genuinely expired.
2. **Attempt 2** — only 13 seconds between re-requesting and re-
   verifying. The new email hadn't arrived; Tarny typed the OLD
   code (from screen/memory) into the input the modal failed to
   clear.

Not a code bug — both are UX gaps. Other users in the same window
(psnagra, aaronmanak) verified in 13–30s and succeeded cleanly.

**Fix:** AuthGateModal.jsx bundle of best-practice OTP UX —
- `sentAt` captured on every successful `/otp`; code stage shows
  "Sent at HH:MM · expires within an hour".
- `sendCode` clears the code input on every send (kills the
  stale-code-typed-on-top failure).
- 20s resend cooldown; new in-place "Resend code" button on the
  code stage shows "Resend in Ns" then enables. Removes the
  back-out-via-Use-a-different-email detour.
- Verify failures set a structured error that the UI renders
  with "→ Tap Resend code below to get a fresh one." pointing
  to the recovery path.
- Rate-limit (HTTP 429 / rate-limit message) surfaces a specific
  "Too many requests — wait a minute" instead of generic copy.

State machine and Supabase API call shape unchanged. Commit
`fe26596`.

**Out of scope (not done):** Supabase email-template tweak to drop
the magic-link half of the "Magic link or OTP" template (would
close a separate attack surface: link-prefetchers consuming the
token before user types code). Dashboard change, not code.

---

## RESOLVED — Group Balancer "Failed to save group" for anon/VC callers (session 46)

**Symptom:** rockybram opened Admin → Make Teams immediately after
the mig 077 fix and tried to assign players to groups. Every tap
(player → group panel) reverted instantly with the red error
"Failed to save group — try again". Every other admin action on
his squad (live toggle, status edits, schedule edits) worked.

**Root cause:** `admin_set_player_group` and `admin_clear_all_groups`
were the only two `admin_*` RPCs whose grants excluded `anon`. Mig
031 set them up as authenticated-only at the dawn of the Group
Balancer feature. The session-45 "blanket VC = owner parity" sweep
(mig 075) rewrote function bodies via `resolve_admin_caller` so
they'd accept either an admin_token or a VC's player_token — but
that sweep explicitly did not touch grants. The anon revoke from
mig 031 was inherited unchanged. Rockybram's session was anon
(token-only admin, no JWT) → PostgREST rejected the call at the
grant layer before the RPC body ran → client showed the generic
error.

Direct MCP call (role `postgres`, bypasses grants) returned
`{ok: true}` and wrote an `audit_events` row, confirming the body
and data were healthy. Only the grant blocked PostgREST callers.
VCs on the same team (e.g. Gurnam) had the same problem — a strict
regression against the session-45 parity rule.

**Fix (mig 078):**
```sql
GRANT EXECUTE ON FUNCTION admin_set_player_group(text,text,int) TO anon;
GRANT EXECUTE ON FUNCTION admin_clear_all_groups(text)          TO anon;
```
Two-line grants-only migration. No client changes, no body changes.

**Lesson:** the session-45 sweep regex updated function definitions
but didn't touch GRANT statements. Any future parity sweep needs
to enumerate and audit grants too, not just function bodies.

---

## RESOLVED — Brand-new squad first go-live silently breaks Make Teams (session 46)

**Symptom:** rockybram signed up a brand-new squad "Footy Tuesdays"
for tonight's match (2026-05-26 20:00), flipped the live toggle, and
Admin → Make Teams showed "No active match — go live first before
picking teams". Players' surfaces correctly showed the game as live
(they read `schedule.game_is_live`), but anything keyed off the match
ID (Make Teams, POTM voting, payment confirmation, save-teams) was
broken because `schedule.active_match_id` was NULL and no `matches`
row existed.

**Root cause:** `admin_upsert_schedule` (mig 013) sets `game_is_live=
true` but never inserts a matches row or sets `active_match_id`. Only
`admin_reopen_week` (mig 032) did that, and only on the cancel→relive
path. For a brand-new squad's first-ever go-live, `active_match_id`
stayed NULL forever. Latent since mig 032 landed; every prior team
escaped because they had seeded fixtures (demo) or had cycled through
Cancel→Relive at some point.

**Fix (mig 077 — `admin_go_live` RPC):** dedicated sibling of
`admin_reopen_week` minus the cancel-clearing semantics. Inserts a
fresh `matches` row when `active_match_id` is NULL or stale, sets
`game_is_live=true`, `is_draft=false`, `active_match_id`. Idempotent
(returns `reused_existing=true` on re-tap). Audits as `week_opened`.
Routes:
- `AdminView/index.jsx openNextWeek` non-cancelled branch now calls
  `goLive` instead of `upsertSchedule` for the live flip.
- `ScheduleScreen.jsx` save path detects `gameIsLive` flipping false→
  true on a non-cancelled schedule and calls `goLive` before
  `upsertSchedule`.

**rockybram unblocked manually 2026-05-26** by calling
`admin_reopen_week('admin_0OcDVOpcoGnujleetMhGYw')` — generated match
`m_ua2IxB14ch8` for today's game. Confirmed idempotency of the new
RPC by calling `admin_go_live` against the same team afterwards:
returned `reused_existing=true`, same `match_id`, no duplicate row.

---

## OPEN — Superadmin dashboard returns blank screen (session 45 close)

**Symptom:** opening
`https://platform-superadmin-djj9b1w8x-tarny-s-projects.vercel.app`
(after clearing the Vercel SSO gate) shows a blank white page. No
visible error. React never mounts.

**Root cause:** the `platform-superadmin` Vercel project has no
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env vars set. The
last production deploy (`dpl_GARou7F38HemDuLgB18k8NESjkg1`,
commit `7547d49`) was a prebuilt push from a local directory whose
`.env.production.local` was also missing those vars. Result:
`packages/core/storage/supabase.js:4-5` reads `undefined` →
`createClient(undefined, undefined)` throws at module init →
React root fails to mount → blank document.

**Compounding issue:** `apps/superadmin/.vercel/project.json` is
locally linked to the `platform-clubmanager` project (the main
inorout app), not `platform-superadmin`. Any `vercel deploy` from
that directory currently targets the wrong project. This is part
of why the envs never made it to the right place — every
`vercel env pull` was pulling from `platform-clubmanager`'s envs
into a directory whose deploy target was also `platform-clubmanager`.

**Resume here next session:**

1. Vercel UI → `platform-superadmin` → Settings → Environment
   Variables → add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` for Production + Preview + Development.
   Copy values from `platform-clubmanager`'s same vars.
2. `cd apps/superadmin && vercel link --project platform-superadmin`
   (overwrites the wrong linkage).
3. `vercel env pull .env.production.local --environment production`
   — confirm the two VITE vars now appear in the file.
4. `npm run build` from `apps/superadmin/`.
5. `vercel deploy --prebuilt --prod --yes`.
6. Reload the URL. Should land on the Supabase auth sign-in. Sign
   in with `tarnysingh@gmail.com` (granted via migration 076) or
   `tarny@desicity.com` (original seed).
7. Activity tab should show today's session-45 audit rows —
   `actor_type='vice_captain'` from tarny's parity verification
   sitting alongside the usual `team_admin` rows. That's the
   confirmation the dashboard is live and the audit-trail
   differentiation from the VC=admin sweep is observable.

**Why this didn't block beta:** the dashboard is operator-only
(gated by `is_platform_admin()`). End-users have never needed it.
The blank screen is invisible to them; it's only an operator
inconvenience.

---

## RESOLVED 2026-05-26 (session 45, post-sweep) — Production data residue from the VC-parity verification

**Surfaced by:** tarny noticing on Footy Tuesdays (team_KPaoX8oJYMQ)
that Bally's row showed `nickname='TempNick'` and `status='in'`
without him having touched the app, and that an earlier intentional
VC promotion of Bidz had silently disappeared.

**Root cause:** The VC-parity verification described in commit
`60d40a9` was executed **directly against production data**, using
two real players (Bally, Bidz) as guinea pigs:

- A 17-event transaction at `2026-05-26 09:21:32.549098+00` toggled
  every admin_* RPC against Bally (disable/enable, status, priority,
  injured, group, nickname, note). The status toggle ended at
  `in/locked_after:true` instead of returning to `out`, and the
  nickname-set step was not paired with a nickname-clear step —
  leaving Bally permanently locked-in with nickname "TempNick".
- A 4-event transaction at `2026-05-26 09:57:08.115233+00` toggled
  `admin_set_vice_captain` true/false twice against Bidz to prove
  VC-route and admin-route parity. Bidz had been promoted to VC
  legitimately at `08:52:51`. The parity sweep's toggle ended in
  `false`, silently reverting the promotion.

**Recovery (this session):**

- Bally's `nickname` reset to NULL and `status='out',
  admin_locked_in=false` via direct UPDATE, then a second pass via
  `admin_update_player_name` and `admin_set_player_status` so the
  fix itself leaves a proper `audit_events` row under
  `actor_type='team_admin'`.
- Bidz's accidental VC-demotion left unfixed at user's request
  (user will sort manually).

**Lessons (lock these in, don't relearn them):**

1. **Never run parity / smoke tests against live production rows.**
   Even a self-cancelling toggle sweep can leave residue if any
   step's revert is missed, and it overwrites legitimate state
   from real users in the same window. Use a throwaway team
   (created fresh, or seeded) for any admin_* RPC verification.
   `team_demo` is acceptable for non-RLS-dependent dry-runs but
   not for VC-parity which depends on real `team_admins` /
   `team_players.is_vice_captain` rows.
2. **A "toggle on then off" smoke test must read the starting
   state first and revert to *that*, not blindly to false.**
   Bidz's VC sweep ended in `false` because the test treated
   `false` as the universal safe end state — but his starting
   state was `true`. Either snapshot-and-restore around each
   toggle, or always run sweeps on rows known to start in a
   pristine default.
3. **`admin_set_player_status` writes an audit row even when
   `before == after`.** This is by design (records the action,
   not just the delta) but it means audit logs can show no-op
   writes. Acceptable but worth knowing when reading audit
   trails — count distinct *outcomes*, not row counts.
4. **Direct table UPDATEs from the MCP bypass audit_events.**
   Any operator cleanup that should leave a trail must go
   through the admin_* RPC path. Pattern: do the cleanup via
   RPC even if it produces a no-op write — the audit row is
   the point.
5. **Identical microsecond timestamps across many distinct
   actions are a signal**, not noise. Postgres `now()` resolves
   per-transaction, so 17 rows sharing one timestamp = one
   transaction. When auditing "did the user do this?", first
   check timestamp clustering — a clustered set is almost
   always a script/sweep, not human taps.

**Forward fix (open tech debt, low priority):**
A `verify_admin_parity` smoke skill / SQL script should be added
that operates against an ephemeral row it creates and tears down
in the same transaction, so future parity work cannot residue
into production. Filed below under Tech Debt.

---

## RESOLVED 2026-05-26 (session 45)

### Vice Captains now hold full admin authority across every admin_* RPC
**Surfaced by:** tarny reporting "i (a VC) cannot mark gbains as VC" on
PWA after the earlier session-44 UI-only fix. Investigation found the
admin_set_vice_captain RPC was the only one of 24 admin_* RPCs that
had been taught to accept a VC's player_token. The other 23 still
single-resolved `WHERE admin_token = p_admin_token`, rejecting VCs
silently. Symptom: VCs could see admin actions in AdminView but every
tap surfaced "Couldn't update vice captain" or equivalent.

**What shipped today (three commits + one sweep):**
- `0ef3913` — `admin_set_vice_captain` extended with a player_token
  VC stage-2 path (server-side only, no client changes).
- `767b499` — App.jsx:1190 changed to `(isAdmin || isViceCaptain) ?
  route.token : null` so the VC's player_token actually reaches every
  admin RPC (the cloud-Claude commit `724a1c6` had nulled it for VCs).
- `074_resolve_admin_caller.sql` — new SECURITY DEFINER helper
  returning `(team_id, actor_type, actor_ident)` from either token
  shape.
- `075_admin_rpcs_vc_parity.sql` — meta-SQL sweep: every admin_* RPC
  (except admin_set_vice_captain) now resolves the caller via the
  helper. Audit_events captures the true caller — `team_admin` for
  the owner, `vice_captain` for VCs. Verified by dry-runs of 9 RPCs
  + a negative test + an owner regression on team_KPaoX8oJYMQ.

**Hard rule of record (also in DECISIONS.md):**
A Vice Captain holds the same authority as the team owner.
Owner-grade = VC-grade across every admin_* RPC. The only difference
that survives is the audit trail.

---

## RESOLVED 2026-05-25 (session 44)

### Held admin-badge cycle finally shipped — closes rule #11 drift
**Surfaced by:** session-44 resume audit. The session-41 admin-badge
work had been sitting in the working tree for three sessions: three
JSX one-liners + migration 058 source files for an RPC change that
was **live since session 41** but never source-committed (violated
CLAUDE.md hard rule #11 for ~4 sessions).

**What shipped (commit `98b7ce6`):**
- `MySquads.jsx`: ADMIN badge keys off `is_vice_captain ||
  is_team_admin` so the team creator (a `team_admins` row but
  `is_vice_captain=false`) renders with the badge too. Surprise from
  audit: session 43's mig 072 (`player_get_teams_by_token`) already
  exposed `is_team_admin`, so no new migration needed.
- `SquadScreen.jsx` + `PlayerProfile.jsx`: drop the `!isViceCaptain`
  viewer-side gate on the VC IconToggle so a VC can promote/demote
  other players' VC. Self-protection preserved via `vcSelf` (handler
  early-return + `disabled` prop) and PlayerProfile's
  `me?.id === viewer?.id ? "You're the Admin"` branch.
- `058_player_get_teams_admin_flag.sql` + `_down.sql`: source files
  for the live RPC change. Live body verified byte-for-byte against
  source. Rule #11 drift closed.

**Behavioural reach (post-merge observation):** MySquads' CURRENT-row
branch never renders the ADMIN badge regardless — only the
not-current squad rows check the badge condition. So the change only
helps users who are `team_admin` on team A while viewing the app from
team B's `/p/` route. Narrower than originally pitched but still
correct. The VC-toggle unhide is the broadly visible change.

**Real-iPhone test (rule #13) skipped intentionally:** the held
change is a 3-line render-gate removal with no behaviour change for
working code. Reviewer confirmed audit findings end-to-end (live RPC
state, JSX diff, RPC contracts) before merge. Acknowledged as a
deliberate exception, not a precedent.

**Known latent (unchanged from session 41 plan):** if a VC opens
AdminView via `/p/<player_token>` rather than `/admin/<admin_token>`,
the VC toggle write fails with `invalid_admin_token` (admin_set_vice
_captain RPC validates against teams.admin_token strictly).
SquadScreen surfaces a red toast on error; PlayerProfile silently
snaps back. Tarny (current sole VC) always uses the admin URL, so
not exercised in production.

**Out of scope (still open):**
- HeroCard "Admins" block extension (G change, mig 059) — not built.
- VC co-admin from /p/ route — needs either UI to share admin URL
  with VCs or an RPC change accepting VC auth.uid() as fallback.

---

## RESOLVED 2026-05-25 (session 43)

### PWA features that depend on sign-in silently failed on home-screen app
**Surfaced by:** session 42 telemetry (`audit_events.app_boot`) —
ZERO standalone PWA boots in 7 days carried a server-side JWT
despite confirmed sign-ups. iOS deliberately partitions Safari
storage from installed-PWA storage; sign-in done in Safari never
reaches the home-screen app. session 41's `refreshSession()`
mitigation helped nobody because there's no refresh token to
refresh.
**Three user-visible breakages:**
1. **My Squads** showed "Sign in to see all your squads" forever
   because `player_get_teams()` is auth.uid()-only.
2. **Admin tapping own in/out on /admin/<token>** silently no-op'd
   because session 41's mig 061 fix relied on auth.uid() matching
   to expose the admin's own player token.
3. **Joining a new team / linking account / deleting account**
   silently failed when tapped in the home-screen app.

**Latent bug surfaced during execute:** mig 070 added an `is_self`
flag to admin-state RPCs (session 42) but `dbToPlayer` in
supabase.js never mapped it. So App.jsx's admin resolver
(`squad.find(p => p.is_self)`) always returned undefined and fell
through to `squad[0]` — meaning admins on /admin/ routes saw
themselves AS the first squad member (e.g. Tarny on
/admin/<footy> rendered AS "rockybram"). Bug had been live since
session 42 ship, hidden because the same fallback row was always
clickable in StatusScreen, so nobody noticed.

**Fix (session 43):**
- **Migration 072** — new `player_get_teams_by_token(p_token)`
  RPC that resolves user_id from the URL token instead of
  auth.uid(). MySquads switched to the token-based variant. Old
  RPC kept for App.jsx post-OAuth flows. Verified live: gbains'
  two teams both return from a single token call with correct
  admin/VC flags.
- **AuthGateModal.jsx + useRequireAuth hook** — email + 6-to-10
  digit OTP modal (no Google to dodge iOS-PWA webview blocking).
  Code length is flexible because Supabase OTP length is a
  project setting (this project sends 8).
- **Email template** updated in Supabase dashboard to surface
  `{{ .Token }}` prominently; magic link kept as secondary path.
- **`dbToPlayer` mapper** now passes through `is_self` → `isSelf`.
- **PlayerView** introduces `needsSelfAuth = isAdmin && !me?.isSelf`
  flag that gates all 6 self-write entry points (status, push
  subscribe, +1 guest, injury toggle, clear-debt, cash-paid).
- **App.jsx** `handleJoin` refactored to gate via `useRequireAuth`
  before running `doJoin` (avoids React-state staleness loop where
  the SIGNED_IN listener hasn't yet updated `authUser` when the
  pending action retries).
- **PlayerProfile** delete-account button gated likewise.
- **Link-account** path was already auth-gated by being inside a
  post-OAuth branch; no change needed.

**Verified live on real iPhone:**
- Tarny (VC on Footy Tuesdays) opened the preview's
  `/admin/<token>` from home-screen icon. Header initially showed
  "rockybram" (fallback). Tapped IN → modal popped, entered email,
  typed 8-digit code, verified. Page reloaded. Header switched to
  "Tarny". Subsequent taps committed to Tarny's row. Modal didn't
  re-appear on close+reopen. My Squads showed Footy Tuesdays
  without sign-in placeholder.

**Commits:** `cdba41d` (initial), `b1935e5` (isSelf gate fix),
`ba7bc8d` (OTP length fix). Merged via `5e747f7`.

---

## RESOLVED 2026-05-25 (session 42)

### Second team-membership unreachable for returning users
**Surfaced by:** gbains2010 (auth user `31f12159…`). Created his own team
**Finbars Tuesdays** on 2026-05-24, then joined **Footy Tuesdays** via
rockybram's join link the next morning. Could sign in but every app-open
landed in Finbars; no URL or My Squads click could reach Footy Tuesdays.
**Root cause:** `player_join_team` (044) and `join_team_as_returning_player`
(015) both reused a single `players` row across multiple teams for the
same auth user. One `player.token` → two `team_players` rows. The
deterministic `ORDER BY tp.created_at ASC LIMIT 1` resolver in
`get_team_state_by_player_token` always picked the earliest team. The
MySquads accordion also collapsed both squads into one (key collision,
both rows rendered as "CURRENT", neither clickable).
**Fix:** Migrations 065+066 rewrite both join RPCs to mint a fresh
`players` row + token per team-membership. 067 relaxes
`link_player_to_user` (one user can now own multiple players, the
inverse guard kept). 068 makes `delete_my_account` iterate every player
row owned by the auth user. 069 backfilled the only currently-affected
user: gbains' Finbars row kept its original token, Footy Tuesdays got
a freshly-minted player + token (`p_30834a6b` / `p_XFGglFrN5xVSo2FJx8I`).
Verified live: token resolves to its own team, `player_get_teams`
returns two distinct clickable squads, status taps audit to the
correct per-team player row.
**Commits:** `1e7da1f`.

### "Copy personal link" emitted /p/<player_id> not /p/<token>
**Surfaced by:** Tarny copying gbains' link from Admin → Squad in the
Footy Tuesdays PWA. Got `https://www.in-or-out.com/p/p_30834a6b` —
that's the player **id**, not the token. URL doesn't resolve.
**Root cause:** SquadScreen.jsx:138 falls back to `p.id` when `p.token`
is null (`${p.token || p.id}`). Migration 061 deliberately stripped
`p.token` from every squad row in `get_team_state_by_admin_token`
**except** the admin's own. The fallback silently shipped player_ids
for everyone else. Pre-existing bug since session 41 ship — not seen
because gbains was the first multi-team case.
**Fix:** Migration 070 exposes `p.token` on every squad row and adds an
explicit `is_self` boolean for the admin's own row. App.jsx:499
switched from `find(p => p.token)` (which would now grab the first
squad row) to `find(p => p.is_self)`. Token leak to admins is a wash —
they already have stronger powers via admin RPCs; sharing /p/<token>
is the whole point of the feature.
**Commits:** `010b5d4`.

### Same link bug from VC route (different RPC, same fallback)
**Surfaced by:** Tarny still getting `/p/p_30834a6b` after the 070 ship.
**Root cause:** 070 only fixed `get_team_state_by_admin_token`. VCs
enter admin view via their own `/p/<token>` route, which fetches via
`get_team_state_by_player_token` — a *different* RPC that historically
returned **no** squad-row tokens at all.
**Fix:** Migration 071 mirrors the 070 fix on the player-token resolver:
derives `v_privileged` (caller is VC of this team OR has an active
`team_admins` row tied to the caller's `user_id`), and exposes
`p.token` on squad rows only when privileged. Regular players still
see null tokens.
**Commits:** `34cfd23`.

---

## RESOLVED 2026-05-25 (session 41)

### Admin-route player self-writes silently no-op'd
**Surfaced by:** rockybram (team_admin on `team_KPaoX8oJYMQ` Footy Tuesdays).
On his admin PWA he tapped "out" on My View; UI flipped optimistically;
DB never updated; Tarny's screen showed him as `none`.
**Root cause:** `get_team_state_by_admin_token` stripped credentials
(token, user_id) from squad rows. App.jsx:465 tried to match the admin's
own player by `user_id === session.user.id`, but the field wasn't in the
payload. Result: `myPlayer=null`, `me.token=undefined`, every player-self
write in PlayerView short-circuited at `if (me?.token)`. Affected: status
taps, self-pay, +1 add/remove, mark injured, POTM vote, push subscribe,
leave squad, delete account, payment/injury history reads.
**Fix:** Migration `061_admin_self_token_in_squad.sql` exposes the
admin's own token in the squad payload, gated by `auth.uid()` match.
App.jsx admin resolver rewired to `squad.find(p => p.token)`. Verified
live with role-impersonation: rockybram's row returns his token, every
other row returns null.
**Commits:** `77b4bb5`.

### Realtime live view dead for anonymous clients
**Surfaced by:** user noticed Karan joined + tapped out, but the live
update did not appear on his /p/ PWA without manual reload.
**Root cause (two-part):** notify_team_change publishes to
`team_live:<channel_key>` via `realtime.send`, but with `private=true`
default. RLS on `realtime.messages` is enabled with zero policies →
default deny. AND, App.jsx never subscribed to that broadcast channel at
all — only to `postgres_changes` on players/schedule/matches, which
themselves are RLS-gated on auth.uid(). Anon clients failed both gates.
**Fix:** Migration `062_notify_team_change_public_broadcast.sql` flips
the 4th arg to `false` so broadcasts are public (channel UUID is the
secret). App.jsx now subscribes to `team_live:<key>` via new useEffect
keyed on [teamId, liveChannelKey, route]; refetches team state on every
broadcast. Old postgres_changes pipe retained as fallback for authed
sessions. Verified end-to-end: Bidz tapped injured → Tarny's screen
updated without reload.
**Commits:** `4061a88`.

### Server-side observability gap — silent fire-and-forget failures
**Surfaced by:** triage of rockybram's "out" tap — no way to tell from
the server whether the RPC ever ran.
**Root cause:** Player self-write RPCs (`set_player_status`,
`set_player_paid`, `set_player_injured`, `add_guest_player`,
`remove_guest_player`, `register_push_subscription`,
`unregister_push_subscription`, `submit_potm_vote`,
`link_player_to_user`) wrote no `audit_events` rows. `console.error`
on the client was the only failure surface.
**Fix:** Migrations `060_audit_player_self_writes.sql` (status, paid),
`063_audit_player_self_writes_phase2.sql` (the other 7). Pattern:
INSERT into audit_events with `actor_type='player'`, `actor_user_id=auth.uid()`,
`actor_identifier='player_token:'||md5(p_token)`. Encoded as a new
hard rule (#9) in CLAUDE.md.
**Commits:** `77b4bb5` (060), `284a44e` (063).

### App-boot telemetry — PWA opens previously invisible
**Surfaced by:** auto-refresh fix shipped but couldn't tell from the
data whether it was helping.
**Fix:** Migration `064_app_boot_audit.sql` adds `log_app_boot` RPC.
App.jsx fires it on every boot capturing route_type, display_mode
(standalone vs browser), session_present_client. Comparison with
server-side actor_user_id surfaces "client thinks authed but JWT not
attached" mismatches.
**Commits:** `f9788ca`.

---

## RESOLVED for user-visible paths in session 43 (originally session 41)

### PWA auth session fragility — iOS storage partition
**Surfaced by:** audit data showing player taps with `actor_user_id=NULL`
even for confirmed signed-up users hours after sign-in. Confirmed via
session 41 telemetry: Tarny's app_boot rows show
`display_mode=standalone`, `session_present_client=false`,
`server_authed=false` despite having signed in via OAuth yesterday.
**Diagnosed cause:** **iOS PWA storage partition.** Signing in via
Safari (where OAuth callback lands) writes JWT to Safari's localStorage.
The PWA launched from home screen reads from a SEPARATE localStorage
partition that has never seen the sign-in. `refreshSession()` returns
nothing to refresh — the refresh token literally isn't in PWA storage.
**Mitigation shipped (session 41):**
- `supabase.auth.refreshSession()` on every app boot + on
  visibilitychange (throttled 5 min). Helps for the "stale token but
  refresh token present" case. **Does not help** for the storage
  partition case (no refresh token to use).
- Live-view decoupled from auth via public broadcast (migration 062).
- Admin-route self-writes decoupled via player-token exposure
  (migration 061).
**Session 43 resolution:** chose the "establish auth INSIDE the PWA
storage scope" path. Added an in-PWA email-OTP modal
(AuthGateModal.jsx + useRequireAuth hook) that runs the entire
OAuth-equivalent flow inside the PWA's own webview. JWT lands in
PWA localStorage and persists across reopens (subject to iOS 7-day
inactivity eviction, which doesn't bite for a weekly footy app).
The modal pops only on the 4 actions that genuinely need auth:
joining a new team, deleting account, linking account, and admin/VC
tapping their own status on /admin/ routes. Day-to-day token-based
flows (player status, payments, POTM votes etc.) remain unauthed
and unaffected.

**Resolution per affected feature:**
- MySquads accordion: switched to new
  `player_get_teams_by_token(p_token)` RPC (mig 072). Works
  without auth.
- Admin-route self-writes: pop email-OTP modal on first tap, sign
  in once inside PWA, reload → mig 061's CASE clause fires →
  me.token populated → subsequent taps commit. One-time prompt
  per device.
- Push notification delivery: covered by the same admin/VC fix
  (`savePushSubscription` is one of the gated self-writes).
- POTM voting reads: `getPOTMVotingState(token, …)` already
  token-based, works without sign-in. No change needed.

**Long-term plan:** wrap in Capacitor at end of 3-4 week beta for
native iOS app with ASWebAuthenticationSession-based sign-in
(JWT in keychain, never evicted). ~90% of session 43 code
transfers; the OTP modal becomes vestigial at that point.

---

## RESOLVED 2026-05-25 (session 40)

### MyView double-counted ledger debt + this-week's price
**Surfaced by:** user, on Footy Tuesdays after squad setup. Tarny's My View
header showed "£5 + £5 = £10" while Payments correctly showed £5.
**Root cause (UI):** `PlayerView.jsx:459-461` rendered
`£{effectiveDebt} + £{price} = £{sum}` whenever an unpaid ledger entry
existed AND status='in'. The display assumed `effectiveDebt` = past
carry-over and `price` = fresh this-week fee. The assumption breaks
when the ledger entry IS this week's fee (created with `match_id=NULL`
because lineup-lock hasn't assigned a match_id yet) — the same £5 gets
shown twice.
**Trigger condition (live):** admin tapped PAY → Reset on a player in
PaymentsScreen during squad setup, before any match row existed. The
reset flow leaves an unpaid ledger row with `match_id=NULL`. Any team
in this state would show the bug.
**Fix:** Trust the ledger as the single source of truth for outstanding
balance. New display contract:
- paid → "Nothing owed 👊"
- `effectiveDebt > 0` → `£{effectiveDebt} owed`
- `status === 'in'` + `price > 0` → `£{price} this week`
- else → "Nothing owed 👊"
Also fixed Clear Debt / Transfer button labels (same broken arithmetic).
**Latent issue not fixed:** the schema can't distinguish "NULL match_id =
current upcoming match" from "NULL match_id = legitimate carry-over debt".
This is fine while admin marks paid AFTER the match (the normal path) —
but if pre-match payments become common, the lifecycle deserves
tightening. Logged for future consideration; current fix is correct
under both interpretations.
**Cleanup:** stale £5 ledger row on Tarny (Footy Tuesdays, the artifact
of the tap-then-reset) deleted via execute_sql.
**Commit:** `a8dd46d`.

---

## LOW — Known workarounds exist

### 0. No ephemeral fixture for admin_* RPC parity smoke tests
**Detail:** Today's session-45 VC-parity verification was run against
real production rows on Footy Tuesdays (team_KPaoX8oJYMQ), which
left Bally with locked-in `status='in'` + `nickname='TempNick'` and
silently demoted Bidz from VC. See "RESOLVED 2026-05-26 (session 45,
post-sweep)" above for full incident + lessons.
**Fix:** Add `skills/scripts/verify-admin-parity.sh` (or a
`verify_admin_parity()` SQL function) that creates a throwaway team
+ two throwaway players inside a transaction, runs the toggle sweep
against them, asserts every admin_* RPC accepts both admin_token
and VC player_token, then rolls back. Never let parity work touch
a row a real user can see.
**Priority:** Low (fix is shipped, the gap is preventative).

### 1. BibsScreen standalone write broken under RLS
**File:** `apps/inorout/src/views/AdminView/BibsScreen.jsx`
**Detail:** BibsScreen bib assignment lacks `matchId` + `adminToken` in scope.
Direct `insertBib` write is blocked by RLS.
**Workaround:** Bibs can be set via ScoreScreen result save (has both). Standalone
BibsScreen assignment is non-functional post-RLS.
**Fix:** Thread `adminToken` + `matchId` into BibsScreen; replace `insertBib` with
`admin_save_bib_holder` RPC call.

### 2. `player_career` mostly empty (schema ready — Phase 0D)
**Detail:** Pre-0D the table had 0 rows entirely (even `total_bib_count` wasn't
being written). Phase 0D (migration 053) landed the schema for casual/competitive
split + `sync_player_career(p_player_id)` RPC. Schema is now ready but **no
backfill has run** — table still has only `p_demo_20` (the 0D smoke test row).
Phase 2 will: (a) call `sync_player_career` for every player, (b) wire it to a
trigger on `player_match` insert/update so it stays in sync automatically,
(c) populate the still-empty `career_win_rate`, `career_reliability`,
`career_impact`, `best_team_id` fields.

### 3. `team_demo` has no `team_admins` row ✅ RESOLVED (session 36)
~~Demo team predates the `team_admins` table.~~ Backfilled session 36 — added row
for `tarny@desicity.com` auth uid. Now mostly moot: the H2H + StatsView RPC
fixes (041, 042) mean `/demoadmin` works for unauthenticated visitors too via
the admin_token SECURITY DEFINER path.

### 4. `scoring.js` filename mismatch
**File:** `packages/core/engine/scoring.js`
**Detail:** File hosts `periodCutoff` (a non-scoring helper) alongside `hasGoalData` +
`resolveDominantType`. Low priority until file grows further.
**Fix:** Rename to `stats-helpers.js` when adding more helpers.

### 5. Cross-browser / in-app-webview install loses token breadcrumb ✅ MOSTLY RESOLVED (session 37)
**Original detail:** localStorage breadcrumbs (`ioo_last_visited` / `ioo_redirect_to`) didn't
survive cross-browser handoffs OR (more critically) the Safari → installed-PWA
storage boundary on iOS. Installed PWAs opened at `/` with no breadcrumb → PWAWelcome.
**Resolution (session 37):** session 37 shipped the **per-install dynamic manifest**
pattern (Option E from the original "fix not yet built" list). `/api/manifest?admin=<token>`
and `/api/manifest?player=<token>` emit a manifest whose `start_url` is `/admin/<token>`
or `/p/<token>`. An inline `<script>` in `index.html` injects the right
`<link rel="manifest">` at HTML parse time (iOS reads the manifest at parse, ignoring
later JS mutations — that's why the previous React-effect swap silently failed).
Post-create and post-join flows hard-redirect to `/admin/<token>?just_created=1` and
`/p/<token>?just_joined=1` so the URL path matches what the inline script needs to
inject the personalised manifest. Verified end-to-end on real iOS device for both
admin and player installs. **Still potentially affected:** cross-context cases where
the user installs from a different browser than they joined in (in-app webview →
Chrome install). For those, the localStorage breadcrumb + the new PWAWelcome
polymorphic paste box (accepts p_/admin_/join links) act as escape hatches.
Server-side cookie fix (originally proposed as Option B) is no longer required for
the core flow.

### 6. PlayerView direct `matches` table read 401s on every page load ✅ RESOLVED (session 36)
The 401s on the `from('matches')` reads were from `getHeadToHead` and
`getPlayerLeagueTable`, not PlayerView itself — both were wrapped in
SECURITY DEFINER RPCs (migrations 041 + 042) with adminToken threading.
Same pattern applies to authenticated player sessions which hit the
direct-read fallback path. Console clean post-fix.

---

---

## RESOLVED THIS SESSION (May 24 2026 — session 39 — push fix + admin_save_teams scoping + notify whitelist + superadmin Phase 1+2 + workspace-deps guard)

Triggered by a 73.7% Vercel dashboard error rate. Investigation cascaded
into one latent production bug and three smaller fixes.

- **Push notifications silently dead since deploy of platform-clubmanager**
  — three-layer bug, all three layers fixed:
  1. All four VAPID env vars on Vercel platform-clubmanager production
     were stored as empty strings (set 13 days ago but with no value;
     dashboard masked this as "Encrypted" so we couldn't see). Generated
     a fresh keypair, set via `vercel env add --value`, redeployed.
  2. All six `pg_cron` notification jobs called `https://in-or-out.com`
     (apex) which 307-redirects to `www`. `pg_net` (like all sane HTTP
     clients) STRIPS the `Authorization` header when following a
     cross-host redirect. So the cron's bearer never reached the
     function → 401 → never delivered. Latent since cron setup, masked
     by parallel VAPID 500s until those were fixed. Rewrote all 6 jobs
     via `cron.alter_job` to use canonical www URL.
  3. `pg_cron` job 5 (`notif-bibs-24hr`) had `Liverp00l123?!!*` pasted
     mid-body, causing a `syntax error at or near ":="` ERROR every
     hour on the hour. Fixed via `cron.alter_job` with clean body.
  Verified end-to-end at the 19:45 UTC cron tick: 4× HTTP 200 vs
  4× HTTP 401 at 19:30 (apex/auth-strip baseline). `push_subscriptions`
  still 0 — Beta hasn't yet exercised the in-app subscribe flow, so the
  proof-on-device test is deferred.

- **admin_save_teams cross-team write surface (migration 048)**
  — defense-in-depth fix flagged in the pre-Beta audit. The CLEAR
  statement in 043 correctly scoped `UPDATE players SET team=NULL` via
  `team_players` join, but the two subsequent SET statements
  (`team='A'`/`team='B'`) trusted the client-supplied arrays against
  the global `players.id` namespace. A legit admin for team X could
  pass foreign player_ids from team Y in `p_team_a`/`p_team_b` and
  flip their team column. Verified live: team_demo admin successfully
  wrote `team='A'` to a Finbars player (rolled back). Migration 048
  adds the same `team_players` scope to both SET statements. Foreign
  IDs now silently update 0 rows. Adversarial test re-run post-fix
  confirmed leak blocked; happy-path test confirmed legit calls still
  work. Commit `156dc84`.

- **notify_team_change whitelist missing `player_account_deleted`
  (migration 049)** — session 37's migration 047 (`delete_my_account`
  FK purge) passes this reason to `notify_team_change`. The function
  has a hard whitelist for log-warning purposes only — broadcast still
  worked, but every account deletion logged
  `notify_team_change: unknown reason "player_account_deleted"`.
  Added the reason to the whitelist. Commit `5a1a0e3`.

- **Pre-Beta launch blocker: `player_join_team` never generated a
  player token (migration 044)** — found during the pre-Beta audit
  and fixed before the invite link went out. The new-player INSERT
  branch omitted the `token` column, so first-time joiners landed
  with `player.token=NULL`, `JoinSuccess.jsx` fell back to `/`,
  stranded them on the landing page. Now generates a token using
  the same helper `create_team` uses. Commit `cec9975`.

- **Super-admin dashboard Phase 1 + 2 shipped (migrations 045, 046)** —
  separate Vercel-SSO-protected app at `apps/superadmin`, deployed at
  `https://platform-superadmin-djj9b1w8x-tarny-s-projects.vercel.app`.
  New `platform_admins` table + `is_platform_admin()` helper + four
  read RPCs (`superadmin_whoami`, `superadmin_list_teams`,
  `superadmin_team_detail`, `superadmin_recent_activity`). Three UI
  tabs: live audit_events tail, teams overview, per-team drilldown.
  Read-only — write tools (token rescue + data fix) deferred to a
  future Phase 3/4. Commits `9b7bda8` (initial), `a6fe2a8` (workspace
  dep recovery).

- **Workspace-deps guard hook + alias cleanup (commit `7547d49`)** —
  the superadmin scaffold's first commit listed `@platform/supabase`
  as a real npm workspace dep, but it was only a Vite alias. Local
  builds passed (Vite resolves at build time), Vercel CI failed
  workspace-wide because npm couldn't resolve it from the registry.
  This cascaded to break platform-clubmanager's deploy pipeline too
  (`www.in-or-out.com` kept serving the prior good build because
  Vercel only promotes on success). Fix: removed the fake dep,
  eliminated the alias entirely (22 source files migrated to import
  from `@platform/core/storage/supabase.js`), added
  `Skills/scripts/check-workspace-deps.sh` wired into the pre-commit
  build gate to make this bug class structurally impossible going
  forward. The check verifies every `@platform/*` dep maps to a real
  workspace package; sub-second, jq-based. Negative-tested by
  re-adding fake deps and confirming the check blocks the commit.

- **One 401 on direct `matches` read** — investigated, **not a code
  bug.** Query signature matched `getHeadToHead`'s direct-read
  fallback (intentional code for authenticated player sessions),
  called with a team_id (`team_54awfyl7TQY`) that has never existed
  in this database. Source: stale PWA install / localStorage
  breadcrumb / pre-DB-wipe artefact. RLS correctly rejected. User
  sees empty H2H section, no crash. Decided to skip — revisit if
  real Beta users report empty H2H.

---

## RESOLVED THIS SESSION (May 24 2026 — session 37 — beta P0 cascade)

Beta launched. First real customer hit a chain of bugs in the first hour.
Session 37 was a long bug-fix cascade — fixes in order of discovery:

- **OAuth loop on `/join/CODE`** — JoinTeam rendered "Continue with Google" on
  first paint with `authUser=null` because App.jsx hadn't resolved the initial
  session yet. User tapped Google, completed OAuth, came back, saw the same
  sign-in screen. Fix: JoinTeam self-checks via `supabase.auth.getSession()` on
  mount (renders a neutral loading state until probe resolves) + App.jsx gains
  an `authReady` flag that holds every route until the top-level session check
  has resolved. Commit: `2cd33c9`. Plus regression fix in `5c2cae2` (load()
  needed `session` restored after the refactor) and `/create` hardening (dual
  sessionStorage + localStorage write from useEffect).
- **JoinTeam wordmark rendered "INOROUT"** — `.join-brand` was `display: flex`
  which collapses whitespace between flex items. Swapped to `display: block`.
  Commit: `a5cf076`.
- **PWA installed from SquadReady opened to "Paste your link"** — biggest bug
  of the session. Initial fix (write `ioo_last_visited` to localStorage in
  SquadReady) FAILED because iOS Safari partitions PWA localStorage from
  Safari's. Next attempt (swap `<link rel="manifest">` via React useEffect)
  FAILED because iOS reads the manifest at HTML parse time and ignores
  subsequent mutations. **Actual fix** (commits `11614ee`, `2d12db3`,
  `b7236ca`): new `/api/manifest` Vercel serverless function emits a
  personalised manifest with `start_url=/admin/<token>` based on a `?admin=`
  query param (regex-validated); inline `<script>` in `index.html` runs
  during HTML parse and injects the right `<link rel="manifest">` URL
  before iOS can fetch a manifest; useOnboarding hard-redirects to
  `/admin/<token>?just_created=1` after create succeeds, so the URL path
  matches what the inline script needs. App.jsx top-level renders SquadReady
  as a session-storage-backed overlay on `?just_created=1`. Verified live on
  iPhone — home-screen icon opens directly to admin panel.
- **PWA installed from JoinSuccess opened to "Paste your link"** — same root
  cause as admin install, same architectural fix mirrored. `/api/manifest`
  extended to accept `?player=<p_token>`. Inline script in `index.html`
  also matches `/p/<token>` paths. handleJoin hard-redirects to
  `/p/<token>?just_joined=1` after `playerJoinTeam` succeeds. App.jsx
  renders JoinSuccess as overlay on `?just_joined=1`. Commits: `f62cc7c`
  (endpoint + inline script + App.jsx player swap), `90bba41` (handleJoin
  redirect + overlay). Verified live on iPhone.
- **Player invite link in admin panel used team_id instead of join_code** —
  `SquadScreen.jsx:404` rendered `in-or-out.com/join/${teamId}`. Bug was
  masked because `get_team_by_join_code` has a fallback that matches against
  team_id, but the share traces were leaking team_ids and the displayed URL
  was the wrong identifier. Fixed: SquadScreen now fetches the team via
  `getTeamByAdminToken` on mount and uses `team.join_code`. Commit: `a8b803e`.
- **OAuth "User not found" loop on /join after delete-account** — separate
  diagnostic finding. A previous `delete_my_account` for tarnysingh@gmail.com
  had succeeded at the SQL layer but failed silently at `auth.admin.deleteUser`
  (Stage 2). Returned `ok:true,authDeleted:false`. The auth.users row +
  auth.identities row stayed forever, blocking that email from ever signing in
  again — Google verified the identity, Supabase looked up the missing
  user_id → 404 "User not found" → silent OAuth loop. Root cause: the 040
  RPC version anonymised the player row and *revoked* (not deleted)
  team_admins rows, and never touched user_profiles. Postgres refused to
  delete auth.users because those FKs (NO ACTION) still pointed at it.
  Fix: migration 047 rewrites the RPC to DELETE team_admins rows (not just
  revoke), NULL out granted_by/revoked_by references, NULL platform_admins
  granted_by, and DELETE the user_profiles row. After 047, `auth.admin.deleteUser`
  succeeds and auth.identities cascades naturally. Verified by calling the
  real `/api/delete-account` endpoint and confirming `authDeleted:true` plus
  zero rows remaining in auth.users / auth.identities / user_profiles.
  Migration: 047. Edge function comment: `155f0ee` documents the gotcha
  and the manual cleanup SQL for any future stuck account.
- **JoinTeam wordmark CSS hex fixes, SignIn pre-existing hex tokens,
  Google brand hex allowlist** — incidental hygiene fixes forced by the
  post-edit hook on touched files. Commits: `12d0ceb`, `b041f38`.

**Bundle commits (in order):** `12d0ceb` → `2cd33c9` → `692d84a` → `a5cf076`
→ `5c2cae2` → `b041f38` → `11614ee` → `2d12db3` → `9673934` → `b7236ca`
→ `7c36dc7` → `a8b803e` → `155f0ee` → `f62cc7c` → `42c54e8` → `90bba41`.

## RESOLVED (May 24 2026 — session 36)

- **H2H on /demoadmin showed "you haven't played in the same game yet"** —
  `getHeadToHead` did three direct `.from()` reads on `matches` +
  `player_match`. Under post-session-24 RLS those returned zero rows for
  anon callers; the modal silently rendered empty. Migration 041 added
  `get_head_to_head_raw_by_admin_token` (SECURITY DEFINER, derives team
  from admin_token, returns three jsonb arrays). JS branches on
  adminToken; existing computation untouched. Threaded adminToken
  through App.jsx → PlayerView/StatsView → HeadToHead. Commit: `a95e074`.
- **StatsView form chips + reliability column always blank** — same root
  cause. `getPlayerLeagueTable` did direct `.from()` reads → RLS-blocked
  on anon. StatsView's local tableData hard-coded `reliability:null` +
  `form:[]` because `matchHistory + squad` props can't derive either
  (need ordered player_match rows + all-time attended counts). Migration
  042 added `get_player_league_table_raw_by_admin_token`; StatsView now
  augments local tableData with form + reliability from the RPC. Also
  fixed HeadToHead Section 4 Overall Comparison bars on demoadmin via
  same threading. Commit: `ed92e2f`.
- **TeamsScreen — buttons "do nothing", duplicate CONFIRMs, no
  REGENERATE option** — three related UX gaps. The confirm RPC was
  firing fine but visual feedback was a tiny green toast easy to miss;
  button text never changed; admin couldn't tell anything happened.
  Plus two confirm buttons (top + bottom) doing the same thing. Plus
  BUILD TEAMS gated on `groupsDirty` so admin couldn't re-shuffle
  without first editing groups. Combined fix: dropped the duplicate
  top button + the toast; bottom button is now state-aware (assign
  first / confirm / confirming / ✓ confirmed). BUILD TEAMS always
  visible when SMART is open, with adaptive label (BUILD TEAMS when
  groups dirty, REGENERATE TEAMS otherwise). Commits: `a7e3e96`, `b257ae3`.
- **PlayerView Live Board team sheet empty after confirm** —
  `admin_save_teams` only wrote `matches.team_a/team_b` (the persistent
  match row), never `players.team` (the denormalised column PlayerView's
  Live Board reads at line 203). Migration 043 extends the RPC to clear
  + set p.team on every confirm, scoped to team via team_players join.
  Commit: `a14590b`.
- **TeamsScreen CONFIRM TEAMS button reverted to "CONFIRM" on return** —
  race condition between matchId hydration effect (which set
  teamsConfirmed=true from the loaded match) and the auto-Smart effect
  (which read empty `assignments` from its stale closure, decided
  "nothing assigned", ran the algorithm, called setTeamsConfirmed(false)).
  Whichever setState committed last won. Fix: hydration now sets
  `hasAutoFiredRef.current=true` when it detects an already-confirmed
  lineup, so auto-Smart bails before running. Commit: `a14590b`.
- **/demoadmin "me" defaulted to a leftover Test Player row** —
  the squad lookup matched `userId === session.user.id` for the auth
  user. For accounts with an orphan p_* row pointing at their uid,
  this surfaced a meaningless test player as the header avatar and
  broke every player-centric surface. demoadmin is a public showcase
  route, not identity-bound — hard-coded "me" to Hassan (`p_demo_01`),
  the demo protagonist with the richest seeded history. Commit: `dd14c6e`.
- **Dead IO Intelligence query block** — 10 supabase.js functions
  (`getPlayerMatchStats`, `getWinRate`, `getCurrentRun`,
  `getReliabilityScore`, `getMostPlayedWith`, `getOpponentStats`,
  `getNemesis`, `getBestPartnership`, `getPlayerImpact`,
  `getPOTMVoteStats`) with zero callers. Pre-session-32 leftovers; the
  proper IO deeper-intel lives in `packages/core/engine/deeperIntel.js`
  now. Removing ~298 lines closes a latent RLS-blind-spot risk
  (every one used direct `.from()` reads). Commit: `9c17d4d`.

**Sweep verified clean:** post-fix, every direct `.from()` call left in
client code is either dead, demo-scoped, or hygiene-exempt. No more
RLS-blind-spot pathology in live customer read paths.

## RESOLVED (May 23 2026 — session 32)

- **B7: IO Intelligence deeper-intel cards were dead UI** — Most Played With (6+),
  Team Impact (7+), Nemesis (8+), Best Partnership (8+) all rendered the
  "Not enough data yet" placeholder in production, despite FEATURES.md
  marking them ✅ built. Root cause: `useIOIntelligence.js` hard-coded
  `mostPlayedWith`, `impact`, `nemesis`, `bestPartnership` to `null` and
  no upstream path computed them (RPC `get_team_state_by_player_token`
  returns only `match_stats`, `win_rate`, `reliability`;
  `computeStatsFromHistory` matched). Fixed by adding a pure client-side
  engine `packages/core/engine/deeperIntel.js` that computes all six
  deeper-intel metrics from `matches[]` + `squad[]` (already in state on
  every route). Wired into `computeStatsFromHistory` and both
  player-token state fetches in App.jsx. Hook stops nulling the keys.
  Shipped alongside two new cards (Most Faced Opponent 4+, Reliability
  Ranking 5+). Commit: `04877de`.

## RESOLVED (May 22 2026 — session 31)

- **B6: Status confirmation banners persisted on page refresh** — "🔒 Locked in",
  "👍 No worries we'll find cover" etc. all rendered on mount and only
  disappeared if the user happened to tap a status (firing the 5s timer).
  `hideConfirmation` initial value flipped from `false` to `true`; banners
  now only render in the 5s window after an actual `setStatus` call. Commit:
  `19abed9`.
- **B5: Player tile said "Are you in this Tuesday?" on a Wednesday match** —
  `gameDay` derived from `schedule.gameDateTime` first (which had drifted
  to a Tuesday in the demo schedule), falling back to `schedule.dayOfWeek`.
  Reversed the precedence: admin-configured `dayOfWeek` wins; the timestamp
  weekday is only a fallback. Commit: `c436992`.
- **B4: Smart Teams prediction stuck on "Even game" when one team is empty** —
  `computePrediction`'s `mean([]) ?? 0.5` defaulted both averages to 0.5,
  producing a draw verdict regardless of how lopsided the split was. Now
  returns `winner=null` when either side has 0 players; render guard hides
  the chip; confirm path saves NULL to `predicted_winner` rather than a
  misleading 'draw'. Commit: `d7cfa2f`.
- **B3: Manually-edited Smart Teams splits saved a stale prediction** — the
  algorithm's prediction was passed to `confirmTeams` even when the admin
  swapped players after Generate. Now the prediction is recomputed on every
  manual move (live), so the saved value always reflects the actual
  confirmed lineup. The "STALE / crossed-out" UI state was removed.
  Commit: `b31af19`.
- **B2: Game-is-live toggle blocked after Cancel This Week** — admin couldn't
  re-enable the game once cancelled. Root cause: `admin_upsert_schedule`
  writes day/kickoff/venue/etc but does NOT write `is_cancelled` or
  `active_match_id`. After `admin_cancel_match` set both, flipping
  `game_is_live=true` through the toggle left the schedule in conflicting
  state (`is_cancelled=true && game_is_live=true`, `active_match_id=null`)
  and the screen continued to render the cancelled state. New
  `admin_reopen_week` RPC (migration 032) owns the full reopen
  transaction: clears the cancelled state, inserts a fresh `matches`
  row, points `active_match_id` at it, writes a `week_reopened`
  audit_events row. JS `reopenWeek(adminToken)` wrapper. AdminView
  `openNextWeek` and ScheduleScreen `save` both branch through it when
  `schedule.isCancelled` is true. Verified against `team_demo`
  end-to-end via MCP. Commits: `5061508`, `e2f67ea`.

## RESOLVED (May 21 2026 — session 29)

- **B1: Stale `p.is_vice_captain` in 10 deployed RPCs** — `players.is_vice_captain` was
  removed in migration 026 (session 27) but 10 SECURITY DEFINER functions still referenced
  it in their SELECT clause. PL/pgSQL validates column references at runtime, not definition
  time, so all 10 failed silently with `internal_error`. Affected: all Manage Squad buttons
  (INJURED, DISABLE, PRIORITY), player attendance (`set_player_status`), payment marking
  (`set_player_paid`, `set_guest_payment`), injury self-report (`set_player_injured`),
  and admin tools (`admin_set_player_note`, `admin_set_player_status`,
  `admin_update_player_name`). Fixed via `apply_migration` — removed stale
  `'is_vice_captain', p.is_vice_captain,` line from all 10 SELECT clauses. Verified via
  `execute_sql` — all 10 return non-null. Schema cache reloaded. `admin_set_vice_captain`
  was already correct (uses `tp.is_vice_captain` via JOIN). No JS changes needed.
- **CreateTeam email field redundant** — `authUser` now flows App.jsx → Onboarding →
  `useOnboarding`, seeding `adminEmail` from OAuth email. Input field and validation
  removed from UI. RPC call unchanged. Commit: `419fba2`
- **"Make game live" hint** — Dismissible banner added to AdminView showing when
  `gameIsLive` is false and `ioo_game_live_hint_dismissed` not set. CTA links to
  Match Settings. Permanent dismiss via localStorage. Commit: `419fba2`

## RESOLVED (May 21 2026 — session 28)

- **ScoreScreen bib eligibility 401** — replaced `getBibEligiblePlayers` direct
  `player_match` read with synchronous derivation from `squad` prop (`bibsSorted`). No new
  RPC needed. `getBibEligiblePlayers` deleted from supabase.js. Commit: `8aaae57`
- **Admin Decide button** — confirmed non-bug. `POTMTiebreakModal` auto-detects
  `adminDecisionPending` on return to AdminView. Flow works correctly.
- **insertMatch 401** — App.jsx call site removed (`setMatchHistory` made pure);
  `insertMatch` deleted from `supabase.js`.
- **upsertSchedule dead import** — removed from App.jsx imports.
- **TeamsScreen hardcoded colours** — all 5 fixed with CSS variables.
- **App.jsx dead imports** — `insertMatch`, `upsertSchedule`, `addCoverPlayer`,
  `removeCoverPlayer`, `updateCoverPlayer`, `getUser`, `getUserProfile`,
  `getTeamByPlayerToken` all removed.
- **Raw RPC in AdminView/index.jsx** — `admin_confirm_payment` extracted to
  `confirmPayment()` wrapper in supabase.js.
- **Gold hardcoded colours in AdminView/index.jsx** — replaced with `var(--goldb)` / `var(--gold2)`.
- **console.warn in App.jsx** — changed to `console.error`.
- Dead functions removed from `supabase.js`: `bulkCancelLedgerEntries`,
  `bulkResetPlayerStatuses`, `deletePlayerMatchRows`, `findPlayerByUserId`,
  `findPlayersByName`, `getPlayerByUserId`, `updateCareerBibCount`, `insertBib`,
  `addCoverPlayer`, `removeCoverPlayer`, `updateCoverPlayer`, `getBibEligiblePlayers`
- Dead payment functions removed from `payments.js`: `handleClearDebt`, `handleStripePayment`
- `IsThisYou.jsx` deleted (never routed to or imported)
- Commits: `1784b44`, `3e2bfde`, `9003865`, `6df6fcf`, `9441888`, `957f63d`, `8aaae57`

---

## PREVIOUSLY RESOLVED (for reference)

| Bug | Fixed in |
|---|---|
| NameStep discards returning player name | Session 22 |
| `handleAddPlayer` missing `teamId` | Session 22 |
| `players.deputy` DB column (renamed, now gone) | Session 23 |
| `owes` double-increment risk | Session 26 |
| `App.jsx:639` join call signature mismatch | Session 27 |
| `getPlayerTeams` RLS bypass | Session 25 |
| Stats + My IO showing no data post-RLS | Session 25 |
| Realtime callbacks using direct table reads | Session 25 |
| `is_vice_captain` in wrong table (players → team_players) | Session 27 |
| POTM voting RLS (submit_potm_vote + get_potm_voting_state RPCs) | Session 25 |
| `add_guest_player` + payment RPCs referencing `players.is_vice_captain` | Session 27 |
| `carryForwardDebts` dead code removed | Session 26 |
| B1: 10 RPCs referencing removed `players.is_vice_captain` — all Manage Squad buttons + `set_player_status` + payments broken | Session 29 |
