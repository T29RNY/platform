# RLS Migration — Phase A Consolidation (v2)

## 0. Document status

This is the official Phase A output for the RLS migration. It supersedes
all prior consolidation drafts produced during Session 24 audit work.

Phase B and onward proceed from this document. Any deviation requires
explicit re-discussion and document revision.

This document was produced after a full 17-table audit of the live
Supabase database (Stages 1–5b), which confirmed that all tables were
fully readable and writable by the anonymous role and that no RLS was
in place anywhere in the public schema.

## 1. Scope

17 tables in the public schema. Zero RLS at audit time. Every table
fully readable and writable by anonymous callers using the public anon
key.

This migration:
- locks every table behind RLS
- moves token-based and admin-side mutations to RPCs
- introduces views for column-level masking
- creates `team_admins` as the canonical admin identity table
- creates `audit_events` as a permanent audit log for sensitive admin actions
- adds `live_channel_key` to `teams` for non-guessable realtime broadcast channels
- auth-gates `/create` (the original Session 24 goal, now folded into this work)

Tuesday's beta launches on the current insecure state (accepted risk
for one private beta team, Finbar's Tuesdays). Full migration ships
before Stage 2 beta on 26 May.

## 2. Access categories

Every policy in this spec reduces to one of these five access mechanisms:

| Category | Mechanism | Used by |
|---|---|---|
| Service role | Bypasses RLS entirely | Cron jobs, server-side writes |
| Token-holder | RPC takes token, validates, returns/mutates | /p/<token>, /admin/<admin_token>, /demoadmin |
| Authenticated team-member | RLS predicate via auth.uid() through team_admins or players+team_players | Squad reads, payment history reads |
| Authenticated self | RLS predicate auth.uid() = user_id (or join-equivalent) | Own user_profile, own player_career |
| Anonymous | Specific RPCs only | Demo interaction tracking |

## 3. Helper functions (final set)

Four SQL helpers, used across all policies. Defined as SECURITY DEFINER
functions returning boolean.

```
is_team_member(p_team_id text) returns boolean
shares_team_with_player(p_player_id text) returns boolean
shares_team_with_user(p_user_id uuid) returns boolean
is_my_player_id(p_player_id text) returns boolean
```

Behavioural notes:
- All return false for null inputs.
- All are STABLE (results unchanged within a single statement).
- Group 4's `can_see_user_profile` and `can_see_player_career` are
  implemented as thin wrappers over `shares_team_with_user` and
  `shares_team_with_player` respectively (plus own-identity check).

## 4. Views (final set)

| View | Source table | Excludes |
|---|---|---|
| teams_public | teams | admin_token, admin_email |
| players_public | players | token, user_id, paid_at, role_scope |
| matches_public | matches | teams_draft, payments |

All views use `security_invoker = true` so they respect the caller's
RLS context. Base table grants explicitly revoked from anon and
authenticated; views explicitly granted.

## 5. New tables

### 5.1 team_admins

```sql
team_admins (
  id uuid PK default gen_random_uuid(),
  team_id text REFERENCES teams(id),
  user_id uuid REFERENCES auth.users(id),
  role text CHECK (role IN ('team_admin', 'vice_captain', 'club_admin', 'super_admin')),
  granted_by uuid NULL,
  granted_at timestamptz DEFAULT now(),
  revoked_at timestamptz NULL,
  revoked_by uuid NULL,
  created_at timestamptz DEFAULT now()
)

UNIQUE INDEX team_admins_uniq_active
  ON team_admins (team_id, user_id, role)
  WHERE revoked_at IS NULL

INDEX team_admins_by_user ON team_admins (user_id) WHERE revoked_at IS NULL
INDEX team_admins_by_team ON team_admins (team_id) WHERE revoked_at IS NULL
```

RLS: members of the team can read; only service role / dedicated RPCs
can write (admin grants are sensitive).

### 5.2 audit_events

```sql
audit_events (
  id uuid PK default gen_random_uuid(),
  team_id text NOT NULL,
  actor_user_id uuid NULL,            -- null for anon token actions
  actor_type text NOT NULL CHECK (
    actor_type IN ('admin', 'vice_captain', 'player', 'service_role', 'system')
  ),
  actor_identifier text NULL,         -- player_id or token-hash when actor_user_id is null
  action text NOT NULL,               -- e.g. 'match_cancelled', 'payment_confirmed'
  entity_type text NOT NULL,          -- 'match', 'player', 'payment_ledger', etc.
  entity_id text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
)

INDEX audit_events_by_team ON audit_events (team_id, created_at DESC)
INDEX audit_events_by_actor
  ON audit_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL
```

RLS: admins of the team can read their team's events. Inserts only
via service role / inside admin RPCs. No DELETE ever.

## 6. Schema additions to existing tables

### 6.1 teams.live_channel_key

```sql
ALTER TABLE teams
  ADD COLUMN live_channel_key text UNIQUE DEFAULT gen_random_uuid()::text;
```

Used as the realtime broadcast channel suffix. Returned only by
token-validating RPCs after authorisation. Channel name format:
`team_live:<live_channel_key>`.

Existing teams rows must be backfilled with non-null values
(migration 020 handles this).

## 7. RPC inventory (final set)

35 RPCs across seven categories. Each RPC is explicit and narrow.
No generic field-updater patterns permitted.

### 7.1 Token-based read RPCs

| RPC | Returns | Notes |
|---|---|---|
| get_player_by_token(p_token text) | Self-row (see §10 for column list) | Excludes token, user_id, paid_at, role_scope, created_at |
| get_team_by_admin_token(p_admin_token text) | Team row + live_channel_key + admin metadata | Token is sole input — team_id derived internally, never accepted as parameter |
| get_team_by_join_code(p_code text) | Team display metadata | Public-display safe columns only |
| get_team_state_by_player_token(p_token text) | Bulk JSON: { player, squad, schedule, matches, bibHistory, settings, coverPool, liveChannelKey } | Squad rows use narrower column set (see §10) |
| get_team_state_by_admin_token(p_admin_token text) | Same shape as above plus admin-only columns (payments, teams_draft) | Token is sole input |

### 7.2 Token-based write RPCs

| RPC | Purpose | Broadcasts? |
|---|---|---|
| set_player_status(p_token text, p_status text, p_note text) | IN/OUT/MAYBE/RESERVE + optional note | Yes |
| set_player_paid(p_token text, p_self_paid boolean, p_paid_by text) | Cash self-confirm | Yes |
| set_player_injured(p_token text, p_injured boolean) | Injury toggle (writes players + player_injuries) | Yes |
| add_guest_player(p_host_token text, p_name text) | Plus One | Yes |
| set_guest_payment(p_host_token text, p_guest_id text, p_self_paid boolean, p_paid_by text) | Plus One payment | Yes |
| player_create_cash_payment_entry(p_token text, p_match_id text) | Ledger entry on self-pay | No (covered by set_player_paid broadcast) |
| cast_potm_vote(p_token text, p_match_id text, p_nominee_id text) | POTM vote | No (votes anonymous, no broadcast) |
| get_my_potm_vote(p_token text, p_match_id text) | Read own vote | N/A (read) |
| register_push_subscription(p_token text, p_subscription jsonb) | Enable notifications | No |
| unregister_push_subscription(p_token text) | Disable notifications | No |

### 7.3 Authenticated read RPCs

| RPC | Returns |
|---|---|
| get_my_player_for_team(p_team_id text) | Full self-row for authenticated user |
| get_my_teams() | List of teams I admin or play on |
| get_potm_tally(p_match_id text) | Aggregated vote counts. **Admin-only access** (not visible to voters during voting) |

### 7.4 Admin-side mutation RPCs

| RPC | Audit event | Broadcasts? |
|---|---|---|
| admin_add_player(p_team_id text, p_name text, p_type text) | Yes | Yes |
| admin_delete_player(p_player_id text) | Yes | Yes — but only if cross-table history guard passes (§9) |
| admin_set_player_status(p_player_id text, p_status text) | Yes | Yes |
| admin_set_player_priority(p_player_id text, p_value text) | Yes | Yes |
| admin_toggle_vc(p_player_id text, p_value boolean) | Yes | Yes |
| admin_disable_player(p_player_id text, p_disabled boolean, p_reason text) | Yes | Yes |
| admin_confirm_payment(p_player_id text, p_match_id text, p_amount int) | Yes | Yes |
| admin_reset_payment(p_player_id text, p_match_id text) | Yes | Yes |
| admin_clear_debt(p_player_id text) | Yes | Yes |
| admin_waive_debt(p_player_id text, p_amount int, p_note text) | Yes | Yes |
| admin_save_match_result(...) | Yes | Yes — see §8 for standalone spec |
| admin_save_teams(p_match_id text, p_team_a text[], p_team_b text[], p_is_draft boolean) | Yes | Yes |
| admin_save_bib_holder(p_match_id text, p_player_id text) | Yes | Yes |
| admin_upsert_schedule(...) | Yes | Yes |
| admin_upsert_settings(p_team_id text, p_group_name text) | Yes | Yes |
| admin_add_cover_player(p_team_id text, p_name text) | Yes | No |
| admin_remove_cover_player(p_id text) | Yes | No |
| admin_update_cover_player(p_id text, p_played int, p_owes int) | Yes | No |
| admin_cancel_match(p_match_id text, p_reason text) | Yes | Yes — consolidates 8-step JS flow into one transaction |

### 7.5 Onboarding RPCs

| RPC | Notes |
|---|---|
| create_team(p_name text, p_admin_email text, p_schedule jsonb, p_player_names text[]) | Single transaction. Auth required. Returns team_id + admin_token. Writes teams + schedule + settings + team_admins + initial players + team_players. Emits audit event. |
| join_team_as_new_player(p_team_id text, p_name text) | Auth required. Writes players + team_players + user_profiles link. Emits audit event. |

### 7.6 Demo RPC

| RPC | Notes |
|---|---|
| update_demo_interaction() | Bumps demo_sessions.last_interaction. Anon-callable. No parameters. No audit. |

### 7.7 RPC count

35 explicit, narrow RPCs. Final count may shift ±2 during Phase B
contract definition (e.g. admin_confirm_payment + admin_reset_payment
may merge into admin_set_payment_status). Any merges must preserve
explicit naming and clear semantic scope. Generic field-updater
patterns are not permitted.

## 8. Standalone spec: admin_save_match_result

This is the highest-risk RPC. It gets its own Phase B spec document
before SQL is drafted.

Requirements:
- Single transaction across matches, player_match, payment_ledger, player_career
- Idempotent on match_id (re-saving same match must not duplicate ledger or career rows — UPSERT throughout)
- Score type handling:
  - 'exact': individual goal counts increment players.goals + player_match.goals
  - 'margin': goals not tracked
  - 'declared': goals not tracked
- Last goal scorer: stored as text on matches.last_goal_scorer; no FK validation (could be guest or deleted player)
- Payment ledger updates:
  - Attended + unpaid IN-players: owes += price_per_player
  - Single-path execution; resolves the dual-path risk noted in CONTEXT.md
- player_career updates: increments per-player aggregates via UPSERT; reads previous match for deltas
- POTM:
  - If score_type allows POTM: sets voting state on schedule + matches (lineup lock + voting open paths)
  - Admin-named POTM (no voting): sets matches.motm directly
- Emits audit_events row with action='match_result_saved', metadata containing full payload
- Broadcasts team_state_changed signal after COMMIT

Detailed spec document produced as first deliverable of Phase B.

## 9. admin_delete_player guard

Hard delete only permitted when player has zero history across:
- players.attended = 0
- No rows in player_match for that player_id
- No rows in payment_ledger for that player_id
- No rows in potm_votes (as voter or nominee)
- No rows in player_injuries

If any history exists, RPC returns error code 'has_history' with
message directing caller to admin_disable_player. UI defaults to
disable; delete only surfaces when guard passes.

## 10. RPC return shapes — exact column lists

### 10.1 Self-row reads (player viewing own data)

`get_player_by_token` and self-row in `get_team_state_by_player_token`
return these columns:

```
id, name, nickname, status, type, priority,
paid, owes, self_paid, paid_by, pay_count,
goals, motm, attended, total, w, l, d, bib_count, late_dropouts,
injured, injured_since,
is_guest, guest_of,
note,
is_vice_captain, disabled, disable_reason,
team
```

Excluded: token, user_id, paid_at, role_scope, created_at

### 10.2 Other-player reads (squad view)

Other players in `get_team_state_by_player_token` squad array return:

```
id, name, nickname, status, type, priority,
is_vice_captain, disabled, injured,
is_guest, guest_of,
team, bib_count, note
```

Excluded: everything financial (paid, owes, self_paid, paid_by,
pay_count, paid_at), all stats (goals, motm, attended, total, w, l, d),
all auth (token, user_id), all metadata (role_scope, created_at,
disable_reason, injured_since, late_dropouts)

### 10.3 Admin view reads

Admins see all columns of all players on their teams via
`get_team_state_by_admin_token`. No column exclusions beyond
sensitive admin-only credentials (admin_token is never returned).

## 11. Realtime broadcast architecture

### 11.1 Channel naming

Format: `team_live:<live_channel_key>`

where `live_channel_key` is a per-team UUID stored on `teams.live_channel_key`,
returned only by token-validated RPCs.

### 11.2 Broadcast payload (locked)

```json
{
  "type": "team_state_changed",
  "reason": "<event_name>",
  "at": "<iso_timestamp>"
}
```

Allowed reason values (initial set):
- player_status_updated
- player_paid_updated
- player_injured_updated
- guest_player_added
- guest_payment_updated
- match_result_saved
- match_cancelled
- match_teams_saved
- match_bibs_saved
- schedule_updated
- player_added
- player_disabled
- player_deleted
- player_vc_toggled
- payment_confirmed
- payment_reset
- debt_cleared
- debt_waived

No payload contains data. Client receives signal and refetches via
authorised RPC.

### 11.3 Trigger mechanism

Broadcasts originate inside RPCs after successful transaction logic,
before COMMIT. No Postgres triggers used for broadcasts.

Pattern:
```sql
-- inside RPC
BEGIN;
  ... mutation ...
  PERFORM realtime.broadcast_changes(
    'team_live:' || v_live_channel_key,
    'team_state_changed',
    jsonb_build_object('reason', 'player_status_updated', 'at', now())
  );
COMMIT;
```

### 11.4 Subscription pattern (client side)

Authenticated users: subscribe to base table via Supabase realtime
which respects RLS. Receive only events for rows they can read.

Token-holders (anonymous): subscribe to the broadcast channel using
the live_channel_key returned by the token RPC. Receive signal-only
events; refetch via RPC on each signal.

## 12. Onboarding write timing

Single RPC at step 3 (`create_team`). Steps 1 and 2 of the UI
collect data in client state only. Step 3 fires the RPC. Atomic
transaction. No partial team state in the DB.

This matches current behaviour (Session 23 fix: onboarding_complete=true
written once at step 3). No regression.

Future feature "resume onboarding" can add per-step persistence in
Phase 2 if needed.

## 13. Auth-gating /create

`/create` becomes auth-required as part of this migration. Anonymous
users hitting /create are redirected to sign-in, returning to /create
after auth via the `ioo_pending_route` sessionStorage pattern
(generalisation of the existing `ioo_pending_join` from Session 9).

The original Session 24 auth-gate goal is satisfied implicitly by
`create_team` RPC requiring auth.

## 14. Constants update

`packages/core/constants/roles.js` becomes live code. `DEPUTY_ADMIN`
renamed to `VICE_CAPTAIN: 'vice_captain'`. Imported by JS layer for
type-checking role parameters passed to admin RPCs and for any UI
that references roles.

Final constant set:
- `SUPER_ADMIN: 'super_admin'`
- `CLUB_ADMIN: 'club_admin'`
- `TEAM_ADMIN: 'team_admin'`
- `VICE_CAPTAIN: 'vice_captain'`

CHECK constraint on `team_admins.role` includes all four, even though
only `team_admin` is in use today.

## 15. Admin token deprecation note

Bearer-token admin URLs (`/admin/<admin_token>`) are preserved by
this migration but flagged as a Stage 1/Stage 2 beta convenience.
Long-term direction (Phase 2+): authenticated admin access via
team_admins replaces bearer-token admin URLs. Phase-out depends on:

- Multi-team admin switcher being built
- Apple Sign In landing (blocked on £79 dev account)
- Admin link reset flow (not yet built)

Deprecation is its own piece of work, not part of this migration.

## 16. Cron job behaviour

All crons in `notify.js` and `cron.js` use SUPABASE_SERVICE_ROLE_KEY.
Service role bypasses RLS. No changes needed to cron logic.

Verification in Phase D confirms all cron paths continue to work
under the new policies.

## 17. Test team strategy

Create `team_audit` during Phase C for migration testing. Seeded
with disposable data. Used to:

- Run each migration file in order
- Verify policies block what they should
- Verify RPCs return correct data
- Verify broadcasts fire
- Verify cron jobs still work

Dropped at end of Phase D. Not part of production data.

## 18. Migration deployment order

1. Database: all SQL migrations applied to test team first, then production
2. Verification on test team for each migration (using §19 test matrix)
3. Client code: refactor to use RPCs and views; deploy as separate release
4. Verification on test team with new client
5. Production cutover: SQL forward, client deploy, verification

SQL forward-compatible: new tables/RPCs/helpers added; old direct
queries still work during overlap period. Old client and new client
both function until cutover.

## 19. Test matrix (Phase D execution)

Each row must pass before migration considered complete.

| Flow | Auth state | Expected |
|---|---|---|
| /p/<token> loads | anon, valid token | Sees own team state via RPC |
| /p/<token> with invalid token | anon | No data, RPC returns null |
| Player changes status | anon, token | Status updates; broadcast fires; other devices on team refetch |
| Another team reads player | anon or auth | Denied (RLS or RPC null) |
| /admin/<admin_token> loads | anon, valid token | Sees full admin state via RPC |
| /demoadmin loads | anon, demo admin token | Demo team state loads |
| Auth'd player reads own career | auth | Allowed via RLS |
| Auth'd player reads unrelated team's data | auth | Denied via RLS |
| /create as anonymous | anon | Redirected to sign-in |
| /create as authenticated | auth | Onboarding loads; create_team RPC succeeds |
| Cron lineupLockJob runs | service role | Allowed; writes player_match |
| Cron potmTallyJob runs | service role | Allowed; sets POTM winner |
| Cron notify.gameDay9am runs | service role | Allowed; reads schedules + sends push |
| Public SELECT on teams | anon | Denied — empty result |
| Public SELECT on players | anon | Denied — empty result |
| Public SELECT on payment_ledger | anon | Denied — empty result |
| Token-holder subscribes to broadcast | anon, valid token | Receives team_state_changed signals |
| Auth admin reads audit_events for own team | auth, team_admins row | Allowed |
| Auth player reads audit_events | auth, not admin | Denied |
| POTM vote tally during voting | auth, player, not admin | Denied (get_potm_tally admin-only) |
| POTM vote tally during voting | auth, team_admins row | Allowed |
| admin_delete_player with no history | auth, admin | Allowed |
| admin_delete_player with history | auth, admin | Returns error 'has_history' |
| Player updates other player's row | anon, token (wrong player) | Denied |
| Realtime: authed player on team A sees team B player update | auth | Denied (RLS filters realtime) |
| Realtime: token-holder receives broadcast for their team | anon, valid token | Allowed |
| Realtime: token-holder receives broadcast for different team | anon | Denied (different channel) |

## 20. Phase B output structure

20 numbered SQL migration files. Each has a corresponding `_down.sql`
for rollback.

```
001_helpers.sql                       is_team_member, shares_team_with_player, shares_team_with_user, is_my_player_id
002_team_admins.sql                   New table, indexes, RLS
003_audit_events.sql                  New table for audit logging, RLS
004_teams_changes.sql                 Add live_channel_key column to teams; backfill existing rows
005_views.sql                         teams_public, players_public, matches_public
006_rls_token_tables.sql              teams, players, push_subscriptions RLS
007_rls_team_scoped_tables.sql        team_players, matches, schedule, settings, bib_history, cover_pool, player_match, player_injuries, potm_votes RLS
008_rls_financial_audit.sql           payment_ledger, notification_log RLS
009_rls_user_data.sql                 user_profiles, player_career, demo_sessions RLS
010_rpcs_token_reads.sql              get_player_by_token, get_team_state_*, get_team_by_*
011_rpcs_player_writes.sql            set_player_status, set_player_paid, set_player_injured, add_guest_player, set_guest_payment, player_create_cash_payment_entry
012_rpcs_admin_player.sql             admin_add_player, admin_delete_player (with cross-table guard), admin_*_player_*
013_rpcs_admin_match_schedule.sql     admin_save_match_result (with standalone spec), admin_save_teams, admin_save_bib_holder, admin_upsert_schedule, admin_upsert_settings, admin_cancel_match
014_rpcs_admin_payments.sql           admin_confirm_payment, admin_reset_payment, admin_clear_debt, admin_waive_debt
015_rpcs_onboarding.sql               create_team, join_team_as_new_player
016_rpcs_potm.sql                     cast_potm_vote, get_my_potm_vote, get_potm_tally
017_rpcs_realtime.sql                 Broadcast helper functions; verification queries
018_rpcs_demo.sql                     update_demo_interaction
019_grants_revokes.sql                Explicit GRANT/REVOKE consolidation; final lockdown
020_seed_backfill.sql                 team_admins backfill (Tarny + team_demo), live_channel_key population, roles.js update verification
```

Each file independently reviewable. Phase B produces all 20 files
plus their _down counterparts plus the admin_save_match_result spec
document.

## 21. Phase B deliverables

1. Standalone spec document: admin_save_match_result
2. RPC contracts document: every RPC's parameters, auth, validation, return shape, errors, side effects, broadcasts emitted
3. 20 forward SQL migration files
4. 20 corresponding _down.sql rollback files
5. Phase C deployment runbook (sequence, verification steps, rollback procedure)

No SQL is run during Phase B. Pure design and review.

## 22. Phase C scope (preview)

- Apply migrations to team_audit (test team)
- Run §19 test matrix on test team
- Update client code: replace direct queries with RPC/view calls
- Apply migrations to production
- Cut client deploy to production
- Re-run §19 test matrix on production

## 23. Phase D scope (preview)

- Comprehensive end-to-end testing of every user flow
- Performance verification (especially player_match read patterns)
- Multi-team admin flow verification
- Broadcast architecture verification under load
- team_audit cleanup
- CONTEXT.md update

## 24. Final tallies

| Item | Count |
|---|---|
| Tables locked under RLS | 17 (existing) |
| New tables | 2 (team_admins, audit_events) |
| Existing tables modified | 1 (teams + live_channel_key) |
| SQL helpers | 4 |
| Views | 3 |
| RPCs | 35 (±2 during Phase B) |
| Migration files | 20 forward + 20 down |
| Client code refactor sites | ~40+ supabase.js calls + App.jsx + onboarding |

## 25. Acceptance for Phase B

Phase B begins on confirmation of this document. Phase B's first
prompt produces:
- The admin_save_match_result standalone spec
- The RPC contracts document
- Migration file 001 (helpers)

After review of those three, Phase B continues with file-by-file
migration drafting.
