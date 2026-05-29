-- 164_venue_display_columns.sql
-- League Mode Phase 4 (Reception Display), STAGE A1 — venue display token + config + read indexes.
--
-- The reception big-screen (/display/TOKEN) is a per-venue, READ-ONLY surface. It must
-- NOT use venue_admin_token (the operator's read-write secret), so we add a second,
-- lower-privilege public token parallel to leagues.display_token:
--   display_token  — per-venue, on the TV URL, resolved by get_display_state (mig 165).
--                    NOT NULL DEFAULT gen_random_uuid()::text → every existing venue
--                    backfills a unique token during the rewrite (volatile default,
--                    evaluated per row). UNIQUE so resolution is an index lookup + the
--                    token is a unique auth signal.
--   display_config — jsonb panel/layout config set by the operator via
--                    venue_update_display_config (mig 167). NULL = default "Live-led
--                    split" layout (the app supplies the default; no backfill needed).
--
-- Companion read indexes: get_display_state runs on every realtime re-fetch on a
-- wall-mounted TV, so the venue→competition resolution + per-fixture event scans must
-- be index-covered. All additive, all IF NOT EXISTS.
--
-- Additive only — no existing column renamed/moved/dropped (schema-sync: pg_constraint
-- swept, venues has only subscription_status CHECK + company_id FK + slug/admin_token
-- UNIQUE; no conflict with the new column or the new index name).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS display_token  text NOT NULL DEFAULT (gen_random_uuid())::text,
  ADD COLUMN IF NOT EXISTS display_config jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS venues_display_token_key
  ON public.venues (display_token);

-- Read-path companion indexes (get_display_state hot path).
CREATE INDEX IF NOT EXISTS idx_match_events_fixture
  ON public.match_events (fixture_id);
CREATE INDEX IF NOT EXISTS idx_match_events_goal_created
  ON public.match_events (created_at DESC) WHERE event_type = 'goal';
CREATE INDEX IF NOT EXISTS idx_fixtures_comp_status
  ON public.fixtures (competition_id, status);
CREATE INDEX IF NOT EXISTS idx_fixtures_date_status
  ON public.fixtures (scheduled_date, status);
CREATE INDEX IF NOT EXISTS idx_competitions_season_status
  ON public.competitions (season_id, status);
CREATE INDEX IF NOT EXISTS idx_seasons_league
  ON public.seasons (league_id);
CREATE INDEX IF NOT EXISTS idx_leagues_venue
  ON public.leagues (venue_id);
CREATE INDEX IF NOT EXISTS idx_competition_teams_comp_status
  ON public.competition_teams (competition_id, status);
