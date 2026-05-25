-- Migration 055 — Phase 1 schema spine: 20 new tables for venue/league/HQ
-- Spec: venue_league_hq_SCOPE.md lines 230–620
--
-- Multi-sport posture applied throughout (see DECISIONS.md session 40):
--   - `pitches`  → `playing_areas`     (covers football pitches, basketball
--                                       courts, hockey rinks, tennis courts)
--   - `referees` → `match_officials`   (covers referees, umpires, judges)
--   - `match_events.event_type` is open text (no CHECK) — each sport defines
--     its own vocabulary in code; no migration needed to add a new sport
--   - `match_events.period`    is open text for the same reason
--   - `companies.sport`, `venues.sport`, `leagues.sport` default 'football'
--     (single source of truth at every level)
--   - `league_config.format`, `leagues.format`, `companies.format` etc are
--     all open text (no CHECK) so cricket-T20, basketball-5v5, netball-7v7
--     can be added without schema change
--
-- ALL tables RLS-enabled with NO public policies. Reads/writes via SECURITY
-- DEFINER RPCs that land in Phase 2. Pure additive — zero touch to existing
-- tables. Customer-visible impact today: zero.

-- ─── HQ LAYER ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.companies (
  id                     text PRIMARY KEY,
  name                   text NOT NULL,
  slug                   text UNIQUE,
  sport                  text NOT NULL DEFAULT 'football',
  logo_url               text,
  primary_colour         text,
  secondary_colour       text,
  contact_email          text,
  contact_phone          text,
  active                 boolean NOT NULL DEFAULT true,
  trial_ends_at          timestamptz,
  subscription_status    text NOT NULL DEFAULT 'trial'
                           CHECK (subscription_status IN ('trial','active','past_due','cancelled')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.companies FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.company_admins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'analyst'
              CHECK (role IN ('super_admin','regional_admin','analyst')),
  region      text,
  granted_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS company_admins_user_id_idx ON public.company_admins (user_id);
CREATE INDEX IF NOT EXISTS company_admins_company_id_idx ON public.company_admins (company_id);
ALTER TABLE public.company_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_admins FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.billing_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     text NOT NULL CHECK (entity_type IN ('venue','company')),
  entity_id       text NOT NULL,
  event_type      text NOT NULL,
  stripe_event_id text UNIQUE,
  amount_pence    integer,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_events_entity_idx ON public.billing_events (entity_type, entity_id, created_at DESC);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_events FROM anon, authenticated;

-- ─── CLUB LAYER ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.clubs (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  short_name   text,
  founded_year integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clubs FROM anon, authenticated;

-- ─── VENUE LAYER ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venues (
  id                     text PRIMARY KEY,
  company_id             text REFERENCES public.companies(id) ON DELETE SET NULL,
  name                   text NOT NULL,
  slug                   text UNIQUE,
  sport                  text NOT NULL DEFAULT 'football',
  address                text,
  city                   text,
  postcode               text,
  lat                    numeric(9,6),
  lng                    numeric(9,6),
  logo_url               text,
  primary_colour         text,
  secondary_colour       text,
  contact_email          text,
  contact_phone          text,
  venue_admin_token      text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  display_pin            text,
  active                 boolean NOT NULL DEFAULT true,
  trial_ends_at          timestamptz,
  subscription_status    text NOT NULL DEFAULT 'trial'
                           CHECK (subscription_status IN ('trial','active','past_due','cancelled')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venues_company_id_idx ON public.venues (company_id);
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venues FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.venue_admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, user_id)
);
CREATE INDEX IF NOT EXISTS venue_admins_user_id_idx ON public.venue_admins (user_id);
ALTER TABLE public.venue_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_admins FROM anon, authenticated;

-- `playing_areas` (multi-sport rename from `pitches` — covers football
-- pitches, basketball courts, hockey rinks, tennis courts, boxing rings)
CREATE TABLE IF NOT EXISTS public.playing_areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name       text NOT NULL,
  surface    text,                       -- 'astroturf','3g','hardwood','clay','grass','indoor','ice'
  capacity   integer,                    -- max players per side / per team
  active     boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS playing_areas_venue_id_idx ON public.playing_areas (venue_id);
ALTER TABLE public.playing_areas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.playing_areas FROM anon, authenticated;

-- `match_officials` (multi-sport rename from `referees` — covers football
-- refs, cricket umpires, boxing judges, tennis umpires, athletics starters)
CREATE TABLE IF NOT EXISTS public.match_officials (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id           text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name               text NOT NULL,
  phone              text,
  email              text,
  whatsapp_number    text,
  preferred_channel  text NOT NULL DEFAULT 'whatsapp'
                       CHECK (preferred_channel IN ('whatsapp','sms','email','push')),
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_officials_venue_id_idx ON public.match_officials (venue_id);
ALTER TABLE public.match_officials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_officials FROM anon, authenticated;

-- ─── LEAGUE / SEASON / COMPETITION LAYER ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.leagues (
  id                   text PRIMARY KEY,
  venue_id             text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  short_name           text,
  sport                text NOT NULL DEFAULT 'football',
  format               text NOT NULL DEFAULT '5-a-side',   -- open text; no CHECK
  day_of_week          integer CHECK (day_of_week BETWEEN 0 AND 6),
  default_kickoff_time time,
  default_playing_area_id uuid REFERENCES public.playing_areas(id) ON DELETE SET NULL,
  league_admin_token   text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  display_token        text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leagues_venue_id_idx ON public.leagues (venue_id);
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leagues FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.seasons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   text NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  name        text NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  num_weeks   integer NOT NULL CHECK (num_weeks > 0),
  status      text NOT NULL DEFAULT 'setup'
                CHECK (status IN ('setup','active','completed','archived')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seasons_league_id_idx ON public.seasons (league_id);
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seasons FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.competitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('league','cup','playoff')),
  format      text CHECK (format IN ('round_robin','single_elimination','double_elimination','group_stage')),
  status      text NOT NULL DEFAULT 'setup'
                CHECK (status IN ('setup','active','completed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS competitions_season_id_idx ON public.competitions (season_id);
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competitions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.club_teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    text NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  team_id    text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id)                                   -- a team belongs to one club
);
CREATE INDEX IF NOT EXISTS club_teams_club_id_idx ON public.club_teams (club_id);
ALTER TABLE public.club_teams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_teams FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.competition_teams (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id      uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  team_id             text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  registered_at       timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','withdrawn','expelled')),
  withdrawal_reason   text,
  UNIQUE (competition_id, team_id)
);
CREATE INDEX IF NOT EXISTS competition_teams_team_id_idx ON public.competition_teams (team_id);
ALTER TABLE public.competition_teams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competition_teams FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.team_name_history (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                  text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name                     text NOT NULL,
  effective_from_season_id uuid REFERENCES public.seasons(id) ON DELETE SET NULL,
  effective_to_season_id   uuid REFERENCES public.seasons(id) ON DELETE SET NULL,
  changed_by               uuid,
  approved_by              uuid,
  change_reason            text,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_name_history_team_id_idx ON public.team_name_history (team_id);
ALTER TABLE public.team_name_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_name_history FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.cup_rounds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_number   integer NOT NULL,
  round_name     text NOT NULL,
  num_teams      integer NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','active','completed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, round_number)
);
ALTER TABLE public.cup_rounds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cup_rounds FROM anon, authenticated;

-- ─── FIXTURE / EVENT LAYER ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fixtures (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id      uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  home_team_id        text NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  away_team_id        text REFERENCES public.teams(id) ON DELETE RESTRICT,  -- NULL = bye
  week_number         integer NOT NULL,
  round_name          text,
  scheduled_date      date,
  kickoff_time        time,
  playing_area_id     uuid REFERENCES public.playing_areas(id) ON DELETE SET NULL,
  official_id         uuid REFERENCES public.match_officials(id) ON DELETE SET NULL,
  ref_token           text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  status              text NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','allocated','in_progress','completed','postponed','void','walkover')),
  walkover_winner_id  text REFERENCES public.teams(id) ON DELETE SET NULL,
  postpone_reason     text,
  void_reason         text,
  home_score          integer,
  away_score          integer,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fixtures_competition_id_idx ON public.fixtures (competition_id);
CREATE INDEX IF NOT EXISTS fixtures_home_team_id_idx ON public.fixtures (home_team_id);
CREATE INDEX IF NOT EXISTS fixtures_away_team_id_idx ON public.fixtures (away_team_id) WHERE away_team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fixtures_scheduled_date_idx ON public.fixtures (scheduled_date);
CREATE INDEX IF NOT EXISTS fixtures_playing_area_id_idx ON public.fixtures (playing_area_id) WHERE playing_area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fixtures_official_id_idx ON public.fixtures (official_id) WHERE official_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fixtures_walkover_winner_id_idx ON public.fixtures (walkover_winner_id) WHERE walkover_winner_id IS NOT NULL;
ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fixtures FROM anon, authenticated;

-- `match_events` — event_type and period are OPEN TEXT (no CHECK) so each
-- sport defines its own vocabulary in code without requiring a migration:
--   football: 'goal','own_goal','yellow_card','red_card','sin_bin', etc.
--   cricket:  'wicket','six','four','lbw','no_ball','catch'
--   basketball: 'three_pointer','foul','rebound','steal','block'
--   tennis: 'ace','double_fault','break_point'
CREATE TABLE IF NOT EXISTS public.match_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id            uuid NOT NULL REFERENCES public.fixtures(id) ON DELETE CASCADE,
  team_id               text NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  player_id             text REFERENCES public.players(id) ON DELETE SET NULL,
  player_name_override  text,                       -- for unregistered scorers
  event_type            text NOT NULL,              -- open text — see header comment
  minute                integer NOT NULL,
  period                text NOT NULL,              -- open text — sport-specific
  sub_player_on_id      text REFERENCES public.players(id) ON DELETE SET NULL,
  sub_player_off_id     text REFERENCES public.players(id) ON DELETE SET NULL,
  recorded_by_token     text NOT NULL,
  recorded_by_type      text NOT NULL CHECK (recorded_by_type IN ('referee','team_admin','system')),
  synced_at             timestamptz,                -- NULL = recorded offline, not yet synced
  local_timestamp       timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_events_fixture_id_idx ON public.match_events (fixture_id);
CREATE INDEX IF NOT EXISTS match_events_team_id_idx ON public.match_events (team_id);
CREATE INDEX IF NOT EXISTS match_events_player_id_idx ON public.match_events (player_id) WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS match_events_sub_on_idx ON public.match_events (sub_player_on_id) WHERE sub_player_on_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS match_events_sub_off_idx ON public.match_events (sub_player_off_id) WHERE sub_player_off_id IS NOT NULL;
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_events FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.player_registrations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           text NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  competition_id      uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  team_id             text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  registration_number text,                        -- e.g. FA reg number
  registered_at       timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','ineligible')),
  suspension_until    date,
  suspension_reason   text,
  UNIQUE (player_id, competition_id)
);
CREATE INDEX IF NOT EXISTS player_registrations_competition_id_idx ON public.player_registrations (competition_id);
CREATE INDEX IF NOT EXISTS player_registrations_team_id_idx ON public.player_registrations (team_id);
ALTER TABLE public.player_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_registrations FROM anon, authenticated;

-- ─── OPERATIONS LAYER ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.incidents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  fixture_id      uuid REFERENCES public.fixtures(id) ON DELETE SET NULL,
  reported_by     uuid NOT NULL,
  description     text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('info','warning','critical')),
  resolved_at     timestamptz,
  resolved_by     uuid,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_venue_id_idx ON public.incidents (venue_id);
CREATE INDEX IF NOT EXISTS incidents_fixture_id_idx ON public.incidents (fixture_id) WHERE fixture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS incidents_unresolved_idx ON public.incidents (venue_id, severity, created_at DESC) WHERE resolved_at IS NULL;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.incidents FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.hq_preview_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  token        text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  generated_by uuid NOT NULL,
  expires_at   timestamptz NOT NULL,
  accessed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hq_preview_tokens_company_id_idx ON public.hq_preview_tokens (company_id);
ALTER TABLE public.hq_preview_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_preview_tokens FROM anon, authenticated;

-- ─── ROLLBACK (reverse FK order) ─────────────────────────────────────────
--
-- DROP TABLE IF EXISTS public.hq_preview_tokens, public.incidents,
--                       public.player_registrations, public.match_events,
--                       public.fixtures, public.cup_rounds,
--                       public.team_name_history, public.competition_teams,
--                       public.club_teams, public.competitions,
--                       public.seasons, public.leagues,
--                       public.match_officials, public.playing_areas,
--                       public.venue_admins, public.venues,
--                       public.clubs, public.billing_events,
--                       public.company_admins, public.companies CASCADE;
