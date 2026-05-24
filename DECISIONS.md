# In or Out — Key Decisions Log
*Last updated: May 24 2026 (session 39 — super-admin dashboard + push-notification URL rule + workspace-deps rule)*

Architectural, product, and design decisions that should inform future work.
Read this before building new features to avoid re-litigating settled questions.

---

## AUTH & IDENTITY

- **Token links always work** — no auth for day-to-day use. `/p/TOKEN` never requires sign-in.
- **Auth only required when joining a new team.** `/join/CODE` is the only auth gate.
- **Email is the identity** — not the name. `auth.uid()` → `user_id` on players row.
- **Returning player joining a new team** reuses the existing `players` row — new `team_players` entry only, no new players record.
- **Flat stat columns** (`goals`, `motm`, `bib_count`, `w`, `l`, `d`, `attended`) are cross-team lifetime totals on one row. `player_match` rows support per-team breakdowns. Don't treat flat columns as per-team.
- **`ioo_redirect_to` is iOS-only.** Write MUST be gated by `isIOS && !isStandalone`. Writing on Android/desktop causes disorienting forced redirects.
- **`onboarding_complete=true`** is written exactly once, at step 3 (ShareLinks.jsx handleGoAdmin). Step 2 leaves it false.

## RLS & WRITES

- **No direct table writes from the client. Ever.** All writes via SECURITY DEFINER RPCs.
- **No direct table READS from customer-facing client paths either.** Session 36
  established this as a hard architectural rule after the H2H + StatsView
  bugs surfaced. Direct `.from()` reads are an RLS-blind spot — they may work
  for some auth contexts (player-token sessions where the user is in
  team_players) and silently fail for others (anon callers on /demoadmin,
  admin sessions where the auth user has no team_admins row). Wrap reads in
  a SECURITY DEFINER RPC that takes `p_admin_token` (or `p_token`) and
  derives team_id server-side. Existing direct reads are accepted only
  inside the admin-token JS function as a fallback path for authenticated
  player sessions. See migrations 041 + 042 for the canonical pattern.
- **Admin RPCs derive team_id from p_admin_token server-side.** Never pass team_id as a trust signal from the client.
- **Demo team is not a valid test target for auth or RLS flows.** team_demo has seeded created_at dates and (until session 36) no team_admins row. Always verify against team_finbars or a fresh team.

## PWA INSTALL ARCHITECTURE (session 37)

iOS Safari **partitions installed PWA localStorage from the Safari context** that
hosted the install, AND **reads `<link rel="manifest">` at HTML parse time**
(ignoring later JS mutations). The combination means that JS-side breadcrumbs
written before install are invisible to the launched PWA, AND React-side manifest
swaps after page load are too late. The only reliable path is to bake the right
`start_url` into the manifest at HTML parse time.

**The install architecture:**

- **`apps/inorout/api/manifest.js`** — Vercel serverless function. Accepts
  `?admin=<admin_xxx>` OR `?player=<p_xxx>`, regex-validates the token format
  only (no DB lookup — keep it minimal, public, fast). Emits a personalised
  manifest with `start_url=/admin/<token>` or `start_url=/p/<token>`. Headers:
  `Cache-Control: no-store, max-age=0` + `CDN-Cache-Control: no-store`.
  **Never** does a DB lookup, never logs the token, never redirects.
- **`apps/inorout/index.html`** — inline `<script>` runs synchronously during
  HTML parse. Reads `window.location.pathname`, matches `/admin/<token>` or
  `/p/<token>`, and injects the right `<link rel="manifest">` URL. Falls back
  to the static `/manifest.json` for every other path. **The static link tag
  MUST NOT be restored** — iOS will use whatever's in the HTML at parse time
  and our personalised injection only works if there's no competing static
  link. Sentinel comment in HTML reinforces this.
- **`apps/inorout/vercel.json`** — adds `Cache-Control: no-store` to the static
  `/manifest.json` too, so an eager iOS pre-fetch can't pollute later installs.
- **Post-create flow** (`useOnboarding.submitTeam`) — after the `create_team`
  RPC succeeds, hard-redirects via `window.location.replace` to
  `/admin/<token>?just_created=1`. Without the redirect, the install would
  happen at `/create` where the inline script has no admin token to inject.
- **Post-join flow** (`App.handleJoin`) — same pattern. After `playerJoinTeam`
  succeeds, hard-redirects to `/p/<token>?just_joined=1`.
- **App.jsx overlays** — reads `?just_created=1` / `?just_joined=1` from URL
  + `sessionStorage` props, renders `SquadReady` / `JoinSuccess` as top-level
  overlays BEFORE any view-routing happens. (Was originally in AdminView but
  AdminView only mounts when user taps the admin tab — moved to App level so
  it shows immediately.)
- **App.jsx root manifest effect** — for returning admins/players hitting
  `/admin/<token>` or `/p/<token>` directly, swaps `<link rel="manifest">` href
  via useEffect. Defense in depth — covers SPA route transitions where the
  inline script already ran for a different URL.

**Future-proofing artefacts** (regression tripwires):

- `apps/inorout/public/manifest.json` carries a `_comment` field warning future
  contributors NOT to change `start_url` (the dynamic endpoint owns
  personalisation).
- `index.html`, `SquadReady.jsx`, `App.jsx`, `api/manifest.js` all carry
  block-comment sentinels above the critical sections, with rules
  ("deps MUST include adminToken", "NO cleanup function", "NO DB lookup",
  etc.) and pointers to this DECISIONS.md section.

**Known scope decisions:**
- The dynamic manifest is for **install personalisation only**. Cross-context
  install (in-app webview → Chrome) still requires the localStorage breadcrumb
  path + PWAWelcome polymorphic paste box.
- `name` / `short_name` are NOT yet team-personalised — every install shows
  "In or Out" on the home screen. Could be extended to include team name.

## SUPER-ADMIN DASHBOARD (session 39, migrations 045 + 046)

A separate app at `apps/superadmin`, deployed as a separate Vercel project
(`platform-superadmin`), behind Vercel team SSO protection. Not part of
`apps/inorout` — the player-facing PWA stays small, mobile-first, and free
of admin-only dependencies.

- **Authorisation:** new `platform_admins` table (global, cross-team), parallel
  to per-team `team_admins`. Helper `is_platform_admin()` gates every
  `superadmin_*` RPC. **Membership is granted by hand via SQL only** — there
  is intentionally no UI to add platform admins, so the role can never be
  accidentally escalated. Defence in depth on top of the Vercel SSO wall.
- **Read RPCs (Phase 1+2 shipped):** `superadmin_whoami`,
  `superadmin_list_teams`, `superadmin_team_detail(team_id)`,
  `superadmin_recent_activity(limit, since)`. All SECURITY DEFINER + STABLE,
  all return jsonb, all start with `IF NOT is_platform_admin() THEN RAISE
  EXCEPTION 'forbidden';`.
- **Write RPCs (Phase 3+4 deferred):** token rescue (reset admin token,
  regenerate player token, add self as team admin) + data fix (override
  match result, mark/refund payments, clear injury, force-confirm teams).
  Every write will insert an `audit_events` row with `actor_type='super_admin'`
  and `actor_user_id=auth.uid()` for a clean intervention trail (the
  `audit_events.actor_type` CHECK constraint already permits this value).
- **UI:** Vite + React 18, plain dark admin styling, no framer-motion, no
  PWA, no PostHog. Three tabs: Activity (audit_events tail), Teams
  (sortable list), Team Detail (drilldown). Read-only in v1.

## PUSH NOTIFICATION URL RULE (session 39)

**All server-to-self HTTP calls must use the canonical
`https://www.in-or-out.com`, never the apex `https://in-or-out.com`.**

Why: the apex 307-redirects to www. All sane HTTP clients (browsers,
curl with `-L`, `pg_net`, server-side fetch) **strip the `Authorization`
header when following a cross-host redirect** as a security measure. So
calling `https://in-or-out.com/api/notify` with a bearer token results in
the bearer being dropped at the redirect → the function sees no auth → 401.

Surfaced as a 73.7% Vercel error rate on Beta launch day. All six pg_cron
notification jobs were using the apex URL — bug latent since cron setup,
masked for weeks by parallel VAPID empty-string crashes. Once the VAPID
500s were fixed, the auth-strip 401s appeared.

Applied to:
- `cron.job` rows 1–6 — rewritten via `cron.alter_job` (apex → www)
- Any future internal HTTP call (edge functions, webhooks) must follow
  the same rule. Comment in migration 049 documents the gotcha.

## WORKSPACE DEPS MUST BE REAL PACKAGES (session 39)

**Every `@platform/*` listed as a dep in any `apps/*/package.json` or
`packages/*/package.json` must resolve to a real workspace package** —
i.e. there must be a corresponding `packages/<name>/package.json` with the
matching `name` field. Vite aliases (in `vite.config.js`) are configured
separately and must NOT appear as deps.

Why: Vite aliases work at build time, inside the bundler — npm has no idea
they exist. Local builds happily resolve them, but Vercel's `npm install` in
a fresh container goes to the npm registry for `@platform/*`, gets a 404,
and **aborts the entire workspace install** — breaking every other app in
the monorepo at the same time. Discovered the hard way when the superadmin
scaffold's first commit listed `@platform/supabase` (which was only ever a
Vite alias) as a real dep, taking down platform-clubmanager's CI.
`www.in-or-out.com` was protected only because Vercel "only promotes on
success" — but the deploy pipeline was blocked until the fix landed.

Enforced by `Skills/scripts/check-workspace-deps.sh` — a pre-commit hook
that fails fast if any `@platform/*` dep can't be resolved to a real
workspace package. Sub-second jq check, called from `check-build.sh` before
the build itself runs. Negative-tested by re-adding fake deps; the hook
blocks the commit with actionable error text pointing at the file and the
offending dep.

Bonus correction landed at the same time: the `@platform/core` Vite alias
target changed from `packages/core/index.js` (a specific file, so subpath
imports like `@platform/core/storage/supabase.js` were broken) to
`packages/core` (the directory, so Node + Vite resolve via the package's
`exports` map).

## ACCOUNT DELETION FK PURGE (session 37, migration 047)

`delete_my_account` MUST purge every public-schema FK that references the
user's `auth.users.id` before the edge function calls
`auth.admin.deleteUser()`. The 040 version anonymised the player row but
revoked (instead of deleting) team_admins rows and never touched
user_profiles — so Postgres refused the auth.users delete (NO ACTION FKs),
the edge function returned `ok:true,authDeleted:false`, and the auth row +
identity stayed forever. That orphan blocked the email from ever signing in
again with the same OAuth provider (Supabase finds the identity, looks up
the missing user_id → 404 "User not found" → silent OAuth loop).

**Rule:** any new public table that references `auth.users.id` with NO
ACTION MUST be added to the cleanup block in `delete_my_account`. CASCADE
FKs are fine as-is.

**Currently cleaned:** user_profiles (DELETE), team_admins.user_id (DELETE
own rows), team_admins.granted_by / revoked_by (NULL), platform_admins.granted_by (NULL).
**Auto-cascaded:** platform_admins.user_id (CASCADE), auth.identities (cascades when
auth.users is deleted by admin API).

Edge function carries a comment with the manual cleanup SQL for stuck accounts
if this ever surfaces again.

## ADMIN STATUS LOCK (session 34, migration 038)

- **Admin-set IN is asymmetric.** When admin sets a player to `in` via
  `admin_set_player_status`, `players.admin_locked_in` flips true. The player
  can still self-decline to out/maybe/reserve from `/p/TOKEN`, but cannot
  self-restore to IN — server returns `admin_locked_in` and rejects the write.
  Only admin can re-confirm them as IN. Any admin status change to
  out/maybe/reserve/none clears the lock. Rationale: an admin's IN reflects
  intent ("you're playing this week"), not a player declaration; a player
  flipping out shouldn't be able to silently re-promote themselves back into a
  squad the admin has now closed.
- **Squad-cap is enforced server-side on both paths.** Both
  `admin_set_player_status` and `set_player_status` refuse `in` if the active
  schedule's `squad_size` is met (raise `squad_full`). Client gates the IN
  button on top. Race window between count check and update is accepted —
  amateur-team scale, row-level locking would be disproportionate.
- **Injury override is a confirm, not a refuse.** Admin can set an injured
  player to IN/MAYBE/RESERVE but must confirm via modal. The injury flag is
  preserved; admin can clear it separately. Rationale: edge cases exist
  (player insists they're fine; admin updating retrospective status) and
  silent auto-clear would lose audit signal.
- **`admin_locked_in` is included in the admin-side state read only.**
  `get_team_state_by_admin_token` returns it; player-side reads do not. Player
  UI does not show a lock badge — server rejects with a clear error if they
  try, surfaced via the existing error-toast pipe. Minimal scope; revisit if
  the rejection error proves confusing in practice.

## PLAYER PROFILE & SELF-SERVICE ACCOUNT ACTIONS (session 35, migrations 039–040)

- **One PlayerProfile file serves both contexts.** `isAdminView` prop switches
  mode. Player mode is the default; admin mode is a graft (extra sections +
  branched RPC paths, destructive zone swap). Rationale: the screen scaffold
  (sticky header, identity, Stats/Payment/Injuries sections) is identical
  across both — two files diverged on accident, not on purpose, and any
  future improvement had to be made twice.
- **Player-facing profile entry is a top-left avatar overlay on PageHeader.**
  Universal pattern (Instagram, WhatsApp, Discord). Doesn't push other
  content down — overlays absolute-positioned, IN OR OUT logo recentred via
  negative `marginLeft` to compensate. Avatar only renders when both `me`
  and `onAvatarTap` are passed, so the admin's PageHeader is unaffected.
- **Payment History accordion moved out of MY VIEW into Profile.** MY VIEW
  keeps current-week live payment state (Pay buttons, debt clear) in the
  response card. Historical ledger is reference data and belongs in Profile.
  Same UI pattern, just relocated; ~80 lines off PlayerView.
- **Leave squad ≠ Delete account.** Two distinct affordances:
  - **Leave squad** = soft remove from this team only. Player row + history
    (player_match, payment_ledger, player_injuries, potm_votes) preserved.
    Player can rejoin via invite link. Auth account untouched. UI: two-tap
    confirm with 4s reset window.
  - **Delete account** = hard nuke of the auth account, but FK-preserving on
    historical data. Players row is anonymised (name → "Deleted player",
    token/user_id/nickname cleared, disabled=true, disable_reason set), then
    detached from all teams. push_subscriptions + player_career deleted.
    Admin grants revoked. Edge function (`/api/delete-account`) calls
    `supabase.auth.admin.deleteUser` after the RPC. UI: glass modal with
    typed-DELETE guard.
- **Anonymise rather than delete on hard-delete.** Historical FKs (POTM
  votes, goal scorers, attended counts on past matches) stay intact so team
  records aren't corrupted, but identifiers are scrubbed for the GDPR-style
  "right to be forgotten" intent. Players row remains because deleting it
  would cascade-break per-match attendance, scorer lists, and POTM history
  that other team members still need to see.
- **Leave squad is debt-blocked, not attendance-blocked.** Refuses with
  `debt_owed:<amount>` if `owes > 0`. Anyone can leave once they've settled
  — even with attendance history. Different from admin's `admin_delete_player`
  which has the stricter `has_history` guard (forces admin to use Disable
  instead). The asymmetry is deliberate: admins shouldn't lose someone's
  history accidentally; players asking to leave have made an explicit
  decision and shouldn't be trapped.
- **Last-admin guard on delete_my_account.** Refuses with `last_admin:<csv>`
  (list of blocking team_ids) if the user is the only non-revoked admin of
  any team. Forces handover first to avoid orphaning a team. Same pattern
  Discord/Slack use for server ownership.
- **Token resolution for player RPCs goes through team_players join.** All
  four new RPCs (`get_my_payment_history`, `get_my_injuries`, `leave_squad`,
  `delete_my_account`) resolve `(player_id, team_id)` from `players.token`
  via team_players, mirroring the established `set_player_injured` pattern.
  Grants: `anon` + `authenticated` because `/p/TOKEN` runs unauthenticated.
- **VC toggle stays inside PlayerProfile (admin mode only).** Considered
  moving to a Roles section in Match Settings, but kept here because it's
  a per-player decision admins reach via the squad row → profile drilldown
  flow they already know. Standalone Roles area is a Phase 2+ consideration
  if multi-VC patterns emerge.

## PAYMENTS

- **Payment model:** cash only for Stage 1/2. Stripe slots in later.
- **`handleCashPayment` sets `self_paid=true` (not `paid=true`).** Player sees amber "Awaiting confirmation". Admin confirms → `handleMarkPaid` sets `paid=true`.
- **`selfPaid=true` still counts as paid** in PaymentsScreen — admin confirmation is a UX signal, not a payment gate.
- **Ledger cross-path:** player self-pays before lineup lock (matchId=null entry). When admin marks paid with real matchId, `handleMarkPaid` promotes the null entry rather than creating a duplicate.
- **PostgREST `.upsert()` cannot target partial unique indexes.** Use INSERT + catch `23505` instead.
- **`owes` double-increment guard:** `updatePlayerRecords` in ScoreScreen is the sole owes-increment path. `carryForwardDebts` removed session 26. Do not add a second increment path.

## STATS & DISPLAY

- **`player_match` is the source of truth for all stats.** `players` flat columns are write-only convenience fields, not used for display.
- **Reliability is always all-time** — never period-filtered. Numerator (`allTimePlayed`) and denominator (`totalTeamGames`) both use all-time queries. Reliability is a player trait, not a period stat.
- **H2H `dominantType`** is always team-wide all-time regardless of period selector — it's a UI presentation decision, not a stat. Team scoring style is stable; don't thrash it on period change.
- **Goals only counted** where `score_type = null OR 'exact'`. Use `hasGoalData(scoreType)` helper for all goal-related computation.
- **`matches.motm` stores player_id, NOT name.** Use `resolveMotm(motmValue, players)` for display. `isWinner` checks use ID comparison (`match.motm === me.id`).
- **`matches.bib_holder` stores player_id for new rows.** Legacy rows may have name strings. Use `resolveBibHolder(value, players)` which handles both.

## NAMING CONVENTIONS

- **POTM in UI, `motm` in DB/code** — never change DB column names.
- **Results in UI, `history` in filenames/functions** — never change.
- **`is_vice_captain` lives on `team_players`** (per-team), not `players` (global). Migrated session 26.

## ARCHITECTURE

- **VC access = full AdminView minus Rotate Admin Link.** Scoping done via `isViceCaptain` prop throughout. `role_scope` on players is dormant (Phase 2 RBAC).
- **`addPlayerToTeam` is the correct function for admin-adding players** — writes both `players` row and `team_players` link, generates token. `upsertPlayer` does NOT write `team_players` and must not be used for this purpose.
- **App.jsx state wrappers (`setSchedule`, `setSettings`) are pure setters.** Never add DB calls inside them. Child screens call RPCs explicitly before calling the setter for UI sync.
- **iOS localStorage does NOT bridge Safari to PWA.** Treat them as separate contexts.
- **`ioo_last_visited`** — permanent. **`ioo_redirect_to`** — one-time, 7-day, iOS only.
- **Multi-team admin:** Phase 2. Multi-team player switcher already built (MySquads.jsx, session 26).
- **PostgREST self-join workaround:** `getMostPlayedWith`, `getNemesis`, `getBestPartnership`, `getPlayerImpact`, `getPOTMEligiblePlayers` all use two sequential queries + JS computation. PostgREST foreign key joins unreliable in this config.
- **Install ("Add to Home Screen") UX is shared across join and create flows.** Lives in `apps/inorout/src/components/InstallSection.jsx` — platform-detected inline block (iOS 4-step carousel, Android numbered steps, desktop copy-link), no outer shell or CTA. Parent screens (`JoinSuccess`, `SquadReady`) own page chrome + sticky CTA + PostHog event with `flow: "join" | "create"`. Standalone PWA users get the section auto-hidden (returns `null`). Desktop copy-link target: join URL for the join flow, **admin URL for the create flow** — admins reopen the admin panel on phone to install (session 30).
- **TeamsScreen is "Smart by default" — auto-Smart fires on entry** when the match has no saved teams. LiveBoard (two-column A | B grid mirroring PlayerView's confirmed-teams tile) is the primary surface; tap-to-move between teams. The old per-row A/B button list was removed entirely. SMART panel opens by default with Group 1 + Group 2 seeded. BUILD TEAMS is a contextual gold CTA that only appears when groups have been edited since the last algorithm run. Decided session 31.
- **Game-live toggle hides when live.** Off state: "Make this week's game live" + slider. On state: pulsing green dot + "LIVE" badge, no slider. Admin uses Cancel This Week to go offline. Removes the ambiguous "Game is Open / Closed" wording (session 31).
- **Reopen-after-cancel creates a fresh match.** Cancelled match stays in history with `cancelled=true`. New `admin_reopen_week` RPC handles the full transaction (clear is_cancelled, insert new matches row, point active_match_id at it). Keeps the audit trail honest and avoids un-cancelling payment ledger refunds (session 31).
- **Admin-configured `schedule.dayOfWeek` is authoritative over the `gameDateTime`-derived weekday** in player-facing copy. The demo schedule had drift between the two (day_of_week='Wednesday' but timestamp on a Tuesday); when they disagree, the configured day wins. Session 31.
- **Status confirmation banners are one-shot, not persistent.** "🔒 Locked in", "👍 No worries", "🤞 Got it" etc. flash up for 5s after a setStatus tap, then slide-fade. They do NOT resurrect on page refresh. `hideConfirmation` initial state is `true` (session 31).
- **IO deeper-intel is computed client-side, not via RPC.** `packages/core/engine/deeperIntel.js` derives mostPlayedWith, mostFacedOpponent, nemesis, bestPartnership, impact, reliabilityRanking from `matches[]` + `squad[]` already in state. No new RPC, no schema change, no extra round-trip. Chosen over extending `get_team_state_by_player_token` because the source data is already loaded on every route and the computation is cheap. Phase 0B (Casual/Competitive split) will pre-filter `matches[]` before this engine sees them, so the cards inherit the filter for free (session 32).
- **MyIOView.jsx is exempt from the hex-literal hygiene check.** Documented in `skills/scripts/check-hygiene.sh` header. Rationale: CLAUDE.md itself mandates hex literals inside SVG fill/stroke (CSS vars don't work there) and this file is overwhelmingly SVG badge crests and gradient overlays. Same exemption pattern as `constants/colors.js`. If extending: keep new colours in the INSIGHTS array, not scattered through the file (session 32).
- **Smart Teams adoption analytics: rich `team_confirmed` event as the anchor.** Carries `manual_moves_before`, `manual_moves_after`, `regenerate_count`, `was_ai_picked_as_is`, `is_recommit`, plus prediction fields and team sizes. Secondary events (`team_drafted_auto`, `team_player_moved`, `team_regenerated`, `team_cleared`) fire alongside but the confirm event is what the dashboard queries. Session 31.

## SCHEDULING & CRON

- **`is_draft` is NOT the auto-open flag.** `is_draft=true` means onboarding incomplete only. `auto_open_pending=true` is the auto-open flag — reset weekly by `advanceGameDateJob`.
- **`advanceGameDateJob`** resets `auto_open_pending=true` weekly so games auto-open next week without admin action.
- **Lineup lock window:** first cron tick at or after kickoff (real-world window: kickoff → kickoff+15min depending on cron cadence). Requires `game_is_live=true` and `lineup_locked=false`.

## BETA PLAN

- **Stage 1:** team_finbars (Finbar's Tuesdays). Beta held — currently stabilising bugs.
- **Stage 2:** May 26 — Monday Footy added if Stage 1 week 1 is clean.
- **Broader beta:** ~Jun 9 — anyone willing to mandate the app.
- **Quiet public availability:** late Jul / early Aug.
- **Beta deal:** free forever for first 10 teams. Cash/bank transfer. Stripe fees only if Stripe lands.

---

## MID-GAME TEAM SWITCHES (Phase 2 — spec agreed)

- New stage in ScoreScreen between score entry and bibs
- Admin marks players who switched teams during the game (⇄ swap icon next to name)
- `team_switches jsonb` column on matches: `[{player_id, from: "A", to: "B"}]`
- `team_a`/`team_b` on match updated to reflect FINAL team assignments after switches
- `player_match.team_assignment` records the final team — W/L/D derived from that
- Match history shows ⇄ icon next to any player who switched
- Switch time not recorded — binary only
- Stage is optional — if no switches, admin skips through

---

## APPLE WATCH GOAL LOGGER (Phase 3 — spec agreed)

- Requires native iOS app (Capacitor) as container first
- watchOS extension in Swift/SwiftUI alongside Capacitor — not possible via Capacitor alone
- Interaction: tap team A/B → crown scroll to player → tap confirm → goal logged to Supabase
- Haptic confirmation on goal log
- Estimated effort: ~20h Capacitor iOS + ~8h watchOS = ~28h total
- Prerequisite: Apple Dev account £79 (same as Apple Sign In)

---

## PHASE 4 — LEAGUE MODE (parked)

Full spec in `CONTEXT.md`. Do not build pre-launch. Sales pitch: "I have N of your players
already using the team app — want to run your league free for one season?"

Schema decisions to keep in mind (don't implement yet, just don't paint into corners):
- `player_match.team_assignment`: may need to reference team_id not just 'A'/'B'
- `matches.motm`: may need to allow array (one POTM per side)
- Future tables: venues, leagues, fixtures, referees

---

## GROUP BALANCER

- **Tap-to-assign over drag-and-drop.** Chosen for mobile reliability,
  accessibility, zero library footprint, and ~2–3h faster Stage 3 build. Drag
  was rejected (dnd-kit, Framer Motion, react-beautiful-dnd all considered).
  Drag is "playful" but the value of a balancer is *who ends up on each team*,
  not the gesture used to assign them. Tap → panels glow as targets → tap to
  commit. Tap outside cancels.
- **Win rate is the only signal.** No MMR, balance scores, or per-player
  numerical signals — keeps the system simple and avoids any path toward
  player-visible rankings. Random tiebreak within 5% of best score gives
  rerolls varied feel.
- **Group numbers are admin-only.** Never expose to player routes. Enforced by
  RLS (no anon read on `team_players.group_number`) and a header comment in
  `packages/core/engine/groupBalancer.js`.
- **`generateBalancedTeams` is a pure engine function**, no Supabase calls.
  Reusable by Ask the Gaffer Phase 2 (fair team suggestions) without
  reinventing the algorithm.

Full spec: `GROUP_BALANCER.md`.

---

## ASK THE GAFFER

- **Football-operations agent, not a generic chatbot.** Must be grounded in
  team data (`player_match`, `bib_history`, `team_players`, `matches`,
  `team_switches`, `ledger`). Feel: "a smart assistant for the organiser who
  already knows the squad."
- **Four-phase trust-graduated rollout:**
  1. Read-only assistant (Q&A, summaries, briefings)
  2. Recommendations (drafts shown, no actions taken)
  3. Confirmed actions (admin one-tap approve buttons fire existing RPCs)
  4. Semi-autonomous (auto-detect short squads etc.) — only after trust
     proven
- **Anything visible to players requires admin approval, even in Phase 4.**
  Hard rule.
- **All writes via existing SECURITY DEFINER RPCs.** No new direct-write
  paths for the agent. Auth via `adminToken` per RLS checklist.
- **LLM provider + data-access pattern** deferred until Phase 1 scope opens
  (cost is the primary factor).

---

## MARKETING LANDING PAGE

- **Beta:** Option A — conditional render at root. Single Vercel project,
  unauth + no token + root path → render landing, else app shell. Zero
  infrastructure change, preserves all existing `/p/TOKEN`, `/create`,
  `/join`, `/demoadmin` URLs.
- **Post-public-launch:** Option B — subdomain split (`in-or-out.com` =
  marketing, `app.in-or-out.com` = app). Requires updating Supabase OAuth
  callbacks, redirecting in-the-wild `/p/TOKEN` links, re-checking
  push-notification origin scope. Planned migration, not now.
- **Why now:** beta needs a public-facing landing page to capture sign-ups
  and run ads. Option A ships in a day; Option B is 1–2 days plus settle-in
  risk on existing share links.

---

## H2H DESIGN DECISIONS

- **Two matches queries:** Query 1a all-time (for `dominantType`), Query 1b period-filtered (for stats). One extra query per H2H open in 'all' mode — clarity wins over optimisation.
- **Sample size floors:** chemistry refuses to fire with < 3 games of each baseline. Main verdict requires ≥ 3 `totalShared`. Section 2 streak softens "1 in a row" to "won the last meeting".
- **Score type gating:** use `hasGoalData(scoreType)` for any goal computation. Filter data set first, then reduce over filtered set AND divide by filtered count (not unfiltered) so averages are honest.
- **`meRows`/`themRows` filtered by `matchMap` membership immediately after Query 2.** `matchMap` contains only period-filtered match IDs and is the single period-gating point — all downstream computation inherits period scope automatically.

---

## IO INTELLIGENCE

- **4 tabs for players, 5 tabs for admins.** 5th tab appears when `onAdminClick` prop is truthy (not an `isAdmin` prop).
- **Unlock thresholds are per-player per-team.** Progressive reveal based on `gamesPlayed`.
- **`useIOIntelligence.js` is a pure passthrough** — takes `stats` prop from state RPC, makes no direct Supabase calls. Rewritten session 25.
- Full IO spec in `IO_INTELLIGENCE.md`.

---

## MOTION & ANIMATION (session 36 — pre-launch polish)

- **framer-motion@12 is the standard motion primitive.** Installed in
  `apps/inorout` for the pre-launch UX overhaul. CSS keyframes are no
  longer used for component-scoped motion; they remain valid only for
  global utility animations (e.g. the `ioo-blink` live-game dot).
- **Motion must do real work.** Every animation maps to a moment that
  benefits from kinetic feedback — state change, reveal, reward, spatial
  continuity. No decorative fades. No hover effects on mobile-first
  surfaces. No animations that delay critical info (scores, fixtures,
  availability).
- **Shared-element pattern via `layoutId`** is the right tool for
  spatial continuity (e.g. PageHeader avatar → PlayerProfile big avatar
  morph, period-selector pill morph between tabs).
- **AnimatePresence + `popLayout` mode** for staggered enter/exit on
  lists where the items might be re-keyed (e.g. TeamsScreen shuffle —
  chips fade-shrink out and deal in with stagger keyed by shuffleNonce).
- **Springs over easings for arrival moments.** Use `type:"spring"` with
  damping 14–32 (lower = more bounce, reserve <16 for celebratory
  moments like POTM lock-in trophy). Use `easeOut`/`easeInOut` cubics
  for measurable durations (e.g. comparison bars filling — `[0.22, 1, 0.36, 1]`
  for a confident decelerating fill).
- **Counters use motion-value pattern, not React re-renders.** `animate(0, value, { onUpdate: v => node.textContent = ... })` writes DOM
  directly; avoids per-frame React reconciliation for ramping numbers.
- **Dwell time matters as much as entry time.** When an animation
  celebrates state (e.g. POTM "VOTE LOCKED IN"), extend the auto-close
  long enough for the user to register the reward — first-pass 3s was
  too tight (1.6 float cycles, read as twitch); 4.5s gives ~2.7 cycles
  which reads as intentional celebration. The cache-window math from
  ScheduleWakeup is irrelevant here — only the user-perception math is.
