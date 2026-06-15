# In or Out — Database Schema
*Last updated: May 29 2026 (session 60 — League Mode Phase 6 HQ: venues.region + audit_events.actor_type+=company_admin + demo company seed + company_admins.dashboard_config, migs 169–173)*

Cross-reference this with `RPCS.md` for write paths. All writes go through
SECURITY DEFINER RPCs — no direct client writes permitted.

> **Session 59 (Phase 9 cont.) — no schema change.** The league reminder crons reuse the
> existing `fixtures`, `team_players`, `players` (`status`/`phone`/`notification_channel` from
> mig 056) and `notification_log` tables. New push `type` values
> (`leagueAvailability48h`/`leagueFixtureReminder2h`) are free-text — no column added.
>
> **Session 60 (Phase 6.1 HQ dashboard) — schema changes (migs 169–171):**
> - `venues.region text NULL` (mig 169) — regional_admin scoping; `hq_*` RPCs filter venues to
>   `company_admins.region` when role='regional_admin'.
> - `audit_events.actor_type` CHECK gains `'company_admin'` (mig 171) — was absent (mig-088/092
>   bug class). NOTE: `audit_events.team_id` is **NOT NULL with no FK to teams** — venue/league/HQ
>   events store the **venue_id** there (it's a scoping key, not a team reference).
> - Demo seed (mig 170): `companies` row `company_demo` + `venues.company_id` link + a 2nd venue +
>   `company_admins` (tarny super_admin) + `incidents`. Reversible via `170_down`.
> - No new tables — the HQ spine (`companies`, `company_admins`, `company_domains`,
>   `billing_events`, `hq_preview_tokens`, `incidents`, `venues.company_id`) already existed (mig 055/057).
> - `company_admins.dashboard_config jsonb NULL` (mig 172, Cycle 6.3) — per-admin composable HQ
>   dashboard layout `{preset, cards[]}`; NULL = default preset. Card keys map to
>   `hq_get_analytics` datasets. Additive.

---

> **Session 87 (Ref V2 — RefSix-killer) — schema changes (migs 261–263):**
> - `fixtures`: `clock_paused_at timestamptz`, `clock_paused_ms bigint DEFAULT 0`,
>   `added_time jsonb DEFAULT '{}'` (stoppage minutes per period, e.g. `{"1H":2}`),
>   `format_override jsonb NULL` (mig 261). Per-fixture pausable clock + persisted stoppage +
>   timing override. Clock model: `elapsed = now − actual_kickoff_at − clock_paused_ms −
>   (clock_paused_at ? now − clock_paused_at : 0)`. Pause is per-fixture (one match freezes, others run).
> - `match_events`: `note_text text`, `duration integer` (mig 262) — for `note` and `sin_bin`
>   events. `event_type`/`period` stay OPEN TEXT (sport-extensible; new values `note`, `sin_bin`,
>   `clock_pause`, `clock_resume` — no constraint change).
> - `league_config`: `num_periods integer`, `period_length_mins integer`, `period_names text[]`
>   (mig 263) — generalises the legacy `has_halves` (kept for back-compat) to single/halves/quarters;
>   back-filled from `has_halves` so existing leagues are behaviour-identical.

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
is_guest bool DEFAULT false,  ← PERSISTENT (session 72, migs 216–219): guests are NEVER
                              -- auto-deleted; on rollover/host-remove they go DORMANT
                              -- (is_guest=true, status='none'). Hidden from the board via
                              -- isDormantGuest(p); excluded from reliability+POTM until promoted.
                              -- Promotion (admin_promote_guest OR link_player_to_user via the
                              -- guest's own token link) flips is_guest=false on the same row.
guest_of text,                ← player_id of host (cleared on promotion)
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
- **Multi-sport-per-venue (Membership Phase 1, mig 269):** `venues.sports
  text[] NOT NULL DEFAULT ARRAY['football']` — a venue self-declares the set
  of sports it offers, as plain text (NOT the session-84-rejected `sports`
  lookup table; extends the self-identified-text posture above). `venues.sport`
  remains the primary/default sport. `playing_areas.sport text NULL` (NULL =
  inherits the venue's primary sport) scopes a pitch/court to a sport.
  Membership tiers' `sports_included` (Phase 3) references these text values.

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
- `venue_admins` — user_id ↔ venue_id. Roles: owner / manager / staff (migs 237–240). `caps_grant`/`caps_deny text[]` constrained by `venue_admins_caps_known` CHECK to the known gated keys: reverse_money, booking_settings, manage_facility, staff_directory, manage_logins, **manage_memberships** (added mig 269). `_venue_has_cap`: owner+manager pass by default, staff only if granted.
- `playing_areas` — venue_id, name, surface, capacity, **sport text NULL** (mig 269; NULL = inherit venue primary sport). (Multi-sport rename of `pitches`.)
- `match_officials` — venue_id, name, contact channels, preferred_channel. (Multi-sport rename of `referees`.)

### Phase 1 — League / Season / Competition layer

- `leagues` — text PK. venue_id. sport, format (both flexible). default_playing_area_id → playing_areas. league_admin_token, display_token.
- `seasons` — league_id, start/end dates, num_weeks, status (setup/active/completed/archived).
- `competitions` — season_id, type (league/cup/playoff), format (round_robin/single_elimination/double_elimination/group_stage), status. **`config` jsonb (mig 191, Phase 11.4)** — cup settings `{num_groups, qualifiers_per_group, knockout_seeded}` for group_stage cups; `{}` otherwise.
- `club_teams` — junction: club_id ↔ team_id. UNIQUE(team_id) — a team belongs to one club.
- `competition_teams` — junction: competition_id ↔ team_id. status (active/withdrawn/expelled). **`group_label` + `seed` (mig 191, Phase 11.4)** — group-stage group (A/B/…) + draw seed; NULL for non-group comps.
- `fixtures.group_label` (mig 191, Phase 11.4) — group-stage fixture's group; NULL for league/knockout fixtures.
- `team_name_history` — team_id, name, effective_from_season_id / effective_to_season_id. Audit of team renames across seasons.
- `cup_rounds` — competition_id, round_number, round_name, num_teams, status. (Populated from Phase 11 Cycle 11.1 — was empty groundwork before.)
- `cup_ties` — **Phase 11 (mig 184).** The persisted single-elim bracket tree: id, competition_id, round_number, slot_index, round_name, fixture_id (NULL for byes/not-yet-created), home_team_id, away_team_id, home_source/away_source ('seed'|'bye'|'winner'), home_feeder_slot/away_feeder_slot (which slots of round−1 feed each side — advancement is a feeder lookup), winner_team_id, status ('pending'|'ready'|'decided'). UNIQUE(competition_id, round_number, slot_index). RLS on, RPC-only. Written by `venue_persist_cup_bracket`; advanced by Cycle 11.2.

### Phase 1 — Fixture / event layer

- `fixtures` — competition_id, home_team_id, away_team_id (nullable = bye), week_number, scheduled_date, kickoff_time, playing_area_id, official_id, ref_token (per-fixture, unique). status (scheduled/allocated/in_progress/completed/postponed/void/walkover). home_score/away_score. `cup_tie_id` (Phase 11 mig 184) links a cup fixture back to its `cup_ties` bracket slot. **Knockout decider (Phase 11 mig 186):** `aet_home_score`/`aet_away_score` (extra-time aggregate, NULL if none), `pens_home_score`/`pens_away_score` (shootout), `ko_winner_id` (winner when a level tie is decided by ET/pens), `decided_by` ('regulation'|'extra_time'|'penalties'|'walkover'|'forfeit'; NULL for league/unfinished).
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

## MEMBERSHIP TABLES (Venue Membership programme, mig 270+)

Venue-domain, RLS-walled, RPC-only. Never cross the casual↔venue wall.

<!-- mig 275: venue_customers.status CHECK gains 'pending' (self-signup awaiting
     venue approval). Values now: pending | active | archived | erased.
     mig 280: + requested_tier_id uuid →venue_membership_tiers (which paid tier a
     pending self-signup asked for; cleared on approve-and-enrol). Tier free/signup
     flags live on venue_membership_tiers.benefits jsonb: is_free, self_signup. -->
### venue_customers (mig 270, Phase 2; +`pending` status mig 275; +`requested_tier_id` mig 280; +360Player registration fields mig 282) — per-person/family identity

The venue domain's first **person** entity (before this, customers were
*derived* from `pitch_bookings`). Backs per-person memberships.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `venue_id` | text NOT NULL | FK → `venues(id)` ON DELETE CASCADE |
| `first_name` | text NOT NULL | (`'[erased]'` after GDPR erasure) |
| `last_name` | text NULL | |
| `email` | text NULL | de-dup key (lower) per venue |
| `phone` | text NULL | |
| `dob` | date NULL | junior pricing + age-up |
| `household_id` | uuid NULL | shared uuid groups a family; NULL = none |
| `status` | text NOT NULL | `active`/`archived`/`erased` (DEFAULT active) |
| `notes` | text NULL | |
| `created_at`/`updated_at` | timestamptz NOT NULL | DEFAULT now() |
| **mig 282 — identity** | | |
| `gender` | text NULL | |
| `address_line1`/`address_line2`/`address_city`/`address_postcode` | text NULL | structured address (postcode queryable for catchment/exports) |
| **mig 282 — emergency contact** | | |
| `emergency_name`/`emergency_relationship`/`emergency_phone` | text NULL | |
| **mig 282 — medical (special category)** | | |
| `medical_conditions`/`allergies`/`medications`/`gp_details` | text NULL | gated behind `consent_medical` |
| **mig 282 — guardian (under-18s)** | | |
| `guardian_name`/`guardian_relationship`/`guardian_phone`/`guardian_email` | text NULL | name+phone required if `dob` < 18y |
| **mig 282 — consents** (each a bool + `_at` pair) | | |
| `consent_marketing` + `consent_at` | bool/ts | DEFAULT false; existing |
| `consent_data_processing` + `_at` | bool/ts | **required to submit** (GDPR lawful basis) |
| `consent_terms` + `_at` | bool/ts | **required to submit** (code of conduct) |
| `consent_photo` + `_at` | bool/ts | optional (media/photography) |
| `consent_medical` + `_at` | bool/ts | optional, **required if any medical field filled** |

- Each consent `_at` is stamped only when its boolean goes true (false→true).
- Partial UNIQUE `(venue_id, lower(email)) WHERE email IS NOT NULL AND status
  <> 'erased'` — one live person per venue-email; a scrub frees the slot.
- **GDPR:** `venue_erase_customer` scrubs ALL PII (incl. every mig-282 column)
  but KEEPS the row (`status='erased'`) so membership/charge history stays
  referentially intact. Audit metadata stores FLAGS (is_minor/has_medical/consent
  bools) never the PII itself.
- RPCs: `venue_create_customer` / `venue_update_customer` /
  `venue_erase_customer` (writes, gated `manage_memberships`) +
  `venue_list_customers_people` (read, any member). See RPCS.md.

### Membership & fee core (mig 271, Phase 3) — manual billing

Billing reuses `venue_charges` (source_type CHECK extended to add `'fee'`,
`'membership'`); manual payment stays via `venue_record_payment`. One charge per
cycle: the renewal mint encodes the period in `source_id` (`<id>:<period_date>`)
so the `venue_charges` uniqueness `(source_type, source_id, COALESCE(team_id,''))`
makes renewals idempotent.

- `venue_membership_tiers` — `venue_id`, `name`, `benefits jsonb`
  ({discount_pct, included_sessions, priority_booking, equipment_included,
  sports_included[]}), `active`. **Venue ops builds these themselves.**
- `venue_tier_prices` — `tier_id`, `period` (monthly|quarterly|annual),
  `price_pence`, `active`. UNIQUE(tier_id, period) — per-cadence pricing.
- `venue_memberships` — `venue_id`, `customer_id`→venue_customers, `tier_id`,
  `period`, `amount_pence` (snapshot at enrol = fair rate hold), `status`
  (active|paused|ending|cancelled), `started_at`, `renews_at` (next charge),
  `frozen_until`, `cancel_at`, **`pass_token` (mig 272 — UNIQUE, auto-filled
  `'m_'||uuid`; the secret in the member's `/m/<token>` PWA pass)**. Partial
  UNIQUE `(customer_id) WHERE status IN (active,paused,ending)` — one live
  membership per person.
- `venue_fee_plans` — `venue_id`, `name`, `amount_pence`, `period`
  (weekly|monthly|quarterly|annual), `sport`, `active`. Team/booker-level.
- `venue_fee_subscriptions` — `venue_id`, `plan_id`, `member_key` (team id OR
  booked_by_name), `team_id`→teams (set when a team), `status`, `started_at`,
  `next_charge_at`, `cancel_at`.
- Helper `_membership_period_interval(text)→interval` (IMMUTABLE).
- `run_membership_renewals()` — **service_role only** (cron). Reactivates lapsed
  freezes, flips end-of-period cancels to `cancelled`, mints the next charge for
  due memberships + fee subscriptions, advances dates. Driven by
  `apps/inorout/api/cron.js membershipRenewalsJob` (09:00 UK). Freeze: `status`
  paused + `renews_at` pushed by the freeze length (frozen window never billed).
- **Payment Infrastructure foundation (mig 329, s132)** — `venue_integrations` table:
  `id uuid PK`, `venue_id`→venues, `provider` IN ('stripe','gocardless'), `status` IN
  ('pending','connected','disconnected'), `account_id text` (Stripe account ID or GC
  partner ID), `access_token text` (per-venue secret — never returned to client, SECDEF-only),
  `config jsonb` (e.g. `{charges_enabled, details_submitted}`), `connected_at`, `disconnected_at`,
  `created_at`, `updated_at`. UNIQUE(venue_id, provider). RLS-walled, REVOKE anon/authenticated.
  The four `stripe_connect_*` columns mig 279 added to `venues` are DROPPED (moved here).
- **Phase 7 Stripe scaffolding (mig 279, DORMANT)** — `venue_customers` +
  `stripe_customer_id`; `venue_memberships` + `stripe_subscription_id`, `stripe_price_id`,
  `payment_state` (current|past_due|suspended — Stripe-driven, separate from `status`);
  `billing_events` (mig 055) gains entity scope `membership` + lifecycle `status`
  (received|processed|failed|ignored) + `processed_at` + `payload jsonb` (the persist-then-
  process webhook store; UNIQUE `stripe_event_id` = idempotency key). NOTE: `venues` stripe
  columns removed — provider credentials now live in `venue_integrations`.
- `venue_member_checkins` (mig 274, Phase 5) — reception attendance log. `venue_id`,
  `membership_id`→venue_memberships, `customer_id`→venue_customers, `checked_in_at`,
  `source` (`display_qr`). RLS-walled, definer-only (REVOKE anon/authenticated).
  Written ONLY by `member_check_in` (de-duped within a 4h window). Feeds visit
  counts on check-in + Phase 6 attendance intelligence.

### Partner perks + reporting (mig 273, Phase 6)

- `venue_partners` — `venue_id`, `name`, `contact`, `active`. Local partners
  (e.g. the pub).
- `partner_offers` — `venue_id`, `partner_id`, `title`, `description`, `code`
  (NULL = show-your-pass), `tier_ids uuid[]` (NULL/empty = all members; else
  scoped), `active`. Surfaced on the member pass via `get_member_pass`.
- `partner_redemptions` — `offer_id`, `membership_id`, `redeemed_at`. Logged by
  `redeem_member_offer` (member taps to reveal). **Sponsorship/affiliate revenue
  — a separate pool from the booking flow.**
- Reads: `venue_membership_summary` (active/paused/ending, due-soon, cadence-
  normalised MRR, 30-day churn), `venue_list_partners`. See RPCS.md.
- **Deferred:** auto-applying tier `discount_pct` inside `venue_confirm_booking`
  — needs a booking↔member link (bookings key on team/walk-in, memberships on
  person) that doesn't exist yet.

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
| `playing_areas` | `prime_time_windows jsonb NOT NULL DEFAULT '[]'` | (mig 176) per-pitch peak band `[{day_of_week 0-6, start_time, end_time}]` (no slot_lengths). Edited via `venue_update_pitch`; in `venue_get_state` pitches projection. |
| `venues` | `default_prime_time_windows jsonb NOT NULL DEFAULT '[]'` | (mig 177) venue-default prime band (same shape); a pitch with empty `prime_time_windows` inherits it. Edited via `venue_update_booking_settings`. |

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

**HQ utilisation read (mig 178):**
- `hq_get_utilisation(p_company_id, p_date_from, p_date_to)` — read-only HQ RPC over
  `pitch_occupancy` + `playing_areas`. Per-pitch/venue/company used-vs-available %, prime/off-peak
  split (resolving pitch `prime_time_windows` → venue `default_prime_time_windows` →
  not_configured), empty-prime hours, best/worst day+slot, fixture/booking source split,
  requested-pending. Used = fixtures + confirmed bookings (maintenance excluded; requested NOT
  counted); usage clipped to opening hours on a 30-min Europe/London bucket grid; available =
  `booking_windows` else assumed 08:00–22:00. SECDEF, anon-denied, region-scoped via
  `resolve_company_caller`. See DECISIONS.md (session 62).
- `hq_get_company_state` (mig 179) — each venue's `health` is now band-derived from a scored
  model plus additive fields `health_score int|null`, `health_reason text`,
  `health_axes {operations, utilisation, fixture_completion}`. Score = weighted (ops 0.40 /
  util 0.30 / completion 0.30, missing axis renormalised) via helper
  `_hq_health_score(numeric,numeric,numeric)` (IMMUTABLE). Band ≥80 green/≥55 amber/else red;
  hard-red overrides (critical incident, past_due/cancelled, expired trial). See DECISIONS.md
  (session 63).

**Venue Payments Ledger (mig 180 — V1, schema only; money OWED TO the venue):**
- `venue_charges` — what's owed: `id`, `venue_id`→venues (denormalised), `source_type`
  (booking|fixture|equipment|fee|membership|merchandise — `equipment` added mig 255, `merchandise` added mig 309), `source_id` text, `team_id`→teams NULL, `competition_id`→competitions NULL,
  `amount_due_pence`, `status` (unpaid|partial|paid|refunded), `due_date`, `created_at`.
  UNIQUE(source_type, source_id, COALESCE(team_id,'')) — one charge per booking, one per team
  per fixture.
- `venue_payments` — instalment log: `id`, `charge_id`→venue_charges, `kind` (payment|refund),
  `amount_pence`, `method` (cash|bank_transfer|card|other), `external_ref` UNIQUE NULL, `note`,
  `taken_by`, `taken_at`, `voided_at`. Status/balance derived from non-voided rows vs amount due.
- Fee config: `league_config.fixture_fee_pence` + `fixture_fee_payer` (both|home, default both),
  `playing_areas.default_fee_pence`, `venues.payment_link` (interim hosted online-pay URL).
- RLS on both, anon/authenticated revoked (RPC-only). V1 = schema + demo seed. Separate from
  `payment_ledger` (player match-subs). See VENUE_PAYMENTS_SCOPE.md.
- **V2 RPCs (mig 181, SECDEF · `resolve_venue_caller` · audited · `notify_venue_change`):**
  `venue_record_payment(token,charge_id,amount_pence,method,external_ref?,note?)` (append
  instalment + recompute status), `venue_void_payment(token,payment_id)` (soft-void + recompute),
  `venue_set_charge_due(token,charge_id,amount_pence)` (override due + recompute),
  `venue_get_charges(token,status?,source_type?,limit?)` (read: charges + balances + collection
  summary). Status recompute via `_recompute_charge_status(charge_id)` (non-voided instalments vs
  due; preserves terminal `refunded`). **Charge auto-creation hooks** added to
  `venue_confirm_booking` (booking charge from booking.amount_pence else
  `playing_areas.default_fee_pence`; skip if no fee), `venue_generate_fixtures` (per-team charges
  per `fixture_fee_payer` from `league_config.fixture_fee_pence`; skip if no fee),
  `venue_update_fixture_status` (on `void` → that fixture's charges set `refunded`, payments kept).
  `notify_venue_change` whitelist gains `payment_recorded`/`payment_voided`/`charge_updated`.

**Equipment Hire (mig 255 — V1 schema; Cycle 1 of EQUIPMENT_HIRE_PLAN.md; sport-agnostic):**
- `equipment` — the catalogue (one row per kit type a venue owns): `id`, `venue_id`→venues,
  `name` (free-text label), `category` (apparel|balls|goals_targets|nets|training_aids|tech_av|safety
  — controlled taxonomy, the clean aggregation spine), `quantity` (units owned), `default_fee_pence`,
  `deposit_pence`, `hire_unit` (per_hour|per_session|per_day), `purchase_price_pence` NULL,
  `acquired_on` NULL, `condition` (new|good|worn|damaged|retired), `active`, `created_at`, `updated_at`.
- `equipment_bookings` — concrete hires (mirrors `pitch_bookings`): `id`, `equipment_id`→equipment,
  `venue_id`→venues, `team_id`→teams NULL (registered booker), `booked_by_name` NULL (walk-in),
  `qty`, `start_at`, `end_at`, `due_back_at` NULL, `returned_at` NULL, `booking_id`→pitch_bookings NULL +
  `fixture_id`→fixtures NULL (**session-link FKs = cross-sell spine**), `status`
  (requested|confirmed|declined|cancelled|out|returned|overdue), `amount_pence` NULL, `contact_email`,
  `contact_phone`, `created_at`. CHECK end_at>start_at; CHECK team_id OR booked_by_name present.
  **Mig 258 (Cycle 3) adds** `deposit_pence` + `deposit_status` (none|held|released|forfeited) +
  `deposit_resolved_at` (deposit = a refundable HOLD tracked on the row, never in the ledger),
  `handed_out_at`, `returned_condition`. Written by the Cycle 2/3 hire flow (migs 257/259).
- `equipment_demand_misses` — turned-away demand (procurement signal): `id`, `venue_id`→venues,
  `category`, `equipment_id`→equipment NULL, `window_start`, `window_end`, `qty_wanted`,
  `source` (venue|self_qr), `created_at`. Captured at the moment of an empty availability check (Cycle 2).
- RLS on all three, anon/authenticated revoked (RPC-only). Demo seed (5 items) on demo_venue only.
- **Catalogue RPCs (mig 256, SECDEF · `resolve_venue_caller` · audited):**
  `venue_list_equipment(token)` (read: catalogue + per-item `hires_count`/`out_now` + summary),
  `venue_upsert_equipment(token,name,category,quantity,id?,default_fee_pence?,deposit_pence?,hire_unit?,
  purchase_price_pence?,acquired_on?,condition?,active?)` (create when id NULL, else edit).
- **Hire-flow RPCs (mig 256+257, Cycle 2):** `get_equipment_availability(token,from,to,cat?)` (read:
  quantity-aware free units, `free = quantity − _equipment_peak_committed`), `venue_create_equipment_hire(...)`
  (pre-confirmed hire, row-locked qty guard, auto-charge, demand-miss-on-turn-away),
  `venue_cancel_equipment_hire(token,hire)` (+ refund), `venue_list_equipment_hires(token,status?,limit?)`.

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
| `customer_id` | uuid NULL →venue_customers (SET NULL) | mig 277 — booking↔member link; set explicitly or auto-matched by `contact_email` at confirm; drives member discount in `venue_confirm_booking(_series)` |
| `member_discount_pct` | int NULL | mig 281 — the member discount % APPLIED at confirm (immutable record); surfaced on the charge by `venue_get_charges` for the Payments "N% member" badge |
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

---

## invite_links (migration 248 — QR Onboarding routing layer)

Stable code → mutable destination. A printed/laminated QR encodes ONLY
`/q/<code>`; the row behind it can be re-pointed forever. Never QR-encode
an internal id. All access via SECURITY DEFINER RPCs (`resolve_invite_link`,
`redeem_invite_link`) — RLS enabled, no client policies. Plan:
`QR_ONBOARDING_SCOPE.md`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `code` | text PK | NO | — | url-safe, generated server-side (`generate_url_safe_token`) |
| `entity_type` | text | NO | — | CHECK `IN ('team','venue','fixture')` |
| `entity_id` | text | NO | — | `teams.id` / `venues.id` / `fixtures.id::text`. Not a typed FK (polymorphic; `fixtures.id` is uuid) — integrity enforced in the resolver per `entity_type` |
| `action` | text | NO | — | CHECK `IN ('join_team','venue_landing','match_checkin')` |
| `active` | boolean | NO | `true` | venue can deactivate (slice 7) |
| `expires_at` | timestamptz | YES | — | NULL = never |
| `max_uses` | integer | YES | — | NULL = unlimited |
| `use_count` | integer | NO | `0` | incremented by `redeem_invite_link` |
| `label` | text | YES | — | venue-facing name ("Reception poster") |
| `created_by` | text | YES | — | venue actor_ident (audit) |
| `created_at` | timestamptz | NO | `now()` | |

Index: `invite_links_entity_idx` on `(entity_type, entity_id)` — for the
management panel's per-entity code list (slice 7).

---

## CLUB OS TABLES (migs 283–309)

RLS enabled + REVOKE ALL from anon, authenticated on all tables. Access via SECURITY DEFINER RPCs only.

- `member_profiles` — `id uuid PK`, `auth_user_id uuid FK→auth.users NULL` (NULL = unclaimed), `first_name`, `last_name`, CPSU superset (dob, gender, ec1/ec2, medical, photo_consent jsonb, safeguarding, allergies, medications, gp_details, may_leave_unaccompanied, authorised_collectors, send_notes, dietary_notes, consent_emergency_treatment, consent_administer_medication). `source_customer_id uuid NULL FK→venue_customers`.
- `member_guardians` — `id uuid PK`, `guardian_profile_id uuid FK→member_profiles`, `child_profile_id uuid FK→member_profiles`. Household graph. UNIQUE(guardian_profile_id, child_profile_id).
- `clubs` — `id text PK`, name, short_name, contact_name, contact_email, `id_mandate bool`, `safeguarding_config jsonb` (CPSU toggle flags).
- `club_venues` — `venue_id text FK→venues`, `club_id text FK→clubs`. M:N link. PK (venue_id, club_id).
- `club_cohorts` — `id uuid PK`, `club_id text FK→clubs`, name, description, active. Playing groups within a club.
- `club_teams` — `id uuid PK`, `club_id text FK→clubs`, `name text`, `sport text NULL`, active. Club-domain playing teams (membership layer, not league layer). Unique per team_id in club.
- `club_team_members` — `id uuid PK`, `team_id uuid FK→club_teams`, `member_profile_id uuid FK→member_profiles`, season, joined_at, left_at, is_active. PARTIAL UNIQUE(team_id, member_profile_id) WHERE is_active=true.
- `club_team_managers` — `id uuid PK`, `team_id uuid FK→club_teams`, `member_profile_id uuid FK→member_profiles`, role (manager|assistant_manager|coach), is_active.
- `club_staff_dbs` — `id uuid PK`, `member_profile_id uuid FK→member_profiles`, `club_id text FK→clubs`, check_type (basic|standard|enhanced|enhanced_barred), status (pending|valid|expired|withdrawn), certificate_number, issued_date, expiry_date, notes. UNIQUE(member_profile_id, club_id). mig 305.
- `club_sessions` — `id uuid PK`, `club_id text`, `cohort_id uuid NULL FK→club_cohorts`, `team_id uuid NULL FK→club_teams`, session_type (training|match|friendly|other), title, scheduled_at, duration_mins, location, capacity NULL, notes, status (scheduled|cancelled), series_id uuid NULL FK→club_session_series, opponent_name/home_away/meet_time (match fields). migs 298+300.
- `club_session_series` — `id uuid PK`, `club_id text`, cohort_id, team_id, title, session_type, day_of_week (0–6), start_time, duration_mins, location, start_date, end_date, notes. mig 302.
- `club_session_rsvps` — `id uuid PK`, `session_id uuid FK→club_sessions`, `member_profile_id uuid FK→member_profiles`, rsvp (in|out|maybe), for_profile_id (guardian child target). UNIQUE(session_id, member_profile_id).
- `club_session_attendance` — `id uuid PK`, `session_id uuid FK→club_sessions`, `member_profile_id uuid FK→member_profiles`, status (present|absent|late), recorded_at, recorded_by uuid FK→member_profiles. UNIQUE(session_id, member_profile_id). mig 304.
- `club_session_guests` — `id uuid PK`, `session_id uuid FK→club_sessions`, `member_profile_id uuid FK→member_profiles`, added_by uuid FK→member_profiles. UNIQUE(session_id, member_profile_id). mig 300.
- `club_announcements` — `id uuid PK`, `club_id text`, `venue_id text`, `created_by uuid FK→auth.users`, title, body, audience (club|cohort|team), cohort_id NULL, team_id NULL, status (queued|sent|failed), email_sent_count, sent_at. mig 307.
- `club_merchandise` — `id uuid PK`, `club_id text FK→clubs`, `venue_id text FK→venues`, name, description NULL, category (kit|accessories|equipment|other), price_pence int, stock_qty int NULL (NULL = unlimited), active bool, created_at. mig 309.
- `club_purchases` — `id uuid PK`, `club_id text FK→clubs`, `venue_id text FK→venues`, `member_profile_id uuid FK→member_profiles`, `item_id uuid FK→club_merchandise`, quantity int, unit_price_pence int, status (pending_payment|pending|fulfilled|cancelled), notes NULL, stripe_payment_intent_id text NULL, created_at. mig 309. `pending_payment` = Stripe hook point (dormant until keys provided).
- `venue_membership_tiers` — `id uuid PK`, `venue_id text`, name, benefits jsonb, active, audience (all|adult|junior|family), pricing_model (recurring|season), season_start/season_end date NULL.
- `venue_tier_prices` — `id uuid PK`, `tier_id uuid FK→venue_membership_tiers`, period (monthly|quarterly|annual|season), price_type (standard|family|sibling), amount_pence, active.
- `venue_memberships` — `id uuid PK`, `venue_id text`, `customer_id uuid NULL FK→venue_customers` (NULL for V2 pure-member path), `member_profile_id uuid NULL FK→member_profiles`, `payer_profile_id uuid NULL`, `tier_id uuid FK→venue_membership_tiers`, `club_id text NULL FK→clubs`, `cohort_id uuid NULL`, period, pricing_model, amount_pence, status (active|paused|ending|cancelled), started_at, renews_at, frozen_until NULL, cancel_at NULL, pass_token (m_… generated), stripe_subscription_id NULL, stripe_price_id NULL, payment_state (current|overdue|cancelled).
- `policy_documents` — `id uuid PK`, `club_id text FK→clubs`, `venue_id text`, title, current_version_id uuid NULL FK→policy_document_versions, created_at. PARTIAL UNIQUE(club_id, title) WHERE current_version_id IS NOT NULL.
- `policy_document_versions` — `id uuid PK`, `document_id uuid FK→policy_documents`, version_number, content text, published_at, published_by uuid FK→auth.users.
- `consent_acceptances` — `id uuid PK`, `document_id uuid FK→policy_documents`, `member_profile_id uuid FK→member_profiles`, `document_version_id uuid`, typed_signature text, signed_ip text, signed_ua text, `signed_on_behalf_of uuid NULL` (guardian signing for child). UNIQUE(document_id, member_profile_id). ON DELETE RESTRICT (preserves audit trail).
- `member_id_documents` — `id uuid PK`, `member_profile_id uuid FK→member_profiles`, `club_id text FK→clubs`, type (passport|driving_licence|birth_certificate|other), status (pending|verified|rejected), storage_path text, notes NULL, verified_by uuid NULL, verified_at timestamptz NULL.

---

## STORAGE BUCKETS (migration 246)

| Bucket | Public | Limits | Write access |
|---|---|---|---|
| `venue-media` | yes (objects served via `/object/public/…`) | 5 MB; image/png, jpeg, webp, gif, svg+xml | `authenticated` venue staff only, object path must start with their `venue_id` folder (`<venue_id>/…`), checked against an active `venue_admins` row. Used for reception-display sponsor creative; public URL saved into `venues.display_config.sponsor_image_url` via `venue_update_display_config` (mig 245). |
