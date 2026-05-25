# In or Out — Known Bugs & Tech Debt
*Last updated: May 25 2026 (session 42 — multi-team player model + admin/VC share links)*

**Read this at the start of every session before touching any code.**

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

## PARTIALLY MITIGATED — needs deeper fix (session 41)

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
**Full fix deferred:** requires establishing auth INSIDE the PWA
storage scope, OR a server-set cookie bridging mechanism, OR continued
decoupling of features from auth.uid(). Options scoped in plan file.
**Affects (still latent until full fix):**
- MySquads accordion (`getPlayerTeams` is auth.uid()-only — returns
  empty for anon PWA users).
- POTM voting reads (`getPOTMVotingState` etc. — RLS-gated).
- Push notification delivery (subscriber writes work via token, but
  some downstream paths may use auth).
- Admin-route self-writes from PWA without auth (migration 061
  exposes token only when auth.uid() matches — falls back to
  no-token-no-action otherwise).

---

## STILL ON HOLD — admin-badge cycle (session 41, NOT committed)

Working tree has the following edits, NOT staged, NOT pushed. Decision
deferred to next session. Files:
- `apps/inorout/src/views/AdminView/SquadScreen.jsx` — VC toggle unhide
  for VC viewers (line 703 gate change).
- `apps/inorout/src/views/MySquads.jsx` — ADMIN badge condition
  expanded from `is_vice_captain` to `is_vice_captain || is_team_admin`.
- `apps/inorout/src/views/PlayerProfile.jsx` — VC toggle unhide for
  VC viewers (line 568 gate change).
- `rls_migrations/058_player_get_teams_admin_flag.sql` — adds
  `is_team_admin` flag to `player_get_teams` RPC. **Migration applied
  to live DB** — source file in tree but not committed.
- `rls_migrations/058_player_get_teams_admin_flag_down.sql` — rollback.

Pre-existing latent risks documented in the plan file:
- If a VC accesses AdminView from `/p/<player_token>` route, the
  `admin_set_vice_captain` RPC will reject the player token as
  invalid_admin_token. Currently Tarny (only VC) uses `/admin/<token>`,
  so not exercised, but unhiding the toggle exposes the failure path.
- HeroCard "Admins" block (G change) was scoped but never built — needs
  `is_team_admin` per-squad-player flag (migration 059) which is also
  not committed.

Next session: decide whether to ship the admin-badge cycle as a clean
small commit, or unscope it. The 058 migration being live but
uncommitted breaks the source-vs-live invariant (CLAUDE.md rule 11).

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
