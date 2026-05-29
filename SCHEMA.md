# In or Out — Database Schema
*Last updated: May 29 2026 (session 57 — League Mode Phase 4 reception display: venues.display_token + display_config, migs 164–168)*

Cross-reference this with `RPCS.md` for write paths. All writes go through
SECURITY DEFINER RPCs — no direct client writes permitted.

> **Session 59 (Phase 9 cont.) — no schema change.** The league reminder crons reuse the
> existing `fixtures`, `team_players`, `players` (`status`/`phone`/`notification_channel` from
> mig 056) and `notification_log` tables. New push `type` values
> (`leagueAvailability48h`/`leagueFixtureReminder2h`) are free-text — no column added.

---

## RLS ARCHITECTURE

- Row Level Security enabled on all 19 tables
- `anon` and `authenticated` roles: no INSERT/UPDATE/DELETE on any table
- All client writes go through SECURITY DEFINER RPCs (bypass RLS)
- Direct reads: blocked for anon on most tables post-session-24
- Authenticated reads: limited — check policies before assuming they work
- Bulk state reads via `admin_get_team_state` and `player_get_team_state` RPCs

---

## TABLES

### teams
```
id text PK,
name text,
admin_token text UNIQUE,
join_code text,
onboarding_complete bool DEFAULT false,
admin_email text,
team_type text NOT NULL DEFAULT 'casual',  ← casual | competitive — Phase 0C (migration 052)
                                              sport-agnostic; sport lives on league_config.sport
created_at timestamptz
```

### players
```
id text PK,
name text,
token text UNIQUE,
user_id uuid → auth.users (nullable),
type text,
disabled bool DEFAULT false,
priority bool DEFAULT false,
status text CHECK (none/in/out/maybe/reserve),
paid bool DEFAULT false,
owes int DEFAULT 0,
goals int DEFAULT 0,
motm int DEFAULT 0,
attended int DEFAULT 0,
total int DEFAULT 0,
bib_count int DEFAULT 0,
team text,                    ← A/B/null — current match assignment
w int DEFAULT 0,
l int DEFAULT 0,
d int DEFAULT 0,
pay_count int DEFAULT 0,
late_dropouts int DEFAULT 0,
note text,
self_paid bool DEFAULT false,
paid_by text CHECK (self/host/admin/stripe),
is_guest bool DEFAULT false,
guest_of text,                ← player_id of host
injured bool DEFAULT false,
injured_since timestamptz,
nickname text,
role_scope jsonb DEFAULT NULL,       ← dormant; future T2 RBAC
disable_reason text DEFAULT NULL,   ← dormant; future audit log
admin_locked_in bool DEFAULT false, ← true once admin sets status='in'. Player cannot self-restore IN while true; cleared by any admin status change to out/maybe/reserve/none. (migration 038)
created_at timestamptz
```
**Note:** Flat stat columns (goals, motm, bib_count, w, l, d, attended) are
cross-team lifetime totals. `player_match` rows are the per-team source of truth
for all display stats.

### team_players
```
team_id text → teams.id,
player_id text → players.id,
is_vice_captain bool DEFAULT false,  ← per-team VC flag (migrated session 26)
group_number int,                    ← Group Balancer assignment 1–5; NULL = ungrouped
                                       (migration 031; CHECK group_number IS NULL OR 1..5)
PRIMARY KEY (team_id, player_id)
```
**Notes:**
- `is_vice_captain` lives here, NOT on `players`. A player can be VC in
  one team and not another.
- `group_number` is admin-only. Never selected in `get_team_state_by_player_token`.

### matches
```
id text PK,
team_id text → teams.id,
match_date date,             ← ISO date string "2026-05-19"; NOT timestamptz
score_a int,
score_b int,
scorers jsonb,
motm text,                   ← stores player_id (not name); use resolveMotm() to display
bib_holder text,
team_a jsonb,                ← array of player objects; final after any mid-game switches
team_b jsonb,
teams_draft jsonb,           ← { a: [playerIds], b: [playerIds] } — cleared on confirm
winner text,
cancelled bool DEFAULT false,
cancel_reason text,
payments jsonb,              ← { "PlayerName": true/false } — name-keyed, write-only artifact
score_type text CHECK (exact/margin/declared),
last_goal_scorer text,       ← player_id
voting_open bool DEFAULT false,
voting_closes_at timestamptz,
vote_count int DEFAULT 0,
total_voters int DEFAULT 0,
was_admin_decided bool DEFAULT false,
admin_decision_pending bool DEFAULT false,
tied_candidates jsonb,
team_switches jsonb,         ← [{ player_id, from: "A", to: "B" }]
predicted_winner text,       ← "A" | "B" | "draw" | NULL (Group Balancer; migration 031)
predicted_confidence numeric(4,2),  ← 0.00–1.00; raw win-rate delta — admin-only, never shown
balance_score numeric(4,2),         ← duplicate of predicted_confidence at confirm time
                                       (separate column so semantics stay distinct in future)
match_type text NOT NULL DEFAULT 'casual',  ← casual | competitive — Phase 0B (migration 051)
                                       sport-agnostic; sport identity lives on league_config.sport
created_at timestamptz
```
**Group Balancer fields:** `predicted_winner`/`predicted_confidence`/`balance_score`
are populated only when admin uses the Group Balancer to confirm teams.
Pre-feature matches have all three NULL. Admin-only — never selected in the
player-facing RPC.

### bib_history
```
id uuid PK,
team_id text,
name text,
player_id text,             ← nullable for legacy rows
match_date date,
returned bool DEFAULT false,
UNIQUE: bib_history_uniq_team_date (team_id, match_date)  ← one holder per night
```
Both write paths (saveBibHolder + insertBib) use UPSERT with `onConflict: "team_id,match_date"`.

### schedule
```
id uuid PK,
team_id text,
day_of_week text,
kickoff text,
venue text,
city text,
opens_day text,
opens_time text,
priority_lead_mins int,
price_per_player numeric(10,2),
game_is_live bool,
squad_size int,
game_date_time timestamptz,
is_draft bool,              ← ONLY means "onboarding not complete" (NOT the auto-open flag)
is_cancelled bool,
cancel_reason text,
reminders_config jsonb,
lineup_locked bool DEFAULT false,
active_match_id text,
voting_open bool DEFAULT false,
voting_closes_at timestamptz,
bibs_enabled bool DEFAULT true,
auto_open_pending bool DEFAULT true,  ← auto-open flag; reset weekly by advanceGameDateJob
season_id text,
active bool DEFAULT true
```
**Critical distinction:** `is_draft=true` means onboarding not complete. `auto_open_pending=true`
means the game hasn't auto-opened yet this week. These are different flags.

### settings
```
id uuid PK,
team_id text,
group_name text,
group_labels jsonb            ← Group Balancer labels { "1": "Regulars", ... }
                                 (migration 031; NULL = no labels). Admin-only.
```

### cover_pool
```
id uuid PK,
team_id text,
name text,
played int,
owes int,
created_at timestamptz
```

### push_subscriptions
```
id text PK,
player_id text,
player_token text,
team_id text,
subscription jsonb,
created_at timestamptz DEFAULT now(),
UNIQUE on player_id
```

### notification_log
```
id uuid PK DEFAULT gen_random_uuid(),
team_id text,
player_id text,
type text,                          -- push cronType OR (mig 163) the audit action for email
game_date date,
sent_at timestamptz DEFAULT now(),  -- NULL = queued (quiet hours); set when sent
queued_for timestamptz,
queued_payload jsonb,
channel text,                       -- mig 163: 'email' for Resend sends; NULL on legacy push rows
entity_id text,                     -- mig 163: audit entity the email is about (competition_team_id / fixture_id)
recipient text                      -- mig 163: email address the message went to
```
Email dedup (Phase 9 Cycle 9.1) = `(type, entity_id, recipient) WHERE channel='email' AND sent_at IS NOT NULL`
(partial index `notification_log_email_dedup_idx`). Push path keys on `(team_id, type, game_date)` and is
unaffected (its rows have `channel IS NULL`).

### player_match
```
id uuid PK DEFAULT gen_random_uuid(),
team_id text,
match_id text,             ← text, NOT uuid — app generates IDs
player_id text,
match_type text NOT NULL DEFAULT 'casual',  ← casual | competitive — Phase 0D (migration 053)
                                              auto-propagates from matches.match_type via BEFORE INSERT trigger
team_assignment text CHECK (A/B),
result text CHECK (w/l/d),
attended boolean DEFAULT false,
late_cancel boolean DEFAULT false,
injury_absence boolean DEFAULT false,
was_motm boolean DEFAULT false,
had_bibs boolean DEFAULT false,
is_guest boolean DEFAULT false,
goals int DEFAULT 0,
assists int DEFAULT NULL,           ← Phase 3
clean_sheet boolean DEFAULT NULL,   ← Phase 3
yellow_cards int DEFAULT NULL,      ← Phase 3
red_cards int DEFAULT NULL,         ← Phase 3
own_goals int DEFAULT NULL,         ← Phase 3
rating numeric(3,1) DEFAULT NULL,   ← Phase 3
created_at timestamptz,
UNIQUE (match_id, player_id)        ← required for UPSERT in lineupLockJob
```
**Source of truth** for all per-team stats. `players` flat columns are write-only
convenience fields, not used for display.

### player_career
```
player_id text PK,
total_teams int,
total_games int,
total_wins int,
total_losses int,
total_draws int,
total_goals int,
total_motm int,
casual_games int NOT NULL DEFAULT 0,         ← Phase 0D (migration 053)
casual_goals int NOT NULL DEFAULT 0,
casual_wins int NOT NULL DEFAULT 0,
casual_losses int NOT NULL DEFAULT 0,
casual_draws int NOT NULL DEFAULT 0,
casual_motm int NOT NULL DEFAULT 0,
competitive_games int NOT NULL DEFAULT 0,    ← Phase 0D (migration 053)
competitive_goals int NOT NULL DEFAULT 0,
competitive_wins int NOT NULL DEFAULT 0,
competitive_losses int NOT NULL DEFAULT 0,
competitive_draws int NOT NULL DEFAULT 0,
competitive_motm int NOT NULL DEFAULT 0,
career_win_rate numeric(5,2) DEFAULT NULL,
career_reliability numeric(5,2) DEFAULT NULL,
career_impact numeric(5,2) DEFAULT NULL,
best_team_id text,
created_at timestamptz,
updated_at timestamptz
```
**Status:** Recompute via `sync_player_career(p_player_id)` RPC (Phase 0D — migration 053). Service-role only for now; admin-triggered sync wrapper lands Phase 2. `total_*` = `casual_*` + `competitive_*`. Reliability / impact / win-rate / best_team_id still empty until Phase 2.

### player_injuries
```
id uuid PK,
player_id text,
team_id text,
injured_at timestamptz,
cleared_at timestamptz,   ← NULL = currently injured
marked_by text CHECK (player/admin),
created_at timestamptz
```

### payment_ledger
```
id uuid PK,
team_id text,
player_id text,
match_id text,            ← nullable — null before lineup lock runs
amount int,
type text CHECK (game_fee/guest_fee/debt_payment/waiver/refund/cancelled),
status text CHECK (paid/unpaid/waived/disputed/refunded/cancelled),
method text CHECK (cash/stripe/admin/waived),
paid_by text CHECK (self/host/admin/stripe),
paid_at timestamptz,
note text,
created_at timestamptz,
updated_at timestamptz
```
**Partial unique indexes** (standard UNIQUE won't work — NULL != NULL in PG):
- `payment_ledger_uniq_with_match` ON (player_id, team_id, type, match_id)
  WHERE match_id IS NOT NULL
- `payment_ledger_uniq_without_match` ON (player_id, team_id, type)
  WHERE match_id IS NULL

**Important:** PostgREST `.upsert()` cannot target partial unique indexes.
Use INSERT + catch `23505` error code instead.

### potm_votes
```
id uuid PK DEFAULT gen_random_uuid(),
match_id text,
team_id text,
voter_id text,
nominee_id text,
created_at timestamptz DEFAULT now(),
UNIQUE (match_id, voter_id)   ← one vote per player per match
```

### demo_sessions
```
id text PK DEFAULT 'main',
last_reset timestamptz,
last_interaction timestamptz
```

### team_admins
```
team_id text → teams.id,
user_id uuid → auth.users,
created_at timestamptz,
PRIMARY KEY (team_id, user_id)
```
Written by `create_team` RPC during onboarding. Seeded for `team_demo` via migration 020.
**Note:** `team_demo` is missing a row here — Tarny's switcher won't show it. See BUGS.md #8.

### platform_admins
```
user_id uuid PK → auth.users(id) ON DELETE CASCADE,
granted_at timestamptz DEFAULT now(),
granted_by uuid → auth.users(id),
note text

RLS ENABLED; no client policies. Reads/writes only via SECURITY DEFINER RPCs.
REVOKE ALL FROM anon, authenticated.
```
**Global cross-team authorisation layer**, parallel to per-team `team_admins`.
Membership grants access to the `superadmin_*` RPCs (migrations 045, 046) and the
`apps/superadmin` dashboard. Helper function `is_platform_admin()` returns true iff
`auth.uid()` exists in this table; every superadmin RPC opens with that gate.
Migration 045. Seeded by hand only — no UI to grant this role.

### audit_events
```
id uuid PK DEFAULT gen_random_uuid(),
team_id text,
actor_id text,
event_type text,
payload jsonb,
created_at timestamptz DEFAULT now()
```
Written by SECURITY DEFINER RPCs for all admin mutations.

### ai_briefings
```
id uuid PK DEFAULT gen_random_uuid(),
team_id text NOT NULL → teams.id,
audience text CHECK (admin/player/hq),
surface text CHECK (
  team_summary | payment_summary | attendance_risk
  | matchday_briefing | post_match_summary
  | opposition_intel | hq_weekly_digest | qa
),
match_id text → matches.id NULL,
player_id text → players.id NULL,
content text NOT NULL,
context_snapshot jsonb NOT NULL,     ← every claim traceable to this
prompt_key text NOT NULL,            ← e.g. 'team_summary.v1'
model text NOT NULL,                 ← e.g. 'claude-sonnet-4-5'
tokens_in int, tokens_out int,
cost_pence numeric(10,4),
question text,                       ← only populated when surface='qa'
generated_at timestamptz DEFAULT now()

INDEX ai_briefings_team_surface_idx (team_id, surface, generated_at DESC)
INDEX ai_briefings_team_match_idx   (team_id, match_id) WHERE match_id IS NOT NULL
```
**Source of truth for Ask the Gaffer outputs.** Every row links its
generated `content` to the exact `context_snapshot` the LLM was given —
factual audits are SELECT against this column. Writes via service role
only (edge function). RLS: admins read their team's `audience='admin'`
rows; players read their own `audience='player'` rows. Migration 033.

---

## PHASE 0 + PHASE 1: LEAGUE MODE TABLES (migrations 050–057)

20 new tables landed in Phase 1 (migration 055). All RLS-enabled with NO
public policies — reads and writes happen via SECURITY DEFINER RPCs that
arrive in Phase 2+. All currently empty.

**Multi-sport posture (DECISIONS.md session 40):**
- `companies.sport`, `venues.sport`, `leagues.sport` text DEFAULT 'football'
- `leagues.format` open text DEFAULT '5-a-side' (no CHECK)
- `match_events.event_type` + `match_events.period` open text (no CHECK) so
  each sport defines its own vocabulary in code
- `playing_areas` (was `pitches` in spec — covers football pitches,
  basketball courts, hockey rinks, tennis courts, boxing rings)
- `match_officials` (was `referees` in spec — covers referees, umpires,
  judges)

### Phase 0 tables (migrations 050, 054)

- `league_config` — labels + match config + sport per league. Platform-default
  row exists (league_id IS NULL). `league_id` FK to `leagues(id)` added in 057.
  Mig 161 (Cycle 5.7) added `min_starting int NULL` (CHECK >0) and `max_subs int
  NULL` (CHECK >=0) — per-league matchday teamsheet bounds (NULL = unbounded),
  enforced by `team_admin_submit_lineup`.
- `company_domains` — email-domain → company mapping for HQ admin auto-routing.
  `company_id` FK to `companies(id)` added in 057.

### Phase 1 — HQ layer

- `companies` — text PK. Stripe customer/subscription columns. sport DEFAULT 'football'.
- `company_admins` — user_id (auth.users) ↔ company_id. Roles: super_admin / regional_admin / analyst.
- `billing_events` — polymorphic via entity_type ('venue'|'company') + entity_id. Stripe event audit trail.

### Phase 1 — Club layer

- `clubs` — text PK. name, short_name, founded_year.

### Phase 1 — Venue layer

- `venues` — text PK. company_id (nullable — independent venues allowed). venue_admin_token. display_pin. Stripe columns. sport DEFAULT 'football'. **Phase 4 (mig 164):** `display_token text NOT NULL DEFAULT gen_random_uuid()::text` (UNIQUE — per-venue READ-ONLY public token for the reception big-screen `/display/TOKEN`; NOT the venue_admin_token) + `display_config jsonb` (panel/layout config: `{zones[],mode,interval_secs,custom_message}`; NULL = app default). White-label `logo_url`/`primary_colour`/`secondary_colour` already existed.
- `venue_admins` — user_id ↔ venue_id. Roles: admin / staff.
- `playing_areas` — venue_id, name, surface, capacity. (Multi-sport rename of `pitches`.)
- `match_officials` — venue_id, name, contact channels, preferred_channel. (Multi-sport rename of `referees`.)

### Phase 1 — League / Season / Competition layer

- `leagues` — text PK. venue_id. sport, format (both flexible). default_playing_area_id → playing_areas. league_admin_token, display_token.
- `seasons` — league_id, start/end dates, num_weeks, status (setup/active/completed/archived).
- `competitions` — season_id, type (league/cup/playoff), format (round_robin/single_elimination/double_elimination/group_stage), status.
- `club_teams` — junction: club_id ↔ team_id. UNIQUE(team_id) — a team belongs to one club.
- `competition_teams` — junction: competition_id ↔ team_id. status (active/withdrawn/expelled).
- `team_name_history` — team_id, name, effective_from_season_id / effective_to_season_id. Audit of team renames across seasons.
- `cup_rounds` — competition_id, round_number, round_name, num_teams, status.

### Phase 1 — Fixture / event layer

- `fixtures` — competition_id, home_team_id, away_team_id (nullable = bye), week_number, scheduled_date, kickoff_time, playing_area_id, official_id, ref_token (per-fixture, unique). status (scheduled/allocated/in_progress/completed/postponed/void/walkover). home_score/away_score.
- `match_events` — fixture_id, team_id, player_id, event_type (open text), minute, period (open text), sub_player_on_id, sub_player_off_id, recorded_by_token + recorded_by_type, synced_at (NULL = recorded offline), local_timestamp.
- `player_registrations` — player_id, competition_id, team_id, registration_number, status (active/suspended/ineligible), suspension_until/reason. UNIQUE(player_id, competition_id).

### Phase 1 — Operations layer

- `incidents` — venue_id, fixture_id (nullable), reported_by (auth.users), description, severity (info/warning/critical), resolved_at/by/note.
- `hq_preview_tokens` — company_id, token (per-token unique), generated_by, expires_at, accessed_at.

### Phase 1 — Additions to existing tables (migration 056)

| Table | New columns |
|---|---|
| `teams` | `club_id text NULL FK → clubs`, `primary_colour text NULL`, `secondary_colour text NULL` |
| `matches` | `fixture_id uuid NULL FK → fixtures`, `opponent_team_id text NULL`, `opponent_name text NULL` |
| `players` | `shirt_number int NULL`, `date_of_birth date NULL`, `phone text NULL`, `notification_channel text NOT NULL DEFAULT 'push' CHECK ('push'/'whatsapp'/'sms'/'email')` |
| `player_match` | `minutes_played int NULL`, `was_substitute bool NOT NULL DEFAULT false`, `shirt_number int NULL` |

All additive, all backfilled via DEFAULT, all metadata-only ALTERs.

### RLS posture on new tables

Every Phase 0 + Phase 1 table: RLS enabled, NO public policies. All access
via SECURITY DEFINER RPCs that arrive in Phase 2+. REVOKE ALL FROM anon,
authenticated. The only exception: `get_league_config` and
`get_company_by_domain` RPCs are GRANTed to anon + authenticated (must
work pre-auth for OAuth callback and landing pages).

---

## PITCH BOOKING TABLES (migration 133+)

Casual pitch booking + the unified occupancy guard. Booking session owns
the booking tables; the venue session writes fixtures/maintenance into
`pitch_occupancy` via its own triggers.

### pitch_occupancy (migration 133) — the single occupancy source of truth

One row = "this pitch is taken for this time-range", from any source.
RLS-enabled, REVOKE anon/authenticated (RPC-only).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `playing_area_id` | uuid NOT NULL | FK → `playing_areas(id)` ON DELETE CASCADE |
| `venue_id` | text NOT NULL | FK → `venues(id)` ON DELETE CASCADE (denormalised for calendar reads) |
| `time_range` | tstzrange NOT NULL | half-open `[)` so back-to-back slots don't collide |
| `source_kind` | text NOT NULL | CHECK in (`fixture`,`booking`,`maintenance`) |
| `source_id` | text NOT NULL | `fixtures.id::text` / `pitch_bookings.id::text` / venue maint key |
| `priority` | smallint NOT NULL | CHECK 0–3. 0=maintenance (top, non-displaceable), 1=fixture, 2=block, 3=ad-hoc |
| `active` | boolean NOT NULL | DEFAULT true |
| `created_at` | timestamptz NOT NULL | DEFAULT now() |

- **Partial exclusion guard:** `EXCLUDE USING gist (playing_area_id WITH =,
  time_range WITH &&) WHERE (active)` — two *active* rows can never overlap
  on a pitch. Displacement = set the loser `active=false`, then insert/activate
  the winner in the same transaction (the partial EXCLUDE then can't fire).
- **Idempotent re-sync:** `UNIQUE (source_kind, source_id)` — upsert key for
  the venue trigger's `ON CONFLICT`.
- GiST index `pitch_occupancy_venue_range_idx` on `(venue_id, time_range)
  WHERE active` for the calendar grid read.
- Requires the `btree_gist` extension (installed in mig 133).

### Stage 2a — projection layer (migrations 134–138)

**Additive columns (mig 134):**

| Table | Column | Notes |
|---|---|---|
| `league_config` | `slot_minutes int NOT NULL DEFAULT 60` | occupancy length for fixtures (CHECK > 0). NEVER `match_duration_mins`. |
| `fixtures` | `slot_minutes int NULL` | per-fixture override (CHECK NULL or > 0) |
| `venues` | `bookings_enabled boolean NOT NULL DEFAULT false` | discovery opt-in |
| `venues` | `cancellation_policy text NULL` | shown on the booking confirm screen |
| `playing_areas` | `booking_windows jsonb NOT NULL DEFAULT '[]'` | recurring-weekly `[{day_of_week 0-6, open_time, close_time, slot_lengths:[…]}]` |

**Triggers projecting into `pitch_occupancy`:**
- `sync_maintenance_occupancy` on `playing_areas` (AFTER INSERT OR UPDATE OF
  `maintenance_windows`, fn `tg_sync_maintenance_occupancy`): date-range windows →
  `[start 00:00, (end+1) 00:00)` @ Europe/London, `priority=0`. `range_agg` merges
  overlapping/adjacent windows. Re-sync = delete this pitch's maintenance rows, re-insert.
- `sync_fixture_occupancy` on `fixtures` (AFTER INSERT OR UPDATE OF
  `status, playing_area_id, scheduled_date, kickoff_time, slot_minutes`, fn
  `tg_sync_fixture_occupancy`): pitch-holding statuses with pitch+date+kickoff →
  `priority=1`, length `COALESCE(fixtures.slot_minutes, league_config.slot_minutes, 60)`,
  `(date+kickoff)` @ Europe/London, half-open. Releasing status / cleared pitch →
  deactivate the row. NO auto-yield of bookings yet (Stage 2b).

**RPC behaviour (migs 135/138):**
- `venue_update_pitch` edits `booking_windows`; a maintenance window that overlaps an
  existing occupancy raises `maintenance_window_conflicts_occupancy`.
- `venue_assign_pitch` / `venue_generate_fixtures` translate the trigger's partial-EXCLUDE
  violation into `pitch_double_booked`.
- `venue_get_state` exposes `booking_windows` in its `pitches` projection.

### Stage 2b — priority displacement (migrations 142–143)

- **Fixture-trigger auto-yield (mig 142):** when a fixture claims a slot, the
  trigger releases overlapping **un-confirmed** (`requested`) lower-priority
  bookings — `pitch_occupancy.active=false`, `pitch_bookings.status='superseded'`,
  notify both channels. Confirmed bookings are never auto-yielded.
- **booking_* reasons (mig 142):** all five (`booking_requested`, `_confirmed`,
  `_declined`, `_cancelled`, `_superseded`) added to both `notify_venue_change`
  and `notify_team_change` whitelists. `booking_superseded` fires now; the rest
  fire from the Stage 4 write RPCs.
- **Confirmed-clash gate (mig 143):** `venue_assign_pitch` /
  `venue_generate_fixtures` gain a defaulted `p_displace_booking_ids uuid[]` param
  (old 3-arg signatures dropped; named-arg JS calls resolve via the default). They
  detect an overlapping **confirmed** booking and refuse with
  `confirmed_booking_clash` (DETAIL = csv of booking ids) unless those ids are
  passed in `p_displace_booking_ids`, in which case they're displaced
  (`superseded` + notify) in the same txn before the fixture write.

### League Mode — fixture-completion status reset (migration 157)

- **`trg_reset_status_on_fixture_played`** (AFTER UPDATE ON `fixtures`, fn
  `reset_team_status_on_fixture_played`, SECURITY DEFINER): when a fixture goes
  `scheduled → completed/walkover/forfeit/void`, resets both teams' `players.status`
  to `'none'` and fires `notify_team_change(...,'schedule_updated')` for each team.
  Backs Cycle 5.5 "competitive availability reuses the casual in/out board" — so each
  league fixture starts with a clean in/out slate. No new column; no availability table.

### Stage 3 — booking storage (migration 139)

Both RLS-enabled, REVOKE anon/authenticated (RPC-only). Payment OFF but
schema-wired. Occupancy rows are written by the Stage 4 write RPCs, not here.

**booking_series** (recurring block-booking parent):
`id uuid pk`, `team_id text NOT NULL →teams (CASCADE)`, `venue_id text →venues`,
`playing_area_id uuid →playing_areas`, `day_of_week smallint (0–6)`,
`kickoff_time time`, `slot_minutes int (>0 or NULL)`,
`status text (active|ending|cancelled) default active`, `ends_on date`, `created_at`,
`renewal_of_series_id uuid NULL →booking_series` (mig 151 — set on a renewal-hold series,
points at the origin; origin flips to `ending` when its hold is created),
`hold_expires_at timestamptz NULL` (mig 151 — renewal grace deadline; NULL once kept/expired).

**pitch_bookings** (concrete one-off / weekly rows):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | text NULL →teams (CASCADE) | NULL for walk-ins |
| `booked_by_name` | text NULL | walk-in display name |
| `venue_id` | text NOT NULL →venues | |
| `playing_area_id` | uuid NOT NULL →playing_areas | |
| `booking_date` | date NOT NULL | |
| `kickoff_time` | time NOT NULL | |
| `slot_minutes` | int NULL | per-booking length (COALESCE 60 downstream) |
| `kind` | text | CHECK `block`/`adhoc` |
| `status` | text | CHECK `requested`/`confirmed`/`declined`/`cancelled`/`superseded`/`expired`/`hold`, default `requested` (`hold` = renewal hold, mig 151) |
| `amount_pence` | int NULL | payment off |
| `payment_status` | text | CHECK `not_required`/`pending`/`paid`/`refunded`, default `not_required` |
| `series_id` | uuid NULL →booking_series (CASCADE) | block week's parent |
| `superseded_at` | timestamptz NULL | mig 151 — set by the fixture auto-yield trigger; polled by the superseded push |
| `created_at` | timestamptz | |

- CHECK `pitch_bookings_booker_present`: `team_id IS NOT NULL OR booked_by_name IS NOT NULL`.
- Indexes: `(venue_id, booking_date)`; partial on `team_id`; partial on `series_id`.

Read RPCs (`search_bookable_venues`, `get_pitch_free_slots`, `get_pitch_occupancy`)
in RPCS.md, migrations 140–141.

**Stage 7 renewal (migs 151–152):** a series within 21 days of `ends_on` auto-creates a
renewal-hold child series (`renewal_of_series_id` set, `hold_expires_at` = +7d clamped) with
`pitch_bookings.status='hold'` + active occupancy (priority 2); origin → `ending`. Team
`confirm_renewal` flips holds → `requested` (venue re-approves); `expire_renewal_holds`
releases lapsed holds (→ `expired`, occupancy off, series `cancelled`). All driven by
`api/cron.js renewalHoldsJob` (09:00 UK). RPC inventory in RPCS.md.

---

## KEY TYPE NOTES

| Field | Type | Notes |
|---|---|---|
| `match_id` | text | App generates IDs — NOT uuid |
| `match_date` | date | Returns ISO string `"2026-05-14"` — sorts correctly with `new Date()` |
| `matches.motm` | text | Stores player_id, NOT name. Use `resolveMotm(value, players)` to display |
| `bib_holder` | text | Stores player_id for new rows; legacy rows may have name string |
| `price_per_player` | numeric(10,2) | Altered from int in session 27 |
| `player_match.match_id` | text | NOT a FK to matches.id — text match only |

---

## VIEWS

### players_public
Defined in migration 005. `LEFT JOIN team_players tp ON tp.player_id = p.id`.
Exposes `is_vice_captain` from `team_players` (not `players`). Recreated in
migration 026 after `players.is_vice_captain` column was dropped.

---

## REALTIME

Enabled on: `players`, `schedule`, `matches`.
All three realtime callbacks in App.jsx branch on `route.type` — player/admin/demoadmin
routes use RPCs; direct reads only for authenticated fallback.

---

## PERFORMANCE INDEXES

Added session 21:
- `idx_player_match_team_attended` — on player_match(team_id, attended)
- `idx_player_match_team_player` — on player_match(team_id, player_id)
- `idx_matches_team_date` — on matches(team_id, match_date)
