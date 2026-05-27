# In or Out — Known Bugs & Tech Debt
*Last updated: May 27 2026 (session 51 — PHASE 3 COMPLETE + Phase 5 plan approved + skills framework hardened + notify_venue_change regression silently fixed in mig 127)*

---

## RESOLVED — notify_venue_change regressed in mig 121, fixed in mig 127 (session 51)

**Symptom (latent — server logs):** every Phase 2 RPC that calls
`notify_venue_change` (e.g. `venue_update_fixture_status` posting
`fixture_postponed`, `fixture_voided`, `fixture_walkover`,
`fixture_forfeit`) has been logging WARNING `unknown reason "X"`
since mig 121 landed a week ago. Realtime broadcasts still fired
(the warning is non-blocking), but every Phase 2 venue write was
spamming the Postgres log.

**Root cause:** mig 121 introduced the `notify_venue_change`
broadcast helper for Phase 3 ref events and inadvertently
overwrote the existing mig 101 body. Mig 101 had a 26-reason
whitelist (Phase 2 venue/league/fixture/ref/pitch/team events).
Mig 121's `CREATE OR REPLACE` shrunk the list to 3 reasons
(`match_started`, `match_event_recorded`, `match_result_saved`).
Every pre-existing reason started hitting the WARNING branch.

**Fix (mig 127, session 51):** since cycle 3.6 was rewriting
`notify_venue_change` anyway to add `'result_corrected'`, restored
the full Phase 2 list + added Phase 3 reasons in one body. Down
migration deliberately re-introduces the regression (a down must be
a strict revert of its up; the regression-fix is a side-effect of
127 that should go away if 127 is rolled back). Documented in mig
127 header. Commit: `563201b`.

**Audit reveals:** the same failure class could affect other
`notify_*` helpers if a future Phase rewrites them. Mitigation:
the existing `check-rpc-columns.sh` doesn't catch whitelist
shrinkage. Worth a future deterministic check (`check-notify-whitelist.sh`?)
but not in scope for any active cycle.

---

## RESOLVED — Reserve drag-to-reorder never persisted (session 51, feature wire-up)

**Symptom (latent — admin UX):** the admin home screen's reserves
section let admins drag-reorder reserve players. The drag worked
visually but the order was pure local React state. Refresh, route
change, or any realtime broadcast wiped it. There was no DB column
to store the order in at all, only a boolean `priority` flag.

**Verdict (per product decision):** the drag is supposed to persist
— the order means "who comes off the bench first when a spot opens".
Wired up as a new feature.

**Fix:**
- **mig 130:** `ALTER TABLE team_players ADD COLUMN reserve_priority_order int NULL`,
  plus a trigger `manage_reserve_priority_order_trg` on `players AFTER
  INSERT OR UPDATE OF status` that auto-maintains the column:
  - status becomes 'reserve' → append at MAX+1.
  - status leaves 'reserve' → clear that row's order, compact remaining
    reserves so there are no gaps.
  The trigger covers every status-change path because every RPC that
  changes status runs `UPDATE players SET status=…` (verified across
  set_player_status, admin_set_player_status). Backfill skipped — zero
  reserves existed in prod at apply time.
- **mig 131:** `admin_reorder_reserves(p_admin_token, p_reserve_ids text[])`
  SECDEF. Validates admin token, no duplicates, full reserve set
  (concurrency guard), every id is currently a reserve on the admin's
  team. Atomically writes positions 0..N-1. Audits via
  `admin_reorder_reserves` action. Broadcasts `player_updated`.
  Granted to anon + authenticated per parity-sweep pattern (mig 075).
- **mig 132:** added `reserve_priority_order` to the squad jsonb in
  `get_team_state_by_admin_token` and both branches (privileged +
  non-privileged) of `get_team_state_by_player_token`. Also extended
  `v_player` so the user's own bench position is available without
  depending on the squad payload (non-priv branch excludes self).
- **JS:** `dbToPlayer` mapper picks up `reservePriorityOrder` (HARD
  RULE 12). New wrapper `adminReorderReserves(adminToken, reserveIds)`
  in supabase.js, exported via the barrel. New helper
  `sortByReservePriority(players)` in `@platform/core/engine/availability.js`,
  used inside `groupByStatus` and at the three admin-display /
  spotOpened sites (App.jsx, PlayerView.jsx, AdminView/index.jsx).
- **AdminView/index.jsx `moveReserve`:** rewritten — async, optimistic
  local update (writes new `reservePriorityOrder` onto every affected
  squad row), calls `adminReorderReserves`, rollback on error. Same
  shape as today's reserveGuest fix.

**Smoke tests (DB-side, pre-deploy):**
- Trigger append: 3 demo players flipped to 'reserve' in sequence →
  trigger assigned 0, 1, 2 ✓
- Trigger gap-close: promoted middle reserve to 'in' → that row
  cleared to NULL, third compacted from 2→1 ✓
- `admin_reorder_reserves` shuffle: reordered [03,01,02] → pg state
  matched 0,1,2 in that order ✓
- `get_team_state_by_admin_token` returned `reserve_priority_order`
  on each squad row ✓
- Restore: all demo players back to 'none', orders NULL ✓

**Verification target (UI):** on /admin/ with ≥2 reserves, drag one
reserve above another. Refresh the page — new order persists. On a
second device viewing the same team, the order matches. Promote the
top reserve to 'in' — second reserve compacts to position 0.

**Free win:** PlayerView's `spotOpened` notification (when an "in"
player drops out) sends to `reserves[0]`. With the new sort,
`reserves[0]` is now the highest-priority reserve per admin's chosen
order, not whatever happened to be first in the raw squad array.

---



---

## RESOLVED — Admin rendered as another player on PWA cold-start (session 51)

**Symptom:** rockybram (team creator + admin of "Footy Tuesdays")
opened his iOS PWA today and was rendered as Pritpal — a regular
squad member. Affected every team creator whose access token had
expired client-side at PWA cold-start. Player and VC routes
unaffected (different code path).

**Root cause — twin latent bugs:**
1. `get_team_state_by_admin_token` (mig 070) and
   `get_team_state_by_player_token` (mig 080) built their squad
   via `jsonb_agg(jsonb_build_object(...))` with no `ORDER BY`.
   Squad order was non-deterministic — every call could return
   players in a different order.
2. App.jsx:1168 had a "best-guess" fallback when `myPlayer` was
   null: `myId = myPlayer?.id || (isAdmin ? squad[0]?.id : null)`.
   Combined with (1), unauthed admins on /admin/<token> were rendered
   as whoever squad[0] happened to be that millisecond.

iOS PWA cold-start was the trigger: refresh_token works but the
session attaches asynchronously, so `auth.uid()` was null when
the team-state RPC fired → `is_self=false` on every row → fallback
fired → Pritpal won the dice roll.

**Fix (mig 125, commit a1c13d0):** added `ORDER BY tp.created_at, p.id`
to all three squad `jsonb_agg` calls (admin RPC + privileged and
ordinary branches of the player RPC). Team creator is always first
now. Belt-and-braces JS-side guard exists on branch
`fix/admin-impersonation-guard` (kills the `squad[0]` fallback +
adds an "ADMIN VIEW ONLY" placeholder) — held until iPhone PWA test.

**Verification target:** open any admin link on a fresh iPhone Safari
in private mode → don't sign in → Add to Home Screen → open from
icon. Should see your own admin's PlayerView, not another player.
audit_events should show `app_boot` with `actor_user_id=null` AND
the rendered identity matching the team creator (squad[0] from
deterministic order).

---

## RESOLVED — "No active match" on admin Make Teams after cron auto-open (session 51)

**Symptom:** rockybram tapped Make Teams from /admin/. TeamsScreen
rendered "No active match — go live first before picking teams".
`schedule.game_is_live` was true (players had been marking in/out
all day) but `schedule.active_match_id` was null and no
non-cancelled matches row existed.

**Root cause:** `autoOpenGameJob` in api/cron.js (15-min cron that
opens the week at opens_day/opens_time) flipped `game_is_live=true`
via a raw `supabase.from("schedule").update(...)` but did NOT create
a matches row or set `active_match_id`. Mig 077 had fixed this for
the admin-UI go-live path by adding `admin_go_live(p_admin_token)`,
but the cron has team_id not an admin token, so it bypassed
admin_go_live entirely.

Latent since mig 077 shipped (the cron path was never updated to
match). Every team whose week is opened by cron (rather than by an
admin manually tapping Go Live in the UI) is in the broken state
from opens_time until lineupLockJob backfills the match 60 min
before kickoff.

**Fix (mig 126, commit c29b20d):** added `admin_go_live_for_team(p_team_id)`
RPC — team_id-keyed sibling of admin_go_live with the same
idempotence and matches-row ownership, plus `auto_open_pending=false`
(cron-specific). Service-role-only grant (anon + authenticated
REVOKED). Audit row uses `actor_type='system'` /
`actor_identifier='cron:auto_open_game'` to distinguish cron-driven
opens from admin-driven opens. cron.js change: replace the raw
update + notify with a single
`supabase.rpc('admin_go_live_for_team', { p_team_id })` call.

**Verification target:** wait for next Wednesday 14:34 (Footy
Tuesdays' opens_time). Confirm `audit_events` shows a `week_opened`
row with `actor_type='system'`,
`actor_identifier='cron:auto_open_game'`, and that the schedule has
`active_match_id` set to a non-cancelled match. Admin Make Teams
should be usable immediately, not blocked until 19:00.

**Recovery for rockybram (in-session):** called
`admin_go_live(admin_0OcDVOpcoGnujleetMhGYw)` manually via MCP to
backfill match `m_WXZHG_SM9Zc`. No data loss; no UI restart
required (realtime broadcast updated his client).

---

## RESOLVED — `reserveGuest` admin handler never persisted to DB (session 51)

**Symptom (latent, niche):** when a player who brought a "+1"
guest changes their own status away from "in", the guest becomes
an orphan and appears in the admin home screen's orphan panel.
The panel offers two buttons: "Remove" (worked) and "Move to
reserve" (didn't). Tapping "Move to reserve" visually moved the
guest out of the orphan list but the status flip lived only in
local React state — no RPC call. Within seconds the next realtime
broadcast (any teammate's status change, cron tick, anything)
re-fetched the squad from the DB, the guest reverted, and the
orphan re-appeared. Groundhog Day for the admin.

**Root cause:** [AdminView/index.jsx:146]
(apps/inorout/src/views/AdminView/index.jsx#L146) `reserveGuest`
was a one-liner: `setSquad(squad.map(...status:"reserve"));
dismissOrphan(id);` — exactly the same shape as today's earlier
`saveNote` bug. Pure local state, zero persistence. The wrapper
`adminSetPlayerStatus(adminToken, playerId, status)` existed at
supabase.js:1265 but was never imported into this file.

**Fix:** import `adminSetPlayerStatus`, make `reserveGuest` async,
optimistic local update first, RPC call, rollback `setSquad(prev)`
on error. Audit + broadcast are handled inside the RPC.

**Verification target:** as admin, with a +1 currently in the
squad whose host has dropped to "out"/"maybe", tap "Move to
reserve" on the orphan panel. Within seconds the guest's
`players.status` in DB should be "reserve", an `audit_events` row
should appear with `action='admin_set_player_status'`, and the
admin's view should NOT re-show the orphan on the next broadcast.

**Audit context:** found via the methodical re-audit (Category 1
silent-persistence sweep). Same class as the player-note bug
fixed earlier today; that suggests pure-state handlers were a
mini-pattern in admin orphan-handling code, not a one-off.

---

## RESOLVED — `link_player_to_user` missing realtime broadcast (session 51)

**Symptom (latent, niche, surfaced via re-audit):** user has
`/p/<token>` open in one tab and `/admin/<token>` open in another
(or PWA + browser tab). Signs in on the player tab → `user_id`
gets set in the DB. Admin tab's cached squad payload still has
`user_id=null` for that row → server-computed `is_self=false` →
`needsSelfAuth = isAdmin && !me?.isSelf` at PlayerView.jsx:96
stays true → OTP modal keeps popping on admin tab until manual
refresh.

**Root cause:** `link_player_to_user` UPDATEs `players.user_id`
but never broadcasts. Audit is present (good). Violated HARD
RULE 10 — strict reading. Rare in practice because the function
is only called once per (player, user) lifetime per
App.jsx:560's `!player.userId` gate, but real when it triggers.

**Fix (mig 129):** body preserved byte-for-byte; one new
statement — `PERFORM notify_team_change(v_team_id, 'player_updated')`
— inside the existing `IF v_team_id IS NOT NULL` block, right
after the audit INSERT. Reuses whitelisted reason. `search_path`
tightened from `public` to `public, pg_temp` (matches migs
063/124/128).

**Verification target:** open the team in two tabs as the same
user (one /p/, one /admin/). On the player tab, sign in for the
first time. On the admin tab, `is_self` should refresh and the
OTP modal should not re-pop on the next admin self-write.

**Auditing process learning:** I initially downgraded this
finding to "intentional non-broadcast" on a pragmatic argument
(no obvious other-client UI dependency on `user_id`). The user
pushed back and asked me to verify further. Greping turned up
the PlayerView.jsx:96 dependency — `is_self` IS gated on the
server-computed value, which the broadcast keeps in sync. The
moral: when the rule is strict, the cost of compliance is
trivial, and the failure mode is real-but-rare — fix it, don't
downgrade. Recorded so I don't make the same call next time.

---

## RESOLVED — `player_join_team` left no audit trail and no realtime broadcast (session 51)

**Symptom (latent):** a new user clicking the join link successfully
created their player + team_players rows, but (1) no row landed in
`audit_events`, so any silent join failure left zero server-side
trace — particularly painful given the join flow has historically
been the most fragile path (sessions 42/43 multi-team bugs); and
(2) no realtime broadcast fired, so existing admin and player
browsers stayed stale on the squad until an unrelated event
(someone toggled status, cron tick, etc.) re-fetched.

**Root cause:** the function had been through five rewrites
(migs 028, 044, 065, 081, …) tracking other concerns (per-team
membership, multi-row split, token regeneration) but never picked
up the audit + broadcast pattern that migs 060/063 established for
player-self writes and mig 049 established for broadcast reasons.
Violated HARD RULE 9 (every fire-and-forget RPC INSERTs into
`audit_events`) and HARD RULE 10 (server-side writers broadcast).
Surfaced during the targeted re-audit, not by any user report.

**Fix (mig 128):** body preserved byte-for-byte; two new statements
inserted between the team_players INSERT and the final SELECT:
- `INSERT INTO audit_events (...)` with `actor_type='player'`,
  `actor_identifier='player_token:'||md5(v_ptoken)`,
  `action='player_joined_team_self'` (mig 063 player-self pattern).
- `PERFORM notify_team_change(p_team_id, 'player_added')` — reuses
  existing whitelisted reason (semantically identical to
  admin_add_player's broadcast).
- `search_path` tightened from `public` to `public, pg_temp`
  (matches migs 063/124).

**Verification target:** trigger a fresh join on a real device.
Query `audit_events WHERE action='player_joined_team_self'` — must
show one row with the new player_id in `entity_id`. On a second
browser already viewing the team as admin, the new joiner must
appear in the squad without manual refresh.

**Defense-in-depth note (separate):** `player_join_team` has a
legacy `PUBLIC` EXECUTE grant. Anon callers are blocked by the
internal `auth.uid()` check, so it's not exploitable — but the
grant should be REVOKEd from PUBLIC in a follow-up grants-cleanup
sweep, alongside any sibling RPCs in the same boat.

---

## RESOLVED — Player note never persisted to the database (session 50 follow-up)

**Symptom:** player marks themselves "out" via PlayerView, types a
note explaining why ("away this week"), taps Save Note. Note shows
in the UI. Minutes later — after any realtime broadcast, route
change, or page reload — the note vanishes. Affects every team,
every player; has been broken since the note feature shipped.

**Root cause:** `saveNote()` in [PlayerView.jsx:320-323]
(apps/inorout/src/views/PlayerView.jsx#L320-L323) was a pure React
state setter with zero database persistence — no RPC, no Supabase
write. The note lived only in browser memory. `setStatus()` also
folded `note` into local state at line 283 but the downstream RPC
call (`set_player_status` at line 286) writes only the status
column. The note column on the players table was never touched by
any player-self path. The only note-writing RPC in the codebase
was `admin_set_player_note` (mig 012, requires admin token).
Latent since the feature shipped; surfaced now because session 50's
realtime broadcast fixes made local-state clobbering by re-fetches
visible within seconds rather than only on full reload.

**Fix (mig 124 + supabase.js + PlayerView):**
- New RPC `set_player_note(p_token, p_note)` — mirrors
  `admin_set_player_note` but token-authed. Max 200 chars,
  NULL/empty/whitespace clears, SECURITY DEFINER, audit via
  `player_note_updated_self` (mig 063 pattern), broadcasts
  `notify_team_change(..., 'player_note_updated')` — reason
  already whitelisted in mig 049.
- `setPlayerNote(token, note)` wrapper in `supabase.js`.
- `saveNote` in PlayerView now fires the wrapper after closing
  the modal. `setStatus` left as-is (status-only path; note
  persistence is via Save Note).

**Verification target:** mark yourself out with a note via
PlayerView, force-quit the PWA, reopen — note must still be
present. Confirm `audit_events` has a row with
`action='player_note_updated_self'` for your write.

---

**Read this at the start of every session before touching any code.**

> For the operator-facing pre-onboarding pre-flight (every production
> issue grouped by failure domain with a device-level check for each),
> see **`GO_LIVE_ISSUES.md`**. New production issues must be added there
> in the same commit as the fix.

---

## RESOLVED — cron.js evaluated `opens_time` / midnight gate in UTC, not UK time (session 50 follow-up)

**Symptom:** Footy Tuesdays' `opens_time` set to "12:30" via admin UI
fired at 13:30 BST on 2026-05-27. Same one-hour drift would have
applied to every team's auto-open during BST (Mar–Oct). The midnight
`advanceGameDateJob` gate had the same flaw — UK-midnight rollover
fired at 01:00 BST.

**Root cause:** Vercel Functions run in UTC. `autoOpenGameJob` and
`advanceGameDateJob` used `new Date().getDay() / getHours() /
getMinutes()` and compared those UTC values against operator-entered
wall-clock strings (`opens_day`, `opens_time`) saved naively by the
admin UI with no timezone metadata. GMT half of the year masked the
bug — the offset is zero, so it "worked" Nov–Mar.

**Fix:** added `nowInUkParts()` helper in cron.js using
`Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ... })`.
Swapped both `autoOpenGameJob` and `advanceGameDateJob` to use the
helper. pg_cron's UTC firing schedule is unchanged — the JS gates
filter to the right tick. DST-safe because Intl handles the BST/GMT
switch.

**Not in scope (still open):** `advanceGameDateJob` does
`d.setDate(d.getDate() + 7)` to roll to next week, which preserves
the absolute instant — meaning wall-clock kickoff time shifts by one
hour for the week containing each DST boundary. Codebase has lived
with this for years; fix requires DST-aware date math; tracked
separately.

**Verification target:** next BST tick where an operator-set
`opens_time` should fire (any team's auto-open, or any midnight
rollover). Confirm `schedule.game_is_live` flips at the right
UK-local minute and a push lands on a real iPhone.

---

## RESOLVED — Push notification chain was broken at five separate hops (session 50)

**Symptom:** zero push notifications had ever been delivered for any
team. Discovered while testing the auto-rollover fix below — Footy
Tuesdays' game went live, but no PWA push fired.

**Root cause(s):** Five independent bugs stacked on the same flow.

1. **Internal `/api/notify` calls 401-ed.** `apps/inorout/api/cron.js`
   built its base URL from `process.env.VERCEL_URL`, which on Vercel
   resolves to the per-deployment hostname (e.g.
   `inorout-xxx.vercel.app`). That hostname is behind Vercel
   Deployment Protection and 401s every POST. Same failure family as
   GO_LIVE_ISSUES.md §6.1's `pg_net` cross-host redirect.
   **Fix:** hardcoded `base = 'https://www.in-or-out.com'` in cron.js.

2. **No realtime broadcast after cron writes.** `autoOpenGameJob` did
   a raw `UPDATE schedule SET game_is_live=true` — but never called
   `notify_team_change`. Open browser tabs / PWAs only saw the flip
   on hard refresh. Violated CLAUDE.md hard rule #10.
   **Fix:** added `notify_team_change` after every cron write in
   `autoOpenGameJob` (`game_live_toggled`), `advanceGameDateJob`
   (`schedule_updated`), `lineupLockJob` (`schedule_updated`),
   `potmVotingOpenJob` (`potm_voting_opened`), and all three
   `potmTallyJob` branches (`potm_result_announced`).

3. **No service worker ever registered.** Commit `4515460` (May 10,
   "fix iOS blank screen — unregister service worker") cut sw.js to
   the current 36-line minimal handler AND added a body-tag script
   that called `serviceWorker.getRegistrations().then(r =>
   r.unregister())` on every page load. The matching `register(...)`
   call was never added. For 17 days the app actively destroyed any
   SW that any user might have had, and added none. `push_subscriptions`
   had 0 rows globally as a consequence. `handleSubscribe` awaited
   `navigator.serviceWorker.ready` which hangs forever when no SW is
   registered — silent failure, no console error, no API call.
   **Fix:** removed the destructive block from `apps/inorout/index.html`
   and added `navigator.serviceWorker.register('/sw.js')` on
   `window.load` in `apps/inorout/src/main.jsx`. Safe because the
   current sw.js has no fetch handler — the blank-screen class of bug
   cannot recur.

4. **`register_push_subscription` RPC had three schema drifts.**
   - Inserted `'sub_' || ...` text into the `id` uuid column.
   - Inserted into a `player_token` column that does not exist.
   - Used `ON CONFLICT (player_id)` without a UNIQUE constraint on
     that column.
   All three failures were masked by the function's
   `WHEN OTHERS THEN ... 'internal_error'` catch-all, so every Enable
   tap silently no-op'd.
   **Fix (mig 122):** added `UNIQUE (player_id)` to push_subscriptions
   and rewrote the RPC body to let `DEFAULT gen_random_uuid()` fill
   `id`, drop the phantom `player_token` insert, and preserve the
   existing audit row.

5. **`notification_log` had matching schema drift.** `notify.js`
   inserted with `id: makeId()` (text) into a uuid column, and into
   non-existent `queued_for` / `queued_payload` columns. Every INSERT
   failed silently. Because `alreadySent()` read the empty table,
   every cron tick re-fired the autoOpen push for every team with a
   live game. Caught live as 4× duplicate notifications on the test.
   **Fix (mig 123 + notify.js patch):** added `queued_for timestamptz`
   and `queued_payload jsonb` columns; dropped the `id: makeId()`
   literal so the uuid default fires; removed the now-dead `makeId`
   helper; fixed pushToSubs / direct-queue path to read the player
   token via PostgREST embed (`select=..., players(token)`) since
   push_subscriptions has no token column.

**Verification (live):** as of 14:35 UTC 2026-05-27, Tarny
(`p_b24c5bf8`, Footy Tuesdays) received exactly one autoOpen push on
the next cron tick after the fix deployed. Confirmed:
`notification_log` shows one row for `team_KPaoX8oJYMQ` /
`autoOpen` / `2026-06-02`; subsequent cron ticks short-circuit
via `alreadySent`.

**End-to-end chain now proven:** pg_cron → /api/cron → autoOpenGameJob
schedule UPDATE + notify_team_change broadcast → callNotify('autoOpen')
→ /api/notify → web-push → FCM/APNs → device.

---

## WON'T FIX — `unregister_push_subscription` RPC missing in production (session 51, closed)

**Original framing (kept for the audit trail):** mig 063 declares
this function via `CREATE OR REPLACE`, but pg_proc on the live DB
doesn't have it. The entry suggested diagnosing the partial-apply
and restoring.

**Re-audit verdict (session 51):** drop was deliberate, no fix
needed.

**Why dropped:** mig 081 (`rpc_sweep_cleanup`) explicitly DROPs
`unregister_push_subscription` with the in-source comment
*"mig 011 — never wired"*. Confirmed zero callers via grep across
`apps/` and `packages/`. Mig 081 ran after mig 063, so the CREATE
OR REPLACE happened then the DROP swept it.

**Why we don't need to restore it:**
- There is no client UI to "Disable notifications" in PlayerView
  (line 876 only renders an Enable button when
  `notifState === "idle"`).
- Players who turn notifications off via iOS/Android settings
  trigger HTTP 410 on the next push attempt; `notify.js:74-75`
  auto-deletes the orphaned `push_subscriptions` row. The natural
  failure mode is fully self-healing.
- Account-deletion cleanup is handled separately by
  `delete_my_account` (mig 068).

**Decision:** leave the function dropped. Re-creating it would
add a function nothing calls — exactly the dead code mig 081 was
sweeping out. Closed without code change.

---

## RESOLVED — Weekly auto-rollover never fired (session 50, migs 117 + 118)

**Symptom:** Footy Tuesdays played 8pm Tues 2026-05-26. Next week's
match should have gone live automatically Wed 10am with a PWA push
to all subscribers. Neither happened. Same silent failure on Finbars
Tuesdays. Confirmed across all teams — never worked in production.

**Root cause:** `/api/cron` was orphaned. The file
`apps/inorout/api/cron.js` contains `autoOpenGameJob` (line 334) and
`advanceGameDateJob` (line 364) — the rollover logic — and its header
comment claims it "runs every 15 minutes via pg_cron → pg_net or
Vercel Cron". But neither was wired up. `apps/inorout/vercel.json`
has no `crons` block, and pg_cron held 6 jobs all targeting
`/api/notify` — none called `/api/cron`. So the rollover code had
literally never executed in production. Two affected schedule rows
were stuck on the 2026-05-26 kickoff date; Footy Tuesdays additionally
had `opens_day=Monday, opens_time=20:00` configured (intended
Wednesday 10:00).

**Fix:**
- **Mig 117** — `cron.schedule('inorout-cron-main', '*/15 * * * *', ...)`
  pointing pg_net at `https://www.in-or-out.com/api/cron`. Mirrors
  the existing 6 notify jobs' shape, including hardcoded bearer.
- **Mig 118** — UPDATE on the two stuck schedule rows: advance
  `game_date_time + 7 days`, reset rollover flags, set
  `auto_open_pending=true, is_cancelled=false`. Footy Tuesdays also
  gets `opens_day='Wednesday', opens_time='10:00'`. Guarded by
  `AND game_date_time = '2026-05-26 20:00+00'` so the migration is a
  no-op if rerun after normal rollover.

**Verification:** `SELECT * FROM cron.job WHERE jobname='inorout-cron-main'`
returns active=true. Both schedule rows now show
`game_date_time = 2026-06-02 20:00+00, auto_open_pending=true,
is_cancelled=false, game_is_live=false`.

**End-to-end smoke:** wait until Wed 10:00 UTC and confirm Footy
Tuesdays' `game_is_live` flips to true and a push notification fires.
Until that's confirmed by a real device, treat as "applied, not yet
proven". Operator-facing pre-flight added to GO_LIVE_ISSUES.md.

---

## TECH DEBT — pg_cron bearer secret hardcoded across 7 jobs

`Bearer Liverp00l123?!!*` is hardcoded in all 7 pg_cron job bodies
including the new `inorout-cron-main`. Should be moved to a vault
setting (`current_setting('app.cron_secret', true)`) and the
`/api/cron` + `/api/notify` handlers updated to validate against it
the same way. Out of scope for the session 50 hotfix to keep blast
radius small. One coherent follow-up cycle: vault store + all 7 job
bodies + handler readers, one commit.

---

## RESOLVED — admin_delete_player rejects Vice Captains (session 49, mig 116 + AdminView/index.jsx)

**Symptom:** Tarny (VC on Footy Tuesdays) tapped "Remove Pav" on the
host-dropped-out orphan banner. Nothing happened — the banner stayed
on screen with no error toast. Same flow for removing Ranza from
SquadScreen showed "Couldn't remove player" but did not detail why.

**Root cause (two stacked bugs):**

1. **RPC rejected VC tokens.** Per commit 767b499 ("pass route.token
   to AdminView for VCs too"), the AdminView component receives the
   VC's player token as `adminToken` when the route is /p/<vc_token>.
   `admin_delete_player`'s first guard does
   `SELECT id FROM teams WHERE admin_token = p_admin_token` — but a
   VC's 21-char player token is NOT a team's 28-char admin_token, so
   the lookup missed every time and the RPC raised
   `invalid_admin_token` (confirmed in Postgres logs: 4× over 30 min).
   Mig 073 added a similar VC fallback to `admin_set_vice_captain`
   but only for the `p_admin_token IS NULL` case — useless here
   because the client DOES pass a token, just the wrong kind.

2. **Client swallowed the error.** `AdminView/index.jsx`'s
   `removeGuest` handler had `catch(e) { console.error(e); }` with no
   user-visible feedback. Combined with the optimistic state pattern
   (which here was absent), the orphan banner just sat there. No toast,
   no banner colour change, nothing.

**Fix (mig 116):** `admin_delete_player` now accepts EITHER a team
admin_token OR a VC's player token. Resolution order:
  1. Try `teams.admin_token = p_admin_token` (original path).
  2. If miss, try `players.token = p_admin_token` where the caller is
     a VC (`team_players.is_vice_captain = true`) on the SAME team as
     the target player. Audit row captures `actor_type = 'vice_captain'`
     with `actor_identifier = 'vc_token:<md5>'`.
  3. If both miss, raise `invalid_admin_token` as before.

**Fix (client):** `removeGuest` now sets a per-guest `orphanErrors[id]`
state on catch, with friendly messages mapped from RPC error codes
(`has_history`, `invalid_admin_token`, `not_found`, generic fallback).
Banner renders the error in red beneath the action buttons.

**Verified:** dry-call against the live DB confirms Tarny's token +
Pav target resolves to `team_KPaoX8oJYMQ` via the new VC path. RPC
security sweep PASS, build clean, BUGS.md + GO_LIVE_ISSUES.md
considerations: this is a runtime-only bug; no schema migration
follow-up needed beyond the two .sql files committed.

**Class-of-bug follow-up (still open):** any other admin_* RPC that
does `SELECT id FROM teams WHERE admin_token = p_admin_token` without
a VC fallback path will fail the same way for Vice Captains using
the AdminView via /p/<vc_token>. Worth a sweep before the next
release. Likely candidates: `admin_add_player`, `admin_update_player_name`,
`admin_save_teams`, `admin_cancel_match`, `admin_set_player_status`,
`admin_record_payment`, anything touching matches or settings.
The fix pattern is mechanical — copy the dual-lookup from mig 116.

---

## RESOLVED — admin_delete_player blocked by cancelled-match ledger rows (session 49, mig 115)

**Symptom:** Admin tried to remove player "Ranza" (p_UG2K3Dwp) from
Footy Tuesdays squad — UI surfaced "Couldn't remove player". Ranza
had attended=0, no player_match rows, no POTM votes, no injuries.

**Root cause:** `admin_delete_player`'s `has_history` guard (mig 012)
treats ANY `payment_ledger` row as blocking financial history. Mig
082's `admin_cancel_match` inserts a `status='cancelled', amount=0.00`
ledger row for every player on the squad each time a match is
cancelled. As soon as one match is cancelled, every player on that
squad becomes undeletable for the lifetime of the team — a silent
ticking bomb behind every cancelled match.

**Fix (mig 115):**
1. Guard now ignores `status='cancelled'` rows when computing history.
   Real payments (paid/owed/refunded/etc) still block deletion.
2. Delete block cascade-cleans cancelled ledger rows before deleting
   the player, so no orphan rows are left pointing at a vanished
   `player_id` (no FK exists on `payment_ledger.player_id`).

**Verified:** RPC security sweep PASS (SECDEF + search_path + grants
+ single signature); guard predicates dry-checked against Ranza's row
— all five evaluate `false` post-fix. Build clean.

**Future-proofing:** the pattern of "auto-generated zero-impact
audit row blocks future deletion" is worth watching in `potm_votes`,
`player_injuries`, and any new Phase 2 audit-style inserts — same
trap, different table.

---

## RESOLVED — Four latent CHECK constraint bugs in mig 055/003 (session 48, migs 088/089/092)

**Symptom:** Three of the four would have caused every Phase 2 mutating
RPC to fail in production once any client code shipped. Caught
in-flight during Cycle 2.1 / 2.2 / 2.3 smoke tests; never reached
live customer paths.

**Bug 1 — `competition_teams.status` CHECK constraint (mig 055):**
allowed only `('active','withdrawn','expelled')`. Cycle 2.1's
`mig 083` flipped the DEFAULT from `'active'` to `'pending'` for the
manual approval flow — but DIDN'T expand the CHECK. Any INSERT
without explicit status would have raised `competition_teams_status_check`
violation. Fixed by **mig 088** which expanded to the full Phase 2
enum: `('pending','active','rejected','withdrawn','expelled')`.

**Bug 2 — `audit_events.actor_type` CHECK constraint (mig 003):**
allowed only the original 7 personas
(`team_admin`/`vice_captain`/`club_admin`/`super_admin`/`player`/
`service_role`/`system`). Phase 2 RPCs resolve callers to
`venue_admin`/`league_admin`/`platform_admin` via `resolve_venue_caller`
and `resolve_league_caller` — none of which were in the whitelist.
Every Phase 2 mutating RPC's audit insert would have failed. Fixed by
**mig 092** which expanded additively to include all three new personas.

**Bug 3 — `venue_get_state.open_incidents` (mig 086):** referenced
a non-existent `incidents.status` column. The `incidents` table
derives "open" from `resolved_at IS NULL` and has a direct `venue_id`
column (no need to join through fixtures). Fixed by **mig 089** which
swapped the WHERE clause to use `incidents.venue_id = v_venue_id AND
resolved_at IS NULL`.

**Bug 4 — `join_get_league_by_code.competitions_open` (mig 086):**
filtered competitions on `status='registration_open'` which is not in
`seasons_status_check` or `competitions_status_check`. The constraints
allow only `('setup','active','completed','archived')` for seasons and
`('setup','active','completed')` for competitions. The filter was a
silent no-op (couldn't match a non-existent value) but cosmetically
wrong. Fixed by **mig 089** which tightened to `('setup','active')` —
the actual states that accept registrations.

**Root cause across all four:** mig 055 (Phase 1 schema) and mig 003
(audit_events) shipped CHECK constraints that were narrower than the
`LEAGUE_MODE_SCOPE.md` design assumed. Schema-sync at Cycle audit time
checked column existence but never queried `pg_constraint`. Each bug
took one MCP round-trip to catch and one to fix.

**Lesson:** DECISIONS.md now mandates a `pg_constraint` sweep on every
table any future cycle touches, alongside the existing column-existence
check. See: "SCHEMA-SYNC MUST SWEEP `pg_constraint`, NOT JUST COLUMNS".

**Impact: zero.** All four caught before any Phase 2 client code
shipped to live customers. The fix migrations are paired with
matching `_down.sql` files per hard rule #11.

---

## RESOLVED — Cancelled match leaves admin-locked players unable to self-toggle next week (session 47, mig 082)

**Symptom:** After Tarny (VC, Footy Tuesdays) cancelled the 2026-05-26
game, post-cancel verification found Ranza (`p_UG2K3Dwp`) still had
`players.admin_locked_in=true`. Every other field on his row reset
correctly (status='none', paid/self_paid=false, team=null). The other
17 squad members were fully clean. Latent UX impact: Ranza would have
been unable to self-toggle in/out next week — `set_player_status`
(mig 038) refuses any self-write while `admin_locked_in=true`, with
silent client-side failure.

**Root cause:** `admin_cancel_match`'s Step 5 bulk reset cleared
`status`, `paid`, `self_paid`, `paid_by` — but not `admin_locked_in`.
The flag is only set true by `admin_set_player_status` (mig 038) and
was previously only cleared by account-deletion paths (migs 040, 047,
068). Cancelling a match was simply overlooked.

**Fix:** Migration 082 — adds `admin_locked_in = false` to the Step 5
SET list. Also codifies the live RPC body (which had drifted from mig
013 to use `resolve_admin_caller` for VC/admin parity) into a source
file, per rule 11. One-off `UPDATE players SET admin_locked_in=false
WHERE id='p_UG2K3Dwp'` applied to clean up the existing stranded row.
No JS changes — wrapper `adminCancelMatch` and the AdminView call
site (`cancelWeek` in `apps/inorout/src/views/AdminView/index.jsx:165`)
stay as-is. Verified: zero rows with `admin_locked_in=true` post-fix,
live RPC body now contains the new column, SECDEF + search_path +
grants intact.

**Still open (flagged, not in this commit):** the weekly rollover
(`open_next_week`/`advance_game_date`) doesn't clear `admin_locked_in`
either. With this fix a cancelled-then-reopened week is safe, but a
NON-cancelled week that rolls over with stale admin locks is still a
latent concern. Worth a separate audit.

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
