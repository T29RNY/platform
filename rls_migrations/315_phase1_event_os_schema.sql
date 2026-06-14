-- Migration 315 — Event OS: Phase 1 schema foundations
-- New tables: tournament_events, performance_events, performance_results
-- ALTERs:     competitions.tournament_event_id
--             competition_teams.waitlist_position
--             league_config.ref_ui_config
--             playing_areas.sport_types
--
-- Type corrections vs the spec:
--   tournament_events.club_id       → text  (clubs.id is text PK)
--   performance_events.surface_id   → uuid  (playing_areas.id is uuid)
--   performance_results.athlete_id  → text  (players.id is text PK)
--
-- No RPCs in this migration. All data access wired in later phases.
-- RLS enabled on all three new tables; anon + authenticated access revoked.

-- ─── tournament_events ────────────────────────────────────────────────────────
CREATE TABLE public.tournament_events (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              text        NOT NULL REFERENCES public.venues(id),
  club_id               text        NOT NULL REFERENCES public.clubs(id),
  name                  text        NOT NULL,
  slug                  text        UNIQUE NOT NULL,
  event_date            date        NOT NULL,
  event_end_date        date,
  status                text        DEFAULT 'draft'
                                    CHECK (status IN ('draft','open','closed','live','completed')),
  entry_fee_pence       int         DEFAULT 0,
  entry_fee_payer       text        DEFAULT 'per_team'
                                    CHECK (entry_fee_payer IN ('per_team','per_athlete')),
  host_team_entry_waived boolean    DEFAULT true,
  track_stats           boolean     DEFAULT true,
  registration_deadline timestamptz,
  schedule_config       jsonb       DEFAULT '{}',
  branding              jsonb       DEFAULT '{}',
  points_config         jsonb       DEFAULT '{}',
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE public.tournament_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_events FROM anon, authenticated;

-- ─── performance_events ───────────────────────────────────────────────────────
CREATE TABLE public.performance_events (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_event_id   uuid        NOT NULL REFERENCES public.tournament_events(id),
  name                  text        NOT NULL,
  sport                 text        NOT NULL,
  measurement_type      text        CHECK (measurement_type IN
                                      ('time_asc','time_desc','distance','height','weight')),
  unit                  text        NOT NULL,
  has_heats             boolean     DEFAULT false,
  heats_count           int,
  max_per_heat          int,
  qualifiers_per_heat   int,
  attempts_per_athlete  int         DEFAULT 1,
  category              text,
  scheduled_time        timestamptz,
  surface_id            uuid        REFERENCES public.playing_areas(id),
  display_order         int
);

ALTER TABLE public.performance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.performance_events FROM anon, authenticated;

-- ─── performance_results ──────────────────────────────────────────────────────
CREATE TABLE public.performance_results (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_event_id  uuid        NOT NULL REFERENCES public.performance_events(id),
  athlete_id            text        NOT NULL REFERENCES public.players(id),
  team_id               text        REFERENCES public.teams(id),
  value                 numeric     NOT NULL,
  attempt_number        int         DEFAULT 1,
  heat_number           int,
  qualified_for_final   boolean     DEFAULT false,
  status                text        DEFAULT 'pending'
                                    CHECK (status IN
                                      ('pending','recorded','dns','dnf','disqualified')),
  recorded_at           timestamptz DEFAULT now(),
  recorded_by           uuid        REFERENCES auth.users(id)
);

ALTER TABLE public.performance_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.performance_results FROM anon, authenticated;

-- ─── ALTERs ───────────────────────────────────────────────────────────────────

-- Link competitions to a tournament event (nullable — most competitions are not
-- part of a tournament event and this column stays NULL for them).
ALTER TABLE public.competitions
  ADD COLUMN tournament_event_id uuid REFERENCES public.tournament_events(id);

-- Waitlist position for competition_teams pending acceptance.
ALTER TABLE public.competition_teams
  ADD COLUMN waitlist_position int NULL;

-- Sport-configurable ref UI. NULL = default football UI.
-- Example for judo:
-- {"events":[{"type":"ippon","label":"Ippon","ends_match":true},...],
--  "show_cards":false,"show_subs":false,"score_label":"Points"}
ALTER TABLE public.league_config
  ADD COLUMN ref_ui_config jsonb DEFAULT NULL;

-- Playing areas can declare which sports they accept.
-- NULL = accepts any sport. ['football'] = football only.
ALTER TABLE public.playing_areas
  ADD COLUMN sport_types text[] DEFAULT NULL;
