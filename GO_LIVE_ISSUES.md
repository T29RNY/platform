# GO LIVE ISSUES — Pre-Onboarding Checklist

*Every production issue we've hit in beta, with the fix and the concrete
device-level check to re-run before opening the app to a new squad.*

---

## HOW TO USE

**When:** before handing the join link to any new squad / admin.

**Why:** beta hit ~40 issues in the first three weeks. Most were
silent — the UI looked fine but a tap did nothing, a notification
never arrived, a player got stranded on the landing page. None of
them surfaced in code review, type-checks, or hygiene scripts. They
were all caught only by a real human on a real device. This log
exists so you re-run those same checks on the new squad's data
before the squad runs them for you.

**How:** walk every domain below in order. For each entry, run the
**Pre-flight check** against the new squad (use a fresh iPhone or a
just-logged-out account where the check calls for it). If anything
behaves differently from the expected outcome, stop and escalate
back to dev before sending the squad the link.

**Maintenance rule:** any new production issue must be added here
in the same commit as the fix that resolves it. The fix isn't
"done" until the pre-flight check exists. This extends CLAUDE.md
hard rule #8 (BUGS.md / FEATURES.md / DECISIONS.md updates) to
this file.

**Companion docs:**
- `BUGS.md` — developer triage, full narrative per session
- `BETA_LAUNCH_CHECKLIST.md` — forward-looking infra + comms pre-flight
- `CONTEXT.md` — session diaries with deeper background

---

## 1. SIGN-IN / AUTH

### 1.1 PWA storage partition — JWT never reaches the home-screen app
**Symptom:** signed-in user opens the installed PWA from the home
screen and any feature that needs auth silently no-ops (My Squads
shows the placeholder, admin can't tap own in/out, link/delete
account does nothing).
**Root cause:** iOS deliberately partitions Safari localStorage from
installed-PWA localStorage. The OAuth callback lands in Safari, the
JWT is written there, the home-screen launch reads from a separate
storage scope that has never seen the sign-in. `refreshSession()`
has nothing to refresh.
**Fix:** in-PWA email-OTP modal (`AuthGateModal.jsx` +
`useRequireAuth` hook). Modal pops on the 4 actions that need auth:
join new team, delete account, link account, admin/VC tapping own
status. Commits `cdba41d`, `b1935e5`, `ba7bc8d`. Migrations 061,
072.
**Pre-flight check:** on a real iPhone, sign out of the app
entirely. Open the app in Safari → install to home screen →
force-quit Safari → tap the home-screen icon. Tap the admin/VC's
own status. The email-OTP modal must pop. Enter email, then the
8-digit code. Page reloads. Tap status again — it commits to the
right row. Modal does not re-appear on next reopen.

### 1.2 OAuth loop on `/join/CODE` (authReady race)
**Symptom:** new user taps Google on the join page, completes
OAuth, comes back to the same "Continue with Google" screen.
**Root cause:** JoinTeam rendered the sign-in CTA before App.jsx
had resolved the initial Supabase session, so `authUser=null` was
truthy on first paint.
**Fix:** JoinTeam self-checks via `supabase.auth.getSession()` on
mount + App.jsx exposes an `authReady` flag that holds every route
until the top-level session probe resolves. Commits `2cd33c9`,
`5c2cae2`.
**Pre-flight check:** in a fresh browser profile (no cookies), open
`/join/<new_squad_code>`. Tap "Continue with Google", complete
OAuth. You must land on the team join screen, not the sign-in CTA
again.

### 1.3 "User not found" OAuth loop after a previous delete-account
**Symptom:** a user who previously deleted their account tries to
sign back in with the same Google account and loops silently
("User not found" in Supabase logs).
**Root cause:** the old `delete_my_account` RPC anonymised the
player row and *revoked* (not deleted) `team_admins` rows, never
touched `user_profiles`. Postgres refused to delete `auth.users`
because those FKs still pointed at it. `auth.admin.deleteUser`
returned `authDeleted:false` silently; the stale `auth.identities`
row blocked the email forever.
**Fix:** migration 047 — DELETE (not revoke) `team_admins` rows,
NULL granted_by / revoked_by references, DELETE `user_profiles`
row. `/api/delete-account` now returns `authDeleted:true`. Commit
`155f0ee` (edge function notes), migration 047.
**Pre-flight check:** if onboarding a squad where the admin or any
player has ever deleted an account before (rare but possible),
verify their email no longer appears in `auth.users` /
`auth.identities` / `user_profiles` via the Supabase dashboard
before they try to sign in.

### 1.4 Admin-route player self-writes silently no-op'd
**Symptom:** team_admin on `/admin/<token>` taps own "out" on My
View. UI flips optimistically; DB never updates; other players see
status as `none`.
**Root cause:** `get_team_state_by_admin_token` stripped credentials
from squad rows. App.jsx admin resolver couldn't find `me.token`
because it wasn't in the payload, so every player-self write
short-circuited at `if (me?.token)`.
**Fix:** migration 061 exposes the admin's own token in the squad
payload (gated by `auth.uid()` match). App.jsx resolver rewired.
Now combined with §1.1's in-PWA auth modal because mig 061 needs
`auth.uid()` to fire. Commit `77b4bb5`.
**Pre-flight check:** as the new squad's admin, signed in, on
`/admin/<token>`: tap your own status row (IN/OUT/MAYBE). Wait
for realtime to propagate. Open on a second device as a different
player and confirm the admin's status changed.

---

## 2. MULTI-TEAM MEMBERSHIP

### 2.1 Second team-membership unreachable for returning users
**Symptom:** a user who already has one team joins a second team
via a join link. Every app-open lands in the first team; no URL or
My Squads click can reach the second. My Squads accordion collapses
both squads into one.
**Root cause:** `player_join_team` (044) and
`join_team_as_returning_player` (015) reused a single `players` row
across multiple memberships for the same auth user. One
`player.token` → two `team_players` rows. The deterministic
`ORDER BY tp.created_at ASC LIMIT 1` resolver always picked the
earliest team.
**Fix:** migrations 065–069 — fresh `players` row + token per
team-membership. 067 relaxes `link_player_to_user` (one user can
own multiple players). 068 makes `delete_my_account` iterate every
owned player row. Commit `1e7da1f`.
**Pre-flight check:** if the new squad's admin already has a team
on the platform, have them join the new squad's link from the same
signed-in account. My Squads must show both squads as distinct,
clickable rows. Tap into the new squad — the URL must resolve to
the new team's state, not the old one.

### 2.2 "Copy personal link" emitted `/p/<player_id>` not `/p/<token>`
**Symptom:** admin opens Squad screen, taps "copy link" for any
player, pastes — URL doesn't resolve. URL contains the player id
(`p_30834a6b`) not the token (`p_XFGglFrN5xVSo2FJx8I`).
**Root cause:** `SquadScreen.jsx` falls back to `p.id` when
`p.token` is null. Migration 061 stripped `p.token` from non-admin
squad rows in `get_team_state_by_admin_token` and the same in
`get_team_state_by_player_token` (VC route). The fallback silently
shipped player_ids.
**Fix:** migrations 070 + 071 expose `p.token` on every squad row
to privileged callers (admin via admin_token, VC via player_token);
adds `is_self` boolean for the admin's own row. App.jsx admin
resolver switched to `find(p => p.is_self)`. Commits `010b5d4`,
`34cfd23`. Mapper fix in `dbToPlayer` (commit `cdba41d`) — rule #12
in CLAUDE.md.
**Pre-flight check:** as admin, open Squad screen for the new
squad. Tap "copy link" on three different players. Paste each into
a fresh browser tab. All three must resolve to a valid PlayerView,
not 404 or the landing page.

---

## 3. JOIN FLOW

### 3.1 `player_join_team` never generated a player token
**Symptom:** first-time joiner completes OAuth, lands on the
landing page with no apparent team membership. `JoinSuccess.jsx`
silently falls back to `/`.
**Root cause:** the new-player INSERT branch in `player_join_team`
omitted the `token` column, so first-time joiners landed with
`player.token=NULL`.
**Fix:** migration 044 — token generated via the same helper
`create_team` uses. Commit `cec9975`.
**Pre-flight check:** in a completely fresh browser profile,
complete the join flow for the new squad. You must land on
JoinSuccess, then on `/p/<token>?just_joined=1` — confirm the URL
has a real token, not an empty string or `/`.

### 3.2 Player invite link showed team_id instead of join_code
**Symptom:** admin shares the "player invite link" — recipients
land on a broken or wrong-team join page.
**Root cause:** `SquadScreen.jsx` rendered
`in-or-out.com/join/${teamId}` instead of using `team.join_code`.
Masked because `get_team_by_join_code` has a team_id fallback, but
the wrong identifier was being shared.
**Fix:** SquadScreen now fetches the team via `getTeamByAdminToken`
on mount and uses `team.join_code`. Commit `a8b803e`.
**Pre-flight check:** as the new squad's admin, open Squad screen
and copy the player invite link. The URL path segment after `/join/`
must look like a short alphanumeric code, not a `team_` prefixed
ID.

---

## 4. PWA INSTALL

### 4.1 Installed PWA opened to "Paste your link" instead of admin/player view
**Symptom:** admin/player completes onboarding, installs the PWA to
home screen, opens from the icon — lands on the "Paste your link"
welcome screen with no context.
**Root cause:** iOS reads the web manifest at HTML parse time and
ignores any later JS mutations. The default manifest's `start_url`
is `/`. localStorage breadcrumbs don't survive the Safari →
installed-PWA storage boundary on iOS.
**Fix:** per-install dynamic manifest. `/api/manifest?admin=<token>`
and `/api/manifest?player=<token>` emit a manifest whose
`start_url` is `/admin/<token>` or `/p/<token>`. An inline
`<script>` in `index.html` injects the right
`<link rel="manifest">` at HTML parse time. Post-create and
post-join flows hard-redirect to `/admin/<token>?just_created=1`
and `/p/<token>?just_joined=1` so the URL path matches what the
inline script needs. Commits `11614ee`, `2d12db3`, `b7236ca`,
`f62cc7c`, `90bba41`.
**Pre-flight check:** on a real iPhone (not desktop emulator), as
the new admin: complete the create flow → tap "Add to Home Screen"
from the SquadReady page → force-quit Safari → tap the icon. The
app must open directly on the admin panel, not the welcome screen.
Repeat for a player: complete join → install → force-quit → tap
icon → must land on PlayerView.

---

## 5. ADMIN WRITES

### 5.1 `admin_save_teams` cross-team write surface
**Symptom:** none user-visible (defense-in-depth fix). A malicious
admin could pass foreign player_ids from team Y in
`p_team_a` / `p_team_b` arrays and flip their team column.
**Root cause:** the CLEAR statement (mig 043) correctly scoped via
`team_players` join, but the SET statements trusted client-supplied
arrays against the global `players.id` namespace.
**Fix:** migration 048 — same `team_players` scope on both SET
statements. Foreign IDs now silently update 0 rows. Commit
`156dc84`.
**Pre-flight check:** no functional check required for a new
squad — fix is already deployed and isolates each team from every
other. Just confirm you're on a deploy ≥ commit `156dc84`.

### 5.2 PlayerView Live Board team sheet empty after Confirm Teams
**Symptom:** admin builds Smart Teams, confirms, then opens
PlayerView — Live Board team sheet section is empty.
**Root cause:** `admin_save_teams` only wrote `matches.team_a/team_b`
(persistent), never `players.team` (the denormalised column
PlayerView's Live Board reads).
**Fix:** migration 043 extends the RPC to clear + set `p.team` on
every confirm, scoped by team_players join. Commit `a14590b`.
**Pre-flight check:** as admin for the new squad, open Teams
screen, run BUILD TEAMS, then CONFIRM. Open `/p/<any_token>` for
that team in a second tab. Live Board must show both team A and
team B with the correct players listed.

### 5.3 Group Balancer fails for anon-admin / VC callers
**Symptom:** admin or VC opens Make Teams and taps a player then a
group panel. The chip reverts to "Needs Group" and a red error
"Failed to save group — try again" appears. Every other admin
action on the same squad works.
**Root cause:** `admin_set_player_group` and `admin_clear_all_groups`
were the only admin_* RPCs granted to `authenticated` only (mig
031). The session-45 VC parity sweep (mig 075) rewrote function
bodies but didn't touch grants. Anon admins (token-only, no JWT)
and VCs (always anon, authenticate via player_token) were blocked
at the PostgREST permission gate before the body ran.
**Fix:** migration 078 — grants anon execute on both RPCs.
**Pre-flight check:** as a brand-new squad admin who is NOT signed
into Supabase Auth, open `/admin/<your_token>` directly in a
private/incognito window. Make Teams → tap any player in Needs
Group → tap group 1. Chip must land in group 1 and stay there. No
error toast. Then repeat as a VC (with their player_token route).
Both must succeed and produce audit_events rows with the correct
actor_type (`team_admin` vs `vice_captain`).

### 5.4 Brand-new squad first go-live leaves Make Teams broken
**Symptom:** rockybram (new squad "Footy Tuesdays", first-ever match
on 2026-05-26) flipped the live toggle. Players saw the game as
live, but Admin → Make Teams showed "No active match — go live
first before picking teams". POTM voting / payment confirmation /
save-teams all silently broken for the same reason.
**Root cause:** `admin_upsert_schedule` sets `game_is_live=true` but
never creates a `matches` row or sets `schedule.active_match_id`.
Only `admin_reopen_week` (mig 032) did that, and only on the
cancel→relive path. Brand-new squads going Create → Live (without
ever cancelling) ended up with `active_match_id=NULL` forever.
Latent since mig 032; demo + cancel-cycled teams masked it.
**Fix:** migration 077 — new `admin_go_live` RPC (sibling of
`admin_reopen_week` minus the cancel-clear). Inserts the initial
`matches` row and sets `active_match_id`. Idempotent on re-tap.
Client routes: `AdminView/index.jsx openNextWeek` non-cancelled
branch + `ScheduleScreen.jsx` save path both call `goLive` on the
live flip.
**Pre-flight check:** sign up a fresh-Gmail brand-new squad with
no prior matches. Flip the live toggle from ScheduleScreen
(both routes: the toggle row AND the "Save" with gameIsLive flipped
on). Open Admin → Make Teams immediately. The team-builder UI
must render (groups / squad list / SMART + BUILD TEAMS buttons),
NOT the "No active match" empty state. Verify in DB:
`SELECT active_match_id FROM schedule WHERE team_id=<id> AND active`
returns a non-null token starting `m_`.

### 5.5 TeamsScreen CONFIRM button reverted on return
**Symptom:** admin confirms teams, navigates away, returns to Teams
screen — button has reverted to "CONFIRM", state lost.
**Root cause:** race between matchId hydration effect (which set
`teamsConfirmed=true`) and the auto-Smart effect (which read empty
`assignments` from stale closure, decided "nothing assigned", ran
algorithm, called `setTeamsConfirmed(false)`).
**Fix:** hydration now sets `hasAutoFiredRef.current=true` when
already-confirmed, so auto-Smart bails. Commit `a14590b`.
**Pre-flight check:** as admin, confirm teams. Navigate to Squad,
back to Teams. Button must still read "✓ CONFIRMED" / equivalent
locked state.

### 5.6 admin_delete_player rejects Vice Captains (silent failure)
**Symptom:** a VC opens AdminView via their /p/<token> route, taps
"Remove" on a player (orphan-guest banner or SquadScreen) — nothing
visible happens. Banner stays on screen. No toast. Postgres logs
show `invalid_admin_token` errors against `/rpc/admin_delete_player`.
**Root cause (two layers):** (1) per commit `767b499` the AdminView
receives the VC's 21-char player token as `adminToken`, but
`admin_delete_player`'s first guard looks up `teams.admin_token`
(28 chars) — never matches; (2) `removeGuest` in AdminView/index.jsx
swallowed errors with a bare `console.error`, so no UI feedback.
**Fix:** migration 116 — `admin_delete_player` now resolves the
token as `teams.admin_token` first, then falls back to
`players.token WHERE is_vice_captain = true` on the same team as
the target; audit row records `actor_type='vice_captain'`.
AdminView/index.jsx surfaces a red error message under the banner
on RPC failure. Migration 115 (cancelled-ledger guard) shipped in
the same window as a secondary latent fix. Commits `af7dcf0`,
`d5c4763`.
**Pre-flight check:** sign in as a VC on a real team (NOT demo —
demo's lack of team_admins row breaks the VC path). Open AdminView
via the /p/<vc_token> route. Add then remove a temporary guest from
the Squad screen. Removal must commit to the DB (refresh confirms
guest is gone) AND no error message appears in the banner. Second
check: cancel a match for that team first, then try removing any
squad member — the cancelled ledger row must NOT block deletion.
**Class follow-up:** any other `admin_*` RPC with the same
admin_token-only lookup pattern will fail for VCs identically.
Sweep before next release (see BUGS.md session-49 follow-up).

---

## 6. PUSH NOTIFICATIONS

### 6.1 All push notifications silently dead post-deploy
**Symptom:** zero push deliveries despite players having subscribed.
73.7% error rate on Vercel dashboard.
**Root cause:** three layers, all needed fixing:
(1) All four VAPID env vars on Vercel production were stored as
empty strings (set 13 days prior with no value; dashboard masked
this as "Encrypted"). (2) All six `pg_cron` notification jobs
called `https://in-or-out.com` (apex) which 307-redirects to `www`.
`pg_net` strips the `Authorization` header on cross-host redirect →
401 → never delivered. (3) `pg_cron` job 5 (`notif-bibs-24hr`) had
stray password text mid-body causing hourly syntax errors.
**Fix:** fresh VAPID keypair set via `vercel env add --value`,
redeployed. All six cron jobs rewritten via `cron.alter_job` to
use canonical `www` URL. Job 5 body cleaned. Verified live at the
19:45 UTC tick — 4× HTTP 200 vs 4× HTTP 401 baseline.
**Pre-flight check:** before the new squad's first match week,
trigger the test push from admin. On a real iPhone with the PWA
installed and notifications enabled, you must receive the push
within a few seconds. Also confirm in Supabase dashboard that
`notification_log` has a row for the delivery. If zero rows, the
cron is broken — escalate before the squad's first match.

### 6.2 Weekly auto-rollover never fired — `/api/cron` was orphaned
**Symptom:** Tuesday night match plays. Wednesday morning the next
week's match did not auto-open, `auto_open_pending` stays true forever,
no PWA push ever fires. Affected every team — silent because the
endpoint that does the rollover was never wired to any scheduler.
**Root cause:** `apps/inorout/api/cron.js` contains `autoOpenGameJob`
and `advanceGameDateJob`. The file's header comment says it runs
every 15 min via pg_cron or Vercel Cron, but neither was ever
configured. `vercel.json` has no `crons` block; pg_cron held 6 jobs,
all targeting `/api/notify`. Code shipped, scheduler never installed.
**Fix:** migration 117 — `cron.schedule('inorout-cron-main', '*/15 * * * *', ...)`
pointing pg_net at `https://www.in-or-out.com/api/cron`. Migration 118
unsticks the two teams whose schedule rows were frozen on the
2026-05-26 kickoff. Same commit also corrects Footy Tuesdays'
`opens_day/opens_time` from `Monday 20:00` to the intended
`Wednesday 10:00`.
**Pre-flight check:** before any new squad's first match week, in
Supabase SQL editor run
`SELECT jobname, schedule, active FROM cron.job WHERE jobname='inorout-cron-main'`
— must return one row, `active=true`, schedule `*/15 * * * *`. After
the first Tuesday kickoff, on Wednesday at the configured `opens_time`,
confirm the team's `schedule.game_is_live` flips to true and a push
notification arrives on a real iPhone with the PWA installed. If
either fails, escalate — the cron is broken again.

### 6.3 `notify_team_change` unknown-reason warnings
**Symptom:** every account deletion logs
`notify_team_change: unknown reason "player_account_deleted"` —
broadcast still works, but log noise pollutes triage.
**Root cause:** migration 047 added the new reason but didn't
extend the function's hard whitelist.
**Fix:** migration 049 adds the reason. Commit `5a1a0e3`.
**Pre-flight check:** no per-squad check; verify deploy is ≥ commit
`5a1a0e3` if log review is part of go-live monitoring.

---

## 7. REALTIME

### 7.1 Live view dead for anonymous clients
**Symptom:** player on `/p/<token>` doesn't see other players'
status changes without manual reload.
**Root cause:** two issues. `notify_team_change` published to
`team_live:<channel_key>` via `realtime.send` with `private=true`.
RLS on `realtime.messages` is enabled with zero policies → default
deny for anon. AND App.jsx never subscribed to that broadcast
channel at all — only to `postgres_changes` on players/schedule/
matches, themselves RLS-gated on `auth.uid()`. Anon failed both
gates.
**Fix:** migration 062 flips the 4th arg of `realtime.send` to
`false` (public broadcast — channel UUID is the secret). App.jsx
subscribes to `team_live:<key>` via useEffect keyed on
`[teamId, liveChannelKey, route]`. Old `postgres_changes` pipe
retained as fallback for authed sessions. Commit `4061a88`.
**Pre-flight check:** two devices — one as the new squad's admin
on `/admin/<token>`, one as a player on `/p/<token>` in a private
browser window (no auth). Admin marks a player as INJURED. Player
device must update within ~2s without reload.

---

## 8. READS UNDER RLS

### 8.1 H2H modal showed "haven't played in the same game yet"
**Symptom:** Head-to-Head modal opens but renders empty even for
players who have shared many matches.
**Root cause:** `getHeadToHead` did three direct `.from()` reads on
`matches` + `player_match`. Under post-session-24 RLS these return
zero rows for anon callers.
**Fix:** migration 041 — `get_head_to_head_raw_by_admin_token`
SECURITY DEFINER. JS branches on adminToken availability. Commit
`a95e074`.
**Pre-flight check:** on `/admin/<new_squad_token>`, open
PlayerView for any player who has at least 3 match appearances.
Tap into the H2H section against another player who shares matches.
The modal must show a real head-to-head record, not the empty
placeholder.

### 8.2 StatsView form chips + reliability column blank
**Symptom:** Stats screen's per-player form chips and reliability
column show blank for everyone.
**Root cause:** `getPlayerLeagueTable` did direct `.from()` reads,
RLS-blocked on anon. Local tableData hard-coded `reliability:null`
+ `form:[]` because the props (`matchHistory + squad`) couldn't
derive either (need ordered `player_match` rows + all-time attended
counts).
**Fix:** migration 042 —
`get_player_league_table_raw_by_admin_token`. StatsView augments
local tableData with form + reliability from the RPC. Commit
`ed92e2f`.
**Pre-flight check:** on `/admin/<new_squad_token>`, open Stats
screen. For any player with ≥3 matches played, the form chips must
be populated and reliability % must be a real number.

### 8.3 BibsScreen standalone bib assignment broken (known workaround)
**Symptom:** admin tries to assign bibs from the standalone
BibsScreen — write silently fails (RLS-blocked).
**Root cause:** BibsScreen lacks `matchId` + `adminToken` in scope;
direct `insertBib` write is blocked.
**Status:** LOW priority — workaround exists. Bibs can be set via
ScoreScreen result save (which has both). Not yet fixed.
**Pre-flight check:** tell the new squad's admin to set bibs only
via the ScoreScreen result save flow, not the standalone Bibs
section. Re-test if BibsScreen has been overhauled.

---

## 9. DISPLAY-LAYER ARITHMETIC

### 9.1 MyView double-counted ledger debt + this-week's price
**Symptom:** player's My View header shows "£5 + £5 = £10" while
Payments correctly shows £5.
**Root cause:** `PlayerView.jsx` rendered the sum whenever an
unpaid ledger entry existed AND status='in'. The display assumed
`effectiveDebt` = past carry-over and `price` = fresh this-week
fee. Breaks when the ledger entry IS this week's fee (with
`match_id=NULL` because lineup-lock hasn't assigned a match_id
yet).
**Fix:** trust ledger as single source of truth. Commit `a8dd46d`.
**Pre-flight check:** for the new squad's first week with any
unpaid balance, confirm a player's My View header shows the
correct single amount (either "£N owed" or "£N this week", not
both summed).

### 9.2 Smart Teams stuck on "Even game" with empty side
**Symptom:** admin builds teams with all players on one side — UI
still shows "Even game" prediction.
**Root cause:** `computePrediction`'s `mean([]) ?? 0.5` defaulted
both averages to 0.5, producing a draw verdict regardless.
**Fix:** returns `winner=null` when either side has 0 players;
render guard hides the chip; saves NULL to `predicted_winner`.
Commit `d7cfa2f`.
**Pre-flight check:** as admin, deliberately empty team B before
confirming. The "Even game" / prediction chip must hide, not
display "Even game".

### 9.3 Stale prediction after manual swap
**Symptom:** admin generates Smart Teams, manually swaps players,
confirms — saved prediction still reflects the original
algorithmic split.
**Fix:** prediction recomputed on every manual move; saved value
reflects the actual confirmed lineup. Commit `b31af19`.
**Pre-flight check:** as admin, generate teams, then drag/swap at
least one player between sides, then confirm. Re-open the
confirmed match — the prediction must reflect the swapped lineup.

### 9.4 Status confirmation banners persisted on page refresh
**Symptom:** "🔒 Locked in", "👍 No worries we'll find cover" etc.
render on every page load, not just after a tap.
**Fix:** `hideConfirmation` initial value flipped from `false` to
`true`. Banners only render in the 5s window after an actual
`setStatus` call. Commit `19abed9`.
**Pre-flight check:** set a status (IN/OUT), see the banner, wait
5s, refresh the page. No banner on reload.

### 9.5 Wrong-day prompt — "Are you in this Tuesday?" on a Wednesday match
**Symptom:** player tile says the wrong day of week for the match.
**Root cause:** `gameDay` derived from `schedule.gameDateTime`
first (which had drifted in the demo schedule), falling back to
`schedule.dayOfWeek`.
**Fix:** admin-configured `dayOfWeek` wins; timestamp weekday is
fallback only. Commit `c436992`.
**Pre-flight check:** confirm the new squad's `dayOfWeek` is set
correctly in admin's Match Settings; verify PlayerView prompt
matches.

### 9.6 Game-is-live toggle blocked after Cancel This Week
**Symptom:** admin cancels the week, then tries to re-enable —
toggle leaves state conflicted (`is_cancelled=true` AND
`game_is_live=true`), screen still renders cancelled.
**Fix:** new `admin_reopen_week` RPC (migration 032) owns the full
reopen transaction: clears cancelled state, inserts fresh `matches`
row, points `active_match_id` at it, writes `week_reopened` audit
event. Commits `5061508`, `e2f67ea`.
**Pre-flight check:** as admin, Cancel This Week, then re-enable
game. PlayerView for any player must render the active match view,
not the cancelled state.

### 9.7 Cancel This Week left admin-locked players unable to self-toggle next week
**Symptom:** After a cancel, any player who had been admin-locked
to 'in' (`players.admin_locked_in=true`) stayed locked. Their next
self-tap on IN/OUT failed silently — `set_player_status` (mig 038)
raises `admin_locked_in` from inside SECDEF and the client surfaces
nothing useful. Caught on the 2026-05-26 Footy Tuesdays cancel:
17 of 18 players reset cleanly; Ranza (admin-locked at cancel time)
was stranded.
**Fix:** migration 082 adds `admin_locked_in = false` to the bulk
Step 5 reset inside `admin_cancel_match`. Also codifies the live
RPC body (which had drifted to use `resolve_admin_caller`) per
rule 11. New DECISIONS.md rule: any bulk-reset of `players.status`
MUST also clear `admin_locked_in`. Commit `a722354`.
**Pre-flight check:** as admin, lock a test player to IN via the
admin status toggle (sets `admin_locked_in=true`). Cancel the week.
Then have that player self-toggle (via their `/p/<token>` route).
The toggle must succeed and the new status must persist on reload.
DB check: `SELECT COUNT(*) FROM players WHERE admin_locked_in=true`
should be 0 after cancel for the team.
**Still open:** weekly rollover (`open_next_week` /
`advance_game_date`) doesn't clear `admin_locked_in` either. With
9.7 in place a cancelled-then-reopened week is safe, but a non-
cancelled rollover with stale locks is a latent concern. Flagged
for a follow-up audit.

---

## 10. OBSERVABILITY

### 10.1 Silent fire-and-forget RPC failures
**Symptom:** player taps "OUT", UI flips, DB never updates, no
server-side trace.
**Root cause:** player self-write RPCs wrote no `audit_events`
rows. `console.error` on the client was the only failure surface.
**Fix:** migrations 060 (status, paid) + 063 (the other 7 — injured,
add_guest, remove_guest, register_push, unregister_push,
submit_potm_vote, link_player_to_user). Pattern encoded as CLAUDE.md
rule #9 — every new player-self write RPC must INSERT into
audit_events. Commits `77b4bb5`, `284a44e`.
**Pre-flight check:** no per-squad check. Use audit_events as the
go-to triage table whenever the new squad reports "tap did
nothing" — there should always be a row, even on failure.

### 10.3 Parity / smoke tests against production rows (session 45 incident)
**Symptom:** a real player's row shows state the player never set
(locked-in status, placeholder nickname, silently-revoked VC flag).
**Root cause:** an admin_* RPC verification sweep was executed
against live production rows (team_KPaoX8oJYMQ / Footy Tuesdays),
using two real players as guinea pigs. Two issues leaked:
- Bally was left at `status='in', admin_locked_in=true,
  nickname='TempNick'` because the toggle sequence missed the
  matching revert steps.
- Bidz had been legitimately promoted to VC an hour earlier; the
  parity test ended its toggle at `is_vice_captain=false`
  regardless of the starting state, silently undoing the
  promotion.
**Fix (this incident):** direct cleanup via MCP, then a no-op
pass through `admin_update_player_name` / `admin_set_player_status`
so audit_events recorded the fix under `actor_type='team_admin'`.
**Forward fix (open):** see BUGS.md "LOW #0 — No ephemeral fixture
for admin_* RPC parity smoke tests" + DECISIONS.md "ADMIN_* RPC
PARITY / SMOKE TESTS NEVER RUN AGAINST PRODUCTION ROWS". Until
that fixture exists, parity work runs against `team_demo` or a
freshly created throwaway team only.
**Pre-flight check:** before onboarding a new squad, confirm no
admin_* RPC verification has been run against their team's rows.
Query `audit_events` for timestamp clusters (≥3 rows sharing
exact `created_at`) on `team_id=<new_squad>`. Any such cluster
is a sweep, not human activity — investigate before go-live.

### 10.2 App-boot telemetry — PWA opens previously invisible
**Symptom:** can't tell from data whether auto-refresh mitigations
are helping anyone.
**Fix:** migration 064 — `log_app_boot` RPC. App.jsx fires on
every boot capturing route_type, display_mode (standalone vs
browser), session_present_client. Comparison with server-side
`actor_user_id` surfaces "client thinks authed but JWT not
attached" mismatches. Commit `f9788ca`.
**Pre-flight check:** after the new squad's first day, query
`audit_events` filtered to `event_type='app_boot'` for that
team_id. If `display_mode='standalone'` rows are zero but you know
players installed the PWA, the inline-manifest path is broken.

---

## SCOPE OUT

These known issues exist but are LOW priority with documented
workarounds — they do not block onboarding a new squad:

- **BibsScreen standalone write** — workaround via ScoreScreen
  (covered in §8.3)
- **`player_career` table mostly empty** — schema ready (mig 053),
  backfill deferred to Phase 2; affects long-term stats only
- **`scoring.js` filename mismatch** — cosmetic
- **Cross-browser PWA install** — mostly resolved by per-install
  manifest + PWAWelcome polymorphic paste box as escape hatch

See `BUGS.md` "LOW — Known workarounds exist" for full notes.
