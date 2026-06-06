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

## 0. EMAIL / TRANSACTIONAL (Resend) — Phase 9 Cycle 9.1

**Issue class:** transactional email silently doesn't send. Phase 9.1 added a Resend-backed
sender (`apps/inorout/api/_mailer.js`) driven by `onboardingEmailJob` in `api/cron.js`. The
code **no-ops by design** when `RESEND_API_KEY` is unset — so a missing/incorrect env var or
unverified domain means zero emails with no error surfaced to the user.

**Required env vars (inorout Vercel project, Production + Preview):**
- `RESEND_API_KEY` — sending-scoped key from the In or Out Resend account.
- `EMAIL_FROM` — e.g. `In or Out <notifications@in-or-out.com>` (must be on the **verified** domain).
- `REF_APP_URL` / `VENUE_APP_URL` *(optional)* — base URLs so ref/venue links appear in emails;
  omitted gracefully if unset.

**Pre-flight checks (before relying on any email):**
1. Resend dashboard → `in-or-out.com` shows **Verified** (SPF + DKIM green). DNS is at **GoDaddy**
   (`domaincontrol.com` nameservers) — records added under Manage DNS for in-or-out.com.
2. Env vars set in Vercel **and a redeploy has happened** (serverless functions read env at deploy).
3. Live send: approve a real (non-demo) team registration → the team admin receives the
   "You're in" email within ~15 min (cron cadence); confirm a `notification_log` row with
   `channel='email'`, `recipient=<that email>`, `sent_at` set.
4. **Demo caveat:** `team_registration_pending` won't email on the demo venue — `demo_venue`
   has no `venue_admins` row, so there's no recipient. Use a real venue created via
   `superadmin_create_venue` to exercise the venue-admin path.
5. Free-tier limit is **shared across the Resend account** (3k/mo, 100/day). Watch volume if the
   account hosts other projects.

**Status:** code shipped (mig 163, commit `6d73345`); env/DNS set + **live-verified 2026-05-29**
(team_approved → Resend → inbox; `notification_log` channel='email'; dedup confirmed). The
pre-flight checks above remain the re-run procedure for each new venue/squad and for the
still-unexercised `team_registration_pending` (real-venue) path.

---

## 0b. SMS / WHATSAPP (Twilio) — Phase 9 (transport core, UNWIRED) — session 59

**Issue class:** none active yet — `apps/inorout/api/_sms.js` (Twilio) is the transport core
and is **imported nowhere**. It no-ops (`skipped:'no_credentials'`) until `TWILIO_*` env is set,
exactly like `_mailer.js` without `RESEND_API_KEY`. Nothing sends SMS/WhatsApp in production.

**When it gets wired (later 9.x cycle), required env (inorout Vercel, Prod + Preview):**
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — from the In or Out Twilio account.
- `TWILIO_SMS_FROM` — an SMS-capable E.164 number (e.g. `+447700900123`).
- `TWILIO_WHATSAPP_FROM` — a WhatsApp-enabled sender number.

**Pre-flight (before relying on SMS/WhatsApp):** WhatsApp business-initiated messages outside
the 24h customer window require **pre-approved templates** — a real Twilio/Meta onboarding step,
not just env vars. SMS is simpler but needs a verified sender and (for UK) sender-ID rules.
Refs (`match_officials.phone`/`whatsapp_number`/`preferred_channel`) are the first deliverable
recipients; players can't receive SMS until a contact-capture UI populates `players.phone`.

---

## 0c. HQ DASHBOARD (apps/hq) — Phase 6.1 — session 60

**Issue class:** new authenticated app at `/hq`; nothing renders past a blank/sign-in screen
without its Supabase env, and the dashboard is empty without a company + company_admins row.

**Required env vars (new `apps/hq` Vercel project, Production + Preview):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — same values as the other apps (the Supabase
  client throws `supabaseUrl is required` and the app is blank without them). Locally: an
  `apps/hq/.env.local` (gitignored) holding both.

**Pre-flight (operator-owed, real device/account):**
1. Deploy `apps/hq` as its own Vercel project (SPA rewrite is in `apps/hq/vercel.json`); set the
   two env vars above; the OAuth redirect URL (Supabase Auth → URL config) must include the
   deployed origin.
2. Sign in at `/hq` with **tarnysingh@gmail.com** (seeded as `company_demo` super_admin via mig
   170). Expect: company picker hidden (one company), header "Demo Sports Group · super_admin",
   Venue Health Grid showing **demo_venue 🔴** (critical incident) + **Demo Arena South 🟢**.
3. Tap demo_venue → drill-down shows 2 open incidents + its fixtures/leagues. Tap **Resolve** on
   one (add a note) → it disappears, grid incident count drops, an `incident_resolved`
   `audit_events` row lands, and the venue app (`/venue/<token>`) refreshes its open-issues panel
   (the `notify_venue_change('incident_resolved')` broadcast).
4. **Role checks** (need a 2nd Google account added to `company_admins`): an `analyst` sees the
   dashboard but Resolve is hidden / `read_only_role`; a `regional_admin` with `region='South'`
   sees only Demo Arena South.
5. **Demo caveat:** the seed is namespaced (`company_demo` / `venue_demo_south`) and fully
   removable via `170_demo_company_seed_down.sql` — pull it before onboarding a real company.
6. **Preview link (6.5):** as super_admin, tap **Share preview** → copy the `/hq/preview/<token>`
   link → open it in a private window (no login) → confirm the watermarked read-only snapshot
   renders and `hq_preview_tokens.accessed_at` stamps. The deployed origin must serve the SPA
   fallback for `/preview/*` (vercel.json rewrite handles this). Links expire after 7 days.
   "Notify on open" is not wired — `accessed_at` is the only signal for now.

---

## 6.x LEAGUE AVAILABILITY / FIXTURE-REMINDER PUSH — Phase 9 (session 59)

**Issue class:** the two new competitive crons (`availabilityRequestJob` 48h-out;
`fixtureReminderJob` ~2h-before) push via the existing web-push chain. Same silent-failure class
as §6.2 — if no device is subscribed on a competitive squad, nothing delivers and no error
surfaces. **Logic dry-run-verified against the live DB (session 59)** but **real-device delivery
is unverified** (hard-rule #13).

**Operator pre-flight (real-device, owed):**
1. On a real phone, open a competitive squad's `/p/<token>` (e.g. a Competitive FC player),
   install to home screen, and tap **Enable notifications** — confirm a `push_subscriptions`
   row appears (today `dc_subs=0`, so nothing can deliver until this is done).
2. Ensure a competitive `fixtures` row is **48h out** (for the 9am availability push) and/or
   **~2h out** (for the kickoff reminder). The seeded democomp fixtures roll; temporarily set
   `scheduled_date`/`kickoff_time` on a `dc…` fixture if testing off-cycle (revert after).
3. At the UK 9am tick on (fixture_date − 2), confirm the device receives "Are you in?" and a
   `notification_log` row lands with `type='leagueAvailability48h'`, `team_id`, the fixture date.
4. ~2h before kickoff, with the player still `status='none'`, confirm the "Last call" push and a
   `type='leagueFixtureReminder2h'` log row. Marking in/out beforehand should suppress it.
5. Dedup: a second 15-min tick in the same window must NOT re-push (guarded by `alreadyLogged`).

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

### 3.3 `player_join_team` left no audit trail and no realtime broadcast
**Symptom (latent — surfaced via audit, not user report):** new
player completes join, lands successfully, but other browsers
already viewing the team don't see them appear in realtime — only
on the next unrelated broadcast does the squad re-fetch. And if
the join ever goes wrong silently, there's zero server-side trail
in `audit_events` to debug it (which has bitten us in sessions
42/43 join-flow bugs).
**Root cause:** five rewrites of `player_join_team` over time, none
added the audit + broadcast pattern that other player-self writes
adopted in migs 060/063. Violated HARD RULE 9 and HARD RULE 10.
**Fix (mig 128):** body preserved byte-for-byte; added
`INSERT INTO audit_events` (`action='player_joined_team_self'`)
and `PERFORM notify_team_change(p_team_id, 'player_added')`.
Reuses existing whitelisted broadcast reason.
**Pre-flight check:** during onboarding, have a brand-new player
click the join link and sign in. (a) On a second device already
viewing the team as admin, the new joiner must appear in the squad
within ~2 seconds with no manual refresh. (b) In Supabase SQL
editor, run `SELECT * FROM audit_events WHERE
action='player_joined_team_self' AND team_id='<new_team>'` — must
return one row with the new player's id in `entity_id` and the
joiner's name in `metadata->>'name'`. If (a) fails the broadcast
regressed; if (b) is empty the audit hook regressed.

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

### 4.2 Admin rendered as another player on PWA cold-start
**Symptom:** team admin opens their installed PWA from the home
screen and sees a different player's PlayerView (name, stats,
in/out status all belong to someone else). Only the admin route
(/admin/<token>) is affected — /p/<token> player and VC routes
render correctly.
**Root cause:** iOS PWA cold-start can race auth-session
attachment. `supabase.auth.refreshSession()` fires in App.jsx but
the team-state RPC can run before `auth.uid()` is populated.
Server-side, that meant `is_self=false` on every squad row.
Pre-mig-125, the client fell back to `squad[0]?.id` to pick the
admin's identity, and the squad agg had no `ORDER BY` — so the
"first" player was whoever postgres returned that millisecond.
Pre-mig-125 the dice could land on any squad member.
**Fix:** mig 125 added deterministic `ORDER BY tp.created_at, p.id`
to `get_team_state_by_admin_token` and
`get_team_state_by_player_token`, so `squad[0]` is now always the
team creator. The non-impersonation JS guard sits on branch
`fix/admin-impersonation-guard` (kills the squad[0] fallback +
adds an "ADMIN VIEW ONLY" placeholder); held until iPhone PWA test.
Commit `a1c13d0`.
**Pre-flight check:** on a real iPhone in fresh Safari (private
mode), open the new admin's link → DO NOT sign in → Add to Home
Screen → force-quit → tap icon. The name shown in PlayerView must
be the team creator's name. If any other player's name shows: stop
and escalate (auth-attachment race + identity fallback regressed).

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

### 5.3 Cron-driven auto-open leaves schedule with no active match
**Symptom:** admin taps Make Teams from /admin/. TeamsScreen
renders "No active match — go live first before picking teams"
even though players have been marking in/out all day. Schedule's
`game_is_live=true` but `active_match_id` is null and no
non-cancelled matches row exists for the team.
**Root cause:** `autoOpenGameJob` in `api/cron.js` flipped
`game_is_live=true` via a raw `supabase.from("schedule").update(...)`
at opens_day/opens_time, but did NOT create a matches row or set
`active_match_id`. Mig 077 had added `admin_go_live(p_admin_token)`
for the admin UI path; the cron has team_id, not an admin token,
so it bypassed the RPC entirely and left a half-open state from
opens_time until lineupLockJob backfilled the match 60 min before
kickoff.
**Fix:** mig 126 added `admin_go_live_for_team(p_team_id)` — a
team_id-keyed sibling of admin_go_live with the same idempotence
and matches-row ownership, plus `auto_open_pending=false`
(cron-specific). Service-role-only grant. Audit row uses
`actor_type='system'` / `actor_identifier='cron:auto_open_game'`.
cron.js change: replace the raw update + notify with a single
`supabase.rpc('admin_go_live_for_team', { p_team_id })` call.
Commit `c29b20d`.
**Pre-flight check:** the morning after the new team's first
`opens_day/opens_time` window passes, query the schedule. SELECT
`active_match_id, game_is_live` FROM schedule WHERE team_id=...
`active_match_id` MUST be non-null and point to a row in `matches`
with `cancelled=false`. SELECT FROM audit_events WHERE team_id=...
AND action='week_opened' must include a row with
`actor_type='system'` AND
`actor_identifier='cron:auto_open_game'`. If either fails: cron
either didn't fire (check Vercel cron logs) or skipped the new
RPC (check mig 126 applied) — stop and escalate.
**Class follow-up:** every cron job in `api/cron.js` that mutates
schedule/matches/player state shared with an admin UI flow MUST
route through the same RPC the admin UI uses (or a service-role
sibling). Sweep `api/cron.js` before next release for any other
raw `supabase.from(...).update(...)` calls — they are now banned
by DECISIONS.md session-51 rule.

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

### 6.3 Service worker never registered — every push silently dead
**Symptom:** zero `push_subscriptions` rows globally despite players
being on the PWA with iOS notifications enabled. Tapping the in-app
"Enable" button does nothing — no error, no API call, no state change.
**Root cause:** `apps/inorout/index.html` contained a body-tag script
that called `serviceWorker.getRegistrations().then(r => r.unregister())`
on every page load (commit `4515460`, May 10 — intended as a one-time
cleanup for an old buggy SW that caused iOS blank screens). The
matching `register('/sw.js')` was never added. For 17 days every
visitor's SW was actively destroyed and never replaced. `handleSubscribe`
awaited `navigator.serviceWorker.ready` which hangs forever when no
SW is registered → silent stall.
**Fix:** deleted the destructive block. Added
`navigator.serviceWorker.register('/sw.js')` on `window.load` in
`apps/inorout/src/main.jsx`. Safe because the current sw.js has no
fetch handler — cannot recreate the May-10 bug.
**Pre-flight check:** on a real iPhone with the PWA installed (or in
desktop Chrome): `navigator.serviceWorker.controller` must be truthy
after one refresh. Then tap "Enable" inside the app (visible only
when game is live AND status is set). In Supabase SQL editor confirm
`SELECT count(*) FROM push_subscriptions WHERE player_id='<that
player>'` returns 1. If 0, the registration is broken — escalate.

### 6.4 `register_push_subscription` masked three schema drifts
**Symptom:** Enable tap returned 400 with
`{code: 'P0001', message: 'internal_error'}`. No subscription row
written.
**Root cause:** the RPC body had drifted from the live
`push_subscriptions` schema: (1) inserted text `'sub_' || ...` into
a uuid `id` column; (2) inserted into a `player_token` column that
doesn't exist; (3) used `ON CONFLICT (player_id)` without a UNIQUE
constraint on that column. All three errors were rewritten to a
generic `internal_error` by the function's `WHEN OTHERS THEN` catch.
**Fix (mig 122):** added `UNIQUE (player_id)` to push_subscriptions
and rewrote the RPC to let `DEFAULT gen_random_uuid()` fill `id` and
drop the phantom `player_token` insert. Audit insert preserved.
**Pre-flight check:** with a fresh signed-in player and the SW
registered (§6.3), tap "Enable". The network tab should show
`POST /rest/v1/rpc/register_push_subscription` returning 200, and
`SELECT count(*) FROM push_subscriptions` should increment by 1. If
it returns 400, an underlying constraint or column is again out of
sync — the RPC's catch-all hides which, so check
`pg_get_functiondef(oid)` of the RPC against the actual table
columns.

### 6.5 `notification_log` schema drift caused duplicate-push storm
**Symptom:** push notifications arrived correctly but **every 15
minutes** for as long as the game was live. Surfaced live as 4×
duplicate notifications to one player over an hour.
**Root cause:** `notify.js` inserted into `notification_log` with
`id: 'notif_<ts>_<rand>'` (text, but the column is uuid) and into
`queued_for` / `queued_payload` columns that didn't exist. Every
INSERT silently failed. `alreadySent()` always returned `false`
because no rows ever landed → every cron tick re-fired the autoOpen
path.
**Fix (mig 123 + notify.js patch):** added
`queued_for timestamptz` and `queued_payload jsonb` to
`notification_log`. Dropped the text `id` from both INSERTs in
`notify.js` (let `gen_random_uuid()` fire). Removed the now-dead
`makeId()` helper. Surface non-410 webpush errors via
`console.error` so future failures don't silently swallow.
**Pre-flight check:** after the first autoOpen fires for a new
squad, `SELECT count(*) FROM notification_log WHERE
team_id='<team>' AND type='autoOpen' AND game_date='<date>'` must
return exactly 1. The next cron tick (15 min later) must NOT
re-fire — same query still returns 1, and the player must not
receive a second push within the hour.

### 6.6 `notify_team_change` unknown-reason warnings
**Symptom:** every account deletion logs
`notify_team_change: unknown reason "player_account_deleted"` —
broadcast still works, but log noise pollutes triage.
**Root cause:** migration 047 added the new reason but didn't
extend the function's hard whitelist.
**Fix:** migration 049 adds the reason. Commit `5a1a0e3`.
**Pre-flight check:** no per-squad check; verify deploy is ≥ commit
`5a1a0e3` if log review is part of go-live monitoring.

### 6.8 Player-self note never persisted (silently dropped)
**Symptom:** any player marking themselves "out" with a note (e.g.
"away this week — wedding") sees the note appear in UI, then
vanish within seconds-to-minutes once a realtime broadcast or
reload reconciled with the database. Latent since feature shipped;
visibility forced by session 50's realtime broadcast fixes.
**Root cause:** `saveNote()` in PlayerView was a pure React state
setter with no RPC call. There was no `set_player_note` RPC at
all — only the admin variant. Player-self path to the `note`
column did not exist.
**Fix:** migration 124 adds `set_player_note(p_token, p_note)`.
Wrapper added to supabase.js; `saveNote()` now calls it. Audit via
`player_note_updated_self`. Broadcast reason already whitelisted
(mig 049).
**Pre-flight check:** before onboarding a new squad, on a real
device, mark a test player out with a note, force-quit the PWA,
reopen — note must persist. Also confirm in Supabase
`audit_events WHERE action='player_note_updated_self'` has a row.
If empty after a known-good test write, the RPC isn't grant-ed
or the wrapper isn't reaching it.

### 6.7 cron.js read UTC for `opens_time` / midnight, not UK time
**Symptom:** auto-open fired one hour late during BST. Operator set
"12:30" in admin UI; game went live at 13:30 BST on 2026-05-27.
Same drift on `advanceGameDateJob`'s midnight gate (rolled over at
01:00 BST instead of 00:00 BST).
**Root cause:** Vercel Functions run in UTC. `autoOpenGameJob` and
`advanceGameDateJob` used `new Date().getDay() / getHours() /
getMinutes()` and compared those UTC values against admin-entered
wall-clock strings (`opens_day`, `opens_time`) saved naively. GMT
half of the year masked the bug.
**Fix:** added `nowInUkParts()` helper in cron.js using
`Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ... })`.
Both jobs now evaluate "what day / what time" in UK-local. pg_cron
schedule unchanged — JS gates filter the right tick. DST-safe.
**Pre-flight check:** set a team's `opens_time` to "now + 20
minutes" UK-local via admin UI. Within the next 15-min cron window
**after** that UK-local minute, confirm `schedule.game_is_live`
flips to true. Do this during BST specifically — GMT will mask
regressions. If the flip happens an hour late, the fix has
regressed or `Intl` is being mis-evaluated.

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

## 11. PITCH BOOKING (casual ↔ venue)

*Not yet exercised by a live squad. These checks come from the session-53
pre-Stage-7 audit + the bugs it fixed (`202d16a`). Run them the first time a real
team books a real opted-in venue.*

### 11.1 Casual bookings list didn't update live on venue action
**Symptom:** a team admin requests a pitch, the venue confirms/declines/cancels,
but the admin's Match Settings bookings list stays on the old status (e.g.
"Requested") until they leave and re-open the Schedule screen.
**Root cause:** `App.jsx`'s `team_live` subscriber refreshes team state but not
the bookings list; `ScheduleScreen` only loaded bookings on mount. The five
`booking_*` broadcast reasons had no casual subscriber that re-fetched bookings.
**Fix (`202d16a`):** `ScheduleScreen` subscribes to `team_live:<key>` and calls
`loadBookings()` on any broadcast; `liveChannelKey` threaded App → AdminView →
ScheduleScreen.
**Pre-flight check:** two devices. Device A = team admin on `/admin/<token>` signed
in, Match Settings open with a pending booking visible. Device B = venue dashboard
(`apps/venue`) confirms that request from the inbox. Within ~2s Device A's booking
must flip Requested → Confirmed with no manual refresh. Repeat for venue cancel →
the row must update to Cancelled live.

### 11.2 Booking date off-by-one in the BST midnight hour
**Symptom:** a weekly block created late at night (00:00–00:59 BST) is sent to the
venue starting one day early; the start weekday can mismatch the chosen slot.
**Root cause:** `BookPitchModal` / venue `bookingUtil` built `YYYY-MM-DD` via
`new Date(...).toISOString().slice(0,10)` — UTC, so the UK midnight hour rolls
back a day. Same class as §6.7 (cron UK time) and §9.5.
**Fix (`202d16a`):** local-components date formatter (`isoLocal` / `bookingUtil.isoDate`)
everywhere a date string is derived. **Rule:** never use `toISOString()` to derive a
calendar date — always build from `getFullYear/getMonth/getDate` (venue-local).
**Pre-flight check:** during BST, just after local midnight, create a one-off and a
weekly block. The booking date(s) written (check `pitch_bookings.booking_date`) must
match the date picked in the UI, not the day before.

### 11.3 Venue had no way to cancel a confirmed booking
**Symptom:** venue staff can approve/decline pending requests but can't cancel a
*confirmed* booking from the calendar.
**Fix (`202d16a`):** tap any booking block → `BookingDetailModal` with Cancel /
Cancel-whole-series (confirmed) or Confirm/Decline (pending), via the venue-token
wrappers. Frees the slot through the occupancy guard + broadcasts live.
**Pre-flight check:** on the venue dashboard, create a walk-in (tap an empty slot),
then tap that block → Cancel this booking. The block must disappear from the grid
live, and the slot must become tappable/bookable again.

### 11.4 Walk-in / phone booking (venue-created, pre-confirmed)
**Pre-flight check:** on the venue dashboard, tap an empty calendar cell → pick a
registered team OR enter a walk-in name → Confirm. The block appears immediately as
confirmed (no request step). Confirm it lands on the occupancy guard: try to create
an overlapping booking on the same pitch+time — it must be refused (`slot_unavailable`),
never double-book.

### 11.5 Bookings toggle / discovery gating
**Pre-flight check:** in venue Settings, turn bookings OFF. The casual "Book a Pitch"
venue search must no longer return that venue. Turn ON → it reappears. The off-state
must show the venue dashboard's read-only banner with the enable toggle, not a blank
screen.

### 11.6 Renewal right-of-first-refusal (Stage 7, cron at 09:00 UK)
**What:** a weekly block within 21 days of its last week auto-holds the next block for the
team (`create_renewal_holds`); the team taps "Keep slot" (`confirm_renewal` → holds become
`requested`, venue re-approves via the inbox); unconfirmed holds auto-release after a 7-day
grace (`expire_renewal_holds`). Both run inside `renewalHoldsJob` in `api/cron.js`, gated to
the 09:00 UK window via `nowInUkParts()` (DST-safe; same class as §6.7).
**Pre-flight check:** seed a confirmed block whose `ends_on` is ≤21 days away. After the next
09:00-UK cron tick: (a) the team's ScheduleScreen shows a "Renewal held · keep by <date>" row
with a **Keep slot** button, and a push arrives on the admin's device; (b) `SELECT status FROM
booking_series` shows the origin `ending` + a child renewal `active` with `hold` bookings +
active priority-2 occupancy. Tap **Keep slot** → the row flips to **Requested** and the venue
inbox shows the pending series to confirm. Separately, let a hold pass its `hold_expires_at`
→ next 09:00 tick must flip it to `expired`, free the occupancy, and push "renewal lapsed".
If the cron didn't fire, check `cron.job` (§6.2) and that the 09:00 gate matched UK time.

### 11.7 Superseded displacement push (Stage 7, every cron tick)
**What:** when a league fixture bumps an un-confirmed booking, `tg_sync_fixture_occupancy`
stamps `pitch_bookings.superseded_at`; `supersededPushJob` (every 15-min tick) pushes the
displaced team's admins. Dedup via `notification_log (team,'booking_superseded',gameDate)`.
**Pre-flight check:** schedule a fixture onto a pitch+time that overlaps a `requested` casual
booking. Within the next tick, the displaced team's admin gets a "Booking bumped" push, and
`notification_log` has exactly one `booking_superseded` row for that team+date (no duplicate
on the following tick). The booking shows `superseded` in the team's list (live, in-app).

### 11.8 Booking-confirmed push (session 54, every cron tick)
**What:** when a venue confirms a casual request (`venue_confirm_booking`), `confirmPushJob`
(every 15-min tick in `api/cron.js`) pushes the team's admins "Pitch booking confirmed". It
polls `audit_events` (`action='booking_confirmed'`, last 20 min) — the committed marker, so
no schema change — joins back to `pitch_bookings` (`team_id IS NOT NULL`), and **collapses a
block series to one push per (team, series)** so a multi-week confirm isn't N notifications.
Dedup via `notification_log (team,'booking_confirmed',gameDate=min booking_date)`; in-app the
team already flips Requested→Confirmed live via the `team_live` subscriber.
**Pre-verified (session 54, no real device):** the audit-poll join + grouping proven against
the live DB with an ephemeral insert+rollback (3-week block → 1 group, one-off → 1 group;
0 rows persisted); `get_team_admin_player_ids` returns admins only (demo: 38-player roster →
`[]`); 0 duplicate `notification_log` send-groups exist; venue Bookings surface smoke-loaded
on demo_venue (inbox, calendar, confirmed block paints, tap-block detail/cancel modal).
**Operator-owed (auth + device, demo not valid):** sign in a real test-squad admin, confirm
a real request from the venue inbox, and verify the "Pitch booking confirmed" push actually
lands on the iPhone (the cron proves it *fires and targets correctly*, not that iOS shows the
banner). Confirm `notification_log` has exactly one `booking_confirmed` row per confirm and no
duplicate on the following tick.

---

## 12. CASUAL POST-GAME PIPELINE (week rollover · payments · bibs · stats) — session 68

**Issue class:** a real game completed and the next week's board, the payments
totals, the admin Bib tracker, the Stats table, and Share Results were all wrong.
Two deep root causes (migs 204–206) plus display id/name regressions. None surfaced
in build/type/hygiene — only a real squad playing a real week exposed them.

**12a. New week opens but the board is "locked" (can't say in/out).**
Cause: opening a week never reset player `status`; last week's whole squad stayed
`status='in'`, so the squad read as full and `set_player_status` threw `squad_full`.
Fixed mig 204 (go-live resets status/team/admin_locked_in; payments carry over).
- **Pre-flight:** after the auto-open (or manual "Open Next Week"), confirm every
  player shows **no-response** (not carried "in"), the IN count is 0, and a player on
  `/p/<token>` can tap In and Out freely. Verify against a REAL team (not demo — demo
  has its own reset cron). SQL spot-check: `SELECT count(*) FILTER (WHERE status='in')
  FROM players p JOIN team_players tp ON tp.player_id=p.id WHERE tp.team_id=<team>` = 0
  right after open.

**12b. Outstanding shows £0 / nobody charged after a played game; empty payment history.**
Cause: `admin_save_match_result` keyed "fresh save" on player_match row count, but the
kickoff lineup-lock pre-creates those rows → every save ran as a re-save and skipped the
charge/stats/history cascade. Fixed migs 205/206 (freshness via `matches.winner`; adds
payment_ledger charge rows). **Never let any new code set `matches.winner` before the
admin's first result save** — it would re-break this.
- **Pre-flight (do once per squad after their first real result):** save a result with a
  known set of non-payers, then check Admin → Outstanding reflects `£(price × non-payers)`,
  the Payments screen lists them as owing, and each owing player's payment history shows a
  `game_fee`/unpaid row for that match. Audit check: the `match_result_saved` audit_event
  for that match has `is_fresh_save: true`. A `false` on a first save means the freshness
  signal is defeated — STOP.

**12c. Admin Bib tracker empty.**
Cause: result-save wrote the bib holder onto the match but never into `bib_history` (the
table the tracker reads). Fixed mig 205 (bib_history cascade).
- **Pre-flight:** after a result with a bib holder set, Admin → Bibs shows that player as
  current holder; `SELECT count(*) FROM bib_history WHERE team_id=<team> AND returned=false`
  ≥ 1.

**12d. Stats showed only the POTM; Share Results / Bib-duty / POTM-avatar wrong.**
Cause: matches store player **IDs** (team_a/team_b/scorers/motm/bib_holder) but several JS
consumers resolved by name only. Fixed in StatsView (id-first resolver + bib counting),
HistoryView share text, Avatar (POTM trophy badge), AdminView (orphaned-guest Remove → 'none').
- **Pre-flight (on a real phone after deploy):** Stats tab lists the whole squad (not just
  POTM); Results → Share Results shows names in Team A/B + scorers; last POTM's avatar carries
  the 🏆 (bottom-right); Bib Duty lists holders; the host-dropped-out "Remove" un-enters the
  guest (keeps them in the squad).

**Status:** all fixed + live-backfilled for Footy Tuesdays (£45 across 9 players) session 68.
Migs 204/205/206 + JS commits on `main`. End-of-session audit confirmed the freshness signal
is unbreakable and no other real team carries latent debt. The checks above are the re-run
procedure for each new squad's first full week + first result.

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
